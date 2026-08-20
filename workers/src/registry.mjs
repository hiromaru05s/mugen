// 夢幻の森 — Registry DO (シングルトン: idFromName('main'))
// 役割: (1) マッチメイキング=「今参加を受け付けているルーム名」のポインタ管理
//       (2) RP永続化(m3のdata/players.json相当をDOストレージに保存。SUPABASE_URL設定時はミラー)
//       (3) 戦績リーダーボードページ(/stats, /players.json — m3のport+1サーバーの統合)
'use strict';
import { DurableObject } from 'cloudflare:workers';
import { rankOf } from './shared.mjs';

export class Registry extends DurableObject {
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
      // ルームがロック(開始)されたら次のルーム名へ進める。冪等: 既に進んでいれば何もしない
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

    // --- RP永続化 ---
    if (url.pathname === '/rp') {
      const db = (await storage.get('players')) || {};
      const rec = db[url.searchParams.get('name') || ''] || { rp: 0 };
      return Response.json({ rp: rec.rp || 0 });
    }
    if (url.pathname === '/record' && request.method === 'POST') {
      const humans = await request.json(); // [{name, team, rp, win}]
      const db = (await storage.get('players')) || {};
      const players = [];
      for (const h of humans) {
        const name = String(h.name || 'player').slice(0, 12);
        const rec = db[name] = db[name] || { rp: 0, matches: 0, wins: 0 };
        rec.rp += Math.max(0, Math.round(+h.rp || 0)); rec.matches++; if (h.win) rec.wins++;
        players.push({ name, team: h.team, rp: h.rp, totalRp: rec.rp, matches: rec.matches, wins: rec.wins, rank: rankOf(rec.rp) });
      }
      if (humans.length) {
        await storage.put('players', db);
        this._mirrorSupabase(db);
      }
      return Response.json(players);
    }
    if (url.pathname === '/players.json') {
      return Response.json((await storage.get('players')) || {});
    }

    // --- 戦績ページ(/ と /stats) ---
    const db = (await storage.get('players')) || {};
    const rows = Object.entries(db).map(([name, v]) => ({ name, ...v }))
      .sort((a, b) => b.rp - a.rp).slice(0, 100);
    return new Response(`<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><title>夢幻の森 — 戦績</title>
<meta http-equiv="refresh" content="30"><style>
body{background:#0d1512;color:#e8e2d2;font-family:system-ui,sans-serif;max-width:640px;margin:40px auto;padding:0 16px}
h1{color:#e0b64f;letter-spacing:.15em}table{width:100%;border-collapse:collapse}
td,th{padding:8px 10px;border-bottom:1px solid #2c4038;text-align:left}th{color:#8fa598;font-weight:500}
.rank{color:#5bc8b0}.rp{color:#e0b64f;font-weight:700}</style></head><body>
<h1>夢幻の森 — リーダーボード</h1>
<table><tr><th>#</th><th>名前</th><th>ランク</th><th>RP</th><th>戦績</th></tr>
${rows.map((r, i) => `<tr><td>${i + 1}</td><td>${String(r.name).replace(/[<>&]/g, '')}</td><td class="rank">${rankOf(r.rp)}</td><td class="rp">${r.rp}</td><td>${r.matches}戦${r.wins}勝(${r.matches ? Math.round(r.wins / r.matches * 100) : 0}%)</td></tr>`).join('')}
</table><p style="color:#8fa598;font-size:12px">30秒ごとに自動更新 / JSON: /players.json</p></body></html>`,
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  // Supabase接続時はミラー(テーブル players: name text pk, rp int, matches int, wins int)
  _mirrorSupabase(db) {
    const env = this.env;
    if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
    const rows = Object.entries(db).map(([name, v]) => ({ name, ...v }));
    this.ctx.waitUntil(fetch(`${env.SUPABASE_URL}/rest/v1/players`, {
      method: 'POST',
      headers: { apikey: env.SUPABASE_KEY, Authorization: `Bearer ${env.SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
      body: JSON.stringify(rows),
    }).catch(e => console.error('[supabase]', e.message)));
  }
}
