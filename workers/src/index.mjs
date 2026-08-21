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

    // クライアントに認証設定と接続先を渡す(publishable keyは公開情報)
    // gameServer: 試合サーバーのURL。空ならこのWorker自身(DO)に繋ぐ = 従来どおり。
    // 移設のロールバックはこの変数を消すだけでよい(クライアント配布は不要)。
    if (url.pathname === '/api/config') {
      const pk = env.CLERK_PUBLISHABLE_KEY || '';
      return json({ authEnabled: !!issuerFromPublishableKey(pk), clerkPublishableKey: pk,
        gameServer: env.GAME_SERVER_WSS || '' });
    }

    // 外部ゲームサーバー(VM)からRegistryへの中継。共有秘密を持つ相手だけ、
    // RPの読み書きに必要な2経路だけを通す(link/me/assignは通さない = 最小権限)。
    if (url.pathname.startsWith('/api/gs/')) {
      const sub = url.pathname.slice('/api/gs'.length);
      const secret = env.GAME_SERVER_SECRET || '';
      const got = request.headers.get('X-GS-Secret') || '';
      if (!secret || got.length !== secret.length || got !== secret) return new Response('forbidden', { status: 403 });
      if (sub !== '/record' && sub !== '/rp') return new Response('not found', { status: 404 });
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
      return reg.fetch(new Request('https://registry' + sub + url.search, request));
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

    // テスト専用: Registry DOへの直通(M2_DEV=1のときだけ。本番では到達不可)
    if (url.pathname.startsWith('/__reg/') && env.M2_DEV === '1') {
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
      return reg.fetch(new Request('https://registry' + url.pathname.slice(6) + url.search, request));
    }

    // ゲストで貯めた戦績をログイン先アカウントへ引き継ぐ(ログイン直後にクライアントが1回呼ぶ)
    if (url.pathname === '/api/link-guest' && request.method === 'POST') {
      const token = bearer(request) || url.searchParams.get('token');
      const user = await resolveUser(env, token, null);
      if (user.kind !== 'clerk' || !user.id) return json({ linked: false, reason: 'unauthenticated' }, 401);
      let body = {}; try { body = await request.json(); } catch { /* noop */ }
      const guest = typeof body.guest === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(body.guest) ? body.guest : null;
      if (!guest) return json({ linked: false, reason: 'invalid-guest' });
      const reg = env.REGISTRY.get(env.REGISTRY.idFromName('main'));
      return reg.fetch(new Request('https://registry/link', { method: 'POST',
        body: JSON.stringify({ from: 'guest:' + guest, to: user.id, name: body.name }) }));
    }

    // 前の試合にまだ戻れるか(クライアントが「続きから/新規」を出し分けるために使う)
    if (url.pathname === '/api/resume') {
      const token = url.searchParams.get('token') || '';
      const roomName = token.split('.')[0];
      if (!roomName || !/^[a-zA-Z0-9_-]{1,40}$/.test(roomName)) return json({ resumable: false });
      const stub = env.FOREST_ROOM.get(env.FOREST_ROOM.idFromName(roomName));
      return stub.fetch(`https://room/resume-status?token=${encodeURIComponent(token)}`);
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
    // 配置は自動(最初のjoinを処理したエッジの近く)に任せる。locationHintで地域を固定すると、
    // 無料プランで韓国→LAXにルーティングされる場合にエッジ⇔DO間の往復が上乗せされて悪化する
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
