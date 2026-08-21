// 夢幻の森 Workers版 スモークテスト(自己完結: wrangler devを起動→検証→停止)
// 実行: npm test (要 Node 22+ = ネイティブWebSocket)
// 検証: 参加/ロビー/Bot補充3v3/入力/スキル/20Hzスナップ/ロビー4Hz間引き/切断→再接続/
//       ルームローテーション/竜討伐→RP精算→永続化→2戦目加算/戦績ページ
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const PORT = 8799;
const EP = `ws://localhost:${PORT}`;
const HTTP = `http://localhost:${PORT}`;
const cwd = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---------- wrangler dev 起動(テスト用チート有効) ---------- */
console.log('[smoke] starting wrangler dev...');
const dev = spawn('npx', ['wrangler', 'dev', '--port', String(PORT), '--var', 'M2_DEV:1'],
  { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } });
let devLog = '';
dev.stdout.on('data', d => devLog += d);
dev.stderr.on('data', d => devLog += d);
const stopDev = () => { try { process.kill(-dev.pid, 'SIGTERM'); } catch { /* noop */ } };
process.on('exit', stopDev);

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await sleep(1000);
  up = await fetch(HTTP + '/').then(r => r.ok).catch(() => false);
}
if (!up) { console.error('[smoke] wrangler dev が起動しない:\n' + devLog.slice(-2000)); process.exit(1); }
console.log('[smoke] dev server ready');

/* ---------- 共通: 接続ヘルパ(public/net.jsと同じプロトコル) ---------- */
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
// guest= は端末トークン(本人識別)。戦績はこのIDに紐づいて記録される
const join = (opts, guest) => connect(
  `${EP}/join?opts=${encodeURIComponent(JSON.stringify(opts))}&guest=${encodeURIComponent(guest || 'smoketestdevice01')}`);
const results = [];
const ok = (name, cond) => { results.push([cond ? 'PASS' : 'FAIL', name]); console.log(cond ? 'PASS' : 'FAIL', name); if (!cond) process.exitCode = 1; };
const uniq = Math.random().toString(36).slice(2, 6); // 永続DBに依存しないユニーク名

/* ---------- 1) 参加〜マッチ基本動作 ---------- */
{
  const room = await join({ name: 'スモ' + uniq, cls: 'ranger', skin: 2 });
  ok('join + handshake', !!room.sessionId && room.reconnectionToken.split('.').length === 3);
  let init = null, snaps = [], fxs = [], team = -1;
  room.on('init', d => init = d); room.on('snap', d => snaps.push(d));
  room.on('fx', d => fxs.push(d)); room.on('team', d => team = d.team);
  room.send('ready');
  await sleep(1200);
  ok('init受信(map/skills)', !!init && init.mapR === 1400 && init.skills.length === 4);
  ok('lobby snap + roster', snaps.length >= 2 && snaps.at(-1).phase === 'lobby' && snaps.at(-1).roster.some(r => r.name === 'スモ' + uniq));
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

  // 切断→Bot代行→再接続。まず「続きから/新規」の出し分け用に復帰可否を確認する
  const token = room.reconnectionToken;
  const beforeCut = await fetch(`${HTTP}/api/resume?token=${encodeURIComponent(token)}`).then(r => r.json());
  ok('接続中は復帰対象にならない', beforeCut.resumable === false);
  room.ws.close();
  await sleep(500);
  const st = await fetch(`${HTTP}/api/resume?token=${encodeURIComponent(token)}`).then(r => r.json());
  ok('切断後は「続きから」が選べる', st.resumable === true && st.phase === 'live');
  ok('復帰情報に名前・職・残り時間が入る',
    st.name === 'スモ' + uniq && !st.name.includes('切断') && st.cls === 'ranger' && st.left > 0 && st.left <= 480);
  const bogus = await fetch(`${HTTP}/api/resume?token=forest-1.deadbeef.deadbeef`).then(r => r.json());
  ok('他人/無効なトークンでは復帰できない', bogus.resumable === false);
  const room2 = await connect(`${EP}/reconnect?token=${encodeURIComponent(token)}`);
  let snap2 = null; room2.on('snap', d => snap2 = d);
  room2.send('ready');
  await sleep(800);
  ok('再接続でsessionId維持+snap再開', room2.sessionId === room.sessionId && !!snap2 && snap2.phase === 'live');
  const meR = snap2.units.find(u => u.id === room2.sessionId);
  ok('再接続で(切断)ラベル解除', meR && !meR.name.includes('切断'));
  const after = await fetch(`${HTTP}/api/resume?token=${encodeURIComponent(token)}`).then(r => r.json());
  ok('復帰後はもう「続きから」が出ない', after.resumable === false);

  // ロック後のjoinは新ルームへ(joinFlowのローテーション)
  const roomB = await join({ name: 'ふたりめ', cls: 'mage' });
  let snapB = null; roomB.on('snap', d => snapB = d);
  roomB.send('ready');
  await sleep(1000);
  ok('ロック後のjoinは新ルームのロビーへ', !!snapB && snapB.phase === 'lobby' && snapB.roster.length === 1);
  ok('新ルームのトークンは別ルーム名', roomB.reconnectionToken.split('.')[0] !== token.split('.')[0]);
  room2.ws.close(); roomB.ws.close();
  await sleep(300);
}

