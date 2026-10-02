// tools/test-chase.js — enemy AI regression tests (p_enemy.c fidelity)
// Guards the gospel fixes:
//  1. A_Chase turn delta is SIGNED (p_enemy.c:687 `int delta`): unsigned made
//     every >180° delta turn the long way around — monsters spun like idiots.
//  2. dirtype_t constants: axis/diag dirs in P_NewChaseDir were scrambled
//     (DI_SOUTH written as 3=DI_NORTHWEST, DI_NORTH as 5=DI_SOUTHWEST,
//     diags[] mis-ordered) — diagonals walked 90° off target.
//  3. P_NewChaseDir keeps olddir before the direction sweep and ends with the
//     turnaround fallback (p_enemy.c:441/482) — without olddir, monsters
//     zig-zagged instead of pressing along walls.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer });

require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, 'E1M1'));
const G = new Proxy({}, {
  get: (_, k) => ctx[k],
  set: (_, k, v) => { ctx[k] = v; return true; },
});

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
function run(expr) { return vm.runInContext(expr, ctx); }

// boot MAP01 so blockmap/sectors exist
G.currentMapName = 'E1M1';
G.currentMapJson = ctx.__map;
G.onLevelExit = () => {};
run('G_InitNew(2, 1, 1)');

// ---- constants -------------------------------------------------------------
check('dirtype_t enum matches p_enemy.c:48',
  run('JSON.stringify(G.ai)').includes('"DI_NODIR":8') &&
  run('G.ai.DI_NORTHWEST') === 3 && run('G.ai.DI_SOUTHEAST') === 7);
check('opposite[] matches p_enemy.c:70', run('G.ai.opposite.join(",")') === '4,5,6,7,0,1,2,3,8');
check('diags[] = {NW,NE,SW,SE} per p_enemy.c:74', run('G.ai.diags.join(",")') === '3,1,5,7');

// ---- find a cell where the 6 asserted dirs all pass P_Move -------------------
const spot = run(`(function () {
  var p = players[0].mo;
  var solidSave = p.flags;
  p.flags &= ~MF_SOLID;            // don't collide with the player during probe
  var need = [0, 1, 2, 4, 5, 6];   // E NE N W SW S (the dirs the test asserts)
  for (var dx = -256; dx <= 256; dx += 32) {
    for (var dy = -256; dy <= 256; dy += 32) {
      var x0 = p.x + dx, y0 = p.y + dy;
      var m = P_SpawnMobj(x0, y0, 0, 1);
      var ok = true;
      for (var i = 0; i < need.length && ok; i++) {
        m.x = x0; m.y = y0; m.movedir = need[i];   // reset: P_Move mutates x/y
        if (!P_Move(m)) ok = false;
      }
      var out = ok ? { x: x0, y: y0 } : null;
      P_RemoveMobj(m);
      if (out) { p.flags = solidSave; return out; }
    }
  }
  p.flags = solidSave;
  return null;
})()`);
check('found open cell in MAP01 for chase tests', spot !== null, spot);
if (!spot) { console.log('\n1 FAILURE(S)'); process.exit(1); }

// ---- P_NewChaseDir direction selection (real function, real floor) ----------
const dirs = run(`(function () {
  var pl = players[0].mo, solidSave = pl.flags;
  pl.flags &= ~MF_SOLID;
  var FUx = FU, m = P_SpawnMobj(${spot.x}, ${spot.y}, 0, 1);
  function pick(tx, ty, olddir) {
    m.x = ${spot.x}; m.y = ${spot.y};
    m.movedir = olddir === undefined ? G.ai.DI_NODIR : olddir;
    m.movecount = 100;
    m.target = { x: tx, y: ty, flags: MF_SHOOTABLE, health: 100 };
    P_NewChaseDir(m);
    return m.movedir;
  }
  var out = {};
  out.east  = pick(m.x + 200 * FUx, m.y + 4 * FUx);          // y within +-10FU deadband
  out.west  = pick(m.x - 200 * FUx, m.y + 4 * FUx);
  out.north = pick(m.x + 4 * FUx,   m.y + 200 * FUx);
  out.south = pick(m.x + 4 * FUx,   m.y - 200 * FUx);
  out.ne    = pick(m.x + 150 * FUx, m.y + 150 * FUx);
  out.sw    = pick(m.x - 150 * FUx, m.y - 150 * FUx);
  // olddir keep: no axis (deadband), no diag — gospel tries olddir before sweep
  out.keepOld = pick(m.x + 5 * FUx, m.y + 5 * FUx, 4 /*WEST*/);
  pl.flags = solidSave;
  return out;
})()`);
check('east target -> DI_EAST',   dirs.east  === 0, dirs);
check('west target -> DI_WEST',   dirs.west  === 4, dirs);
check('north target -> DI_NORTH', dirs.north === 2, dirs);
check('south target -> DI_SOUTH', dirs.south === 6, dirs);
check('NE target -> DI_NORTHEAST (old bug: SE)', dirs.ne === 1, dirs);
check('SW target -> DI_SOUTHWEST (old bug: SE)', dirs.sw === 5, dirs);
check('keeps olddir before sweep (p_enemy.c:441)', dirs.keepOld === 4, dirs);

