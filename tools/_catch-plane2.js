// probe: patch engine source before loading to dump the bad plane at draw time
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
let eng = fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8');
const needle = 'ds_source = flatpix[flattranslation[pl.picnum]];   // r_plane.c:424';
if (!eng.includes(needle)) { console.log('needle missing'); process.exit(1); }
eng = eng.replace(needle,
  `{ var __d = flatpix[flattranslation[pl.picnum]];
     if (__d === undefined && !globalThis.__planeDump) {
       globalThis.__planeDump = { picnum: pl.picnum, xlate: flattranslation[pl.picnum],
         height: pl.height >> 16, minx: pl.minx, maxx: pl.maxx, ll: pl.lightlevel,
         numflats: numflats, flatpixlen: flatpix.length, sky: skyflatnum,
         nsectors: (typeof G !== 'undefined' && G.sectors) ? G.sectors.length : -1 };
       if (typeof G !== 'undefined' && G.sectors) {
         globalThis.__planeDump.sectorRefs = [];
         for (var __s = 0; __s < G.sectors.length; __s++)
           if (G.sectors[__s].floorpic === pl.picnum || G.sectors[__s].ceilingpic === pl.picnum)
             globalThis.__planeDump.sectorRefs.push(__s);
         globalThis.__planeDump.floorNames = (typeof G !== 'undefined' && G.sectors) ?
           G.sectors.map(function (s) { return flatnames[s.floorpic]; }).filter(function (x) { return x === undefined || !x; }).length : -1;
       }
       console.log('PLANCEDUMP ' + JSON.stringify(globalThis.__planeDump));
     }
     ds_source = __d; }`);
vm.runInContext(eng, ctx, { filename: 'src/engine.js' });
for (const f of ['src/tables.js', 'src/game.js', 'src/f_wipe.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
vm.runInContext(`
  G.currentMapName = 'E2M1';
  G.currentMapJson = WAD.mapJson(__wad, 'E2M1');
  G.G_InitNew(2, 2, 1);
  var pl = G.player;
  pl.cheats |= 1;
  var fn = window.EV_SpecialLines || G.EV_SpecialLines;
  if (fn) for (var i = 0; i < G.lines.length; i++)
    if (G.lines[i].special) { try { fn(pl.mo, G.lines[i], 1, false); } catch (e) {} }
  for (var t = 0; t < 240; t++) try { G.G_Ticker(); } catch (e) { break; }
  var R = 16807, seed = 7;
  function rnd(){ seed = (seed * R) % 2147483647; return seed / 2147483647; }
  try {
    for (var k = 0; k < 260; k++) {
      var L = (rnd() * G.lines.length) | 0;
      G.P_TeleportMove(pl.mo, G.lines[L].v1.x, G.lines[L].v1.y);
      pl.mo.angle = (rnd() * 4294967296) >>> 0;
      for (var f = 0; f < 6; f++) { pl.cmd.forwardmove = 30 * 65536; R_RenderPlayerView(pl); G.G_Ticker(); }
    }
    console.log('no crash this time');
  } catch (e) {
    console.log('THREW: ' + e.message);
  }
`, ctx, { filename: 'probe' });
