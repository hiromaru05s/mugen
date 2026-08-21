// 夢幻の森 — Cloudflare Workers版サーバー (m3/server/index.js の移植)
// 1試合 = 1つのDurable Object。ColyseusのRoom APIを薄いシム(下のRoomクラス)で模倣し、
// ゲームロジック(m3と同一)はほぼ無改変で載せている。
// m3との差分: RP永続化はRegistry DO(SQLiteストレージ)へ委譲 / config.jsonはバンドル同梱 /
// 通信はJSON {t:type, d:data} の素のWebSocket(クライアント側は public/net.js のシムが吸収)
'use strict';
import { DurableObject } from 'cloudflare:workers';
import { rankOf } from './shared.mjs';
import cfgFile from '../config.json';

const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/* ================= Colyseus Roomシム =================
 * m3コードが使うAPIだけを実装:
 * onCreate/onJoin/onLeave/onMessage/broadcast/lock/allowReconnection/
 * setSimulationInterval/setPatchRate/clock.setTimeout/disconnect/clients/maxClients
 * client: { sessionId, send(type,data) }
 */
class Room extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.env = env;
    this.clients = [];
    this._handlers = new Map();
    this._tokens = new Map();          // sessionId -> 再接続secret
    this._reconnectWaits = new Map();  // sessionId -> {client, resolve, reject}
    this._created = false;
    this.locked = false;
    this.maxClients = Infinity;
    this._sim = null;
    this.clock = { setTimeout: (fn, ms) => setTimeout(fn, ms) };
  }
  setPatchRate() { /* Schema同期は使わない */ }
  setSimulationInterval(fn, ms) { if (this._sim) clearInterval(this._sim); this._sim = setInterval(fn, ms); }
  onMessage(type, cb) { this._handlers.set(type, cb); }
  broadcast(type, data) { const s = JSON.stringify({ t: type, d: data }); for (const c of this.clients) c._raw(s); }
  lock() { // 開始後は参加不可 + マッチメイカーのポインタを次ルームへ
    if (this.locked) return;
    this.locked = true;
    this._registryFetch('POST', '/rotate', this.roomName || '').catch(() => {});
  }
  allowReconnection(client, seconds) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this._reconnectWaits.delete(client.sessionId); reject(new Error('reconnection timeout')); }, seconds * 1000);
      this._reconnectWaits.set(client.sessionId, {
        client,
        resolve: () => { clearTimeout(timer); this._reconnectWaits.delete(client.sessionId); resolve(client); },
        reject: (e) => { clearTimeout(timer); this._reconnectWaits.delete(client.sessionId); reject(e || new Error('cancelled')); },
      });
    });
  }
  disconnect() { // ルーム解散
    for (const c of [...this.clients]) { try { c._ws.close(1000, 'room disposed'); } catch { /* noop */ } }
    this._dispose();
  }
  _dispose() {
    if (this._sim) { clearInterval(this._sim); this._sim = null; }
    for (const w of [...this._reconnectWaits.values()]) w.reject(new Error('room disposed'));
    this._reconnectWaits.clear();
    this.clients = [];
    this._tokens.clear();
    this._handlers.clear();
    this._created = false; // 次のjoinでonCreateからやり直せる(DOは使い回される)
  }
  async _registryFetch(method, path, body) {
    const reg = this.env.REGISTRY.get(this.env.REGISTRY.idFromName('main'));
    const res = await reg.fetch('https://registry' + path, { method, body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined });
    if (!res.ok) throw new Error('registry ' + res.status);
    return res;
  }
  _mkClient(ws, sessionId) {
    const client = {
      sessionId, _ws: ws,
      send(type, data) { try { client._ws.send(JSON.stringify({ t: type, d: data })); } catch { /* noop */ } },
      _raw(s) { try { client._ws.send(s); } catch { /* noop */ } },
    };
    return client;
  }
  _attach(client, ws) {
    client._ws = ws;
    ws.addEventListener('message', ev => {
      if (client._ws !== ws) return; // 再接続で置き換わった旧ソケット
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      const h = this._handlers.get(m && m.t);
      if (h) { try { h(client, m.d); } catch (e) { console.error('[room] handler', m && m.t, e); } }
    });
    let goneOnce = false; // closeとerrorは両方発火しうる — onLeaveの二重実行を防ぐ
    const gone = () => { if (goneOnce) return; goneOnce = true; this._onSocketGone(client, ws); };
    ws.addEventListener('close', gone);
    ws.addEventListener('error', gone);
  }
  async _onSocketGone(client, ws) {
    if (client._ws !== ws) return; // すでに新ソケットへ再接続済み
    const i = this.clients.indexOf(client);
    if (i >= 0) this.clients.splice(i, 1);
    try { await this.onLeave(client, false); } catch { /* 再接続タイムアウト等 */ }
    // ロビーで全員去ったら片付ける(試合中はBot代行で継続、終了後はdisconnectタイマーが処理)
    if (this._created && this.clients.length === 0 && this.phase === 'lobby') this._dispose();
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (request.headers.get('Upgrade') !== 'websocket') return new Response('websocket expected', { status: 426 });
    if (url.pathname === '/reconnect') return this._handleReconnect(url);
    // 新規join
    if (!this._created) {
      this._created = true;
      this.roomName = url.searchParams.get('room') || 'forest';
      this.roomId = this.roomName;
      this.onCreate();
    }
    if (this.locked || this.phase !== 'lobby' || this.clients.length >= this.maxClients)
      return new Response('room locked', { status: 409 }); // Worker側が次ルームへ回す
    let opts = {}; try { opts = JSON.parse(url.searchParams.get('opts') || '{}'); } catch { /* noop */ }
    // Worker側で検証済みの本人情報(Clerk sub / 端末トークン)。DOはここを信頼する
    opts.uid = url.searchParams.get('uid') || '';
    opts.kind = url.searchParams.get('kind') || 'guest';
    const pair = new WebSocketPair();
    const [browserEnd, serverEnd] = Object.values(pair);
    serverEnd.accept();
    const sessionId = rid(), secret = rid();
    this._tokens.set(sessionId, secret);
    const client = this._mkClient(serverEnd, sessionId);
    this._attach(client, serverEnd);
    this.clients.push(client);
    try { this.onJoin(client, opts); } catch (e) { console.error('[room] onJoin', e); }
    client.send('joined', { sessionId, reconnectionToken: `${this.roomName}.${sessionId}.${secret}` });
    return new Response(null, { status: 101, webSocket: browserEnd });
  }
  _handleReconnect(url) {
    const token = url.searchParams.get('token') || '';
    const [, sessionId, secret] = token.split('.');
    const wait = this._reconnectWaits.get(sessionId);
    if (!wait || !secret || this._tokens.get(sessionId) !== secret)
      return new Response('reconnection expired', { status: 409 });
    const pair = new WebSocketPair();
    const [browserEnd, serverEnd] = Object.values(pair);
    serverEnd.accept();
    const client = wait.client;
    this._attach(client, serverEnd);
    this.clients.push(client);
    wait.resolve();
    client.send('joined', { sessionId, reconnectionToken: token });
    return new Response(null, { status: 101, webSocket: browserEnd });
  }
}

const BOT_NAMES = ['モリビト', 'コダマ', 'ヤミガラス', 'ツユクサ', 'ホタルビ', 'イバラ'];

/* ================= 定数(config.jsonで上書き可能=バランスノブの外部化) ================= */
const CFG = {
  teams: 2, teamSize: 3,           // 最大10チーム×3(30人)
  mapR: 1400, tick: 1 / 20, viewR: 750, witherViewR: 350, revealAtk: 1.4, revealHit: 0.8,
  treeCount: 110, bushCount: 40, mobCount: 26, chestCount: 18,
  castRange: 380, mpMax: 100, mpRegen: 6,
  matchLen: 480, unsealAt: 240, witherStart: 60, coreR: 240,
  dragonHp: 3500, potionHeal: 110, potionPrice: 80, whetBase: 120,
  // --- 追加5要素 ---
  downTime: 15, reviveTime: 2.5, reviveHpRate: .4, finishRate: .09, // ダウン&蘇生
  trailHpRate: .55, trailEvery: .45, trailLife: 6,                  // 血の足跡
  mistFirst: 70, mistEvery: 90, mistDur: 18, mistView: .55,         // 夢幻の霧
  goldenOpenAt: 120, goldenGold: 400, goldenAtk: .10,               // 黄金の宝箱
  roarReveal: 3,                                                    // 竜の咆哮
  bossAt: 180, bossHp: 900, bossGold: 250, bossBuff: .08,           // 中ボス「森の主」
  npcAt: 30, npcGold: 200, npcXp: 60, npcSpd: 90,                   // 迷い人クエスト
  soundEar: 1000, soundNear: 350,                                   // 音紋(この距離帯の視界外音が聞こえる)
  interestR: 1200,                                                  // interest管理(この距離外のエンティティは送らない)
  nightView: .75,                                                   // 夜マッチの視界係数
};
for (const k in cfgFile) if (k in CFG && typeof cfgFile[k] === typeof CFG[k]) CFG[k] = cfgFile[k];
CFG.teams = Math.max(2, Math.min(10, CFG.teams));
// ビルド分岐(Lv3/Lv6で2択 — 「型破りビルドの余地」)
const BUILDS = {
  warrior: { 1: ['鉄壁(被ダメ-10%)', '俊足(移動+8%)'], 2: ['大斬撃2.4倍', '盾打スタン+0.6s'] },
  mage:    { 1: ['火球+15%威力', 'ブリンク射程+60'],   2: ['爆裂半径+25%', '魔氷壁+2.5秒'] },
  thief:   { 1: ['警報罠(通報型)', '罠ダメージ+50%'],  2: ['隠密+1.5秒', '背面2.2倍'] },
  priest:  { 1: ['祝福+40', '俊足(移動+8%)'],          2: ['天光+120', '聖域半径+40%'] },
  ranger:  { 1: ['狙撃2.6倍', '跳躍CD-3秒'],           2: ['マーク被ダメ+25%', '煙幕半径+50%'] },
};
const CLASSES = {
  warrior: { hp: 340, spd: 150, range: 46, atk: 26, atkCd: .7 },
  mage:    { hp: 230, spd: 145, range: 330, atk: 30, atkCd: .9, projSpd: 430, projR: 7 },
  thief:   { hp: 250, spd: 165, range: 44, atk: 24, atkCd: .55 },
  priest:  { hp: 260, spd: 140, range: 40, atk: 10, atkCd: .9 },
  ranger:  { hp: 210, spd: 150, range: 430, atk: 38, atkCd: 1.25, projSpd: 560, projR: 5 },
};
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

