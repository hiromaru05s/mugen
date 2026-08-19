// 夢幻の森 M1 サーバー — スキルプリミティブ(データ駆動) + 5職×4スキル (SPEC §4/§6 M1)
// M0からの追加: マナ / スキル実行プリミティブ / 状態異常(スタン・シールド・毒・マーク) /
// 壁(射線遮蔽サモン) / 煙幕(隠蔽ゾーン) / 罠 / 弾・ゾーンのサーバーシミュレーション
'use strict';
const { Server, Room } = require('colyseus');

/* ================= 定数 ================= */
const CFG = {
  mapR: 900, tick: 1 / 20, viewR: 750, revealAtk: 1.4, revealHit: 0.8,
  treeCount: 60, bushCount: 24, mobCount: 8, respawnSec: 4,
  castRange: 380, mpMax: 100, mpRegen: 6,
};
const CLASSES = {
  warrior: { hp: 340, spd: 150, range: 46, atk: 26, atkCd: .7 },
  mage:    { hp: 230, spd: 145, range: 330, atk: 30, atkCd: .9, projSpd: 430, projR: 7 },
  thief:   { hp: 250, spd: 165, range: 44, atk: 24, atkCd: .55 },
  priest:  { hp: 260, spd: 140, range: 40, atk: 10, atkCd: .9 },
  ranger:  { hp: 210, spd: 150, range: 430, atk: 38, atkCd: 1.25, projSpd: 560, projR: 5 },
};

/* ================= スキル定義(データ駆動 — SPEC §4: 実行プリミティブ×JSON) ================= */
const SKILLS = {
  warrior: {
    1: { jp: '突進',   cd: 6,  mp: 15, fx: [{ type: 'dash', spd: 620, dur: .22, impactMul: 1.2 }] },
    2: { jp: '咆哮',   cd: 11, mp: 20, fx: [{ type: 'modifyStat', stat: 'buff', dur: 5, radius: 170 }] },
    3: { jp: '盾打',   cd: 10, mp: 20, fx: [{ type: 'meleeArc', range: 70, arc: 1.0, dmgMul: .8, status: { stun: 1.2 } }] },
    4: { jp: '大斬撃', cd: 14, mp: 30, fx: [{ type: 'meleeArc', range: 72, arc: 1.7, dmgMul: 2 }] },
  },
  mage: {
    1: { jp: 'ブリンク', cd: 7,  mp: 20, fx: [{ type: 'teleport', maxDist: 180 }] },
    2: { jp: '減速域',   cd: 10, mp: 25, fx: [{ type: 'zone', kind: 'slow', r: 95, life: 4 }] },
    3: { jp: '魔氷壁',   cd: 14, mp: 30, fx: [{ type: 'summonWall', count: 3, gap: 40, r: 20, life: 4.5, maxDist: 200 }] },
    4: { jp: '爆裂',     cd: 9,  mp: 35, fx: [{ type: 'zone', kind: 'nuke', r: 85, tele: .6, dmg: 90 }] },
  },
  thief: {
    1: { jp: '罠',   cd: 8,  mp: 20, fx: [{ type: 'summonTrap', r: 26, life: 40, dmg: 55, slow: 1.8 }] },
    2: { jp: '隠密', cd: 12, mp: 25, fx: [{ type: 'stealth', dur: 4 }] },
    3: { jp: '検知', cd: 14, mp: 20, fx: [{ type: 'revealEnemies', radius: 450, dur: 3 }] },
    4: { jp: '毒刃', cd: 10, mp: 15, fx: [{ type: 'venom', charges: 3, dot: 9, dur: 3 }] },
  },
  priest: {
    1: { jp: '祝福',   cd: 9,  mp: 25, fx: [{ type: 'healAllies', amount: 90, radius: 170 }] },
    2: { jp: '聖域',   cd: 14, mp: 30, fx: [{ type: 'zone', kind: 'heal', r: 90, life: 4, hps: 22 }] },
    3: { jp: '聖障壁', cd: 16, mp: 30, fx: [{ type: 'modifyStat', stat: 'shield', dur: 4, radius: 170 }] },
    4: { jp: '天光',   cd: 12, mp: 25, fx: [{ type: 'healLowest', amount: 180 }] },
  },
  ranger: {
    1: { jp: '狙撃',   cd: 10, mp: 25, fx: [{ type: 'projectile', spd: 700, r: 5, dmgMul: 2.2, selfReveal: 1.4 }] },
    2: { jp: '跳躍',   cd: 9,  mp: 15, fx: [{ type: 'dash', spd: 830, dur: .18, back: true }] },
    3: { jp: 'マーク', cd: 12, mp: 15, fx: [{ type: 'markTarget', pickR: 120, dur: 12 }] },
    4: { jp: '煙幕',   cd: 16, mp: 25, fx: [{ type: 'zone', kind: 'smoke', r: 80, life: 5, atSelf: true }] },
  },
};

