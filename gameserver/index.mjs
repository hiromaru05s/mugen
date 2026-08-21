// 夢幻の森 — ゲームサーバー(Node版 / VM上で動かす)
//
// 役割分担(ハイブリッド構成):
//   Cloudflare Workers … 静的配信・ログイン・戦績DB(Registry DO)・ランキング  ← 世界中どこからでも速い
//   このサーバー        … 試合そのもの(WebSocket)                            ← プレイヤーの近くに置く
//
// 移設の目的は ping。Cloudflare無料プランは韓国からの接続をLAX(米西海岸)で処理するため
// 往復130ms超が下限になっていた。ソウル/東京のVMに置けば10〜40msになる。
//
// 環境変数:
//   PORT                 待受ポート(既定 8080。TLSはCaddyが前段で終端する)
//   WORKERS_ORIGIN       Workers側のURL (例 https://mugen-no-mori.xxx.workers.dev)
//   GAME_SERVER_SECRET   Workers の /api/gs/* を叩くための共有秘密(wrangler secret と同じ値)
//   CLERK_PUBLISHABLE_KEY 省略可。設定するとログイン済みユーザーを本人として記録する
//   ALLOW_ORIGIN         CORS許可オリジン(既定 WORKERS_ORIGIN。ローカル検証時は * でもよい)
//   M2_DEV               '1' でテスト用チートを有効化(本番では設定しない)
//   MAX_ROOMS/MAX_CONNS/MAX_CONNS_PER_IP/JOIN_BURST  暴走・悪意ある接続に対する上限(下記)
'use strict';
import http from 'node:http';
import { WebSocketServer } from 'ws';
import { defineForestRoom } from '../workers/src/game.mjs';
import { NodeRoom } from './node-room.mjs';
import { resolveUser } from '../workers/src/auth.mjs';

const PORT = Number(process.env.PORT || 8080);
const WORKERS_ORIGIN = (process.env.WORKERS_ORIGIN || '').replace(/\/+$/, '');
const SECRET = process.env.GAME_SERVER_SECRET || '';
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN || WORKERS_ORIGIN || '*';
const ENV = { M2_DEV: process.env.M2_DEV || '', CLERK_PUBLISHABLE_KEY: process.env.CLERK_PUBLISHABLE_KEY || '' };

/* ================= 上限(スクリプトによる接続の殺到でVMを落とさないための防波堤) =================
 * VMは月額固定なので「請求が爆発する」ことはないが、部屋と接続は無限には作らせない。
 * 上限に当たった接続は拒否するだけで、進行中の試合には影響しない。 */
const MAX_ROOMS        = Number(process.env.MAX_ROOMS || 40);         // 同時ルーム数(40 = 240人)
const MAX_CONNS        = Number(process.env.MAX_CONNS || 300);        // 同時接続の総数
const MAX_CONNS_PER_IP = Number(process.env.MAX_CONNS_PER_IP || 6);   // 同一IPからの同時接続
const JOIN_BURST       = Number(process.env.JOIN_BURST || 12);        // 同一IPの10秒あたりの接続試行
const BURST_WINDOW_MS  = 10_000;

const conns = { total: 0, byIp: new Map() };
const joinLog = new Map();  // ip -> [timestamp]

// Caddyが前段にいる前提。直接公開する場合はX-Forwarded-Forを信じないこと
const clientIp = (req) => {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
};
function burstExceeded(ip) {
  const now = Date.now();
  const arr = (joinLog.get(ip) || []).filter(t => now - t < BURST_WINDOW_MS);
  arr.push(now);
  joinLog.set(ip, arr);
  if (joinLog.size > 5000) { // 記録自体が肥大しないよう掃除する
    for (const [k, v] of joinLog) if (!v.length || now - v[v.length - 1] > BURST_WINDOW_MS) joinLog.delete(k);
  }
  return arr.length > JOIN_BURST;
}
// 接続数の計上と、切断時の取り消しを1箇所にまとめる
function trackConn(ws, ip) {
  conns.total++;
  conns.byIp.set(ip, (conns.byIp.get(ip) || 0) + 1);
  let released = false;
  const release = () => {
    if (released) return; released = true;
    conns.total--;
    const n = (conns.byIp.get(ip) || 1) - 1;
    if (n > 0) conns.byIp.set(ip, n); else conns.byIp.delete(ip);
  };
  ws.on('close', release);
  ws.on('error', release);
}

const ForestRoom = defineForestRoom(NodeRoom);

/* ================= RoomHub: ルームの生成・ローテーション・Registry中継 =================
 * DO版では Registry DO がこの役目(assign/rotate)を持っていたが、Node版は全ルームが
 * 1プロセス内にあるのでメモリ上で完結する(=マッチメイキングの往復がゼロになる)。 */