/* ---------- 2) 竜討伐→RP精算→永続化(DEVチート使用) ---------- */
async function playToDragonKill(name, guest) {
  const room = await join({ name, cls: 'warrior' }, guest);
  let result = null, fxs = [];
  room.on('result', d => result = d); room.on('fx', d => fxs.push(d));
  room.send('ready'); room.send('start');
  await sleep(500);
  room.send('devTime', { t: 239 });        // 封印解除(240s)直前へ
  await sleep(1600);
  room.send('devTeleport', { x: 80, y: 0 }); // 竜(0,0)の傍へ
  room.send('devDragonHp', { hp: 30 });
  const iv = setInterval(() => room.send('input', { mx: 0, my: 0, atk: true, aim: Math.PI }), 50);
  await sleep(2500); clearInterval(iv);
  room.ws.close();
  return { result, fxs };
}
{
  const name = 'リョウ' + uniq;
  const guest = 'devtoken' + uniq + String(Date.now()); // 端末トークン(8文字以上の英数)
  const g1 = await playToDragonKill(name, guest);
  ok('竜出現(unseal fx)', g1.fxs.some(f => f.kind === 'unseal'));
  ok('result受信(竜討伐)', !!g1.result && g1.result.dragonKilled === true);
  const me = g1.result && g1.result.players.find(p => p.name === name);
  ok('RP精算+累計/ランクが返る', me && me.rp > 0 && me.totalRp === me.rp && me.matches === 1 && !!me.rank);
  const pj = await fetch(HTTP + '/leaderboard.json').then(r => r.json());
  const row = pj.find(r => r.name === name);
  ok('Registryに永続化(leaderboard.json)', !!row && row.rp === me.totalRp);
  const mine = await fetch(`${HTTP}/api/me?guest=${guest}`).then(r => r.json());
  ok('/api/me が本人の戦績を返す', mine.found && mine.rp === me.totalRp && mine.matches === 1);
  ok('/api/me に職別統計と試合履歴が入る',
    mine.byClass.some(c => c.cls === 'warrior') && mine.recent.length === 1 && mine.recent[0].rp === me.rp);
  const other = await fetch(`${HTTP}/api/me?guest=someoneelsedevice999`).then(r => r.json());
  ok('他人の端末トークンでは本人戦績が見えない', other.found === false);
  const noauth = await fetch(HTTP + '/api/me');
  ok('本人確認なしの/api/meは401', noauth.status === 401);
  const stats = await fetch(HTTP + '/stats').then(r => r.text());
  ok('/statsリーダーボードに反映', stats.includes('リーダーボード') && stats.includes(name));
  // ゲスト→アカウント引き継ぎ(Registryの/link。Worker側はClerkトークン必須)
  const linkNoAuth = await fetch(`${HTTP}/api/link-guest`, { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ guest }) });
  ok('未ログインでは引き継ぎできない(401)', linkNoAuth.status === 401);

  const g2 = await playToDragonKill(name, guest);
  const me2 = g2.result && g2.result.players.find(p => p.name === name);
  ok('2戦目: 累計RP加算・matches=2', me2 && me2.totalRp === me.totalRp + me2.rp && me2.matches === 2);
}

console.log(results.every(r => r[0] === 'PASS') ? `ALL PASS (${results.length})` : 'SOME FAILED');
stopDev();
process.exit();
