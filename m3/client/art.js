// 夢幻の森 — プロシージャルドット絵 (prototype/index.html のARTモジュール移植・フレームワーク非依存)
// buildART() が {key: canvas} を返す。Phaser側で textures.addCanvas する。
'use strict';
function buildART(teamColors) {
  function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function up(c, s) { const o = mk(c.width * s, c.height * s); const g = o.getContext('2d');
    g.imageSmoothingEnabled = false; g.drawImage(c, 0, 0, o.width, o.height); return o; }
  function shade(hex, f) { const n = parseInt(hex.slice(1), 16);
    const r = Math.min(255, Math.round(((n >> 16) & 255) * f)), g2 = Math.min(255, Math.round(((n >> 8) & 255) * f)), b = Math.min(255, Math.round((n & 255) * f));
    return `rgb(${r},${g2},${b})`; }
  function outline(c) { const w = c.width, h = c.height, g = c.getContext('2d');
    const src = g.getImageData(0, 0, w, h).data, out = g.getImageData(0, 0, w, h), od = out.data;
    const at = (x, y) => x >= 0 && y >= 0 && x < w && y < h && src[(y * w + x) * 4 + 3] > 40;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = (y * w + x) * 4;
      if (src[i + 3] <= 40 && (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1))) { od[i] = 12; od[i + 1] = 18; od[i + 2] = 14; od[i + 3] = 255; } }
    g.putImageData(out, 0, 0); }
  function cir(g, x, y, r) { g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); }

  function humanoid(cls, T, dir) {
    const c = mk(18, 20), g = c.getContext('2d');
    const t = shade(T, .6), side = dir === 'side', upd = dir === 'up';
    g.fillStyle = '#2a2622'; g.fillRect(6, 16, 2, 3); g.fillRect(10, 16, 2, 3);
    g.fillStyle = T; g.fillRect(5, 9, 8, 7); g.fillStyle = t; g.fillRect(5, 13, 8, 3);
    if (cls === 'warrior') {
      g.fillStyle = '#9aa8b0'; g.fillRect(5, 9, 8, 3);
      g.fillStyle = '#9aa8b0'; g.fillRect(5, 2, 8, 6); g.fillStyle = '#6a7880'; g.fillRect(5, 6, 8, 2);
      g.fillStyle = '#e0b64f'; g.fillRect(5, 2, 8, 1);
      if (!upd) { g.fillStyle = '#1a1512'; if (side) g.fillRect(11, 4, 2, 2); else { g.fillRect(6, 4, 2, 2); g.fillRect(10, 4, 2, 2); } }
      const sx = side ? 12 : 2; g.fillStyle = '#7a8a94'; g.fillRect(sx, 8, 4, 7);
      g.fillStyle = '#e0b64f'; g.fillRect(sx + 1, 10, 2, 2);
      g.fillStyle = '#c8d4da'; g.fillRect(side ? 1 : 15, 5, 1, 8); g.fillStyle = '#8a6a42'; g.fillRect(side ? 0 : 14, 12, 3, 1);
    }
    if (cls === 'mage') {
      g.fillStyle = '#7a5f9a'; g.fillRect(5, 9, 8, 8); g.fillStyle = '#5a4374'; g.fillRect(5, 14, 8, 3);
      g.fillStyle = T; g.fillRect(5, 9, 8, 1);
      g.fillStyle = '#7a5f9a'; g.fillRect(6, 1, 6, 2); g.fillRect(5, 3, 8, 5); g.fillRect(8, 0, 2, 1);
      if (!upd) { g.fillStyle = '#241a30'; if (side) g.fillRect(10, 4, 3, 3); else g.fillRect(6, 4, 6, 3);
        g.fillStyle = '#5bc8b0'; if (side) g.fillRect(11, 5, 1, 1); else { g.fillRect(7, 5, 1, 1); g.fillRect(10, 5, 1, 1); } }
      g.fillStyle = '#8a6a42'; g.fillRect(side ? 2 : 15, 2, 1, 13);
      g.fillStyle = '#5bc8b0'; g.fillRect(side ? 1 : 14, 1, 3, 3); g.fillStyle = '#bfeee2'; g.fillRect(side ? 2 : 15, 2, 1, 1);
    }
    if (cls === 'thief') {
      g.fillStyle = '#3a3430'; g.fillRect(5, 9, 8, 7); g.fillStyle = T; g.fillRect(5, 9, 8, 2);
      g.fillStyle = '#2e2a26'; g.fillRect(5, 2, 8, 6); g.fillRect(6, 1, 6, 1);
      if (!upd) { g.fillStyle = '#15120f'; if (side) g.fillRect(10, 4, 3, 3); else g.fillRect(6, 4, 6, 3);
        g.fillStyle = '#e0b64f'; if (side) g.fillRect(11, 5, 1, 1); else { g.fillRect(7, 5, 1, 1); g.fillRect(10, 5, 1, 1); } }
      g.fillStyle = '#c8d4da'; g.fillRect(3, 10, 1, 4); if (!side) g.fillRect(14, 10, 1, 4);
      g.fillStyle = '#e0b64f'; g.fillRect(4, 13, 1, 1);
    }
    if (cls === 'priest') {
      g.fillStyle = '#e8e2d2'; g.fillRect(5, 9, 8, 8); g.fillStyle = '#cfc4a8'; g.fillRect(5, 14, 8, 3);
      g.fillStyle = '#e0b64f'; g.fillRect(5, 11, 8, 1);
      g.fillStyle = T; g.fillRect(5, 9, 8, 1);
      g.fillStyle = '#e8e2d2'; g.fillRect(5, 2, 8, 6); g.fillRect(6, 1, 6, 1);
      g.fillStyle = '#e0b64f'; g.fillRect(6, 2, 6, 1);
      if (!upd) { g.fillStyle = '#8a7a5a'; if (side) g.fillRect(10, 4, 3, 3); else g.fillRect(6, 4, 6, 3);
        g.fillStyle = '#ffd97a'; if (side) g.fillRect(11, 5, 1, 1); else { g.fillRect(7, 5, 1, 1); g.fillRect(10, 5, 1, 1); } }
      g.fillStyle = '#8a6a42'; g.fillRect(side ? 2 : 15, 8, 1, 4);
      g.fillStyle = '#ffd97a'; g.fillRect(side ? 1 : 14, 12, 3, 3); g.fillStyle = '#e0b64f'; g.fillRect(side ? 1 : 14, 12, 3, 1);
    }
    if (cls === 'ranger') {
      g.fillStyle = '#3f6a3a'; g.fillRect(5, 9, 8, 7); g.fillStyle = '#2e5230'; g.fillRect(5, 13, 8, 3);
      g.fillStyle = T; g.fillRect(5, 9, 8, 1);
      g.fillStyle = '#2e5230'; g.fillRect(5, 2, 8, 6); g.fillRect(6, 1, 6, 1);
      if (!upd) { g.fillStyle = '#15120f'; if (side) g.fillRect(10, 4, 3, 3); else g.fillRect(6, 4, 6, 3);
        g.fillStyle = '#e0b64f'; if (side) g.fillRect(11, 5, 1, 1); else { g.fillRect(7, 5, 1, 1); g.fillRect(10, 5, 1, 1); } }
      const bx = side ? 14 : 15;
      g.fillStyle = '#8a6a42'; g.fillRect(bx, 3, 1, 11); g.fillStyle = '#bfeee2'; g.fillRect(bx + 1, 4, 1, 9);
      g.fillStyle = '#5a4a32'; g.fillRect(3, 9, 2, 4); g.fillStyle = '#5bc8b0'; g.fillRect(3, 8, 2, 1);
    }
    outline(c); return up(c, 2);
  }
  function wolf() { const c = mk(22, 14), g = c.getContext('2d');
    g.fillStyle = 'rgba(122,95,154,.7)'; g.fillRect(0, 6, 4, 2); g.fillRect(1, 5, 2, 1);
    g.fillStyle = '#665a86'; g.fillRect(4, 5, 12, 5); g.fillStyle = '#7a6f9a'; g.fillRect(4, 5, 12, 2);
    g.fillStyle = '#665a86'; g.fillRect(14, 3, 5, 5); g.fillRect(15, 1, 2, 2);
    g.fillStyle = '#5bc8b0'; g.fillRect(17, 5, 1, 1);
    g.fillStyle = '#2a2436'; g.fillRect(5, 10, 2, 3); g.fillRect(9, 10, 2, 3); g.fillRect(13, 10, 2, 3);
    outline(c); return up(c, 2); }
  function tree(seed) { const c = mk(24, 24), g = c.getContext('2d');
    const P = [[12, 13, 8], [7, 9, 5], [16, 9, 5], [9, 16, 5], [15, 16, 5], [12, 7, 4]];
    const off = i => [((seed * 7 + i * 3) % 5) - 2, ((seed * 11 + i * 5) % 5) - 2];
    g.fillStyle = '#142c1f'; P.forEach((p, i) => { const o = off(i); cir(g, p[0] + o[0], p[1] + o[1], p[2] + 1); });
    g.fillStyle = '#1f4a33'; P.forEach((p, i) => { const o = off(i); cir(g, p[0] + o[0], p[1] + o[1], p[2]); });
    g.fillStyle = '#2c6344'; P.slice(0, 3).forEach((p, i) => { const o = off(i); cir(g, p[0] + o[0] - 1, p[1] + o[1] - 2, p[2] * .55); });
    g.fillStyle = '#3e7d55'; P.slice(0, 2).forEach((p, i) => { const o = off(i); cir(g, p[0] + o[0] - 2, p[1] + o[1] - 3, 1.6); });
    outline(c); return up(c, 3); }
  function bush(seed) { const c = mk(20, 14), g = c.getContext('2d');
    const P = [[5, 8, 4], [10, 7, 5], [15, 8, 4], [8, 10, 4], [12, 10, 4]];
    g.fillStyle = '#215233'; P.forEach(p => cir(g, p[0], p[1], p[2] + .8));
    g.fillStyle = '#2f6e44'; P.forEach(p => cir(g, p[0], p[1], p[2]));
    g.fillStyle = '#43905a'; P.slice(0, 3).forEach(p => cir(g, p[0] - 1, p[1] - 2, p[2] * .5));
    g.fillStyle = '#5bc8b0';
    (seed ? [[6, 6], [14, 6]] : [[5, 7], [11, 5], [15, 8]]).forEach(p => g.fillRect(p[0], p[1], 1, 1));
    outline(c); return up(c, 3); }
  function chest(open) { const c = mk(14, 12), g = c.getContext('2d');
    if (!open) { g.fillStyle = '#7a5230'; g.fillRect(1, 3, 12, 8); g.fillStyle = '#8f6238'; g.fillRect(1, 3, 12, 3);
      g.fillStyle = '#5a5560'; g.fillRect(1, 6, 12, 1); g.fillRect(3, 3, 1, 8); g.fillRect(10, 3, 1, 8);
      g.fillStyle = '#e0b64f'; g.fillRect(6, 6, 2, 3); }
    else { g.fillStyle = '#8f6238'; g.fillRect(1, 1, 12, 3); g.fillStyle = '#7a5230'; g.fillRect(1, 6, 12, 5);
      g.fillStyle = '#4a3420'; g.fillRect(2, 7, 10, 3); g.fillStyle = '#ffd97a'; g.fillRect(4, 7, 6, 2); }
    outline(c); return up(c, 2); }
  function trapS() { const c = mk(12, 12), g = c.getContext('2d');
    g.fillStyle = '#2c5a38'; [[3, 5], [6, 3], [9, 6], [5, 8], [8, 9], [4, 3]].forEach(p => g.fillRect(p[0], p[1], 3, 2));
    g.fillStyle = '#3f7a4a'; [[4, 4], [7, 6], [6, 9]].forEach(p => g.fillRect(p[0], p[1], 2, 1));
    g.fillStyle = '#e0b64f'; g.fillRect(6, 6, 1, 1); return up(c, 2); }
  function merchantS() { const c = mk(26, 22), g = c.getContext('2d');
    g.fillStyle = '#5a4a32'; g.fillRect(1, 8, 24, 3); g.fillRect(2, 11, 2, 9); g.fillRect(22, 11, 2, 9);
    g.fillStyle = '#7a5f9a'; g.fillRect(3, 1, 20, 4);
    g.fillStyle = '#9a7fc0'; for (let i = 0; i < 5; i++) g.fillRect(3 + i * 4, 5, 2, 1);
    g.fillStyle = '#2e2a26'; g.fillRect(10, 3, 6, 5);
    g.fillStyle = '#ffd97a'; g.fillRect(12, 5, 1, 1); g.fillRect(14, 5, 1, 1);
    g.fillStyle = '#e0b64f'; g.fillRect(5, 9, 2, 1); g.fillRect(10, 9, 3, 1); g.fillRect(18, 9, 2, 1);
    g.fillStyle = '#ffd97a'; g.fillRect(24, 2, 1, 3);
    outline(c); return up(c, 3); }
  function dragonS() { const c = mk(44, 44), g = c.getContext('2d');
    g.strokeStyle = '#2f6a4c'; g.lineWidth = 9; g.beginPath(); g.arc(22, 24, 13, -2.4, 2.9); g.stroke();
    g.strokeStyle = '#3b7f5c'; g.lineWidth = 5; g.beginPath(); g.arc(22, 24, 13, -2.2, 2.7); g.stroke();
    g.fillStyle = '#5bc8b0'; g.fillRect(6, 31, 3, 3);
    g.fillStyle = 'rgba(122,95,154,.85)';
    g.beginPath(); g.moveTo(8, 10); g.lineTo(20, 17); g.lineTo(5, 21); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(36, 10); g.lineTo(24, 17); g.lineTo(39, 21); g.closePath(); g.fill();
    g.fillStyle = '#2f6a4c'; g.fillRect(17, 4, 10, 9); g.fillStyle = '#3b7f5c'; g.fillRect(18, 5, 8, 4);
    g.fillStyle = '#e8e2d2'; g.fillRect(15, 2, 3, 4); g.fillRect(26, 2, 3, 4);
    g.fillStyle = '#5bc8b0'; g.fillRect(19, 8, 2, 2); g.fillRect(23, 8, 2, 2);
    g.fillStyle = '#4a8f5f'; g.fillRect(12, 27, 3, 2); g.fillRect(28, 28, 3, 2); g.fillRect(31, 15, 2, 2);
    const rg = g.createRadialGradient(22, 23, 1, 22, 23, 6);
    rg.addColorStop(0, '#ffe9a8'); rg.addColorStop(.5, '#e0b64f'); rg.addColorStop(1, 'rgba(91,200,176,0)');
    g.fillStyle = rg; cir(g, 22, 23, 6);
    outline(c); return up(c, 3); }

  const out = {};
  const CLS = ['warrior', 'mage', 'thief', 'priest', 'ranger'];
  for (let team = 0; team < teamColors.length; team++)
    for (const cls of CLS)
      for (const dir of ['down', 'side', 'up'])
        out[`u_${cls}_${team}_${dir}`] = humanoid(cls, teamColors[team], dir);
  out.wolf = wolf();
  out.tree0 = tree(0); out.tree1 = tree(1); out.tree2 = tree(2);
  out.bush0 = bush(0); out.bush1 = bush(1);
  out.chestC = chest(false); out.chestO = chest(true);
  out.trap = trapS(); out.merchant = merchantS(); out.dragon = dragonS();
  return out;
}
