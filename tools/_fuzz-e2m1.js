// Deep-state fuzz of E2M1: activate every line special + thinker motion,
// then walk/render from many spots. Watch for visplane picnum outside flats.
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
  var res = { specials: 0, threw: null };
  var pl = G.player;
  pl.cheats |= 1;
  // fire every activatable line special once (doors/lifts/walls start moving)
  for (var i = 0; i < G.lines.length; i++) {
    var sp = G.lines[i].special;
    if (!sp) continue;
    try {
      G.EV_SpecialLines ? G.EV_SpecialLines(pl.mo, G.lines[i], 1, false) : P_UseLines && 0;
      res.specials++;
    } catch (e) { /* not all usable directly */ }
  }
  // let all thinkers run 240 tics (doors move, monsters wander)
  try { for (var t = 0; t < 240; t++) G.G_Ticker(); } catch (e) { res.tickThrew = e.message; }
  // now render-sweep from every vertex + the user spot, all 16 angles
  var R = 16807, seed = 7;
  function rnd(){ seed = (seed * R) % 2147483647; return seed / 2147483647; }
  res.renders = 0;
  try {
    for (var k = 0; k < 260; k++) {
      var L = (rnd() * G.lines.length) | 0;
      G.P_TeleportMove(pl.mo, G.lines[L].v1.x, G.lines[L].v1.y);
      pl.mo.angle = (rnd() * 4294967296) >>> 0;
      for (var f = 0; f < 6; f++) {
        pl.cmd.forwardmove = 30 * 65536;
        R_RenderPlayerView(pl);
        G.G_Ticker();
        res.renders++;
      }
    }
  } catch (e) {
    res.threw = e.message;
    res.stack = (e.stack || '').split('\\n').slice(0, 8).join(' <- ');
    res.pos = pl.mo ? [pl.mo.x >> 16, pl.mo.y >> 16, pl.mo.z >> 16] : null;
  }
  console.log(JSON.stringify(res, null, 1));
`, ctx, { filename: 'fuzz' });
