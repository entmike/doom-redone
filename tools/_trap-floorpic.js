// Trap: wrap every sector's floorpic/ceilingpic in a setter; log stack when
// undefined or -1 is assigned. Then run the reproducing fuzz.
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
  window.__traps = [];
  G.sectors.forEach(function (sec, idx) {
    ['floorpic', 'ceilingpic'].forEach(function (fld) {
      var v = sec[fld];
      Object.defineProperty(sec, fld, {
        get: function () { return v; },
        set: function (nv) {
          if (nv === undefined || nv === -1 && window.__trapMinus) {
            window.__traps.push({ sector: idx, fld: fld, nv: String(nv),
              stack: (new Error()).stack.split('\\n').slice(1, 7).join(' <- ') });
            nv = 0;   // keep rendering alive so we can find all writers
          }
          v = nv;
        },
        configurable: true,
      });
    });
  });
  var pl = G.player;
  pl.cheats |= 1;
  // replicate the crashing fuzz exactly: stand at each line, USE the line
  var nUse = 0;
  for (var i = 0; i < G.lines.length; i++) {
    if (!G.lines[i].special) continue;
    G.P_TeleportMove(pl.mo, G.lines[i].v1.x - (G.lines[i].dx >> 2), G.lines[i].v1.y - (G.lines[i].dy >> 2));
    pl.mo.angle = Math.atan2(G.lines[i].dy, G.lines[i].dx) * 4294967296 / (2 * Math.PI) >>> 0;
    pl.cmd.buttons = 2;                          // BT_USE
    for (var q = 0; q < 6; q++) try { G.G_Ticker(); } catch (e) { console.log('use tick threw', e.message); }
    pl.cmd.buttons = 0;
    nUse++;
  }
  console.log('used lines: ' + nUse);
  for (var t = 0; t < 240; t++) try { G.G_Ticker(); } catch (e) { break; }
  var R = 16807, seed = 7;
  function rnd(){ seed = (seed * R) % 2147483647; return seed / 2147483647; }
  try {
    for (var k = 0; k < 60; k++) {
      var L = (rnd() * G.lines.length) | 0;
      G.P_TeleportMove(pl.mo, G.lines[L].v1.x, G.lines[L].v1.y);
      for (var f = 0; f < 3; f++) { pl.cmd.forwardmove = 30 * 65536; G.G_Ticker(); }
    }
  } catch (e) { console.log('walk threw', e.message); }
  console.log(JSON.stringify(window.__traps, null, 1));
`, ctx, { filename: 'trap' });
