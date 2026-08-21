// 夢幻の森 — Workerエントリ
// ルーティング: /join /reconnect = WebSocket → ForestRoom DO /
//   /api/* = 認証・個人戦績 / /stats /leaderboard.json = Registry DO / それ以外は静的アセット
'use strict';
import { resolveUser, issuerFromPublishableKey } from './auth.mjs';
export { ForestRoom } from './room.mjs';
export { Registry } from './registry.mjs';

const json = (o, status) => Response.json(o, { status: status || 200 });

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // クライアントに認証設定を渡す(publishable keyは公開情報)
    if (url.pathname === '/api/config') {
      const pk = env.CLERK_PUBLISHABLE_KEY || '';
      return json({ authEnabled: !!issuerFromPublishableKey(pk), clerkPublishableKey: pk });
    }

    // 個人戦績は本人のみ: トークンを検証し、その本人のuidでしか引けない
    if (url.pathname === '/api/me') {
      const token = bearer(request) || url.searchParams.get('token');
      const user = await resolveUser(env, token, url.searchParams.get('guest'));
      if (!user.id) return json({ found: false, reason: 'unauthenticated' }, 401);
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
      const res = await reg.fetch(`https://registry/me?uid=${encodeURIComponent(user.id)}`);
      const body = await res.json();
      return json({ ...body, kind: user.kind });
    }

    if (url.pathname === '/join') return joinFlow(request, env, url);

    if (url.pathname === '/reconnect') {
      // トークン形式: <roomName>.<sessionId>.<secret> — 先頭からルームDOを特定
      const token = url.searchParams.get('token') || '';
      const roomName = token.split('.')[0];
      if (!roomName) return new Response('bad token', { status: 400 });
      const stub = env.FOREST_ROOM.get(env.FOREST_ROOM.idFromName(roomName));
      return stub.fetch(new Request(`https://room/reconnect?token=${encodeURIComponent(token)}`, request));
    }

    if (url.pathname === '/stats' || url.pathname === '/players.json' || url.pathname === '/leaderboard.json') {
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
      return reg.fetch(new Request('https://registry' + (url.pathname === '/stats' ? '/' : url.pathname), request));
    }

    return env.ASSETS.fetch(request);
  },
};

function bearer(request) {
  const h = request.headers.get('Authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// joinOrCreate相当: Registryに現在の受付ルームを聞き、ロック済み(409)なら回して再試行
async function joinFlow(request, env, url) {
  // 参加時に本人確認(Clerkログイン済みならclerk:sub、未ログインなら端末トークンのゲスト)
  const user = await resolveUser(env, url.searchParams.get('token'), url.searchParams.get('guest'));
  const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
  for (let i = 0; i < 3; i++) {
    const roomName = await (await reg.fetch('https://registry/assign')).text();
    const stub = env.FOREST_ROOM.get(env.FOREST_ROOM.idFromName(roomName));
    const q = new URLSearchParams({
      room: roomName,
      opts: url.searchParams.get('opts') || '{}',
      uid: user.id || '',
      kind: user.kind,
    });
    const resp = await stub.fetch(new Request(`https://room/join?${q}`, request));
    if (resp.status !== 409) return resp;
    await reg.fetch('https://registry/rotate', { method: 'POST', body: roomName });
  }
  return new Response('no room available', { status: 503 });
}
