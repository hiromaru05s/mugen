// 夢幻の森 M0 サーバー — Colyseus 20Hz サーバー権威 (SPEC §0/§6 M0)
// 範囲: 移動同期 / チーム視界フィルタ(見えない敵は送信しない) / 狼モブ1種FSM / 近接の殴り合い / 6人
// 意図的にM0でやらないこと: スキーマ差分同期(M1でschema化)・スキル・成長・ドラゴン
'use strict';
const { Server, Room } = require('colyseus');

/* ================= ワールド定数(プロトタイプ準拠・縮小版) ================= */
const CFG = {
  mapR: 900, tick: 1 / 20, spd: 150, hp: 300,
  atk: 26, atkCd: 0.7, range: 46, arc: 1.1,
  viewR: 750, revealAtk: 1.4, revealHit: 0.8,
  treeCount: 60, bushCount: 24, mobCount: 8,
  respawnSec: 3,
};
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
const polar = (r, th) => ({ x: Math.cos(th) * r, y: Math.sin(th) * r });

/* ================= 視界ルール(SPEC §2.5 — プロトタイプと同一の数式) ================= */
function bushOf(world, u) { for (const b of world.bushes) if (dist(u, b) < b.r) return b; return null; }
function losBlocked(world, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  if (!L2) return false;
  for (const t of world.trees) {
    let s = ((t.x - a.x) * dx + (t.y - a.y) * dy) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
    const px = a.x + s * dx - t.x, py = a.y + s * dy - t.y;
    if (px * px + py * py < t.r * t.r) return true;
  }
  return false;
}
// viewerTeam から unit u が見えるか
function seenBy(world, units, team, u) {
  if (u.revealT > 0) return true;
  const b = bushOf(world, u);
  for (const v of units.values()) {
    if (v.team !== team || v.dead) continue;
    if (dist(v, u) >= CFG.viewR) continue;
    if (b ? dist(v, b) < b.r + 24 : !losBlocked(world, v, u)) return true;
  }
  return false;
}

/* ================= ルーム ================= */
class ForestRoom extends Room {
  onCreate() {
    this.maxClients = 6;
    this.setPatchRate(0); // M0はschema patchを使わず視界フィルタ済みスナップショットを毎tick送る
    this.world = this.makeWorld();
    this.units = new Map();   // sessionId -> unit
    this.nextTeam = 0;
    this.t = 0;
    // クライアントはハンドラ登録後に 'ready' を送る → ここでinitを返す(join直後のレース回避)
    this.onMessage('ready', (client) => {
      const u = this.units.get(client.sessionId);
      if (!u) return;
      client.send('init', { id: u.id, team: u.team, mapR: CFG.mapR, trees: this.world.trees, bushes: this.world.bushes, cfg: { spd: CFG.spd, range: CFG.range } });
    });
    this.onMessage('input', (client, msg) => {
      const u = this.units.get(client.sessionId);
      if (!u || typeof msg !== 'object' || msg === null) return;
      // 入力は方向とボタンのみ(座標もHPも受け取らない=サーバー権威)
      u.input = {
        mx: Math.max(-1, Math.min(1, +msg.mx || 0)),
        my: Math.max(-1, Math.min(1, +msg.my || 0)),
        atk: !!msg.atk,
        aim: typeof msg.aim === 'number' && isFinite(msg.aim) ? msg.aim : u.facing,
      };
    });
    this.setSimulationInterval(() => this.tick(CFG.tick), 1000 * CFG.tick); // 20Hz固定
    console.log('[forest] room created', this.roomId);
  }

  makeWorld() {
    const trees = [], bushes = [];
    for (let i = 0; i < CFG.treeCount; i++) { const p = polar(rnd(150, CFG.mapR - 60), rnd(0, 7)); trees.push({ x: p.x, y: p.y, r: rnd(16, 30) }); }
    for (let i = 0; i < CFG.bushCount; i++) { const p = polar(rnd(120, CFG.mapR - 80), rnd(0, 7)); bushes.push({ x: p.x, y: p.y, r: rnd(34, 52) }); }
    const mobs = [];
    for (let i = 0; i < CFG.mobCount; i++) {
      const p = polar(rnd(200, CFG.mapR - 120), rnd(0, 7));
      mobs.push({ id: 'm' + i, x: p.x, y: p.y, home: { x: p.x, y: p.y }, r: 14, hp: 90, maxHp: 90, atk: 12, spd: 110, tAtk: 0, tele: null, state: 'idle' });
    }
    return { trees, bushes, mobs };
  }

  onJoin(client, options) {
    const team = this.nextTeam++ % 2; // 6人=3v3
    const base = polar(CFG.mapR - 120, team === 0 ? Math.PI / 4 : Math.PI + Math.PI / 4);
    const u = {
      id: client.sessionId, name: (options && String(options.name || '').slice(0, 12)) || 'player',
      team, x: base.x + rnd(-40, 40), y: base.y + rnd(-40, 40), r: 15,
      hp: CFG.hp, maxHp: CFG.hp, facing: 0, atkT: 0, revealT: 0, dead: false, respawnT: 0,
      input: { mx: 0, my: 0, atk: false, aim: 0 },
    };
    this.units.set(client.sessionId, u);
    console.log('[forest] join', client.sessionId, 'team', team);
  }

  onLeave(client) { this.units.delete(client.sessionId); }