const rnd = (a, b) => a + Math.random() * (b - a);
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const ang = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
function angleDiff(a, b) { let d = a - b; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
const polar = (r, th) => ({ x: Math.cos(th) * r, y: Math.sin(th) * r });

export class ForestRoom extends Room {
  onCreate() {
    const DEV = this.env.M2_DEV === '1'; // テスト用チート(本番では無効)
    this.maxClients = CFG.teams * CFG.teamSize;
    this.setPatchRate(0);
    this.world = this.makeWorld();
    this.units = new Map();
    this.projs = []; this.zones = []; this.walls = []; this.traps = [];
    this.dragon = null;
    this.dragonDmg = Array(CFG.teams).fill(0);
    this.gimmickBuff = Array(CFG.teams).fill(0);
    this.whetPrice = Array(CFG.teams).fill(CFG.whetBase); // チーム別価格逓増
    this.nextTeam = 0; this.t = 0; this.witherR = CFG.mapR; this.over = false; this.result = null;
    this.phase = 'lobby'; this.botIdx = 0;
    this.trails = []; this.mistOn = false; this.nextMist = CFG.mistFirst; this.mistLeft = 0;
    this.goldenTeam = -1; this.dragonPrevPhase = 0;
    this.pins = []; this.sounds = []; this.boss = null; this.npc = null; this.night = false;

    this.onMessage('start', (client, opts) => { if (this.phase === 'lobby') this.startMatch(!!(opts && opts.night)); });
    // 定型ピン(チーム内のみ・1.5秒レート制限)
    this.onMessage('ping', (client, msg) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || this.phase !== 'live' || typeof msg !== 'object' || msg === null) return;
      if (this.t - (u.lastPing || -9) < 1.5) return;
      const k = [0, 1, 2, 3].includes(+msg.k) ? +msg.k : 0;
      u.lastPing = this.t;
      this.pins.push({ k, x: isFinite(+msg.x) ? +msg.x : u.x, y: isFinite(+msg.y) ? +msg.y : u.y, team: u.team, by: u.name, life: 6 });
      if (this.pins.length > 30) this.pins.shift();
    });
    // ビルド選択(Lv3=tier1 / Lv6=tier2)
    this.onMessage('build', (client, msg) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || this.phase !== 'live' || typeof msg !== 'object' || msg === null) return;
      const tier = +msg.tier, choice = +msg.choice;
      if (![1, 2].includes(tier) || ![0, 1].includes(choice)) return;
      if (u['b' + tier] !== -1) return;                       // 選択済み
      if (u.lv < (tier === 1 ? 3 : 6)) return;                // レベル不足
      u['b' + tier] = choice;
    });
    this.onMessage('ready', (client) => {
      const u = this.units.get(client.sessionId); if (!u) return;
      client.send('init', {
        id: u.id, team: u.team, cls: u.cls, mapR: CFG.mapR, coreR: CFG.coreR,
        matchLen: CFG.matchLen, unsealAt: CFG.unsealAt,
        trees: this.world.trees, bushes: this.world.bushes,
        merchants: this.world.merchants, gimmicks: this.world.gimmicks.map(g => ({ x: g.x, y: g.y })),
        golden: { x: this.world.golden.x, y: this.world.golden.y, openAt: CFG.goldenOpenAt },
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
      if (this.phase !== 'live') return;
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || this.over || typeof msg !== 'object' || msg === null) return;
      const slot = [1, 2, 3, 4].includes(+msg.slot) ? +msg.slot : 0;
      if (!slot) return;
      let tx = isFinite(+msg.tx) ? +msg.tx : u.x, ty = isFinite(+msg.ty) ? +msg.ty : u.y;
      const d = Math.hypot(tx - u.x, ty - u.y);
      if (d > CFG.castRange) { tx = u.x + (tx - u.x) / d * CFG.castRange; ty = u.y + (ty - u.y) / d * CFG.castRange; }
      this.castSkill(u, slot, tx, ty);
    });
    this.onMessage('potion', (client) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || u.downed || this.over || u.potions <= 0 || u.hp >= this.maxHpOf(u)) return;
      u.potions--; u.hp = Math.min(this.maxHpOf(u), u.hp + CFG.potionHeal);
    });
    this.onMessage('buy', (client, msg) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || u.downed || this.over) return;
      if (!this.world.merchants.some(m => dist(u, m) < 70)) return; // 商人の近くでのみ
      if (msg && msg.item === 'potion' && u.gold >= CFG.potionPrice) { u.gold -= CFG.potionPrice; u.potions++; }
      if (msg && msg.item === 'whet' && u.gold >= this.whetPrice[u.team]) {
        u.gold -= this.whetPrice[u.team]; u.whet++; this.whetPrice[u.team] = Math.round(this.whetPrice[u.team] * 1.5);
      }
    });
    // 封印装置: クライアント実行QTE + サーバー検証(所要時間下限・近接・被弾なし — SPEC §4)
    this.onMessage('gimStart', (client) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || u.downed || this.over) return;
      const g = this.world.gimmicks.find(g2 => !g2.unlocked && dist(u, g2) < 60);
      if (g) u.gim = { g, t0: this.t, hitAt: u.lastHitT || -1 };
    });
    this.onMessage('gimDone', (client) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || this.over || !u.gim) return;
      const { g, t0, hitAt } = u.gim; u.gim = null;
      const need = u.cls === 'thief' ? 2.0 : 3.2; // 盗賊は速い
      if (g.unlocked || this.t - t0 < need) return;             // 所要時間下限
      if (dist(u, g) >= 60) return;                              // まだ装置の傍か
      if ((u.lastHitT || -1) > hitAt) return;                    // 解除中に被弾していないか
      g.unlocked = true; g.by = u.team;
      this.gimmickBuff[u.team] += .12;
      for (const a of this.units.values()) if (a.team === u.team && !a.dead) this.gainXp(a, 30, 120 / this.aliveOf(u.team).length);
      this.broadcast('fx', { kind: 'gimmick', x: g.x, y: g.y, team: u.team });
    });
    // 蘇生: ダウンした味方の近く(50px)でチャネル開始 → サーバーが2.5秒後に完了判定
    this.onMessage('revive', (client) => {
      const u = this.units.get(client.sessionId);
      if (!u || u.dead || u.downed || this.over || this.phase !== 'live') return;
      const tgt = [...this.units.values()].find(a => a.team === u.team && a.downed && !a.dead && dist(a, u) < 50);
      if (tgt) u.revCh = { id: tgt.id, t0: this.t, hitAt: u.lastHitT || -1 };
    });
    if (DEV) {
      this.onMessage('devTeleport', (client, msg) => { const u = this.units.get(client.sessionId); if (u) { u.x = +msg.x || 0; u.y = +msg.y || 0; } });
      this.onMessage('devTime', (client, msg) => { this.t = +msg.t || this.t; });
      this.onMessage('devDragonHp', (client, msg) => { if (this.dragon) this.dragon.hp = +msg.hp || 1; });
      this.onMessage('devGold', (client, msg) => { const u = this.units.get(client.sessionId); if (u) u.gold = +msg.gold || 0; });
    }
    this.setSimulationInterval(() => this.tick(CFG.tick), 1000 * CFG.tick);
    console.log('[forest:cf] room created', this.roomId, DEV ? '(DEV)' : '');
  }

  makeWorld() {
    const trees = [], bushes = [], mobs = [], chests = [], merchants = [], gimmicks = [];
    for (let i = 0; i < CFG.treeCount; i++) { const p = polar(rnd(CFG.coreR + 100, CFG.mapR - 60), rnd(0, 7)); trees.push({ x: p.x, y: p.y, r: rnd(16, 30) }); }
    for (let i = 0; i < CFG.bushCount; i++) { const p = polar(rnd(CFG.coreR + 90, CFG.mapR - 80), rnd(0, 7)); bushes.push({ x: p.x, y: p.y, r: rnd(34, 52) }); }
    for (let i = 0; i < CFG.mobCount; i++) {
      const r = rnd(CFG.coreR + 150, CFG.mapR - 120), p = polar(r, rnd(0, 7));
      const deep = 1.7 - r / CFG.mapR; // 深いほど強い
      mobs.push({ id: 'm' + i, x: p.x, y: p.y, home: { x: p.x, y: p.y }, r: 14, hp: 70 * deep, maxHp: 70 * deep, atk: 12 * deep, xp: Math.round(24 * deep), gold: Math.round(12 * deep), spd: 110, tAtk: 0, tele: null });
    }
    for (let i = 0; i < CFG.chestCount; i++) {
      const r = rnd(CFG.coreR + 130, CFG.mapR - 150), p = polar(r, rnd(0, 7));
      chests.push({ id: 'c' + i, x: p.x, y: p.y, gold: Math.round(rnd(30, 90) * (1.6 - r / CFG.mapR)), open: false });
    }
    for (let i = 0; i < 3; i++) { const p = polar(rnd(CFG.mapR * .45, CFG.mapR * .6), i * Math.PI * 2 / 3 + rnd(-.4, .4)); merchants.push({ x: p.x, y: p.y }); }
    for (let i = 0; i < 3; i++) { const p = polar(rnd(CFG.coreR + 220, CFG.mapR * .42), i * Math.PI * 2 / 3 + rnd(-.5, .5) + .7); gimmicks.push({ x: p.x, y: p.y, unlocked: false, by: -1 }); }
    // 黄金の宝箱: 全チームが位置を知っている争奪ポイント(中間帯・2:00に開放)
    const gp = polar(rnd(CFG.mapR * .3, CFG.mapR * .5), rnd(0, 7));
    const golden = { x: gp.x, y: gp.y, open: false };
    return { trees, bushes, mobs, chests, merchants, gimmicks, golden };
  }

  onJoin(client, options) {
    const cls = CLASSES[options && options.cls] ? options.cls : 'warrior';
    const name = ((options && String(options.name || '')) || 'player').slice(0, 12) || 'player';
    const party = ((options && String(options.party || '')) || '').slice(0, 12); // 同じ合言葉=同チーム保証
    const skin = Math.max(0, Math.min(5, +((options || {}).skin) || 0));
    const u = this.mkUnit(client.sessionId, -1, cls, name, false); // チームはマッチ開始時に確定
    u.party = party || ('solo_' + client.sessionId);
    u.skin = skin;
    u.uid = String((options || {}).uid || '');       // 戦績の帰属先(空=記録しない)
    u.kind = String((options || {}).kind || 'guest'); // clerk | guest
    u.totalRp = 0; // Registry DOから非同期に取得(ロビーのランク表示用)
    if (u.uid) this._registryFetch('GET', `/rp?uid=${encodeURIComponent(u.uid)}`)
      .then(r => r.json()).then(r => { if (r && typeof r.rp === 'number') u.totalRp = r.rp; })
      .catch(() => { /* Registry未達でも試合は続行 */ });
    this.units.set(client.sessionId, u);
    console.log('[forest:cf] join', client.sessionId, cls, name, party ? `party=${party}` : '');
  }
  async onLeave(client, consented) {
    const u = this.units.get(client.sessionId);
    if (!u) return;
    if (this.phase === 'live' && !this.over && !consented) {
      // 切断: Botが代行して120秒間の再接続を待つ
      u.bot = true; u.name = u.name + '(切断)';
      try {
        await this.allowReconnection(client, 120);
        u.bot = false; u.name = u.name.replace('(切断)', '');
        console.log('[forest:cf] reconnected', u.name);
      } catch { /* タイムアウト: Botのまま続行 */ }
    } else this.units.delete(client.sessionId);
  }
  spawnPos(team) {
    const a = (team / CFG.teams) * Math.PI * 2 + Math.PI / 4;
    return polar(CFG.mapR - 140, a);
  }
  mkUnit(id, team, cls, name, bot) {
    const C = CLASSES[cls];
    const base = this.spawnPos(Math.max(0, team));
    return {
      id, team, cls, name, bot, party: '', skin: 0, totalRp: 0,
      b1: -1, b2: -1, lastPing: -9, // ビルド選択・ピン制限
      x: base.x + rnd(-40, 40), y: base.y + rnd(-40, 40), r: 15,
      hp: C.hp, mp: CFG.mpMax, lv: 1, xp: 0, gold: 0, potions: 3, whet: 0,
      facing: 0, atkT: 0, s1T: 0, s2T: 0, s3T: 0, s4T: 0,
      revealT: 0, stealth: 0, slowT: 0, buffT: 0, shieldT: 0, markT: 0, stunT: 0, poisonT: 0, poisonSrc: null, venom: 0,
      dash: null, dead: false, lastHitT: -1, gim: null,
      downed: false, downT: 0, downedBy: null, revCh: null, trailT: 0, // ダウン&蘇生・足跡
      think: 0, botGimT: 0, wp: null, // Bot用
      input: { mx: 0, my: 0, atk: false, aim: 0 },
    };
  }

  /* ---------- マッチ開始: パーティ単位でチーム割当 → Botで各チームを定員まで補充 ---------- */
  startMatch(night) {
    this.night = !!night;
    // パーティ(合言葉)ごとにグループ化し、大きい順に空きの多いチームへ = 「身内は必ず同チーム」
    const players = [...this.units.values()].filter(u => !u.bot);
    const groups = new Map();
    for (const p of players) { if (!groups.has(p.party)) groups.set(p.party, []); groups.get(p.party).push(p); }
    const cap = Array(CFG.teams).fill(CFG.teamSize);
    // 人間がいるチーム数を最小化: 使うチーム数 = ceil(人数/teamSize) 以上、最低2
    for (const g of [...groups.values()].sort((a, b) => b.length - a.length)) {
      let queue = [...g];
      while (queue.length) {
        let best = 0; for (let t2 = 1; t2 < CFG.teams; t2++) if (cap[t2] > cap[best]) best = t2;
        const take = queue.splice(0, Math.max(1, Math.min(cap[best], queue.length)));
        for (const p of take) { p.team = best; cap[best]--; }
      }
    }
    // Bot補充(人間のいるチームは定員まで/完全空チームは2チーム目まで保証)
    const COMP = ['warrior', 'priest', 'ranger', 'mage', 'thief', 'warrior'];
    const usedTeams = new Set(players.map(p => p.team));
    if (usedTeams.size < 2) usedTeams.add([...Array(CFG.teams).keys()].find(t2 => !usedTeams.has(t2)));
    for (const team of usedTeams) {
      let n = [...this.units.values()].filter(u => u.team === team).length;
      while (n < CFG.teamSize) {
        const cls = COMP[(this.botIdx + n) % COMP.length];
        const bot = this.mkUnit('bot' + (this.botIdx), team, cls, BOT_NAMES[this.botIdx % BOT_NAMES.length], true);
        bot.skin = this.botIdx % 6;
        this.units.set(bot.id, bot);
        this.botIdx++; n++;
      }
    }
    // スポーン位置をチーム確定後に再配置
    for (const u of this.units.values()) {
      const base = this.spawnPos(u.team);
      u.x = base.x + rnd(-40, 40); u.y = base.y + rnd(-40, 40);
    }
    this.phase = 'live'; this.t = 0;
    this.lock(); // 開始後は参加不可
    for (const client of this.clients) { // 確定チームを各自に通知
      const u2 = this.units.get(client.sessionId);
      if (u2) client.send('team', { team: u2.team });
    }
    this.broadcast('fx', { kind: 'matchStart', night: this.night });
    console.log('[forest:cf] match start' + (this.night ? ' (night)' : '') + ' —',
      [...this.units.values()].map(u => `${u.name}(${u.cls}${u.bot ? ':bot' : ''})t${u.team}`).join(' '));
  }

  /* ---------- 成長 ---------- */
  lvMul(u) { return 1 + .13 * (u.lv - 1); }
  maxHpOf(u) { return Math.round(CLASSES[u.cls].hp * this.lvMul(u)); }
  atkOf(u) { return CLASSES[u.cls].atk * this.lvMul(u) * (1 + u.gold / 900) * (1 + .08 * u.whet) * (u.buffT > 0 ? 1.3 : 1) * (this.goldenTeam === u.team ? 1 + CFG.goldenAtk : 1); }
  spdOf(u) { return CLASSES[u.cls].spd * (u.slowT > 0 ? .55 : 1)
    * ((u.cls === 'warrior' || u.cls === 'priest') && this.hasBuild(u, 1, 1) ? 1.08 : 1); } // 俊足ビルド
  xpNeed(u) { return 60 + u.lv * 45; }
  gainXp(u, xp, gold) {
    u.xp += xp; u.gold += Math.round(gold * (u.cls === 'thief' ? 1.5 : 1));
    while (u.xp >= this.xpNeed(u)) {
      u.xp -= this.xpNeed(u); u.lv++; u.hp = Math.min(this.maxHpOf(u), u.hp + 60);
      if (u.bot) { // Botはビルドをランダム選択
        if (u.lv >= 3 && u.b1 === -1) u.b1 = Math.random() < .5 ? 0 : 1;
        if (u.lv >= 6 && u.b2 === -1) u.b2 = Math.random() < .5 ? 0 : 1;
      }
    }
  }
  aliveOf(team) { return [...this.units.values()].filter(a => a.team === team && !a.dead); }

  /* ---------- 視界 (枯死域=視界悪化込み) ---------- */
  bushOf(u) { for (const b of this.world.bushes) if (dist(u, b) < b.r) return b; return null; }
  smokeOf(u) { for (const z of this.zones) if (z.kind === 'smoke' && dist(u, z) < z.r) return z; return null; }
  viewR(v) { return (Math.hypot(v.x, v.y) > this.witherR ? CFG.witherViewR : CFG.viewR) * (this.mistOn ? CFG.mistView : 1) * (this.night ? CFG.nightView : 1); }
  hasBuild(u, tier, choice) { return u['b' + tier] === choice; }
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
    if (u.stealth > 0) return false;
    if (u.revealT > 0 || u.markT > 0) return true;
    const cover = this.bushOf(u) || this.smokeOf(u);
    for (const v of this.units.values()) {
      if (v.team !== team || v.dead) continue;
      if (dist(v, u) >= this.viewR(v)) continue;
      if (cover ? dist(v, cover) < cover.r + 24 : !this.losBlocked(v, u)) return true;
    }
    return false;
  }

  /* ---------- スキル(M1と同一プリミティブ) ---------- */
  castSkill(u, slot, tx, ty) {
    const S = SKILLS[u.cls][slot];
    if (!S || u['s' + slot + 'T'] > 0 || u.stunT > 0 || u.downed || u.mp < S.mp) return;
    u['s' + slot + 'T'] = S.cd; u.mp -= S.mp;
    if (u.cls === 'ranger' && slot === 2 && this.hasBuild(u, 1, 1)) u.s2T = S.cd - 3; // 跳躍CD-3
    const dir = Math.atan2(ty - u.y, tx - u.x) || u.facing;
    for (const fx of S.fx) this.runFx(u, fx, dir, tx, ty, slot);
    this.emitSound(u.x, u.y);
    this.broadcast('fx', { kind: 'cast', cls: u.cls, slot, x: u.x, y: u.y, tx, ty });
  }
  runFx(u, fx, dir, tx, ty, slot) {
    const atk = this.atkOf(u);
    switch (fx.type) {
      case 'dash': u.dash = { dir: fx.back ? dir + Math.PI : dir, spd: fx.spd, t: fx.dur, impactMul: fx.impactMul || 0 }; u.stealth = 0; break;
      case 'teleport': { const max = fx.maxDist + (u.cls === 'mage' && this.hasBuild(u, 1, 1) ? 60 : 0); // ブリンク射程+60
        const d = Math.min(max, Math.hypot(tx - u.x, ty - u.y) || max);
        u.x += Math.cos(dir) * d; u.y += Math.sin(dir) * d; this.collide(u); break; }
      case 'projectile': { let mul = fx.dmgMul;
        if (u.cls === 'ranger' && slot === 1 && this.hasBuild(u, 1, 0)) mul = 2.6; // 狙撃強化
        this.projs.push({ x: u.x, y: u.y, vx: Math.cos(dir) * fx.spd, vy: Math.sin(dir) * fx.spd, r: fx.r, life: 1.1, src: u, dmg: atk * mul, snipe: true });
        if (fx.selfReveal) u.revealT = Math.max(u.revealT, fx.selfReveal); break; }
      case 'meleeArc': {
        u.revealT = Math.max(u.revealT, CFG.revealAtk);
        let mul = fx.dmgMul, stun = fx.status && fx.status.stun;
        if (u.cls === 'warrior' && slot === 4 && this.hasBuild(u, 2, 0)) mul = 2.4;       // 大斬撃強化
        if (u.cls === 'warrior' && slot === 3 && stun && this.hasBuild(u, 2, 1)) stun += .6; // 盾打強化
        for (const h of this.hostilesOf(u)) {
          if (dist(u, h) < fx.range + (h.r || 14) && Math.abs(angleDiff(ang(u, h), dir)) < fx.arc) {
            this.hit(u, h, atk * mul);
            if (stun && h.stunT !== undefined) h.stunT = Math.max(h.stunT, stun);
          }
        } break; }
      case 'zone': { const zx = fx.atSelf ? u.x : tx, zy = fx.atSelf ? u.y : ty;
        let r = fx.r;
        if (u.cls === 'mage' && fx.kind === 'nuke' && this.hasBuild(u, 2, 0)) r *= 1.25;   // 爆裂半径
        if (u.cls === 'priest' && fx.kind === 'heal' && this.hasBuild(u, 2, 1)) r *= 1.4;  // 聖域半径
        if (u.cls === 'ranger' && fx.kind === 'smoke' && this.hasBuild(u, 2, 1)) r *= 1.5; // 煙幕半径
        this.zones.push({ x: zx, y: zy, r, team: u.team, kind: fx.kind, life: fx.life || fx.tele || 1, tele: fx.tele || 0, dmg: fx.dmg || 0, hps: fx.hps || 0, src: u }); break; }
      case 'summonWall': { const wd = Math.min(fx.maxDist, Math.hypot(tx - u.x, ty - u.y) || 120);
        const life = fx.life + (u.cls === 'mage' && this.hasBuild(u, 2, 1) ? 2.5 : 0); // 魔氷壁寿命
        const px = u.x + Math.cos(dir) * wd, py = u.y + Math.sin(dir) * wd;
        for (let i = -(fx.count >> 1); i <= (fx.count >> 1); i++)
          this.walls.push({ x: px + Math.cos(dir + Math.PI / 2) * i * fx.gap, y: py + Math.sin(dir + Math.PI / 2) * i * fx.gap, r: fx.r, life });
        break; }
      case 'summonTrap': { // 盗賊ビルド: 警報罠(通報型) or ダメージ+50%
        const alarm = this.hasBuild(u, 1, 0);
        const dmg = this.hasBuild(u, 1, 1) ? fx.dmg * 1.5 : fx.dmg;
        this.traps.push({ x: u.x, y: u.y, r: fx.r, team: u.team, src: u, life: fx.life, dmg, slow: fx.slow, alarm }); break; }
      case 'stealth': u.stealth = fx.dur + (u.cls === 'thief' && this.hasBuild(u, 2, 0) ? 1.5 : 0); break;
      case 'revealEnemies': for (const h of this.units.values()) if (h.team !== u.team && !h.dead && dist(u, h) < fx.radius) h.revealT = Math.max(h.revealT, fx.dur); break;
      case 'markTarget': { let bt = null, bd = 1e9;
        for (const h of this.units.values()) {
          if (h.team === u.team || h.dead || !this.seenBy(u.team, h)) continue;
          const d2 = Math.hypot(h.x - tx, h.y - ty);
          if (d2 < fx.pickR && d2 < bd) { bd = d2; bt = h; }
        }
        if (bt) { bt.markT = fx.dur; bt.markStr = this.hasBuild(u, 2, 0) ? 1.25 : 1.15; } // マーク強化
        else { u.s3T = 1; u.mp += SKILLS[u.cls][3].mp; } break; }
      case 'modifyStat': for (const a of this.units.values()) if (a.team === u.team && !a.dead && dist(a, u) < fx.radius) {
          if (fx.stat === 'buff') a.buffT = fx.dur; if (fx.stat === 'shield') a.shieldT = fx.dur; } break;
      case 'healAllies': { const amt2 = fx.amount + (u.cls === 'priest' && this.hasBuild(u, 1, 0) ? 40 : 0); // 祝福強化
        for (const a of this.units.values()) if (a.team === u.team && !a.dead && !a.downed && dist(a, u) < fx.radius) a.hp = Math.min(this.maxHpOf(a), a.hp + amt2); break; }
      case 'healLowest': { let m = null;
        const amt3 = fx.amount + (u.cls === 'priest' && this.hasBuild(u, 2, 0) ? 120 : 0); // 天光強化
        for (const a of this.units.values()) if (a.team === u.team && !a.dead && !a.downed && (!m || a.hp / this.maxHpOf(a) < m.hp / this.maxHpOf(m))) m = a;
        if (m) m.hp = Math.min(this.maxHpOf(m), m.hp + amt3); break; }
      case 'venom': u.venom = fx.charges; u.venomDur = fx.dur; break;
    }
  }
  hostilesOf(u) {
    const hs = [];
    for (const h of this.units.values()) if (h.team !== u.team && !h.dead && h.stealth <= 0) hs.push(h);
    for (const m of this.world.mobs) if (m.hp > 0) hs.push(m);
    if (this.boss && this.boss.hp > 0) hs.push(this.boss);
    if (this.dragon && this.dragon.hp > 0) hs.push(this.dragon);
    return hs;
  }
  emitSound(x, y) { // 音紋: 視界外でも「聞こえる」情報チャネル
    this.sounds.push({ x: Math.round(x / 80) * 80, y: Math.round(y / 80) * 80, life: .6 });
    if (this.sounds.length > 80) this.sounds.shift();
  }
  // プレイヤー/モブ/竜を対象に取れる統一ダメージ入口
  hit(src, tgt, amt) {
    if (tgt.isDragon) return this.damageDragon(src, amt);
    if (tgt.isBoss) return this.damageBoss(src, amt);
    if (tgt.id && this.units.has(tgt.id)) return this.damage(src, tgt, amt);
    this.damageMob(src, tgt, amt);
  }
  damageBoss(src, amt) {
    const B = this.boss; if (!B || B.hp <= 0) return;
    B.hp -= amt;
    if (B.hp <= 0 && src && src.team !== undefined && src.team >= 0) { // 討伐チームに報酬+対竜バフ
      const mates = this.aliveOf(src.team);
      for (const a of mates) this.gainXp(a, 60, CFG.bossGold / (mates.length || 1));
      this.gimmickBuff[src.team] += CFG.bossBuff;
      this.broadcast('fx', { kind: 'bossDown', team: src.team });
    }
  }

  /* ---------- Bot AI (プロトタイプのaiThink移植) ---------- */
  setMove(u, a) { if (a == null) { u.input.mx = 0; u.input.my = 0; } else { u.input.mx = Math.cos(a); u.input.my = Math.sin(a); } }
  botThink(u, dt) {
    u.think -= dt; if (u.think > 0) return; u.think = .22;
    u.input.atk = false;
    if (u.dead || u.downed || u.stunT > 0) { this.setMove(u, null); return; }
    if (u.revCh) { this.setMove(u, null); return; } // 蘇生チャネル中は静止
    const mh = this.maxHpOf(u);
    // 1) 予兆回避が最優先(このゲームの文法)
    const zz = this.zones.find(z => z.kind === 'nuke' && z.tele > 0 && z.team !== u.team && dist(u, z) < z.r + u.r + 8);
    if (zz) { this.setMove(u, ang(zz, u)); u.think = .1; return; }
    if (u.potions > 0 && u.hp < mh * .3) { u.potions--; u.hp = Math.min(mh, u.hp + CFG.potionHeal); }
    const mates = this.aliveOf(u.team), leader = mates[0];
    // ダウンした味方の救助(敵が近くにいなければ・僧侶は多少危険でも行く)
    const dn = mates.find(a => a.downed);
    if (dn) {
      const danger = [...this.units.values()].some(e => e.team !== u.team && !e.dead && !e.downed && dist(e, dn) < 180 && this.seenBy(u.team, e));
      if (!danger || u.cls === 'priest') {
        if (dist(u, dn) > 40) { this.setMove(u, ang(u, dn)); return; }
        this.setMove(u, null);
        u.revCh = { id: dn.id, t0: this.t, hitAt: u.lastHitT || -1 };
        return;
      }
    }
    // 2) 僧侶は回復最優先
    if (u.cls === 'priest') {
      if (u.s1T <= 0 && mates.some(a => !a.downed && a.hp < this.maxHpOf(a) * .65 && dist(a, u) < 170)) this.castSkill(u, 1, u.x, u.y);
      const hurt2 = mates.filter(a => !a.downed && a.hp < this.maxHpOf(a) * .5);
      if (u.s2T <= 0 && hurt2.length >= 2) this.castSkill(u, 2, hurt2[0].x, hurt2[0].y);
      if (u.s3T <= 0 && hurt2.length >= 2) this.castSkill(u, 3, u.x, u.y);
      if (u.s4T <= 0) { const m2 = mates.find(a => a.hp < this.maxHpOf(a) * .35); if (m2) this.castSkill(u, 4, m2.x, m2.y); }
    }
    // 3) 索敵(視界準拠)
    const ranged = u.cls === 'mage' || u.cls === 'ranger';
    const range = CLASSES[u.cls].range;
    let tgt = null, best = 1e9;
    for (const h of this.hostilesOf(u)) {
      if (u.cls === 'priest' && !h.isDragon) continue;
      if (h.downed) continue; // Botはダウン中の敵を追撃しない(確殺は人間の判断に残す)
      if (!h.isDragon && h.id && this.units.has(h.id) && !this.seenBy(u.team, h)) continue; // 敵ユニットは可視のみ
      const d = dist(u, h);
      const cap = h.isDragon ? 480 : (ranged ? 420 : 240);
      const pref = h.isDragon && this.dragon ? d * .3 : d; // 解禁後は竜を優先
      if (d < cap && pref < best) { best = pref; tgt = h; }
    }
    // 4) 逃走(瀕死・相手が竜以外)
    if (u.hp < mh * .28 && tgt && !tgt.isDragon) {
      this.setMove(u, ang(tgt, u));
      if (u.cls === 'thief' && u.s2T <= 0) this.castSkill(u, 2, u.x, u.y);
      if (u.cls === 'ranger' && u.s2T <= 0) this.castSkill(u, 2, tgt.x, tgt.y);
      return;
    }
    if (tgt) {
      const d = dist(u, tgt), inR = d < range + (tgt.r || 14) - 4;
      const isPvp = !tgt.isDragon && tgt.id && this.units.has(tgt.id);
      if (inR || (ranged && d < range)) { u.input.atk = true; u.input.aim = ang(u, tgt); }
      if (u.cls === 'warrior') {
        if (u.s1T <= 0 && d < 260 && d > 90) this.castSkill(u, 1, tgt.x, tgt.y);
        if (inR && u.s3T <= 0 && isPvp) this.castSkill(u, 3, tgt.x, tgt.y);
        if (inR && u.s4T <= 0) this.castSkill(u, 4, tgt.x, tgt.y);
        if (inR && u.s2T <= 0 && mates.length > 1) this.castSkill(u, 2, u.x, u.y);
      }
      if (u.cls === 'mage') {
        if (u.s2T <= 0 && d < 300 && isPvp) this.castSkill(u, 2, tgt.x, tgt.y);
        if (u.s4T <= 0 && d < 330) this.castSkill(u, 4, tgt.x, tgt.y);
      }
      if (u.cls === 'thief') {
        if (u.s4T <= 0 && d < 120) this.castSkill(u, 4, u.x, u.y);
        if (u.s3T <= 0 && d < 350 && isPvp) this.castSkill(u, 3, u.x, u.y);
      }
      if (u.cls === 'ranger') {
        if (u.s1T <= 0 && d > 180 && d < range) this.castSkill(u, 1, tgt.x, tgt.y);
        if (u.s3T <= 0 && d < 450 && isPvp) this.castSkill(u, 3, u.x, u.y);
      }
      this.setMove(u, d > (ranged ? range * .7 : range * .6) ? ang(u, tgt) : null);
      if (ranged && d < 150) { this.setMove(u, ang(tgt, u)); // kite
        if (u.cls === 'ranger' && u.s4T <= 0 && u.hp < mh * .5) this.castSkill(u, 4, u.x, u.y); }
    } else {
      // 5) 盗賊: 封印装置の解除(5秒チャネル)
      if (u.cls === 'thief') {
        const g = this.world.gimmicks.find(g2 => !g2.unlocked && dist(u, g2) < 420);
        if (g) {
          if (dist(u, g) > 46) { this.setMove(u, ang(u, g)); return; }
          this.setMove(u, null); u.botGimT += .22;
          if (u.botGimT >= 5) {
            u.botGimT = 0; g.unlocked = true; g.by = u.team;
            this.gimmickBuff[u.team] += .12;
            for (const a of mates) this.gainXp(a, 30, 120 / mates.length);
            this.broadcast('fx', { kind: 'gimmick', x: g.x, y: g.y, team: u.team });
          }
          return;
        }
      }
      // 6) リーダー追従 or 時間とともに深部へ
      if (u !== leader && leader && !leader.dead) {
        this.setMove(u, dist(u, leader) > 130 ? ang(u, leader) : null);
      } else {
        if (!u.wp || dist(u, u.wp) < 60) {
          const depth = this.dragon ? rnd(0, CFG.coreR + 150)
            : Math.max(CFG.coreR + 100, Math.min(CFG.mapR - 160, CFG.mapR * (1 - this.t / CFG.matchLen) - 200));
          u.wp = polar(rnd(Math.max(60, depth - 250), depth), rnd(0, 7));
        }
        this.setMove(u, ang(u, u.wp));
      }
    }
    // 7) 枯死域からの脱出は全てに優先
    if (Math.hypot(u.x, u.y) > this.witherR - 60) this.setMove(u, ang(u, { x: 0, y: 0 }));
  }

  /* ---------- tick ---------- */
  tick(dt) {
    // ロビー/終了後はシミュレーション不要 — スナップショットを4Hzに落とす(無料枠のDO稼働・帯域の節約)
    if (this.phase === 'lobby' || this.over) {
      this._slowN = (this._slowN || 0) + 1;
      if (this._slowN % 5 === 0) this.broadcastSnapshots();
      if (this.phase === 'lobby') { // 放置ロビーは15分で解散(DOを休止させて稼働時間を守る)
        this._lobbyT = (this._lobbyT || 0) + dt;
        if (this._lobbyT > 900) { console.log('[forest:cf] lobby idle timeout', this.roomId); this.disconnect(); }
      }
      return;
    }
    // 人間が全員居なくなった試合はBotだけで8分回さず打ち切る(再接続窓120秒+余裕を待ってから)
    if (this.clients.length === 0) {
      this._emptyT = (this._emptyT || 0) + dt;
      if (this._emptyT > 130) { console.log('[forest:cf] no humans left — abort match', this.roomId); this.disconnect(); return; }
    } else this._emptyT = 0;
    this.t += dt;
    for (const u of this.units.values()) if (u.bot) this.botThink(u, dt);
    if (this.t > CFG.witherStart)
      this.witherR = Math.max(CFG.coreR + 220, CFG.mapR * (1 - (this.t - CFG.witherStart) / (CFG.matchLen - CFG.witherStart) * .95));
    if (!this.dragon && this.t >= CFG.unsealAt) {
      this.dragon = { isDragon: true, x: 0, y: 0, r: 64, hp: CFG.dragonHp, maxHp: CFG.dragonHp, tAtk: 2, phase: 0, team: -1 };
      this.broadcast('fx', { kind: 'unseal' });
    }
    // 夢幻の霧: 周期イベントで全員の視界が半減
    if (!this.mistOn && this.t >= this.nextMist) { this.mistOn = true; this.mistLeft = CFG.mistDur; this.broadcast('fx', { kind: 'mist' }); }
    if (this.mistOn) { this.mistLeft -= dt; if (this.mistLeft <= 0) { this.mistOn = false; this.nextMist = this.t + CFG.mistEvery; this.broadcast('fx', { kind: 'mistEnd' }); } }
    this.trails.forEach(tr => tr.life -= dt); this.trails = this.trails.filter(tr => tr.life > 0);
    this.pins.forEach(p => p.life -= dt); this.pins = this.pins.filter(p => p.life > 0);
    this.sounds.forEach(sn => sn.life -= dt); this.sounds = this.sounds.filter(sn => sn.life > 0);
    // 中ボス「森の主」: 3:00に深層へ出現
    if (!this.boss && this.t >= CFG.bossAt) {
      const p = polar(rnd(CFG.coreR + 200, CFG.mapR * .4), rnd(0, 7));
      this.boss = { isBoss: true, x: p.x, y: p.y, r: 34, hp: CFG.bossHp, maxHp: CFG.bossHp, tAtk: 2, team: -1 };
      this.broadcast('fx', { kind: 'boss', x: p.x, y: p.y });
    }
    // 迷い人クエスト: 0:30に出現。連れて祠まで護衛(横取り可)
    if (!this.npc && this.t >= CFG.npcAt) {
      const p = polar(rnd(CFG.mapR * .35, CFG.mapR * .55), rnd(0, 7));
      this.npc = { x: p.x, y: p.y, team: -1, done: false, shrine: polar(CFG.mapR * .55, Math.atan2(p.y, p.x) + Math.PI) };
      this.broadcast('fx', { kind: 'npc', x: p.x, y: p.y });
    }
    const units = [...this.units.values()];
    for (const u of units) {
      if (u.dead) continue;
      if (u.downed) { // ダウン: 出血しながら常時露見。時間切れで死亡
        u.downT -= dt;
        u.revealT = Math.max(u.revealT, .5);
        if (u.downT <= 0) this.die(u.downedBy, u);
        continue;
      }
      u.atkT -= dt; u.s1T -= dt; u.s2T -= dt; u.s3T -= dt; u.s4T -= dt;
      u.revealT -= dt; u.stealth -= dt; u.slowT -= dt; u.buffT -= dt; u.shieldT -= dt; u.markT -= dt; u.stunT -= dt;
      u.mp = Math.min(CFG.mpMax, u.mp + CFG.mpRegen * dt);
      if (u.poisonT > 0) { u.poisonT -= dt; u.hp -= 9 * dt; if (u.hp <= 0) { this.kill(u.poisonSrc, u); continue; } }
      if (u.dash) {
        u.x += Math.cos(u.dash.dir) * u.dash.spd * dt; u.y += Math.sin(u.dash.dir) * u.dash.spd * dt;
        u.dash.t -= dt;
        if (u.dash.t <= 0) { if (u.dash.impactMul) for (const h of this.hostilesOf(u)) if (dist(u, h) < 60) this.hit(u, h, this.atkOf(u) * u.dash.impactMul); u.dash = null; }
      } else if (u.stunT <= 0) {
        const l = Math.hypot(u.input.mx, u.input.my);
        if (l > 0) { u.x += u.input.mx / l * this.spdOf(u) * dt; u.y += u.input.my / l * this.spdOf(u) * dt; u.facing = Math.atan2(u.input.my, u.input.mx); }
        if (u.input.atk && u.atkT <= 0 && !u.revCh) this.doAttack(u, u.input.aim);
      }
      // 蘇生チャネル(移動・被弾・距離で中断、2.5秒で完了)
      if (u.revCh) {
        const rt = this.units.get(u.revCh.id);
        const moved = Math.hypot(u.input.mx, u.input.my) > 0;
        if (!rt || !rt.downed || rt.dead || moved || (u.lastHitT || -1) > u.revCh.hitAt || dist(u, rt) >= 55) u.revCh = null;
        else if (this.t - u.revCh.t0 >= CFG.reviveTime) {
          rt.downed = false; rt.hp = Math.round(this.maxHpOf(rt) * CFG.reviveHpRate); rt.downT = 0;
          u.revCh = null;
          this.broadcast('fx', { kind: 'revive', x: rt.x, y: rt.y, team: rt.team, name: rt.name });
        }
      }
      // 血の足跡: 負傷者(HP55%未満)は移動の痕跡を残す
      if (u.hp < this.maxHpOf(u) * CFG.trailHpRate) {
        u.trailT -= dt;
        if (u.trailT <= 0) { u.trailT = CFG.trailEvery;
          this.trails.push({ x: +u.x.toFixed(1), y: +u.y.toFixed(1), team: u.team, life: CFG.trailLife });
          if (this.trails.length > 400) this.trails.shift(); }
      }
      // 黄金の宝箱(2:00開放・全チーム既知の争奪ポイント)
      const gc = this.world.golden;
      if (!gc.open && this.t >= CFG.goldenOpenAt && dist(u, gc) < 45) {
        gc.open = true; this.goldenTeam = u.team;
        const gm = this.aliveOf(u.team);
        for (const a of gm) this.gainXp(a, 40, CFG.goldenGold / gm.length);
        this.broadcast('fx', { kind: 'golden', x: gc.x, y: gc.y, team: u.team });
      }
      for (const z of this.zones) {
        if (z.tele > 0) continue;
        if (z.kind === 'slow' && z.team !== u.team && dist(u, z) < z.r) u.slowT = Math.max(u.slowT, .3);
        if (z.kind === 'heal' && z.team === u.team && dist(u, z) < z.r) u.hp = Math.min(this.maxHpOf(u), u.hp + z.hps * dt);
      }
      for (const tr of this.traps) {
        if (tr.team === u.team || dist(u, tr) >= tr.r) continue;
        tr.life = 0;
        if (tr.alarm) { // 警報罠: ダメージなし・踏んだ敵を12s通報+チームに自動ピン
          u.markT = Math.max(u.markT, 12); u.markStr = u.markStr || 1.15;
          this.pins.push({ k: 1, x: u.x, y: u.y, team: tr.team, by: '警報罠', life: 6 });
          this.broadcast('fx', { kind: 'alarm', x: u.x, y: u.y, team: tr.team });
        } else { this.damage(tr.src, u, tr.dmg); u.slowT = Math.max(u.slowT, tr.slow); }
      }
      // 宝箱(自動オープン・チーム分配)
      for (const c of this.world.chests) {
        if (c.open || dist(u, c) >= 40) continue;
        c.open = true;
        const mates = this.aliveOf(u.team);
        for (const a of mates) this.gainXp(a, 10, c.gold / mates.length);
      }
      // 枯死DoT
      if (Math.hypot(u.x, u.y) > this.witherR) { u.hp -= 22 * dt; if (u.hp <= 0) { this.kill(null, u); continue; } }
      // 装置解除の中断判定(離れたら無効)
      if (u.gim && dist(u, u.gim.g) >= 60) u.gim = null;
      this.collide(u);
    }
    // 弾
    this.projs = this.projs.filter(pr => {
      pr.x += pr.vx * dt; pr.y += pr.vy * dt; pr.life -= dt;
      if (pr.life <= 0) return false;
      for (const arr of [this.world.trees, this.walls]) for (const t of arr) if (dist(pr, t) < t.r) return false;
      for (const h of this.hostilesOf(pr.src)) {
        if (dist(pr, h) < (h.r || 14) + pr.r) { this.hit(pr.src, h, pr.dmg); return false; }
      }
      return true;
    });
    // ゾーン
    this.zones = this.zones.filter(z => {
      if (z.tele > 0) {
        z.tele -= dt;
        if (z.tele <= 0 && z.kind === 'nuke') {
          for (const u of units) if (!u.dead && u.team !== z.team && dist(u, z) < z.r + u.r) this.damage(z.src, u, z.dmg);
          for (const m of this.world.mobs) if (m.hp > 0 && dist(m, z) < z.r + m.r) this.damageMob(z.src, m, z.dmg);
          if (z.team >= 0 && this.dragon && this.dragon.hp > 0 && dist(this.dragon, z) < z.r + this.dragon.r) this.damageDragon(z.src, z.dmg);
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
        else if (m.tAtk <= 0 && !m.tele) { m.tAtk = 1.6; m.tele = { x: near.x, y: near.y, r: 34, t: .5 }; this.emitSound(m.x, m.y); }
      } else if (dist(m, m.home) > 30) { const a = ang(m, m.home); m.x += Math.cos(a) * m.spd * .6 * dt; m.y += Math.sin(a) * m.spd * .6 * dt; }
    }
    // ドラゴン(フェーズ制・予兆AoE)
    if (this.dragon && this.dragon.hp > 0) {
      const D = this.dragon;
      D.phase = D.hp < D.maxHp * .33 ? 2 : D.hp < D.maxHp * .66 ? 1 : 0;
      if (D.phase !== this.dragonPrevPhase) { // 竜の咆哮: フェーズ移行で全員強制露見
        this.dragonPrevPhase = D.phase;
        for (const u2 of units) if (!u2.dead) u2.revealT = Math.max(u2.revealT, CFG.roarReveal);
        this.broadcast('fx', { kind: 'roar', phase: D.phase });
      }
      D.tAtk -= dt;
      const foes = units.filter(u => !u.dead && dist(u, D) < 520);
      if (foes.length && D.tAtk <= 0) {
        D.tAtk = [2.6, 2.0, 1.7][D.phase];
        const tgt = foes[Math.floor(Math.random() * foes.length)];
        const n = [1, 2, 2][D.phase];
        for (let i = 0; i < n; i++) {
          const off = polar(rnd(0, 70), rnd(0, 7));
          this.zones.push({ x: tgt.x + off.x, y: tgt.y + off.y, r: 78, team: -1, kind: 'nuke', life: .8, tele: .8, dmg: 80, src: D });
        }
      }
    }
    // 中ボスAI: 近くの全ユニットに範囲予兆スラム
    if (this.boss && this.boss.hp > 0) {
      const B = this.boss;
      B.tAtk -= dt;
      const foes = units.filter(u => !u.dead && !u.downed && dist(u, B) < 300);
      if (foes.length && B.tAtk <= 0) {
        B.tAtk = 2.4;
        const tgt = foes[Math.floor(Math.random() * foes.length)];
        this.zones.push({ x: tgt.x, y: tgt.y, r: 70, team: -1, kind: 'nuke', life: .7, tele: .7, dmg: 60, src: B });
        this.emitSound(B.x, B.y);
      }
    }
    // 迷い人: 最寄りの護衛者(40px)に付き、祠に着けば報酬。護衛が離れれば誰でも横取り可
    if (this.npc && !this.npc.done) {
      const N = this.npc;
      const claimant = units.filter(u => !u.dead && !u.downed && dist(u, N) < 40)
        .sort((a, b) => dist(a, N) - dist(b, N))[0];
      if (claimant) N.team = claimant.team;
      if (N.team >= 0) {
        const escort = units.filter(u => u.team === N.team && !u.dead && !u.downed && dist(u, N) < 300)
          .sort((a, b) => dist(a, N) - dist(b, N))[0];
        if (escort) { const a = ang(N, escort); if (dist(N, escort) > 40) { N.x += Math.cos(a) * CFG.npcSpd * dt; N.y += Math.sin(a) * CFG.npcSpd * dt; } }
        if (dist(N, N.shrine) < 60) {
          N.done = true;
          const mates = this.aliveOf(N.team);
          for (const a of mates) this.gainXp(a, CFG.npcXp, CFG.npcGold / (mates.length || 1));
          this.broadcast('fx', { kind: 'npcDone', team: N.team });
        }
      }
    }
    // 試合終了判定
    const alive = units.filter(u => !u.dead);
    if (this.dragon && this.dragon.hp <= 0) this.endMatch(true, '竜は倒れた');
    else if (units.length > 0 && alive.length === 0) this.endMatch(false, '全滅 — 森が勝った');
    else if (this.t >= CFG.matchLen) this.endMatch(false, '時間切れ — 森が全てを呑んだ');
    this.broadcastSnapshots();
  }

  doAttack(u, aim) {
    const C = CLASSES[u.cls];
    u.atkT = C.atkCd; u.facing = aim;
    const wasStealth = u.stealth > 0; u.stealth = 0;
    u.revealT = Math.max(u.revealT, CFG.revealAtk);
    if (C.projSpd) {
      const dmgMul = u.cls === 'mage' && this.hasBuild(u, 1, 0) ? 1.15 : 1; // 火球強化
      this.projs.push({ x: u.x, y: u.y, vx: Math.cos(aim) * C.projSpd, vy: Math.sin(aim) * C.projSpd, r: C.projR, life: 1.05, src: u, dmg: this.atkOf(u) * dmgMul });
    } else {
      for (const h of this.hostilesOf(u)) {
        if (dist(u, h) < C.range + (h.r || 14) && Math.abs(angleDiff(ang(u, h), aim)) < 1.1) {
          let d = this.atkOf(u);
          if (u.cls === 'thief') {
            const behind = Math.abs(angleDiff(h.facing || 0, ang(u, h))) < 1.2;
            if (behind || wasStealth) d *= this.hasBuild(u, 2, 1) ? 2.2 : 1.8; // 背面強化
            if (u.venom > 0) { u.venom--; if (h.poisonT !== undefined) { h.poisonT = u.venomDur; h.poisonSrc = u; } else d += 12; }
          }
          this.hit(u, h, d);
        }
      }
    }
    this.emitSound(u.x, u.y);
    this.broadcast('fx', { kind: 'swing', x: u.x, y: u.y, dir: aim, team: u.team });
  }

  damage(src, tgt, amt) {
    if (tgt.dead) return;
    if (tgt.downed) { // ダウン中への追撃=確殺を早める
      tgt.downT -= amt * CFG.finishRate;
      tgt.downedBy = src || tgt.downedBy;
      tgt.lastHitT = this.t;
      if (tgt.downT <= 0) this.die(tgt.downedBy, tgt);
      return;
    }
    if (tgt.shieldT > 0) amt *= .6;
    if (tgt.markT > 0) amt *= (tgt.markStr || 1.15);
    if (tgt.cls === 'warrior' && this.hasBuild(tgt, 1, 0)) amt *= .9; // 鉄壁ビルド
    tgt.hp -= amt;
    tgt.revealT = Math.max(tgt.revealT, CFG.revealHit);
    tgt.lastHitT = this.t; // QTE検証・蘇生中断用
    if (tgt.hp <= 0) this.kill(src, tgt);
  }
  damageMob(src, m, amt) {
    if (m.hp <= 0) return;
    m.hp -= amt;
    if (m.hp <= 0 && src && src.team !== undefined) { // 撃破報酬: 350px以内のチームで分配
      const mates = this.aliveOf(src.team).filter(a => dist(a, m) < 350);
      const share = mates.length || 1;
      for (const a of mates) this.gainXp(a, m.xp / share, m.gold / share);
    }
  }
  damageDragon(src, amt) {
    const D = this.dragon; if (!D || D.hp <= 0) return;
    if (src && src.team !== undefined && src.team >= 0) {
      amt *= 1 + this.gimmickBuff[src.team]; // 装置解除バフ
      this.dragonDmg[src.team] += amt;
    }
    D.hp -= amt;
  }
  kill(src, tgt) { // HP0 → 助けられる味方がいればダウン、いなければ死亡
    if (tgt.dead || tgt.downed) return;
    const rescuers = [...this.units.values()].filter(a => a.team === tgt.team && a !== tgt && !a.dead && !a.downed);
    if (rescuers.length > 0) {
      tgt.downed = true; tgt.downT = CFG.downTime; tgt.downedBy = src || null;
      tgt.hp = 1; tgt.dash = null; tgt.stealth = 0; tgt.gim = null; tgt.revCh = null;
      this.broadcast('fx', { kind: 'down', x: tgt.x, y: tgt.y, team: tgt.team, name: tgt.name });
    } else this.die(src, tgt);
  }
  die(src, tgt) { // 完全な死=脱落。撃破チームは奪取
    if (tgt.dead) return;
    tgt.dead = true; tgt.downed = false; tgt.dash = null; tgt.stealth = 0; tgt.gim = null; tgt.revCh = null;
    if (src && src.team !== undefined && src.team >= 0 && src.team !== tgt.team) {
      const loots = this.aliveOf(src.team);
      const stolen = Math.round(tgt.gold * .3);
      for (const a of loots) this.gainXp(a, 20 + tgt.lv * 10, stolen / (loots.length || 1));
      tgt.gold = Math.round(tgt.gold * .7);
    }
  }
  endMatch(dragonKilled, reason) {
    if (this.over) return;
    this.over = true; this.phase = 'over';
    const total = this.dragonDmg.reduce((a, b) => a + b, 0) || 1;
    const rows = [...Array(CFG.teams).keys()].map(team => ({ team, dmg: Math.round(this.dragonDmg[team]), share: +(this.dragonDmg[team] / total).toFixed(3), rp: Math.round(this.dragonDmg[team] / total * 1000) }));
    const winTeam = dragonKilled ? rows.slice().sort((a, b) => b.rp - a.rp)[0].team : -1;
    // RP永続化はRegistry DO(SQLiteストレージ)に委譲。累計・戦績はレスポンスで受け取る
    const humans = [...this.units.values()].filter(u => !u.bot && u.uid)
      .map(u => ({ userId: u.uid, kind: u.kind, name: u.name, cls: u.cls, team: u.team,
        rp: rows[u.team].rp, share: rows[u.team].share, win: u.team === winTeam }));
    this._registryFetch('POST', '/record',
      { players: humans, meta: { dragonKilled, night: this.night, reason } }).then(r => r.json())
      .catch(() => humans.map(h => ({ name: h.name, team: h.team, rp: h.rp, totalRp: h.rp, matches: 1, wins: h.win ? 1 : 0, rank: rankOf(h.rp) }))) // Registry未達でも当試合分は返す
      .then(players => {
        this.result = { dragonKilled, reason, rows, players };
        this.broadcast('result', this.result);
      });
    this.clock.setTimeout(() => this.disconnect(), 60_000); // 1分後にルーム解散
  }
  collide(u) {
    for (const arr of [this.world.trees, this.walls]) for (const t of arr) {
      const d = dist(u, t), min = t.r + u.r;
      if (d < min && d > 0) { const a = ang(t, u); u.x = t.x + Math.cos(a) * min; u.y = t.y + Math.sin(a) * min; }
    }
    if (this.dragon && this.dragon.hp > 0) { const D = this.dragon, d = dist(u, D), min = D.r + u.r;
      if (d < min && d > 0) { const a = ang(D, u); u.x = D.x + Math.cos(a) * min; u.y = D.y + Math.sin(a) * min; } }
    const rr = Math.hypot(u.x, u.y);
    if (rr > CFG.mapR) { const a = Math.atan2(u.y, u.x); u.x = Math.cos(a) * CFG.mapR; u.y = Math.sin(a) * CFG.mapR; }
  }

  broadcastSnapshots() {
    const units = [...this.units.values()];
    const total = this.dragonDmg.reduce((a, b) => a + b, 0);
    const dragonPub = this.dragon ? { x: 0, y: 0, r: 64, hp: Math.max(0, Math.round(this.dragon.hp)), maxHp: this.dragon.maxHp, phase: this.dragon.phase } : null;
    const shares = total > 0 ? this.dragonDmg.map(d => Math.round(d / total * 100)) : Array(CFG.teams).fill(0);
    const bossPub = this.boss ? { x: +this.boss.x.toFixed(1), y: +this.boss.y.toFixed(1), hp: Math.max(0, Math.round(this.boss.hp)), maxHp: this.boss.maxHp } : null;
    const npcPub = this.npc ? { x: +this.npc.x.toFixed(1), y: +this.npc.y.toFixed(1), team: this.npc.team, done: this.npc.done, shrine: this.npc.shrine } : null;
    const gimsPub = this.world.gimmicks.map(g => ({ x: g.x, y: g.y, unlocked: g.unlocked, by: g.by }));
    for (const client of this.clients) {
      const me = this.units.get(client.sessionId);
      if (!me) continue;
      const team = me.team;
      const members = units.filter(u => u.team === team && !u.dead);
      // interest管理: チームの誰かから interestR 以内のエンティティだけ送る(30人対応の帯域対策)
      const near = (e) => this.phase !== 'live' || members.length === 0 || members.some(v => dist(v, e) < CFG.interestR);
      const teamUnits = units
        .filter(u => u.team === team || (!u.dead && this.seenBy(team, u)))
        .map(u => ({
          id: u.id, team: u.team, cls: u.cls, skin: u.skin, x: +u.x.toFixed(1), y: +u.y.toFixed(1),
          hp: Math.round(u.hp), maxHp: this.maxHpOf(u), facing: +u.facing.toFixed(2), dead: u.dead,
          reveal: u.revealT > 0, stealth: u.team === team && u.stealth > 0, stun: u.stunT > 0, shield: u.shieldT > 0, mark: u.markT > 0, lv: u.lv,
          name: u.name, bot: u.bot,
          downed: u.downed, downT: u.downed ? +Math.max(0, u.downT).toFixed(1) : 0,
        }));
      const buildOffer = (!me.bot && ((me.lv >= 3 && me.b1 === -1) ? { tier: 1, options: BUILDS[me.cls][1] }
        : (me.lv >= 6 && me.b2 === -1) ? { tier: 2, options: BUILDS[me.cls][2] } : null)) || null;
      client.send('snap', {
        t: +this.t.toFixed(3), witherR: Math.round(this.witherR), over: this.over, phase: this.phase, night: this.night,
        roster: this.phase === 'lobby' ? [...this.units.values()].map(u => ({ name: u.name, cls: u.cls, party: u.party.startsWith('solo_') ? '' : u.party, rank: rankOf(u.totalRp) })) : undefined,
        units: teamUnits,
        mobs: this.world.mobs.filter(m => m.hp > 0 && near(m))
          .map(m => ({ id: m.id, x: +m.x.toFixed(1), y: +m.y.toFixed(1), hp: Math.round(m.hp), maxHp: Math.round(m.maxHp), tele: m.tele ? { x: m.tele.x, y: m.tele.y, r: m.tele.r } : null })),
        zones: this.zones.filter(z => near(z)).map(z => ({ x: z.x, y: z.y, r: z.r, kind: z.kind, tele: +Math.max(0, z.tele).toFixed(2), team: z.team })),
        walls: this.walls.filter(w => near(w)).map(w => ({ x: +w.x.toFixed(1), y: +w.y.toFixed(1), r: w.r })),
        projs: this.projs.filter(p => near(p)).map(p => ({ x: +p.x.toFixed(1), y: +p.y.toFixed(1), r: p.r, cls: p.src.cls })),
        traps: this.traps.filter(tr => {
          if (tr.team === team) return true;
          return members.some(v => v.cls === 'thief' && dist(v, tr) < 140);
        }).map(tr => ({ x: tr.x, y: tr.y, r: tr.r, own: tr.team === team })),
        chests: this.world.chests.filter(c => near(c)).map(c => ({ x: c.x, y: c.y, open: c.open })),
        gimmicks: gimsPub, dragon: dragonPub, boss: bossPub, npc: npcPub, shares,
        trails: this.trails.filter(tr => near(tr)).map(tr => ({ x: tr.x, y: tr.y, own: tr.team === team, f: +Math.min(1, tr.life / CFG.trailLife).toFixed(2) })),
        // 音紋: チームの視界外だが可聴圏内の音(方向は分かるが正体不明)
        sounds: this.sounds.filter(sn => members.some(v => { const d = dist(v, sn); return d > CFG.soundNear && d < CFG.soundEar; }))
          .map(sn => ({ x: sn.x, y: sn.y })),
        pins: this.pins.filter(p => p.team === team).map(p => ({ k: p.k, x: p.x, y: p.y, by: p.by, life: +p.life.toFixed(1) })),
        mist: this.mistOn ? +this.mistLeft.toFixed(1) : 0,
        golden: { open: this.world.golden.open, by: this.goldenTeam, tLeft: Math.max(0, Math.ceil(CFG.goldenOpenAt - this.t)) },
        me: {
          mp: Math.round(me.mp), cd: [1, 2, 3, 4].map(n => +Math.max(0, me['s' + n + 'T']).toFixed(1)),
          lv: me.lv, xp: Math.round(me.xp), xpNeed: this.xpNeed(me), gold: Math.round(me.gold),
          potions: me.potions, whet: me.whet, whetPrice: this.whetPrice[me.team],
          nearMerchant: this.world.merchants.some(m => dist(me, m) < 70),
          nearGim: this.world.gimmicks.some(g => !g.unlocked && dist(me, g) < 60),
          gimActive: !!me.gim,
          nearDowned: [...this.units.values()].some(a => a.team === me.team && a.downed && !a.dead && dist(a, me) < 50),
          revP: me.revCh ? +Math.min(1, (this.t - me.revCh.t0) / CFG.reviveTime).toFixed(2) : 0,
          buildOffer, builds: [me.b1, me.b2],
        },
      });
    }
  }
}
