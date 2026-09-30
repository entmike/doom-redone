// tools/test-save.js — headless save/load round-trip (p_saveg.js)
// Boot E1M1, tick, mutate the world (sector heights, lights, mobjs,
// player state, a door thinker), save to a fake localStorage, mutate
// HARDER, reload, and assert the world matches the save point.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer, Math, JSON, Date,
  btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
  atob: (s) => Buffer.from(s, 'base64').toString('binary'),
  localStorage: (() => { const m = new Map(); return {
    getItem: k => m.has(k) ? m.get(k) : null,
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k), _m: m,
    get length() { return m.size; },
    key: i => Array.from(m.keys())[i] ?? null }; })()
});
require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/p_saveg.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, 'E1M1'));
vm.runInContext('G.currentMapName = "assets/e1m1.json"; G.currentMapJson = __map; G.G_InitNew(2, 1, 1);', ctx);

let failures = 0;
function run(e) { return vm.runInContext(e, ctx); }
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : extra); }
}

// tick a bit (RNG, anims, monster think)
run('for (var i = 0; i < 70; i++) { G.G_Ticker({forwardmove:0,sidemove:0,angleturn:0,buttons:0}); }');

// open a door (spawn a vldoor_t thinker): find any usable door linedef —
// use EV_DoDoor via a tagged sector: easier to fabricate through exports
run(`(function(){
  var doors = G.lines.filter(function(l){ return l.special===1||l.special===26||l.special===27||l.special===28; });
  if (doors.length) G.EV_DoDoor(doors[0], 0 /*normal*/);
})()`);

// mutate player state deterministically
run(`(function(){
  var p = G.players[0];
  p.health = 73; p.armorpoints = 50; p.armortype = 1;
  p.ammo[1] = 17; p.powers[0] = 120; p.cards[0] = true;
  p.killcount = 4; p.itemcount = 2; p.viewz = (p.viewz + 128) | 0;
})()`);
// move the player, spawn & kill a thing to get a corpse mobj in the list
run(`(function(){
  var mo = G.players[0].mo;
  mo.x = (mo.x + 32 * FRACUNIT) | 0;
  var fog = G.P_SpawnMobj(mo.x, mo.y, mo.floorz, 7);   // MT_TFOG (transient mobj)
  fog.health = 1;
})()`);

const snapshot = run(`(function(){
  function sec(i){ var s = G.sectors[i]; return [s.floorheight, s.ceilingheight, s.lightlevel, s.special, s.tag]; }
  return JSON.stringify({
    leveltime: G.leveltime,
    health: G.players[0].health, armor: G.players[0].armorpoints,
    ammo1: G.players[0].ammo[1], power0: G.players[0].powers[0],
    card0: G.players[0].cards[0], kills: G.players[0].killcount,
    viewz: G.players[0].viewz, px: G.players[0].mo.x, py: G.players[0].mo.y,
    thinkerCount: G.liveThinkers().length,
    sec0: sec(0), sec1: sec(1),
    doorCount: G.liveThinkers().filter(function(t){return t.function===G.T_VerticalDoor;}).length
  });
})()`);

// ---- SAVE (slot 0) ----
run('SAVE.G_SaveGame(0, "roundtrip test"); SAVE.DoSaveGame();');
// WAD-namespaced key: 'doom-redone:save:<fp>:doomsavN' (p_saveg.js slotKey)
const stored = run('localStorage.getItem("doom-redone:save:doomsav0")') === null
  && run('localStorage.getItem(SAVE.slotKey(0)) !== null');
check('save written to WAD-namespaced storage', !!stored);
check('legacy un-namespaced key NOT written',
  run('localStorage.getItem("doom-redone:save:doomsav0")') === null);
const fpEnv = JSON.parse(run('localStorage.getItem(SAVE.slotKey(0))'));
check('envelope carries WAD fingerprint',
  fpEnv.w === run('WadInstall.fingerprint()'), fpEnv.w);
const msg = run('G.players[0].message');
check('GGSAVED message', msg === 'game saved.', msg);

// ---- corrupt the world post-save ----
run(`(function(){
  G.leveltime = 9999;
  var p = G.players[0];
  p.health = 1; p.armorpoints = 0; p.armortype = 0;
  p.ammo[1] = 0; p.powers[0] = 0; p.cards[0] = false; p.killcount = 0;
  G.sectors[0].lightlevel = (G.sectors[0].lightlevel + 40) & 255;
  G.sectors[1].floorheight = (G.sectors[1].floorheight + 256 * FRACUNIT) | 0;
  // kill a monster to change the mobj list
  var th = G.liveThinkers();
  for (var i = 0; i < th.length; i++)
    if (th[i].info && (th[i].info.flags & 0x40000000)) { G.P_DamageMobj(th[i], null, null, 10000); break; }
  for (var k = 0; k < 30; k++) G.G_Ticker({forwardmove:0,sidemove:0,angleturn:0,buttons:0});
})()`);

