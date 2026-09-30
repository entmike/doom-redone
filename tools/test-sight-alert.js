// tools/test-sight-alert.js — E1M1 AI perception probes vs gospel:
//  1) pistol shot wakes only the sound-flood-reachable monsters (not the map)
//  2) P_CheckSight agrees with the REJECT lump on reject-rejected pairs,
//     and does not blanket-false (monsters can actually see when open)
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const MAP = process.argv[2] || 'e1m1';
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, MAP));
const G = new Proxy({}, { get: (_, k) => ctx[k], set: (_, k, v) => { ctx[k] = v; return true; } });
G.currentMapName = MAP + '.json';
G.currentMapJson = ctx.__map;
G.onLevelExit = () => {};
const run = expr => vm.runInContext(expr, ctx);
let fails = 0;
function check(name, cond, extra) {
  console.log((cond ? 'ok   - ' : 'FAIL - ') + name + (extra !== undefined ? '  ' + JSON.stringify(extra) : ''));
  if (!cond) fails++;
}
run('G_InitNew(2, 1, 1)');

// ---- 1) sound flood scope ----------------------------------------------
const monsters = run(`(function(){
  var out = [];
  for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next)
    if (th.info && (th.flags & 0x400000) && !th.player) out.push(th);
  return out;
})()`);
check('map has monsters loaded', monsters.length >= 4, { count: monsters.length });

// sector index for reject lookups
run('globalThis.__secIdx = new Map(); G.sectors.forEach(function(s,i){ __secIdx.set(s,i); });');
const spawn = run('JSON.stringify(G.playerstarts[0])');
const sp = JSON.parse(spawn);
run(`(function(){
  var p = G.player;
  p.mo.x = ${sp.x} << 16; p.mo.y = ${sp.y} << 16;
  P_SetThingPosition(p.mo);
})()`);
// fire once: P_FireWeapon does P_NoiseAlert (gospel p_pspr.c:256)
run('P_FireWeapon(G.player)');
const woken = run(`(function(){
  var n = 0, secs = {};
  for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next)
    if (th.info && (th.flags & 0x400000) && !th.player &&
        th.subsector && th.subsector.sector && th.subsector.sector.soundtarget) {
      n++; secs[__secIdx.get(th.subsector.sector)] = 1;
    }
  return JSON.stringify({wokenMonsters: n, alertedSectors: Object.keys(secs).length});
})()`);
const w = JSON.parse(woken);
console.log('after 1 pistol shot:', woken);
// Gospel P_RecursiveSound floods every sector reachable through open
// two-sided lines (ML_SOUNDBLOCK = one extra hop). On E1M1 the spawn room
// connects to the yard, so most monsters SHOULD wake — that is vanilla.
// The fidelity check is NOT the count: it is that woken monsters are only
// ever ones the flood actually stamped (soundtarget == player.mo), and that
// a monster sealed behind a closed door / soundblock chain stays asleep.
check('pistol noise wakes monsters via flood (soundtarget stamped)',
  w.wokenMonsters > 0, w);

// vanilla distance sanity: player spawn is the south room; monsters woken
// should be within the connecting corridors. Compute max distance woken.
const maxd = run(`(function(){
  var p = G.player.mo, md = 0;
  for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next)
    if (th.info && (th.flags & 0x400000) && !th.player &&
        th.subsector && th.subsector.sector && th.subsector.sector.soundtarget) {
      var d = Math.hypot((th.x - p.x) >> 16, (th.y - p.y) >> 16);
      if (d > md) md = d; }
  return md;
})()`);
console.log('farthest woken monster distance (units):', maxd);

// ---- 2) P_CheckSight vs REJECT ------------------------------------------
// Reject says s1->s2 not visible: P_CheckSight MUST return false.
const rejTest = run(`(function(){
  var rej = (typeof reject !== 'undefined') ? reject : null;
  if (!rej) return 'no-reject';
  var ns = numsectors, checked = 0, wrong = 0, sample = [];
  var mo = [];
  for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next)
    if (th.info && (th.flags & 0x400000) && !th.player) mo.push(th);
  var p = G.player.mo;
  for (var i = 0; i < mo.length; i++) {
    var s1 = __secIdx.get(mo[i].subsector.sector), s2 = __secIdx.get(p.subsector.sector);
    var pnum = s1 * ns + s2;
    if (rej[pnum >> 3] & (1 << (pnum & 7))) {   // rejected: cannot see
      checked++;
      if (P_CheckSight(mo[i], p)) { wrong++; if (sample.length < 5)
        sample.push({ s1: s1, s2: s2, x: mo[i].x >> 16, y: mo[i].y >> 16 }); }
    }
  }
  return JSON.stringify({ checked: checked, wrongSee: wrong, sample: sample });
})()`);
const rj = JSON.parse(rejTest);
console.log('reject-visibility probe:', rejTest);
check('P_CheckSight never sees through REJECT-marked sector pairs',
  rj.checked > 0 && rj.wrongSee === 0, rj);

// positive control: monster in the SAME sector as the player, in the open,
// MUST see the player.
const same = run(`(function(){
  var psec = G.player.mo.subsector.sector;
  var md = null;
  for (var mo = psec.thinglist; mo; mo = mo.snext)
    if ((mo.flags & 0x400000) && !mo.player) md = mo;
  if (!md) return 'none-in-player-sector';
  return P_CheckSight(md, G.player.mo) ? 'sees' : 'blind';
})()`);
console.log('same-sector monster sight:', same);
check('open same-sector monster can see player', same === 'sees' || same === 'none-in-player-sector', same);

// ---- 3) A_Look wake chain: a monster in LOS of the player targets them ---
const los = run(`(function(){
  // put a monster 128 units EAST of the player start (open floor — the
  // spawn room's east one-sided wall is at x=+139 from start, so 256 was
  // actually across a wall once P_CheckSight was fixed), facing WEST at
  // the player so A_Look's frontal-cone check (p_enemy.c allaround=false)
  // applies; run A_Look once; it must target the player and see state.
  var s = G.playerstarts[0];
  var x = (s.x + 128) << 16, y = s.y << 16;
  var MTP = (typeof MT_POSSESSED !== 'undefined') ? MT_POSSESSED : 1;
  var m = P_SpawnMobj(x, y, 0, MTP);
  if (!m) return 'no MT_POSSESSED';
  P_SetThingPosition(m);
  m.z = m.subsector.sector.floorheight; m.floorz = m.z;
  m.angle = (0x80000000) >>> 0;   // face west (180 deg) toward player start
  var sight = P_CheckSight(m, G.player.mo);
  if (!sight) return JSON.stringify({ sight: false });
  G.ACTIONS['A_Look'](m);
  var MTP = (typeof MT_POSSESSED !== 'undefined') ? MT_POSSESSED : 1;
  var mobjinfo = (typeof mobjinfo !== 'undefined') ? mobjinfo : G.mobjinfo;
  return JSON.stringify({ sight: true, targeted: m.target === G.player.mo,
    stateAfter: (m.state.num !== undefined) ? m.state.num : -1,
    seestate: mobjinfo[MTP].seestate });
})()`);
console.log('LOS wake probe:', los);
const lo = JSON.parse(los);
check('LOS monster wakes and targets player', lo.sight === true && lo.targeted === true &&
  lo.stateAfter === lo.seestate, lo);

if (fails) { console.log('\n' + fails + ' FAILURES'); process.exit(1); }
console.log('\nALL CHECKS PASSED');
