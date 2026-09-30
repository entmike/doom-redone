// Assert fix: fuzz E2M1 specials; trap floorpic/ceilingpic writes: every
// value must be a valid flat index; report sector 51 end state.
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
`, ctx);
const out = vm.runInContext(`(function(){
  var bad = [];
  var maxFlat = (window.ASSETS && ASSETS.flats ? Object.keys(ASSETS.flats).length : 400);
  G.sectors.forEach(function(sec, sn){
    ['floorpic','ceilingpic'].forEach(function(fld){
      var v = sec[fld];
      Object.defineProperty(sec, fld, {
        enumerable: true, configurable: true,
        get: function(){ return v; },
        set: function(nv){
          if (nv === undefined || nv === -1 || !(nv >= 0 && nv < 400))
            bad.push({sector: sn, fld: fld, nv: String(nv), stack: (new Error()).stack.split('\\n')[2]});
          v = nv;
        }
      });
    });
  });
  // trigger every tagged special line, walk across it
  var used = 0;
  for (var i = 0; i < G.lines.length; i++) {
    var ln = G.lines[i];
    if (!ln.special) continue;
    if (!ln.v1 || !ln.v2) continue;
    used++;
    var mx = ((ln.v1.x + ln.v2.x) >> 1) | 0, my = ((ln.v1.y + ln.v2.y) >> 1) | 0;
    G.player.mo.x = mx; G.player.mo.y = my;
    try { G.EV_SpecialLines(G.player.mo, ln, 1, false); } catch (e) {}
    for (var t = 0; t < 60; t++) G.G_Ticker();
  }
  for (var t2 = 0; t2 < 120; t2++) G.G_Ticker();
  var s51 = G.sectors[51];
  return JSON.stringify({ used: used, badWrites: bad, s51floorpic: s51.floorpic, s51special: s51.special });
})()`, ctx, { filename: 'verify.js' });
console.log(out);
