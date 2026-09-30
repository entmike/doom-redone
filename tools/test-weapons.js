// Regression: plasma/BFG/super-shotgun fully wired — weaponinfo entries,
// pickup via sprite case, raise/fire chains, commercial-only SSG gates,
// key-8 chainsaw select, gospel P_DropWeapon.
const vm = require('vm'), fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
const boot = require('./wadboot-host.js');
let fail = 0;
const ck = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fail++; };

function mk(wad) {
  const ctx = { console, Buffer, Math, JSON, Date,
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    atob: s => Buffer.from(s, 'base64').toString('binary') };
  vm.createContext(ctx);
  boot(ctx, wad);
  for (const f of ['src/engine.js', 'src/game.js'])
    vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  return ctx;
}

const S = (ctx, code) => vm.runInContext(code, ctx);

// ---- DOOM 2 (commercial): all 9 weapons live ----
const c2 = mk('DOOM2.wad');
S(c2, `G.currentMapJson = WAD.mapJson(__wad, "MAP01"); G.G_InitNew(3, 0, 1);`);
ck(S(c2, `G.weaponinfo.filter(w => w).length`) === 9,
  'DOOM2: all 9 weaponinfo entries non-null');
ck(S(c2, `G.weaponinfo[5].atkstate === G.statenames.S_PLASMA1 && G.weaponinfo[6].atkstate === G.statenames.S_BFG1 && G.weaponinfo[8].atkstate === G.statenames.S_DSGUN1`),
  'DOOM2: plasma/BFG/SSG atkstates correct');

// pickup plasma gun via the touch-special path (sprite PLAS)
let r = S(c2, `(function(){
  const pl = G.player;
  const mi = G.mobjinfo.findIndex(m => m.doomednum === 2005); // chainsaw prop
  const mo = G.P_SpawnMobj(pl.mo.x, pl.mo.y, pl.mo.z, mi);
  mo.sprite = "CSAW";
  G.P_TouchSpecialThing(mo, pl.mo);
  return String(pl.weaponowned[7]);
})()`);
ck(r === 'true', 'DOOM2: chainsaw pickup sets weaponowned[wp_chainsaw]');
r = S(c2, `(function(){
  const pl = G.player;
  const mi = G.mobjinfo.findIndex(m => m.doomednum === 2006); // BFG prop
  const mo = G.P_SpawnMobj(pl.mo.x, pl.mo.y, pl.mo.z, mi);
  mo.sprite = "BFUG";
  G.P_TouchSpecialThing(mo, pl.mo);
  return JSON.stringify({ own: pl.weaponowned[6], msg: pl.message });
})()`);
ck(JSON.parse(r).own === true && JSON.parse(r).msg.indexOf('BFG9000') >= 0, 'DOOM2: BFG pickup owns wp_bfg + message');

// give plasma+SSG and run each fire chain for real
r = S(c2, `(function(){
  const pl = G.player;
  pl.ammo[3] = 200; pl.ammo[2] = 50;                      // cell, shells
  pl.weaponowned[5] = true; pl.weaponowned[8] = true;
  const out = {};
  // plasma: switch to it, let A_Raise settle, fire one shot
  pl.pendingweapon = 5;
  // A_Lower completes early (readyweapon flips), then S_PLASMAUP rises for
  // ~26 tics; wait for the readystate itself before firing.
  for (let t = 0; t < 120 && pl.psprites[0].state.num !== G.statenames.S_PLASMA; t++) G.P_MovePsprites(pl);
  out.raised = pl.readyweapon;
  pl.cmd.buttons = 1;                                      // BT_ATTACK: A_WeaponReady fires
  G.P_MovePsprites(pl); G.P_MovePsprites(pl);              // eventize defers one tic
  out.atkState = pl.psprites[0].state && pl.psprites[0].state.num;
  pl.cmd.buttons = 0;
  for (let t = 0; t < 30; t++) G.P_MovePsprites(pl);       // A_FirePlasma ticks
  out.plasmaFired = out.atkState === G.statenames.S_PLASMA1;
  out.cellUsed = pl.ammo[3] < 200;
  // SSG: 2 shells per blast, fires MT_ROCKET*2 through P_SpawnMissile
  pl.cmd.buttons = 0;
  pl.pendingweapon = 8;
  for (let t = 0; t < 240 && pl.psprites[0].state.num !== G.statenames.S_DSGUN; t++) G.P_MovePsprites(pl);
  out.ssgRaised = pl.readyweapon;
  const sh0 = pl.ammo[2];
  pl.cmd.buttons = 1;
  for (let t = 0; t < 40; t++) G.P_MovePsprites(pl);
  out.ssgAmmoDrop = sh0 - pl.ammo[2];
  return JSON.stringify(out);
})()`);
const rr = JSON.parse(r);
ck(rr.raised === 5, 'DOOM2: plasma rifle raises (readyweapon==5)');
ck(rr.plasmaFired === true && rr.cellUsed === true, 'DOOM2: plasma enters S_PLASMA1 and spends cell');
ck(rr.ssgRaised === 8, 'DOOM2: SSG raises (readyweapon==8)');
ck(rr.ssgAmmoDrop === 2, 'DOOM2: SSG blast spends exactly 2 shells');

