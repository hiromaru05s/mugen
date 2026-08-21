// ゲスト戦績 → アカウント引き継ぎ(Registry DOの/link)の検証
// Clerkトークンは用意できないのでRegistryを直接叩く(Worker側の401はsmokeで検証済み)
import { spawn } from 'node:child_process';
const PORT = 8799, HTTP = `http://localhost:${PORT}`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const results = [];
const ok = (n, c) => { results.push([c ? 'PASS' : 'FAIL', n]); if (!c) process.exitCode = 1; };

const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--var', 'M2_DEV:1'],
  { env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: '1' }, stdio: 'ignore' });
const stop = () => { try { dev.kill('SIGTERM'); } catch (e) { /* noop */ } };
process.on('exit', stop);
for (let i = 0; i < 60; i++) { try { const r = await fetch(HTTP + '/api/config'); if (r.ok) break; } catch (e) { /* まだ */ } await sleep(1000); }

// Registry DOへ直接: 試合結果を2件記録してから引き継ぐ
const uniq = Math.random().toString(36).slice(2, 8);
const guestId = 'guest:dev' + uniq, clerkId = 'clerk:user_' + uniq;
const rec = (userId, kind, rp, win, cls) => fetch(`${HTTP}/__reg/record`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ players: [{ userId, kind, name: 'テス' + uniq, cls, team: 0, rp, win, share: .5 }],
    meta: { dragonKilled: win, night: false, reason: 'test' } }),
}).then(r => r.json());

await rec(guestId, 'guest', 700, true, 'thief');
await rec(guestId, 'guest', 300, false, 'mage');
const before = await fetch(`${HTTP}/__reg/me?uid=${encodeURIComponent(guestId)}`).then(r => r.json());
ok('ゲストで2試合ぶん記録されている', before.found && before.rp === 1000 && before.matches === 2);

const link = await fetch(`${HTTP}/__reg/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: guestId, to: clerkId, name: 'テス' + uniq }) }).then(r => r.json());
ok('引き継ぎ成功(RP・戦数が移る)', link.linked && link.moved.rp === 1000 && link.total.rp === 1000 && link.total.matches === 2);

const after = await fetch(`${HTTP}/__reg/me?uid=${encodeURIComponent(clerkId)}`).then(r => r.json());
ok('アカウント側に試合履歴も移動', after.found && after.matches === 2 && after.recent.length === 2);
ok('職別統計も引き継がれる', after.byClass.length === 2 && after.byClass.some(c => c.cls === 'thief'));
const gone = await fetch(`${HTTP}/__reg/me?uid=${encodeURIComponent(guestId)}`).then(r => r.json());
ok('ゲスト側の記録は消える(二重計上しない)', gone.found === false);

const again = await fetch(`${HTTP}/__reg/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: guestId, to: clerkId }) }).then(r => r.json());
ok('2回目の引き継ぎは何もしない', again.linked === false);

const bad = await fetch(`${HTTP}/__reg/link`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ from: 'clerk:user_other', to: clerkId }) }).then(r => r.json());
ok('アカウント同士の吸収は拒否', bad.linked === false);

for (const [st, n] of results) console.log(st, n);
console.log(results.every(r => r[0] === 'PASS') ? `LINK ALL PASS (${results.length})` : 'LINK SOME FAILED');
stop(); process.exit();
