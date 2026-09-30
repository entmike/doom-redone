// Regression: stepping into a secret sector (special 9) must set
// player.message = "A secret is revealed!" (DEVIATION: gospel p_spec.c:1049
// sets NO message — user-requested QoL) and still award + count the secret.
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
let fail = 0;
const ck = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'), window: {} };
ctx.window = ctx;
vm.createContext(ctx);
boot(ctx, 'doom1.wad');
for (const f of ['src/engine.js', 'src/game.js', 'src/sound.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const S = c => vm.runInContext(c, ctx);
S(`Snd.S_Init(); G.currentMapJson = WAD.mapJson(__wad, "E1M1"); G.G_InitNew(3, 1, 1);`);

const r = JSON.parse(S(`(function(){
  var sec = G.sectors.find(function(s){ return s.special === 9; });
  var cx = 0, cy = 0;
  for (var i = 0; i < sec.lines.length; i++) { var l = sec.lines[i]; cx += (l.v1.x + l.v2.x) / 2; cy += (l.v1.y + l.v2.y) / 2; }
  cx = (cx / sec.lines.length) | 0; cy = (cy / sec.lines.length) | 0;
  var p = G.players[0];
  G.P_TeleportMove(p.mo, cx, cy); p.mo.z = p.mo.floorz;
  p.message = null;
  G.G_Ticker({ forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 });
  return JSON.stringify({ secrets: p.secretcount, cleared: sec.special === 0, msg: p.message });
})()`));
ck(r.secrets === 1, 'secret awarded (secretcount 0->1)');
ck(r.cleared, 'sector special 0 after award (no double count)');
ck(r.msg === 'A secret is revealed!', 'HUD message "A secret is revealed!" set');

// --- centering: boot hu.js, run the message through HU_Ticker + HU_Drawer
// into a clean viewbuffer, and measure the drawn pixel span (DEVIATION:
// only the SECRET line centers; vanilla left-x applies to everything else).
S(`globalThis.viewbuffer = new Uint32Array(320*200);`);
vm.runInContext(fs.readFileSync(path.join(root, 'src/hu.js'), 'utf8'), ctx, { filename: 'hu.js' });
const c = JSON.parse(S(`(function(){
  HU.HU_Start();
  var plr = G.players[0];
  plr.message = G.MSG.SECRET;
  HU.HU_Ticker(plr, true);
  // baseline (background) then draw
  var vb = viewbuffer.slice();
  HU.HU_Drawer();
  var minX = 999, maxX = -1, minY = 999, maxY = -1;
  for (var i = 0; i < viewbuffer.length; i++)
    if (viewbuffer[i] !== vb[i]) { var x = i % 320, y = (i / 320) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y; }
  return JSON.stringify({ minX: minX, maxX: maxX, minY: minY, maxY: maxY });
})()`));
const w = c.maxX - c.minX;
const leftPad = c.minX, rightPad = 320 - 1 - c.maxX;
ck(c.minX > 0 && Math.abs(leftPad - rightPad) <= 4,
  `secret message pixel span centered (x ${c.minX}..${c.maxX}, pads ${leftPad}/${rightPad})`);
const topPad = c.minY, botPad = 199 - c.maxY;
ck(c.minY > 0 && Math.abs(topPad - botPad) <= 8,
  `secret message vertically centered (y ${c.minY}..${c.maxY}, pads ${topPad}/${botPad})`);

const n = JSON.parse(S(`(function(){
  HU.HU_Start();
  var vb = viewbuffer.slice();
  var plr = G.players[0];
  plr.message = G.MSG.GOTARMOR;
  HU.HU_Ticker(plr, true);
  HU.HU_Drawer();
  var minX = 999;
  for (var i = 0; i < viewbuffer.length; i++)
    if (viewbuffer[i] !== vb[i]) { var x = i % 320; if (x < minX) minX = x; }
  return JSON.stringify({ minX: minX });
})()`));
ck(n.minX <= 2, `normal pickup message stays vanilla left-x (starts at x=${n.minX})`);

console.log(fail ? '\n' + fail + ' FAILURES' : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