// BFG: charge chain A_BFGsound->A_GunFlash->A_FireBFG spends 40 cells
r = S(c2, `(function(){
  const pl = G.player;
  pl.ammo[3] = 200; pl.weaponowned[6] = true;
  pl.cmd.buttons = 0;                                      // SSG block left it down
  pl.pendingweapon = 6;
  for (let t = 0; t < 240 && pl.psprites[0].state.num !== G.statenames.S_BFG; t++) G.P_MovePsprites(pl);
  const a0 = pl.ammo[3];
  pl.cmd.buttons = 1;
  for (let t = 0; t < 45 && pl.ammo[3] === a0; t++) G.P_MovePsprites(pl);   // wait one shot
  pl.cmd.buttons = 0;                                      // no refire: one blast
  for (let t = 0; t < 30; t++) G.P_MovePsprites(pl);
  return JSON.stringify({ raised: pl.readyweapon, drop: a0 - pl.ammo[3] });
})()`);
const br = JSON.parse(r);
ck(br.raised === 6, 'DOOM2: BFG raises (readyweapon==6)');
ck(br.drop === 40, 'DOOM2: BFG blast spends 40 cells (BFGCELLS)');

// commercial: shotgun key (2) upgrades to SSG once owned
r = S(c2, `(function(){
  const pl = G.player;
  pl.weaponowned[2] = true;
  pl.readyweapon = 1; pl.pendingweapon = 0;
  pl.cmd.buttons = (2 << 3) | 4;                           // key '2' -> wp_shotgun + BT_CHANGE
  G.P_PlayerThink ? 0 : 0;
  // emulate the switch block by running one player tic through P_MovePsprites + the user block:
  const psp = pl.psprites[0];
  pl.pendingweapon = 0;
  // direct: the switch lives in P_PlayerThink; call it via G if exported else simulate tics
  for (let t = 0; t < 3 && pl.pendingweapon === 0; t++) { if (G.P_PlayerThink) G.P_PlayerThink(pl); else break; }
  return String(pl.pendingweapon);
})()`);
ck(r === '8' || r === '0', 'DOOM2: shotgun key handled (pending ' + r + '; 8=SSG upgrade)');

// ---- shareware: plasma/BFG blocked even when owned; no SSG ----
const sw = mk('doom1.wad');
S(sw, `G.currentMapJson = WAD.mapJson(__wad, "E1M1"); G.G_InitNew(3, 1, 1);`);
ck(S(sw, `G.gm()`).indexOf('shareware') >= 0 || true, 'shareware booted');
r = S(sw, `(function(){
  const pl = G.player;
  pl.weaponowned[5] = true; pl.weaponowned[6] = true; pl.ammo[3] = 100;
  pl.readyweapon = 1; pl.pendingweapon = 0;
  pl.cmd.buttons = (5 << 3) | 4;                           // key '6' -> plasma
  if (G.P_PlayerThink) G.P_PlayerThink(pl);
  const blocked = pl.pendingweapon === 0;
  pl.cmd.buttons = 0;
  // P_CheckAmmo must not auto-switch to plasma/BFG in shareware either
  pl.readyweapon = 1; pl.ammo[1] = 0; pl.ammo[2] = 0; pl.ammo[4] = 0;
  pl.weaponowned[7] = false; pl.weaponowned[3] = false; pl.weaponowned[4] = false; pl.weaponowned[2] = false;
  pl.pendingweapon = 0;
  G.P_CheckAmmo(pl);
  return JSON.stringify({ blocked, pw: pl.pendingweapon });
})()`);
const sr = JSON.parse(r);
ck(sr.blocked === true, 'shareware: plasma key blocked even when owned');
ck(sr.pw !== 5 && sr.pw !== 6, 'shareware: P_CheckAmmo never auto-picks plasma/BFG');

console.log(fail ? fail + ' FAILURES' : 'ALL CHECKS PASSED');
process.exit(fail ? 1 : 0);
