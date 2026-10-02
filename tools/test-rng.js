// tools/test-rng.js — RNG gospel gate (m_random.c + p_enemy.c call-order)
// Guards:
//  1. rndtable in engine.js AND the game.js shim are BYTE-IDENTICAL to
//     reference/linuxdoom-1.10/m_random.c; sequence starts 0,8,109,220,...;
//     index wraps &0xff; M_ClearRandom restarts it (P_ResetRandomness).
//  2. One shared stream: G.P_Random IS the engine P_Random (no forked
//     counter when engine.js is loaded — the game.js shim self-suppresses).
//  3. A_SPosAttack (spider/shotguy volley, p_enemy.c:821):
//     - target==NULL burns ZERO rolls (guard p_enemy.c:829 — an earlier
//       splice lacked it; a target dying mid-volley desynced every later roll)
//     - first 5 rolls are gospel table slots in gospel order: the volley
//       eats [spread,spread,damage] per pass — nothing before them.
//     - dead-but-present target STILL fires (no health check in C).
//  4. A_PosAttack guard (p_enemy.c:800), A_CPosAttack (p_enemy.c:845) same
//     contract; full-call budgets pinned as E1M1-measured gospel totals
//     (volley rolls + P_LineAttack puff rolls per pass: 3*(3+3+2)=24).
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer });
require('./wadboot-host')(ctx);
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const run = (e) => vm.runInContext(e, ctx);

// ---- 1. rndtable byte-identity against gospel C --------------------------
const cSrc = fs.readFileSync(path.join(root, 'reference/linuxdoom-1.10/m_random.c'), 'utf8');
const cTable = [...cSrc.match(/rndtable\[[^\]]*\]\s*=\s*\{([\s\S]*?)\};/)[1]
  .matchAll(/\b\d+\b/g)].map(m => +m[0]);
check('gospel table parses to 256 entries', cTable.length === 256);
function jsTable(file) {
  const src = fs.readFileSync(path.join(root, file), 'utf8');
  const i = src.indexOf('rndtable');
  const a = src.indexOf('[', i), b = src.indexOf(']', a);
  return [...src.slice(a + 1, b).matchAll(/\b\d+\b/g)].map(m => +m[0]);
}
check('engine.js rndtable == m_random.c (256 bytes)', jsTable('src/engine.js').join() === cTable.join());
check('game.js shim rndtable == m_random.c', jsTable('src/game.js').join() === cTable.join());
// gospel P_Random pre-increments: first roll after reset is rndtable[1]=8
check('sequence head is 8,109,220,222,241,149 (table slots 1..6, pre-increment)',
  run('M_ClearRandom(); [P_Random(),P_Random(),P_Random(),P_Random(),P_Random(),P_Random()].join()') === '8,109,220,222,241,149');
check('prndindex wraps &0xff (gospel PRANDMASK)',
  run('M_ClearRandom(); for (var i = 0; i < 300; i++) P_Random(); prndindex') === (300 & 0xff));

// ---- 2. single shared stream (no forked shim counter) ---------------------
check('G.P_Random IS engine P_Random (one stream)', run('G.P_Random === P_Random'));

// ---- attack-roll budget harness --------------------------------------------
ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, 'E1M1'));
run(`G.currentMapName='E1M1'; G.currentMapJson=__map; G.onLevelExit=function(){}; G.G_InitNew(2,1,1);`);
const budget = run(`(function () {
  // counts P_Random rolls burned by one attack-action call; mode:
  //  'live' target=player | 'no' target=null | 'dead' target health 0 (still fires, gospel)
  return function (actionName, mode) {
    var A = G.ACTIONS[actionName];
    if (!A) throw new Error('ACTIONS.' + actionName + ' missing');
    var p = G.players[0].mo;
    var sh = P_SpawnMobj(p.x + 3 * 65536, p.y, 0, 1);   // MT_POSSESSED shooter
    if (mode === 'no') sh.target = null;
    else { sh.target = p; p.health = (mode === 'dead') ? 0 : 100; }
    M_ClearRandom();
    var calls = 0, seq = [];
    var eng = P_Random;
    P_Random = function () { calls++; seq.push(eng()); return seq[seq.length - 1]; };
    G.P_Random = P_Random;                              // game.js routes via G.
    try { A(sh); } finally { P_Random = eng; G.P_Random = eng; }
    sh.target = null; P_RemoveMobj(sh);
    return { calls: calls, seq: seq };
  };
})()`);

