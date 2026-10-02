// tools/test-physics.js — gospel physics revalidation gate (2026-10 audit)
// Pins the line-by-line audit fixes against reference/linuxdoom-1.10:
//  1. P_XYMovement (p_mobj.c:150-164): sub-step loop RE-READS mo->x/mo->y
//     every iteration — mom > MAXMOVE/2 travels its FULL momentum (pre-fix
//     the 2nd half-step re-ran from the pre-loop spot => half speed).
//  2. PIT_CheckThing (p_map.c:299-314): KNIGHT<->BRUISER count as same
//     species (explode, zero damage); shooter itself passes through.
//  3. P_ThingHeightClip (p_map.c:539-540): unconditional tmfloorz adopt.
//  4. P_ExplodeMissile (p_mobj.c:103-104): deathsound fires (was silent).
//  5. P_SpawnMissile (p_mobj.c:902-903): launch seesound on the missile.
//  6. PIT_RadiusAttack (p_map.c:1175-1177): MT_SPIDER/MT_CYBORG immune.
//  7. Cheat bits == d_player.h:71-75 (NOCLIP=1, GODMODE=2, NOMOMENTUM=4)
//     — saves carry raw cheats; gospel interop needs gospel values.
//  8. PTR_ShootTraverse/PTR_AimTraverse: gospel per-line aimslope tests;
//     source-level ban on the invented topslope/bottomslope window.
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer, window: {} });
ctx.window = ctx;                       // sound.js `window.Snd` lands on ctx
require('./wadboot-host')(ctx);
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/sound.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const run = (e) => vm.runInContext(e, ctx);

ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, 'E1M1'));
run('Snd.S_Init();');
run(`G.currentMapName='E1M1'; G.currentMapJson=__map; G.onLevelExit=function(){}; G.G_InitNew(2,1,1);`);
run('G.P_CheckSight = function () { return true; };');   // radius test LOS stub

const FU = 65536;
const ps = run('({x: player.mo.x, y: player.mo.y})');  // fixed-point origin (playerstarts stores MAP units)
run('player.mo.flags &= ~MF_SOLID;');

// ---- 1. P_XYMovement full-momentum sub-steps ------------------------------
{
  const disp = run(`(function () {
    var mo = P_SpawnMobj(${ps.x}, ${ps.y}, -2147483648, 30 /*MT_BARREL*/);
    mo.momx = ${20 * FU}; mo.momy = 0;          // 20FU > MAXMOVE/2 (15FU)
    var x0 = mo.x;
    G.P_XYMovement(mo);
    var d = mo.x - x0;
    P_RemoveMobj(mo);
    return d;
  })()`);
  check('P_XYMovement: mom 20FU (>MAXMOVE/2) travels FULL momentum, not half',
    disp >= 19 * FU && disp <= 21 * FU, { units: disp / FU });
}

