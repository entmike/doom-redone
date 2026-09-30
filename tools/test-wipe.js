// tools/test-wipe.js — f_wipe.js melt unit test vs f_wipe.c behavior
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.join(__dirname, '..');

const ctx = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(root, 'src', 'tables.js'), 'utf8'), ctx, { filename: 'src/tables.js' });
// engine.js supplies M_Random/rndtable (f_wipe.c m_random equivalent)
vm.runInContext(fs.readFileSync(path.join(root, 'src/engine.js'), 'utf8'), ctx, { filename: 'src/engine.js' });
vm.runInContext(fs.readFileSync(path.join(root, 'src/f_wipe.js'), 'utf8'), ctx, { filename: 'src/f_wipe.js' });

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : JSON.stringify(extra)); }
}

// start = 0x11111111 everywhere; end = 0x22222222 everywhere
const N = 320 * 200;
const res = vm.runInContext(`(function(){
  var scr = new Uint32Array(${N});
  var start = new Uint32Array(${N}).fill(0x11111111);
  var end = new Uint32Array(${N}).fill(0x22222222);
  Wipe.initMelt(start, end);
  var f = 0, done = false;
  while (!done && f < 500) { done = Wipe.doMelt(scr, 1); f++; }
  // pixel census mid-run vs final
  var allEnd = true;
  for (var i = 0; i < ${N}; i++) if (scr[i] !== 0x22222222) { allEnd = false; break; }
  // fresh melt (driver seeds viewbuffer with start; vanilla memcpy in
  // wipe_initMelt). M_Random is the shared game PRNG (vanilla), so frame
  // counts may differ run-to-run — instead assert a reset yields a melt
  // that still completes.
  Wipe.initMelt(start, end);
  var scr2 = new Uint32Array(start);
  done = false; var f2 = 0;
  while (!done && f2 < 500) { done = Wipe.doMelt(scr2, 1); f2++; }
  return {frames: f, frames2: f2, allEnd: allEnd};
})()`, ctx);

check('melt finishes in bounded frame count', res.frames > 5 && res.frames < 200, res);
check('melt end state is 100% end screen', res.allEnd, res);
check('re-init melt completes again', res.frames2 > 5 && res.frames2 < 200, res);

// mid-run frame must be a strict mix of both screens for at least one frame
const mid = vm.runInContext(`(function(){
  var scr = new Uint32Array(${N});
  var start = new Uint32Array(${N}).fill(0x11111111);
  var end = new Uint32Array(${N}).fill(0x22222222);
  Wipe.initMelt(start, end);
  var midMix = false, monotonic = true, prevEnd = 0;
  for (var f = 0; f < 200; f++) {
    Wipe.doMelt(scr, 1);
    var nEnd = 0;
    for (var i = 0; i < ${N}; i++) if (scr[i] === 0x22222222) nEnd++;
    if (nEnd > 0 && nEnd < ${N}) midMix = true;
    if (nEnd < prevEnd) monotonic = false;
    prevEnd = nEnd;
  }
  return {midMix: midMix, monotonic: monotonic};
})()`, ctx);
check('mid-melt frames mix both screens', mid.midMix, mid);
check('end-screen coverage grows monotonically', mid.monotonic, mid);

console.log(failures ? failures + ' FAILURES' : 'wipe OK');
process.exit(failures ? 1 : 0);
