// Catch the bad visplane red-handed: fuzz E2M1 with specials active, and
// dump the visplane whose picnum has no flatpix entry BEFORE it draws.
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
  pl.cheats |= 1;
  var fn = window.EV_SpecialLines || G.EV_SpecialLines;
  var nAct = 0;
  if (fn) for (var i = 0; i < G.lines.length; i++) {
    if (!G.lines[i].special) continue;
    try { fn(pl.mo, G.lines[i], 1, false); nAct++; } catch (e) {}
  }
  for (var t = 0; t < 240; t++) try { G.G_Ticker(); } catch (e) { console.log('tick threw', e.message); break; }

  // Wrap R_DrawPlanes: dump any pool plane with unresolvable picnum.
  var orig = R_DrawPlanes;
  var dumped = {};
  window.R_DrawPlanes = function () {
    for (var i = 0; i < 64; i++) {
      var vp = visplanes[i];
      if (!vp || vp.picnum === undefined) continue;
      if (vp.picnum === skyflatnum) continue;
      if (flatpix[flattranslation[vp.picnum]] !== undefined) continue;
      var key = '' + vp.picnum + '/' + (vp.height >> 16);
      if (!dumped[key]) {
        dumped[key] = 1;
        console.log('BADPLANE i=' + i + ' picnum=' + vp.picnum + ' xlate=' + flattranslation[vp.picnum] +
          ' height=' + (vp.height >> 16) + ' minx=' + vp.minx + ' maxx=' + vp.maxx +
          ' ll=' + vp.lightlevel + ' numflats=' + numflats + ' flatpix=' + flatpix.length +
          ' sky=' + skyflatnum);
        var refs = [];
        for (var s = 0; s < G.sectors.length; s++) {
          if (G.sectors[s].floorpic === vp.picnum || G.sectors[s].ceilingpic === vp.picnum)
            refs.push(s + ':' + flatnames[G.sectors[s].floorpic === vp.picnum ? 'f' in 0 ? 0 : 0 : 0]);
        }
        // simpler: report sector floor/ceiling picnums equal to bad picnum
        var sref = [];
        for (var s = 0; s < G.sectors.length; s++)
          if (G.sectors[s].floorpic === vp.picnum || G.sectors[s].ceilingpic === vp.picnum) sref.push(s);
        console.log('  sectors referencing picnum ' + vp.picnum + ': ' + JSON.stringify(sref));
      }
    }
    return orig.apply(this, arguments);
  };
  var R = 16807, seed = 7;
  function rnd(){ seed = (seed * R) % 2147483647; return seed / 2147483647; }
  var renders = 0;
  try {
    for (var k = 0; k < 260; k++) {
      var L = (rnd() * G.lines.length) | 0;
      G.P_TeleportMove(pl.mo, G.lines[L].v1.x, G.lines[L].v1.y);
      pl.mo.angle = (rnd() * 4294967296) >>> 0;
      for (var f = 0; f < 6; f++) { pl.cmd.forwardmove = 30 * 65536; R_RenderPlayerView(pl); G.G_Ticker(); renders++; }
    }
  } catch (e) {
    console.log('THREW after ' + renders + ' renders: ' + e.message);
  }
`, ctx, { filename: 'catch' });
