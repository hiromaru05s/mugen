// 夢幻の森 — Clerk セッションJWT検証 (Workers内で完結・シークレット不要)
// Clerkのセッショントークンは RS256 署名。公開JWKSで検証できるので、
// サーバーが持つ必要があるのは publishable key(公開情報)だけ。
// CLERK_PUBLISHABLE_KEY が未設定なら認証オフ(ゲストのみ)で従来どおり遊べる。
'use strict';

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '=='.slice(0, (4 - s.length % 4) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/** publishable key(pk_test_xxx / pk_live_xxx)から発行者(iss)を導出。
 *  キー本体は "<frontend-api-domain>$" のbase64。 */
export function issuerFromPublishableKey(pk) {
  if (typeof pk !== 'string') return null;
  const m = /^pk_(test|live)_(.+)$/.exec(pk.trim());
  if (!m) return null;
  let decoded;
  try { decoded = new TextDecoder().decode(b64urlToBytes(m[2])); } catch { return null; }
  const domain = decoded.replace(/\$+$/, '').trim();
  if (!domain || !/^[a-zA-Z0-9.-]+$/.test(domain)) return null;
  return 'https://' + domain;
}

// JWKSはkid単位でキャッシュ(Clerkの鍵はめったに回らない。失敗時のみ再取得)
const jwksCache = new Map(); // issuer -> {at, keys}
const JWKS_TTL = 10 * 60 * 1000;

async function getJwks(issuer, fetchImpl, force) {
  const hit = jwksCache.get(issuer);
  if (!force && hit && Date.now() - hit.at < JWKS_TTL) return hit.keys;
  const res = await fetchImpl(issuer + '/.well-known/jwks.json');
  if (!res.ok) throw new Error('jwks fetch ' + res.status);
  const body = await res.json();
  const keys = Array.isArray(body.keys) ? body.keys : [];
  jwksCache.set(issuer, { at: Date.now(), keys });
  return keys;
}

/** ClerkセッションJWTを検証して claims を返す。失敗時は null。
 *  opts: {issuer, fetchImpl, now} — テスト用に差し替え可能 */
export async function verifySessionToken(token, opts) {
  const { issuer } = opts || {};
  const fetchImpl = (opts && opts.fetchImpl) || fetch;
  const now = ((opts && opts.now) || Date.now()) / 1000;
  if (!token || typeof token !== 'string' || !issuer) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  let header, claims;
  try { header = b64urlToJson(parts[0]); claims = b64urlToJson(parts[1]); } catch { return null; }
  if (header.alg !== 'RS256' || !header.kid) return null;
  // 発行者の一致確認(別インスタンスのトークンを弾く)
  if (claims.iss !== issuer) return null;
  const LEEWAY = 30; // 時計ずれ許容
  if (typeof claims.exp !== 'number' || claims.exp + LEEWAY < now) return null;
  if (typeof claims.nbf === 'number' && claims.nbf - LEEWAY > now) return null;
  if (!claims.sub) return null;

  const data = new TextEncoder().encode(parts[0] + '.' + parts[1]);
  const sig = b64urlToBytes(parts[2]);
  for (const force of [false, true]) { // 鍵ローテーション直後は1度だけ再取得
    let jwk;
    try { jwk = (await getJwks(issuer, fetchImpl, force)).find(k => k.kid === header.kid); }
    catch { return null; }
    if (!jwk) { if (force) return null; continue; }
    let key;
    try {
      key = await crypto.subtle.importKey('jwk', { ...jwk, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    } catch { return null; }
    if (await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, sig, data)) return claims;
    if (force) return null;
  }
  return null;
}

/** リクエストから認証済みユーザーを解決する。
 *  戻り値: {id, kind:'clerk'|'guest', name} — 認証オフ/未ログインならゲスト。
 *  ゲストIDはクライアント発行の端末トークン(なりすまし防止の最低限)。 */
export async function resolveUser(env, token, guestId) {
  const issuer = issuerFromPublishableKey(env.CLERK_PUBLISHABLE_KEY);
  if (issuer && token) {
    const claims = await verifySessionToken(token, { issuer });
    if (claims) return { id: 'clerk:' + claims.sub, kind: 'clerk', claims };
  }
  const gid = typeof guestId === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(guestId) ? guestId : null;
  return { id: gid ? 'guest:' + gid : null, kind: 'guest' };
}