class RoomHub {
  constructor() {
    this.rooms = new Map();   // roomName -> ForestRoom
    this.cursor = 'forest-1'; // 現在の受付ルーム
    this.seq = 1;
  }
  get(name) { return this.rooms.get(name) || null; }
  get full() { return this.rooms.size >= MAX_ROOMS; }
  remove(name) { this.rooms.delete(name); }
  rotate(lockedName) {
    if (this.cursor !== lockedName) return;         // すでに次へ回っている
    this.cursor = 'forest-' + (++this.seq);
  }
  /** 現在の受付ルーム(なければ作る)。ルーム数の上限に当たったら null */
  current() {
    let r = this.rooms.get(this.cursor);
    if (!r) {
      if (this.full) return null;
      r = new ForestRoom(this, this.cursor, ENV);
      this.rooms.set(this.cursor, r);
      try { r.onCreate(); } catch (e) { console.error('[hub] onCreate', e); }
    }
    return r;
  }
  /** RP永続化・累計RP取得は Workers 側(Registry DO)へ中継する。
   *  試合終了時と参加時の1回だけなので、往復の遅さはゲーム体験に影響しない。 */
  async registryFetch(method, path, body) {
    if (!WORKERS_ORIGIN) throw new Error('WORKERS_ORIGIN unset');
    const res = await fetch(`${WORKERS_ORIGIN}/api/gs${path}`, {
      method,
      headers: { 'X-GS-Secret': SECRET, 'Content-Type': 'application/json' },
      body: body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
    });
    if (!res.ok) throw new Error('registry ' + res.status);
    return res;
  }
}
const hub = new RoomHub();

/* ================= HTTP(ヘルスチェック + 復帰可否) ================= */
const cors = (res) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOW_ORIGIN);
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');
};
const json = (res, obj, status = 200) => {
  cors(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { cors(res); res.writeHead(204); res.end(); return; }
  // 稼働確認(Caddy/監視/デプロイスクリプトが叩く)
  if (url.pathname === '/health') {
    return json(res, {
      ok: true,
      rooms: hub.rooms.size, maxRooms: MAX_ROOMS,
      clients: [...hub.rooms.values()].reduce((n, r) => n + r.clients.length, 0),
      conns: conns.total, maxConns: MAX_CONNS,
    });
  }
  // 前の試合にまだ戻れるか(クライアントの「続きから/新しく始める」出し分け)
  if (url.pathname === '/api/resume') {
    const token = url.searchParams.get('token') || '';
    const roomName = token.split('.')[0];
    const room = roomName ? hub.get(roomName) : null;
    return json(res, room ? room.resumeStatus(token) : { resumable: false });
  }
  cors(res);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('not found');
});

/* ================= WebSocket(join / reconnect) ================= */
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  const url = new URL(req.url, 'http://x');
  const done = (fn) => wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
    trackConn(ws, ip);
    fn(ws);
  });
  const deny = (code, msg) => { socket.write(`HTTP/1.1 ${code} ${msg}\r\nConnection: close\r\n\r\n`); socket.destroy(); };

  // ---- 上限チェック(受け入れる前に弾く。進行中の試合には触れない) ----
  const ip = clientIp(req);
  if (conns.total >= MAX_CONNS) return deny(503, 'Server Full');
  if ((conns.byIp.get(ip) || 0) >= MAX_CONNS_PER_IP) return deny(429, 'Too Many Connections');
  if (burstExceeded(ip)) return deny(429, 'Too Many Requests');

  try {
    if (url.pathname === '/reconnect') {
      const token = url.searchParams.get('token') || '';
      const room = hub.get(token.split('.')[0]);
      if (!room) return deny(409, 'reconnection expired');
      return done((ws) => { if (!room.reconnect(ws, token)) { try { ws.close(4009, 'reconnection expired'); } catch { /* noop */ } } });
    }
    if (url.pathname !== '/join') return deny(404, 'Not Found');

    // 本人確認(Workers側 /join と同じロジック・同じ auth.mjs を使う)
    const user = await resolveUser(ENV, url.searchParams.get('token'), url.searchParams.get('guest'));
    let opts = {}; try { opts = JSON.parse(url.searchParams.get('opts') || '{}'); } catch { /* noop */ }
    opts.uid = user.id || '';
    opts.kind = user.kind;

    done((ws) => {
      // 受付ルームが埋まっていたら次のルームへ(DO版の409リトライに相当)
      for (let i = 0; i < 3; i++) {
        const room = hub.current();
        if (!room) break;                      // ルーム数の上限
        opts.room = room.roomName;
        if (room.join(ws, opts)) return;
        hub.rotate(room.roomName);
      }
      try { ws.close(4009, 'no room available'); } catch { /* noop */ }
    });
  } catch (e) {
    console.error('[upgrade]', e);
    deny(500, 'Internal Error');
  }
});

server.listen(PORT, () => {
  console.log(`[mnm] game server on :${PORT}`);
  console.log(`[mnm] workers origin: ${WORKERS_ORIGIN || '(unset — RP永続化は無効)'}`);
  console.log(`[mnm] auth: ${ENV.CLERK_PUBLISHABLE_KEY ? 'clerk enabled' : 'guest only'}`);
  console.log(`[mnm] limits: rooms<=${MAX_ROOMS} conns<=${MAX_CONNS} perIP<=${MAX_CONNS_PER_IP} burst<=${JOIN_BURST}/10s`);
});

// 落とす時は進行中の試合を綺麗に閉じる(再接続トークンを無効化して迷子を作らない)
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => {
  console.log('[mnm] shutting down…');
  for (const r of [...hub.rooms.values()]) { try { r.disconnect(); } catch { /* noop */ } }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
});