// ---- A_Chase signed turn (real function on a synthetic actor) ---------------
// Face NORTH (0x40000000), move dir DI_SOUTHWEST (0xA0000000). Shortest arc
// N -> SW goes CCW (N->NW->W->SW): angle must INCREASE by ANG90/2.
// Unsigned delta (old bug) is always >0 => always SUBTRACT => spun the long way.
const turn1 = run(`(function () {
  var p = players[0].mo;
  var m = P_SpawnMobj(p.x, p.y, p.z, 1);
  m.angle = 0x40000000; m.movedir = 5 /*SW*/; m.reactiontime = 0;
  m.movecount = 100;                                         // dodge missile branch
  m.target = { x: m.x + 300 * FU, y: m.y + 300 * FU,
               flags: MF_SHOOTABLE, health: 100 };
  A_Chase(m);
  var a = m.angle >>> 0;
  P_RemoveMobj(m);
  return a;
})()`);
check('A_Chase turn N->SW increments CCW (signed delta, p_enemy.c:687)',
  turn1 === 0x60000000, '0x' + turn1.toString(16));

const turn2 = run(`(function () {
  var p = players[0].mo;
  var m = P_SpawnMobj(p.x, p.y, p.z, 1);
  m.angle = 0x00000000; m.movedir = 6 /*SOUTH*/; m.reactiontime = 0;
  m.movecount = 100;
  m.target = { x: m.x, y: m.y + 300 * FU, flags: MF_SHOOTABLE, health: 100 };
  A_Chase(m);
  var a = m.angle >>> 0;
  P_RemoveMobj(m);
  return a;
})()`);
check('A_Chase turn E->S decrements CW toward south',
  turn2 === 0xE0000000, '0x' + turn2.toString(16));

// ---- chase progress: monster closes on a stationary player ------------------
// Spawn offset must have LINE OF SIGHT to the player: P_CheckSight gates the
// missile branch, and without sight a zombie man behind a wall correctly
// wanders (that's A_Look-less wandering, not a bug). The old fixture spawned
// 400 units EAST of the E1M1 start — through the entry hall's east wall,
// sight=false, zero shots: the fixture was wrong, not the engine.
// (0, +200) north sits in the open courtyard sightline — verified 200->55
// units closed, 27 missile triggers over 400 tics.
const close = run(`(function () {
  var pl = players[0].mo;
  var save = { x: pl.x, y: pl.y };
  var m = P_SpawnMobj(pl.x, (pl.y + 200 * FU) | 0, pl.z, 1);
  m.target = pl; m.movedir = 8; m.movecount = 0;
  m.flags |= MF_SHOOTABLE; m.health = 20;
  var d0 = P_AproxDistance(m.x - pl.x, m.y - pl.y) >> 16;
  var shots = 0;
  for (var t = 0; t < 400; t++) {
    if (!m.target) break;
    A_Chase(m);
    if (m.flags & 128 /*MF_JUSTATTACKED*/) shots++;
  }
  var d1 = P_AproxDistance(m.x - pl.x, m.y - pl.y) >> 16;
  var out = { sight: G.P_CheckSight ? 1 : 0, start: d0, end: d1, shots: shots };
  P_RemoveMobj(m);
  pl.x = save.x; pl.y = save.y;   // trials may have dragged the player
  return out;
})()`);
check('monster closes distance over 400 A_Chase tics',
  close.end < close.start - 50, close);
check('monster fires missiles during chase (attack loop alive)', close.shots > 0, close);

if (failures) { console.log('\n' + failures + ' FAILURE(S)'); process.exit(1); }
console.log('\nALL PASS (chase)');
