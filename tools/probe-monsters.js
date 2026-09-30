// Smoke: spawn every DOOM 2 monster + brain/keen specials on DOOM2 MAP01,
// aggro, tick 240 tics — every new p_enemy.c action must run clean.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary') };
vm.createContext(ctx);
boot(ctx, 'DOOM2.wad');
for (const f of ['src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const out = vm.runInContext(`(function(){
  G.currentMapJson = WAD.mapJson(__wad, 'MAP01');
  G.G_InitNew(3, 1, 1);
  G.warned = {};
  const ps = G.playerstarts[0];
  const nums = [64, 66, 67, 68, 69, 71, 7, 16, 3005, 3006, 65, 72];
  nums.forEach((dn,i) => G.P_SpawnMapThing({x: ps.x + 128 + i*64, y: ps.y + 128, angle: 0, type: dn, options: 0x0f}));
  const errs = [];
  try {
    for (let n = 0; n < 240; n++) {
      for (const s of G.mapdata.sectors) for (let mo = s.thinglist; mo; mo = mo.snext)
        if (mo.info && (mo.info.flags & 4) && !mo.target) mo.target = G.players[0].mo;
      G.G_Ticker(G.players[0].cmd);
    }
  } catch (e) { errs.push(String(e && e.stack || e).split('\\n').slice(0,3).join(' | ')); }
  const warn = Object.keys(G.warned || {}).filter(k => /unimplemented|unimpl/.test(k));
  let alive = 0;
  for (const s of G.mapdata.sectors) for (let mo = s.thinglist; mo; mo = mo.snext)
    if (mo.info && mo.info.doomednum > 0 && (mo.info.flags & 4) && mo.health > 0) alive++;
  return JSON.stringify({errs, warn, alive});
})()`, ctx);
console.log(out);
const r = JSON.parse(out);
if (r.errs.length || r.warn.length) { console.log('SMOKE FAIL'); process.exit(1); }
console.log('SMOKE OK — monsters alive after 240 tics:', r.alive);
