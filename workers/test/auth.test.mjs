// Clerk JWT検証の単体テスト — 実インスタンス無しで検証経路を証明する
// 自前でRSA鍵を生成しJWTを署名 → JWKSをスタブして verifySessionToken に通す
import { issuerFromPublishableKey, verifySessionToken } from '../src/auth.mjs';

const results = [];
const ok = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]); if (!cond) process.exitCode = 1; };
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const ISS = 'https://clean-mayfly-62.clerk.accounts.dev';
const KID = 'ins_test_key_1';

const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
  true, ['sign', 'verify']);
const jwk = { ...(await crypto.subtle.exportKey('jwk', publicKey)), kid: KID };
const jwks = { keys: [jwk] };
let jwksHits = 0;
const fetchImpl = async (url) => {
  jwksHits++;
  if (!url.startsWith(ISS)) throw new Error('unexpected jwks url: ' + url);
  return { ok: true, json: async () => jwks };
};

async function mkToken(claims, { kid = KID, alg = 'RS256', badSig = false } = {}) {
  const h = b64url(JSON.stringify({ alg, typ: 'JWT', kid }));
  const p = b64url(JSON.stringify(claims));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(h + '.' + p));
  const s = badSig ? b64url(new Uint8Array(256)) : b64url(sig);
  return `${h}.${p}.${s}`;
}
const now = Date.now();
const base = { iss: ISS, sub: 'user_2abcDEF', exp: now / 1000 + 3600, iat: now / 1000, azp: 'https://example.com' };
const V = (t, extra) => verifySessionToken(t, { issuer: ISS, fetchImpl, now, ...extra });

// --- 正常系 ---
const good = await mkToken(base);
const claims = await V(good);
ok('有効なトークンを検証できる', !!claims && claims.sub === 'user_2abcDEF');
const hitsBefore = jwksHits; await V(good);
ok('JWKSがキャッシュされる(2回目はfetchしない)', jwksHits === hitsBefore);

// --- 異常系(すべてnullで拒否されること) ---
ok('署名改ざんを拒否', await V(await mkToken(base, { badSig: true })) === null);
ok('別インスタンス発行(iss不一致)を拒否', await V(await mkToken({ ...base, iss: 'https://evil.clerk.accounts.dev' })) === null);
ok('期限切れを拒否', await V(await mkToken({ ...base, exp: now / 1000 - 120 })) === null);
ok('nbf未達を拒否', await V(await mkToken({ ...base, nbf: now / 1000 + 600 })) === null);
ok('alg=noneを拒否', await V(await mkToken(base, { alg: 'none' })) === null);
ok('未知のkidを拒否', await V(await mkToken(base, { kid: 'unknown_kid' })) === null);
ok('sub欠落を拒否', await V(await mkToken({ ...base, sub: undefined })) === null);
ok('壊れたトークンを拒否', await V('not.a.jwt') === null && await V('') === null && await V(null) === null);
ok('issuer未設定なら常に拒否(認証オフ時の誤許可なし)', await verifySessionToken(good, { issuer: null, fetchImpl }) === null);
// ペイロードだけ差し替えた偽造(署名は元のまま)
const forged = (() => { const [h, , s] = good.split('.'); return `${h}.${b64url(JSON.stringify({ ...base, sub: 'user_ADMIN' }))}.${s}`; })();
ok('ペイロード差し替え偽造を拒否', await V(forged) === null);

// --- publishable key → issuer 導出 ---
ok('pk_test_からissuerを導出', issuerFromPublishableKey('pk_test_' + Buffer.from('clean-mayfly-62.clerk.accounts.dev$').toString('base64url')) === ISS);
ok('pk_live_からissuerを導出', issuerFromPublishableKey('pk_live_' + Buffer.from('clerk.example.com$').toString('base64url')) === 'https://clerk.example.com');
ok('不正なpkはnull', ['garbage', '', null, 'pk_test_@@@'].every(v => issuerFromPublishableKey(v) === null));

for (const [st, name] of results) console.log(st, name);
const passed = results.every(r => r[0] === 'PASS');
console.log(passed ? `AUTH ALL PASS (${results.length})` : 'AUTH SOME FAILED');