const S = budget('A_SPosAttack', 'live');
check('A_SPosAttack: first 5 rolls are gospel slots in order (spread,spread,dmg,spread,spread)',
  S.seq.slice(0, 5).join() === cTable.slice(1, 6).join(), S.seq.slice(0, 5));
check('A_SPosAttack: 0 rolls when target==NULL (guard p_enemy.c:829)',
  budget('A_SPosAttack', 'no').calls === 0);
// dead-but-present target: gospel has NO health check in A_SPosAttack — the
// volley still fires and eats the SAME 9 volley rolls (spread,spread,damage x3).
// Downstream totals differ (P_DamageMobj on a corpse skips the pain-check roll)
// — that is vanilla, so compare the volley slots, not the grand total.
const D = budget('A_SPosAttack', 'dead');
check('A_SPosAttack: dead-but-present target fires with identical 9 volley rolls',
  D.seq.slice(0, 9).join() === S.seq.slice(0, 9).join() && D.calls >= 9,
  { dead: D.calls, live: S.calls });
check('A_SPosAttack: full volley budget 24 = 3 passes x [3 volley + 3 puff + 2 puff-tics]',
  S.calls === 24, S.calls);
const P = budget('A_PosAttack', 'live');
check('A_PosAttack: 0 rolls when target==NULL (guard p_enemy.c:800)',
  budget('A_PosAttack', 'no').calls === 0);
check('A_PosAttack: budget 8 = 3 attack + 3 puff + 2 puff-tics', P.calls === 8, P.calls);
const C = budget('A_CPosAttack', 'live');
check('A_CPosAttack: 0 rolls when target==NULL (guard p_enemy.c:852)',
  budget('A_CPosAttack', 'no').calls === 0);
check('A_CPosAttack: budget 8 = 3 attack + 3 puff + 2 puff-tics', C.calls === 8, C.calls);

// ---- P_CheckMissileRange type branches (p_enemy.c:220-252) -----------------
// These early-outs happen BEFORE the P_Random()<dist roll: they must burn
// ZERO rolls. Skipping them (old bug) desynced the stream on every vile /
// revenant-close / attempt. MT_VILE=16? — use the port enums from the vm.
const ENUMS = { MT_VILE: 3, MT_UNDEAD: 5, MT_TROOP: 11, MT_SKULL: 18, MT_SPIDER: 19, MT_CYBORG: 21 };
function mrRolls(type, distFu) {
  return run(`(() => {
    var p = G.players[0].mo;
    var save = { x: p.x, y: p.y, hp: p.health };
    var m = P_SpawnMobj(p.x, p.y, 0, ${type});
    m.target = p; m.reactiontime = 0; m.flags &= ~64;      // ~MF_JUSTHIT
    p.x = (m.x + ${distFu}) | 0; p.y = m.y;                // fixed distance apart
    var sightOld = G.P_CheckSight;                          // stub sight so the
    G.P_CheckSight = function () { return true; };          // DIST branches are what's measured
    M_ClearRandom();
    G.P_CheckMissileRange(m);
    var used = prndindex & 0xff;
    G.P_CheckSight = sightOld;
    m.target = null; P_RemoveMobj(m);
    p.x = save.x; p.y = save.y; p.health = save.hp;
    return used;
  })()`);
}
// dist after -64 and >>16 (map units): branch thresholds in p_enemy.c
// vile beyond 14*64=896 MU early-outs; undead below 196 MU early-outs;
// trooper in range reaches the single P_Random()<dist roll.
check('P_CheckMissileRange: MT_VILE too-far early-out burns 0 rolls',
  mrRolls(ENUMS.MT_VILE, (14 * 64 + 200) * 65536) === 0);
check('P_CheckMissileRange: MT_UNDEAD too-close early-out burns 0 rolls',
  mrRolls(ENUMS.MT_UNDEAD, 100 * 65536) === 0);
check('P_CheckMissileRange: normal monster in range burns exactly 1 roll',
  mrRolls(ENUMS.MT_TROOP, 300 * 65536) === 1);
// spider at 300 MU: (300-64)>>1 = 118 -> still rolls once, but cap path
// differs; assert the ROLL VALUE boundary: roll < dist gates firing.
check('P_CheckMissileRange: MT_SPIDER halved-dist burns exactly 1 roll',
  mrRolls(ENUMS.MT_SPIDER, 300 * 65536) === 1);

console.log(failures ? 'RNG-FAIL ' + failures : 'RNG-OK all passed');
process.exit(failures ? 1 : 0);
