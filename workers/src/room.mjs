// 夢幻の森 — Cloudflare Workers版サーバー (m3/server/index.js の移植)
// 1試合 = 1つのDurable Object。ColyseusのRoom APIを薄いシム(下のRoomクラス)で模倣し、
// ゲームロジック(m3と同一)はほぼ無改変で載せている。
// m3との差分: RP永続化はRegistry DO(SQLiteストレージ)へ委譲 / config.jsonはバンドル同梱 /
// 通信はJSON {t:type, d:data} の素のWebSocket(クライアント側は public/net.js のシムが吸収)
'use strict';
import { DurableObject } from 'cloudflare:workers';

const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 12);

/* ================= Colyseus Roomシム =================
 * m3コードが使うAPIだけを実装:
 * onCreate/onJoin/onLeave/onMessage/broadcast/lock/allowReconnection/
 * setSimulationInterval/setPatchRate/clock.setTimeout/disconnect/clients/maxClients
 * client: { sessionId, send(type,data) }
 */
import { defineForestRoom } from './game.mjs';

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
  matchLeft() { return 0; } // ゲーム側でオーバーライド(シムはルールを知らない)
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
      // 往復遅延(ping)計測: ゲームロジックを通さず即エコー = 純粋な通信遅延が測れる
      if (m && m.t === 'rtt') { client.send('rtt', m.d); return; }
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
    // 復帰可否の問い合わせ(WebSocketを張らずに「まだ前の試合に戻れるか」を返す)
    if (url.pathname === '/resume-status') return this._resumeStatus(url);
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
  _resumeStatus(url) {
    const token = url.searchParams.get('token') || '';
    const [, sessionId, secret] = token.split('.');
    const wait = sessionId ? this._reconnectWaits.get(sessionId) : null;
    // 再接続の受付が生きていて、かつトークンが一致する時だけ「戻れる」
    if (!wait || !secret || this._tokens.get(sessionId) !== secret) return Response.json({ resumable: false });
    const u = this.units.get(sessionId);
    return Response.json({
      resumable: true,
      name: u ? String(u.name).replace('(切断)', '') : '',
      cls: u ? u.cls : '', team: u ? u.team : -1,
      dead: u ? !!u.dead : false, downed: u ? !!u.downed : false,
      phase: this.phase,
      left: this.matchLeft(), // 試合の残り秒(ゲーム側が答える)
    });
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

// ゲーム本体は game.mjs と共有(Node版サーバーと同一コード)
export const ForestRoom = defineForestRoom(Room);
