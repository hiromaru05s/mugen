// 夢幻の森 — Registry DO (シングルトン: idFromName('main'))
// 役割: (1) マッチメイキング=「今参加を受け付けているルーム名」のポインタ管理
//       (2) 戦績の永続化(DO SQLite: users / matches)
//       (3) リーダーボード(/stats)と本人限定の個人戦績(/me)
// 設計思想(README): RP・与ダメはチーム単位で計上。役割別の個人統計は本人のみ閲覧。
//   → matchesに残すのは「自分が何の職で出た試合か」と team単位のRP/貢献率まで。個人与ダメは記録しない。
'use strict';
import { DurableObject } from 'cloudflare:workers';
import { rankOf } from './shared.mjs';

export class Registry extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => this._init());
  }

  async _init() {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL,
      rp INTEGER NOT NULL DEFAULT 0, matches INTEGER NOT NULL DEFAULT 0,
      wins INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL DEFAULT 0)`);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS matches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, at INTEGER NOT NULL,
      cls TEXT, team INTEGER, rp INTEGER, win INTEGER, share REAL,
      dragon INTEGER, night INTEGER, reason TEXT)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_matches_user ON matches(user_id, at DESC)`);
    this.sql.exec(`CREATE INDEX IF NOT EXISTS idx_users_rp ON users(rp DESC)`);
    // 旧形式(名前キーのKV)からの移行: 一度だけusersへ取り込む
    const old = await this.ctx.storage.get('players');
    if (old && typeof old === 'object') {
      for (const [name, v] of Object.entries(old)) {
        this.sql.exec(`INSERT OR IGNORE INTO users (id,name,kind,rp,matches,wins,updated_at) VALUES (?,?,?,?,?,?,0)`,
          'name:' + name, name, 'legacy', v.rp | 0, v.matches | 0, v.wins | 0);
      }
      await this.ctx.storage.delete('players');
      console.log('[registry] migrated', Object.keys(old).length, 'legacy players');
    }
  }

  _user(id) { return this.sql.exec(`SELECT * FROM users WHERE id=?`, id).toArray()[0] || null; }

  async fetch(request) {
    const url = new URL(request.url);
    const storage = this.ctx.storage;

    // --- マッチメイキング: 現在の受付ルーム名 ---
    if (url.pathname === '/assign') {
      let cur = await storage.get('currentRoom');
      if (!cur) { cur = 'forest-1'; await storage.put('currentRoom', cur); await storage.put('roomCounter', 1); }
      return new Response(cur);
    }
    if (url.pathname === '/rotate' && request.method === 'POST') {
      // ルームがロック(開始)されたら次のルーム名へ。冪等: 既に進んでいれば何もしない
      const from = await request.text();
      let cur = await storage.get('currentRoom');
      if (!cur || cur === from) {
        const n = (await storage.get('roomCounter')) || 1;
        cur = 'forest-' + (n + 1);
        await storage.put('roomCounter', n + 1);
        await storage.put('currentRoom', cur);
      }
      return new Response(cur);
    }

    // --- ロビーのランク表示用(累計RPだけ) ---
    if (url.pathname === '/rp') {
      const u = this._user(url.searchParams.get('uid') || '');
      return Response.json({ rp: u ? u.rp : 0, rank: rankOf(u ? u.rp : 0) });
    }

    // --- 試合結果の記録 ---
    if (url.pathname === '/record' && request.method === 'POST') {
      const { players = [], meta = {} } = await request.json();
      const at = Date.now();
      const out = [];
      for (const p of players) {
        const id = String(p.userId || '').slice(0, 96);
        if (!id) continue;
        const name = String(p.name || 'player').slice(0, 12);
        const rp = Math.max(0, Math.round(+p.rp || 0));
        const win = p.win ? 1 : 0;
        this.sql.exec(`INSERT INTO users (id,name,kind,rp,matches,wins,updated_at) VALUES (?,?,?,?,1,?,?)
          ON CONFLICT(id) DO UPDATE SET name=excluded.name, rp=users.rp+excluded.rp,
            matches=users.matches+1, wins=users.wins+excluded.wins, updated_at=excluded.updated_at`,
          id, name, String(p.kind || 'guest'), rp, win, at);
        this.sql.exec(`INSERT INTO matches (user_id,at,cls,team,rp,win,share,dragon,night,reason)
          VALUES (?,?,?,?,?,?,?,?,?,?)`,
          id, at, String(p.cls || ''), p.team | 0, rp, win, +p.share || 0,
          meta.dragonKilled ? 1 : 0, meta.night ? 1 : 0, String(meta.reason || '').slice(0, 40));
        const u = this._user(id);
        out.push({ name, team: p.team, rp, totalRp: u.rp, matches: u.matches, wins: u.wins, rank: rankOf(u.rp) });
      }
      this._mirrorSupabase();
      return Response.json(out);
    }

    // --- 個人戦績(本人のみ。Worker側でトークン検証済みのuidだけが渡ってくる) ---
    if (url.pathname === '/me') {
      const id = url.searchParams.get('uid') || '';
      const u = this._user(id);
      if (!u) return Response.json({ found: false });
      const byClass = this.sql.exec(
        `SELECT cls, COUNT(*) n, SUM(win) w, SUM(rp) rp, AVG(share) share FROM matches
         WHERE user_id=? AND cls<>'' GROUP BY cls ORDER BY n DESC`, id).toArray();
      const recent = this.sql.exec(
        `SELECT at, cls, team, rp, win, share, dragon, night, reason FROM matches
         WHERE user_id=? ORDER BY at DESC LIMIT 20`, id).toArray();
      const rankAbove = this.sql.exec(`SELECT COUNT(*) c FROM users WHERE rp > ?`, u.rp).toArray()[0].c;
      return Response.json({
        found: true, name: u.name, kind: u.kind, rp: u.rp, matches: u.matches, wins: u.wins,
        rank: rankOf(u.rp), placement: rankAbove + 1,
        byClass: byClass.map(r => ({ cls: r.cls, matches: r.n, wins: r.w, rp: r.rp, share: r.share })),
        recent,
      });
    }

    // --- 公開リーダーボード ---
    const top = this.sql.exec(
      `SELECT name, rp, matches, wins FROM users WHERE matches > 0 ORDER BY rp DESC LIMIT 100`).toArray();
    if (url.pathname === '/players.json' || url.pathname === '/leaderboard.json') {
      return Response.json(top.map((r, i) => ({ place: i + 1, ...r, rank: rankOf(r.rp) })));
    }
    const esc = s => String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    return new Response(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>夢幻の森 — 戦績</title>
<meta http-equiv="refresh" content="30"><style>
body{background:#0d1512;color:#e8e2d2;font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}
h1{color:#e0b64f;letter-spacing:.15em;font-size:20px}table{width:100%;border-collapse:collapse}
td,th{padding:8px 10px;border-bottom:1px solid #2c4038;text-align:left}th{color:#8fa598;font-weight:500;font-size:12px}
.rank{color:#5bc8b0;font-size:12px}.rp{color:#e0b64f;font-weight:700}
a{color:#5bc8b0}</style></head><body>
<h1>夢幻の森 — リーダーボード</h1>
<table><tr><th>#</th><th>名前</th><th>ランク</th><th>RP</th><th>戦績</th></tr>
${top.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.name)}</td><td class="rank">${rankOf(r.rp)}</td><td class="rp">${r.rp}</td><td>${r.matches}戦${r.wins}勝(${r.matches ? Math.round(r.wins / r.matches * 100) : 0}%)</td></tr>`).join('')}
</table><p style="color:#8fa598;font-size:12px">30秒ごとに自動更新 / JSON: <a href="/leaderboard.json">/leaderboard.json</a> / <a href="/">ゲームに戻る</a></p>
</body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // Supabase接続時はミラー(任意。テーブル players: name text pk, rp int, matches int, wins int)
  _mirrorSupabase() {
    const env = this.env;
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
    const rows = this.sql.exec(`SELECT name, rp, matches, wins FROM users`).toArray();
    this.ctx.waitUntil(fetch(`${env.SUPABASE_URL}/rest/v1/players`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    }).catch(e => console.error('[supabase]', e.message)));
  }
}