// ---- 2. PIT_CheckThing same-species incl. KNIGHT<->BRUISER ----------------
{
  const r = run(`(function () {
    var MISSILE = 16;                            // MT_BRUISERSHOT (baron/knight fireball)
    var missile = P_SpawnMobj(${ps.x}, ${ps.y}, -2147483648, MISSILE);
    // MT_BRUISERSHOT info already carries MF_MISSILE from spawn
    var knight  = P_SpawnMobj(${ps.x} + 200 * 65536, ${ps.y}, -2147483648, 17 /*MT_KNIGHT*/);
    var bruiser = P_SpawnMobj(${ps.x} + 201 * 65536, ${ps.y}, -2147483648, 15 /*MT_BRUISER*/);
    var zombie  = P_SpawnMobj(${ps.x} + 202 * 65536, ${ps.y}, -2147483648, 1 /*MT_POSSESSED*/);

    // (a) knight-fired missile vs baron: blocked, ZERO damage (species-equal pair)
    missile.target = knight;
    missile.x = bruiser.x; missile.y = bruiser.y;
    G.setTmthing(missile);
    var hp0 = bruiser.health;
    var resCross = G.PIT_CheckThing(bruiser);
    var crossBlocked = (resCross === false) && (bruiser.health === hp0);

    // (b) shooter itself passes through even while overlapping (bbox far first)
    missile.x = ${ps.x}; missile.y = ${ps.y};
    var resSelf = G.PIT_CheckThing(knight);      // far away: bbox early-out true
    missile.x = knight.x; missile.y = knight.y;  // now on top of the shooter
    resSelf = G.PIT_CheckThing(knight);

    // (c) baron-fired missile vs knight: SAME pair — also species-equal, no dmg
    missile.target = bruiser;
    var kh0 = knight.health;
    var resPair = G.PIT_CheckThing(knight);
    var pairBlocked = (resPair === false) && (knight.health === kh0);
    // (d) baron-fired missile vs zombie: normal species -> damage lands
    missile.target = bruiser;
    missile.x = zombie.x; missile.y = zombie.y;
    G.setTmthing(missile);
    var hz = zombie.health;
    var resDmg = G.PIT_CheckThing(zombie);
    var dmgLands = (resDmg === false) && (hz - zombie.health >= 5);

    P_RemoveMobj(missile); P_RemoveMobj(knight); P_RemoveMobj(bruiser);
    if (!(zombie.flags & 0x100000 /*MF_CORPSE*/)) P_RemoveMobj(zombie);
    return { crossBlocked: crossBlocked, resSelf: resSelf, pairBlocked: pairBlocked, dmgLands: dmgLands };
  })()`);
  check('PIT_CheckThing: knight-fired missile vs baron = explode NO damage', r.crossBlocked === true, r);
  check('PIT_CheckThing: missile passes through its own shooter (true)', r.resSelf === true, r);
  check('PIT_CheckThing: baron-fired missile vs knight = explode NO damage (pair is symmetric)', r.pairBlocked === true, r);
  check('PIT_CheckThing: baron-fired missile vs zombie still damages (guard is species-only)', r.dmgLands === true, r);
}

// ---- 3./8. source-level gospel bans ----------------------------------------
{
  const src = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');
  const thc = src.slice(src.indexOf('function P_ThingHeightClip'),
    src.indexOf('function P_ThingHeightClip') + 900);
  check('P_ThingHeightClip: unconditional tmfloorz adopt (no stale-floor branch)',
    /thing\.floorz = tmfloorz;\s*\n\s*thing\.ceilingz = tmceilingz;/.test(thc) && !/oldfloorz/.test(thc));
  const pst = src.slice(src.indexOf('function PTR_ShootTraverse'),
    src.indexOf('function PTR_ShootTraverse') + 3200);
  check('PTR_ShootTraverse: no invented topslope/bottomslope window; gospel per-line tests',
    !/[^g]bottomslope\s*=/.test(pst.replace(/thingbottomslope/g, 'TB')) &&
    !/(^|[^g])topslope\s*=/.test(pst.replace(/thingtopslope/g, 'TT')) &&
    /frontsector\.floorheight !== li\.backsector\.floorheight/.test(pst) &&
    /frontsector\.ceilingheight !== li\.backsector\.ceilingheight/.test(pst));
  const aim = src.slice(src.indexOf('function PTR_AimTraverse'),
    src.indexOf('function PTR_AimTraverse') + 1600);
  check('PTR_AimTraverse: gospel openbottom>=opentop stop + height-differ conditionals',
    /openbottom >= opentop/.test(aim) && /floorheight !== li\.backsector\.floorheight/.test(aim));
  const lin = src.slice(src.indexOf('function P_LineAttack'),
    src.indexOf('function P_LineAttack') + 900);
  check('P_LineAttack: no ±FU slope seeding (gospel sets nothing)',
    !/topslope = slope/.test(lin));
  const z = src.slice(src.indexOf('function PTR_ShootTraverse'),
    src.indexOf('function PTR_ShootTraverse') + 3200);
  check('PTR_ShootTraverse: sky checks are gospel (z>front ceiling + back-sky hack)',
    /z > li\.frontsector\.ceilingheight/.test(z) &&
    /li\.backsector && li\.backsector\.ceilingpic === G\.skyflatnum/.test(z));
}

