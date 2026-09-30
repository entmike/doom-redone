// Regression: equipment/status must carry across levels (g_game.c
// G_DoWorldDone -> G_DoLoadLevel, g_game.c:440-476), while:
//  - health/ammo/weapons/keys state persists (players stay PST_LIVE);
//  - powers + cards are stripped by G_PlayerFinishLevel at G_DoCompleted
//    (g_game.c:779/1027) — they do NOT carry;
//  - per-level tallies reset; skill is NOT clobbered;
//  - G_InitNew (New Game) still reborn-resets to pistol+50.
'use strict';
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
let fail = 0;
const ck = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

const ctx = { console, Buffer, Math, JSON, Date,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  window: {} };
ctx.window = ctx;
vm.createContext(ctx);
boot(ctx, 'doom1.wad');
for (const f of ['src/engine.js', 'src/game.js', 'src/sound.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
const S = c => vm.runInContext(c, ctx);
S(`Snd.S_Init();`);
S(`G.currentMapJson = WAD.mapJson(__wad, "E1M1"); G.G_InitNew(4, 1, 1);`);   // sk_nightmare

// kit the player up on level 1: weapons, ammo, health, armor, keys, powers
S(`(function(){
  var p = G.players[0];
  p.health = 187; p.armorpoints = 150; p.armortype = 2;
  p.ammo[0] = 40; p.ammo[1] = 22; p.ammo[2] = 60;
  p.weaponowned[2] = true; p.weaponowned[3] = true; p.weaponowned[5] = true; // shotgun/chaingun/plasma
  p.readyweapon = p.pendingweapon = 3;            // chaingun (wp_chaingun)
  p.cards[0] = true; p.cards[4] = true;           // blue + red cards
  p.powers[1] = 200; p.powers[3] = 100;           // invisibility, ironfeet
  p.killcount = 12; p.itemcount = 3; p.secretcount = 1;
  p.playerstate = 2;                               // PST_LIVE
})()`);

// level end: intermission snapshot FIRST (must see this level's tallies),
// then the next-level load — main.js: G.G_DoCompleted() then gotoMap path
const snap = JSON.parse(S(`(function(){
  var w = G.G_DoCompleted();
  return JSON.stringify({ skills: w.skills, sitems: w.sitems, ssecret: w.ssecret,
    cards: G.players[0].cards.slice(), powers: G.players[0].powers.slice() });
})()`));
ck(snap.skills === 12 && snap.sitems === 3 && snap.ssecret === 1,
  'G_DoCompleted snapshots the completed level tallies for the intermission');
ck(!snap.cards.some(Boolean) && !snap.powers.some(x => x),
  'G_PlayerFinishLevel strips cards + powers at level end (g_game.c:1027)');

S(`G.currentMapJson = WAD.mapJson(__wad, "E1M2"); G.G_DoLoadLevel(1, 2);`);

const after = JSON.parse(S(`JSON.stringify({
  health: G.players[0].health, armorpoints: G.players[0].armorpoints, armortype: G.players[0].armortype,
  ammo: G.players[0].ammo.slice(), owned: G.players[0].weaponowned.slice(),
  ready: G.players[0].readyweapon, state: G.players[0].playerstate,
  skill: G.gameskill, map: G.gamemap, ep: G.gameepisode,
  kills: G.players[0].killcount, items: G.players[0].itemcount, secs: G.players[0].secretcount,
  cards: G.players[0].cards.slice(), powers: G.players[0].powers.slice(),
  sky: G.skyTextureName, moHp: G.players[0].mo && G.players[0].mo.health
})`));
ck(after.health === 187 && after.moHp === 187, 'health carries to next level (player + mobj)');
ck(after.armorpoints === 150 && after.armortype === 2, 'armor carries to next level');
ck(after.ammo[1] === 22 && after.ammo[2] === 60, 'ammo carries to next level');
ck(after.owned[2] && after.owned[3] && after.owned[5], 'weapon ownership carries');
ck(after.ready === 3, 'ready weapon (chaingun) carries');
ck(after.state === 2, 'player stays PST_LIVE (no reborn)');
ck(after.skill === 4, 'skill NOT clobbered by level change (was hardcoded sk_medium)');
ck(after.map === 2 && after.ep === 1 && after.sky === 'SKY1', 'episode/map/sky updated for new level');
ck(after.kills === 0 && after.items === 0 && after.secs === 0, 'per-level tallies reset on new level');
ck(!after.cards.some(Boolean) && !after.powers.some(x => x), 'cards/powers stay stripped');

// New Game must still wipe everything back to the defaults
S(`G.currentMapJson = WAD.mapJson(__wad, "E1M1"); G.G_InitNew(2, 1, 1);`);
const fresh = JSON.parse(S(`JSON.stringify({
  health: G.players[0].health, clip: G.players[0].ammo[1],   // am_clip=1 in port (noammo slot 0)
  owned3: G.players[0].weaponowned[3], ready: G.players[0].readyweapon, skill: G.gameskill })`));
ck(fresh.health === 100 && fresh.clip === 50 && !fresh.owned3 && fresh.ready === 1 && fresh.skill === 2,
  'G_InitNew (New Game) still resets to pistol + 50 clips');

// main.js wiring: gotoMap (G_DoWorldDone seam) must call G_DoLoadLevel,
// NOT G_InitNew — G_InitNew force-reborns and hardcodes skill 2.
const mainsrc = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
const gotoFn = mainsrc.slice(mainsrc.indexOf('async function gotoMap'),
                             mainsrc.indexOf('// g_game.c G_DoCompleted'));
ck(/G\.G_DoLoadLevel\(ep, num\)/.test(gotoFn) && !/G\.G_InitNew\(/.test(gotoFn),
   'main.js gotoMap uses G_DoLoadLevel (next-level carry path), not G_InitNew');
// side-panel map dropdown warp must go through gotoMap too (it was a second
// G_InitNew copy that reset inventory on every panel warp)
const warpFn = mainsrc.slice(mainsrc.indexOf('async function doWarp'),
                             mainsrc.indexOf("$('ch-warp')"));
ck(!/G\.G_InitNew\(/.test(warpFn) && /await gotoMap\(ep, num\)/.test(warpFn),
   'main.js doWarp (map dropdown) routes through gotoMap carry path, not G_InitNew');

console.log(fail ? '\n' + fail + ' FAILURES' : '\nALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
