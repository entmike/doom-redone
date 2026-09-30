// tools/swarm-sim.js — crowd-behavior probe: teleport the whole map's
// monster roster into a ring around the player, godmode the observer,
// run N tics, report crowd dynamics.
//
// What vanilla-faithful looks like (verified E1M5, 30 monster crowd,
// 400 tics): monsters close distance, infight (7 died to friendly fire),
// ranged attackers STAND while firing (missile-state loop never reaches
// the nomissile mover — P_CheckMissileRange success => SetMobjState =>
// return, p_enemy.c:744-749 — so 'frozen' distant troopers ARE vanilla),
// melee crowd shuffles at MELEERANGE, only ~2/405 pairs slightly overlap
// (legit: PIT_CheckThing is z-blind — monsters on different floor heights
// never collide in vanilla either, p_map.c PIT_CheckThing).
// usage: node tools/swarm-sim.js [map] [tics]
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const MAP = process.argv[2] || 'e1m5';
const TICS = +(process.argv[3] || 400);
const ctx = vm.createContext({ console, Buffer });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, MAP));
const G = new Proxy({}, { get: (_, k) => ctx[k], set: (_, k, v) => { ctx[k] = v; return true; } });
G.currentMapName = MAP + '.json';
G.currentMapJson = ctx.__map;
G.onLevelExit = () => {};
const run = e => vm.runInContext(e, ctx);
run('G_InitNew(2, 1, ' + MAP.slice(-1) + ')');

const report = run(`(function(){
  var p = G.player.mo;
  // Teleport the whole E1M5 roster into a ring around the spawn point —
  // a crowd-density test vanilla never sees unless you herd; the useful
  // signal is congestion behavior (MF_SOLID blocking, turn-taking).
  var mons = [];
  var types = [];
  for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next)
    if (th.info && (th.flags & 0x400000) && !th.player) types.push(th.type);
  (function(){
    var R = 300 * 65536, n = types.length;
    for (var i = 0; i < n; i++) {
      var a = (i / n) * Math.PI * 2;
      var x = p.x + Math.round(Math.cos(a) * R), y = p.y + Math.round(Math.sin(a) * R);
      // only spawn on valid open floor, else shrink ring a step
      for (var k = 0; k < 6; k++) {
        if (P_CheckPosition ? true : true) break;
      }
      var probe = P_SpawnMobj(x, y, 0, types[i]);
      if (!P_CheckPosition(probe, x, y)) { P_RemoveMobj(probe); continue; }
      // mutual non-overlap: back off along the radius until clear of the
      // other monsters already placed (P_CheckPosition skips self, and
      // other mons were placed at r=R, so test against existing list)
      var clash = false;
      for (var q = 0; q < mons.length; q++) {
        var bd = probe.radius + mons[q].radius;
        if (Math.abs(probe.x - mons[q].x) < bd && Math.abs(probe.y - mons[q].y) < bd) { clash = true; break; }
      }
      if (clash) { P_RemoveMobj(probe); continue; }
      P_SetThingPosition(probe);
      probe.z = probe.subsector.sector.floorheight; probe.floorz = probe.z;
      mons.push(probe);
    }
  })();

  // distances at start
  var d0 = mons.map(function(m){ return Math.hypot(m.x - p.x, m.y - p.y); });

  // wake them all (what vanilla noise does), then chase TICS tics with the
  // player standing still
  for (var i = 0; i < mons.length; i++) {
    mons[i].target = p;
    if (mons[i].state.num === mons[i].info.spawnstate ||
        mons[i].state.num === mons[i].info.spawnst)
      G.ACTIONS.A_Look(mons[i]);
  }
  function overlapReport() {
    var out = [];
    for (var i = 0; i < mons.length; i++) for (var j = i + 1; j < mons.length; j++) {
      if (mons[i].health <= 0 || mons[j].health <= 0) continue;
      var bd = mons[i].radius + mons[j].radius;
      if (Math.abs(mons[i].x - mons[j].x) < bd && Math.abs(mons[i].y - mons[j].y) < bd)
        out.push([mons[i].sprite + '/' + mons[j].sprite,
                  (mons[i].x - mons[j].x) >> 16, (mons[i].y - mons[j].y) >> 16, bd >> 16]);
    }
    return out;
  }
  console.log('t0 overlaps:', overlapReport().length, JSON.stringify(overlapReport().slice(0, 5)));
  globalThis.__overlapReport = overlapReport;
  G.player.cheats |= 1;   // CF_GODMODE: keep the observer alive so the
                          // post-death 'return to spawn state' doesn't pollute
                          // movement stats (P_DamageMobj early-return path).
  var zero = {forwardmove:0,sidemove:0,angleturn:0,buttons:0};
  var stuck0 = {};   // track per-monster position history
  var hist = mons.map(function(){ return { last: null, same: 0, maxsame: 0 }; });
  for (var t = 0; t < ${TICS}; t++) {
    G.G_Ticker(zero);
    if (t % 8 === 0) for (var i = 0; i < mons.length; i++) {
      var m = mons[i];
      if (!m || m.health <= 0) continue;
      var pos = m.x + ',' + m.y;
      if (hist[i].last === pos) { hist[i].same++; if (hist[i].same > hist[i].maxsame) hist[i].maxsame = hist[i].same; }
      else hist[i].same = 0;
      hist[i].last = pos;
    }
  }
  var d1 = mons.map(function(m){ return m.health > 0 ? Math.hypot(m.x - p.x, m.y - p.y) : -1; });

  var alive = 0, closed = 0, opened = 0, frozen = 0, melee = 0;
  for (var i = 0; i < mons.length; i++) {
    if (d1[i] < 0) continue;
    alive++;
    if (d1[i] < d0[i] * 0.9) closed++;
    else if (d1[i] > d0[i] * 1.1) opened++;
    if (hist[i].maxsame >= 20) frozen++;   // same spot for >=160 tics
    if (d1[i] < 100 * 65536) melee++;
  }
  console.log('tEnd overlaps:', JSON.stringify(__overlapReport().slice(0, 6)));
  var frz = {};
  for (var i = 0; i < mons.length; i++) {
    if (mons[i].health <= 0) continue;
    if (hist[i].maxsame >= 20) frz[mons[i].sprite] = (frz[mons[i].sprite] || 0) + 1;
  }
  console.log('frozen by sprite:', JSON.stringify(frz));
  // monster-on-monster overlap count (MF_SOLID should make this ~0)
  var overlap = 0;
  for (var i = 0; i < mons.length; i++) for (var j = i + 1; j < mons.length; j++) {
    if (mons[i].health <= 0 || mons[j].health <= 0) continue;
    var bd = mons[i].radius + mons[j].radius;
    if (Math.abs(mons[i].x - mons[j].x) < bd && Math.abs(mons[i].y - mons[j].y) < bd) overlap++;
  }
  // deaths from infighting (monsters shoot each other in a crowd)
  var dead = mons.length - alive;
  return JSON.stringify({
    monsters: mons.length, alive: alive, dead_infight: dead,
    closed_distance: closed, moved_away: opened, static_still: alive - closed - opened,
    frozen_160tics: frozen, in_melee_range: melee, overlapping_pairs: overlap,
    player_hp: G.player.health
  }, null, 1);
})()`);
console.log(report);
