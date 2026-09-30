// tools/route-solve.js — headless solver: find [fwd][left-turn][fwd] tic
// counts (fwd=50, angleturn=+640/+1280 CCW) that walk E1M1's player start to
// the green armor pickup, using the exact G_Ticker path the CDP driver uses.
// Prints the winning recipe; tools/cdp-route-probe.js asserts it live.
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

// strip monsters: geometry-only route (CDP probe does the same)
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

const st = JSON.parse(vm.runInContext('JSON.stringify(G.playerstarts[0])', ctx));
const armor0 = JSON.parse(vm.runInContext(`(function(){
  var a = null;
  G.sectors.forEach(function(sec){ for (var mo = sec.thinglist; mo; mo = mo.snext)
    if (mo.sprite === 'ARM1' && !a) a = { x: mo.x, y: mo.y, type: mo.type }; });
  return JSON.stringify(a);
})()`, ctx));
console.log('start', st, 'armor', armor0);

const reset = vm.runInContext(`(function(){
  var st = G.playerstarts[0], p = G.player, a = null;
  G.sectors.forEach(function(sec){ for (var mo = sec.thinglist; mo; mo = mo.snext)
    if (mo.sprite === 'ARM1' && !a) a = mo; });
  var armorType = a ? a.type : -1, ax = a ? a.x : 0, ay = a ? a.y : 0;
  return function () {
    var m = null;
    G.sectors.forEach(function(sec){ for (var mo = sec.thinglist; mo; mo = mo.snext)
      if (mo.sprite === 'ARM1' && !m) m = mo; });
    if (!m) P_SpawnMobj(ax, ay, 0, armorType);   // respawn picked-up armor
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

function seg(fmv, at, n) {
  vm.runInContext(`(function(){
    var c = {forwardmove:${fmv}, sidemove:0, angleturn:${at}, buttons:0};
    for (var i = 0; i < ${n}; i++) G_Ticker(c);
  })()`, ctx);
}
function state() {
  return JSON.parse(vm.runInContext(`JSON.stringify({
    x: G.player.mo.x >> 16, y: G.player.mo.y >> 16,
    ang: +(G.player.mo.angle * 360 / 4294967296).toFixed(1),
    armor: G.player.armorpoints,
    dist: Math.round(Math.hypot(G.player.mo.x - ${armor0.x}, G.player.mo.y - ${armor0.y}) / FU)
  })`, ctx));
}

let best = null, bestDist = 1e9;
for (const at of [640, 1280]) {
  for (let f1 = 0; f1 <= 90; f1 += 5) {
    for (let tn = 4; tn <= 24; tn += 1) {
      for (let f2 = 10; f2 <= 160; f2 += 10) {
        reset();
        seg(50, 0, f1);
        seg(0, at, tn);
        seg(50, 0, f2);
        const s = state();
        if (s.armor >= 100) {
          console.log('ROUTE FOUND', JSON.stringify({ at, f1, tn, f2 }), s);
          process.exit(0);
        }
        if (s.dist < bestDist) { bestDist = s.dist; best = { at, f1, tn, f2, s }; }
      }
    }
  }
}
console.log('NO ROUTE — closest:', JSON.stringify(best));
