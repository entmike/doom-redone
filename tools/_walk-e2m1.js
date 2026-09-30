// User repro: E2M1 at X:1034 Y:-806 Z:-64 ANG:92.3° — walk forward until throw.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = process.cwd();
const boot = require('./wadboot-host.js');
const ctx = vm.createContext({
  console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  performance: { now: () => Date.now() },
  requestAnimationFrame: () => {}, addEventListener: () => {},
  document: { getElementById: () => null, addEventListener: () => {}, hidden: false },
});
vm.runInContext('globalThis.window = globalThis;', ctx);
boot(ctx, 'doom1.9-retail.wad');
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/f_wipe.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
vm.runInContext(`
  G.currentMapName = 'E2M1';
  G.currentMapJson = WAD.mapJson(__wad, 'E2M1');
  G.G_InitNew(2, 2, 1);
  var pl = G.player;
  G.P_TeleportMove(pl.mo, 1034 * 65536, -806 * 65536);
  pl.mo.z = -64 * 65536;
  pl.mo.angle = Math.round(92.3 / 360 * 4294967296) >>> 0;
  pl.cmd.forwardmove = 25 * 65536;           // walk forward
  pl.cmd.buttons = 0;
  var out = { threw: null, tics: 0 };
  try {
    for (var t = 0; t < 700; t++) {
      R_RenderPlayerView(pl);                // render every tic like the browser frame
      G.G_Ticker();
      out.tics = t;
      out.pos = [pl.mo.x >> 16, pl.mo.y >> 16];
    }
  } catch (e) {
    out.threw = e.message;
    out.stack = (e.stack || '').split('\\n').slice(0, 8).join(' <- ');
    out.posAtThrow = [pl.mo.x >> 16, pl.mo.y >> 16];
  }
  console.log(JSON.stringify(out, null, 1));
`, ctx, { filename: 'repro' });
