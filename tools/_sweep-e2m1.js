// Render sweep of E2M1 in the vm: many player spots+angles, full
// R_RenderPlayerView; before each render scan for visplane picnum === -1.
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
  page = { reload: function(){} };
`, ctx);
const out = vm.runInContext(`(() => {
  // find every subsector spot: brute force over a coarse grid inside sectors
  var res = { renders: 0, threw: null, badpic: [] };
  var seen = {};
  var pl = G.player;
  for (var i = 0; i < G.sectors.length; i++) {
    var s = G.sectors[i];
    if (s.floorpic === -1 || s.ceilingpic === -1) res.badpic.push([i, s.floorpic, s.ceilingpic]);
  }
  // render from player start + teleported positions across angles
  var pts = [];
  pts.push([pl.mo.x, pl.mo.y]);
  for (var L = 0; L < G.lines.length; L++) pts.push([G.lines[L].v1.x, G.lines[L].v1.y]);
  var ang = 0;
  for (var p = 0; p < pts.length && !res.threw; p++) {
    for (var a = 0; a < 8; a++) {
      try {
        G.P_TeleportMove(pl.mo, pts[p][0], pts[p][1]);
        pl.mo.player = pl; pl.mo.angle = (a * 536870912) >>> 0;
        
        R_RenderPlayerView(pl);
        res.renders++;
      } catch (e) {
        res.threw = e.message + ' @ pt ' + (pts[p][0]>>16) + ',' + (pts[p][1]>>16) + ' ang' + a;
        res.stack = (e.stack || '').split('\\n').slice(0, 6).join(' <- ');
        break;
      }
    }
  }
  return JSON.stringify(res);
})()`, ctx);
console.log(out);