// ---- 4. P_ExplodeMissile deathsound -----------------------------------------
{
  const r = run(`(function () {
    var log = [];
    var realS = window.Snd.S_StartSound;
    window.Snd.S_StartSound = function (o, id) { log.push(id); };
    var mo = P_SpawnMobj(${ps.x}, ${ps.y}, -2147483648, 33 /*MT_ROCKET*/);
    G.P_ExplodeMissile(mo);
    window.Snd.S_StartSound = realS;
    var ds = G.mobjinfo[33].deathsound;
    var ok = ds !== 0 && log.indexOf(ds) >= 0;
    P_RemoveMobj(mo);
    return { ok: ok, log: log, ds: ds };
  })()`);
  check('P_ExplodeMissile: deathsound fires (sfx ' + r.ds + ')', r.ok === true, r);
}

// ---- 5. P_SpawnMissile seesound ---------------------------------------------
{
  const r = run(`(function () {
    var log = [];
    var realS = window.Snd.S_StartSound;
    window.Snd.S_StartSound = function (o, id) { log.push(id); };
    var th = G.P_SpawnMissile(player.mo, player.mo, 33 /*MT_ROCKET*/);
    window.Snd.S_StartSound = realS;
    var ss = G.mobjinfo[33].seesound;
    var ok = ss !== 0 && log.indexOf(ss) >= 0;
    P_RemoveMobj(th);
    return { ok: ok, log: log, ss: ss };
  })()`);
  check('P_SpawnMissile: launch seesound fires on the missile (sfx ' + r.ss + ')', r.ok === true, r);
}

// ---- 6. PIT_RadiusAttack boss immunity --------------------------------------
{
  const r = run(`(function () {
    var spider = P_SpawnMobj(${ps.x} + 2 * 65536, ${ps.y}, -2147483648, 19 /*MT_SPIDER*/);
    var cyb = P_SpawnMobj(${ps.x} + 3 * 65536, ${ps.y}, -2147483648, 21 /*MT_CYBORG*/);
    var z = P_SpawnMobj(${ps.x} + 2 * 65536, ${ps.y} + 64 * 65536, -2147483648, 1 /*MT_POSSESSED*/);
    z.health = 40;                           // 128-dmg bomb must visibly hurt it
    var spot = P_SpawnMobj(${ps.x}, ${ps.y}, -2147483648, 37 /*MT_PUFF*/);
    G.setBombspot(spot, spot, 128);
    var hs = spider.health, hc = cyb.health, hz = z.health;
    G.PIT_RadiusAttack(spider); G.PIT_RadiusAttack(cyb); G.PIT_RadiusAttack(z);
    var immune = (spider.health === hs) && (cyb.health === hc);
    var otherHit = hz - z.health > 0;
    P_RemoveMobj(spider); P_RemoveMobj(cyb); P_RemoveMobj(spot);
    if (!(z.flags & 0x100000 /*MF_CORPSE*/)) P_RemoveMobj(z);
    return { immune: immune, otherHit: otherHit, hz: hz, z1: z.health };
  })()`);
  check('PIT_RadiusAttack: spider+cyborg take ZERO splash', r.immune === true, r);
  check('PIT_RadiusAttack: zombie in range still damaged (guard is boss-only)', r.otherHit === true, r);
}

// ---- 7. gospel cheat bit values ----------------------------------------------
{
  const g = fs.readFileSync(path.join(root, 'src/game.js'), 'utf8');
  const m = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');
  const h = fs.readFileSync(path.join(root, 'src/hud.js'), 'utf8');
  check('game.js: no NOMOMENTUM=64 / GODMODE=1 / NOCLIP=2 remnants',
    !/cheats & 64/.test(g) && !/& 1\) \/\*CF_GODMODE/.test(g) && !/& 2 \/\*CF_NOCLIP/.test(g));
  check('game.js: gospel bits present (NOCLIP&1, GODMODE&2, NOMOMENTUM&4)',
    /cheats & 1 \/\*CF_NOCLIP/.test(g) && /cheats & 2\) \/\*CF_GODMODE/.test(g) &&
    (/cheats & 4 \/\*CF_NOMOMENTUM/.test(g) || /cheats & 4\) \|\| !onground/.test(g)));
  check('main.js: CF_NOCLIP=1, CF_GODMODE=2 (d_player.h)',
    /CF_NOCLIP = 1, CF_GODMODE = 2/.test(m));
  check('hud.js: CF_GODMODE=2', /CF_GODMODE = 2/.test(h));
}

console.log(failures ? 'PHYSICS-GATE: ' + failures + ' FAILURES' : 'PHYSICS-GATE all passed');
process.exit(failures ? 1 : 0);
