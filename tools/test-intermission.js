// Headless smoke test for wi.js + f_finale.js state machines and drawing.
// Loads assets (as script-scope consts via vm), stubs Snd/G, drives tics.
const fs = require('fs'), vm = require('vm');
const ctx = { console, atob: s => Buffer.from(s, 'base64').toString('binary'),
  viewbuffer: new Uint32Array(320 * 200), Buffer };
vm.createContext(ctx);
const load = p => vm.runInContext(fs.readFileSync(p, 'utf8'), ctx, { filename: p });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js);
// ASSETS/INTERLUDE are script-lexical consts; expose them for the modules
// wadboot shim already exposes ASSETS/INTERLUDE on globalThis
ctx.COLORMAPS = null;                    // table0 = identity (lut s->s fine)
ctx.G = { M_Random: ((i => () => (i = (i + 1) & 0xff, i))(0)), players: [{ killcount: 0 }], consoleplayer: 0 };
const sfxLog = [];
ctx.Snd = { sfx: new Proxy({}, { get: (t, k) => 1 }), mus: { mus_inter: 10, mus_victor: 11 },
  S_StartSound: (o, id) => sfxLog.push(id), S_ChangeMusic: (n, l) => sfxLog.push('mus' + n) };
load('src/wi.js');
load('src/f_finale.js');

let fails = 0;
const ok = (cond, msg) => { console.log((cond ? 'ok   ' : 'FAIL ') + msg); if (!cond) fails++; };

// --- StatCount of a normal exit (E1M1 -> E1M2) -----------------------------
const wbs = { epsd: 0, last: 0, next: 1, didsecret: false, victory: false,
  maxkills: 10, maxitems: 5, maxsecret: 1, partime: 35 * 30,
  skills: 5, sitems: 3, ssecret: 1, stime: 40 * 35 };
ctx.WI.Start(wbs, () => { ctx.__done = true; });
ok(ctx.WI.state === 1, 'starts in StatCount');
// accelerate once counts finish: run until sp_state would be 10, then press fire
let t = 0;
for (; t < 35 * 60 && ctx.WI.state === 1; t++) ctx.WI.Ticker(0);
// vanilla: counting completes then sits in sp_state 10 waiting for a press,
// so state stays StatCount indefinitely until accelerated/skipped.
ok(ctx.WI.state === 1, 'counts then idles in StatCount (60s of tics)');
// Press #1 DURING counting: vanilla consumes it in the
// `acceleratestage && sp_state != 10` branch (jump all counters, sp->10),
// state stays StatCount; a press #2 is then needed to leave sp_state 10.
ctx.WI.Start(wbs, () => { ctx.__done2 = true; });
ctx.WI.Ticker(0);                       // sp_state 1 -> 2
ctx.WI.Ticker(1); ctx.WI.Ticker(0);     // press edge during counting
ok(ctx.WI.state === 1 && ctx.WI.sp === 10 && ctx.WI.counts.k === 50,
   'press during counting jumps counters to final (kills 50%)');
ctx.WI.Ticker(0);
ok(ctx.WI.state === 1, 'still StatCount idling at sp_state 10');
ctx.WI.Ticker(1); ctx.WI.Ticker(0);     // press #2 -> continue
ok(ctx.WI.state === 2, 'press #2 leaves sp_state 10 -> ShowNextLoc');
const state = ctx.WI.state;
void state;
let t2 = 0;
// blink + 4 s dwell
for (t2 = 0; t2 < 35 * 5 && ctx.WI.state === 2; t2++) ctx.WI.Ticker(0);
ok(ctx.WI.state === 3, 'ShowNextLoc -> NoState after ~4s');
for (t2 = 0; t2 < 15 && !ctx.__done2; t2++) ctx.WI.Ticker(0);
ok(ctx.__done2 === true, 'NoState -> G_WorldDone callback after 10 tics');

// --- regression: non-integer stime must NOT hang sp_state 8 -----------------
// Live E2M1 intermission froze: `cnt_time >= (wbs.stime / TICRATE) | 0` parses
// as `(cnt_time >= 3448.8) | 0` in JS (>= binds tighter than |), while the
// clamp line writes the TRUNCATED 3448 — the completion check could then
// never go true. C integer division has no such trap.
const wbsFrac = { epsd: 0, last: 0, next: 1, didsecret: false, victory: false,
  maxkills: 21, maxitems: 16, maxsecret: 4, partime: 35 * 90,
  skills: 21, sitems: 0, ssecret: 0, stime: 120708 };   // 120708/35 = 3448.8
ctx.WI.Start(wbsFrac, () => {});
let tf = 0;
for (; tf < 35 * 60 && ctx.WI.sp < 9; tf++) ctx.WI.Ticker(0);
ok(ctx.WI.sp >= 9, 'fractional stime (3448.8 s) time count completes (sp ' +
   ctx.WI.sp + ' at t=' + tf + ')');
ok(ctx.WI.counts.t === 3448, 'time counter clamps to truncated stime (' +
   ctx.WI.counts.t + ')');
