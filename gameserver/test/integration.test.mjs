// 夢幻の森 — 移設構成の統合テスト
// Workers(静的配信+戦績DB) と Nodeゲームサーバー(試合) を両方立ち上げ、
// 「試合はVMで走り、RPはCloudflare側に永続化される」ことを端から端まで確認する。
// 移設で一番壊れやすいのがこの境界(/api/gs 中継)なので、ここを自動テストで押さえる。
// 実行: npm run test:integration (要 Node 22+ / wrangler)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const GS_PORT = 8804, CF_PORT = 8805;
const GS_WS = `ws://localhost:${GS_PORT}`;
const CF = `http://localhost:${CF_PORT}`;
const gsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const cfDir = path.join(path.dirname(gsDir), 'workers');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SECRET = 'integration-test-secret-0123456789';

const procs = [];
const stopAll = () => { for (const p of procs) { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* noop */ } } };
process.on('exit', stopAll);

/* ---------- 1) Cloudflare Workers(wrangler dev) ---------- */
console.log('[it] starting wrangler dev...');
const cf = spawn('npx', ['wrangler', 'dev', '--port', String(CF_PORT),
  '--var', 'M2_DEV:1', '--var', `GAME_SERVER_SECRET:${SECRET}`, '--var', `GAME_SERVER_WSS:${GS_WS}`],
  { cwd: cfDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
procs.push(cf);
let cfLog = ''; cf.stdout.on('data', d => cfLog += d); cf.stderr.on('data', d => cfLog += d);
let up = false;
for (let i = 0; i < 60 && !up; i++) { await sleep(1000); up = await fetch(CF + '/api/config').then(r => r.ok).catch(() => false); }
if (!up) { console.error('[it] wrangler dev が起動しない:\n' + cfLog.slice(-1500)); process.exit(1); }

/* ---------- 2) Nodeゲームサーバー(VM相当) ---------- */
console.log('[it] starting game server...');
const gs = spawn(process.execPath, ['index.mjs'], {
  cwd: gsDir, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(GS_PORT), M2_DEV: '1', WORKERS_ORIGIN: CF, GAME_SERVER_SECRET: SECRET, ALLOW_ORIGIN: '*' },
});
procs.push(gs);
let gsLog = ''; gs.stdout.on('data', d => gsLog += d); gs.stderr.on('data', d => gsLog += d);
up = false;
for (let i = 0; i < 30 && !up; i++) { await sleep(300); up = await fetch(`http://localhost:${GS_PORT}/health`).then(r => r.ok).catch(() => false); }
if (!up) { console.error('[it] game server が起動しない:\n' + gsLog); process.exit(1); }

const results = [];
const ok = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]); console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) process.exitCode = 1; };

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const handlers = new Map();
    let joined = false;
    const room = { ws, sessionId: null, reconnectionToken: null,
      send: (t, d) => ws.send(JSON.stringify({ t, d })), on: (t, cb) => handlers.set(t, cb) };
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.t === 'joined') { joined = true; room.sessionId = m.d.sessionId; room.reconnectionToken = m.d.reconnectionToken; resolve(room); return; }
      const h = handlers.get(m.t); if (h) h(m.d); };
    ws.onerror = () => { if (!joined) reject(new Error('ws error')); };
    ws.onclose = ev => { if (!joined) reject(new Error('closed ' + ev.code)); };
  });
}

/* ---------- 3) クライアントは /api/config を見て接続先を決める ---------- */
{
  const cfg = await fetch(CF + '/api/config').then(r => r.json());
  ok('/api/config がゲームサーバーのURLを配る', cfg.gameServer === GS_WS);
}

/* ---------- 4) /api/gs 中継は共有秘密が要る(最小権限) ---------- */
{
  const noSecret = await fetch(`${CF}/api/gs/rp?uid=guest:whoever`);
  ok('秘密なしの中継は403', noSecret.status === 403);
  const badSecret = await fetch(`${CF}/api/gs/rp?uid=guest:whoever`, { headers: { 'X-GS-Secret': 'wrong-secret-value-here!!' } });
  ok('誤った秘密の中継は403', badSecret.status === 403);
  const forbidden = await fetch(`${CF}/api/gs/me?uid=guest:whoever`, { headers: { 'X-GS-Secret': SECRET } });
  ok('record/rp 以外の経路は通さない', forbidden.status === 404);
  const good = await fetch(`${CF}/api/gs/rp?uid=guest:nobody-here-0001`, { headers: { 'X-GS-Secret': SECRET } });
  ok('正しい秘密ならRP照会が通る', good.ok);
}

/* ---------- 5) 試合はVMで走り、RPはCloudflareに残る ---------- */
{
  const uniq = Math.random().toString(36).slice(2, 6);
  const name = 'イセツ' + uniq;
  const guest = 'ittoken' + uniq + String(Date.now());
  const room = await connect(`${GS_WS}/join?opts=${encodeURIComponent(JSON.stringify({ name, cls: 'warrior' }))}&guest=${guest}`);
  let result = null, fxs = [];
  room.on('result', d => result = d); room.on('fx', d => fxs.push(d));
  room.send('ready'); room.send('start');
  await sleep(500);
  room.send('devTime', { t: 239 });
  await sleep(1600);
  room.send('devTeleport', { x: 80, y: 0 });
  room.send('devDragonHp', { hp: 30 });
  const iv = setInterval(() => room.send('input', { mx: 0, my: 0, atk: true, aim: Math.PI }), 50);
  await sleep(2500); clearInterval(iv);

  ok('VM上で竜討伐まで進行する', !!result && result.dragonKilled === true);
  ok('終了理由はコードで届く(i18n用)', !!result && result.reasonCode === 'dragon');
  const me = result && result.players.find(p => p.name === name);
  ok('RP精算がVM→Cloudflare往復で成立する', !!me && me.rp > 0 && me.totalRp === me.rp && me.matches === 1 && !!me.rank);

  const board = await fetch(CF + '/leaderboard.json').then(r => r.json());
  const row = board.find(r => r.name === name);
  ok('Cloudflare側のランキングに永続化されている', !!row && row.rp === me.totalRp);

  const mine = await fetch(`${CF}/api/me?guest=${guest}`).then(r => r.json());
  ok('戦績ページ(/api/me)からも見える', mine.found && mine.rp === me.totalRp && mine.matches === 1);
  room.ws.close();
}

console.log(results.every(r => r[0] === 'PASS') ? `ALL PASS (${results.length})` : 'SOME FAILED');
stopAll();
process.exit(process.exitCode || 0);
