// 夢幻の森 — colyseus.jsの代替シム(Workers版サーバー用)
// クライアントコードが使うAPIだけを素のWebSocket+JSONで再現する:
//   new Colyseus.Client(endpoint) / client.joinOrCreate(name, opts) / client.reconnect(token)
//   room.send(type, data) / room.onMessage(type, cb) / room.reconnectionToken / room.leave()
// メッセージ形式はサーバーと同じ {t: type, d: data}
'use strict';
(function () {
  function connect(url) {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      const handlers = new Map();
      let joined = false;
      const room = {
        sessionId: null,
        reconnectionToken: null,
        send(type, data) { if (ws.readyState === 1) ws.send(JSON.stringify({ t: type, d: data })); },
        onMessage(type, cb) { handlers.set(type, cb); },
        leave() { try { ws.close(1000); } catch (e) { /* noop */ } },
      };
      ws.onmessage = ev => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.t === 'joined') { // サーバーからの参加ハンドシェイク
          joined = true;
          room.sessionId = m.d.sessionId;
          room.reconnectionToken = m.d.reconnectionToken;
          resolve(room);
          return;
        }
        const h = handlers.get(m.t);
        if (h) h(m.d);
      };
      ws.onerror = () => { if (!joined) reject(new Error('接続に失敗しました')); };
      ws.onclose = ev => { if (!joined) reject(new Error('接続が閉じられました: ' + ev.code)); };
    });
  }
  window.Colyseus = {
    Client: class {
      constructor(endpoint) { this.endpoint = String(endpoint || '').replace(/\/+$/, ''); }
      joinOrCreate(roomName, opts, extraQuery) {
        const q = `opts=${encodeURIComponent(JSON.stringify(opts || {}))}` + (extraQuery ? '&' + extraQuery : '');
        return connect(`${this.endpoint}/join?${q}`);
      }
      reconnect(token) {
        return connect(`${this.endpoint}/reconnect?token=${encodeURIComponent(token || '')}`);
      }
    },
  };
})();
