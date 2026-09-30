// headless regression: G_Ticker stores ticcmds VERBATIM (vanilla G_Ticker
// memcpy + G_ReadDemoTiccmd overwrite; no ±50 clamp). Vanilla replays the
// raw demo bytes exactly — all three shareware DEMOs end with a
// sidemove=0x80(-128) tic, and keyboard clamping lives only in
// G_BuildTiccmd (main.js buildTiccmd), not in the command consumer.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer, setTimeout, clearTimeout });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const run = e => vm.runInContext(e, ctx);
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, 'E1M1'));
run('G.currentMapName = "E1M1"; G.currentMapJson = __map;');
run('G_InitNew(3,1,1)');
let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra || ''); }
}
const r = JSON.parse(run(`(function(){
  G.G_Ticker({forwardmove:-64, sidemove:-128, angleturn:2048, buttons:1});
  var c = G.players[0].cmd;
  return JSON.stringify({f: c.forwardmove, s: c.sidemove, a: c.angleturn, b: c.buttons});
})()`));
check('sidemove -128 passes through (demo tail tic)', r.s === -128, JSON.stringify(r));
check('forwardmove -64 passes through', r.f === -64, JSON.stringify(r));
check('angleturn 2048 preserved', r.a === 2048, JSON.stringify(r));
console.log(failures ? 'FAILURES: ' + failures : 'ALL PASS');
process.exit(failures ? 1 : 0);
