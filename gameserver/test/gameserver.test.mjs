// 夢幻の森 — Node版ゲームサーバーのスモークテスト(自己完結: サーバーを起動→検証→停止)
// 目的は「Workers版(DO)と同じ挙動で試合が回ること」の確認。移設で仕様が変わっていないかを守る。
// 実行: npm test (要 Node 22+)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 8802;
const EP = `ws://localhost:${PORT}`;
const HTTP = `http://localhost:${PORT}`;
const cwd = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const sleep = ms => new Promise(r => setTimeout(r, ms));

const srv = spawn(process.execPath, ['index.mjs'], {
  cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PORT: String(PORT), M2_DEV: '1', WORKERS_ORIGIN: '', ALLOW_ORIGIN: '*',
    MAX_CONNS_PER_IP: '50', JOIN_BURST: '200' },
});
let log = '';
srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const procs2 = [];  // 上限テスト用に追加で立てるサーバー
const stop = () => {
  try { process.kill(-srv.pid, 'SIGKILL'); } catch { /* noop */ }
  for (const p of procs2) { try { process.kill(-p.pid, 'SIGKILL'); } catch { /* noop */ } }
};
process.on('exit', stop);

let up = false;
for (let i = 0; i < 30 && !up; i++) {
  await sleep(300);
  up = await fetch(HTTP + '/health').then(r => r.ok).catch(() => false);
}
if (!up) { console.error('[gs] サーバーが起動しない:\n' + log); process.exit(1); }

const results = [];
const ok = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]); console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) process.exitCode = 1; };

function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const handlers = new Map();
    let joined = false;
    const room = { ws, sessionId: null, reconnectionToken: null,
      send: (t, d) => ws.send(JSON.stringify({ t, d })),
      on: (t, cb) => handlers.set(t, cb) };
    ws.onmessage = ev => { const m = JSON.parse(ev.data);
      if (m.t === 'joined') { joined = true; room.sessionId = m.d.sessionId; room.reconnectionToken = m.d.reconnectionToken; resolve(room); return; }
      const h = handlers.get(m.t); if (h) h(m.d); };
    ws.onerror = () => { if (!joined) reject(new Error('ws error')); };
    ws.onclose = ev => { if (!joined) reject(new Error('closed ' + ev.code)); };
  });
}
const join = (opts, guest) => connect(
  `${EP}/join?opts=${encodeURIComponent(JSON.stringify(opts))}&guest=${encodeURIComponent(guest || 'gs-test-guest-0001')}`);

