// tools/route-verify.js — headless: replay the winning armor route 5x,
// asserting the tic-exact trace is identical every run (determinism) and
// the armor is collected. Also proves zero-input idling never moves the
// player (the "starting too early" hypothesis).
'use strict';
const fs = require('fs'), vm = require('vm'), path = require('path');
const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer });
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, 'E1M1'));
const G = new Proxy({}, { get: (_, k) => ctx[k], set: (_, k, v) => { ctx[k] = v; return true; } });
G.currentMapName = 'e1m1.json';
G.currentMapJson = ctx.__map;
G.onLevelExit = () => {};
vm.runInContext('G_InitNew(2, 1, 1)', ctx);
vm.runInContext(`(function(){
  G.sectors.forEach(function(sec){
    var next;
    for (var mo = sec.thinglist; mo; mo = next) {
      next = mo.snext;
      if (mo.info && mo.info.seestate && (mo.flags & 0x400000) && mo.health > 0 && !mo.player)
        P_RemoveMobj(mo);
    }
  });
})()`, ctx);

vm.runInContext(`globalThis.__reset = (function(){
  var st = G.playerstarts[0], p = G.player, a = null;
  G.sectors.forEach(function(sec){ for (var mo = sec.thinglist; mo; mo = mo.snext)
    if (mo.sprite === 'ARM1' && !a) a = mo; });
  var armorType = a ? a.type : -1, ax = a ? a.x : 0, ay = a ? a.y : 0;
  return function () {
    var m = null;
    G.sectors.forEach(function(sec){ for (var mo = sec.thinglist; mo; mo = mo.snext)
      if (mo.sprite === 'ARM1' && !m) m = mo; });
    if (!m) P_SpawnMobj(ax, ay, 0, armorType);
    p.armorpoints = 0; p.armortype = 0;
    p.health = 100; p.mo.health = 100;
    p.mo.x = st.x << 16; p.mo.y = st.y << 16;
    p.mo.momx = p.mo.momy = p.mo.momz = 0;
    p.mo.angle = Math.floor(st.angle * 4294967296/360) >>> 0;
    P_SetThingPosition(p.mo);
    p.mo.z = p.mo.subsector.sector.floorheight; p.mo.floorz = p.mo.z;
    p.viewz = p.mo.z + p.viewheight; p.mo.lastangle = p.mo.angle;
    p.deltaviewheight = 0; p.bob = 0;
  };
})()`, ctx);

const RECIPE = { f1: 20, at: 1280, tn: 13, f2: 100 };

function runRoute() {
  return vm.runInContext(`(function(){
    globalThis.__reset();
    var trace = [];
    function seg(fmv, at, n){
      var c = {forwardmove:fmv, sidemove:0, angleturn:${'' + 0}, buttons:0};
      c.angleturn = at;
      for (var i = 0; i < n; i++) { G_Ticker(c);
        trace.push([G.player.mo.x, G.player.mo.y, G.player.mo.angle >>> 0]); }
    }
    seg(50, 0, ${RECIPE.f1});
    seg(0, ${RECIPE.at}, ${RECIPE.tn});
    seg(50, 0, ${RECIPE.f2});
    return JSON.stringify({ trace: trace, armor: G.player.armorpoints,
      end: [G.player.mo.x >> 16, G.player.mo.y >> 16] });
  })()`, ctx);
}

function idleCheck() {
  return JSON.parse(vm.runInContext(`(function(){
    globalThis.__reset();
    var x0 = G.player.mo.x, y0 = G.player.mo.y;
    var z = {forwardmove:0, sidemove:0, angleturn:0, buttons:0};
    for (var i = 0; i < 70; i++) G_Ticker(z);   // 2 seconds of nothing
    return JSON.stringify({ dx: (G.player.mo.x - x0) >> 16, dy: (G.player.mo.y - y0) >> 16 });
  })()`, ctx));
}

let fails = 0;
const first = runRoute();
for (let i = 0; i < 4; i++) {
  const r = runRoute();
  if (r !== first) { fails++; console.log('RUN', i + 2, 'DIVERGED'); break; }
}
const parsed = JSON.parse(first);
const idle = idleCheck();
console.log('armor collected:', parsed.armor >= 100, 'end:', parsed.end);
console.log('5x determinism:', fails === 0 ? 'IDENTICAL' : 'FAILED');
console.log('idle 70 tics drift:', idle);
if (parsed.armor < 100 || fails || idle.dx !== 0 || idle.dy !== 0) process.exit(1);
console.log('ALL PASS (route)');
