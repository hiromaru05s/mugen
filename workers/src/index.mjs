// 夢幻の森 — Workerエントリ
// ルーティング: /join /reconnect = WebSocket → ForestRoom DO / /stats /players.json = Registry DO /
// それ以外は静的アセット(public/ = ゲームクライアント)
'use strict';
export { ForestRoom } from './room.mjs';
export { Registry } from './registry.mjs';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/join') return joinFlow(request, env, url);

    if (url.pathname === '/reconnect') {
      // トークン形式: <roomName>.<sessionId>.<secret> — 先頭からルームDOを特定
      const token = url.searchParams.get('token') || '';
      const roomName = token.split('.')[0];
      if (!roomName) return new Response('bad token', { status: 400 });
      const stub = env.FOREST_ROOM.get(env.FOREST_ROOM.idFromName(roomName));
      return stub.fetch(new Request(`https://room/reconnect?token=${encodeURIComponent(token)}`, request));
    }

    if (url.pathname === '/stats' || url.pathname === '/players.json') {
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
      return reg.fetch(new Request('https://registry' + (url.pathname === '/stats' ? '/' : url.pathname), request));
    }

    return env.ASSETS.fetch(request);
  },
};

// joinOrCreate相当: Registryに現在の受付ルームを聞き、ロック済み(409)なら回して再試行
async function joinFlow(request, env, url) {
  const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
  for (let i = 0; i < 3; i++) {
    const roomName = await (await reg.fetch('https://registry/assign')).text();
    const stub = env.FOREST_ROOM.get(env.FOREST_ROOM.idFromName(roomName));
    const resp = await stub.fetch(new Request(
      `https://room/join?room=${encodeURIComponent(roomName)}&opts=${encodeURIComponent(url.searchParams.get('opts') || '{}')}`,
      request));
    if (resp.status !== 409) return resp;
    await reg.fetch('https://registry/rotate', { method: 'POST', body: roomName });
  }
  return new Response('no room available', { status: 503 });
}