// full unaccelerated run must reach sp_state 10 (waiting for press), not loop
for (; tf < 35 * 90 && ctx.WI.sp < 10; tf++) ctx.WI.Ticker(0);
ok(ctx.WI.sp === 10 && ctx.WI.state === 1, 'completes to idle sp_state 10 (t=' + tf + ')');

// --- regression: key held from the exit switch must NOT auto-accelerate -----
// User saw totals instantly, no count-up: exiting with USE held left
// usedown=true (P_Ticker frozen during intermission), and the old code reset
// prevUse=0 at Start, so the held key read as a fresh press on tic 1.
ctx.G.player = { attackdown: false, usedown: true };   // gospel state post-exit
ctx.WI.Start(wbs, () => {});
for (let i = 0; i < 30; i++) ctx.WI.Ticker(2);         // USE still down
ok(ctx.WI.sp < 10 && ctx.WI.counts.acc === 0,
   'held USE from exit does not accelerate (sp ' + ctx.WI.sp + ')');
ctx.WI.Ticker(0); ctx.WI.Ticker(2);                    // release, fresh press
ctx.WI.Ticker(0);                                      // accelerate branch runs
ok(ctx.WI.sp === 10 && ctx.WI.counts.k === 50,
   'fresh USE press after release still accelerates (sp ' + ctx.WI.sp + ')');
ctx.G.player = undefined;

// --- pixel checks: rerun and draw a frame at a known point -----------------
ctx.__done = false;
ctx.WI.Start(wbs, () => { ctx.__done = true; });
for (t = 0; t < 5; t++) ctx.WI.Ticker(0);
ctx.WI.Drawer();
let nonBlack = 0;
for (let i = 0; i < ctx.viewbuffer.length; i++) if (ctx.viewbuffer[i] !== 0xff000000) nonBlack++;
ok(nonBlack > 30000, 'WI frame has WIMAP0 background painted (' + nonBlack + ' nonblack px)');

// --- finale ----------------------------------------------------------------
let fDone = false;
ctx.FINALE.Start(() => { fDone = true; });
for (t = 0; t < 100; t++) ctx.FINALE.Ticker();
ctx.FINALE.Drawer();
nonBlack = 0;
for (let i = 0; i < ctx.viewbuffer.length; i++) if (ctx.viewbuffer[i] !== 0xff000000) nonBlack++;
ok(nonBlack > 60000, 'finale tiles FLOOR4_8 across screen (' + nonBlack + ')');
ok(ctx.FINALE.stage === 0, 'finale still in text stage at t=100');
for (t = 0; t < 5000; t++) ctx.FINALE.Ticker();
ok(ctx.FINALE.stage === 1, 'finale reaches CREDIT stage');
for (t = 0; t < 35 * 25; t++) ctx.FINALE.Ticker();
ok(fDone, 'finale done-callback after credits dwell');

// --- commercial (DOOM 2) intermission: INTERPIC back, CWILV name, no splat --
const ctx2 = { console, atob: s => Buffer.from(s, 'base64').toString('binary'),
  viewbuffer: new Uint32Array(320 * 200), Buffer };
vm.createContext(ctx2);
const load2 = p => vm.runInContext(fs.readFileSync(p, 'utf8'), ctx2, { filename: p });
require('./wadboot-host')(ctx2, 'DOOM2.wad');       // commercial IWAD
ctx2.gamemode = vm.runInContext('globalThis.gamemode', ctx2);
ctx2.COLORMAPS = null;
ctx2.G = { M_Random: ((i => () => (i = (i + 1) & 0xff, i))(0)), players: [{ killcount: 0 }], consoleplayer: 0 };
ctx2.Snd = { sfx: new Proxy({}, { get: (t, k) => 1 }), mus: { mus_inter: 10, mus_victor: 11, mus_dm2int: 66 },
  S_StartSound: () => {}, S_ChangeMusic: () => {} };
load2('src/wi.js');
ok(ctx2.gamemode === 'commercial', 'DOOM2.wad installs as commercial (' + ctx2.gamemode + ')');
const wbs2 = { epsd: 0, last: 10, next: 11, didsecret: false, victory: false,
  maxkills: 10, maxitems: 5, maxsecret: 1, partime: 35 * 150,
  skills: 5, sitems: 3, ssecret: 1, stime: 40 * 35 };
ctx2.WI.Start(wbs2, () => { ctx2.__done = true; });
for (t = 0; t < 30; t++) ctx2.WI.Ticker(0);
ctx2.WI.Drawer();
let nb2 = 0;
for (let i = 0; i < ctx2.viewbuffer.length; i++) if (ctx2.viewbuffer[i] !== 0xff000000) nb2++;
ok(nb2 > 30000, 'commercial WI paints INTERPIC background (' + nb2 + ' nonblack px)');
// CWILV art (level 12) must resolve inside the DOOM2 WAD
ok(vm.runInContext('!!__wad.lumps.find(l=>l.name==="CWILV11")', ctx2),
   'DOOM2.wad carries CWILV11 art for the WI name');
ok(vm.runInContext('!__wad.lumps.find(l=>l.name==="WISPLAT")', ctx2),
   'commercial WAD has no WISPLAT (gospel skips splat map anyway)');

console.log(fails ? 'FAILURES: ' + fails : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