// ---- LOAD (synchronous: same map name, no fetch needed) ----
vm.runInContext('SAVE.DoLoadGame(0, function(v){ window_loadDone = v; });', ctx);
const done = run('window_loadDone');
check('load returned success', done === true);

const after = JSON.parse(run(`(function(){
  function sec(i){ var s = G.sectors[i]; return [s.floorheight, s.ceilingheight, s.lightlevel, s.special, s.tag]; }
  return JSON.stringify({
    leveltime: G.leveltime,
    health: G.players[0].health, armor: G.players[0].armorpoints,
    ammo1: G.players[0].ammo[1], power0: G.players[0].powers[0],
    card0: G.players[0].cards[0], kills: G.players[0].killcount,
    viewz: G.players[0].viewz, px: G.players[0].mo.x, py: G.players[0].mo.y,
    thinkerCount: G.liveThinkers().length,
    sec0: sec(0), sec1: sec(1),
    doorCount: G.liveThinkers().filter(function(t){return t.function===G.T_VerticalDoor;}).length
  });
})()`));
const snap = JSON.parse(snapshot);

check('leveltime restored', after.leveltime === snap.leveltime, snap.leveltime + ' vs ' + after.leveltime);
check('player health/armor restored', after.health === 73 && after.armor === 50 && after.ammo1 === 17, JSON.stringify(after));
check('powers/cards/kills restored', after.power0 === 120 && after.card0 === true && after.kills === 4);
check('player mobj restored & relinked', after.px === snap.px && !!run('G.players[0].mo') && run('G.players[0].mo.player === G.players[0]'));
check('viewz restored', after.viewz === snap.viewz);
check('sector geometry/light restored', JSON.stringify(after.sec0) === JSON.stringify(snap.sec0) && JSON.stringify(after.sec1) === JSON.stringify(snap.sec1),
  JSON.stringify(snap.sec1) + ' vs ' + JSON.stringify(after.sec1));
check('door thinker count restored', after.doorCount === snap.doorCount && snap.doorCount >= 1, snap.doorCount + ' vs ' + after.doorCount);
check('mobj thinker count restored', after.thinkerCount === snap.thinkerCount, snap.thinkerCount + ' vs ' + after.thinkerCount);

// ---- M_ReadSaveStrings sees the slot ----
check('readSlot returns description', run('SAVE.readSlot(0)') === 'roundtrip test');
check('empty slot reads null', run('SAVE.readSlot(5)') === null);

// ---- post-load sim still runs (thinkers healthy) ----
run('for (var i = 0; i < 35; i++) G.G_Ticker({forwardmove:0,sidemove:0,angleturn:0,buttons:0});');
check('sim runs after load', run('G.leveltime') === snap.leveltime + 35, run('G.leveltime'));

// ---- cross-WAD isolation: another IWAD's fingerprint can't see this save ----
const ours = run('WadInstall.fingerprint()');
run('WadInstall.setFingerprint("wforeign1")');
check('foreign WAD: readSlot hides the slot', run('SAVE.readSlot(0)') === null);
run(`SAVE.DoLoadGame(0, function(v){ window_xw = v; });`);
check('foreign WAD: DoLoadGame refuses', run('window_xw') === false);
run('WadInstall.setFingerprint("' + ours + '")');
check('back to our WAD: readSlot sees it again', run('SAVE.readSlot(0)') === 'roundtrip test');

// ---- legacy keys nuked on install; OTHER WADs' namespaced keys preserved --
run(`localStorage.setItem("doom-redone:save:doomsav3", '{"d":"legacy save","a":"AA=="}');
     localStorage.setItem("doom-redone:save:wzzzzzzz:doomsav4", '{"d":"other wad","a":"AA=="}');`);
const nuked = run('SAVE.nukeForeignSaves()');
check('nukeForeignSaves removed ONLY the legacy key', nuked === 1, nuked);
check('our namespaced save survived the nuke', run('SAVE.readSlot(0)') === 'roundtrip test');
check('legacy key deleted', run('localStorage.getItem("doom-redone:save:doomsav3")') === null);
check("other WAD's key preserved for its own WAD",
      run('localStorage.getItem("doom-redone:save:wzzzzzzz:doomsav4")') !== null);
run('WadInstall.setFingerprint("wzzzzzzz")');
check('other WAD can read its preserved slot', run('SAVE.readSlot(4)') === 'other wad');
check('other WAD cannot see our slot', run('SAVE.readSlot(0)') === null);
run('WadInstall.setFingerprint("' + ours + '")');

if (failures) { console.log('\n' + failures + ' FAILURES'); process.exit(1); }
console.log('\nALL CHECKS PASSED');