/* ---------- 1) 参加〜試合の基本動作(Workers版と同じ期待値) ---------- */
{
  const room = await join({ name: 'ノード', cls: 'ranger', skin: 2 });
  ok('join + handshake', !!room.sessionId && room.reconnectionToken.split('.').length === 3);

  let init = null, snaps = [], fxs = [], team = -1;
  room.on('init', d => init = d); room.on('snap', d => snaps.push(d));
  room.on('fx', d => fxs.push(d)); room.on('team', d => team = d.team);
  room.send('ready');
  await sleep(1200);
  ok('init受信(map/skills/宝箱座標)', !!init && init.mapR === 1400 && init.skills.length === 4 && Array.isArray(init.chests) && init.chests.length > 0);
  ok('lobby snap + roster', snaps.length >= 2 && snaps.at(-1).phase === 'lobby' && snaps.at(-1).roster.some(r => r.name === 'ノード'));

  const lobbyN0 = snaps.length; await sleep(1000);
  const lobbyHz = snaps.length - lobbyN0;
  ok(`ロビーは4Hz間引き (${lobbyHz}/s)`, lobbyHz >= 2 && lobbyHz <= 7);

  room.send('start');
  await sleep(800);
  const s = snaps.at(-1);
  ok('マッチ開始 phase=live + team通知', s.phase === 'live' && team >= 0);
  const mine = s.units.filter(u => u.team === team);
  ok('自チーム3人(Bot2補充)', mine.length === 3 && mine.filter(u => u.bot).length === 2);
  ok('敵チームは露見中以外は非送信', s.units.every(u => u.team === team || u.reveal || u.mark));
  ok('matchStart fx', fxs.some(f => f.kind === 'matchStart'));
  ok('宝箱・装置はフラグ配列(帯域最適化)', Array.isArray(s.chests) && typeof s.chests[0] === 'number' && typeof s.gimmicks[0] === 'number');

  const me0 = s.units.find(u => u.id === room.sessionId);
  const iv = setInterval(() => room.send('input', { mx: -1, my: -1, atk: false, aim: 0 }), 50);
  await sleep(1200); clearInterval(iv);
  const me1 = snaps.at(-1).units.find(u => u.id === room.sessionId);
  ok('入力で自機が移動', me0 && me1 && Math.hypot(me1.x - me0.x, me1.y - me0.y) > 50);

  room.send('cast', { slot: 1, tx: me1.x + 100, ty: me1.y });
  await sleep(300);
  ok('cast fx受信', fxs.some(f => f.kind === 'cast' && f.cls === 'ranger'));

  const n0 = snaps.length; await sleep(1000);
  const hz = snaps.length - n0;
  ok(`live snapレート ${hz}/s (16-24許容)`, hz >= 16 && hz <= 24);

  let pong = null; room.on('rtt', d => pong = d);
  room.send('rtt', { ts: 12345.5 });
  await sleep(200);
  ok('rttは同じts値を即エコーする', !!pong && pong.ts === 12345.5);

  /* ---------- 2) 切断 → Bot代行 → 再接続 ---------- */
  const token = room.reconnectionToken;
  const before = await fetch(`${HTTP}/api/resume?token=${encodeURIComponent(token)}`).then(r => r.json());
  ok('接続中は復帰対象にならない', before.resumable === false);

  room.ws.close();
  await sleep(500);
  const st = await fetch(`${HTTP}/api/resume?token=${encodeURIComponent(token)}`).then(r => r.json());
  ok('切断後は「続きから」が選べる', st.resumable === true && st.phase === 'live');
  ok('復帰情報に名前・職・残り時間が入る',
    st.name === 'ノード' && st.cls === 'ranger' && st.left > 0 && st.left <= 480);

  const bogus = await fetch(`${HTTP}/api/resume?token=forest-1.deadbeef.deadbeef`).then(r => r.json());
  ok('他人/無効なトークンでは復帰できない', bogus.resumable === false);

  const room2 = await connect(`${EP}/reconnect?token=${encodeURIComponent(token)}`);
  let snaps2 = [];
  room2.on('snap', d => snaps2.push(d));
  await sleep(600);
  ok('再接続でsessionId維持 + snap再開', room2.sessionId === room.sessionId && snaps2.length > 3);
  const meBack = snaps2.at(-1).units.find(u => u.id === room2.sessionId);
  ok('再接続で(切断)ラベル解除', meBack && !String(meBack.name).includes('切断'));

  const after = await fetch(`${HTTP}/api/resume?token=${encodeURIComponent(token)}`).then(r => r.json());
  ok('復帰後はもう「続きから」が出ない', after.resumable === false);

  /* ---------- 3) ルームローテーション(開始済みの部屋には入らない) ---------- */
  const room3 = await join({ name: '次の人', cls: 'mage' }, 'gs-test-guest-0002');
  let init3 = null; room3.on('init', d => init3 = d);
  room3.send('ready');
  await sleep(600);
  ok('開始済みルームには入らず新しいロビーへ', !!init3 && room3.reconnectionToken.split('.')[0] !== token.split('.')[0]);
  room3.ws.close(); room2.ws.close();
}

/* ---------- 4) ヘルスチェック ---------- */
{
  const h = await fetch(HTTP + '/health').then(r => r.json());
  ok('/health が稼働状況を返す', h.ok === true && typeof h.rooms === 'number' && h.maxRooms > 0);
}

/* ---------- 5) 上限(接続が殺到してもサーバーを落とさない) ----------
 * 別プロセスをきつい上限で立ち上げて、実際に弾かれることを確かめる。
 * 「効いていない防波堤」を防ぐためのテスト。 */
{
  const P2 = 8806;
  const srv2 = spawn(process.execPath, ['index.mjs'], {
    cwd, detached: true, stdio: 'ignore',
    env: { ...process.env, PORT: String(P2), WORKERS_ORIGIN: '', ALLOW_ORIGIN: '*',
      MAX_CONNS_PER_IP: '2', MAX_ROOMS: '1', JOIN_BURST: '100' },
  });
  procs2.push(srv2);
  let up2 = false;
  for (let i = 0; i < 30 && !up2; i++) { await sleep(300); up2 = await fetch(`http://localhost:${P2}/health`).then(r => r.ok).catch(() => false); }
  ok('上限つきサーバーが起動する', up2);

  const mk = n => connect(`ws://localhost:${P2}/join?opts=${encodeURIComponent(JSON.stringify({ name: 'cap' + n, cls: 'thief' }))}&guest=captest000${n}`);
  const a = await mk(1), b = await mk(2);
  ok('上限内の接続は通る', !!a.sessionId && !!b.sessionId);

  let denied = false;
  try { await mk(3); } catch { denied = true; }
  ok('同一IPの同時接続が上限を超えたら拒否される', denied);

  a.ws.close(); await sleep(300);
  const c = await mk(4).catch(() => null);
  ok('切断すると枠が戻る(数え漏れがない)', !!c && !!c.sessionId);

  const h2 = await fetch(`http://localhost:${P2}/health`).then(r => r.json());
  ok('/health が接続数を報告する', h2.conns >= 2 && h2.maxConns > 0);
  b.ws.close(); if (c) c.ws.close();
  try { process.kill(-srv2.pid, 'SIGKILL'); } catch { /* noop */ }
}

console.log(results.every(r => r[0] === 'PASS') ? `ALL PASS (${results.length})` : 'SOME FAILED');
stop();
process.exit(process.exitCode || 0);