  tick(dt) {
    this.t += dt;
    const units = [...this.units.values()];
    // --- プレイヤー
    for (const u of units) {
      u.atkT -= dt; u.revealT -= dt;
      if (u.dead) {
        u.respawnT -= dt;
        if (u.respawnT <= 0) { // リスポーン(M0: 殴り合い検証用)
          const base = polar(CFG.mapR - 120, u.team === 0 ? Math.PI / 4 : Math.PI + Math.PI / 4);
          u.dead = false; u.hp = u.maxHp; u.x = base.x; u.y = base.y; u.revealT = 0;
        }
        continue;
      }
      const inp = u.input;
      const l = Math.hypot(inp.mx, inp.my);
      if (l > 0) { u.x += inp.mx / l * CFG.spd * dt; u.y += inp.my / l * CFG.spd * dt; u.facing = Math.atan2(inp.my, inp.mx); }
      if (inp.atk && u.atkT <= 0) this.doAttack(u, inp.aim);
      this.collide(u);
    }
    // --- モブFSM: 徘徊→索敵(視界ルール準拠)→交戦→リーシュ帰還
    for (const m of this.world.mobs) {
      if (m.hp <= 0) continue;
      m.tAtk -= dt;
      if (m.tele) { m.tele.t -= dt; if (m.tele.t <= 0) {
        for (const u of units) if (!u.dead && dist(u, m.tele) < m.tele.r + u.r) this.damage(m, u, m.atk);
        m.tele = null; } }
      const near = units.filter(u => !u.dead && dist(m, u) < 140 &&
        (u.revealT > 0 || (!bushOf(this.world, u) && !losBlocked(this.world, m, u))))
        .sort((a, b) => dist(m, a) - dist(m, b))[0];
      if (near) {
        m.state = 'chase';
        const d = dist(m, near);
        if (d > 34) { const a = ang(m, near); m.x += Math.cos(a) * m.spd * dt; m.y += Math.sin(a) * m.spd * dt; }
        else if (m.tAtk <= 0 && !m.tele) { m.tAtk = 1.6; m.tele = { x: near.x, y: near.y, r: 34, t: .5 }; }
      } else if (dist(m, m.home) > 30) { m.state = 'leash'; const a = ang(m, m.home); m.x += Math.cos(a) * m.spd * .6 * dt; m.y += Math.sin(a) * m.spd * .6 * dt; }
      else m.state = 'idle';
    }
    this.broadcastSnapshots(units);
  }

  doAttack(u, aim) {
    u.atkT = CFG.atkCd;
    u.facing = aim;
    u.revealT = Math.max(u.revealT, CFG.revealAtk); // 攻撃で露見
    // 近接アーク(当たり判定は視界と独立 — ブラインド攻撃は当たる)
    for (const h of this.units.values()) {
      if (h.team === u.team || h.dead) continue;
      if (dist(u, h) < CFG.range + h.r && Math.abs(angleDiff(ang(u, h), aim)) < CFG.arc) this.damage(u, h, CFG.atk);
    }
    for (const m of this.world.mobs) {
      if (m.hp <= 0) continue;
      if (dist(u, m) < CFG.range + m.r && Math.abs(angleDiff(ang(u, m), aim)) < CFG.arc) { m.hp -= CFG.atk; }
    }
    this.broadcast('fx', { kind: 'swing', x: u.x, y: u.y, dir: aim, team: u.team });
  }

  damage(src, tgt, amt) {
    if (tgt.dead) return;
    tgt.hp -= amt;
    tgt.revealT = Math.max(tgt.revealT, CFG.revealHit); // 被弾で露見
    if (tgt.hp <= 0) { tgt.dead = true; tgt.respawnT = CFG.respawnSec; }
  }

  broadcastSnapshots(units) {
    // チームごとに視界フィルタ済みスナップショットを構築(見えない敵は座標を送らない = SPEC §2)
    const mobsPub = this.world.mobs.filter(m => m.hp > 0)
      .map(m => ({ id: m.id, x: +m.x.toFixed(1), y: +m.y.toFixed(1), hp: m.hp, maxHp: m.maxHp, tele: m.tele ? { x: m.tele.x, y: m.tele.y, r: m.tele.r, t: +m.tele.t.toFixed(2) } : null }));
    const byTeam = {};
    for (const team of [0, 1]) {
      byTeam[team] = units.filter(u => u.team === team || (!u.dead && seenBy(this.world, this.units, team, u)))
        .map(u => ({ id: u.id, team: u.team, x: +u.x.toFixed(1), y: +u.y.toFixed(1), hp: Math.round(u.hp), maxHp: u.maxHp, facing: +u.facing.toFixed(2), dead: u.dead, reveal: u.revealT > 0 }));
    }
    for (const client of this.clients) {
      const me = this.units.get(client.sessionId);
      if (!me) continue;
      client.send('snap', { t: +this.t.toFixed(3), units: byTeam[me.team], mobs: mobsPub });
    }
  }

  collide(u) {
    for (const t of this.world.trees) {
      const d = dist(u, t), min = t.r + u.r;
      if (d < min && d > 0) { const a = ang(t, u); u.x = t.x + Math.cos(a) * min; u.y = t.y + Math.sin(a) * min; }
    }
    const rr = Math.hypot(u.x, u.y);
    if (rr > CFG.mapR) { const a = Math.atan2(u.y, u.x); u.x = Math.cos(a) * CFG.mapR; u.y = Math.sin(a) * CFG.mapR; }
  }
}

const port = Number(process.env.PORT || 2567);
const gameServer = new Server();
gameServer.define('forest', ForestRoom);
gameServer.listen(port).then(() => console.log(`[forest] listening on ws://localhost:${port}`));