/* ================= math ================= */
const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
const polar = (r, th) => ({ x: Math.cos(th) * r, y: Math.sin(th) * r });

/* ================= ルーム ================= */
class ForestRoom extends Room {
  onCreate() {
    this.maxClients = 6;
    this.setPatchRate(0);
    this.world = this.makeWorld();
    this.units = new Map();
    this.projs = []; this.zones = []; this.walls = []; this.traps = [];
    this.nextTeam = 0; this.t = 0;
    this.onMessage('ready', (client) => {
      const u = this.units.get(client.sessionId); if (!u) return;
      client.send('init', {
        id: u.id, team: u.team, cls: u.cls, mapR: CFG.mapR,
        trees: this.world.trees, bushes: this.world.bushes,
        stats: CLASSES[u.cls],
        skills: [1, 2, 3, 4].map(n => ({ n, jp: SKILLS[u.cls][n].jp, cd: SKILLS[u.cls][n].cd, mp: SKILLS[u.cls][n].mp })),
      });
    });
    this.onMessage('input', (client, msg) => {
      const u = this.units.get(client.sessionId);
      if (!u || typeof msg !== 'object' || msg === null) return;
      u.input = {
        mx: Math.max(-1, Math.min(1, +msg.mx || 0)),
        my: Math.max(-1, Math.min(1, +msg.my || 0)),
        atk: !!msg.atk,
        aim: typeof msg.aim === 'number' && isFinite(msg.aim) ? msg.aim : u.facing,
      };
    });
    this.onMessage('cast', (client, msg) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || typeof msg !== 'object' || msg === null) return;
      const slot = [1, 2, 3, 4].includes(+msg.slot) ? +msg.slot : 0;
      if (!slot) return;
      // ターゲット座標はサーバーが射程内にクランプ(不正座標対策)
      let tx = isFinite(+msg.tx) ? +msg.tx : u.x, ty = isFinite(+msg.ty) ? +msg.ty : u.y;
      const d = Math.hypot(tx - u.x, ty - u.y);
      if (d > CFG.castRange) { tx = u.x + (tx - u.x) / d * CFG.castRange; ty = u.y + (ty - u.y) / d * CFG.castRange; }
      this.castSkill(u, slot, tx, ty);
    });
    this.setSimulationInterval(() => this.tick(CFG.tick), 1000 * CFG.tick);
    console.log('[forest:m1] room created', this.roomId);
  }

  makeWorld() {
    const trees = [], bushes = [], mobs = [];
    for (let i = 0; i < CFG.treeCount; i++) { const p = polar(rnd(150, CFG.mapR - 60), rnd(0, 7)); trees.push({ x: p.x, y: p.y, r: rnd(16, 30) }); }
    for (let i = 0; i < CFG.bushCount; i++) { const p = polar(rnd(120, CFG.mapR - 80), rnd(0, 7)); bushes.push({ x: p.x, y: p.y, r: rnd(34, 52) }); }
    for (let i = 0; i < CFG.mobCount; i++) {
      const p = polar(rnd(200, CFG.mapR - 120), rnd(0, 7));
      mobs.push({ id: 'm' + i, x: p.x, y: p.y, home: { x: p.x, y: p.y }, r: 14, hp: 90, maxHp: 90, atk: 12, spd: 110, tAtk: 0, tele: null });
    }
    return { trees, bushes, mobs };
  }

  onJoin(client, options) {
    const team = this.nextTeam++ % 2;
    const cls = CLASSES[options && options.cls] ? options.cls : 'warrior';
    const C = CLASSES[cls];
    const base = polar(CFG.mapR - 120, team === 0 ? Math.PI / 4 : Math.PI + Math.PI / 4);
    this.units.set(client.sessionId, {
      id: client.sessionId, team, cls,
      x: base.x + rnd(-40, 40), y: base.y + rnd(-40, 40), r: 15,
      hp: C.hp, maxHp: C.hp, mp: CFG.mpMax, facing: 0, atkT: 0,
      s1T: 0, s2T: 0, s3T: 0, s4T: 0,
      revealT: 0, stealth: 0, slowT: 0, buffT: 0, shieldT: 0, markT: 0, stunT: 0, poisonT: 0, poisonSrc: null, venom: 0,
      dash: null, dead: false, respawnT: 0,
      input: { mx: 0, my: 0, atk: false, aim: 0 },
    });
    console.log('[forest:m1] join', client.sessionId, 'team', team, cls);
  }
  onLeave(client) { this.units.delete(client.sessionId); }

  /* ---------- 視界 (プロトタイプ§2.5と同一ルール + 煙幕) ---------- */
  bushOf(u) { for (const b of this.world.bushes) if (dist(u, b) < b.r) return b; return null; }
  smokeOf(u) { for (const z of this.zones) if (z.kind === 'smoke' && dist(u, z) < z.r) return z; return null; }
  losBlocked(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
    if (!L2) return false;
    for (const arr of [this.world.trees, this.walls]) for (const t of arr) {
      let s = ((t.x - a.x) * dx + (t.y - a.y) * dy) / L2; s = s < 0 ? 0 : s > 1 ? 1 : s;
      const px = a.x + s * dx - t.x, py = a.y + s * dy - t.y;
      if (px * px + py * py < t.r * t.r) return true;
    }
    return false;
  }
  seenBy(team, u) {
    if (u.stealth > 0) return false;             // 隠密は視界ルールの上位
    if (u.revealT > 0 || u.markT > 0) return true;
    const cover = this.bushOf(u) || this.smokeOf(u);
    for (const v of this.units.values()) {
      if (v.team !== team || v.dead) continue;
      if (dist(v, u) >= CFG.viewR) continue;
      if (cover ? dist(v, cover) < cover.r + 24 : !this.losBlocked(v, u)) return true;
    }
    return false;
  }

  /* ---------- スキル実行プリミティブ ---------- */
  castSkill(u, slot, tx, ty) {
    const S = SKILLS[u.cls][slot];
    if (!S || u['s' + slot + 'T'] > 0 || u.stunT > 0 || u.mp < S.mp) return;
    u['s' + slot + 'T'] = S.cd; u.mp -= S.mp;
    const dir = Math.atan2(ty - u.y, tx - u.x) || u.facing;
    for (const fx of S.fx) this.runFx(u, fx, dir, tx, ty);
    this.broadcast('fx', { kind: 'cast', cls: u.cls, slot, x: u.x, y: u.y, tx, ty });
  }
  runFx(u, fx, dir, tx, ty) {
    const C = CLASSES[u.cls], atk = this.atkOf(u);
    switch (fx.type) {
      case 'dash':
        u.dash = { dir: fx.back ? dir + Math.PI : dir, spd: fx.spd, t: fx.dur, impactMul: fx.impactMul || 0 };
        u.stealth = 0; break;
      case 'teleport': {
        const d = Math.min(fx.maxDist, Math.hypot(tx - u.x, ty - u.y) || fx.maxDist);
        u.x += Math.cos(dir) * d; u.y += Math.sin(dir) * d; this.collide(u); break; }
      case 'projectile':
        this.projs.push({ x: u.x, y: u.y, vx: Math.cos(dir) * fx.spd, vy: Math.sin(dir) * fx.spd, r: fx.r, life: 1.1, src: u, dmg: atk * fx.dmgMul, snipe: true });
        if (fx.selfReveal) u.revealT = Math.max(u.revealT, fx.selfReveal); break;
      case 'meleeArc':
        u.revealT = Math.max(u.revealT, CFG.revealAtk);
        for (const h of this.hostilesOf(u)) {
          if (dist(u, h) < fx.range + h.r && Math.abs(angleDiff(ang(u, h), dir)) < fx.arc) {
            this.damage(u, h, atk * fx.dmgMul);
            if (fx.status && fx.status.stun && h.stunT !== undefined) h.stunT = Math.max(h.stunT, fx.status.stun);
          }
        } break;
      case 'zone': {
        const zx = fx.atSelf ? u.x : tx, zy = fx.atSelf ? u.y : ty;
        this.zones.push({ x: zx, y: zy, r: fx.r, team: u.team, kind: fx.kind, life: fx.life || fx.tele || 1, tele: fx.tele || 0, dmg: fx.dmg || 0, hps: fx.hps || 0, src: u }); break; }
      case 'summonWall': {
        const wd = Math.min(fx.maxDist, Math.hypot(tx - u.x, ty - u.y) || 120);
        const px = u.x + Math.cos(dir) * wd, py = u.y + Math.sin(dir) * wd;
        for (let i = -(fx.count >> 1); i <= (fx.count >> 1); i++)
          this.walls.push({ x: px + Math.cos(dir + Math.PI / 2) * i * fx.gap, y: py + Math.sin(dir + Math.PI / 2) * i * fx.gap, r: fx.r, life: fx.life });
        break; }
      case 'summonTrap': this.traps.push({ x: u.x, y: u.y, r: fx.r, team: u.team, src: u, life: fx.life, dmg: fx.dmg, slow: fx.slow }); break;
      case 'stealth': u.stealth = fx.dur; break;
      case 'revealEnemies':
        for (const h of this.units.values()) if (h.team !== u.team && !h.dead && dist(u, h) < fx.radius) h.revealT = Math.max(h.revealT, fx.dur);
        break;
      case 'markTarget': {
        let bt = null, bd = 1e9;
        for (const h of this.units.values()) {
          if (h.team === u.team || h.dead || !this.seenBy(u.team, h)) continue;
          const d2 = Math.hypot(h.x - tx, h.y - ty);
          if (d2 < fx.pickR && d2 < bd) { bd = d2; bt = h; }
        }
        if (bt) bt.markT = fx.dur;
        else { u['s3T'] = 1; u.mp += SKILLS[u.cls][3].mp; } // 空撃ちは返金
        break; }
      case 'modifyStat':
        for (const a of this.units.values()) if (a.team === u.team && !a.dead && dist(a, u) < fx.radius) {
          if (fx.stat === 'buff') a.buffT = fx.dur;
          if (fx.stat === 'shield') a.shieldT = fx.dur;
        } break;
      case 'healAllies':
        for (const a of this.units.values()) if (a.team === u.team && !a.dead && dist(a, u) < fx.radius) a.hp = Math.min(a.maxHp, a.hp + fx.amount);
        break;
      case 'healLowest': {
        let m = null; for (const a of this.units.values()) if (a.team === u.team && !a.dead && (!m || a.hp / a.maxHp < m.hp / m.maxHp)) m = a;
        if (m) m.hp = Math.min(m.maxHp, m.hp + fx.amount); break; }
      case 'venom': u.venom = fx.charges; u.venomDot = fx.dot; u.venomDur = fx.dur; break;
    }
  }
  atkOf(u) { return CLASSES[u.cls].atk * (u.buffT > 0 ? 1.3 : 1); }
  spdOf(u) { return CLASSES[u.cls].spd * (u.slowT > 0 ? .55 : 1); }
  hostilesOf(u) {
    const hs = [];
    for (const h of this.units.values()) if (h.team !== u.team && !h.dead && h.stealth <= 0) hs.push(h);
    for (const m of this.world.mobs) if (m.hp > 0) hs.push(m);
    return hs;
  }

  /* ---------- tick ---------- */
  tick(dt) {
    this.t += dt;
    const units = [...this.units.values()];
    for (const u of units) {
      u.atkT -= dt; u.s1T -= dt; u.s2T -= dt; u.s3T -= dt; u.s4T -= dt;
      u.revealT -= dt; u.stealth -= dt; u.slowT -= dt; u.buffT -= dt; u.shieldT -= dt; u.markT -= dt; u.stunT -= dt;
      u.mp = Math.min(CFG.mpMax, u.mp + CFG.mpRegen * dt);
      if (u.poisonT > 0) { u.poisonT -= dt; u.hp -= 9 * dt; if (u.hp <= 0 && !u.dead) this.kill(u); }
      if (u.dead) { u.respawnT -= dt; if (u.respawnT <= 0) this.respawn(u); continue; }
      if (u.dash) {
        u.x += Math.cos(u.dash.dir) * u.dash.spd * dt; u.y += Math.sin(u.dash.dir) * u.dash.spd * dt;
        u.dash.t -= dt;
        if (u.dash.t <= 0) {
          if (u.dash.impactMul) for (const h of this.hostilesOf(u)) if (dist(u, h) < 60) this.damage(u, h, this.atkOf(u) * u.dash.impactMul);
          u.dash = null;
        }
      } else if (u.stunT <= 0) {
        const l = Math.hypot(u.input.mx, u.input.my);
        if (l > 0) { u.x += u.input.mx / l * this.spdOf(u) * dt; u.y += u.input.my / l * this.spdOf(u) * dt; u.facing = Math.atan2(u.input.my, u.input.mx); }
        if (u.input.atk && u.atkT <= 0) this.doAttack(u, u.input.aim);
      }
      // ゾーン効果
      for (const z of this.zones) {
        if (z.tele > 0) continue;
        if (z.kind === 'slow' && z.team !== u.team && dist(u, z) < z.r) u.slowT = Math.max(u.slowT, .3);
        if (z.kind === 'heal' && z.team === u.team && dist(u, z) < z.r) u.hp = Math.min(u.maxHp, u.hp + z.hps * dt);
      }
      // 罠
      for (const tr of this.traps) {
        if (tr.team === u.team || dist(u, tr) >= tr.r) continue;
        tr.life = 0; this.damage(tr.src, u, tr.dmg); u.slowT = Math.max(u.slowT, tr.slow);
      }
      this.collide(u);
    }
    // 弾
    this.projs = this.projs.filter(pr => {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.life <= 0) return false;
      for (const arr of [this.world.trees, this.walls]) for (const t of arr) if (dist(pr, t) < t.r) return false;
      for (const h of this.hostilesOf(pr.src)) {
        if (dist(pr, h) < (h.r || 14) + pr.r) {
          if (h.maxHp && h.id && this.units.has(h.id)) this.damage(pr.src, h, pr.dmg);
          else { h.hp -= pr.dmg; } // mob
          return false;
        }
      }
      return true;
    });
    // ゾーン解決
    this.zones = this.zones.filter(z => {
      if (z.tele > 0) {
        z.tele -= dt;
        if (z.tele <= 0 && z.kind === 'nuke') {
          for (const u of units) if (!u.dead && u.team !== z.team && dist(u, z) < z.r + u.r) this.damage(z.src, u, z.dmg);
          for (const m of this.world.mobs) if (m.hp > 0 && dist(m, z) < z.r + m.r) m.hp -= z.dmg;
          return false;
        }
        return true;
      }
      z.life -= dt; return z.life > 0;
    });
    this.walls = this.walls.filter(w => (w.life -= dt) > 0);
    this.traps = this.traps.filter(tr => tr.life > 0 && (tr.life -= dt, tr.life > 0));
    // モブ
    for (const m of this.world.mobs) {
      if (m.hp <= 0) continue;
      m.tAtk -= dt;
      if (m.tele) { m.tele.t -= dt; if (m.tele.t <= 0) { for (const u of units) if (!u.dead && dist(u, m.tele) < m.tele.r + u.r) this.damage(m, u, m.atk); m.tele = null; } }
      const near = units.filter(u => !u.dead && u.stealth <= 0 && dist(m, u) < 140 &&
        (u.revealT > 0 || u.markT > 0 || (!this.bushOf(u) && !this.smokeOf(u) && !this.losBlocked(m, u))))
        .sort((a, b) => dist(m, a) - dist(m, b))[0];
      if (near) {
        const d = dist(m, near);
        if (d > 34) { const a = ang(m, near); m.x += Math.cos(a) * m.spd * dt; m.y += Math.sin(a) * m.spd * dt; }
        else if (m.tAtk <= 0 && !m.tele) { m.tAtk = 1.6; m.tele = { x: near.x, y: near.y, r: 34, t: .5 }; }
      } else if (dist(m, m.home) > 30) { const a = ang(m, m.home); m.x += Math.cos(a) * m.spd * .6 * dt; m.y += Math.sin(a) * m.spd * .6 * dt; }
    }
    this.broadcastSnapshots(units);
  }

  doAttack(u, aim) {
    const C = CLASSES[u.cls];
    u.atkT = C.atkCd; u.facing = aim;
    const wasStealth = u.stealth > 0; u.stealth = 0;
    u.revealT = Math.max(u.revealT, CFG.revealAtk);
    if (C.projSpd) {
      this.projs.push({ x: u.x, y: u.y, vx: Math.cos(aim) * C.projSpd, vy: Math.sin(aim) * C.projSpd, r: C.projR, life: 1.05, src: u, dmg: this.atkOf(u) });
    } else {
      for (const h of this.hostilesOf(u)) {
        if (dist(u, h) < C.range + (h.r || 14) && Math.abs(angleDiff(ang(u, h), aim)) < 1.1) {
          let d = this.atkOf(u);
          if (u.cls === 'thief') {
            const behind = Math.abs(angleDiff(h.facing || 0, ang(u, h))) < 1.2;
            if (behind || wasStealth) d *= 1.8;
            if (u.venom > 0) { u.venom--; if (h.poisonT !== undefined) { h.poisonT = u.venomDur; h.poisonSrc = u; } else d += 12; }
          }
          if (h.maxHp && h.id && this.units.has(h.id)) this.damage(u, h, d); else h.hp -= d;
        }
      }
    }
    this.broadcast('fx', { kind: 'swing', x: u.x, y: u.y, dir: aim, team: u.team });
  }

  damage(src, tgt, amt) {
    if (tgt.dead) return;
    if (tgt.shieldT > 0) amt *= .6;
    if (tgt.markT > 0) amt *= 1.15;
    tgt.hp -= amt;
    tgt.revealT = Math.max(tgt.revealT, CFG.revealHit);
    if (tgt.hp <= 0) this.kill(tgt);
  }
  kill(u) { u.dead = true; u.respawnT = CFG.respawnSec; u.dash = null; u.stealth = 0; }
  respawn(u) {
    const base = polar(CFG.mapR - 120, u.team === 0 ? Math.PI / 4 : Math.PI + Math.PI / 4);
    u.dead = false; u.hp = u.maxHp; u.mp = CFG.mpMax; u.x = base.x; u.y = base.y;
    u.revealT = 0; u.poisonT = 0; u.stunT = 0; u.markT = 0;
  }
  collide(u) {
    for (const arr of [this.world.trees, this.walls]) for (const t of arr) {
      const d = dist(u, t), min = t.r + u.r;
      if (d < min && d > 0) { const a = ang(t, u); u.x = t.x + Math.cos(a) * min; u.y = t.y + Math.sin(a) * min; }
    }
    const rr = Math.hypot(u.x, u.y);
    if (rr > CFG.mapR) { const a = Math.atan2(u.y, u.x); u.x = Math.cos(a) * CFG.mapR; u.y = Math.sin(a) * CFG.mapR; }
  }

  broadcastSnapshots(units) {
    const mobsPub = this.world.mobs.filter(m => m.hp > 0)
      .map(m => ({ id: m.id, x: +m.x.toFixed(1), y: +m.y.toFixed(1), hp: Math.round(m.hp), maxHp: m.maxHp, tele: m.tele ? { x: m.tele.x, y: m.tele.y, r: m.tele.r } : null }));
    const zonesPub = this.zones.map(z => ({ x: z.x, y: z.y, r: z.r, kind: z.kind, tele: +Math.max(0, z.tele).toFixed(2), team: z.team }));
    const wallsPub = this.walls.map(w => ({ x: +w.x.toFixed(1), y: +w.y.toFixed(1), r: w.r, life: +w.life.toFixed(2) }));
    const projsPub = this.projs.map(p => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), r: p.r, snipe: !!p.snipe, cls: p.src.cls }));
    const byTeam = {};
    for (const team of [0, 1]) {
      byTeam[team] = units
        .filter(u => u.team === team || (!u.dead && this.seenBy(team, u)))
        .map(u => ({
          id: u.id, team: u.team, cls: u.cls, x: +u.x.toFixed(1), y: +u.y.toFixed(1),
          hp: Math.round(u.hp), maxHp: u.maxHp, facing: +u.facing.toFixed(2), dead: u.dead,
          reveal: u.revealT > 0, stealth: u.team === team && u.stealth > 0, stun: u.stunT > 0, shield: u.shieldT > 0, mark: u.markT > 0,
        }));
    }
    const trapsByTeam = {};
    for (const team of [0, 1]) {
      trapsByTeam[team] = this.traps.filter(tr => {
        if (tr.team === team) return true;
        // 敵罠は「そのチームの盗賊が140px以内」で見える(盗賊パッシブ)
        for (const v of this.units.values()) if (v.team === team && !v.dead && v.cls === 'thief' && dist(v, tr) < 140) return true;
        return false;
      }).map(tr => ({ x: tr.x, y: tr.y, r: tr.r, own: tr.team === team }));
    }
    for (const client of this.clients) {
      const me = this.units.get(client.sessionId);
      if (!me) continue;
      client.send('snap', {
        t: +this.t.toFixed(3),
        units: byTeam[me.team], mobs: mobsPub, zones: zonesPub, walls: wallsPub, projs: projsPub, traps: trapsByTeam[me.team],
        me: { mp: Math.round(me.mp), cd: [1, 2, 3, 4].map(n => +Math.max(0, me['s' + n + 'T']).toFixed(1)) },
      });
    }
  }
}

const port = Number(process.env.PORT || 2568);
const gameServer = new Server();
gameServer.define('forest', ForestRoom);
gameServer.listen(port).then(() => console.log(`[forest:m1] listening on ws://localhost:${port}`));
