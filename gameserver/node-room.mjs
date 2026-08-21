// 夢幻の森 — Roomシム(Node/ws版)
// workers/src/room.mjs の Durable Object 版と同じAPIを、素のNode + ws で提供する。
// ゲーム本体(workers/src/game.mjs)はこのシムの上にそのまま載る = ルールが2重管理にならない。
'use strict';
import { randomUUID } from 'node:crypto';

export const rid = () => randomUUID().replace(/-/g, '').slice(0, 12);

/** DO版 Room と同じインターフェース:
 *  onCreate/onJoin/onLeave/onMessage/broadcast/lock/allowReconnection/
 *  setSimulationInterval/setPatchRate/clock.setTimeout/disconnect/clients/maxClients
 *  差分は「DOの寿命管理」が「親プロセスのMapからの登録解除」になる点だけ。 */
export class NodeRoom {
  constructor(hub, roomName, env) {
    this.hub = hub;             // 親(RoomHub): ルーム一覧・ローテーション・Registry中継
    this.env = env;             // { M2_DEV, ... } DO版の env と同じ読み方ができるように
    this.roomName = roomName;
    this.roomId = roomName;
    this.clients = [];
    this._handlers = new Map();
    this._tokens = new Map();          // sessionId -> 再接続secret
    this._reconnectWaits = new Map();  // sessionId -> {client, resolve, reject}
    this.locked = false;
    this.maxClients = Infinity;
    this._sim = null;
    this._timers = new Set();
    this.clock = {
      setTimeout: (fn, ms) => {
        const t = setTimeout(() => { this._timers.delete(t); fn(); }, ms);
        this._timers.add(t);
        return t;
      },
    };
  }
  setPatchRate() { /* Schema同期は使わない */ }
  matchLeft() { return 0; } // ゲーム側でオーバーライド
  setSimulationInterval(fn, ms) {
    if (this._sim) clearInterval(this._sim);
    this._sim = setInterval(() => {
      try { fn(); } catch (e) { console.error('[room] sim', this.roomName, e); }
    }, ms);
  }
  onMessage(type, cb) { this._handlers.set(type, cb); }
  broadcast(type, data) {
    const s = JSON.stringify({ t: type, d: data });
    for (const c of this.clients) c._raw(s);
  }
  lock() {
    if (this.locked) return;
    this.locked = true;
    this.hub.rotate(this.roomName);   // 次の参加者は新しいルームへ
  }
  allowReconnection(client, seconds) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this._reconnectWaits.delete(client.sessionId);
        reject(new Error('reconnection timeout'));
      }, seconds * 1000);
      this._reconnectWaits.set(client.sessionId, {
        client,
        resolve: () => { clearTimeout(timer); this._reconnectWaits.delete(client.sessionId); resolve(client); },
        reject: (e) => { clearTimeout(timer); this._reconnectWaits.delete(client.sessionId); reject(e || new Error('cancelled')); },
      });
    });
  }
  disconnect() {
    for (const c of [...this.clients]) { try { c._ws.close(1000, 'room disposed'); } catch { /* noop */ } }
    this._dispose();
  }
  _dispose() {
    if (this._sim) { clearInterval(this._sim); this._sim = null; }
    for (const t of this._timers) clearTimeout(t);
    this._timers.clear();
    for (const w of [...this._reconnectWaits.values()]) w.reject(new Error('room disposed'));
    this._reconnectWaits.clear();
    this.clients = [];
    this._tokens.clear();
    this._handlers.clear();
    this.hub.remove(this.roomName);   // DO版の「_created=false」に相当
  }
  // Registry(Cloudflare側)への中継。DO版の this.env.REGISTRY バインディングに相当する
  async _registryFetch(method, path, body) { return this.hub.registryFetch(method, path, body); }

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
    ws.on('message', (buf) => {
      if (client._ws !== ws) return; // 再接続で置き換わった旧ソケット
      let m; try { m = JSON.parse(String(buf)); } catch { return; }
      // 往復遅延(ping)計測: ゲームロジックを通さず即エコー
      if (m && m.t === 'rtt') { client.send('rtt', m.d); return; }
      const h = this._handlers.get(m && m.t);
      if (h) { try { h(client, m.d); } catch (e) { console.error('[room] handler', m && m.t, e); } }
    });
    let goneOnce = false;
    const gone = () => { if (goneOnce) return; goneOnce = true; this._onSocketGone(client, ws); };
    ws.on('close', gone);
    ws.on('error', gone);
  }
  async _onSocketGone(client, ws) {
    if (client._ws !== ws) return; // すでに新ソケットへ再接続済み
    const i = this.clients.indexOf(client);
    if (i >= 0) this.clients.splice(i, 1);
    try { await this.onLeave(client, false); } catch { /* 再接続タイムアウト等 */ }
    if (this.clients.length === 0 && this.phase === 'lobby') this._dispose();
  }

  /* ---- 接続受け口(DO版 fetch() 相当。HTTPではなく直接呼ばれる) ---- */
  /** 新規join。満室/開始済みなら null を返す(呼び出し側が次のルームへ回す) */
  join(ws, opts) {
    if (this.locked || this.phase !== 'lobby' || this.clients.length >= this.maxClients) return null;
    const sessionId = rid(), secret = rid();
    this._tokens.set(sessionId, secret);
    const client = this._mkClient(ws, sessionId);
    this._attach(client, ws);
    this.clients.push(client);
    try { this.onJoin(client, opts); } catch (e) { console.error('[room] onJoin', e); }
    client.send('joined', { sessionId, reconnectionToken: `${this.roomName}.${sessionId}.${secret}` });
    return client;
  }
  /** 再接続。トークンが一致し受付が生きている時だけ成功 */
  reconnect(ws, token) {
    const [, sessionId, secret] = String(token || '').split('.');
    const wait = this._reconnectWaits.get(sessionId);
    if (!wait || !secret || this._tokens.get(sessionId) !== secret) return null;
    const client = wait.client;
    this._attach(client, ws);
    this.clients.push(client);
    wait.resolve();
    client.send('joined', { sessionId, reconnectionToken: token });
    return client;
  }
  /** 「まだ前の試合に戻れるか」(WebSocketを張らずに問い合わせる) */
  resumeStatus(token) {
    const [, sessionId, secret] = String(token || '').split('.');
    const wait = sessionId ? this._reconnectWaits.get(sessionId) : null;
    if (!wait || !secret || this._tokens.get(sessionId) !== secret) return { resumable: false };
    const u = this.units.get(sessionId);
    return {
      resumable: true,
      name: u ? String(u.name).replace('(切断)', '') : '',
      cls: u ? u.cls : '', team: u ? u.team : -1,
      dead: u ? !!u.dead : false, downed: u ? !!u.downed : false,
      phase: this.phase,
      left: this.matchLeft(),
    };
  }
}
