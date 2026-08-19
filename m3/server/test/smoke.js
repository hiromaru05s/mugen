// npm test — サーバーを起動して主要フローを自動検証するスモークテスト
// (ロビー→Bot補充→移動→竜討伐→RP精算→永続化)
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const PORT = 2599;
  const dbPath = path.join(__dirname, '..', 'data', 'players.json');
  try { fs.rmSync(path.dirname(dbPath), { recursive: true }); } catch {}
  const srv = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')],
    { env: { ...process.env, PORT: String(PORT), M2_DEV: '1' }, stdio: 'inherit' });
  await sleep(2500);
  let failed = false;
  const assert = (name, cond) => { console.log((cond ? 'PASS' : 'FAIL') + ' ' + name); if (!cond) failed = true; };
  try {
    const { Client } = require('colyseus.js');
    const c = new Client(`ws://localhost:${PORT}`);
    const r = await c.joinOrCreate('forest', { name: 'smoke', cls: 'ranger' });
    const st = { snap: null, result: null, init: null };
    r.onMessage('init', m => st.init = m); r.onMessage('snap', s => st.snap = s);
    r.onMessage('fx', () => {}); r.onMessage('result', x => st.result = x);
    r.send('ready'); await sleep(500);
    assert('lobby phase', st.snap.phase === 'lobby');
    r.send('start'); await sleep(600);
    assert('live phase', st.snap.phase === 'live');
    assert('team filled to 3', st.snap.units.filter(u => u.team === st.init.team).length === 3);
    const bots0 = st.snap.units.filter(u => u.bot).map(u => [u.x, u.y]);
    await sleep(2500);
    const bots1 = st.snap.units.filter(u => u.bot);
    assert('bots move', bots1.some((u, i) => bots0[i] && Math.hypot(u.x - bots0[i][0], u.y - bots0[i][1]) > 30));
    r.send('devTime', { t: 241 }); await sleep(500);
    assert('dragon appears', !!st.snap.dragon);
    r.send('devTeleport', { x: 100, y: 0 });
    const iv = setInterval(() => { const m = st.snap.units.find(u => u.id === r.sessionId);
      if (m) r.send('input', { mx: 0, my: 0, atk: true, aim: Math.atan2(-m.y, -m.x) }); }, 60);
    await sleep(3000);
    assert('dragon hurt', st.snap.dragon.hp < st.snap.dragon.maxHp);
    r.send('devDragonHp', { hp: 10 }); await sleep(2000); clearInterval(iv);
    await sleep(600);
    assert('result received', !!st.result);
    assert('rp settled', st.result && st.result.rows.reduce((s2, x) => s2 + x.rp, 0) === 1000);
    assert('persistence written', fs.existsSync(dbPath) && JSON.parse(fs.readFileSync(dbPath, 'utf8')).smoke.matches === 1);
  } catch (e) { console.error('FAIL (exception)', e); failed = true; }
  srv.kill('SIGKILL');
  process.exit(failed ? 1 : 0);
})();
