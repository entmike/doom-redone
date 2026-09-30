// WI live tally probe: drive full intermission, log sfx adds + count track
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
boot(ctx, 'doom1.wad');
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/f_wipe.js',
                 'src/sound.js', 'src/wi.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

const out = vm.runInContext(`(function(){
  try { Snd.S_Init(); } catch (e) {}
  // capture addsfx-level events: S_StartSound -> S_sfx queue
  var adds = [];
  var origStart = Snd.S_StartSound;
  Snd.S_StartSound = function(o, id) { adds.push(id); return origStart(o, id); };

  // Build wbs by hand like G_DoCompleted would (E1M1 -> E1M2, 50% kills)
  var wbs = { epsd: 0, last: 0, next: 1, didsecret: false, victory: false,
    maxkills: 0, maxitems: 0, maxsecret: 0, partime: 35 * 90,
    skills: 0, sitems: 0, ssecret: 0, stime: 120708 };  // live E2M1 values

  var track = [];
  var prevK = null, prevPistol = 0, prevBarexp = 0, prevT = null;
  WI.Start(wbs, function(){});
  for (var t = 0; t < 2400; t++) {
    WI.Ticker(0);
    WI.Drawer();
    var c = WI.counts;
    var pistol = adds.filter(function(a){ return a === Snd.sfx.sfx_pistol; }).length;
    var barexp = adds.filter(function(a){ return a === Snd.sfx.sfx_barexp; }).length;
    if (c.k !== prevK || pistol !== prevPistol || barexp !== prevBarexp || c.t !== prevT) {
      track.push({ t: t, sp: WI.sp, k: c.k, i: c.i, s: c.s, time: c.t, par: c.p,
                   pistol: pistol, barexp: barexp });
      prevK = c.k; prevPistol = pistol; prevBarexp = barexp; prevT = c.t;
    }
  }
  return JSON.stringify({ adds: adds.slice(0, 12), track: track.slice(-6), trackLen: track.length });
})()`, ctx, { filename: 'wiprobe' });
console.log(out);
