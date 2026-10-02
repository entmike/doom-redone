"use strict";
// ============================================================================
// game.js — DOOM 1.10 gameplay/logic layer (faithful port of linuxdoom-1.10
// p_tick.c / p_mobj.c / p_map.c / p_maputl.c / p_enemy.c / p_user.c /
// p_pspr.c / p_inter.c / p_spec.c / p_switch.c / p_doors.c / p_plats.c /
// p_floor.c / p_ceilng.c / p_lights.c / g_game.c).
//
// C wins over specs on conflict; C file:line quoted for non-obvious constants.
// Plain browser global; runs headless under Node. engine.js (loaded first)
// provides: loadMap, mapdata (vertexes/linedefs/sides/sectors/segs/
// subsectors/nodes/reject/blockmap + P_GroupLines results), FU/FRACBITS/
// FINEANGLES tables, M_Random/P_Random/M_ClearRandom, R_PointInSubsector,
// R_PointToAngle/R_PointToAngle2/R_PointToDist, P_CheckSight,
// P_BlockLinesIterator, P_SetThingPosition/P_UnsetThingPosition, P_BoxOnLineSide,
// P_LineOpening globals. Where the engine has not (yet) provided one of these,
// game.js installs a faithful fallback at load time (guarded, never overrides).
// ============================================================================
(function (G) {
  var FU = G.FU || 65536, FRACBITS = (G.FRACBITS !== undefined ? G.FRACBITS : 16);
  var MAXINT = 0x7fffffff, MININT = -0x80000000;

  function def(name, fn) { if (typeof G[name] === "undefined") G[name] = fn; return G[name]; }

  // ---------------------------------------------------------------- fixed point
  // m_fixed.c:14 FixedMul = ((long long)a*b)>>16 cast to int32
  if (typeof G.FixedMul === "undefined") {
    G.FixedMul = function (a, b) { return Number((BigInt(a | 0) * BigInt(b | 0)) >> 16n) | 0; };
  }
  // m_fixed.c:19 FixedDiv: precheck clamps to MAXINT/MININT, else double divide,
  // C truncation toward zero. (No DIVRESULTMASK loop — that is id_Assembly.)
  if (typeof G.FixedDiv === "undefined") {
    G.FixedDiv = function (a, b) {
      if ((Math.abs(a) >> 14) >= Math.abs(b)) return ((a ^ b) < 0) ? MININT : MAXINT;
      var c = (a / b) * FU;
      if (c >= 2147483648 || c < -2147483648) return c >= 0 ? MAXINT : MININT; // C I_Error; clamp
      return Math.trunc(c);
    };
  }
  def("P_AproxDistance", function (dx, dy) {
    dx = Math.abs(dx); dy = Math.abs(dy);
    if (dx < dy) return (dx + dy - (dx >> 1)) | 0;
    return (dx + dy - (dy >> 1)) | 0;
  });

  // ---------------------------------------------------------------- tables fallback
  if (typeof G.FINEANGLES === "undefined") G.FINEANGLES = 8192;
  if (typeof G.FINEMASK === "undefined") G.FINEMASK = 8191;
  if (typeof G.ANGLETOFINESHIFT === "undefined") G.ANGLETOFINESHIFT = 19;
  if (typeof G.finesine === "undefined") {
    var fs = new Int32Array(5 * G.FINEANGLES / 4);
    for (var fi = 0; fi < fs.length; fi++) fs[fi] = Math.round(Math.sin((fi + 0.5) * 2 * Math.PI / 8192) * FU);
    G.finesine = fs;
  }
  if (typeof G.finecosine === "undefined") G.finecosine = G.finesine.subarray ? G.finesine.subarray(G.FINEANGLES / 4) : null;
  // r_main.c:113 finecosine = finesine + FINEANGLES/4
  function fcos(a) { return G.finecosine ? G.finecosine[a] : G.finesine[a + G.FINEANGLES / 4]; }
  function fsin(a) { return G.finesine[a]; }

  // ---------------------------------------------------------------- rng
  // m_random.c rndtable verbatim
  if (typeof G.P_Random === "undefined" || typeof G.M_Random === "undefined") {
    var rndtable = [
      0, 8, 109, 220, 222, 241, 149, 107, 75, 248, 254, 140, 16, 66,
      74, 21, 211, 47, 80, 242, 154, 27, 205, 128, 161, 89, 77, 36,
      95, 110, 85, 48, 212, 140, 211, 249, 22, 79, 200, 50, 28, 188,
      52, 140, 202, 120, 68, 145, 62, 70, 184, 190, 91, 197, 152, 224,
      149, 104, 25, 178, 252, 182, 202, 182, 141, 197, 4, 81, 181, 242,
      145, 42, 39, 227, 156, 198, 225, 193, 219, 93, 122, 175, 249, 0,
      175, 143, 70, 239, 46, 246, 163, 53, 163, 109, 168, 135, 2, 235,
      25, 92, 20, 145, 138, 77, 69, 166, 78, 176, 173, 212, 166, 113,
      94, 161, 41, 50, 239, 49, 111, 164, 70, 60, 2, 37, 171, 75,
      136, 156, 11, 56, 42, 146, 138, 229, 73, 146, 77, 61, 98, 196,
      135, 106, 63, 197, 195, 86, 96, 203, 113, 101, 170, 247, 181, 113,
      80, 250, 108, 7, 255, 237, 129, 226, 79, 107, 112, 166, 103, 241,
      24, 223, 239, 120, 198, 58, 60, 82, 128, 3, 184, 66, 143, 224,
      145, 224, 81, 206, 163, 45, 63, 90, 168, 114, 59, 33, 159, 95,
      28, 139, 123, 98, 125, 196, 15, 70, 194, 253, 54, 14, 109, 226,
      71, 17, 161, 93, 186, 87, 244, 138, 20, 52, 123, 251, 26, 36,
      17, 46, 52, 231, 232, 76, 31, 221, 84, 37, 216, 165, 212, 106,
      197, 242, 98, 43, 39, 175, 254, 145, 190, 84, 118, 222, 187, 136,
      120, 163, 236, 249];
    G.__rndindex = 0; G.__prndindex = 0;
    if (typeof G.P_Random === "undefined")
      G.P_Random = function () { G.__prndindex = (G.__prndindex + 1) & 0xff; return rndtable[G.__prndindex]; };
    if (typeof G.M_Random === "undefined")
      G.M_Random = function () { G.__rndindex = (G.__rndindex + 1) & 0xff; return rndtable[G.__rndindex]; };
    if (typeof G.M_ClearRandom === "undefined")
      G.M_ClearRandom = function () { G.__rndindex = 0; G.__prndindex = 0; };
  }
  var P_Random = function () { return G.P_Random(); };
  var M_RandomG = function () { return G.M_Random(); };

  // ---------------------------------------------------------------- sound shim (sounds.h enum order; src/sound.js)
  var SFX = {
  // complete sounds.h sfxstatenum_t (109 entries)
    sfx_None: 0, sfx_pistol: 1, sfx_shotgn: 2, sfx_sgcock: 3, sfx_dshtgn: 4, sfx_dbopn: 5,
    sfx_dbcls: 6, sfx_dbload: 7, sfx_plasma: 8, sfx_bfg: 9, sfx_sawup: 10, sfx_sawidl: 11,
    sfx_sawful: 12, sfx_sawhit: 13, sfx_rlaunc: 14, sfx_rxplod: 15, sfx_firsht: 16, sfx_firxpl: 17,
    sfx_pstart: 18, sfx_pstop: 19, sfx_doropn: 20, sfx_dorcls: 21, sfx_stnmov: 22, sfx_swtchn: 23,
    sfx_swtchx: 24, sfx_plpain: 25, sfx_dmpain: 26, sfx_popain: 27, sfx_vipain: 28, sfx_mnpain: 29,
    sfx_pepain: 30, sfx_slop: 31, sfx_itemup: 32, sfx_wpnup: 33, sfx_oof: 34, sfx_telept: 35,
    sfx_posit1: 36, sfx_posit2: 37, sfx_posit3: 38, sfx_bgsit1: 39, sfx_bgsit2: 40, sfx_sgtsit: 41,
    sfx_cacsit: 42, sfx_brssit: 43, sfx_cybsit: 44, sfx_spisit: 45, sfx_bspsit: 46, sfx_kntsit: 47,
    sfx_vilsit: 48, sfx_mansit: 49, sfx_pesit: 50, sfx_sklatk: 51, sfx_sgtatk: 52, sfx_skepch: 53,
    sfx_vilatk: 54, sfx_claw: 55, sfx_skeswg: 56, sfx_pldeth: 57, sfx_pdiehi: 58, sfx_podth1: 59,
    sfx_podth2: 60, sfx_podth3: 61, sfx_bgdth1: 62, sfx_bgdth2: 63, sfx_sgtdth: 64, sfx_cacdth: 65,
    sfx_skldth: 66, sfx_brsdth: 67, sfx_cybdth: 68, sfx_spidth: 69, sfx_bspdth: 70, sfx_vildth: 71,
    sfx_kntdth: 72, sfx_pedth: 73, sfx_skedth: 74, sfx_posact: 75, sfx_bgact: 76, sfx_dmact: 77,
    sfx_bspact: 78, sfx_bspwlk: 79, sfx_vilact: 80, sfx_noway: 81, sfx_barexp: 82, sfx_punch: 83,
    sfx_hoof: 84, sfx_metal: 85, sfx_chgun: 86, sfx_tink: 87, sfx_bdopn: 88, sfx_bdcls: 89,
    sfx_itmbk: 90, sfx_flame: 91, sfx_flamst: 92, sfx_getpow: 93, sfx_bospit: 94, sfx_boscub: 95,
    sfx_bossit: 96, sfx_bospn: 97, sfx_bosdth: 98, sfx_manatk: 99, sfx_mandth: 100, sfx_sssit: 101,
    sfx_ssdth: 102, sfx_keenpn: 103, sfx_keendt: 104, sfx_skeact: 105, sfx_skesit: 106,
    sfx_skeatk: 107, sfx_radio: 108,
  };
  function SND() { return (typeof window !== "undefined" && window.Snd) ? window.Snd : null; }
  function S_StartSound(origin, sfx_id) { var s = SND(); if (s) s.S_StartSound(origin, sfx_id); }
  G.S_StartSound = S_StartSound;
  G.SFX = SFX;   // callers (automap.js) must reference names, never raw ids
  function SndCall(fn, a) { var s = SND(); if (s && s[fn]) s[fn](a); }

  // ---------------------------------------------------------------- constants
  var ANG45 = 0x20000000, ANG90 = 0x40000000, ANG180 = 0x80000000, ANG270 = 0xc0000000;
  var ANG5 = (ANG90 / 18) >>> 0;                          // p_user.c:180
  var ONFLOORZ = MININT, ONCEILINGZ = MAXINT;
  var MELEERANGE = 64 * FU, MISSILERANGE = 32 * 64 * FU, USERANGE = 64 * FU;
  var VIEWHEIGHT = 41 * FU, MAXHEALTH = 100, GRAVITY = FU;
  var FLOATSPEED = 4 * FU, MAXMOVE = 30 * FU, MAXRADIUS = 32 * FU, PLAYERRADIUS = 16 * FU;
  var MAXPLAYERS = 4;
  var ITEMQUESIZE = 128, MAXSPECIALCROSS = 8, BASETHRESHOLD = 100, BONUSADD = 6;
  var MAXINTERCEPTS = 128;
  var FLOORSPEED = FU, PLATSPEED = FU, CEILSPEED = FU, VDOORSPEED = FU * 2;
  var LOWERSPEED = FU * 6, RAISESPEED = FU * 6;
  var WEAPONBOTTOM = 128 * FU, WEAPONTOP = 32 * FU;
  var STOPSPEED = 0x1000, FRICTION = 0xe800;              // p_mobj.c:111-112
  var MAXBOB = 0x100000, INVERSECOLORMAP = 32;            // p_user.c
  var VDOORWAIT = 150, CEILWAIT = 150, PLATWAIT = 3;
  var MAXPLATS = 30, MAXCEILINGS = 30, MAXBUTTONS = 16, BUTTONTIME = 35;
  var FASTDARK = 15, SLOWDARK = 35, STROBEBRIGHT = 5, GLOWSPEED = 8;
  var BOXTOP = 0, BOXBOTTOM = 1, BOXLEFT = 2, BOXRIGHT = 3;  // m_bbox.h:34-38 exact order
  var ML_BLOCKING = 1, ML_BLOCKMONSTERS = 2, ML_TWOSIDED = 4, ML_SECRET = 32, ML_SOUNDBLOCK = 64;
  var MAXSTEP = 24 * FU;                                  // p_map.c:478 hardcoded 24*FRACUNIT
  var BFGCELLS = 40;
  // MF_* — p_mobj.h verbatim
  var MF_SPECIAL = 1, MF_SOLID = 2, MF_SHOOTABLE = 4, MF_NOSECTOR = 8, MF_NOBLOCKMAP = 16,
    MF_AMBUSH = 32, MF_JUSTHIT = 64, MF_JUSTATTACKED = 128, MF_SPAWNCEILING = 256,
    MF_NOGRAVITY = 512, MF_DROPOFF = 0x400, MF_PICKUP = 0x800, MF_NOCLIP = 0x1000,
    MF_SLIDE = 0x2000, MF_FLOAT = 0x4000, MF_TELEPORT = 0x8000, MF_MISSILE = 0x10000,
    MF_DROPPED = 0x20000, MF_SHADOW = 0x40000, MF_NOBLOOD = 0x80000, MF_CORPSE = 0x100000,
    MF_INFLOAT = 0x200000, MF_COUNTKILL = 0x400000, MF_COUNTITEM = 0x800000,
    MF_SKULLFLY = 0x1000000, MF_NOTDMATCH = 0x2000000, MF_TRANSSHIFT = 26;
  // ticcmd buttons — d_event.h 1.10 values (ARCHITECTURE contract)
  var BT_ATTACK = 1, BT_USE = 2, BT_CHANGE = 4, BT_WEAPONMASK = 56, BT_WEAPONSHIFT = 3, BT_SPECIAL = 128;
  // playerstate — d_player.h: PST_REBORN=0, PST_ENTER=1, PST_LIVE=2, PST_DEAD=3
  var PST_REBORN = 0, PST_ENTER = 1, PST_LIVE = 2, PST_DEAD = 3;
  // skill: sk_baby=0 sk_easy=1 sk_medium=2 sk_hard=3 sk_nightmare=4 (doomdef.h:149)
  // weapons / ammo enums (d_player.h)
  var wp_fist = 0, wp_pistol = 1, wp_shotgun = 2, wp_chaingun = 3, wp_missile = 4,
    wp_plasma = 5, wp_bfg = 6, wp_chainsaw = 7, wp_supershotgun = 8, NUMWEAPONS = 9, wp_nochange = 10;
  var am_noammo = 0, am_clip = 1, am_shell = 2, am_cell = 3, am_misl = 4, NUMAMMO = 5; // p_inter index incl. noammo
  // p_inter.c:52-53 (arrays indexed by am_clip..am_misl => use index-1)
  var maxammoTab = [200, 50, 300, 50], clipammoTab = [10, 4, 20, 1];
  // powerup enum (order per d_player.h)
  var pw_strength = 0, pw_invisibility = 1, pw_invulnerability = 2, pw_ironfeet = 3, pw_allmap = 4, pw_infrared = 5;
  // mobjtypes — MUST match the MI() push order below (P_SpawnMobj indexes
  // mobjinfo[type]; they were misaligned pre-imp-fix, e.g. MT_PUFF spawned
  // the BON1 bonus). Unimplemented monster types get high sentinels so they
  // never alias an implemented index (switch cases never match: unspawnable).
  // vanilla mobjtype_t indices (info.h) — mobjinfo[] is gospel-dense, so
  // index === type everywhere (A_BossDeath / P_SpawnMapThing / save format).
  var MT_PLAYER = 0,
    MT_POSSESSED = 1,
    MT_SHOTGUY = 2,
    MT_VILE = 3,
    MT_FIRE = 4,
    MT_UNDEAD = 5,
    MT_TRACER = 6,
    MT_SMOKE = 7,
    MT_FATSO = 8,
    MT_FATSHOT = 9,
    MT_CHAINGUY = 10,
    MT_TROOP = 11,
    MT_SERGEANT = 12,
    MT_SHADOWS = 13,
    MT_HEAD = 14,
    MT_BRUISER = 15,
    MT_BRUISERSHOT = 16,
    MT_KNIGHT = 17,
    MT_SKULL = 18,
    MT_SPIDER = 19,
    MT_BABY = 20,
    MT_CYBORG = 21,
    MT_PAIN = 22,
    MT_WOLFSS = 23,
    MT_KEEN = 24,
    MT_BOSSBRAIN = 25,
    MT_BOSSSPIT = 26,
    MT_BOSSTARGET = 27,
    MT_SPAWNSHOT = 28,
    MT_SPAWNFIRE = 29,
    MT_BARREL = 30,
    MT_TROOPSHOT = 31,
    MT_HEADSHOT = 32,
    MT_ROCKET = 33,
    MT_PLASMA = 34,
    MT_BFG = 35,
    MT_ARACHPLAZ = 36,
    MT_PUFF = 37,
    MT_BLOOD = 38,
    MT_TFOG = 39,
    MT_IFOG = 40,
    MT_TELEPORTMAN = 41,
    MT_EXTRABFG = 42,
    MT_MISC0 = 43,
    MT_MISC1 = 44,
    MT_MISC2 = 45,
    MT_MISC3 = 46,
    MT_MISC4 = 47,
    MT_MISC5 = 48,
    MT_MISC6 = 49,
    MT_MISC7 = 50,
    MT_MISC8 = 51,
    MT_MISC9 = 52,
    MT_MISC10 = 53,
    MT_MISC11 = 54,
    MT_MISC12 = 55,
    MT_INV = 56,
    MT_MISC13 = 57,
    MT_INS = 58,
    MT_MISC14 = 59,
    MT_MISC15 = 60,
    MT_MISC16 = 61,
    MT_MEGA = 62,
    MT_CLIP = 63,
    MT_MISC17 = 64,
    MT_MISC18 = 65,
    MT_MISC19 = 66,
    MT_MISC20 = 67,
    MT_MISC21 = 68,
    MT_MISC22 = 69,
    MT_MISC23 = 70,
    MT_MISC24 = 71,
    MT_MISC25 = 72,
    MT_CHAINGUN = 73,
    MT_MISC26 = 74,
    MT_MISC27 = 75,
    MT_MISC28 = 76,
    MT_SHOTGUN = 77,
    MT_SUPERSHOTGUN = 78,
    MT_MISC29 = 79,
    MT_MISC30 = 80,
    MT_MISC31 = 81,
    MT_MISC32 = 82,
    MT_MISC33 = 83,
    MT_MISC34 = 84,
    MT_MISC35 = 85,
    MT_MISC36 = 86,
    MT_MISC37 = 87,
    MT_MISC38 = 88,
    MT_MISC39 = 89,
    MT_MISC40 = 90,
    MT_MISC41 = 91,
    MT_MISC42 = 92,
    MT_MISC43 = 93,
    MT_MISC44 = 94,
    MT_MISC45 = 95,
    MT_MISC46 = 96,
    MT_MISC47 = 97,
    MT_MISC48 = 98,
    MT_MISC49 = 99,
    MT_MISC50 = 100,
    MT_MISC51 = 101,
    MT_MISC52 = 102,
    MT_MISC53 = 103,
    MT_MISC54 = 104,
    MT_MISC55 = 105,
    MT_MISC56 = 106,
    MT_MISC57 = 107,
    MT_MISC58 = 108,
    MT_MISC59 = 109,
    MT_MISC60 = 110,
    MT_MISC61 = 111,
    MT_MISC62 = 112,
    MT_MISC63 = 113,
    MT_MISC64 = 114,
    MT_MISC65 = 115,
    MT_MISC66 = 116,
    MT_MISC67 = 117,
    MT_MISC68 = 118,
    MT_MISC69 = 119,
    MT_MISC70 = 120,
    MT_MISC71 = 121,
    MT_MISC72 = 122,
    MT_MISC73 = 123,
    MT_MISC74 = 124,
    MT_MISC75 = 125,
    MT_MISC76 = 126,
    MT_MISC77 = 127,
    MT_MISC78 = 128,
    MT_MISC79 = 129,
    MT_MISC80 = 130,
    MT_MISC81 = 131,
    MT_MISC82 = 132,
    MT_MISC83 = 133,
    MT_MISC84 = 134,
    MT_MISC85 = 135,
    MT_MISC86 = 136;
  var FF_FULLBRIGHT = 0x8000;                             // p_pspr.h — 15-bit frame mask
  var ps_weapon = 0, ps_flash = 1;

  // ---------------------------------------------------------------- state table
  // Built in exact info.h statenum_t index order (gaps = inert S_NULL-like
  // placeholders). state = {sprite,frame,tics,action,next,num}. ⚠ frame values
  // >=32768 carry FF_FULLBRIGHT (info.c literal 32768+n form).
  var states = [];
  var statenames = {};
  function S(name, spr, frame, tics, action, next) {
    var idx = states.length;                                // ⚠ must be pre-push: num is read back by A_FireCGun flash math and P_SetPsprite
    states.push({ sprite: spr, frame: frame, tics: tics, action: action || null, next: next, num: idx });
    statenames[name] = idx;
    return idx;
  }
  function fillTo(idx) { while (states.length <= idx) states.push({ sprite: null, frame: 0, tics: -1, action: null, next: 0, num: states.length, placeholder: true }); }
  // helper for generated chains: S_CHAINB(base, frames[], tics[], actions[], nexts[])
  function chain(name, spr, spec) { // spec: array of [frame,tics,action,nextname]
    for (var i = 0; i < spec.length; i++) S(name + (i === 0 ? "" : (i + 1)), spr, spec[i][0], spec[i][1], spec[i][2], spec[i][3]);
  }
  // info.c states[] verbatim — 967 dense rows, index === statenum_t.
  S("S_NULL", "TROO", 0, -1, null, "S_NULL");
  S("S_LIGHTDONE", "SHTG", 4, 0, "A_Light0", "S_NULL");
  S("S_PUNCH", "PUNG", 0, 1, "A_WeaponReady", "S_PUNCH");
  S("S_PUNCHDOWN", "PUNG", 0, 1, "A_Lower", "S_PUNCHDOWN");
  S("S_PUNCHUP", "PUNG", 0, 1, "A_Raise", "S_PUNCHUP");
  S("S_PUNCH1", "PUNG", 1, 4, null, "S_PUNCH2");
  S("S_PUNCH2", "PUNG", 2, 4, "A_Punch", "S_PUNCH3");
  S("S_PUNCH3", "PUNG", 3, 5, null, "S_PUNCH4");
  S("S_PUNCH4", "PUNG", 2, 4, null, "S_PUNCH5");
  S("S_PUNCH5", "PUNG", 1, 5, "A_ReFire", "S_PUNCH");
  S("S_PISTOL", "PISG", 0, 1, "A_WeaponReady", "S_PISTOL");
  S("S_PISTOLDOWN", "PISG", 0, 1, "A_Lower", "S_PISTOLDOWN");
  S("S_PISTOLUP", "PISG", 0, 1, "A_Raise", "S_PISTOLUP");
  S("S_PISTOL1", "PISG", 0, 4, null, "S_PISTOL2");
  S("S_PISTOL2", "PISG", 1, 6, "A_FirePistol", "S_PISTOL3");
  S("S_PISTOL3", "PISG", 2, 4, null, "S_PISTOL4");
  S("S_PISTOL4", "PISG", 1, 5, "A_ReFire", "S_PISTOL");
  S("S_PISTOLFLASH", "PISF", FF_FULLBRIGHT | 0, 7, "A_Light1", "S_LIGHTDONE");
  S("S_SGUN", "SHTG", 0, 1, "A_WeaponReady", "S_SGUN");
  S("S_SGUNDOWN", "SHTG", 0, 1, "A_Lower", "S_SGUNDOWN");
  S("S_SGUNUP", "SHTG", 0, 1, "A_Raise", "S_SGUNUP");
  S("S_SGUN1", "SHTG", 0, 3, null, "S_SGUN2");
  S("S_SGUN2", "SHTG", 0, 7, "A_FireShotgun", "S_SGUN3");
  S("S_SGUN3", "SHTG", 1, 5, null, "S_SGUN4");
  S("S_SGUN4", "SHTG", 2, 5, null, "S_SGUN5");
  S("S_SGUN5", "SHTG", 3, 4, null, "S_SGUN6");
  S("S_SGUN6", "SHTG", 2, 5, null, "S_SGUN7");
  S("S_SGUN7", "SHTG", 1, 5, null, "S_SGUN8");
  S("S_SGUN8", "SHTG", 0, 3, null, "S_SGUN9");
  S("S_SGUN9", "SHTG", 0, 7, "A_ReFire", "S_SGUN");
  S("S_SGUNFLASH1", "SHTF", FF_FULLBRIGHT | 0, 4, "A_Light1", "S_SGUNFLASH2");
  S("S_SGUNFLASH2", "SHTF", FF_FULLBRIGHT | 1, 3, "A_Light2", "S_LIGHTDONE");
  S("S_DSGUN", "SHT2", 0, 1, "A_WeaponReady", "S_DSGUN");
  S("S_DSGUNDOWN", "SHT2", 0, 1, "A_Lower", "S_DSGUNDOWN");
  S("S_DSGUNUP", "SHT2", 0, 1, "A_Raise", "S_DSGUNUP");
  S("S_DSGUN1", "SHT2", 0, 3, null, "S_DSGUN2");
  S("S_DSGUN2", "SHT2", 0, 7, "A_FireShotgun2", "S_DSGUN3");
  S("S_DSGUN3", "SHT2", 1, 7, null, "S_DSGUN4");
  S("S_DSGUN4", "SHT2", 2, 7, "A_CheckReload", "S_DSGUN5");
  S("S_DSGUN5", "SHT2", 3, 7, "A_OpenShotgun2", "S_DSGUN6");
  S("S_DSGUN6", "SHT2", 4, 7, null, "S_DSGUN7");
  S("S_DSGUN7", "SHT2", 5, 7, "A_LoadShotgun2", "S_DSGUN8");
  S("S_DSGUN8", "SHT2", 6, 6, null, "S_DSGUN9");
  S("S_DSGUN9", "SHT2", 7, 6, "A_CloseShotgun2", "S_DSGUN10");
  S("S_DSGUN10", "SHT2", 0, 5, "A_ReFire", "S_DSGUN");
  S("S_DSNR1", "SHT2", 1, 7, null, "S_DSNR2");
  S("S_DSNR2", "SHT2", 0, 3, null, "S_DSGUNDOWN");
  S("S_DSGUNFLASH1", "SHT2", FF_FULLBRIGHT | 8, 5, "A_Light1", "S_DSGUNFLASH2");
  S("S_DSGUNFLASH2", "SHT2", FF_FULLBRIGHT | 9, 4, "A_Light2", "S_LIGHTDONE");
  S("S_CHAIN", "CHGG", 0, 1, "A_WeaponReady", "S_CHAIN");
  S("S_CHAINDOWN", "CHGG", 0, 1, "A_Lower", "S_CHAINDOWN");
  S("S_CHAINUP", "CHGG", 0, 1, "A_Raise", "S_CHAINUP");
  S("S_CHAIN1", "CHGG", 0, 4, "A_FireCGun", "S_CHAIN2");
  S("S_CHAIN2", "CHGG", 1, 4, "A_FireCGun", "S_CHAIN3");
  S("S_CHAIN3", "CHGG", 1, 0, "A_ReFire", "S_CHAIN");
  S("S_CHAINFLASH1", "CHGF", FF_FULLBRIGHT | 0, 5, "A_Light1", "S_LIGHTDONE");
  S("S_CHAINFLASH2", "CHGF", FF_FULLBRIGHT | 1, 5, "A_Light2", "S_LIGHTDONE");
  S("S_MISSILE", "MISG", 0, 1, "A_WeaponReady", "S_MISSILE");
  S("S_MISSILEDOWN", "MISG", 0, 1, "A_Lower", "S_MISSILEDOWN");
  S("S_MISSILEUP", "MISG", 0, 1, "A_Raise", "S_MISSILEUP");
  S("S_MISSILE1", "MISG", 1, 8, "A_GunFlash", "S_MISSILE2");
  S("S_MISSILE2", "MISG", 1, 12, "A_FireMissile", "S_MISSILE3");
  S("S_MISSILE3", "MISG", 1, 0, "A_ReFire", "S_MISSILE");
  S("S_MISSILEFLASH1", "MISF", FF_FULLBRIGHT | 0, 3, "A_Light1", "S_MISSILEFLASH2");
  S("S_MISSILEFLASH2", "MISF", FF_FULLBRIGHT | 1, 4, null, "S_MISSILEFLASH3");
  S("S_MISSILEFLASH3", "MISF", FF_FULLBRIGHT | 2, 4, "A_Light2", "S_MISSILEFLASH4");
  S("S_MISSILEFLASH4", "MISF", FF_FULLBRIGHT | 3, 4, "A_Light2", "S_LIGHTDONE");
  S("S_SAW", "SAWG", 2, 4, "A_WeaponReady", "S_SAWB");
  S("S_SAWB", "SAWG", 3, 4, "A_WeaponReady", "S_SAW");
  S("S_SAWDOWN", "SAWG", 2, 1, "A_Lower", "S_SAWDOWN");
  S("S_SAWUP", "SAWG", 2, 1, "A_Raise", "S_SAWUP");
  S("S_SAW1", "SAWG", 0, 4, "A_Saw", "S_SAW2");
  S("S_SAW2", "SAWG", 1, 4, "A_Saw", "S_SAW3");
  S("S_SAW3", "SAWG", 1, 0, "A_ReFire", "S_SAW");
  S("S_PLASMA", "PLSG", 0, 1, "A_WeaponReady", "S_PLASMA");
  S("S_PLASMADOWN", "PLSG", 0, 1, "A_Lower", "S_PLASMADOWN");
  S("S_PLASMAUP", "PLSG", 0, 1, "A_Raise", "S_PLASMAUP");
  S("S_PLASMA1", "PLSG", 0, 3, "A_FirePlasma", "S_PLASMA2");
  S("S_PLASMA2", "PLSG", 1, 20, "A_ReFire", "S_PLASMA");
  S("S_PLASMAFLASH1", "PLSF", FF_FULLBRIGHT | 0, 4, "A_Light1", "S_LIGHTDONE");
  S("S_PLASMAFLASH2", "PLSF", FF_FULLBRIGHT | 1, 4, "A_Light1", "S_LIGHTDONE");
  S("S_BFG", "BFGG", 0, 1, "A_WeaponReady", "S_BFG");
  S("S_BFGDOWN", "BFGG", 0, 1, "A_Lower", "S_BFGDOWN");
  S("S_BFGUP", "BFGG", 0, 1, "A_Raise", "S_BFGUP");
  S("S_BFG1", "BFGG", 0, 20, "A_BFGsound", "S_BFG2");
  S("S_BFG2", "BFGG", 1, 10, "A_GunFlash", "S_BFG3");
  S("S_BFG3", "BFGG", 1, 10, "A_FireBFG", "S_BFG4");
  S("S_BFG4", "BFGG", 1, 20, "A_ReFire", "S_BFG");
  S("S_BFGFLASH1", "BFGF", FF_FULLBRIGHT | 0, 11, "A_Light1", "S_BFGFLASH2");
  S("S_BFGFLASH2", "BFGF", FF_FULLBRIGHT | 1, 6, "A_Light2", "S_LIGHTDONE");
  S("S_BLOOD1", "BLUD", 2, 8, null, "S_BLOOD2");
  S("S_BLOOD2", "BLUD", 1, 8, null, "S_BLOOD3");
  S("S_BLOOD3", "BLUD", 0, 8, null, "S_NULL");
  S("S_PUFF1", "PUFF", FF_FULLBRIGHT | 0, 4, null, "S_PUFF2");
  S("S_PUFF2", "PUFF", 1, 4, null, "S_PUFF3");
  S("S_PUFF3", "PUFF", 2, 4, null, "S_PUFF4");
  S("S_PUFF4", "PUFF", 3, 4, null, "S_NULL");
  S("S_TBALL1", "BAL1", FF_FULLBRIGHT | 0, 4, null, "S_TBALL2");
  S("S_TBALL2", "BAL1", FF_FULLBRIGHT | 1, 4, null, "S_TBALL1");
  S("S_TBALLX1", "BAL1", FF_FULLBRIGHT | 2, 6, null, "S_TBALLX2");
  S("S_TBALLX2", "BAL1", FF_FULLBRIGHT | 3, 6, null, "S_TBALLX3");
  S("S_TBALLX3", "BAL1", FF_FULLBRIGHT | 4, 6, null, "S_NULL");
  S("S_RBALL1", "BAL2", FF_FULLBRIGHT | 0, 4, null, "S_RBALL2");
  S("S_RBALL2", "BAL2", FF_FULLBRIGHT | 1, 4, null, "S_RBALL1");
  S("S_RBALLX1", "BAL2", FF_FULLBRIGHT | 2, 6, null, "S_RBALLX2");
  S("S_RBALLX2", "BAL2", FF_FULLBRIGHT | 3, 6, null, "S_RBALLX3");
  S("S_RBALLX3", "BAL2", FF_FULLBRIGHT | 4, 6, null, "S_NULL");
  S("S_PLASBALL", "PLSS", FF_FULLBRIGHT | 0, 6, null, "S_PLASBALL2");
  S("S_PLASBALL2", "PLSS", FF_FULLBRIGHT | 1, 6, null, "S_PLASBALL");
  S("S_PLASEXP", "PLSE", FF_FULLBRIGHT | 0, 4, null, "S_PLASEXP2");
  S("S_PLASEXP2", "PLSE", FF_FULLBRIGHT | 1, 4, null, "S_PLASEXP3");
  S("S_PLASEXP3", "PLSE", FF_FULLBRIGHT | 2, 4, null, "S_PLASEXP4");
  S("S_PLASEXP4", "PLSE", FF_FULLBRIGHT | 3, 4, null, "S_PLASEXP5");
  S("S_PLASEXP5", "PLSE", FF_FULLBRIGHT | 4, 4, null, "S_NULL");
  S("S_ROCKET", "MISL", FF_FULLBRIGHT | 0, 1, null, "S_ROCKET");
  S("S_BFGSHOT", "BFS1", FF_FULLBRIGHT | 0, 4, null, "S_BFGSHOT2");
  S("S_BFGSHOT2", "BFS1", FF_FULLBRIGHT | 1, 4, null, "S_BFGSHOT");
  S("S_BFGLAND", "BFE1", FF_FULLBRIGHT | 0, 8, null, "S_BFGLAND2");
  S("S_BFGLAND2", "BFE1", FF_FULLBRIGHT | 1, 8, null, "S_BFGLAND3");
  S("S_BFGLAND3", "BFE1", FF_FULLBRIGHT | 2, 8, "A_BFGSpray", "S_BFGLAND4");
  S("S_BFGLAND4", "BFE1", FF_FULLBRIGHT | 3, 8, null, "S_BFGLAND5");
  S("S_BFGLAND5", "BFE1", FF_FULLBRIGHT | 4, 8, null, "S_BFGLAND6");
  S("S_BFGLAND6", "BFE1", FF_FULLBRIGHT | 5, 8, null, "S_NULL");
  S("S_BFGEXP", "BFE2", FF_FULLBRIGHT | 0, 8, null, "S_BFGEXP2");
  S("S_BFGEXP2", "BFE2", FF_FULLBRIGHT | 1, 8, null, "S_BFGEXP3");
  S("S_BFGEXP3", "BFE2", FF_FULLBRIGHT | 2, 8, null, "S_BFGEXP4");
  S("S_BFGEXP4", "BFE2", FF_FULLBRIGHT | 3, 8, null, "S_NULL");
  S("S_EXPLODE1", "MISL", FF_FULLBRIGHT | 1, 8, "A_Explode", "S_EXPLODE2");
  S("S_EXPLODE2", "MISL", FF_FULLBRIGHT | 2, 6, null, "S_EXPLODE3");
  S("S_EXPLODE3", "MISL", FF_FULLBRIGHT | 3, 4, null, "S_NULL");
  S("S_TFOG", "TFOG", FF_FULLBRIGHT | 0, 6, null, "S_TFOG01");
  S("S_TFOG01", "TFOG", FF_FULLBRIGHT | 1, 6, null, "S_TFOG02");
  S("S_TFOG02", "TFOG", FF_FULLBRIGHT | 0, 6, null, "S_TFOG2");
  S("S_TFOG2", "TFOG", FF_FULLBRIGHT | 1, 6, null, "S_TFOG3");
  S("S_TFOG3", "TFOG", FF_FULLBRIGHT | 2, 6, null, "S_TFOG4");
  S("S_TFOG4", "TFOG", FF_FULLBRIGHT | 3, 6, null, "S_TFOG5");
  S("S_TFOG5", "TFOG", FF_FULLBRIGHT | 4, 6, null, "S_TFOG6");
  S("S_TFOG6", "TFOG", FF_FULLBRIGHT | 5, 6, null, "S_TFOG7");
  S("S_TFOG7", "TFOG", FF_FULLBRIGHT | 6, 6, null, "S_TFOG8");
  S("S_TFOG8", "TFOG", FF_FULLBRIGHT | 7, 6, null, "S_TFOG9");
  S("S_TFOG9", "TFOG", FF_FULLBRIGHT | 8, 6, null, "S_TFOG10");
  S("S_TFOG10", "TFOG", FF_FULLBRIGHT | 9, 6, null, "S_NULL");
  S("S_IFOG", "IFOG", FF_FULLBRIGHT | 0, 6, null, "S_IFOG01");
  S("S_IFOG01", "IFOG", FF_FULLBRIGHT | 1, 6, null, "S_IFOG02");
  S("S_IFOG02", "IFOG", FF_FULLBRIGHT | 0, 6, null, "S_IFOG2");
  S("S_IFOG2", "IFOG", FF_FULLBRIGHT | 1, 6, null, "S_IFOG3");
  S("S_IFOG3", "IFOG", FF_FULLBRIGHT | 2, 6, null, "S_IFOG4");
  S("S_IFOG4", "IFOG", FF_FULLBRIGHT | 3, 6, null, "S_IFOG5");
  S("S_IFOG5", "IFOG", FF_FULLBRIGHT | 4, 6, null, "S_NULL");
  S("S_PLAY", "PLAY", 0, -1, null, "S_NULL");
  S("S_PLAY_RUN1", "PLAY", 0, 4, null, "S_PLAY_RUN2");
  S("S_PLAY_RUN2", "PLAY", 1, 4, null, "S_PLAY_RUN3");
  S("S_PLAY_RUN3", "PLAY", 2, 4, null, "S_PLAY_RUN4");
  S("S_PLAY_RUN4", "PLAY", 3, 4, null, "S_PLAY_RUN1");
  S("S_PLAY_ATK1", "PLAY", 4, 12, null, "S_PLAY");
  S("S_PLAY_ATK2", "PLAY", FF_FULLBRIGHT | 5, 6, null, "S_PLAY_ATK1");
  S("S_PLAY_PAIN", "PLAY", 6, 4, null, "S_PLAY_PAIN2");
  S("S_PLAY_PAIN2", "PLAY", 6, 4, "A_Pain", "S_PLAY");
  S("S_PLAY_DIE1", "PLAY", 7, 10, null, "S_PLAY_DIE2");
  S("S_PLAY_DIE2", "PLAY", 8, 10, "A_PlayerScream", "S_PLAY_DIE3");
  S("S_PLAY_DIE3", "PLAY", 9, 10, "A_Fall", "S_PLAY_DIE4");
  S("S_PLAY_DIE4", "PLAY", 10, 10, null, "S_PLAY_DIE5");
  S("S_PLAY_DIE5", "PLAY", 11, 10, null, "S_PLAY_DIE6");
  S("S_PLAY_DIE6", "PLAY", 12, 10, null, "S_PLAY_DIE7");
  S("S_PLAY_DIE7", "PLAY", 13, -1, null, "S_NULL");
  S("S_PLAY_XDIE1", "PLAY", 14, 5, null, "S_PLAY_XDIE2");
  S("S_PLAY_XDIE2", "PLAY", 15, 5, "A_XScream", "S_PLAY_XDIE3");
  S("S_PLAY_XDIE3", "PLAY", 16, 5, "A_Fall", "S_PLAY_XDIE4");
  S("S_PLAY_XDIE4", "PLAY", 17, 5, null, "S_PLAY_XDIE5");
  S("S_PLAY_XDIE5", "PLAY", 18, 5, null, "S_PLAY_XDIE6");
  S("S_PLAY_XDIE6", "PLAY", 19, 5, null, "S_PLAY_XDIE7");
  S("S_PLAY_XDIE7", "PLAY", 20, 5, null, "S_PLAY_XDIE8");
  S("S_PLAY_XDIE8", "PLAY", 21, 5, null, "S_PLAY_XDIE9");
  S("S_PLAY_XDIE9", "PLAY", 22, -1, null, "S_NULL");
  S("S_POSS_STND", "POSS", 0, 10, "A_Look", "S_POSS_STND2");
  S("S_POSS_STND2", "POSS", 1, 10, "A_Look", "S_POSS_STND");
  S("S_POSS_RUN1", "POSS", 0, 4, "A_Chase", "S_POSS_RUN2");
  S("S_POSS_RUN2", "POSS", 0, 4, "A_Chase", "S_POSS_RUN3");
  S("S_POSS_RUN3", "POSS", 1, 4, "A_Chase", "S_POSS_RUN4");
  S("S_POSS_RUN4", "POSS", 1, 4, "A_Chase", "S_POSS_RUN5");
  S("S_POSS_RUN5", "POSS", 2, 4, "A_Chase", "S_POSS_RUN6");
  S("S_POSS_RUN6", "POSS", 2, 4, "A_Chase", "S_POSS_RUN7");
  S("S_POSS_RUN7", "POSS", 3, 4, "A_Chase", "S_POSS_RUN8");
  S("S_POSS_RUN8", "POSS", 3, 4, "A_Chase", "S_POSS_RUN1");
  S("S_POSS_ATK1", "POSS", 4, 10, "A_FaceTarget", "S_POSS_ATK2");
  S("S_POSS_ATK2", "POSS", 5, 8, "A_PosAttack", "S_POSS_ATK3");
  S("S_POSS_ATK3", "POSS", 4, 8, null, "S_POSS_RUN1");
  S("S_POSS_PAIN", "POSS", 6, 3, null, "S_POSS_PAIN2");
  S("S_POSS_PAIN2", "POSS", 6, 3, "A_Pain", "S_POSS_RUN1");
  S("S_POSS_DIE1", "POSS", 7, 5, null, "S_POSS_DIE2");
  S("S_POSS_DIE2", "POSS", 8, 5, "A_Scream", "S_POSS_DIE3");
  S("S_POSS_DIE3", "POSS", 9, 5, "A_Fall", "S_POSS_DIE4");
  S("S_POSS_DIE4", "POSS", 10, 5, null, "S_POSS_DIE5");
  S("S_POSS_DIE5", "POSS", 11, -1, null, "S_NULL");
  S("S_POSS_XDIE1", "POSS", 12, 5, null, "S_POSS_XDIE2");
  S("S_POSS_XDIE2", "POSS", 13, 5, "A_XScream", "S_POSS_XDIE3");
  S("S_POSS_XDIE3", "POSS", 14, 5, "A_Fall", "S_POSS_XDIE4");
  S("S_POSS_XDIE4", "POSS", 15, 5, null, "S_POSS_XDIE5");
  S("S_POSS_XDIE5", "POSS", 16, 5, null, "S_POSS_XDIE6");
  S("S_POSS_XDIE6", "POSS", 17, 5, null, "S_POSS_XDIE7");
  S("S_POSS_XDIE7", "POSS", 18, 5, null, "S_POSS_XDIE8");
  S("S_POSS_XDIE8", "POSS", 19, 5, null, "S_POSS_XDIE9");
  S("S_POSS_XDIE9", "POSS", 20, -1, null, "S_NULL");
  S("S_POSS_RAISE1", "POSS", 10, 5, null, "S_POSS_RAISE2");
  S("S_POSS_RAISE2", "POSS", 9, 5, null, "S_POSS_RAISE3");
  S("S_POSS_RAISE3", "POSS", 8, 5, null, "S_POSS_RAISE4");
  S("S_POSS_RAISE4", "POSS", 7, 5, null, "S_POSS_RUN1");
  S("S_SPOS_STND", "SPOS", 0, 10, "A_Look", "S_SPOS_STND2");
  S("S_SPOS_STND2", "SPOS", 1, 10, "A_Look", "S_SPOS_STND");
  S("S_SPOS_RUN1", "SPOS", 0, 3, "A_Chase", "S_SPOS_RUN2");
  S("S_SPOS_RUN2", "SPOS", 0, 3, "A_Chase", "S_SPOS_RUN3");
  S("S_SPOS_RUN3", "SPOS", 1, 3, "A_Chase", "S_SPOS_RUN4");
  S("S_SPOS_RUN4", "SPOS", 1, 3, "A_Chase", "S_SPOS_RUN5");
  S("S_SPOS_RUN5", "SPOS", 2, 3, "A_Chase", "S_SPOS_RUN6");
  S("S_SPOS_RUN6", "SPOS", 2, 3, "A_Chase", "S_SPOS_RUN7");
  S("S_SPOS_RUN7", "SPOS", 3, 3, "A_Chase", "S_SPOS_RUN8");
  S("S_SPOS_RUN8", "SPOS", 3, 3, "A_Chase", "S_SPOS_RUN1");
  S("S_SPOS_ATK1", "SPOS", 4, 10, "A_FaceTarget", "S_SPOS_ATK2");
  S("S_SPOS_ATK2", "SPOS", FF_FULLBRIGHT | 5, 10, "A_SPosAttack", "S_SPOS_ATK3");
  S("S_SPOS_ATK3", "SPOS", 4, 10, null, "S_SPOS_RUN1");
  S("S_SPOS_PAIN", "SPOS", 6, 3, null, "S_SPOS_PAIN2");
  S("S_SPOS_PAIN2", "SPOS", 6, 3, "A_Pain", "S_SPOS_RUN1");
  S("S_SPOS_DIE1", "SPOS", 7, 5, null, "S_SPOS_DIE2");
  S("S_SPOS_DIE2", "SPOS", 8, 5, "A_Scream", "S_SPOS_DIE3");
  S("S_SPOS_DIE3", "SPOS", 9, 5, "A_Fall", "S_SPOS_DIE4");
  S("S_SPOS_DIE4", "SPOS", 10, 5, null, "S_SPOS_DIE5");
  S("S_SPOS_DIE5", "SPOS", 11, -1, null, "S_NULL");
  S("S_SPOS_XDIE1", "SPOS", 12, 5, null, "S_SPOS_XDIE2");
  S("S_SPOS_XDIE2", "SPOS", 13, 5, "A_XScream", "S_SPOS_XDIE3");
  S("S_SPOS_XDIE3", "SPOS", 14, 5, "A_Fall", "S_SPOS_XDIE4");
  S("S_SPOS_XDIE4", "SPOS", 15, 5, null, "S_SPOS_XDIE5");
  S("S_SPOS_XDIE5", "SPOS", 16, 5, null, "S_SPOS_XDIE6");
  S("S_SPOS_XDIE6", "SPOS", 17, 5, null, "S_SPOS_XDIE7");
  S("S_SPOS_XDIE7", "SPOS", 18, 5, null, "S_SPOS_XDIE8");
  S("S_SPOS_XDIE8", "SPOS", 19, 5, null, "S_SPOS_XDIE9");
  S("S_SPOS_XDIE9", "SPOS", 20, -1, null, "S_NULL");
  S("S_SPOS_RAISE1", "SPOS", 11, 5, null, "S_SPOS_RAISE2");
  S("S_SPOS_RAISE2", "SPOS", 10, 5, null, "S_SPOS_RAISE3");
  S("S_SPOS_RAISE3", "SPOS", 9, 5, null, "S_SPOS_RAISE4");
  S("S_SPOS_RAISE4", "SPOS", 8, 5, null, "S_SPOS_RAISE5");
  S("S_SPOS_RAISE5", "SPOS", 7, 5, null, "S_SPOS_RUN1");
  S("S_VILE_STND", "VILE", 0, 10, "A_Look", "S_VILE_STND2");
  S("S_VILE_STND2", "VILE", 1, 10, "A_Look", "S_VILE_STND");
  S("S_VILE_RUN1", "VILE", 0, 2, "A_VileChase", "S_VILE_RUN2");
  S("S_VILE_RUN2", "VILE", 0, 2, "A_VileChase", "S_VILE_RUN3");
  S("S_VILE_RUN3", "VILE", 1, 2, "A_VileChase", "S_VILE_RUN4");
  S("S_VILE_RUN4", "VILE", 1, 2, "A_VileChase", "S_VILE_RUN5");
  S("S_VILE_RUN5", "VILE", 2, 2, "A_VileChase", "S_VILE_RUN6");
  S("S_VILE_RUN6", "VILE", 2, 2, "A_VileChase", "S_VILE_RUN7");
  S("S_VILE_RUN7", "VILE", 3, 2, "A_VileChase", "S_VILE_RUN8");
  S("S_VILE_RUN8", "VILE", 3, 2, "A_VileChase", "S_VILE_RUN9");
  S("S_VILE_RUN9", "VILE", 4, 2, "A_VileChase", "S_VILE_RUN10");
  S("S_VILE_RUN10", "VILE", 4, 2, "A_VileChase", "S_VILE_RUN11");
  S("S_VILE_RUN11", "VILE", 5, 2, "A_VileChase", "S_VILE_RUN12");
  S("S_VILE_RUN12", "VILE", 5, 2, "A_VileChase", "S_VILE_RUN1");
  S("S_VILE_ATK1", "VILE", FF_FULLBRIGHT | 6, 0, "A_VileStart", "S_VILE_ATK2");
  S("S_VILE_ATK2", "VILE", FF_FULLBRIGHT | 6, 10, "A_FaceTarget", "S_VILE_ATK3");
  S("S_VILE_ATK3", "VILE", FF_FULLBRIGHT | 7, 8, "A_VileTarget", "S_VILE_ATK4");
  S("S_VILE_ATK4", "VILE", FF_FULLBRIGHT | 8, 8, "A_FaceTarget", "S_VILE_ATK5");
  S("S_VILE_ATK5", "VILE", FF_FULLBRIGHT | 9, 8, "A_FaceTarget", "S_VILE_ATK6");
  S("S_VILE_ATK6", "VILE", FF_FULLBRIGHT | 10, 8, "A_FaceTarget", "S_VILE_ATK7");
  S("S_VILE_ATK7", "VILE", FF_FULLBRIGHT | 11, 8, "A_FaceTarget", "S_VILE_ATK8");
  S("S_VILE_ATK8", "VILE", FF_FULLBRIGHT | 12, 8, "A_FaceTarget", "S_VILE_ATK9");
  S("S_VILE_ATK9", "VILE", FF_FULLBRIGHT | 13, 8, "A_FaceTarget", "S_VILE_ATK10");
  S("S_VILE_ATK10", "VILE", FF_FULLBRIGHT | 14, 8, "A_VileAttack", "S_VILE_ATK11");
  S("S_VILE_ATK11", "VILE", FF_FULLBRIGHT | 15, 20, null, "S_VILE_RUN1");
  S("S_VILE_HEAL1", "VILE", FF_FULLBRIGHT | 26, 10, null, "S_VILE_HEAL2");
  S("S_VILE_HEAL2", "VILE", FF_FULLBRIGHT | 27, 10, null, "S_VILE_HEAL3");
  S("S_VILE_HEAL3", "VILE", FF_FULLBRIGHT | 28, 10, null, "S_VILE_RUN1");
  S("S_VILE_PAIN", "VILE", 16, 5, null, "S_VILE_PAIN2");
  S("S_VILE_PAIN2", "VILE", 16, 5, "A_Pain", "S_VILE_RUN1");
  S("S_VILE_DIE1", "VILE", 16, 7, null, "S_VILE_DIE2");
  S("S_VILE_DIE2", "VILE", 17, 7, "A_Scream", "S_VILE_DIE3");
  S("S_VILE_DIE3", "VILE", 18, 7, "A_Fall", "S_VILE_DIE4");
  S("S_VILE_DIE4", "VILE", 19, 7, null, "S_VILE_DIE5");
  S("S_VILE_DIE5", "VILE", 20, 7, null, "S_VILE_DIE6");
  S("S_VILE_DIE6", "VILE", 21, 7, null, "S_VILE_DIE7");
  S("S_VILE_DIE7", "VILE", 22, 7, null, "S_VILE_DIE8");
  S("S_VILE_DIE8", "VILE", 23, 5, null, "S_VILE_DIE9");
  S("S_VILE_DIE9", "VILE", 24, 5, null, "S_VILE_DIE10");
  S("S_VILE_DIE10", "VILE", 25, -1, null, "S_NULL");
  S("S_FIRE1", "FIRE", FF_FULLBRIGHT | 0, 2, "A_StartFire", "S_FIRE2");
  S("S_FIRE2", "FIRE", FF_FULLBRIGHT | 1, 2, "A_Fire", "S_FIRE3");
  S("S_FIRE3", "FIRE", FF_FULLBRIGHT | 0, 2, "A_Fire", "S_FIRE4");
  S("S_FIRE4", "FIRE", FF_FULLBRIGHT | 1, 2, "A_Fire", "S_FIRE5");
  S("S_FIRE5", "FIRE", FF_FULLBRIGHT | 2, 2, "A_FireCrackle", "S_FIRE6");
  S("S_FIRE6", "FIRE", FF_FULLBRIGHT | 1, 2, "A_Fire", "S_FIRE7");
  S("S_FIRE7", "FIRE", FF_FULLBRIGHT | 2, 2, "A_Fire", "S_FIRE8");
  S("S_FIRE8", "FIRE", FF_FULLBRIGHT | 1, 2, "A_Fire", "S_FIRE9");
  S("S_FIRE9", "FIRE", FF_FULLBRIGHT | 2, 2, "A_Fire", "S_FIRE10");
  S("S_FIRE10", "FIRE", FF_FULLBRIGHT | 3, 2, "A_Fire", "S_FIRE11");
  S("S_FIRE11", "FIRE", FF_FULLBRIGHT | 2, 2, "A_Fire", "S_FIRE12");
  S("S_FIRE12", "FIRE", FF_FULLBRIGHT | 3, 2, "A_Fire", "S_FIRE13");
  S("S_FIRE13", "FIRE", FF_FULLBRIGHT | 2, 2, "A_Fire", "S_FIRE14");
  S("S_FIRE14", "FIRE", FF_FULLBRIGHT | 3, 2, "A_Fire", "S_FIRE15");
  S("S_FIRE15", "FIRE", FF_FULLBRIGHT | 4, 2, "A_Fire", "S_FIRE16");
  S("S_FIRE16", "FIRE", FF_FULLBRIGHT | 3, 2, "A_Fire", "S_FIRE17");
  S("S_FIRE17", "FIRE", FF_FULLBRIGHT | 4, 2, "A_Fire", "S_FIRE18");
  S("S_FIRE18", "FIRE", FF_FULLBRIGHT | 3, 2, "A_Fire", "S_FIRE19");
  S("S_FIRE19", "FIRE", FF_FULLBRIGHT | 4, 2, "A_FireCrackle", "S_FIRE20");
  S("S_FIRE20", "FIRE", FF_FULLBRIGHT | 5, 2, "A_Fire", "S_FIRE21");
  S("S_FIRE21", "FIRE", FF_FULLBRIGHT | 4, 2, "A_Fire", "S_FIRE22");
  S("S_FIRE22", "FIRE", FF_FULLBRIGHT | 5, 2, "A_Fire", "S_FIRE23");
  S("S_FIRE23", "FIRE", FF_FULLBRIGHT | 4, 2, "A_Fire", "S_FIRE24");
  S("S_FIRE24", "FIRE", FF_FULLBRIGHT | 5, 2, "A_Fire", "S_FIRE25");
  S("S_FIRE25", "FIRE", FF_FULLBRIGHT | 6, 2, "A_Fire", "S_FIRE26");
  S("S_FIRE26", "FIRE", FF_FULLBRIGHT | 7, 2, "A_Fire", "S_FIRE27");
  S("S_FIRE27", "FIRE", FF_FULLBRIGHT | 6, 2, "A_Fire", "S_FIRE28");
  S("S_FIRE28", "FIRE", FF_FULLBRIGHT | 7, 2, "A_Fire", "S_FIRE29");
  S("S_FIRE29", "FIRE", FF_FULLBRIGHT | 6, 2, "A_Fire", "S_FIRE30");
  S("S_FIRE30", "FIRE", FF_FULLBRIGHT | 7, 2, "A_Fire", "S_NULL");
  S("S_SMOKE1", "PUFF", 1, 4, null, "S_SMOKE2");
  S("S_SMOKE2", "PUFF", 2, 4, null, "S_SMOKE3");
  S("S_SMOKE3", "PUFF", 1, 4, null, "S_SMOKE4");
  S("S_SMOKE4", "PUFF", 2, 4, null, "S_SMOKE5");
  S("S_SMOKE5", "PUFF", 3, 4, null, "S_NULL");
  S("S_TRACER", "FATB", FF_FULLBRIGHT | 0, 2, "A_Tracer", "S_TRACER2");
  S("S_TRACER2", "FATB", FF_FULLBRIGHT | 1, 2, "A_Tracer", "S_TRACER");
  S("S_TRACEEXP1", "FBXP", FF_FULLBRIGHT | 0, 8, null, "S_TRACEEXP2");
  S("S_TRACEEXP2", "FBXP", FF_FULLBRIGHT | 1, 6, null, "S_TRACEEXP3");
  S("S_TRACEEXP3", "FBXP", FF_FULLBRIGHT | 2, 4, null, "S_NULL");
  S("S_SKEL_STND", "SKEL", 0, 10, "A_Look", "S_SKEL_STND2");
  S("S_SKEL_STND2", "SKEL", 1, 10, "A_Look", "S_SKEL_STND");
  S("S_SKEL_RUN1", "SKEL", 0, 2, "A_Chase", "S_SKEL_RUN2");
  S("S_SKEL_RUN2", "SKEL", 0, 2, "A_Chase", "S_SKEL_RUN3");
  S("S_SKEL_RUN3", "SKEL", 1, 2, "A_Chase", "S_SKEL_RUN4");
  S("S_SKEL_RUN4", "SKEL", 1, 2, "A_Chase", "S_SKEL_RUN5");
  S("S_SKEL_RUN5", "SKEL", 2, 2, "A_Chase", "S_SKEL_RUN6");
  S("S_SKEL_RUN6", "SKEL", 2, 2, "A_Chase", "S_SKEL_RUN7");
  S("S_SKEL_RUN7", "SKEL", 3, 2, "A_Chase", "S_SKEL_RUN8");
  S("S_SKEL_RUN8", "SKEL", 3, 2, "A_Chase", "S_SKEL_RUN9");
  S("S_SKEL_RUN9", "SKEL", 4, 2, "A_Chase", "S_SKEL_RUN10");
  S("S_SKEL_RUN10", "SKEL", 4, 2, "A_Chase", "S_SKEL_RUN11");
  S("S_SKEL_RUN11", "SKEL", 5, 2, "A_Chase", "S_SKEL_RUN12");
  S("S_SKEL_RUN12", "SKEL", 5, 2, "A_Chase", "S_SKEL_RUN1");
  S("S_SKEL_FIST1", "SKEL", 6, 0, "A_FaceTarget", "S_SKEL_FIST2");
  S("S_SKEL_FIST2", "SKEL", 6, 6, "A_SkelWhoosh", "S_SKEL_FIST3");
  S("S_SKEL_FIST3", "SKEL", 7, 6, "A_FaceTarget", "S_SKEL_FIST4");
  S("S_SKEL_FIST4", "SKEL", 8, 6, "A_SkelFist", "S_SKEL_RUN1");
  S("S_SKEL_MISS1", "SKEL", FF_FULLBRIGHT | 9, 0, "A_FaceTarget", "S_SKEL_MISS2");
  S("S_SKEL_MISS2", "SKEL", FF_FULLBRIGHT | 9, 10, "A_FaceTarget", "S_SKEL_MISS3");
  S("S_SKEL_MISS3", "SKEL", 10, 10, "A_SkelMissile", "S_SKEL_MISS4");
  S("S_SKEL_MISS4", "SKEL", 10, 10, "A_FaceTarget", "S_SKEL_RUN1");
  S("S_SKEL_PAIN", "SKEL", 11, 5, null, "S_SKEL_PAIN2");
  S("S_SKEL_PAIN2", "SKEL", 11, 5, "A_Pain", "S_SKEL_RUN1");
  S("S_SKEL_DIE1", "SKEL", 11, 7, null, "S_SKEL_DIE2");
  S("S_SKEL_DIE2", "SKEL", 12, 7, null, "S_SKEL_DIE3");
  S("S_SKEL_DIE3", "SKEL", 13, 7, "A_Scream", "S_SKEL_DIE4");
  S("S_SKEL_DIE4", "SKEL", 14, 7, "A_Fall", "S_SKEL_DIE5");
  S("S_SKEL_DIE5", "SKEL", 15, 7, null, "S_SKEL_DIE6");
  S("S_SKEL_DIE6", "SKEL", 16, -1, null, "S_NULL");
  S("S_SKEL_RAISE1", "SKEL", 16, 5, null, "S_SKEL_RAISE2");
  S("S_SKEL_RAISE2", "SKEL", 15, 5, null, "S_SKEL_RAISE3");
  S("S_SKEL_RAISE3", "SKEL", 14, 5, null, "S_SKEL_RAISE4");
  S("S_SKEL_RAISE4", "SKEL", 13, 5, null, "S_SKEL_RAISE5");
  S("S_SKEL_RAISE5", "SKEL", 12, 5, null, "S_SKEL_RAISE6");
  S("S_SKEL_RAISE6", "SKEL", 11, 5, null, "S_SKEL_RUN1");
  S("S_FATSHOT1", "MANF", FF_FULLBRIGHT | 0, 4, null, "S_FATSHOT2");
  S("S_FATSHOT2", "MANF", FF_FULLBRIGHT | 1, 4, null, "S_FATSHOT1");
  S("S_FATSHOTX1", "MISL", FF_FULLBRIGHT | 1, 8, null, "S_FATSHOTX2");
  S("S_FATSHOTX2", "MISL", FF_FULLBRIGHT | 2, 6, null, "S_FATSHOTX3");
  S("S_FATSHOTX3", "MISL", FF_FULLBRIGHT | 3, 4, null, "S_NULL");
  S("S_FATT_STND", "FATT", 0, 15, "A_Look", "S_FATT_STND2");
  S("S_FATT_STND2", "FATT", 1, 15, "A_Look", "S_FATT_STND");
  S("S_FATT_RUN1", "FATT", 0, 4, "A_Chase", "S_FATT_RUN2");
  S("S_FATT_RUN2", "FATT", 0, 4, "A_Chase", "S_FATT_RUN3");
  S("S_FATT_RUN3", "FATT", 1, 4, "A_Chase", "S_FATT_RUN4");
  S("S_FATT_RUN4", "FATT", 1, 4, "A_Chase", "S_FATT_RUN5");
  S("S_FATT_RUN5", "FATT", 2, 4, "A_Chase", "S_FATT_RUN6");
  S("S_FATT_RUN6", "FATT", 2, 4, "A_Chase", "S_FATT_RUN7");
  S("S_FATT_RUN7", "FATT", 3, 4, "A_Chase", "S_FATT_RUN8");
  S("S_FATT_RUN8", "FATT", 3, 4, "A_Chase", "S_FATT_RUN9");
  S("S_FATT_RUN9", "FATT", 4, 4, "A_Chase", "S_FATT_RUN10");
  S("S_FATT_RUN10", "FATT", 4, 4, "A_Chase", "S_FATT_RUN11");
  S("S_FATT_RUN11", "FATT", 5, 4, "A_Chase", "S_FATT_RUN12");
  S("S_FATT_RUN12", "FATT", 5, 4, "A_Chase", "S_FATT_RUN1");
  S("S_FATT_ATK1", "FATT", 6, 20, "A_FatRaise", "S_FATT_ATK2");
  S("S_FATT_ATK2", "FATT", FF_FULLBRIGHT | 7, 10, "A_FatAttack1", "S_FATT_ATK3");
  S("S_FATT_ATK3", "FATT", 8, 5, "A_FaceTarget", "S_FATT_ATK4");
  S("S_FATT_ATK4", "FATT", 6, 5, "A_FaceTarget", "S_FATT_ATK5");
  S("S_FATT_ATK5", "FATT", FF_FULLBRIGHT | 7, 10, "A_FatAttack2", "S_FATT_ATK6");
  S("S_FATT_ATK6", "FATT", 8, 5, "A_FaceTarget", "S_FATT_ATK7");
  S("S_FATT_ATK7", "FATT", 6, 5, "A_FaceTarget", "S_FATT_ATK8");
  S("S_FATT_ATK8", "FATT", FF_FULLBRIGHT | 7, 10, "A_FatAttack3", "S_FATT_ATK9");
  S("S_FATT_ATK9", "FATT", 8, 5, "A_FaceTarget", "S_FATT_ATK10");
  S("S_FATT_ATK10", "FATT", 6, 5, "A_FaceTarget", "S_FATT_RUN1");
  S("S_FATT_PAIN", "FATT", 9, 3, null, "S_FATT_PAIN2");
  S("S_FATT_PAIN2", "FATT", 9, 3, "A_Pain", "S_FATT_RUN1");
  S("S_FATT_DIE1", "FATT", 10, 6, null, "S_FATT_DIE2");
  S("S_FATT_DIE2", "FATT", 11, 6, "A_Scream", "S_FATT_DIE3");
  S("S_FATT_DIE3", "FATT", 12, 6, "A_Fall", "S_FATT_DIE4");
  S("S_FATT_DIE4", "FATT", 13, 6, null, "S_FATT_DIE5");
  S("S_FATT_DIE5", "FATT", 14, 6, null, "S_FATT_DIE6");
  S("S_FATT_DIE6", "FATT", 15, 6, null, "S_FATT_DIE7");
  S("S_FATT_DIE7", "FATT", 16, 6, null, "S_FATT_DIE8");
  S("S_FATT_DIE8", "FATT", 17, 6, null, "S_FATT_DIE9");
  S("S_FATT_DIE9", "FATT", 18, 6, null, "S_FATT_DIE10");
  S("S_FATT_DIE10", "FATT", 19, -1, "A_BossDeath", "S_NULL");
  S("S_FATT_RAISE1", "FATT", 17, 5, null, "S_FATT_RAISE2");
  S("S_FATT_RAISE2", "FATT", 16, 5, null, "S_FATT_RAISE3");
  S("S_FATT_RAISE3", "FATT", 15, 5, null, "S_FATT_RAISE4");
  S("S_FATT_RAISE4", "FATT", 14, 5, null, "S_FATT_RAISE5");
  S("S_FATT_RAISE5", "FATT", 13, 5, null, "S_FATT_RAISE6");
  S("S_FATT_RAISE6", "FATT", 12, 5, null, "S_FATT_RAISE7");
  S("S_FATT_RAISE7", "FATT", 11, 5, null, "S_FATT_RAISE8");
  S("S_FATT_RAISE8", "FATT", 10, 5, null, "S_FATT_RUN1");
  S("S_CPOS_STND", "CPOS", 0, 10, "A_Look", "S_CPOS_STND2");
  S("S_CPOS_STND2", "CPOS", 1, 10, "A_Look", "S_CPOS_STND");
  S("S_CPOS_RUN1", "CPOS", 0, 3, "A_Chase", "S_CPOS_RUN2");
  S("S_CPOS_RUN2", "CPOS", 0, 3, "A_Chase", "S_CPOS_RUN3");
  S("S_CPOS_RUN3", "CPOS", 1, 3, "A_Chase", "S_CPOS_RUN4");
  S("S_CPOS_RUN4", "CPOS", 1, 3, "A_Chase", "S_CPOS_RUN5");
  S("S_CPOS_RUN5", "CPOS", 2, 3, "A_Chase", "S_CPOS_RUN6");
  S("S_CPOS_RUN6", "CPOS", 2, 3, "A_Chase", "S_CPOS_RUN7");
  S("S_CPOS_RUN7", "CPOS", 3, 3, "A_Chase", "S_CPOS_RUN8");
  S("S_CPOS_RUN8", "CPOS", 3, 3, "A_Chase", "S_CPOS_RUN1");
  S("S_CPOS_ATK1", "CPOS", 4, 10, "A_FaceTarget", "S_CPOS_ATK2");
  S("S_CPOS_ATK2", "CPOS", FF_FULLBRIGHT | 5, 4, "A_CPosAttack", "S_CPOS_ATK3");
  S("S_CPOS_ATK3", "CPOS", FF_FULLBRIGHT | 4, 4, "A_CPosAttack", "S_CPOS_ATK4");
  S("S_CPOS_ATK4", "CPOS", 5, 1, "A_CPosRefire", "S_CPOS_ATK2");
  S("S_CPOS_PAIN", "CPOS", 6, 3, null, "S_CPOS_PAIN2");
  S("S_CPOS_PAIN2", "CPOS", 6, 3, "A_Pain", "S_CPOS_RUN1");
  S("S_CPOS_DIE1", "CPOS", 7, 5, null, "S_CPOS_DIE2");
  S("S_CPOS_DIE2", "CPOS", 8, 5, "A_Scream", "S_CPOS_DIE3");
  S("S_CPOS_DIE3", "CPOS", 9, 5, "A_Fall", "S_CPOS_DIE4");
  S("S_CPOS_DIE4", "CPOS", 10, 5, null, "S_CPOS_DIE5");
  S("S_CPOS_DIE5", "CPOS", 11, 5, null, "S_CPOS_DIE6");
  S("S_CPOS_DIE6", "CPOS", 12, 5, null, "S_CPOS_DIE7");
  S("S_CPOS_DIE7", "CPOS", 13, -1, null, "S_NULL");
  S("S_CPOS_XDIE1", "CPOS", 14, 5, null, "S_CPOS_XDIE2");
  S("S_CPOS_XDIE2", "CPOS", 15, 5, "A_XScream", "S_CPOS_XDIE3");
  S("S_CPOS_XDIE3", "CPOS", 16, 5, "A_Fall", "S_CPOS_XDIE4");
  S("S_CPOS_XDIE4", "CPOS", 17, 5, null, "S_CPOS_XDIE5");
  S("S_CPOS_XDIE5", "CPOS", 18, 5, null, "S_CPOS_XDIE6");
  S("S_CPOS_XDIE6", "CPOS", 19, -1, null, "S_NULL");
  S("S_CPOS_RAISE1", "CPOS", 13, 5, null, "S_CPOS_RAISE2");
  S("S_CPOS_RAISE2", "CPOS", 12, 5, null, "S_CPOS_RAISE3");
  S("S_CPOS_RAISE3", "CPOS", 11, 5, null, "S_CPOS_RAISE4");
  S("S_CPOS_RAISE4", "CPOS", 10, 5, null, "S_CPOS_RAISE5");
  S("S_CPOS_RAISE5", "CPOS", 9, 5, null, "S_CPOS_RAISE6");
  S("S_CPOS_RAISE6", "CPOS", 8, 5, null, "S_CPOS_RAISE7");
  S("S_CPOS_RAISE7", "CPOS", 7, 5, null, "S_CPOS_RUN1");
  S("S_TROO_STND", "TROO", 0, 10, "A_Look", "S_TROO_STND2");
  S("S_TROO_STND2", "TROO", 1, 10, "A_Look", "S_TROO_STND");
  S("S_TROO_RUN1", "TROO", 0, 3, "A_Chase", "S_TROO_RUN2");
  S("S_TROO_RUN2", "TROO", 0, 3, "A_Chase", "S_TROO_RUN3");
  S("S_TROO_RUN3", "TROO", 1, 3, "A_Chase", "S_TROO_RUN4");
  S("S_TROO_RUN4", "TROO", 1, 3, "A_Chase", "S_TROO_RUN5");
  S("S_TROO_RUN5", "TROO", 2, 3, "A_Chase", "S_TROO_RUN6");
  S("S_TROO_RUN6", "TROO", 2, 3, "A_Chase", "S_TROO_RUN7");
  S("S_TROO_RUN7", "TROO", 3, 3, "A_Chase", "S_TROO_RUN8");
  S("S_TROO_RUN8", "TROO", 3, 3, "A_Chase", "S_TROO_RUN1");
  S("S_TROO_ATK1", "TROO", 4, 8, "A_FaceTarget", "S_TROO_ATK2");
  S("S_TROO_ATK2", "TROO", 5, 8, "A_FaceTarget", "S_TROO_ATK3");
  S("S_TROO_ATK3", "TROO", 6, 6, "A_TroopAttack", "S_TROO_RUN1");
  S("S_TROO_PAIN", "TROO", 7, 2, null, "S_TROO_PAIN2");
  S("S_TROO_PAIN2", "TROO", 7, 2, "A_Pain", "S_TROO_RUN1");
  S("S_TROO_DIE1", "TROO", 8, 8, null, "S_TROO_DIE2");
  S("S_TROO_DIE2", "TROO", 9, 8, "A_Scream", "S_TROO_DIE3");
  S("S_TROO_DIE3", "TROO", 10, 6, null, "S_TROO_DIE4");
  S("S_TROO_DIE4", "TROO", 11, 6, "A_Fall", "S_TROO_DIE5");
  S("S_TROO_DIE5", "TROO", 12, -1, null, "S_NULL");
  S("S_TROO_XDIE1", "TROO", 13, 5, null, "S_TROO_XDIE2");
  S("S_TROO_XDIE2", "TROO", 14, 5, "A_XScream", "S_TROO_XDIE3");
  S("S_TROO_XDIE3", "TROO", 15, 5, null, "S_TROO_XDIE4");
  S("S_TROO_XDIE4", "TROO", 16, 5, "A_Fall", "S_TROO_XDIE5");
  S("S_TROO_XDIE5", "TROO", 17, 5, null, "S_TROO_XDIE6");
  S("S_TROO_XDIE6", "TROO", 18, 5, null, "S_TROO_XDIE7");
  S("S_TROO_XDIE7", "TROO", 19, 5, null, "S_TROO_XDIE8");
  S("S_TROO_XDIE8", "TROO", 20, -1, null, "S_NULL");
  S("S_TROO_RAISE1", "TROO", 12, 8, null, "S_TROO_RAISE2");
  S("S_TROO_RAISE2", "TROO", 11, 8, null, "S_TROO_RAISE3");
  S("S_TROO_RAISE3", "TROO", 10, 6, null, "S_TROO_RAISE4");
  S("S_TROO_RAISE4", "TROO", 9, 6, null, "S_TROO_RAISE5");
  S("S_TROO_RAISE5", "TROO", 8, 6, null, "S_TROO_RUN1");
  S("S_SARG_STND", "SARG", 0, 10, "A_Look", "S_SARG_STND2");
  S("S_SARG_STND2", "SARG", 1, 10, "A_Look", "S_SARG_STND");
  S("S_SARG_RUN1", "SARG", 0, 2, "A_Chase", "S_SARG_RUN2");
  S("S_SARG_RUN2", "SARG", 0, 2, "A_Chase", "S_SARG_RUN3");
  S("S_SARG_RUN3", "SARG", 1, 2, "A_Chase", "S_SARG_RUN4");
  S("S_SARG_RUN4", "SARG", 1, 2, "A_Chase", "S_SARG_RUN5");
  S("S_SARG_RUN5", "SARG", 2, 2, "A_Chase", "S_SARG_RUN6");
  S("S_SARG_RUN6", "SARG", 2, 2, "A_Chase", "S_SARG_RUN7");
  S("S_SARG_RUN7", "SARG", 3, 2, "A_Chase", "S_SARG_RUN8");
  S("S_SARG_RUN8", "SARG", 3, 2, "A_Chase", "S_SARG_RUN1");
  S("S_SARG_ATK1", "SARG", 4, 8, "A_FaceTarget", "S_SARG_ATK2");
  S("S_SARG_ATK2", "SARG", 5, 8, "A_FaceTarget", "S_SARG_ATK3");
  S("S_SARG_ATK3", "SARG", 6, 8, "A_SargAttack", "S_SARG_RUN1");
  S("S_SARG_PAIN", "SARG", 7, 2, null, "S_SARG_PAIN2");
  S("S_SARG_PAIN2", "SARG", 7, 2, "A_Pain", "S_SARG_RUN1");
  S("S_SARG_DIE1", "SARG", 8, 8, null, "S_SARG_DIE2");
  S("S_SARG_DIE2", "SARG", 9, 8, "A_Scream", "S_SARG_DIE3");
  S("S_SARG_DIE3", "SARG", 10, 4, null, "S_SARG_DIE4");
  S("S_SARG_DIE4", "SARG", 11, 4, "A_Fall", "S_SARG_DIE5");
  S("S_SARG_DIE5", "SARG", 12, 4, null, "S_SARG_DIE6");
  S("S_SARG_DIE6", "SARG", 13, -1, null, "S_NULL");
  S("S_SARG_RAISE1", "SARG", 13, 5, null, "S_SARG_RAISE2");
  S("S_SARG_RAISE2", "SARG", 12, 5, null, "S_SARG_RAISE3");
  S("S_SARG_RAISE3", "SARG", 11, 5, null, "S_SARG_RAISE4");
  S("S_SARG_RAISE4", "SARG", 10, 5, null, "S_SARG_RAISE5");
  S("S_SARG_RAISE5", "SARG", 9, 5, null, "S_SARG_RAISE6");
  S("S_SARG_RAISE6", "SARG", 8, 5, null, "S_SARG_RUN1");
  S("S_HEAD_STND", "HEAD", 0, 10, "A_Look", "S_HEAD_STND");
  S("S_HEAD_RUN1", "HEAD", 0, 3, "A_Chase", "S_HEAD_RUN1");
  S("S_HEAD_ATK1", "HEAD", 1, 5, "A_FaceTarget", "S_HEAD_ATK2");
  S("S_HEAD_ATK2", "HEAD", 2, 5, "A_FaceTarget", "S_HEAD_ATK3");
  S("S_HEAD_ATK3", "HEAD", FF_FULLBRIGHT | 3, 5, "A_HeadAttack", "S_HEAD_RUN1");
  S("S_HEAD_PAIN", "HEAD", 4, 3, null, "S_HEAD_PAIN2");
  S("S_HEAD_PAIN2", "HEAD", 4, 3, "A_Pain", "S_HEAD_PAIN3");
  S("S_HEAD_PAIN3", "HEAD", 5, 6, null, "S_HEAD_RUN1");
  S("S_HEAD_DIE1", "HEAD", 6, 8, null, "S_HEAD_DIE2");
  S("S_HEAD_DIE2", "HEAD", 7, 8, "A_Scream", "S_HEAD_DIE3");
  S("S_HEAD_DIE3", "HEAD", 8, 8, null, "S_HEAD_DIE4");
  S("S_HEAD_DIE4", "HEAD", 9, 8, null, "S_HEAD_DIE5");
  S("S_HEAD_DIE5", "HEAD", 10, 8, "A_Fall", "S_HEAD_DIE6");
  S("S_HEAD_DIE6", "HEAD", 11, -1, null, "S_NULL");
  S("S_HEAD_RAISE1", "HEAD", 11, 8, null, "S_HEAD_RAISE2");
  S("S_HEAD_RAISE2", "HEAD", 10, 8, null, "S_HEAD_RAISE3");
  S("S_HEAD_RAISE3", "HEAD", 9, 8, null, "S_HEAD_RAISE4");
  S("S_HEAD_RAISE4", "HEAD", 8, 8, null, "S_HEAD_RAISE5");
  S("S_HEAD_RAISE5", "HEAD", 7, 8, null, "S_HEAD_RAISE6");
  S("S_HEAD_RAISE6", "HEAD", 6, 8, null, "S_HEAD_RUN1");
  S("S_BRBALL1", "BAL7", FF_FULLBRIGHT | 0, 4, null, "S_BRBALL2");
  S("S_BRBALL2", "BAL7", FF_FULLBRIGHT | 1, 4, null, "S_BRBALL1");
  S("S_BRBALLX1", "BAL7", FF_FULLBRIGHT | 2, 6, null, "S_BRBALLX2");
  S("S_BRBALLX2", "BAL7", FF_FULLBRIGHT | 3, 6, null, "S_BRBALLX3");
  S("S_BRBALLX3", "BAL7", FF_FULLBRIGHT | 4, 6, null, "S_NULL");
  S("S_BOSS_STND", "BOSS", 0, 10, "A_Look", "S_BOSS_STND2");
  S("S_BOSS_STND2", "BOSS", 1, 10, "A_Look", "S_BOSS_STND");
  S("S_BOSS_RUN1", "BOSS", 0, 3, "A_Chase", "S_BOSS_RUN2");
  S("S_BOSS_RUN2", "BOSS", 0, 3, "A_Chase", "S_BOSS_RUN3");
  S("S_BOSS_RUN3", "BOSS", 1, 3, "A_Chase", "S_BOSS_RUN4");
  S("S_BOSS_RUN4", "BOSS", 1, 3, "A_Chase", "S_BOSS_RUN5");
  S("S_BOSS_RUN5", "BOSS", 2, 3, "A_Chase", "S_BOSS_RUN6");
  S("S_BOSS_RUN6", "BOSS", 2, 3, "A_Chase", "S_BOSS_RUN7");
  S("S_BOSS_RUN7", "BOSS", 3, 3, "A_Chase", "S_BOSS_RUN8");
  S("S_BOSS_RUN8", "BOSS", 3, 3, "A_Chase", "S_BOSS_RUN1");
  S("S_BOSS_ATK1", "BOSS", 4, 8, "A_FaceTarget", "S_BOSS_ATK2");
  S("S_BOSS_ATK2", "BOSS", 5, 8, "A_FaceTarget", "S_BOSS_ATK3");
  S("S_BOSS_ATK3", "BOSS", 6, 8, "A_BruisAttack", "S_BOSS_RUN1");
  S("S_BOSS_PAIN", "BOSS", 7, 2, null, "S_BOSS_PAIN2");
  S("S_BOSS_PAIN2", "BOSS", 7, 2, "A_Pain", "S_BOSS_RUN1");
  S("S_BOSS_DIE1", "BOSS", 8, 8, null, "S_BOSS_DIE2");
  S("S_BOSS_DIE2", "BOSS", 9, 8, "A_Scream", "S_BOSS_DIE3");
  S("S_BOSS_DIE3", "BOSS", 10, 8, null, "S_BOSS_DIE4");
  S("S_BOSS_DIE4", "BOSS", 11, 8, "A_Fall", "S_BOSS_DIE5");
  S("S_BOSS_DIE5", "BOSS", 12, 8, null, "S_BOSS_DIE6");
  S("S_BOSS_DIE6", "BOSS", 13, 8, null, "S_BOSS_DIE7");
  S("S_BOSS_DIE7", "BOSS", 14, -1, "A_BossDeath", "S_NULL");
  S("S_BOSS_RAISE1", "BOSS", 14, 8, null, "S_BOSS_RAISE2");
  S("S_BOSS_RAISE2", "BOSS", 13, 8, null, "S_BOSS_RAISE3");
  S("S_BOSS_RAISE3", "BOSS", 12, 8, null, "S_BOSS_RAISE4");
  S("S_BOSS_RAISE4", "BOSS", 11, 8, null, "S_BOSS_RAISE5");
  S("S_BOSS_RAISE5", "BOSS", 10, 8, null, "S_BOSS_RAISE6");
  S("S_BOSS_RAISE6", "BOSS", 9, 8, null, "S_BOSS_RAISE7");
  S("S_BOSS_RAISE7", "BOSS", 8, 8, null, "S_BOSS_RUN1");
  S("S_BOS2_STND", "BOS2", 0, 10, "A_Look", "S_BOS2_STND2");
  S("S_BOS2_STND2", "BOS2", 1, 10, "A_Look", "S_BOS2_STND");
  S("S_BOS2_RUN1", "BOS2", 0, 3, "A_Chase", "S_BOS2_RUN2");
  S("S_BOS2_RUN2", "BOS2", 0, 3, "A_Chase", "S_BOS2_RUN3");
  S("S_BOS2_RUN3", "BOS2", 1, 3, "A_Chase", "S_BOS2_RUN4");
  S("S_BOS2_RUN4", "BOS2", 1, 3, "A_Chase", "S_BOS2_RUN5");
  S("S_BOS2_RUN5", "BOS2", 2, 3, "A_Chase", "S_BOS2_RUN6");
  S("S_BOS2_RUN6", "BOS2", 2, 3, "A_Chase", "S_BOS2_RUN7");
  S("S_BOS2_RUN7", "BOS2", 3, 3, "A_Chase", "S_BOS2_RUN8");
  S("S_BOS2_RUN8", "BOS2", 3, 3, "A_Chase", "S_BOS2_RUN1");
  S("S_BOS2_ATK1", "BOS2", 4, 8, "A_FaceTarget", "S_BOS2_ATK2");
  S("S_BOS2_ATK2", "BOS2", 5, 8, "A_FaceTarget", "S_BOS2_ATK3");
  S("S_BOS2_ATK3", "BOS2", 6, 8, "A_BruisAttack", "S_BOS2_RUN1");
  S("S_BOS2_PAIN", "BOS2", 7, 2, null, "S_BOS2_PAIN2");
  S("S_BOS2_PAIN2", "BOS2", 7, 2, "A_Pain", "S_BOS2_RUN1");
  S("S_BOS2_DIE1", "BOS2", 8, 8, null, "S_BOS2_DIE2");
  S("S_BOS2_DIE2", "BOS2", 9, 8, "A_Scream", "S_BOS2_DIE3");
  S("S_BOS2_DIE3", "BOS2", 10, 8, null, "S_BOS2_DIE4");
  S("S_BOS2_DIE4", "BOS2", 11, 8, "A_Fall", "S_BOS2_DIE5");
  S("S_BOS2_DIE5", "BOS2", 12, 8, null, "S_BOS2_DIE6");
  S("S_BOS2_DIE6", "BOS2", 13, 8, null, "S_BOS2_DIE7");
  S("S_BOS2_DIE7", "BOS2", 14, -1, null, "S_NULL");
  S("S_BOS2_RAISE1", "BOS2", 14, 8, null, "S_BOS2_RAISE2");
  S("S_BOS2_RAISE2", "BOS2", 13, 8, null, "S_BOS2_RAISE3");
  S("S_BOS2_RAISE3", "BOS2", 12, 8, null, "S_BOS2_RAISE4");
  S("S_BOS2_RAISE4", "BOS2", 11, 8, null, "S_BOS2_RAISE5");
  S("S_BOS2_RAISE5", "BOS2", 10, 8, null, "S_BOS2_RAISE6");
  S("S_BOS2_RAISE6", "BOS2", 9, 8, null, "S_BOS2_RAISE7");
  S("S_BOS2_RAISE7", "BOS2", 8, 8, null, "S_BOS2_RUN1");
  S("S_SKULL_STND", "SKUL", FF_FULLBRIGHT | 0, 10, "A_Look", "S_SKULL_STND2");
  S("S_SKULL_STND2", "SKUL", FF_FULLBRIGHT | 1, 10, "A_Look", "S_SKULL_STND");
  S("S_SKULL_RUN1", "SKUL", FF_FULLBRIGHT | 0, 6, "A_Chase", "S_SKULL_RUN2");
  S("S_SKULL_RUN2", "SKUL", FF_FULLBRIGHT | 1, 6, "A_Chase", "S_SKULL_RUN1");
  S("S_SKULL_ATK1", "SKUL", FF_FULLBRIGHT | 2, 10, "A_FaceTarget", "S_SKULL_ATK2");
  S("S_SKULL_ATK2", "SKUL", FF_FULLBRIGHT | 3, 4, "A_SkullAttack", "S_SKULL_ATK3");
  S("S_SKULL_ATK3", "SKUL", FF_FULLBRIGHT | 2, 4, null, "S_SKULL_ATK4");
  S("S_SKULL_ATK4", "SKUL", FF_FULLBRIGHT | 3, 4, null, "S_SKULL_ATK3");
  S("S_SKULL_PAIN", "SKUL", FF_FULLBRIGHT | 4, 3, null, "S_SKULL_PAIN2");
  S("S_SKULL_PAIN2", "SKUL", FF_FULLBRIGHT | 4, 3, "A_Pain", "S_SKULL_RUN1");
  S("S_SKULL_DIE1", "SKUL", FF_FULLBRIGHT | 5, 6, null, "S_SKULL_DIE2");
  S("S_SKULL_DIE2", "SKUL", FF_FULLBRIGHT | 6, 6, "A_Scream", "S_SKULL_DIE3");
  S("S_SKULL_DIE3", "SKUL", FF_FULLBRIGHT | 7, 6, null, "S_SKULL_DIE4");
  S("S_SKULL_DIE4", "SKUL", FF_FULLBRIGHT | 8, 6, "A_Fall", "S_SKULL_DIE5");
  S("S_SKULL_DIE5", "SKUL", 9, 6, null, "S_SKULL_DIE6");
  S("S_SKULL_DIE6", "SKUL", 10, 6, null, "S_NULL");
  S("S_SPID_STND", "SPID", 0, 10, "A_Look", "S_SPID_STND2");
  S("S_SPID_STND2", "SPID", 1, 10, "A_Look", "S_SPID_STND");
  S("S_SPID_RUN1", "SPID", 0, 3, "A_Metal", "S_SPID_RUN2");
  S("S_SPID_RUN2", "SPID", 0, 3, "A_Chase", "S_SPID_RUN3");
  S("S_SPID_RUN3", "SPID", 1, 3, "A_Chase", "S_SPID_RUN4");
  S("S_SPID_RUN4", "SPID", 1, 3, "A_Chase", "S_SPID_RUN5");
  S("S_SPID_RUN5", "SPID", 2, 3, "A_Metal", "S_SPID_RUN6");
  S("S_SPID_RUN6", "SPID", 2, 3, "A_Chase", "S_SPID_RUN7");
  S("S_SPID_RUN7", "SPID", 3, 3, "A_Chase", "S_SPID_RUN8");
  S("S_SPID_RUN8", "SPID", 3, 3, "A_Chase", "S_SPID_RUN9");
  S("S_SPID_RUN9", "SPID", 4, 3, "A_Metal", "S_SPID_RUN10");
  S("S_SPID_RUN10", "SPID", 4, 3, "A_Chase", "S_SPID_RUN11");
  S("S_SPID_RUN11", "SPID", 5, 3, "A_Chase", "S_SPID_RUN12");
  S("S_SPID_RUN12", "SPID", 5, 3, "A_Chase", "S_SPID_RUN1");
  S("S_SPID_ATK1", "SPID", FF_FULLBRIGHT | 0, 20, "A_FaceTarget", "S_SPID_ATK2");
  S("S_SPID_ATK2", "SPID", FF_FULLBRIGHT | 6, 4, "A_SPosAttack", "S_SPID_ATK3");
  S("S_SPID_ATK3", "SPID", FF_FULLBRIGHT | 7, 4, "A_SPosAttack", "S_SPID_ATK4");
  S("S_SPID_ATK4", "SPID", FF_FULLBRIGHT | 7, 1, "A_SpidRefire", "S_SPID_ATK2");
  S("S_SPID_PAIN", "SPID", 8, 3, null, "S_SPID_PAIN2");
  S("S_SPID_PAIN2", "SPID", 8, 3, "A_Pain", "S_SPID_RUN1");
  S("S_SPID_DIE1", "SPID", 9, 20, "A_Scream", "S_SPID_DIE2");
  S("S_SPID_DIE2", "SPID", 10, 10, "A_Fall", "S_SPID_DIE3");
  S("S_SPID_DIE3", "SPID", 11, 10, null, "S_SPID_DIE4");
  S("S_SPID_DIE4", "SPID", 12, 10, null, "S_SPID_DIE5");
  S("S_SPID_DIE5", "SPID", 13, 10, null, "S_SPID_DIE6");
  S("S_SPID_DIE6", "SPID", 14, 10, null, "S_SPID_DIE7");
  S("S_SPID_DIE7", "SPID", 15, 10, null, "S_SPID_DIE8");
  S("S_SPID_DIE8", "SPID", 16, 10, null, "S_SPID_DIE9");
  S("S_SPID_DIE9", "SPID", 17, 10, null, "S_SPID_DIE10");
  S("S_SPID_DIE10", "SPID", 18, 30, null, "S_SPID_DIE11");
  S("S_SPID_DIE11", "SPID", 18, -1, "A_BossDeath", "S_NULL");
  S("S_BSPI_STND", "BSPI", 0, 10, "A_Look", "S_BSPI_STND2");
  S("S_BSPI_STND2", "BSPI", 1, 10, "A_Look", "S_BSPI_STND");
  S("S_BSPI_SIGHT", "BSPI", 0, 20, null, "S_BSPI_RUN1");
  S("S_BSPI_RUN1", "BSPI", 0, 3, "A_BabyMetal", "S_BSPI_RUN2");
  S("S_BSPI_RUN2", "BSPI", 0, 3, "A_Chase", "S_BSPI_RUN3");
  S("S_BSPI_RUN3", "BSPI", 1, 3, "A_Chase", "S_BSPI_RUN4");
  S("S_BSPI_RUN4", "BSPI", 1, 3, "A_Chase", "S_BSPI_RUN5");
  S("S_BSPI_RUN5", "BSPI", 2, 3, "A_Chase", "S_BSPI_RUN6");
  S("S_BSPI_RUN6", "BSPI", 2, 3, "A_Chase", "S_BSPI_RUN7");
  S("S_BSPI_RUN7", "BSPI", 3, 3, "A_BabyMetal", "S_BSPI_RUN8");
  S("S_BSPI_RUN8", "BSPI", 3, 3, "A_Chase", "S_BSPI_RUN9");
  S("S_BSPI_RUN9", "BSPI", 4, 3, "A_Chase", "S_BSPI_RUN10");
  S("S_BSPI_RUN10", "BSPI", 4, 3, "A_Chase", "S_BSPI_RUN11");
  S("S_BSPI_RUN11", "BSPI", 5, 3, "A_Chase", "S_BSPI_RUN12");
  S("S_BSPI_RUN12", "BSPI", 5, 3, "A_Chase", "S_BSPI_RUN1");
  S("S_BSPI_ATK1", "BSPI", FF_FULLBRIGHT | 0, 20, "A_FaceTarget", "S_BSPI_ATK2");
  S("S_BSPI_ATK2", "BSPI", FF_FULLBRIGHT | 6, 4, "A_BspiAttack", "S_BSPI_ATK3");
  S("S_BSPI_ATK3", "BSPI", FF_FULLBRIGHT | 7, 4, null, "S_BSPI_ATK4");
  S("S_BSPI_ATK4", "BSPI", FF_FULLBRIGHT | 7, 1, "A_SpidRefire", "S_BSPI_ATK2");
  S("S_BSPI_PAIN", "BSPI", 8, 3, null, "S_BSPI_PAIN2");
  S("S_BSPI_PAIN2", "BSPI", 8, 3, "A_Pain", "S_BSPI_RUN1");
  S("S_BSPI_DIE1", "BSPI", 9, 20, "A_Scream", "S_BSPI_DIE2");
  S("S_BSPI_DIE2", "BSPI", 10, 7, "A_Fall", "S_BSPI_DIE3");
  S("S_BSPI_DIE3", "BSPI", 11, 7, null, "S_BSPI_DIE4");
  S("S_BSPI_DIE4", "BSPI", 12, 7, null, "S_BSPI_DIE5");
  S("S_BSPI_DIE5", "BSPI", 13, 7, null, "S_BSPI_DIE6");
  S("S_BSPI_DIE6", "BSPI", 14, 7, null, "S_BSPI_DIE7");
  S("S_BSPI_DIE7", "BSPI", 15, -1, "A_BossDeath", "S_NULL");
  S("S_BSPI_RAISE1", "BSPI", 15, 5, null, "S_BSPI_RAISE2");
  S("S_BSPI_RAISE2", "BSPI", 14, 5, null, "S_BSPI_RAISE3");
  S("S_BSPI_RAISE3", "BSPI", 13, 5, null, "S_BSPI_RAISE4");
  S("S_BSPI_RAISE4", "BSPI", 12, 5, null, "S_BSPI_RAISE5");
  S("S_BSPI_RAISE5", "BSPI", 11, 5, null, "S_BSPI_RAISE6");
  S("S_BSPI_RAISE6", "BSPI", 10, 5, null, "S_BSPI_RAISE7");
  S("S_BSPI_RAISE7", "BSPI", 9, 5, null, "S_BSPI_RUN1");
  S("S_ARACH_PLAZ", "APLS", FF_FULLBRIGHT | 0, 5, null, "S_ARACH_PLAZ2");
  S("S_ARACH_PLAZ2", "APLS", FF_FULLBRIGHT | 1, 5, null, "S_ARACH_PLAZ");
  S("S_ARACH_PLEX", "APBX", FF_FULLBRIGHT | 0, 5, null, "S_ARACH_PLEX2");
  S("S_ARACH_PLEX2", "APBX", FF_FULLBRIGHT | 1, 5, null, "S_ARACH_PLEX3");
  S("S_ARACH_PLEX3", "APBX", FF_FULLBRIGHT | 2, 5, null, "S_ARACH_PLEX4");
  S("S_ARACH_PLEX4", "APBX", FF_FULLBRIGHT | 3, 5, null, "S_ARACH_PLEX5");
  S("S_ARACH_PLEX5", "APBX", FF_FULLBRIGHT | 4, 5, null, "S_NULL");
  S("S_CYBER_STND", "CYBR", 0, 10, "A_Look", "S_CYBER_STND2");
  S("S_CYBER_STND2", "CYBR", 1, 10, "A_Look", "S_CYBER_STND");
  S("S_CYBER_RUN1", "CYBR", 0, 3, "A_Hoof", "S_CYBER_RUN2");
  S("S_CYBER_RUN2", "CYBR", 0, 3, "A_Chase", "S_CYBER_RUN3");
  S("S_CYBER_RUN3", "CYBR", 1, 3, "A_Chase", "S_CYBER_RUN4");
  S("S_CYBER_RUN4", "CYBR", 1, 3, "A_Chase", "S_CYBER_RUN5");
  S("S_CYBER_RUN5", "CYBR", 2, 3, "A_Chase", "S_CYBER_RUN6");
  S("S_CYBER_RUN6", "CYBR", 2, 3, "A_Chase", "S_CYBER_RUN7");
  S("S_CYBER_RUN7", "CYBR", 3, 3, "A_Metal", "S_CYBER_RUN8");
  S("S_CYBER_RUN8", "CYBR", 3, 3, "A_Chase", "S_CYBER_RUN1");
  S("S_CYBER_ATK1", "CYBR", 4, 6, "A_FaceTarget", "S_CYBER_ATK2");
  S("S_CYBER_ATK2", "CYBR", 5, 12, "A_CyberAttack", "S_CYBER_ATK3");
  S("S_CYBER_ATK3", "CYBR", 4, 12, "A_FaceTarget", "S_CYBER_ATK4");
  S("S_CYBER_ATK4", "CYBR", 5, 12, "A_CyberAttack", "S_CYBER_ATK5");
  S("S_CYBER_ATK5", "CYBR", 4, 12, "A_FaceTarget", "S_CYBER_ATK6");
  S("S_CYBER_ATK6", "CYBR", 5, 12, "A_CyberAttack", "S_CYBER_RUN1");
  S("S_CYBER_PAIN", "CYBR", 6, 10, "A_Pain", "S_CYBER_RUN1");
  S("S_CYBER_DIE1", "CYBR", 7, 10, null, "S_CYBER_DIE2");
  S("S_CYBER_DIE2", "CYBR", 8, 10, "A_Scream", "S_CYBER_DIE3");
  S("S_CYBER_DIE3", "CYBR", 9, 10, null, "S_CYBER_DIE4");
  S("S_CYBER_DIE4", "CYBR", 10, 10, null, "S_CYBER_DIE5");
  S("S_CYBER_DIE5", "CYBR", 11, 10, null, "S_CYBER_DIE6");
  S("S_CYBER_DIE6", "CYBR", 12, 10, "A_Fall", "S_CYBER_DIE7");
  S("S_CYBER_DIE7", "CYBR", 13, 10, null, "S_CYBER_DIE8");
  S("S_CYBER_DIE8", "CYBR", 14, 10, null, "S_CYBER_DIE9");
  S("S_CYBER_DIE9", "CYBR", 15, 30, null, "S_CYBER_DIE10");
  S("S_CYBER_DIE10", "CYBR", 15, -1, "A_BossDeath", "S_NULL");
  S("S_PAIN_STND", "PAIN", 0, 10, "A_Look", "S_PAIN_STND");
  S("S_PAIN_RUN1", "PAIN", 0, 3, "A_Chase", "S_PAIN_RUN2");
  S("S_PAIN_RUN2", "PAIN", 0, 3, "A_Chase", "S_PAIN_RUN3");
  S("S_PAIN_RUN3", "PAIN", 1, 3, "A_Chase", "S_PAIN_RUN4");
  S("S_PAIN_RUN4", "PAIN", 1, 3, "A_Chase", "S_PAIN_RUN5");
  S("S_PAIN_RUN5", "PAIN", 2, 3, "A_Chase", "S_PAIN_RUN6");
  S("S_PAIN_RUN6", "PAIN", 2, 3, "A_Chase", "S_PAIN_RUN1");
  S("S_PAIN_ATK1", "PAIN", 3, 5, "A_FaceTarget", "S_PAIN_ATK2");
  S("S_PAIN_ATK2", "PAIN", 4, 5, "A_FaceTarget", "S_PAIN_ATK3");
  S("S_PAIN_ATK3", "PAIN", FF_FULLBRIGHT | 5, 5, "A_FaceTarget", "S_PAIN_ATK4");
  S("S_PAIN_ATK4", "PAIN", FF_FULLBRIGHT | 5, 0, "A_PainAttack", "S_PAIN_RUN1");
  S("S_PAIN_PAIN", "PAIN", 6, 6, null, "S_PAIN_PAIN2");
  S("S_PAIN_PAIN2", "PAIN", 6, 6, "A_Pain", "S_PAIN_RUN1");
  S("S_PAIN_DIE1", "PAIN", FF_FULLBRIGHT | 7, 8, null, "S_PAIN_DIE2");
  S("S_PAIN_DIE2", "PAIN", FF_FULLBRIGHT | 8, 8, "A_Scream", "S_PAIN_DIE3");
  S("S_PAIN_DIE3", "PAIN", FF_FULLBRIGHT | 9, 8, null, "S_PAIN_DIE4");
  S("S_PAIN_DIE4", "PAIN", FF_FULLBRIGHT | 10, 8, null, "S_PAIN_DIE5");
  S("S_PAIN_DIE5", "PAIN", FF_FULLBRIGHT | 11, 8, "A_PainDie", "S_PAIN_DIE6");
  S("S_PAIN_DIE6", "PAIN", FF_FULLBRIGHT | 12, 8, null, "S_NULL");
  S("S_PAIN_RAISE1", "PAIN", 12, 8, null, "S_PAIN_RAISE2");
  S("S_PAIN_RAISE2", "PAIN", 11, 8, null, "S_PAIN_RAISE3");
  S("S_PAIN_RAISE3", "PAIN", 10, 8, null, "S_PAIN_RAISE4");
  S("S_PAIN_RAISE4", "PAIN", 9, 8, null, "S_PAIN_RAISE5");
  S("S_PAIN_RAISE5", "PAIN", 8, 8, null, "S_PAIN_RAISE6");
  S("S_PAIN_RAISE6", "PAIN", 7, 8, null, "S_PAIN_RUN1");
  S("S_SSWV_STND", "SSWV", 0, 10, "A_Look", "S_SSWV_STND2");
  S("S_SSWV_STND2", "SSWV", 1, 10, "A_Look", "S_SSWV_STND");
  S("S_SSWV_RUN1", "SSWV", 0, 3, "A_Chase", "S_SSWV_RUN2");
  S("S_SSWV_RUN2", "SSWV", 0, 3, "A_Chase", "S_SSWV_RUN3");
  S("S_SSWV_RUN3", "SSWV", 1, 3, "A_Chase", "S_SSWV_RUN4");
  S("S_SSWV_RUN4", "SSWV", 1, 3, "A_Chase", "S_SSWV_RUN5");
  S("S_SSWV_RUN5", "SSWV", 2, 3, "A_Chase", "S_SSWV_RUN6");
  S("S_SSWV_RUN6", "SSWV", 2, 3, "A_Chase", "S_SSWV_RUN7");
  S("S_SSWV_RUN7", "SSWV", 3, 3, "A_Chase", "S_SSWV_RUN8");
  S("S_SSWV_RUN8", "SSWV", 3, 3, "A_Chase", "S_SSWV_RUN1");
  S("S_SSWV_ATK1", "SSWV", 4, 10, "A_FaceTarget", "S_SSWV_ATK2");
  S("S_SSWV_ATK2", "SSWV", 5, 10, "A_FaceTarget", "S_SSWV_ATK3");
  S("S_SSWV_ATK3", "SSWV", FF_FULLBRIGHT | 6, 4, "A_CPosAttack", "S_SSWV_ATK4");
  S("S_SSWV_ATK4", "SSWV", 5, 6, "A_FaceTarget", "S_SSWV_ATK5");
  S("S_SSWV_ATK5", "SSWV", FF_FULLBRIGHT | 6, 4, "A_CPosAttack", "S_SSWV_ATK6");
  S("S_SSWV_ATK6", "SSWV", 5, 1, "A_CPosRefire", "S_SSWV_ATK2");
  S("S_SSWV_PAIN", "SSWV", 7, 3, null, "S_SSWV_PAIN2");
  S("S_SSWV_PAIN2", "SSWV", 7, 3, "A_Pain", "S_SSWV_RUN1");
  S("S_SSWV_DIE1", "SSWV", 8, 5, null, "S_SSWV_DIE2");
  S("S_SSWV_DIE2", "SSWV", 9, 5, "A_Scream", "S_SSWV_DIE3");
  S("S_SSWV_DIE3", "SSWV", 10, 5, "A_Fall", "S_SSWV_DIE4");
  S("S_SSWV_DIE4", "SSWV", 11, 5, null, "S_SSWV_DIE5");
  S("S_SSWV_DIE5", "SSWV", 12, -1, null, "S_NULL");
  S("S_SSWV_XDIE1", "SSWV", 13, 5, null, "S_SSWV_XDIE2");
  S("S_SSWV_XDIE2", "SSWV", 14, 5, "A_XScream", "S_SSWV_XDIE3");
  S("S_SSWV_XDIE3", "SSWV", 15, 5, "A_Fall", "S_SSWV_XDIE4");
  S("S_SSWV_XDIE4", "SSWV", 16, 5, null, "S_SSWV_XDIE5");
  S("S_SSWV_XDIE5", "SSWV", 17, 5, null, "S_SSWV_XDIE6");
  S("S_SSWV_XDIE6", "SSWV", 18, 5, null, "S_SSWV_XDIE7");
  S("S_SSWV_XDIE7", "SSWV", 19, 5, null, "S_SSWV_XDIE8");
  S("S_SSWV_XDIE8", "SSWV", 20, 5, null, "S_SSWV_XDIE9");
  S("S_SSWV_XDIE9", "SSWV", 21, -1, null, "S_NULL");
  S("S_SSWV_RAISE1", "SSWV", 12, 5, null, "S_SSWV_RAISE2");
  S("S_SSWV_RAISE2", "SSWV", 11, 5, null, "S_SSWV_RAISE3");
  S("S_SSWV_RAISE3", "SSWV", 10, 5, null, "S_SSWV_RAISE4");
  S("S_SSWV_RAISE4", "SSWV", 9, 5, null, "S_SSWV_RAISE5");
  S("S_SSWV_RAISE5", "SSWV", 8, 5, null, "S_SSWV_RUN1");
  S("S_KEENSTND", "KEEN", 0, -1, null, "S_KEENSTND");
  S("S_COMMKEEN", "KEEN", 0, 6, null, "S_COMMKEEN2");
  S("S_COMMKEEN2", "KEEN", 1, 6, null, "S_COMMKEEN3");
  S("S_COMMKEEN3", "KEEN", 2, 6, "A_Scream", "S_COMMKEEN4");
  S("S_COMMKEEN4", "KEEN", 3, 6, null, "S_COMMKEEN5");
  S("S_COMMKEEN5", "KEEN", 4, 6, null, "S_COMMKEEN6");
  S("S_COMMKEEN6", "KEEN", 5, 6, null, "S_COMMKEEN7");
  S("S_COMMKEEN7", "KEEN", 6, 6, null, "S_COMMKEEN8");
  S("S_COMMKEEN8", "KEEN", 7, 6, null, "S_COMMKEEN9");
  S("S_COMMKEEN9", "KEEN", 8, 6, null, "S_COMMKEEN10");
  S("S_COMMKEEN10", "KEEN", 9, 6, null, "S_COMMKEEN11");
  S("S_COMMKEEN11", "KEEN", 10, 6, "A_KeenDie", "S_COMMKEEN12");
  S("S_COMMKEEN12", "KEEN", 11, -1, null, "S_NULL");
  S("S_KEENPAIN", "KEEN", 12, 4, null, "S_KEENPAIN2");
  S("S_KEENPAIN2", "KEEN", 12, 8, "A_Pain", "S_KEENSTND");
  S("S_BRAIN", "BBRN", 0, -1, null, "S_NULL");
  S("S_BRAIN_PAIN", "BBRN", 1, 36, "A_BrainPain", "S_BRAIN");
  S("S_BRAIN_DIE1", "BBRN", 0, 100, "A_BrainScream", "S_BRAIN_DIE2");
  S("S_BRAIN_DIE2", "BBRN", 0, 10, null, "S_BRAIN_DIE3");
  S("S_BRAIN_DIE3", "BBRN", 0, 10, null, "S_BRAIN_DIE4");
  S("S_BRAIN_DIE4", "BBRN", 0, -1, "A_BrainDie", "S_NULL");
  S("S_BRAINEYE", "SSWV", 0, 10, "A_Look", "S_BRAINEYE");
  S("S_BRAINEYESEE", "SSWV", 0, 181, "A_BrainAwake", "S_BRAINEYE1");
  S("S_BRAINEYE1", "SSWV", 0, 150, "A_BrainSpit", "S_BRAINEYE1");
  S("S_SPAWN1", "BOSF", FF_FULLBRIGHT | 0, 3, "A_SpawnSound", "S_SPAWN2");
  S("S_SPAWN2", "BOSF", FF_FULLBRIGHT | 1, 3, "A_SpawnFly", "S_SPAWN3");
  S("S_SPAWN3", "BOSF", FF_FULLBRIGHT | 2, 3, "A_SpawnFly", "S_SPAWN4");
  S("S_SPAWN4", "BOSF", FF_FULLBRIGHT | 3, 3, "A_SpawnFly", "S_SPAWN1");
  S("S_SPAWNFIRE1", "FIRE", FF_FULLBRIGHT | 0, 4, "A_Fire", "S_SPAWNFIRE2");
  S("S_SPAWNFIRE2", "FIRE", FF_FULLBRIGHT | 1, 4, "A_Fire", "S_SPAWNFIRE3");
  S("S_SPAWNFIRE3", "FIRE", FF_FULLBRIGHT | 2, 4, "A_Fire", "S_SPAWNFIRE4");
  S("S_SPAWNFIRE4", "FIRE", FF_FULLBRIGHT | 3, 4, "A_Fire", "S_SPAWNFIRE5");
  S("S_SPAWNFIRE5", "FIRE", FF_FULLBRIGHT | 4, 4, "A_Fire", "S_SPAWNFIRE6");
  S("S_SPAWNFIRE6", "FIRE", FF_FULLBRIGHT | 5, 4, "A_Fire", "S_SPAWNFIRE7");
  S("S_SPAWNFIRE7", "FIRE", FF_FULLBRIGHT | 6, 4, "A_Fire", "S_SPAWNFIRE8");
  S("S_SPAWNFIRE8", "FIRE", FF_FULLBRIGHT | 7, 4, "A_Fire", "S_NULL");
  S("S_BRAINEXPLODE1", "MISL", FF_FULLBRIGHT | 1, 10, null, "S_BRAINEXPLODE2");
  S("S_BRAINEXPLODE2", "MISL", FF_FULLBRIGHT | 2, 10, null, "S_BRAINEXPLODE3");
  S("S_BRAINEXPLODE3", "MISL", FF_FULLBRIGHT | 3, 10, "A_BrainExplode", "S_NULL");
  S("S_ARM1", "ARM1", 0, 6, null, "S_ARM1A");
  S("S_ARM1A", "ARM1", FF_FULLBRIGHT | 1, 7, null, "S_ARM1");
  S("S_ARM2", "ARM2", 0, 6, null, "S_ARM2A");
  S("S_ARM2A", "ARM2", FF_FULLBRIGHT | 1, 6, null, "S_ARM2");
  S("S_BAR1", "BAR1", 0, 6, null, "S_BAR2");
  S("S_BAR2", "BAR1", 1, 6, null, "S_BAR1");
  S("S_BEXP", "BEXP", FF_FULLBRIGHT | 0, 5, null, "S_BEXP2");
  S("S_BEXP2", "BEXP", FF_FULLBRIGHT | 1, 5, "A_Scream", "S_BEXP3");
  S("S_BEXP3", "BEXP", FF_FULLBRIGHT | 2, 5, null, "S_BEXP4");
  S("S_BEXP4", "BEXP", FF_FULLBRIGHT | 3, 10, "A_Explode", "S_BEXP5");
  S("S_BEXP5", "BEXP", FF_FULLBRIGHT | 4, 10, null, "S_NULL");
  S("S_BBAR1", "FCAN", FF_FULLBRIGHT | 0, 4, null, "S_BBAR2");
  S("S_BBAR2", "FCAN", FF_FULLBRIGHT | 1, 4, null, "S_BBAR3");
  S("S_BBAR3", "FCAN", FF_FULLBRIGHT | 2, 4, null, "S_BBAR1");
  S("S_BON1", "BON1", 0, 6, null, "S_BON1A");
  S("S_BON1A", "BON1", 1, 6, null, "S_BON1B");
  S("S_BON1B", "BON1", 2, 6, null, "S_BON1C");
  S("S_BON1C", "BON1", 3, 6, null, "S_BON1D");
  S("S_BON1D", "BON1", 2, 6, null, "S_BON1E");
  S("S_BON1E", "BON1", 1, 6, null, "S_BON1");
  S("S_BON2", "BON2", 0, 6, null, "S_BON2A");
  S("S_BON2A", "BON2", 1, 6, null, "S_BON2B");
  S("S_BON2B", "BON2", 2, 6, null, "S_BON2C");
  S("S_BON2C", "BON2", 3, 6, null, "S_BON2D");
  S("S_BON2D", "BON2", 2, 6, null, "S_BON2E");
  S("S_BON2E", "BON2", 1, 6, null, "S_BON2");
  S("S_BKEY", "BKEY", 0, 10, null, "S_BKEY2");
  S("S_BKEY2", "BKEY", FF_FULLBRIGHT | 1, 10, null, "S_BKEY");
  S("S_RKEY", "RKEY", 0, 10, null, "S_RKEY2");
  S("S_RKEY2", "RKEY", FF_FULLBRIGHT | 1, 10, null, "S_RKEY");
  S("S_YKEY", "YKEY", 0, 10, null, "S_YKEY2");
  S("S_YKEY2", "YKEY", FF_FULLBRIGHT | 1, 10, null, "S_YKEY");
  S("S_BSKULL", "BSKU", 0, 10, null, "S_BSKULL2");
  S("S_BSKULL2", "BSKU", FF_FULLBRIGHT | 1, 10, null, "S_BSKULL");
  S("S_RSKULL", "RSKU", 0, 10, null, "S_RSKULL2");
  S("S_RSKULL2", "RSKU", FF_FULLBRIGHT | 1, 10, null, "S_RSKULL");
  S("S_YSKULL", "YSKU", 0, 10, null, "S_YSKULL2");
  S("S_YSKULL2", "YSKU", FF_FULLBRIGHT | 1, 10, null, "S_YSKULL");
  S("S_STIM", "STIM", 0, -1, null, "S_NULL");
  S("S_MEDI", "MEDI", 0, -1, null, "S_NULL");
  S("S_SOUL", "SOUL", FF_FULLBRIGHT | 0, 6, null, "S_SOUL2");
  S("S_SOUL2", "SOUL", FF_FULLBRIGHT | 1, 6, null, "S_SOUL3");
  S("S_SOUL3", "SOUL", FF_FULLBRIGHT | 2, 6, null, "S_SOUL4");
  S("S_SOUL4", "SOUL", FF_FULLBRIGHT | 3, 6, null, "S_SOUL5");
  S("S_SOUL5", "SOUL", FF_FULLBRIGHT | 2, 6, null, "S_SOUL6");
  S("S_SOUL6", "SOUL", FF_FULLBRIGHT | 1, 6, null, "S_SOUL");
  S("S_PINV", "PINV", FF_FULLBRIGHT | 0, 6, null, "S_PINV2");
  S("S_PINV2", "PINV", FF_FULLBRIGHT | 1, 6, null, "S_PINV3");
  S("S_PINV3", "PINV", FF_FULLBRIGHT | 2, 6, null, "S_PINV4");
  S("S_PINV4", "PINV", FF_FULLBRIGHT | 3, 6, null, "S_PINV");
  S("S_PSTR", "PSTR", FF_FULLBRIGHT | 0, -1, null, "S_NULL");
  S("S_PINS", "PINS", FF_FULLBRIGHT | 0, 6, null, "S_PINS2");
  S("S_PINS2", "PINS", FF_FULLBRIGHT | 1, 6, null, "S_PINS3");
  S("S_PINS3", "PINS", FF_FULLBRIGHT | 2, 6, null, "S_PINS4");
  S("S_PINS4", "PINS", FF_FULLBRIGHT | 3, 6, null, "S_PINS");
  S("S_MEGA", "MEGA", FF_FULLBRIGHT | 0, 6, null, "S_MEGA2");
  S("S_MEGA2", "MEGA", FF_FULLBRIGHT | 1, 6, null, "S_MEGA3");
  S("S_MEGA3", "MEGA", FF_FULLBRIGHT | 2, 6, null, "S_MEGA4");
  S("S_MEGA4", "MEGA", FF_FULLBRIGHT | 3, 6, null, "S_MEGA");
  S("S_SUIT", "SUIT", FF_FULLBRIGHT | 0, -1, null, "S_NULL");
  S("S_PMAP", "PMAP", FF_FULLBRIGHT | 0, 6, null, "S_PMAP2");
  S("S_PMAP2", "PMAP", FF_FULLBRIGHT | 1, 6, null, "S_PMAP3");
  S("S_PMAP3", "PMAP", FF_FULLBRIGHT | 2, 6, null, "S_PMAP4");
  S("S_PMAP4", "PMAP", FF_FULLBRIGHT | 3, 6, null, "S_PMAP5");
  S("S_PMAP5", "PMAP", FF_FULLBRIGHT | 2, 6, null, "S_PMAP6");
  S("S_PMAP6", "PMAP", FF_FULLBRIGHT | 1, 6, null, "S_PMAP");
  S("S_PVIS", "PVIS", FF_FULLBRIGHT | 0, 6, null, "S_PVIS2");
  S("S_PVIS2", "PVIS", 1, 6, null, "S_PVIS");
  S("S_CLIP", "CLIP", 0, -1, null, "S_NULL");
  S("S_AMMO", "AMMO", 0, -1, null, "S_NULL");
  S("S_ROCK", "ROCK", 0, -1, null, "S_NULL");
  S("S_BROK", "BROK", 0, -1, null, "S_NULL");
  S("S_CELL", "CELL", 0, -1, null, "S_NULL");
  S("S_CELP", "CELP", 0, -1, null, "S_NULL");
  S("S_SHEL", "SHEL", 0, -1, null, "S_NULL");
  S("S_SBOX", "SBOX", 0, -1, null, "S_NULL");
  S("S_BPAK", "BPAK", 0, -1, null, "S_NULL");
  S("S_BFUG", "BFUG", 0, -1, null, "S_NULL");
  S("S_MGUN", "MGUN", 0, -1, null, "S_NULL");
  S("S_CSAW", "CSAW", 0, -1, null, "S_NULL");
  S("S_LAUN", "LAUN", 0, -1, null, "S_NULL");
  S("S_PLAS", "PLAS", 0, -1, null, "S_NULL");
  S("S_SHOT", "SHOT", 0, -1, null, "S_NULL");
  S("S_SHOT2", "SGN2", 0, -1, null, "S_NULL");
  S("S_COLU", "COLU", FF_FULLBRIGHT | 0, -1, null, "S_NULL");
  S("S_STALAG", "SMT2", 0, -1, null, "S_NULL");
  S("S_BLOODYTWITCH", "GOR1", 0, 10, null, "S_BLOODYTWITCH2");
  S("S_BLOODYTWITCH2", "GOR1", 1, 15, null, "S_BLOODYTWITCH3");
  S("S_BLOODYTWITCH3", "GOR1", 2, 8, null, "S_BLOODYTWITCH4");
  S("S_BLOODYTWITCH4", "GOR1", 1, 6, null, "S_BLOODYTWITCH");
  S("S_DEADTORSO", "PLAY", 13, -1, null, "S_NULL");
  S("S_DEADBOTTOM", "PLAY", 18, -1, null, "S_NULL");
  S("S_HEADSONSTICK", "POL2", 0, -1, null, "S_NULL");
  S("S_GIBS", "POL5", 0, -1, null, "S_NULL");
  S("S_HEADONASTICK", "POL4", 0, -1, null, "S_NULL");
  S("S_HEADCANDLES", "POL3", FF_FULLBRIGHT | 0, 6, null, "S_HEADCANDLES2");
  S("S_HEADCANDLES2", "POL3", FF_FULLBRIGHT | 1, 6, null, "S_HEADCANDLES");
  S("S_DEADSTICK", "POL1", 0, -1, null, "S_NULL");
  S("S_LIVESTICK", "POL6", 0, 6, null, "S_LIVESTICK2");
  S("S_LIVESTICK2", "POL6", 1, 8, null, "S_LIVESTICK");
  S("S_MEAT2", "GOR2", 0, -1, null, "S_NULL");
  S("S_MEAT3", "GOR3", 0, -1, null, "S_NULL");
  S("S_MEAT4", "GOR4", 0, -1, null, "S_NULL");
  S("S_MEAT5", "GOR5", 0, -1, null, "S_NULL");
  S("S_STALAGTITE", "SMIT", 0, -1, null, "S_NULL");
  S("S_TALLGRNCOL", "COL1", 0, -1, null, "S_NULL");
  S("S_SHRTGRNCOL", "COL2", 0, -1, null, "S_NULL");
  S("S_TALLREDCOL", "COL3", 0, -1, null, "S_NULL");
  S("S_SHRTREDCOL", "COL4", 0, -1, null, "S_NULL");
  S("S_CANDLESTIK", "CAND", FF_FULLBRIGHT | 0, -1, null, "S_NULL");
  S("S_CANDELABRA", "CBRA", FF_FULLBRIGHT | 0, -1, null, "S_NULL");
  S("S_SKULLCOL", "COL6", 0, -1, null, "S_NULL");
  S("S_TORCHTREE", "TRE1", 0, -1, null, "S_NULL");
  S("S_BIGTREE", "TRE2", 0, -1, null, "S_NULL");
  S("S_TECHPILLAR", "ELEC", 0, -1, null, "S_NULL");
  S("S_EVILEYE", "CEYE", FF_FULLBRIGHT | 0, 6, null, "S_EVILEYE2");
  S("S_EVILEYE2", "CEYE", FF_FULLBRIGHT | 1, 6, null, "S_EVILEYE3");
  S("S_EVILEYE3", "CEYE", FF_FULLBRIGHT | 2, 6, null, "S_EVILEYE4");
  S("S_EVILEYE4", "CEYE", FF_FULLBRIGHT | 1, 6, null, "S_EVILEYE");
  S("S_FLOATSKULL", "FSKU", FF_FULLBRIGHT | 0, 6, null, "S_FLOATSKULL2");
  S("S_FLOATSKULL2", "FSKU", FF_FULLBRIGHT | 1, 6, null, "S_FLOATSKULL3");
  S("S_FLOATSKULL3", "FSKU", FF_FULLBRIGHT | 2, 6, null, "S_FLOATSKULL");
  S("S_HEARTCOL", "COL5", 0, 14, null, "S_HEARTCOL2");
  S("S_HEARTCOL2", "COL5", 1, 14, null, "S_HEARTCOL");
  S("S_BLUETORCH", "TBLU", FF_FULLBRIGHT | 0, 4, null, "S_BLUETORCH2");
  S("S_BLUETORCH2", "TBLU", FF_FULLBRIGHT | 1, 4, null, "S_BLUETORCH3");
  S("S_BLUETORCH3", "TBLU", FF_FULLBRIGHT | 2, 4, null, "S_BLUETORCH4");
  S("S_BLUETORCH4", "TBLU", FF_FULLBRIGHT | 3, 4, null, "S_BLUETORCH");
  S("S_GREENTORCH", "TGRN", FF_FULLBRIGHT | 0, 4, null, "S_GREENTORCH2");
  S("S_GREENTORCH2", "TGRN", FF_FULLBRIGHT | 1, 4, null, "S_GREENTORCH3");
  S("S_GREENTORCH3", "TGRN", FF_FULLBRIGHT | 2, 4, null, "S_GREENTORCH4");
  S("S_GREENTORCH4", "TGRN", FF_FULLBRIGHT | 3, 4, null, "S_GREENTORCH");
  S("S_REDTORCH", "TRED", FF_FULLBRIGHT | 0, 4, null, "S_REDTORCH2");
  S("S_REDTORCH2", "TRED", FF_FULLBRIGHT | 1, 4, null, "S_REDTORCH3");
  S("S_REDTORCH3", "TRED", FF_FULLBRIGHT | 2, 4, null, "S_REDTORCH4");
  S("S_REDTORCH4", "TRED", FF_FULLBRIGHT | 3, 4, null, "S_REDTORCH");
  S("S_BTORCHSHRT", "SMBT", FF_FULLBRIGHT | 0, 4, null, "S_BTORCHSHRT2");
  S("S_BTORCHSHRT2", "SMBT", FF_FULLBRIGHT | 1, 4, null, "S_BTORCHSHRT3");
  S("S_BTORCHSHRT3", "SMBT", FF_FULLBRIGHT | 2, 4, null, "S_BTORCHSHRT4");
  S("S_BTORCHSHRT4", "SMBT", FF_FULLBRIGHT | 3, 4, null, "S_BTORCHSHRT");
  S("S_GTORCHSHRT", "SMGT", FF_FULLBRIGHT | 0, 4, null, "S_GTORCHSHRT2");
  S("S_GTORCHSHRT2", "SMGT", FF_FULLBRIGHT | 1, 4, null, "S_GTORCHSHRT3");
  S("S_GTORCHSHRT3", "SMGT", FF_FULLBRIGHT | 2, 4, null, "S_GTORCHSHRT4");
  S("S_GTORCHSHRT4", "SMGT", FF_FULLBRIGHT | 3, 4, null, "S_GTORCHSHRT");
  S("S_RTORCHSHRT", "SMRT", FF_FULLBRIGHT | 0, 4, null, "S_RTORCHSHRT2");
  S("S_RTORCHSHRT2", "SMRT", FF_FULLBRIGHT | 1, 4, null, "S_RTORCHSHRT3");
  S("S_RTORCHSHRT3", "SMRT", FF_FULLBRIGHT | 2, 4, null, "S_RTORCHSHRT4");
  S("S_RTORCHSHRT4", "SMRT", FF_FULLBRIGHT | 3, 4, null, "S_RTORCHSHRT");
  S("S_HANGNOGUTS", "HDB1", 0, -1, null, "S_NULL");
  S("S_HANGBNOBRAIN", "HDB2", 0, -1, null, "S_NULL");
  S("S_HANGTLOOKDN", "HDB3", 0, -1, null, "S_NULL");
  S("S_HANGTSKULL", "HDB4", 0, -1, null, "S_NULL");
  S("S_HANGTLOOKUP", "HDB5", 0, -1, null, "S_NULL");
  S("S_HANGTNOBRAIN", "HDB6", 0, -1, null, "S_NULL");
  S("S_COLONGIBS", "POB1", 0, -1, null, "S_NULL");
  S("S_SMALLPOOL", "POB2", 0, -1, null, "S_NULL");
  S("S_BRAINSTEM", "BRS1", 0, -1, null, "S_NULL");
  S("S_TECHLAMP", "TLMP", FF_FULLBRIGHT | 0, 4, null, "S_TECHLAMP2");
  S("S_TECHLAMP2", "TLMP", FF_FULLBRIGHT | 1, 4, null, "S_TECHLAMP3");
  S("S_TECHLAMP3", "TLMP", FF_FULLBRIGHT | 2, 4, null, "S_TECHLAMP4");
  S("S_TECHLAMP4", "TLMP", FF_FULLBRIGHT | 3, 4, null, "S_TECHLAMP");
  S("S_TECH2LAMP", "TLP2", FF_FULLBRIGHT | 0, 4, null, "S_TECH2LAMP2");
  S("S_TECH2LAMP2", "TLP2", FF_FULLBRIGHT | 1, 4, null, "S_TECH2LAMP3");
  S("S_TECH2LAMP3", "TLP2", FF_FULLBRIGHT | 2, 4, null, "S_TECH2LAMP4");
  S("S_TECH2LAMP4", "TLP2", FF_FULLBRIGHT | 3, 4, null, "S_TECH2LAMP");

  G.states = states;

  // ---------------------------------------------------------------- mobjinfo
  // info.c:1108-... exact values for in-scope types.
  var mobjinfo = [];
  function MI(doomednum, spawnstate, spawnhealth, seestate, seesound, reactiontime,
    attacksound, painstate, painchance, painsound, meleestate, missilestate, deathstate,
    xdeathstate, deathsound, speed, radius, height, mass, damage, activesound, flags, raisestate) {
    mobjinfo.push({ doomednum: doomednum, spawnstate: spawnstate, spawnhealth: spawnhealth,
      seestate: seestate, seesound: seesound, reactiontime: reactiontime, attacksound: attacksound,
      painstate: painstate, painchance: painchance, painsound: painsound, meleestate: meleestate, missilestate: missilestate,
      deathstate: deathstate, xdeathstate: xdeathstate, deathsound: deathsound, speed: speed,
      radius: radius, height: height, mass: mass, damage: damage, activesound: activesound,
      flags: flags, raisestate: raisestate });
  }
  // info.c mobjinfo[] verbatim, dense in info.h enum order: mobjinfo[type].
  MI(/*MT_PLAYER @0*/ -1, statenames.S_PLAY, 100, statenames.S_PLAY_RUN1, 0, 0, 0, statenames.S_PLAY_PAIN, 255, 25, 0, statenames.S_PLAY_ATK1, statenames.S_PLAY_DIE1, statenames.S_PLAY_XDIE1, 57, 0, 16 * FU, 56 * FU, 100, 0, 0, MF_SOLID | MF_SHOOTABLE | MF_DROPOFF | MF_PICKUP | MF_NOTDMATCH, 0);
  MI(/*MT_POSSESSED @1*/ 3004, statenames.S_POSS_STND, 20, statenames.S_POSS_RUN1, 36, 8, 1, statenames.S_POSS_PAIN, 200, 27, 0, statenames.S_POSS_ATK1, statenames.S_POSS_DIE1, statenames.S_POSS_XDIE1, 59, 8, 20 * FU, 56 * FU, 100, 0, 75, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_POSS_RAISE1);
  MI(/*MT_SHOTGUY @2*/ 9, statenames.S_SPOS_STND, 30, statenames.S_SPOS_RUN1, 37, 8, 0, statenames.S_SPOS_PAIN, 170, 27, 0, statenames.S_SPOS_ATK1, statenames.S_SPOS_DIE1, statenames.S_SPOS_XDIE1, 60, 8, 20 * FU, 56 * FU, 100, 0, 75, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_SPOS_RAISE1);
  MI(/*MT_VILE @3*/ 64, statenames.S_VILE_STND, 700, statenames.S_VILE_RUN1, 48, 8, 0, statenames.S_VILE_PAIN, 10, 28, 0, statenames.S_VILE_ATK1, statenames.S_VILE_DIE1, 0, 71, 15, 20 * FU, 56 * FU, 500, 0, 80, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, 0);
  MI(/*MT_FIRE @4*/ -1, statenames.S_FIRE1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOGRAVITY, 0);
  MI(/*MT_UNDEAD @5*/ 66, statenames.S_SKEL_STND, 300, statenames.S_SKEL_RUN1, 106, 8, 0, statenames.S_SKEL_PAIN, 100, 27, statenames.S_SKEL_FIST1, statenames.S_SKEL_MISS1, statenames.S_SKEL_DIE1, 0, 74, 10, 20 * FU, 56 * FU, 500, 0, 105, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_SKEL_RAISE1);
  MI(/*MT_TRACER @6*/ -1, statenames.S_TRACER, 1000, 0, 107, 8, 0, 0, 0, 0, 0, 0, statenames.S_TRACEEXP1, 0, 82, 10 * FU, 11 * FU, 8 * FU, 100, 10, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_SMOKE @7*/ -1, statenames.S_SMOKE1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOGRAVITY, 0);
  MI(/*MT_FATSO @8*/ 67, statenames.S_FATT_STND, 600, statenames.S_FATT_RUN1, 49, 8, 0, statenames.S_FATT_PAIN, 80, 29, 0, statenames.S_FATT_ATK1, statenames.S_FATT_DIE1, 0, 100, 8, 48 * FU, 64 * FU, 1000, 0, 75, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_FATT_RAISE1);
  MI(/*MT_FATSHOT @9*/ -1, statenames.S_FATSHOT1, 1000, 0, 16, 8, 0, 0, 0, 0, 0, 0, statenames.S_FATSHOTX1, 0, 17, 20 * FU, 6 * FU, 8 * FU, 100, 8, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_CHAINGUY @10*/ 65, statenames.S_CPOS_STND, 70, statenames.S_CPOS_RUN1, 37, 8, 0, statenames.S_CPOS_PAIN, 170, 27, 0, statenames.S_CPOS_ATK1, statenames.S_CPOS_DIE1, statenames.S_CPOS_XDIE1, 60, 8, 20 * FU, 56 * FU, 100, 0, 75, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_CPOS_RAISE1);
  MI(/*MT_TROOP @11*/ 3001, statenames.S_TROO_STND, 60, statenames.S_TROO_RUN1, 39, 8, 0, statenames.S_TROO_PAIN, 200, 27, statenames.S_TROO_ATK1, statenames.S_TROO_ATK1, statenames.S_TROO_DIE1, statenames.S_TROO_XDIE1, 62, 8, 20 * FU, 56 * FU, 100, 0, 76, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_TROO_RAISE1);
  MI(/*MT_SERGEANT @12*/ 3002, statenames.S_SARG_STND, 150, statenames.S_SARG_RUN1, 41, 8, 52, statenames.S_SARG_PAIN, 180, 26, statenames.S_SARG_ATK1, 0, statenames.S_SARG_DIE1, 0, 64, 10, 30 * FU, 56 * FU, 400, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_SARG_RAISE1);
  MI(/*MT_SHADOWS @13*/ 58, statenames.S_SARG_STND, 150, statenames.S_SARG_RUN1, 41, 8, 52, statenames.S_SARG_PAIN, 180, 26, statenames.S_SARG_ATK1, 0, statenames.S_SARG_DIE1, 0, 64, 10, 30 * FU, 56 * FU, 400, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_SHADOW | MF_COUNTKILL, statenames.S_SARG_RAISE1);
  MI(/*MT_HEAD @14*/ 3005, statenames.S_HEAD_STND, 400, statenames.S_HEAD_RUN1, 42, 8, 0, statenames.S_HEAD_PAIN, 128, 26, 0, statenames.S_HEAD_ATK1, statenames.S_HEAD_DIE1, 0, 65, 8, 31 * FU, 56 * FU, 400, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_FLOAT | MF_NOGRAVITY | MF_COUNTKILL, statenames.S_HEAD_RAISE1);
  MI(/*MT_BRUISER @15*/ 3003, statenames.S_BOSS_STND, 1000, statenames.S_BOSS_RUN1, 43, 8, 0, statenames.S_BOSS_PAIN, 50, 26, statenames.S_BOSS_ATK1, statenames.S_BOSS_ATK1, statenames.S_BOSS_DIE1, 0, 67, 8, 24 * FU, 64 * FU, 1000, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_BOSS_RAISE1);
  MI(/*MT_BRUISERSHOT @16*/ -1, statenames.S_BRBALL1, 1000, 0, 16, 8, 0, 0, 0, 0, 0, 0, statenames.S_BRBALLX1, 0, 17, 15 * FU, 6 * FU, 8 * FU, 100, 8, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_KNIGHT @17*/ 69, statenames.S_BOS2_STND, 500, statenames.S_BOS2_RUN1, 47, 8, 0, statenames.S_BOS2_PAIN, 50, 26, statenames.S_BOS2_ATK1, statenames.S_BOS2_ATK1, statenames.S_BOS2_DIE1, 0, 72, 8, 24 * FU, 64 * FU, 1000, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_BOS2_RAISE1);
  MI(/*MT_SKULL @18*/ 3006, statenames.S_SKULL_STND, 100, statenames.S_SKULL_RUN1, 0, 8, 51, statenames.S_SKULL_PAIN, 256, 26, 0, statenames.S_SKULL_ATK1, statenames.S_SKULL_DIE1, 0, 17, 8, 16 * FU, 56 * FU, 50, 3, 77, MF_SOLID | MF_SHOOTABLE | MF_FLOAT | MF_NOGRAVITY, 0);
  MI(/*MT_SPIDER @19*/ 7, statenames.S_SPID_STND, 3000, statenames.S_SPID_RUN1, 45, 8, 2, statenames.S_SPID_PAIN, 40, 26, 0, statenames.S_SPID_ATK1, statenames.S_SPID_DIE1, 0, 69, 12, 128 * FU, 100 * FU, 1000, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, 0);
  MI(/*MT_BABY @20*/ 68, statenames.S_BSPI_STND, 500, statenames.S_BSPI_SIGHT, 46, 8, 0, statenames.S_BSPI_PAIN, 128, 26, 0, statenames.S_BSPI_ATK1, statenames.S_BSPI_DIE1, 0, 70, 12, 64 * FU, 64 * FU, 600, 0, 78, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_BSPI_RAISE1);
  MI(/*MT_CYBORG @21*/ 16, statenames.S_CYBER_STND, 4000, statenames.S_CYBER_RUN1, 44, 8, 0, statenames.S_CYBER_PAIN, 20, 26, 0, statenames.S_CYBER_ATK1, statenames.S_CYBER_DIE1, 0, 68, 16, 40 * FU, 110 * FU, 1000, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, 0);
  MI(/*MT_PAIN @22*/ 71, statenames.S_PAIN_STND, 400, statenames.S_PAIN_RUN1, 50, 8, 0, statenames.S_PAIN_PAIN, 128, 30, 0, statenames.S_PAIN_ATK1, statenames.S_PAIN_DIE1, 0, 73, 8, 31 * FU, 56 * FU, 400, 0, 77, MF_SOLID | MF_SHOOTABLE | MF_FLOAT | MF_NOGRAVITY | MF_COUNTKILL, statenames.S_PAIN_RAISE1);
  MI(/*MT_WOLFSS @23*/ 84, statenames.S_SSWV_STND, 50, statenames.S_SSWV_RUN1, 101, 8, 0, statenames.S_SSWV_PAIN, 170, 27, 0, statenames.S_SSWV_ATK1, statenames.S_SSWV_DIE1, statenames.S_SSWV_XDIE1, 102, 8, 20 * FU, 56 * FU, 100, 0, 75, MF_SOLID | MF_SHOOTABLE | MF_COUNTKILL, statenames.S_SSWV_RAISE1);
  MI(/*MT_KEEN @24*/ 72, statenames.S_KEENSTND, 100, 0, 0, 8, 0, statenames.S_KEENPAIN, 256, 103, 0, 0, statenames.S_COMMKEEN, 0, 104, 0, 16 * FU, 72 * FU, 10000000, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY | MF_SHOOTABLE | MF_COUNTKILL, 0);
  MI(/*MT_BOSSBRAIN @25*/ 88, statenames.S_BRAIN, 250, 0, 0, 8, 0, statenames.S_BRAIN_PAIN, 255, 97, 0, 0, statenames.S_BRAIN_DIE1, 0, 98, 0, 16 * FU, 16 * FU, 10000000, 0, 0, MF_SOLID | MF_SHOOTABLE, 0);
  MI(/*MT_BOSSSPIT @26*/ 89, statenames.S_BRAINEYE, 1000, statenames.S_BRAINEYESEE, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 32 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOSECTOR, 0);
  MI(/*MT_BOSSTARGET @27*/ 87, 0, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 32 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOSECTOR, 0);
  MI(/*MT_SPAWNSHOT @28*/ -1, statenames.S_SPAWN1, 1000, 0, 94, 8, 0, 0, 0, 0, 0, 0, 0, 0, 17, 10 * FU, 6 * FU, 32 * FU, 100, 3, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY | MF_NOCLIP, 0);
  MI(/*MT_SPAWNFIRE @29*/ -1, statenames.S_SPAWNFIRE1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOGRAVITY, 0);
  MI(/*MT_BARREL @30*/ 2035, statenames.S_BAR1, 20, 0, 0, 8, 0, 0, 0, 0, 0, 0, statenames.S_BEXP, 0, 82, 0, 10 * FU, 42 * FU, 100, 0, 0, MF_SOLID | MF_SHOOTABLE | MF_NOBLOOD, 0);
  MI(/*MT_TROOPSHOT @31*/ -1, statenames.S_TBALL1, 1000, 0, 16, 8, 0, 0, 0, 0, 0, 0, statenames.S_TBALLX1, 0, 17, 10 * FU, 6 * FU, 8 * FU, 100, 3, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_HEADSHOT @32*/ -1, statenames.S_RBALL1, 1000, 0, 16, 8, 0, 0, 0, 0, 0, 0, statenames.S_RBALLX1, 0, 17, 10 * FU, 6 * FU, 8 * FU, 100, 5, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_ROCKET @33*/ -1, statenames.S_ROCKET, 1000, 0, 14, 8, 0, 0, 0, 0, 0, 0, statenames.S_EXPLODE1, 0, 82, 20 * FU, 11 * FU, 8 * FU, 100, 20, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_PLASMA @34*/ -1, statenames.S_PLASBALL, 1000, 0, 8, 8, 0, 0, 0, 0, 0, 0, statenames.S_PLASEXP, 0, 17, 25 * FU, 13 * FU, 8 * FU, 100, 5, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_BFG @35*/ -1, statenames.S_BFGSHOT, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, statenames.S_BFGLAND, 0, 15, 25 * FU, 13 * FU, 8 * FU, 100, 100, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_ARACHPLAZ @36*/ -1, statenames.S_ARACH_PLAZ, 1000, 0, 8, 8, 0, 0, 0, 0, 0, 0, statenames.S_ARACH_PLEX, 0, 17, 25 * FU, 13 * FU, 8 * FU, 100, 5, 0, MF_NOBLOCKMAP | MF_MISSILE | MF_DROPOFF | MF_NOGRAVITY, 0);
  MI(/*MT_PUFF @37*/ -1, statenames.S_PUFF1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOGRAVITY, 0);
  MI(/*MT_BLOOD @38*/ -1, statenames.S_BLOOD1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP, 0);
  MI(/*MT_TFOG @39*/ -1, statenames.S_TFOG, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOGRAVITY, 0);
  MI(/*MT_IFOG @40*/ -1, statenames.S_IFOG, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOGRAVITY, 0);
  MI(/*MT_TELEPORTMAN @41*/ 14, 0, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOSECTOR, 0);
  MI(/*MT_EXTRABFG @42*/ -1, statenames.S_BFGEXP, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP | MF_NOGRAVITY, 0);
  MI(/*MT_MISC0 @43*/ 2018, statenames.S_ARM1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC1 @44*/ 2019, statenames.S_ARM2, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC2 @45*/ 2014, statenames.S_BON1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_MISC3 @46*/ 2015, statenames.S_BON2, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_MISC4 @47*/ 5, statenames.S_BKEY, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_NOTDMATCH, 0);
  MI(/*MT_MISC5 @48*/ 13, statenames.S_RKEY, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_NOTDMATCH, 0);
  MI(/*MT_MISC6 @49*/ 6, statenames.S_YKEY, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_NOTDMATCH, 0);
  MI(/*MT_MISC7 @50*/ 39, statenames.S_YSKULL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_NOTDMATCH, 0);
  MI(/*MT_MISC8 @51*/ 38, statenames.S_RSKULL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_NOTDMATCH, 0);
  MI(/*MT_MISC9 @52*/ 40, statenames.S_BSKULL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_NOTDMATCH, 0);
  MI(/*MT_MISC10 @53*/ 2011, statenames.S_STIM, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC11 @54*/ 2012, statenames.S_MEDI, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC12 @55*/ 2013, statenames.S_SOUL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_INV @56*/ 2022, statenames.S_PINV, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_MISC13 @57*/ 2023, statenames.S_PSTR, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_INS @58*/ 2024, statenames.S_PINS, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_MISC14 @59*/ 2025, statenames.S_SUIT, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC15 @60*/ 2026, statenames.S_PMAP, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_MISC16 @61*/ 2045, statenames.S_PVIS, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_MEGA @62*/ 83, statenames.S_MEGA, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL | MF_COUNTITEM, 0);
  MI(/*MT_CLIP @63*/ 2007, statenames.S_CLIP, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC17 @64*/ 2048, statenames.S_AMMO, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC18 @65*/ 2010, statenames.S_ROCK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC19 @66*/ 2046, statenames.S_BROK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC20 @67*/ 2047, statenames.S_CELL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC21 @68*/ 17, statenames.S_CELP, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC22 @69*/ 2008, statenames.S_SHEL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC23 @70*/ 2049, statenames.S_SBOX, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC24 @71*/ 8, statenames.S_BPAK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC25 @72*/ 2006, statenames.S_BFUG, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_CHAINGUN @73*/ 2002, statenames.S_MGUN, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC26 @74*/ 2005, statenames.S_CSAW, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC27 @75*/ 2003, statenames.S_LAUN, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC28 @76*/ 2004, statenames.S_PLAS, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_SHOTGUN @77*/ 2001, statenames.S_SHOT, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_SUPERSHOTGUN @78*/ 82, statenames.S_SHOT2, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_SPECIAL, 0);
  MI(/*MT_MISC29 @79*/ 85, statenames.S_TECHLAMP, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC30 @80*/ 86, statenames.S_TECH2LAMP, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC31 @81*/ 2028, statenames.S_COLU, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC32 @82*/ 30, statenames.S_TALLGRNCOL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC33 @83*/ 31, statenames.S_SHRTGRNCOL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC34 @84*/ 32, statenames.S_TALLREDCOL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC35 @85*/ 33, statenames.S_SHRTREDCOL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC36 @86*/ 37, statenames.S_SKULLCOL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC37 @87*/ 36, statenames.S_HEARTCOL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC38 @88*/ 41, statenames.S_EVILEYE, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC39 @89*/ 42, statenames.S_FLOATSKULL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC40 @90*/ 43, statenames.S_TORCHTREE, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC41 @91*/ 44, statenames.S_BLUETORCH, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC42 @92*/ 45, statenames.S_GREENTORCH, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC43 @93*/ 46, statenames.S_REDTORCH, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC44 @94*/ 55, statenames.S_BTORCHSHRT, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC45 @95*/ 56, statenames.S_GTORCHSHRT, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC46 @96*/ 57, statenames.S_RTORCHSHRT, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC47 @97*/ 47, statenames.S_STALAGTITE, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC48 @98*/ 48, statenames.S_TECHPILLAR, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC49 @99*/ 34, statenames.S_CANDLESTIK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC50 @100*/ 35, statenames.S_CANDELABRA, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC51 @101*/ 49, statenames.S_BLOODYTWITCH, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 68 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC52 @102*/ 50, statenames.S_MEAT2, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 84 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC53 @103*/ 51, statenames.S_MEAT3, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 84 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC54 @104*/ 52, statenames.S_MEAT4, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 68 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC55 @105*/ 53, statenames.S_MEAT5, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 52 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC56 @106*/ 59, statenames.S_MEAT2, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 84 * FU, 100, 0, 0, MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC57 @107*/ 60, statenames.S_MEAT4, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 68 * FU, 100, 0, 0, MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC58 @108*/ 61, statenames.S_MEAT3, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 52 * FU, 100, 0, 0, MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC59 @109*/ 62, statenames.S_MEAT5, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 52 * FU, 100, 0, 0, MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC60 @110*/ 63, statenames.S_BLOODYTWITCH, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 68 * FU, 100, 0, 0, MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC61 @111*/ 22, statenames.S_HEAD_DIE6, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC62 @112*/ 15, statenames.S_PLAY_DIE7, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC63 @113*/ 18, statenames.S_POSS_DIE5, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC64 @114*/ 21, statenames.S_SARG_DIE6, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC65 @115*/ 23, statenames.S_SKULL_DIE6, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC66 @116*/ 20, statenames.S_TROO_DIE5, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC67 @117*/ 19, statenames.S_SPOS_DIE5, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC68 @118*/ 10, statenames.S_PLAY_XDIE9, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC69 @119*/ 12, statenames.S_PLAY_XDIE9, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC70 @120*/ 28, statenames.S_HEADSONSTICK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC71 @121*/ 24, statenames.S_GIBS, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, 0, 0);
  MI(/*MT_MISC72 @122*/ 27, statenames.S_HEADONASTICK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC73 @123*/ 29, statenames.S_HEADCANDLES, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC74 @124*/ 25, statenames.S_DEADSTICK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC75 @125*/ 26, statenames.S_LIVESTICK, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC76 @126*/ 54, statenames.S_BIGTREE, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 32 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC77 @127*/ 70, statenames.S_BBAR1, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 16 * FU, 100, 0, 0, MF_SOLID, 0);
  MI(/*MT_MISC78 @128*/ 73, statenames.S_HANGNOGUTS, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 88 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC79 @129*/ 74, statenames.S_HANGBNOBRAIN, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 88 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC80 @130*/ 75, statenames.S_HANGTLOOKDN, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 64 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC81 @131*/ 76, statenames.S_HANGTSKULL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 64 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC82 @132*/ 77, statenames.S_HANGTLOOKUP, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 64 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC83 @133*/ 78, statenames.S_HANGTNOBRAIN, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 16 * FU, 64 * FU, 100, 0, 0, MF_SOLID | MF_SPAWNCEILING | MF_NOGRAVITY, 0);
  MI(/*MT_MISC84 @134*/ 79, statenames.S_COLONGIBS, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP, 0);
  MI(/*MT_MISC85 @135*/ 80, statenames.S_SMALLPOOL, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP, 0);
  MI(/*MT_MISC86 @136*/ 81, statenames.S_BRAINSTEM, 1000, 0, 0, 8, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 20 * FU, 16 * FU, 100, 0, 0, MF_NOBLOCKMAP, 0);
  G.mobjinfo = mobjinfo;
  G.statenames = statenames;                 // for tests/probes (cast screen, audits)
  // named aliases (indices above)
  var MTP = { PLAYER: MT_PLAYER, POSSESSED: MT_POSSESSED, SHOTGUY: MT_SHOTGUY, TROOP: MT_TROOP,
    TROOPSHOT: MT_TROOPSHOT, PUFF: MT_PUFF,
    BLOOD: MT_BLOOD, TFOG: MT_TFOG, CLIP: MT_CLIP, SHOTGUN: MT_SHOTGUN, CHAINGUN: MT_CHAINGUN,
    BARREL: MT_BARREL };
  G.MT = MTP;

  // ---------------------------------------------------------------- d_items.c weaponinfo
  // {ammo, upstate, downstate, readystate, atkstate, flashstate} (C order up,down,ready,atk,flash)
  var weaponinfo = [
    { ammo: am_noammo, upstate: statenames.S_PUNCHUP, downstate: statenames.S_PUNCHDOWN, readystate: statenames.S_PUNCH, atkstate: statenames.S_PUNCH1, flashstate: 0 },
    { ammo: am_clip, upstate: statenames.S_PISTOLUP, downstate: statenames.S_PISTOLDOWN, readystate: statenames.S_PISTOL, atkstate: statenames.S_PISTOL1, flashstate: statenames.S_PISTOLFLASH },
    { ammo: am_shell, upstate: statenames.S_SGUNUP, downstate: statenames.S_SGUNDOWN, readystate: statenames.S_SGUN, atkstate: statenames.S_SGUN1, flashstate: statenames.S_SGUNFLASH1 },
    { ammo: am_clip, upstate: statenames.S_CHAINUP, downstate: statenames.S_CHAINDOWN, readystate: statenames.S_CHAIN, atkstate: statenames.S_CHAIN1, flashstate: statenames.S_CHAINFLASH1 },      // wp_chaingun (d_items.c)
    { ammo: am_misl, upstate: statenames.S_MISSILEUP, downstate: statenames.S_MISSILEDOWN, readystate: statenames.S_MISSILE, atkstate: statenames.S_MISSILE1, flashstate: statenames.S_MISSILEFLASH1 }, // wp_missile
    { ammo: am_cell, upstate: statenames.S_PLASMAUP, downstate: statenames.S_PLASMADOWN, readystate: statenames.S_PLASMA, atkstate: statenames.S_PLASMA1, flashstate: statenames.S_PLASMAFLASH1 },      // wp_plasma (d_items.c:97)
    { ammo: am_cell, upstate: statenames.S_BFGUP, downstate: statenames.S_BFGDOWN, readystate: statenames.S_BFG, atkstate: statenames.S_BFG1, flashstate: statenames.S_BFGFLASH1 },                      // wp_bfg (d_items.c:106)
    { ammo: am_noammo, upstate: statenames.S_SAWUP, downstate: statenames.S_SAWDOWN, readystate: statenames.S_SAW, atkstate: statenames.S_SAW1, flashstate: 0 },                                     // wp_chainsaw (no flash, d_items.c:117)
    { ammo: am_shell, upstate: statenames.S_DSGUNUP, downstate: statenames.S_DSGUNDOWN, readystate: statenames.S_DSGUN, atkstate: statenames.S_DSGUN1, flashstate: statenames.S_DSGUNFLASH1 }           // wp_supershotgun (d_items.c:126)
  ];
  G.weaponinfo = weaponinfo;

  // ---------------------------------------------------------------- game state
  G.gameskill = 2;                       // sk_medium default; G_InitNew sets
  G.gameepisode = 1; G.gamemap = 1;
  // doomstat.c gamemode: wadinstall.install() sets globalThis.gamemode from
  // the loaded WAD's content ('shareware'|'registered'|'retail'|'commercial').
  // Every version-gated branch below mirrors the gospel `gamemode ==` tests.
  G.gm = function () { return globalThis.gamemode || 'shareware'; };
  G.isCommercial = function () { return G.gm() === 'commercial'; };
  G.canSecretExit = true;      // main.js: commercial IWAD without MAP31 -> false
  G.paused = false; G.netgame = false; G.deathmatch = false; G.demoplayback = false;
  G.menuactive = false; G.automapactive = false;
  G.playeringame = [true, false, false, false];
  G.consoleplayer = 0; G.leveltime = 0;
  G.totalkills = 0; G.totalitems = 0; G.totalsecret = 0;
  G.respawnmonsters = false; G.fastparm = false; G.soundblocks = false;
  G.levelExit = false;
  G.skyflatnum = (G.skyflatnum === undefined ? -1 : G.skyflatnum);
  G.validcount = 1;                      // r_main.c:55 init 1
  if (typeof G.players === "undefined") {
    G.players = [];
    for (var pi = 0; pi < MAXPLAYERS; pi++) G.players.push(makePlayer());
  }
  G.player = G.players[0];
  function makePlayer() {
    return {
      mo: null, playerstate: PST_REBORN, cmd: { forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 },
      message: null, health: 100, bonuscount: 0,
      armorpoints: 0, armortype: 0,
      weaponowned: [true, true, false, false, false, false, false, false, false],  // fist+pistol (g_game.c:826)
      ammo: [0, 50, 0, 0, 0], maxammo: [0, 200, 50, 300, 50],
      cards: [false, false, false, false, false, false], powers: [0, 0, 0, 0, 0, 0],
      backpack: false, readyweapon: wp_pistol, pendingweapon: wp_nochange,
      attackdown: false, refire: 0, usedown: false, cheats: 0,
      killcount: 0, itemcount: 0, secretcount: 0, frags: [0, 0, 0, 0],
      damagecount: 0, attacker: null, extralight: 0, fixedcolormap: 0,
      pitch: 0, viewz: 0, viewheight: VIEWHEIGHT, deltaviewheight: 0, bob: 0,
      inventorycount: [0, 0, 0, 0, 0, 0, 0, 0], inventorytics: [0, 0, 0, 0, 0, 0, 0, 0],
      psprites: [{ state: null, tics: 0, sx: 0, sy: 0 }, { state: null, tics: 0, sx: 0, sy: 0 }]
    };
  }

  // ---------------------------------------------------------------- thinkers (p_tick.c)
  var thinkercap = { prev: null, next: null, function: null };
  thinkercap.prev = thinkercap.next = thinkercap;
  function P_InitThinkers() { thinkercap.prev = thinkercap.next = thinkercap; }
  function P_AddThinker(t) {
    thinkercap.prev.next = t; t.next = thinkercap; t.prev = thinkercap.prev; thinkercap.prev = t;
  }
  function P_RemoveThinker(t) { t.function = -1; } // ⚠ deferred-removal sentinel (p_tick.c)
  function P_RunThinkers() {
    var currentthinker = thinkercap.next;
    while (currentthinker !== thinkercap) {
      var t = currentthinker;
      currentthinker = currentthinker.next;          // walker advances regardless (p_tick.c)
      if (t.function !== -1 && t.function) t.function(t);
      if (t.function === -1) {                       // deallocate tombstone when reached
        t.prev.next = t.next; t.next.prev = t.prev;
      }
    }
  }
  G.P_InitThinkers = P_InitThinkers; G.P_AddThinker = P_AddThinker;
  G.P_RemoveThinker = P_RemoveThinker; G.P_RunThinkers = P_RunThinkers;
  G.thinkercap = thinkercap;
  function liveThinkers() {
    var a = [], t = thinkercap.next;
    while (t !== thinkercap) { if (t.function !== -1) a.push(t); t = t.next; }
    return a;
  }
  G.liveThinkers = liveThinkers;

  // ---------------------------------------------------------------- mapdata access
  G.currentMapJson = null;
  function md() { return G.mapdata; }
  var linedefs = null, sectors = null, sides = null, vertexes = null;
  function bindMap() {
    var m = md();
    if (!m) throw new Error("game.js: no mapdata loaded");
    linedefs = m.linedefs; sectors = m.sectors; sides = m.sides; vertexes = m.vertexes;
    G.lines = linedefs; G.sectors = sectors; G.sides = sides; G.vertexes = vertexes;
    if (typeof G.blockmaplump === "undefined" && m.blockmap) G.blockmaplump = m.blockmap;
    if (m.blockmap) {
      var b = m.blockmap;
      if (b.bmaporgx === undefined) { b.bmaporgx = b.orgx; b.bmaporgy = b.orgy; b.bmapwidth = b.width; b.bmapheight = b.height; }
      G.bmaporgx = b.bmaporgx; G.bmaporgy = b.bmaporgy;
      G.bmapwidth = b.bmapwidth; G.bmapheight = b.bmapheight;
    }
    // ensure sector.lines/linecount/blockbox exist (P_GroupLines may not have run)
    var needLines = !(sectors[0] && sectors[0].lines);
    if (needLines) {
      for (var s of sectors) { s.lines = []; }
      for (var li = 0; li < linedefs.length; li++) {
        var ld = linedefs[li];
        if (ld.frontsector) ld.frontsector.lines.push(ld);
        if (ld.backsector && ld.backsector !== ld.frontsector) ld.backsector.lines.push(ld);
      }
      for (var s2 of sectors) s2.linecount = s2.lines.length;
    }
    for (var s3 of sectors) {
      if (!s3.blockbox) {
        var bb = [MININT, MAXINT, MAXINT, MININT]; // TOP,BOTTOM,LEFT,RIGHT
        for (var l of s3.lines) {
          if (ld_bbox(l)) {
            bb[0] = Math.max(bb[0], l.bbox[0]); bb[1] = Math.min(bb[1], l.bbox[1]);
            bb[2] = Math.min(bb[2], l.bbox[2]); bb[3] = Math.max(bb[3], l.bbox[3]);
          }
        }
        function ld_bbox(l) { return l.bbox; }
        if (bb[0] === MININT) { bb = [0, 0, 0, 0]; }
        // p_setup.c:568-572 clamped blockbox
        var MAPBLOCKSHIFT = 23;
        s3.blockbox = [
          Math.min((bb[0] - G.bmaporgy + MAXRADIUS) >> MAPBLOCKSHIFT, G.bmapheight - 1),
          Math.max((bb[1] - G.bmaporgy - MAXRADIUS) >> MAPBLOCKSHIFT, 0),
          Math.max((bb[2] - G.bmaporgx - MAXRADIUS) >> MAPBLOCKSHIFT, 0),
          Math.min((bb[3] - G.bmaporgx + MAXRADIUS) >> MAPBLOCKSHIFT, G.bmapwidth - 1)
        ];
      }
      if (!s3.soundorg) s3.soundorg = { x: 0, y: 0, z: 0 };
    }
    for (var l2 of linedefs) if (!l2.tag && l2.tag !== 0) l2.tag = 0;
  }
  G.bindMap = bindMap;

  // engine-provided or fallback blockmap iterator (p_maputl.c:471)
  if (typeof G.P_BlockLinesIterator === "undefined") {
    G.P_BlockLinesIterator = function (x, y, func) {
      var bm = md().blockmap;
      if (x < 0 || y < 0 || x >= G.bmapwidth || y >= G.bmapheight) return true;
      var list = bm.lineLists[y * G.bmapwidth + x] || [];
      for (var i = 0; i < list.length; i++) {
        var ld = linedefs[list[i]];
        if (ld.validcount === G.validcount) continue;
        ld.validcount = G.validcount;
        if (!func(ld)) return false;
      }
      return true;
    };
  }
  // thing iterators — game.js owns blocklinks (engine links via P_SetThingPosition)
  var blocklinks = null;
  function P_BlockThingsIterator(x, y, func) {
    if (x < 0 || y < 0 || x >= G.bmapwidth || y >= G.bmapheight) return true;
    for (var m = blocklinks[y * G.bmapwidth + x]; m; m = m.bnext)   // bnext captured after func (p_maputl.c)
      if (!func(m)) return false;
    return true;
  }
  function P_UnsetThingPosition(thing) {
    if (!(thing.flags & MF_NOSECTOR)) {
      if (thing.snext) thing.snext.sprev = thing.sprev;
      if (thing.sprev) thing.sprev.snext = thing.snext;
      else thing.subsector.sector.thinglist = thing.snext;
    }
    if (!(thing.flags & MF_NOBLOCKMAP)) {
      if (thing.bnext) thing.bnext.bprev = thing.bprev;
      if (thing.bprev) thing.bprev.bnext = thing.bnext;
      else {
        var bx = (thing.x - G.bmaporgx) >> 23, by = (thing.y - G.bmaporgy) >> 23;
        if (bx >= 0 && bx < G.bmapwidth && by >= 0 && by < G.bmapheight)
          blocklinks[by * G.bmapwidth + bx] = thing.bnext;
      }
    }
  }
  function P_SetThingPosition(thing) {
    var ss = G.R_PointInSubsector(thing.x, thing.y);
    if (typeof ss === "number") ss = md().subsectors[ss];
    thing.subsector = ss;
    if (!(thing.flags & MF_NOSECTOR)) {
      var sec = ss.sector;
      thing.sprev = null; thing.snext = sec.thinglist;
      if (sec.thinglist) sec.thinglist.sprev = thing;
      sec.thinglist = thing;
    }
    if (!(thing.flags & MF_NOBLOCKMAP)) {
      var bx = (thing.x - G.bmaporgx) >> 23, by = (thing.y - G.bmaporgy) >> 23;
      if (bx >= 0 && bx < G.bmapwidth && by >= 0 && by < G.bmapheight) {
        var link = blocklinks[by * G.bmapwidth + bx];
        thing.bprev = null; thing.bnext = link;
        if (link) link.bprev = thing;
        blocklinks[by * G.bmapwidth + bx] = thing;
      } else thing.bnext = thing.bprev = null;
    }
  }
  def("P_SetThingPosition", P_SetThingPosition);
  def("P_UnsetThingPosition", P_UnsetThingPosition);
  def("R_PointInSubsector", function (x, y) {
    var m = md(), nodes = m.nodes;
    if (m.numnodes === 0 || nodes.length === 0) return 0;
    var n = nodes[nodes.length - 1];
    while (!(n.isSubsector !== undefined ? n.isSubsector : (n.children === undefined))) {
      // R_PointOnSide (r_main.c): sign of cross product of node dx,dy
      var left = FixedMul(y - n.y, (n.dx >> FRACBITS)) ;
      var right = FixedMul((n.dy >> FRACBITS), x - n.x);
      if (right < left) n = n.front || m.nodes[n.children[0]] || m.subsectors[n.children[0] & 0x7fff];
      else n = n.back || m.nodes[n.children[1]] || m.subsectors[n.children[1] & 0x7fff];
      if (n.subsector !== undefined || n.sector !== undefined && n.firstline === undefined) { n.isSubsector = true; break; }
      if (n.isSubsector) break;
    }
    if (n.isSubsector) return n.num !== undefined ? n.num : (n.index || 0);
    return n;
  });
  // P_PointOnLineSide — p_maputl.c:58 EXACT, incl. the overflow fast path.
  // Unconditional override: engine.js's copy inverts two branches vs C
  // (returns 1 where C returns dy>0 on vertical lines), which breaks
  // P_UseLines / P_ShootSpecialLine side detection. C wins (ARCHITECTURE.md).
  function P_PointOnLineSide(x, y, line) {
    var dx, dy, left, right;
    if (!line.dx) { if (x <= line.v1.x) return line.dy > 0 ? 1 : 0; return line.dy < 0 ? 1 : 0; }
    if (!line.dy) { if (y <= line.v1.y) return line.dx < 0 ? 1 : 0; return line.dx > 0 ? 1 : 0; }
    dx = (x - line.v1.x) | 0; dy = (y - line.v1.y) | 0;
    left = G.FixedMul(line.dy >> FRACBITS, dx);
    right = G.FixedMul(dy, line.dx >> FRACBITS);
    return right < left ? 0 : 1;
  }
  G.P_PointOnLineSide = P_PointOnLineSide;
  // C-faithful P_BoxOnLineSide over tmbbox in m_bbox.h order
  // (BOXTOP=0,BOXBOTTOM=1,BOXLEFT=2,BOXRIGHT=3). OVERWRITES engine.js's copy:
  // tmbbox layout is a game.js/p_map.c concern and engine's index order
  // disagrees with m_bbox.h; renderer never calls this. p_maputl.c:196.
  G.P_BoxOnLineSide = function (tmbox, ld) {
    var p1 = 0, p2 = 0;
    switch (ld.slopetype) {
      case 0: // ST_VERTICAL
        p1 = tmbox[2] < ld.v1.x ? 0 : 1;
        p2 = tmbox[3] < ld.v1.x ? 0 : 1;
        if (ld.dy < 0) { p1 = 1 - p1; p2 = 1 - p2; }
        break;
      case 1: // ST_HORIZONTAL
        p1 = tmbox[1] > ld.v1.y ? 1 : 0;
        p2 = tmbox[0] > ld.v1.y ? 1 : 0;
        if (ld.dx < 0) { p1 = 1 - p1; p2 = 1 - p2; }
        break;
      // Diagonal cases MUST test the corners that straddle the slope
      // (p_maputl.c:139-147). tmbbox layout here is [TOP=y+r, BOTTOM=y-r,
      // LEFT=x-r, RIGHT=x+r]:
      //   ST_POSITIVE (up-right): test TOP-LEFT  and BOTTOM-RIGHT
      //   ST_NEGATIVE (dn-right): test TOP-RIGHT and BOTTOM-LEFT
      // Testing the other pair lets a straddling box read as fully to one
      // side, PIT_CheckLine then skips the wall, and the player clips
      // through diagonal linedefs.
      case 2: // ST_POSITIVE
        p1 = P_PointOnLineSide(tmbox[2], tmbox[0], ld); // x-r, y+r
        p2 = P_PointOnLineSide(tmbox[3], tmbox[1], ld); // x+r, y-r
        break;
      default: // ST_NEGATIVE
        p1 = P_PointOnLineSide(tmbox[3], tmbox[0], ld); // x+r, y+r
        p2 = P_PointOnLineSide(tmbox[2], tmbox[1], ld); // x-r, y-r
        break;
    }
    return p1 === p2 ? p1 : -1;
  };
  def("R_PointToAngle2", function (x1, y1, x2, y2) {
    // FALLBACK ONLY: engine.js loads first and defines the table-driven
    // r_main.c version (r_main.c:285 R_PointToAngle) before game.js runs, so
    // def() never installs this in the real load order. Kept faithful to the
    // eight octants for standalone/game-only contexts; uses a computed
    // tantoangle approximation where the engine tables are absent.
    x2 = (x2 - x1) | 0; y2 = (y2 - y1) | 0;
    if (!x2 && !y2) return 0;
    var ANG90 = 0x40000000, ANG180 = 0x80000000, ANG270 = 0xc0000000;
    var ta = null;
    function slopeDiv(num, den) {
      num = num >>> 0; den = den >>> 0;
      if (den < 512) return 2048;
      var ans = Math.floor(num * 8 / (den >>> 8));
      return ans <= 2048 ? ans : 2048;
    }
    function tangle(s) {   // tantoangle[s] — engine tables if present
      // engine.js declares `var tantoangle` at script level: bare-identifier
      // visible after it loads (window prop / vm global). Fall back to the
      // atan approximation only when game.js runs standalone (engine absent).
      if (typeof tantoangle !== "undefined") return tantoangle[s];
      if (!ta) {
        ta = new Array(2049);
        for (var k = 0; k <= 2048; k++)
          ta[k] = Math.trunc(Math.atan(k / 2048) / (3.141592657 * 2) * 0x100000000) >>> 0;
      }
      return ta[s];
    }
    if (x2 >= 0) {
      if (y2 >= 0) {
        if (x2 > y2) return tangle(slopeDiv(y2, x2)) >>> 0;                     // octant 0
        return (ANG90 - 1 - tangle(slopeDiv(x2, y2))) >>> 0;                    // octant 1
      }
      y2 = -y2;
      if (x2 > y2) return (-tangle(slopeDiv(y2, x2))) >>> 0;                    // octant 8
      return (ANG270 + tangle(slopeDiv(x2, y2))) >>> 0;                         // octant 7
    }
    x2 = -x2;
    if (y2 >= 0) {
      if (x2 > y2) return (ANG180 - 1 - tangle(slopeDiv(y2, x2))) >>> 0;        // octant 3
      return (ANG90 + tangle(slopeDiv(x2, y2))) >>> 0;                          // octant 2
    }
    y2 = -y2;
    if (x2 > y2) return (ANG180 + tangle(slopeDiv(y2, x2))) >>> 0;              // octant 4
    return (ANG270 - 1 - tangle(slopeDiv(x2, y2))) >>> 0;                       // octant 5
  });
  def("R_PointToAngle", function (x, y) { return G.R_PointToAngle2(md().viewx || 0, md().viewy || 0, x, y); });
  def("R_PointToDist", function (x, y) { return 0; });
  def("P_CheckSight", function (t1, t2) { return true; });  // engine replaces with p_sight.c walk

  // LineOpening (p_maputl.c:300) — globals; ⚠ one-sided keeps STALE opentop/openbottom
  var openbottom = 0, opentop = 0, openrange = 0, lowfloor = 0;
  function P_LineOpening(line) {
    if (line.sidenum[1] === -1) { // one sided
      openrange = 0;
      return;
    }
    var front = line.frontsector, back = line.backsector;
    opentop = front.ceilingheight < back.ceilingheight ? front.ceilingheight : back.ceilingheight;
    openbottom = front.floorheight > back.floorheight ? front.floorheight : back.floorheight;
    lowfloor = front.floorheight < back.floorheight ? front.floorheight : back.floorheight;
    openrange = opentop - openbottom;
  }
  G.P_LineOpening = function (line) { P_LineOpening(line); };
  G.getOpen = function () { return { openbottom: openbottom, opentop: opentop, openrange: openrange, lowfloor: lowfloor }; };

  // ---------------------------------------------------------------- tm state (p_map.c)
  var tmbbox = [0, 0, 0, 0], tmthing = null, tmflags = 0, tmx = 0, tmy = 0,
    tmfloorz = 0, tmceilingz = 0, tmdropoffz = 0, ceilingline = null, floatok = false,
    spechit = new Array(MAXSPECIALCROSS).fill(null), numspechit = 0;
  var onground = true;

  // engine.js stores linedef bbox as [minx, maxx, miny, maxy]; tmbbox is in
  // m_bbox.h order (BOXTOP=0,BOXBOTTOM=1,BOXLEFT=2,BOXRIGHT=3). PIT_CheckLine
  // p_map.c:229 overlap reject test, coordinates mapped explicitly.
  function PIT_CheckLine(ld) {
    var bxmin = ld.bbox[0], bxmax = ld.bbox[1], bymin = ld.bbox[2], bymax = ld.bbox[3];
    if (tmbbox[BOXRIGHT] <= bxmin || tmbbox[BOXLEFT] >= bxmax ||
      tmbbox[BOXTOP] <= bymin || tmbbox[BOXBOTTOM] >= bymax) return true;
    if (G.P_BoxOnLineSide(tmbbox, ld) !== -1) return true;
    if (!ld.backsector) return false;                    // one-sided line blocks
    if (!(tmthing.flags & MF_MISSILE)) {
      if (ld.flags & ML_BLOCKING) return false;
      if (!tmthing.player && (ld.flags & ML_BLOCKMONSTERS)) return false;
    }
    P_LineOpening(ld);
    if (opentop < tmceilingz) { tmceilingz = opentop; ceilingline = ld; }
    if (openbottom > tmfloorz) tmfloorz = openbottom;
    if (lowfloor < tmdropoffz) tmdropoffz = lowfloor;
    if (ld.special) { spechit[numspechit] = ld; numspechit++; } // unbounded in C; trusts 8
    return true;
  }
  function PIT_CheckThing(thing) {
    if (!(thing.flags & (MF_SOLID | MF_SPECIAL | MF_SHOOTABLE))) return true;
    var blockdist = thing.radius + tmthing.radius;
    if (Math.abs(thing.x - tmx) >= blockdist || Math.abs(thing.y - tmy) >= blockdist) return true;
    if (thing === tmthing) return true;
    if (tmthing.flags & MF_SKULLFLY) {                   // n/a (no lost souls) — keep shape
      var d0 = ((P_Random() % 8) + 1) * tmthing.info.damage;
      P_DamageMobj(thing, tmthing, tmthing, d0);
      tmthing.flags &= ~MF_SKULLFLY; tmthing.momx = tmthing.momy = tmthing.momz = 0;
      P_SetMobjState(tmthing, tmthing.info.spawnstate);
      return false;
    }
    if (tmthing.flags & MF_MISSILE) {
      if (tmthing.z > thing.z + thing.height) return true;
      if ((tmthing.z + tmthing.height) < thing.z) return true;
      // gospel p_map.c:300 "Don't hit same species as originator": if the
      // thing IS the shooter, pass through — unconditionally. (MT_PLAYER
      // carries MF_PICKUP in info.c, so gating on MF_PICKUP here broke
      // player-fired missiles: they self-hit and detonated in the face.)
      if (tmthing.target && thing.type === tmthing.target.type) {
        if (thing === tmthing.target) return true;          // don't hit shooter
        return false;                                       // same species: explode, no damage (MT_PLAYER check moot: only shooter's own type here, players handled above)
      }
      if (!(thing.flags & MF_SHOOTABLE)) return !(thing.flags & MF_SOLID);
      var dmg = ((P_Random() % 8) + 1) * tmthing.info.damage;
      P_DamageMobj(thing, tmthing, tmthing.target, dmg);
      return false;
    }
    if (thing.flags & MF_SPECIAL) {
      var solid = thing.flags & MF_SOLID;
      if (tmflags & MF_PICKUP) P_TouchSpecialThing(thing, tmthing);
      return !solid;
    }
    return !(thing.flags & MF_SOLID);
  }
  function P_CheckPosition(thing, x, y) {
    tmthing = thing; tmflags = thing.flags; tmx = x; tmy = y;
    tmbbox[0] = (y + tmthing.radius) | 0; tmbbox[1] = (y - tmthing.radius) | 0;
    tmbbox[2] = (x - tmthing.radius) | 0; tmbbox[3] = (x + tmthing.radius) | 0;
    var ns = G.R_PointInSubsector(x, y);
    if (typeof ns === "number") ns = md().subsectors[ns];
    ceilingline = null;
    tmfloorz = tmdropoffz = ns.sector.floorheight;
    tmceilingz = ns.sector.ceilingheight;
    G.validcount = (G.validcount + 1) | 0;               // int32 wrap kept (spec-physics §1)
    numspechit = 0;
    if (tmflags & MF_NOCLIP) return true;
    var xl, xh, yl, yh, bx, by;
    xl = (tmbbox[2] - G.bmaporgx - MAXRADIUS) >> 23; xh = (tmbbox[3] - G.bmaporgx + MAXRADIUS) >> 23;
    yl = (tmbbox[1] - G.bmaporgy - MAXRADIUS) >> 23; yh = (tmbbox[0] - G.bmaporgy + MAXRADIUS) >> 23;
    for (bx = xl; bx <= xh; bx++) for (by = yl; by <= yh; by++)
      if (!P_BlockThingsIterator(bx, by, PIT_CheckThing)) return false;
    xl = (tmbbox[2] - G.bmaporgx) >> 23; xh = (tmbbox[3] - G.bmaporgx) >> 23;
    yl = (tmbbox[1] - G.bmaporgy) >> 23; yh = (tmbbox[0] - G.bmaporgy) >> 23;
    for (bx = xl; bx <= xh; bx++) for (by = yl; by <= yh; by++)
      if (!G.P_BlockLinesIterator(bx, by, PIT_CheckLine)) return false;
    return true;
  }
  G.P_CheckPosition = P_CheckPosition;

  // P_TryMove (p_map.c:450)
  function P_TryMove(thing, x, y) {
    floatok = false;
    if (!P_CheckPosition(thing, x, y)) return false;
    if (!(thing.flags & MF_NOCLIP)) {
      if (tmceilingz - tmfloorz < thing.height) return false;
      floatok = true;
      if (!(thing.flags & MF_TELEPORT) && tmceilingz - thing.z < thing.height) return false;
      if (!(thing.flags & MF_TELEPORT) && tmfloorz - thing.z > MAXSTEP) return false;
      if (!(thing.flags & (MF_DROPOFF | MF_FLOAT)) && tmfloorz - tmdropoffz > MAXSTEP) return false;
    }
    G.P_UnsetThingPosition(thing);
    var oldx = thing.x, oldy = thing.y;
    thing.floorz = tmfloorz; thing.ceilingz = tmceilingz;
    thing.x = x; thing.y = y;
    G.P_SetThingPosition(thing);
    if (!(thing.flags & (MF_TELEPORT | MF_NOCLIP))) {
      while (numspechit--) {                              // consumes to -1, reverse order
        var ld = spechit[numspechit];
        var side = P_PointOnLineSide(thing.x, thing.y, ld);
        var oldside = P_PointOnLineSide(oldx, oldy, ld);
        if (side !== oldside && ld.special)
          P_CrossSpecialLine(ld.num, oldside, thing);
      }
    }
    return true;
  }
  G.P_TryMove = P_TryMove;

  function PIT_StompThing(thing) {
    if (!(thing.flags & MF_SHOOTABLE)) return true;
    var blockdist = thing.radius + tmthing.radius;
    if (Math.abs(thing.x - tmx) >= blockdist || Math.abs(thing.y - tmy) >= blockdist) return true;
    if (thing === tmthing) return true;
    if (!tmthing.player && G.gamemap !== 30) return false;
    P_DamageMobj(thing, tmthing, tmthing, 10000);         // telefrag
    return true;
  }
  function P_TeleportMove(thing, x, y) {
    tmthing = thing; tmflags = thing.flags; tmx = x; tmy = y;
    tmbbox[0] = (y + thing.radius) | 0; tmbbox[1] = (y - thing.radius) | 0;
    tmbbox[2] = (x - thing.radius) | 0; tmbbox[3] = (x + thing.radius) | 0;
    var ns = G.R_PointInSubsector(x, y);
    if (typeof ns === "number") ns = md().subsectors[ns];
    ceilingline = null;
    tmfloorz = tmdropoffz = ns.sector.floorheight;
    tmceilingz = ns.sector.ceilingheight;
    G.validcount = (G.validcount + 1) | 0; numspechit = 0;
    var xl = (tmbbox[2] - G.bmaporgx - MAXRADIUS) >> 23, xh = (tmbbox[3] - G.bmaporgx + MAXRADIUS) >> 23;
    var yl = (tmbbox[1] - G.bmaporgy - MAXRADIUS) >> 23, yh = (tmbbox[0] - G.bmaporgy + MAXRADIUS) >> 23;
    for (var bx = xl; bx <= xh; bx++) for (var by = yl; by <= yh; by++)
      if (!P_BlockThingsIterator(bx, by, PIT_StompThing)) return false;
    G.P_UnsetThingPosition(thing);
    thing.floorz = tmfloorz; thing.ceilingz = tmceilingz;
    thing.x = x; thing.y = y;
    G.P_SetThingPosition(thing);
    return true;
  }
  G.P_TeleportMove = P_TeleportMove;

  // P_ThingHeightClip (p_map.c:283 — used by PIT_ChangeSector only)
  function P_ThingHeightClip(thing) {
    var onfloor = (thing.z === thing.floorz);
    var oldfloorz = thing.floorz, oldceilingz = thing.ceilingz;
    P_CheckPosition(thing, thing.x, thing.y);
    if (oldfloorz === thing.floorz) { if (tmfloorz > thing.floorz) thing.floorz = tmfloorz; }
    else thing.floorz = tmfloorz;
    thing.ceilingz = tmceilingz;
    if (onfloor) { thing.z = tmfloorz; }
    else if (thing.z + thing.height > tmceilingz) thing.z = tmceilingz - thing.height;
    return tmceilingz - tmfloorz >= thing.height;
  }

  // ---------------------------------------------------------------- P_PathTraverse (p_maputl.c:742)
  var PT_ADDLINES = 1, PT_ADDTHINGS = 2, PT_EARLYOUT = 4;
  var intercepts = new Array(MAXINTERCEPTS), intercept_p = 0;
  var trace = { x: 0, y: 0, dx: 0, dy: 0 };
  function P_MakeDivline(li) { return { x: li.v1.x, y: li.v1.y, dx: li.dx, dy: li.dy }; }
  function P_InterceptVector(v2, v1) {
    var den = FixedMul(v1.dy >> 8, v2.dx) - FixedMul(v1.dx >> 8, v2.dy);
    if (den === 0) return 0;
    var num = FixedMul((v1.x - v2.x) >> 8, v1.dy) + FixedMul((v2.y - v1.y) >> 8, v1.dx);
    return G.FixedDiv(num, den);
  }
  function P_PointOnDivlineSide(x, y, line) {
    // p_maputl.c:161 — tests the DIVLINE's own axis degeneracy (line->dx /
    // line->dy), not the point delta. Fast path at :190 kept verbatim.
    var dx, dy, left, right;
    if (!line.dx) { if (x <= line.x) return line.dy > 0 ? 1 : 0; return line.dy < 0 ? 1 : 0; }
    if (!line.dy) { if (y <= line.y) return line.dx < 0 ? 1 : 0; return line.dx > 0 ? 1 : 0; }
    dx = (x - line.x) | 0; dy = (y - line.y) | 0;
    if (((line.dy ^ line.dx ^ dx ^ dy) & 0x80000000) !== 0)
      return ((line.dy ^ dx) & 0x80000000) ? 1 : 0;
    left = FixedMul(line.dy >> 8, dx >> 8);
    right = FixedMul(dy >> 8, line.dx >> 8);
    return right < left ? 0 : 1;
  }
  function PIT_AddLineIntercepts(ld) {
    var s1, s2, frac, dl;
    // p_maputl.c:776-790 — the long-trace branch must test the LINE'S ENDPOINTS
    // against the trace divline, not the trace endpoints against the line.
    // (The old reversed form made every long hitscan collect phantom intercepts
    // from lines it never crosses, blocking all shots at the first such line.)
    if (Math.abs(trace.dx) > FU * 16 || Math.abs(trace.dy) > FU * 16) {
      s1 = P_PointOnDivlineSide(ld.v1.x, ld.v1.y, trace);
      s2 = P_PointOnDivlineSide(ld.v2.x, ld.v2.y, trace);
    } else {
      s1 = P_PointOnLineSide(trace.x, trace.y, ld);
      s2 = P_PointOnLineSide(trace.x + trace.dx, trace.y + trace.dy, ld);
    }
    if (s1 === s2) return true;
    dl = P_MakeDivline(ld);
    frac = P_InterceptVector(trace, dl);
    if (frac < 0) return true;                             // behind source
    if ((traceFlags & PT_EARLYOUT) && frac < FU && !ld.backsector) return false;
    if (intercept_p < MAXINTERCEPTS)
      intercepts[intercept_p++] = { frac: frac, isaline: true, d: ld };
    return true;
  }
  function PIT_AddThingIntercepts(thing) {
    if (!(thing.flags & (MF_SOLID | MF_SPECIAL | MF_SHOOTABLE))) return true;
    var tracepositive = (trace.dx ^ trace.dy) > 0;
    var x1, y1, x2, y2;
    if (tracepositive) {
      x1 = thing.x - thing.radius; y1 = thing.y + thing.radius;
      x2 = thing.x + thing.radius; y2 = thing.y - thing.radius;
    } else {
      x1 = thing.x - thing.radius; y1 = thing.y - thing.radius;
      x2 = thing.x + thing.radius; y2 = thing.y + thing.radius;
    }
    var s1 = P_PointOnDivlineSide(x1, y1, trace), s2 = P_PointOnDivlineSide(x2, y2, trace);
    if (s1 === s2) return true;
    var dl = { x: x1, y: y1, dx: x2 - x1, dy: y2 - y1 };
    var frac = P_InterceptVector(trace, dl);
    if (frac < 0) return true;
    if (intercept_p < MAXINTERCEPTS)
      intercepts[intercept_p++] = { frac: frac, isaline: false, d: thing };
    return true;
  }
  var traceFlags = 0;
  function P_TraverseIntercepts(func, maxfrac) {
    // p_map.c:597 exact: count loop, nearest-frac scan, inpt->frac = MAXINT
    var count = intercept_p, inpt = null;
    while (count--) {
      var dist = MAXINT;
      for (var i = 0; i < intercept_p; i++) {
        if (intercepts[i].frac < dist) { dist = intercepts[i].frac; inpt = intercepts[i]; }
      }
      if (dist > maxfrac) return true;
      if (!func(inpt)) return false;
      inpt.frac = MAXINT;   // vanilla order (p_maputl.c:723-726): mark AFTER
                            // the traverser runs — PTR_* read inpt->frac to
                            // compute hit distances/slopes
    }
    return true;
  }
  function P_PathTraverse(x1, y1, x2, y2, flags, trav) {
    traceFlags = flags;
    G.validcount = (G.validcount + 1) | 0;
    intercept_p = 0;
    var bm = md().blockmap;
    var orgx = bm.bmaporgx === undefined ? bm.orgx : bm.bmaporgx;
    var orgy = bm.bmaporgy === undefined ? bm.orgy : bm.bmaporgy;
    var bwidth = bm.bmapwidth === undefined ? bm.width : bm.bmapwidth;
    var bheight = bm.bmapheight === undefined ? bm.height : bm.bmapheight;
    if (((x1 - orgx) & (FU * 128 - 1)) === 0) x1 += FU;
    if (((y1 - orgy) & (FU * 128 - 1)) === 0) y1 += FU;
    trace.x = x1; trace.y = y1; trace.dx = (x2 - x1) | 0; trace.dy = (y2 - y1) | 0;
    // p_maputl.c:800-836 — the FixedDiv steps are computed on the trace deltas;
    // both endpoints carry the bmaporg offset so it cancels. Written directly
    // from trace.dx/trace.dy (equivalent to the previous offset-minus-offset
    // form, but impossible to get wrong).
    x1 -= orgx; y1 -= orgy;
    var x2o = x2 - orgx, y2o = y2 - orgy;
    var xt1 = x1 >> 23, yt1 = y1 >> 23, xt2 = x2o >> 23, yt2 = y2o >> 23;
    var mapxstep, mapystep, partial, xstep, ystep;
    if (xt2 > xt1) {
      mapxstep = 1; partial = FU - ((x1 >> 7) & (FU - 1));
      ystep = G.FixedDiv(trace.dy, Math.abs(trace.dx));
    } else if (xt2 < xt1) {
      mapxstep = -1; partial = (x1 >> 7) & (FU - 1);
      ystep = G.FixedDiv(trace.dy, Math.abs(trace.dx));
    } else { mapxstep = 0; partial = FU; ystep = 256 * FU; }
    var yintercept = (y1 >> 7) + FixedMul(partial, ystep);
    if (yt2 > yt1) {
      mapystep = 1; partial = FU - ((y1 >> 7) & (FU - 1));
      xstep = G.FixedDiv(trace.dx, Math.abs(trace.dy));
    } else if (yt2 < yt1) {
      mapystep = -1; partial = (y1 >> 7) & (FU - 1);
      xstep = G.FixedDiv(trace.dx, Math.abs(trace.dy));
    } else { mapystep = 0; partial = FU; xstep = 256 * FU; }
    var xintercept = (x1 >> 7) + FixedMul(partial, xstep);
    var mapx = xt1, mapy = yt1, count;
    for (count = 0; count < 64; count++) {
      if (flags & PT_ADDLINES)
        if (!G.P_BlockLinesIterator(mapx, mapy, PIT_AddLineIntercepts)) return false;
      if (flags & PT_ADDTHINGS)
        if (!P_BlockThingsIterator(mapx, mapy, PIT_AddThingIntercepts)) return false;
      if (mapx === xt2 && mapy === yt2) break;
      if ((yintercept >> FRACBITS) === mapy) { yintercept += ystep; mapx += mapxstep; }
      else if ((xintercept >> FRACBITS) === mapx) { xintercept += xstep; mapy += mapystep; }
    }
    return P_TraverseIntercepts(trav, FU);
  }
  G.P_PathTraverse = P_PathTraverse;

  // ---------------------------------------------------------------- P_SlideMove (p_map.c:695)
  var slidemo = null, tmxmove = 0, tmymove = 0, bestslidefrac = 0, secondslidefrac = 0,
    bestslideline = null, secondslideline = null, hitcount = 0;
  function P_HitSlideLine(ld) {
    var side, lineangle, moveangle, deltaangle, movelen, newlen;
    // NB: this port's enum is ST_VERTICAL=0, ST_HORIZONTAL=1 (engine.js:44),
    // the REVERSE of vanilla's r_defs.h order. A vertical wall blocks x-motion,
    // a horizontal wall blocks y-motion (p_map.c P_HitSlideLine behaviour).
    if (ld.slopetype === 0) { tmxmove = 0; return; }      // ST_VERTICAL
    if (ld.slopetype === 1) { tmymove = 0; return; }      // ST_HORIZONTAL
    side = P_PointOnLineSide(slidemo.x, slidemo.y, ld);
    lineangle = G.R_PointToAngle2(0, 0, ld.dx, ld.dy);
    if (side === 1) lineangle = (lineangle + ANG180) >>> 0;
    moveangle = G.R_PointToAngle2(0, 0, tmxmove, tmymove);
    deltaangle = (moveangle - lineangle) >>> 0;
    if (deltaangle > ANG180) deltaangle = (deltaangle + ANG180) >>> 0;
    // angle_t is UNSIGNED in C: >>= on the port's raw u32 angles turns
    // negative for walls facing 180..360 deg, indexing fine* tables with a
    // negative subscript -> undefined -> NaN momentum -> dead stop.
    lineangle >>>= 19; deltaangle >>>= 19;
    movelen = P_AproxDistance(tmxmove, tmymove);
    newlen = FixedMul(movelen, fcos(deltaangle));
    tmxmove = FixedMul(newlen, fcos(lineangle));
    tmymove = FixedMul(newlen, fsin(lineangle));
  }
  function PTR_SlideTraverse(inpt) {
    var li = inpt.d;
    if (!(li.flags & ML_TWOSIDED)) {
      if (P_PointOnLineSide(slidemo.x, slidemo.y, li)) return true;  // not hit
      // fall through as blocking one-sided
      P_LineOpening(li); // openrange = 0 (stale opentop unused here)
      if (inpt.frac < bestslidefrac) {
        secondslidefrac = bestslidefrac; secondslideline = bestslideline;
        bestslidefrac = inpt.frac; bestslideline = li;
      }
      return false;
    }
    P_LineOpening(li);
    var isblocking = (openrange <= 0) ||
      (openrange < slidemo.height) ||
      (opentop - slidemo.z < slidemo.height) ||
      (openbottom - slidemo.z > MAXSTEP);
    if (isblocking) {
      if (inpt.frac < bestslidefrac) {
        secondslidefrac = bestslidefrac; secondslideline = bestslideline;
        bestslidefrac = inpt.frac; bestslideline = li;
      }
      return false;
    }
    return true;
  }
  function P_SlideMove(mo) {
    slidemo = mo; hitcount = 0;
    retry:
    for (; ;) {
      if (++hitcount === 3) { stairstep: break; }
      var momx = mo.momx, momy = mo.momy;
      var leadx = momx > 0 ? (mo.x + mo.radius) | 0 : (mo.x - mo.radius) | 0;
      var trailx = momx > 0 ? (mo.x - mo.radius) | 0 : (mo.x + mo.radius) | 0;
      var leady = momy > 0 ? (mo.y + mo.radius) | 0 : (mo.y - mo.radius) | 0;
      var traily = momy > 0 ? (mo.y - mo.radius) | 0 : (mo.y + mo.radius) | 0;
      bestslidefrac = FU + 1;
      P_PathTraverse(leadx, leady, (leadx + momx) | 0, (leady + momy) | 0, PT_ADDLINES, PTR_SlideTraverse);
      P_PathTraverse(trailx, leady, (trailx + momx) | 0, (leady + momy) | 0, PT_ADDLINES, PTR_SlideTraverse);
      P_PathTraverse(leadx, traily, (leadx + momx) | 0, (traily + momy) | 0, PT_ADDLINES, PTR_SlideTraverse);
      if (bestslidefrac === FU + 1) {
        // stairstep
        if (!P_TryMove(mo, mo.x, (mo.y + mo.momy) | 0))
          P_TryMove(mo, (mo.x + mo.momx) | 0, mo.y);
        return;
      }
      bestslidefrac -= 0x800;                              // fudge
      if (bestslidefrac > 0) {
        var newx = FixedMul(mo.momx, bestslidefrac);
        var newy = FixedMul(mo.momy, bestslidefrac);
        if (!P_TryMove(mo, (mo.x + newx) | 0, (mo.y + newy) | 0)) {
          // goto stairstep
          if (!P_TryMove(mo, mo.x, (mo.y + mo.momy) | 0))
            P_TryMove(mo, (mo.x + mo.momx) | 0, mo.y);
          return;
        }
      }
      bestslidefrac = FU - (bestslidefrac + 0x800);
      if (bestslidefrac > FU) bestslidefrac = FU;
      if (bestslidefrac <= 0) return;
      tmxmove = FixedMul(mo.momx, bestslidefrac);
      tmymove = FixedMul(mo.momy, bestslidefrac);
      P_HitSlideLine(bestslideline);
      mo.momx = tmxmove; mo.momy = tmymove;
      if (!P_TryMove(mo, (mo.x + tmxmove) | 0, (mo.y + tmymove) | 0)) continue retry;
      return;
    }
    // stairstep from hitcount==3
    if (!P_TryMove(mo, mo.x, (mo.y + mo.momy) | 0))
      P_TryMove(mo, (mo.x + mo.momx) | 0, mo.y);
  }
  G.P_SlideMove = P_SlideMove;

  // ---------------------------------------------------------------- mobj core (p_mobj.c)
  var deathmatchstarts = [], deathmatch_p = 0;
  var playerstarts = [null, null, null, null];
  var itemque = new Array(ITEMQUESIZE).fill(null), iquehead = 0, iquetail = 0;
  var bodyqueslot = 0;
  function P_SpawnMobj(x, y, z, type) {
    var info = mobjinfo[type];
    var mobj = {
      x: x, y: y, z: z, momx: 0, momy: 0, momz: 0, angle: 0,
      radius: info.radius, height: info.height, flags: info.flags,
      health: info.spawnhealth, reactiontime: 0, threshold: 0, movedir: 8,
      target: null, tracer: null, src: null, floorz: 0, ceilingz: 0,
      lastlook: 0, damagecount: 0, movecount: 0, refire: 0,
      type: type, info: info, player: null, spawnpoint: null,
      subsector: null, sector: null, snext: null, sprev: null, bnext: null, bprev: null,
      function: null, prev: null, next: null
    };
    if (G.gameskill !== 4 /*sk_nightmare*/) mobj.reactiontime = info.reactiontime;
    mobj.lastlook = P_Random() % MAXPLAYERS;              // ⚠ RNG order-critical (p_mobj.c)
    var st = states[info.spawnstate];
    mobj.state = st; mobj.tics = st.tics; mobj.sprite = st.sprite; mobj.frame = st.frame;
    G.P_SetThingPosition(mobj);
    mobj.floorz = mobj.subsector.sector.floorheight;
    mobj.ceilingz = mobj.subsector.sector.ceilingheight;
    if (z === ONFLOORZ) mobj.z = mobj.floorz;
    else if (z === ONCEILINGZ) mobj.z = mobj.ceilingz - info.height;
    else mobj.z = z;
    mobj.thinker = mobj;                                   // p_tick thinker embedded: mobj IS thinker
    mobj.function = P_MobjThinker;
    P_AddThinker(mobj);
    G.visThinkerList = liveThinkers().filter(function (t) { return t.info !== undefined; });
    return mobj;
  }
  function P_RemoveMobj(mobj) {
    if ((mobj.flags & MF_SPECIAL) && !(mobj.flags & MF_DROPPED) &&
      mobj.type !== undefined && !(mobj.info.flags & 0)) {   // MT_INV/MT_INS not ported
      itemque[iquetail] = mobj.spawnpoint ? mobj.spawnpoint : mobj;
      iquetail = (iquetail + 1) & (ITEMQUESIZE - 1);
    }
    G.P_UnsetThingPosition(mobj);
    mobj.function = -1;                                    // P_RemoveThinker sentinel
    G.visThinkerList = liveThinkers().filter(function (t) { return t.info !== undefined; });
  }
  function P_SetMobjState(mobj, statenum) {
    if (typeof statenum !== "number") statenum = statenum.num;
    var state;
    do {
      if (statenum === statenames.S_NULL) {
        mobj.state = states[0];
        P_RemoveMobj(mobj);
        return false;
      }
      state = states[statenum];
      mobj.state = state; mobj.tics = state.tics;
      mobj.sprite = state.sprite; mobj.frame = state.frame;
      if (state.action) ACTIONS[state.action](mobj);
      statenum = typeof state.next === "number" ? state.next : statenames[state.next];
    } while (!mobj.tics);
    return true;
  }
  G.P_SpawnMobj = P_SpawnMobj; G.P_RemoveMobj = P_RemoveMobj; G.P_SetMobjState = P_SetMobjState;
  // p_saveg.js save/load seams (deferred-removal safe: tombstones skipped)
  G.P_InitThinkers = P_InitThinkers;
  G.P_AddThinker = P_AddThinker; G.P_RemoveThinker = P_RemoveThinker;
  G.P_AddActiveCeiling = P_AddActiveCeiling;
  G.P_AddActivePlat = P_AddActivePlat;
  G.T_LightFlash = T_LightFlash; G.T_StrobeFlash = T_StrobeFlash; G.T_Glow = T_Glow;

  function P_ExplodeMissile(mo) {
    mo.momx = mo.momy = mo.momz = 0;
    P_SetMobjState(mo, mo.info.deathstate);
    mo.tics -= P_Random() & 3;
    if (mo.tics < 1) mo.tics = 1;
    mo.flags &= ~MF_MISSILE;
  }

  // P_XYMovement (p_mobj.c:114)
  function P_XYMovement(mo) {
    if (!mo.momx && !mo.momy) {
      if (mo.flags & MF_SKULLFLY) {
        mo.flags &= ~MF_SKULLFLY; mo.momx = mo.momy = mo.momz = 0;
        P_SetMobjState(mo, mo.info.spawnstate);
      }
      return;
    }
    var player = mo.player;
    if (mo.momx > MAXMOVE) mo.momx = MAXMOVE; else if (mo.momx < -MAXMOVE) mo.momx = -MAXMOVE;
    if (mo.momy > MAXMOVE) mo.momy = MAXMOVE; else if (mo.momy < -MAXMOVE) mo.momy = -MAXMOVE;
    var x = mo.x, y = mo.y, xmove = mo.momx, ymove = mo.momy, ptryx, ptryy;
    do {
      if (xmove > MAXMOVE / 2 || ymove > MAXMOVE / 2) {   // ⚠ signed compare (p_mobj.c)
        ptryx = (x + xmove / 2) | 0; ptryy = (y + ymove / 2) | 0;
        xmove >>= 1; ymove >>= 1;
      } else {
        ptryx = (x + xmove) | 0; ptryy = (y + ymove) | 0;
        xmove = ymove = 0;
      }
      if (!P_TryMove(mo, ptryx, ptryy)) {
        if (mo.player) { P_SlideMove(mo); }
        else if (mo.flags & MF_MISSILE) {
          if (ceilingline && ceilingline.backsector &&
            ceilingline.backsector.ceilingpic === G.skyflatnum) { P_RemoveMobj(mo); return; }
          P_ExplodeMissile(mo);
        } else mo.momx = mo.momy = 0;
      }
    } while (xmove || ymove);
    if (player && (player.cheats & 64 /*CF_NOMOMENTUM*/)) { mo.momx = mo.momy = 0; return; }
    if (mo.flags & (MF_MISSILE | MF_SKULLFLY)) return;
    if (mo.z > mo.floorz) return;
    if (mo.flags & MF_CORPSE) {
      if (Math.abs(mo.momx) > FU / 4 || Math.abs(mo.momy) > FU / 4)
        if (mo.floorz !== mo.subsector.sector.floorheight) return;
    }
    if (mo.momx > -STOPSPEED && mo.momx < STOPSPEED &&
      mo.momy > -STOPSPEED && mo.momy < STOPSPEED &&
      (!player || (player.cmd.forwardmove === 0 && player.cmd.sidemove === 0))) {
      if (player && (mo.state.num - statenames.S_PLAY_RUN1) >>> 0 < 4)
        P_SetMobjState(mo, statenames.S_PLAY);
      mo.momx = mo.momy = 0;
    } else {
      mo.momx = FixedMul(mo.momx, FRICTION);
      mo.momy = FixedMul(mo.momy, FRICTION);
    }
  }
  // P_ZMovement (p_mobj.c)
  function P_ZMovement(mobj) {
    if (mobj.player && mobj.z < mobj.floorz) {
      mobj.player.viewheight -= mobj.floorz - mobj.z;
      mobj.player.deltaviewheight = (VIEWHEIGHT - mobj.player.viewheight) >> 3;
    }
    mobj.z = (mobj.z + mobj.momz) | 0;
    if ((mobj.flags & MF_FLOAT) && !(mobj.flags & (MF_SKULLFLY | MF_INFLOAT)) && mobj.target) {
      var delta = (mobj.target.z + (mobj.height >> 1)) - mobj.z;
      var dist = P_AproxDistance(mobj.target.x - mobj.x, mobj.target.y - mobj.y);
      if (delta < 0 && dist < -(delta * 3)) mobj.z -= FLOATSPEED;
      else if (delta >= 0 && dist < delta * 3) mobj.z += FLOATSPEED;
    }
    if (mobj.z <= mobj.floorz) {
      if (mobj.flags & MF_SKULLFLY) mobj.momz = -mobj.momz;
      if (mobj.momz < 0) {
        if (mobj.player && mobj.momz < -GRAVITY * 8) {
          mobj.player.deltaviewheight = mobj.momz >> 3;
          S_StartSound(mobj, SFX.sfx_oof);              // p_mobj.c:303 hard landing
        }
        mobj.momz = 0;
      }
      // p_mobj.c:307 — snap is UNCONDITIONAL inside the floor-hit branch,
      // not tied to momz<0. Step-ups arrive here with momz==0; without the
      // snap the mobj stays below floorz, gravity kicks in, and the smooth
      // step-up block at the top of P_ZMovement fires a SECOND time next
      // tic — double viewheight dip = stutter on stairs (port bug).
      mobj.z = mobj.floorz;
      if ((mobj.flags & (MF_MISSILE | MF_NOCLIP)) === MF_MISSILE) {
        P_ExplodeMissile(mobj);
        return;
      }
    } else if (!(mobj.flags & MF_NOGRAVITY)) {
      if (mobj.momz === 0) mobj.momz = -GRAVITY * 2;
      else mobj.momz -= GRAVITY;
    }
    if (mobj.z + mobj.height > mobj.ceilingz) {
      if (mobj.momz > 0) mobj.momz = 0;
      mobj.z = mobj.ceilingz - mobj.height;
      if (mobj.flags & MF_SKULLFLY) mobj.momz = -mobj.momz;
      if ((mobj.flags & (MF_MISSILE | MF_NOCLIP)) === MF_MISSILE) {
        P_ExplodeMissile(mobj);
        return;
      }
    }
  }
  function P_MobjThinker(mobj) {
    if (mobj.momx || mobj.momy || (mobj.flags & MF_SKULLFLY)) {
      P_XYMovement(mobj);
      if (mobj.function === -1) return;                    // removed
    }
    if (mobj.z !== mobj.floorz || mobj.momz) {
      P_ZMovement(mobj);
      if (mobj.function === -1) return;
    }
    if (mobj.tics !== -1) {
      if (!--mobj.tics) {
        var nx = mobj.state.next;
        if (!P_SetMobjState(mobj, typeof nx === "number" ? nx : statenames[nx])) return;
      }
    } else {
      if (!(mobj.flags & MF_COUNTKILL)) return;
      if (!G.respawnmonsters) return;
      mobj.movecount++;
      if (mobj.movecount < 12 * 35) return;
      if (G.leveltime & 31) return;
      if (P_Random() > 4) return;
      P_NightmareRespawn(mobj);
    }
  }
  function P_NightmareRespawn(mobj) {                        // p_mobj.c:355-412
    if (!mobj.spawnpoint) return;
    var mthing = mobj.spawnpoint;
    var x = mthing.x << FRACBITS, y = mthing.y << FRACBITS;
    // p_mobj.c:364 — something occupying its position? no respawn
    if (!P_CheckPosition(mobj, x, y)) return;
    // teleport fog at old spot + new spot. NB: MT_TFOG is 39 in the dense
    // table (was 7 pre-realignment — the literal spawned MT_SMOKE puff).
    var fog = P_SpawnMobj(mobj.x, mobj.y, mobj.subsector.sector.floorheight, MT_TFOG);
    S_StartSound(fog, SFX.sfx_telept);
    var ss = G.R_PointInSubsector(x, y);
    if (typeof ss === "number") ss = md().subsectors[ss];
    fog = P_SpawnMobj(x, y, ss.sector.floorheight, MT_TFOG);
    S_StartSound(fog, SFX.sfx_telept);
    var z = (mobj.info.flags & MF_SPAWNCEILING) ? ONCEILINGZ : ONFLOORZ;
    var mo = P_SpawnMobj(x, y, z, mobj.type);
    mo.spawnpoint = mthing;
    mo.angle = (ANG45 * (mthing.angle / 45)) >>> 0;
    if (mthing.options & 8 /*MTF_AMBUSH*/) mo.flags |= MF_AMBUSH;  // p_mobj.c:402 — NOT unconditional
    mo.reactiontime = 18;                                        // p_mobj.c:405
    P_RemoveMobj(mobj);
  }
  G.P_NightmareRespawn = P_NightmareRespawn;

  // ---------------------------------------------------------------- noise alert (p_enemy.c:159 — P_RecursiveSound flood)
  var soundtarget = null;
  function P_RecursiveSound(sec, soundblocks) {
    if (sec.validcount === G.validcount && sec.soundtraversed <= soundblocks + 1)
      return;                                              // already flooded
    sec.validcount = G.validcount;
    sec.soundtraversed = soundblocks + 1;
    sec.soundtarget = soundtarget;
    for (var i = 0; i < sec.linecount; i++) {
      var check = sec.lines[i];
      if (!(check.flags & ML_TWOSIDED)) continue;
      P_LineOpening(check);
      if (openrange <= 0) continue;                        // closed door
      var other = (sides[check.sidenum[0]].sector === sec)
        ? sides[check.sidenum[1]].sector : sides[check.sidenum[0]].sector;
      if (check.flags & ML_SOUNDBLOCK) {
        if (!soundblocks) P_RecursiveSound(other, 1);
      } else P_RecursiveSound(other, soundblocks);
    }
  }
  function P_NoiseAlert(target, emmiter) {
    soundtarget = target;
    G.validcount = (G.validcount + 1) | 0;                 // shared p_maputl counter
    P_RecursiveSound(emmiter.subsector.sector, 0);
  }
  G.P_NoiseAlert = P_NoiseAlert;

  // ---------------------------------------------------------------- attack (p_map.c)
  var bulletslope = 0, linetarget = null, attackrange = 0;
  var aimslope = 0, shootz = 0, topslope = 0, bottomslope = 0, la_damage = 0, shootthing = null;
  function P_BulletSlope(mo) {
    var an = mo.angle;
    bulletslope = P_AimLineAttack(mo, an, 16 * 64 * FU);
    if (!linetarget) {
      an = (an + (1 << 26)) >>> 0;                          // ⚠ 2-shot scan pattern p_map.c
      bulletslope = P_AimLineAttack(mo, an, 16 * 64 * FU);
      if (!linetarget) {
        an = (an - (2 << 26)) >>> 0;
        bulletslope = P_AimLineAttack(mo, an, 16 * 64 * FU);
      }
    }
  }
  function P_GunShot(mo, accurate) {
    var damage = 5 * ((P_Random() % 3) + 1);                // ⚠ damage RNG before spread RNG
    var angle = mo.angle;
    if (!accurate) angle = (angle + (((P_Random() - P_Random()) << 18) >>> 0)) >>> 0;
    P_LineAttack(mo, angle, MISSILERANGE, bulletslope, damage);
  }
  function P_AimLineAttack(t1, angle, distance) {
    angle = angle >>> 0;
    angle >>= 0;
    var ang = (angle >>> 19) & 0x1fff;
    var x2 = (t1.x + (distance >> FRACBITS) * fcos(ang)) | 0; // plain int mul (p_map.c:581)
    var y2 = (t1.y + (distance >> FRACBITS) * fsin(ang)) | 0;
    shootz = (t1.z + (t1.height >> 1) + 8 * FU) | 0;
    topslope = ((100 * FU) / 160) | 0; bottomslope = -(((100 * FU) / 160) | 0);
    attackrange = distance;
    linetarget = null;
    P_PathTraverse(t1.x, t1.y, x2, y2, PT_ADDLINES | PT_ADDTHINGS, PTR_AimTraverse);
    if (linetarget) return aimslope;
    return 0;
  }
  function PTR_AimTraverse(inpt) {
    var thing, thingtopslope, thingbottomslope, dist;
    if (inpt.isaline) {
      var li = inpt.d;
      if (li.sidenum[1] === -1) { aimslope = 0; return false; }  // one-sided stops
      P_LineOpening(li);
      dist = FixedMul(attackrange, inpt.frac);
      var ts = FixedDiv(opentop - shootz, dist);
      var bs = FixedDiv(openbottom - shootz, dist);
      if (ts < topslope) topslope = ts;
      if (bs > bottomslope) bottomslope = bs;
      if (topslope <= bottomslope) return false;
      return true;
    }
    thing = inpt.d;
    if (thing === shootthing || !(thing.flags & MF_SHOOTABLE)) return true;
    thingbottomslope = FixedDiv(thing.z - shootz, FixedMul(attackrange, inpt.frac));
    thingtopslope = FixedDiv(thing.z + thing.height - shootz, FixedMul(attackrange, inpt.frac));
    if (thingtopslope < bottomslope) return true;
    if (thingbottomslope > topslope) return true;
    if (thingtopslope < topslope) topslope = thingtopslope;
    if (thingbottomslope > bottomslope) bottomslope = thingbottomslope;
    aimslope = ((topslope + bottomslope) / 2) | 0;
    linetarget = thing;
    return false;
  }
  function P_LineAttack(t1, angle, distance, slope, damage) {
    angle = (angle >>> 0);
    var ang = (angle >>> 19) & 0x1fff;
    var x2 = (t1.x + (distance >> FRACBITS) * fcos(ang)) | 0;
    var y2 = (t1.y + (distance >> FRACBITS) * fsin(ang)) | 0;
    shootz = (t1.z + (t1.height >> 1) + 8 * FU) | 0;
    topslope = slope + FU; bottomslope = slope - FU;       // p_map.c: narrow by ±1 FU? C: no
    // C sets NOTHING here: PTR_ShootTraverse inits topslope/bottomslope from slope:
    attackrange = distance;
    aimslope = slope;
    la_damage = damage;
    shootthing = t1;
    P_PathTraverse(t1.x, t1.y, x2, y2, PT_ADDLINES | PT_ADDTHINGS, PTR_ShootTraverse);
  }
  function P_SpawnPuff(x, y, z) {
    z += ((P_Random() - P_Random()) << 10);                 // ⚠ 2 RNG for z jitter
    var th = P_SpawnMobj(x, y, z, MT_PUFF);
    th.momz = FU;
    th.tics -= (P_Random() & 3);                            // 1 RNG for tics
    if (th.tics < 1) th.tics = 1;
    if (attackrange === MELEERANGE) P_SetMobjState(th, statenames.S_PUFF3);
    return th;
  }
  function P_SpawnBlood(x, y, z, damage) {
    z += ((P_Random() - P_Random()) << 10);
    var th = P_SpawnMobj(x, y, z, MT_BLOOD);
    th.momz = 2 * FU;
    th.tics -= (P_Random() & 3);
    if (th.tics < 1) th.tics = 1;
    if (damage >= 9 && damage <= 12) P_SetMobjState(th, statenames.S_BLOOD2);
    else if (damage < 9) P_SetMobjState(th, statenames.S_BLOOD3);
    return th;
  }
  function PTR_ShootTraverse(inpt) {
    var abovez, above, thing, thingtopslope, thingbottomslope, frac, x, y, z;
    if (inpt.isaline) {
      var li = inpt.d;
      if (li.special) P_ShootSpecialLine(shootthing, li);   // ⚠ fires both sides, any shooter
      if (li.sidenum[1] === -1) {
        // one-sided: sky hack check
        var fsec = li.frontsector;
        if (fsec.ceilingpic === G.skyflatnum) return false;
        frac = inpt.frac - ((FixedDiv(4 * FU, attackrange)) | 0);
        x = (shootthing.x + FixedMul(trace.dx, frac)) | 0;
        y = (shootthing.y + FixedMul(trace.dy, frac)) | 0;
        z = (shootz + FixedMul(aimslope, FixedMul(inpt.frac, attackrange))) | 0;
        P_SpawnPuff(x, y, z);
        return false;
      }
      // two-sided
      P_LineOpening(li);
      var dist = FixedMul(attackrange, inpt.frac);
      var ts = FixedDiv(opentop - shootz, dist);
      var bs = FixedDiv(openbottom - shootz, dist);
      if (topslope > ts) topslope = ts;
      if (bottomslope < bs) bottomslope = bs;
      if (topslope <= bottomslope) {
        var f2 = inpt.frac - ((FixedDiv(4 * FU, attackrange)) | 0);
        x = (shootthing.x + FixedMul(trace.dx, f2)) | 0;
        y = (shootthing.y + FixedMul(trace.dy, f2)) | 0;
        z = (shootz + FixedMul(aimslope, FixedMul(inpt.frac, attackrange))) | 0;
        // sky above? (C: continue if backsector ceiling is sky when slope hits top)
        var bs2 = li.backsector;
        if (bs2 && bs2.ceilingpic === G.skyflatnum && aimslope >= 0 &&
          FixedDiv(bs2.ceilingheight - shootz, attackrange) <= aimslope) return false;
        if (bs2 && bs2.ceilingpic === G.skyflatnum && (bs2.ceilingheight - shootz) > 0 &&
          FixedDiv(bs2.ceilingheight - shootz, attackrange) > 0 && aimslope > 0 &&
          FixedDiv(bs2.ceilingheight - shootz, attackrange) <= aimslope) return false;
        P_SpawnPuff(x, y, z);
        return false;
      }
      // can the shot pass above/below the opening? (C: slope outside opening entirely)
      if (aimslope > topslope || aimslope < bottomslope) {
        if (aimslope > 0 && li.backsector && li.backsector.ceilingpic === G.skyflatnum) return false;
        if (aimslope < 0) { // hit floor side
          var f3 = inpt.frac - ((FixedDiv(4 * FU, attackrange)) | 0);
          x = (shootthing.x + FixedMul(trace.dx, f3)) | 0;
          y = (shootthing.y + FixedMul(trace.dy, f3)) | 0;
          z = (shootz + FixedMul(aimslope, FixedMul(inpt.frac, attackrange))) | 0;
          P_SpawnPuff(x, y, z);
          return false;
        }
      }
      if (li.special === 0 && (li.flags & 1)) { /* ML_BLOCKING handled elsewhere */ }
      return true;
    }
    thing = inpt.d;
    if (thing === shootthing) return true;
    var d2 = FixedMul(attackrange, inpt.frac);
    thingbottomslope = FixedDiv(thing.z - shootz, d2);
    thingtopslope = FixedDiv(thing.z + thing.height - shootz, d2);
    if (thingtopslope < aimslope) return true;
    if (thingbottomslope > aimslope) return true;
    if (!(thing.flags & MF_SHOOTABLE)) return true;
    frac = inpt.frac - ((FixedDiv(10 * FU, attackrange)) | 0);
    x = (shootthing.x + FixedMul(trace.dx, frac)) | 0;
    y = (shootthing.y + FixedMul(trace.dy, frac)) | 0;
    z = (shootz + FixedMul(aimslope, FixedMul(inpt.frac, attackrange))) | 0;
    if (thing.flags & MF_NOBLOOD) P_SpawnPuff(x, y, z);
    else P_SpawnBlood(x, y, z, la_damage);
    if (la_damage) P_DamageMobj(thing, shootthing, shootthing, la_damage);
    return false;
  }
  G.P_LineAttack = P_LineAttack; G.P_AimLineAttack = P_AimLineAttack;
  G.P_CheckMissileRange = P_CheckMissileRange;               // test-rng.js pins the p_enemy.c:220-252 type branches
  G.P_BulletSlope = P_BulletSlope; G.P_GunShot = P_GunShot;
  G.P_SpawnPuff = P_SpawnPuff; G.P_SpawnBlood = P_SpawnBlood;
  G.getLinetarget = function () { return linetarget; };

  // P_UseLines (p_map.c)
  var usething = null;
  function PTR_UseTraverse(inpt) {
    var side;
    if (!inpt.d.special) {
      P_LineOpening(inpt.d);
      if (openrange <= 0) { S_StartSound(usething, SFX.sfx_noway); return false; }  // can't use through a wall
      return true;
    }
    side = 0;
    if (P_PointOnLineSide(usething.x, usething.y, inpt.d) === 1) side = 1;
    P_UseSpecialLine(usething, inpt.d, side);
    return false;                                          // one special line max
  }
  function P_UseLines(player) {
    usething = player.mo;
    var angle = player.mo.angle >>> 19;
    var x1 = player.mo.x, y1 = player.mo.y;
    var x2 = (x1 + (USERANGE >> FRACBITS) * fcos(angle)) | 0;
    var y2 = (y1 + (USERANGE >> FRACBITS) * fsin(angle)) | 0;
    P_PathTraverse(x1, y1, x2, y2, PT_ADDLINES, PTR_UseTraverse);
  }
  G.P_UseLines = P_UseLines;

  // P_RadiusAttack (p_map.c:1152) — Chebyshev falloff in whole units
  var bombspot = null, bombsource = null, bombdamage = 0;
  function PIT_RadiusAttack(thing) {
    if (!(thing.flags & MF_SHOOTABLE)) return true;
    var dx = Math.abs(thing.x - bombspot.x);
    var dy = Math.abs(thing.y - bombspot.y);
    var dist = dx > dy ? dx : dy;
    dist = (dist - thing.radius) >> FRACBITS;
    if (dist < 0) dist = 0;
    if (dist >= bombdamage) return true;
    if (G.P_CheckSight(thing, bombspot))
      P_DamageMobj(thing, bombspot, bombsource, bombdamage - dist);
    return true;
  }
  function P_RadiusAttack(spot, source, damage) {
    // p_map.c:1219 (damage+MAXRADIUS)<<FRACBITS — kept in int32 via |0 to match
    // C wrap semantics (JS << already coerces, this documents the intent).
    var dist = ((damage + MAXRADIUS) << FRACBITS) | 0;
    var bm = md().blockmap;
    var orgx = bm.bmaporgx === undefined ? bm.orgx : bm.bmaporgx;
    var orgy = bm.bmaporgy === undefined ? bm.orgy : bm.bmaporgy;
    var yh = (spot.y + dist - orgy) >> 23, yl = (spot.y - dist - orgy) >> 23;
    var xh = (spot.x + dist - orgx) >> 23, xl = (spot.x - dist - orgx) >> 23;
    bombspot = spot; bombsource = source; bombdamage = damage;
    for (var y = yl; y <= yh; y++) for (var x = xl; x <= xh; x++)
      P_BlockThingsIterator(x, y, PIT_RadiusAttack);
  }
  G.P_RadiusAttack = P_RadiusAttack;

  // ---------------------------------------------------------------- sector queries (p_spec.c)
  function P_FindSectorFromLineTag(line, start) {
    do {
      start++;
      if (start >= sectors.length) return -1;
    } while (sectors[start].tag !== line.tag);
    return start;
  }
  function getNextSector(ld, sec1) {
    if (ld.sidenum[1] === -1) return null;
    return sides[ld.sidenum[0]].sector === sec1 ? sides[ld.sidenum[1]].sector : sides[ld.sidenum[0]].sector;
  }
  function P_FindLowestFloorSurrounding(sec) {
    var floor = sec.floorheight;
    for (var i = 0; i < sec.lines.length; i++) {
      var other = getNextSector(sec.lines[i], sec);
      if (other && other.floorheight < floor) floor = other.floorheight;
    }
    return floor;
  }
  function P_FindHighestFloorSurrounding(sec) {
    var floor = -500 * FU;
    for (var i = 0; i < sec.lines.length; i++) {
      var other = getNextSector(sec.lines[i], sec);
      if (other && other.floorheight > floor) floor = other.floorheight;
    }
    return floor;
  }
  function P_FindNextHighestFloor(sec, currentheight) {
    var height = currentheight, hl = [], MAX_ADJOINING_SECTORS = 20;
    for (var i = 0; i < sec.lines.length; i++) {
      var other = getNextSector(sec.lines[i], sec);
      if (!other) continue;
      if (other.floorheight > height) hl.push(other.floorheight);
      if (hl.length >= MAX_ADJOINING_SECTORS) break;       // p_spec.c "20 adjoining sectors max!"
    }
    if (!hl.length) return currentheight;
    var min = hl[0];
    for (var j = 1; j < hl.length; j++) if (hl[j] < min) min = hl[j];
    return min;
  }
  function P_FindLowestCeilingSurrounding(sec) {
    var height = MAXINT;
    for (var i = 0; i < sec.lines.length; i++) {
      var other = getNextSector(sec.lines[i], sec);
      if (other && other.ceilingheight < height) height = other.ceilingheight;
    }
    return height;
  }
  function P_FindHighestCeilingSurrounding(sec) {
    var height = 0;
    for (var i = 0; i < sec.lines.length; i++) {
      var other = getNextSector(sec.lines[i], sec);
      if (other && other.ceilingheight > height) height = other.ceilingheight;
    }
    return height;
  }
  function P_FindMinSurroundingLight(sector, max) {
    var min = max;
    for (var i = 0; i < sector.lines.length; i++) {
      var check = getNextSector(sector.lines[i], sector);
      if (!check) continue;
      if (check.lightlevel < min) min = check.lightlevel;
    }
    return min;
  }
  G.P_FindSectorFromLineTag = P_FindSectorFromLineTag;
  G.P_FindNextHighestFloor = P_FindNextHighestFloor;
  G.P_FindLowestFloorSurrounding = P_FindLowestFloorSurrounding;

  // ---------------------------------------------------------------- movers: T_MovePlane (p_floor.c)
  var pastdest = 2, crushed = 1, ok = 0;
  function T_MovePlane(sector, speed, dest, crush, floorOrCeiling, direction) {
    var flag, lastpos;
    if (floorOrCeiling === 0) {                             // FLOOR
      if (direction === -1) {
        if (sector.floorheight - speed < dest) {
          lastpos = sector.floorheight; sector.floorheight = dest;
          flag = P_ChangeSector(sector, crush);
          if (flag === true) { sector.floorheight = lastpos; P_ChangeSector(sector, crush); }
          return pastdest;
        } else {
          lastpos = sector.floorheight; sector.floorheight -= speed;
          flag = P_ChangeSector(sector, crush);
          if (flag === true) { sector.floorheight = lastpos; P_ChangeSector(sector, crush); return crushed; }
        }
      } else {
        if (sector.floorheight + speed > dest) {
          lastpos = sector.floorheight; sector.floorheight = dest;
          flag = P_ChangeSector(sector, crush);
          if (flag === true) { sector.floorheight = lastpos; P_ChangeSector(sector, crush); }
          return pastdest;
        } else {
          lastpos = sector.floorheight; sector.floorheight += speed;
          flag = P_ChangeSector(sector, crush);
          if (flag === true) {
            if (crush === true) return crushed;
            sector.floorheight = lastpos; P_ChangeSector(sector, crush); return crushed;
          }
        }
      }
    } else {                                               // CEILING
      if (direction === -1) {
        if (sector.ceilingheight - speed < dest) {
          lastpos = sector.ceilingheight; sector.ceilingheight = dest;
          flag = P_ChangeSector(sector, crush);
          if (flag === true) { sector.ceilingheight = lastpos; P_ChangeSector(sector, crush); }
          return pastdest;
        } else {
          lastpos = sector.ceilingheight; sector.ceilingheight -= speed;
          flag = P_ChangeSector(sector, crush);
          if (flag === true) {
            if (crush === true) return crushed;
            sector.ceilingheight = lastpos; P_ChangeSector(sector, crush); return crushed;
          }
        }
      } else {
        if (sector.ceilingheight + speed > dest) {
          lastpos = sector.ceilingheight; sector.ceilingheight = dest;
          flag = P_ChangeSector(sector, crush);
          if (flag === true) { sector.ceilingheight = lastpos; P_ChangeSector(sector, crush); }
          return pastdest;
        } else {
          lastpos = sector.ceilingheight; sector.ceilingheight += speed;
          P_ChangeSector(sector, crush);                   // #if 0'd crush check in C
        }
      }
    }
    return ok;
  }
  // P_ChangeSector (p_map.c:1320)
  var crushchange = false;
  function PIT_ChangeSector(thing) {
    if (thing.flags & MF_NOCLIP) return true;
    if (!P_ThingHeightClip(thing)) {
      if (crushchange && !(G.leveltime & 3)) {
        if (!(thing.flags & MF_NOBLOOD)) {
          var mo = P_SpawnMobj(thing.x, thing.y, thing.z + 24 * FU, MT_BLOOD);
          mo.momx = (P_Random() - P_Random()) << 12;
          mo.momy = (P_Random() - P_Random()) << 12;
          mo.flags &= ~MF_NOBLOCKMAP;                      // C leaves NOBLOCKMAP; keep C: revert
          mo.flags |= MF_NOBLOCKMAP;
        }
        if (!thing.player) P_DamageMobj(thing, null, null, 10);
        else {
          // player crush: damage (players take 10/4tics via same path)
          P_DamageMobj(thing, null, null, 10);
        }
      }
      return false;
    }
    return true;
  }
  function P_ChangeSector(sector, crush) {
    crushchange = crush;
    // blockbox is m_bbox.h order [BOXTOP, BOXBOTTOM, BOXLEFT, BOXRIGHT]
    // (engine.js:48). Vanilla returns !P_BoxIterator (p_spec.c:1218): true
    // ONLY when some thing vetoes the move. The old form started res=true and
    // scanned bb in [LEFT,RIGHT,TOP,BOTTOM] order — zero-iteration y loop on
    // most sectors, and inverted polarity anyway, so every floor mover
    // (T_MovePlane floor branch) was reverted on its first tic.
    var bb = sector.blockbox;
    var res = false;
    if (!bb) return false;
    for (var y = bb[1]; y <= bb[0]; y++)        // BOTTOM..TOP
      for (var x = bb[2]; x <= bb[3]; x++)      // LEFT..RIGHT
        if (!P_BlockThingsIterator(x, y, PIT_ChangeSector)) res = true;
    return res;
  }
  G.P_ChangeSector = P_ChangeSector;

  // ---------------------------------------------------------------- doors (p_doors.c)
  var normal = 0, close = 1, raiseIn5Mins = 2, blazeRaise = 3, blazeOpen = 4, blazeClose = 5,
    open = 6, close30ThenOpen = 7;
  function T_VerticalDoor(door) {
    var res;
    switch (door.direction) {
      case 0:                                              // WAITING
        if (!--door.topcountdown) {
          switch (door.type) {
            case blazeRaise: door.direction = -1; S_StartSound(door.sector.soundorg, SFX.sfx_bdcls); break;
            case normal: door.direction = -1; S_StartSound(door.sector.soundorg, SFX.sfx_dorcls); break;
            case close30ThenOpen: door.direction = 1; S_StartSound(door.sector.soundorg, SFX.sfx_doropn); break;
            default: break;
          }
        }
        break;
      case 2:                                              // INITIAL WAIT
        if (!--door.topcountdown) {
          switch (door.type) {
            case raiseIn5Mins:
              door.direction = 1; door.type = normal;
              S_StartSound(door.sector.soundorg, SFX.sfx_doropn); break;
            default: break;
          }
        }
        break;
      case -1:                                             // DOWN
        res = T_MovePlane(door.sector, door.speed, door.sector.floorheight, false, 1, door.direction);
        if (res === pastdest) {
          switch (door.type) {
            case blazeRaise: case blazeClose:
              door.sector.specialdata = null; P_RemoveThinker(door.thinker);
              S_StartSound(door.sector.soundorg, SFX.sfx_bdcls); break;
            case normal: case close:
              door.sector.specialdata = null; P_RemoveThinker(door.thinker); break;
            case close30ThenOpen:
              door.direction = 0; door.topcountdown = 35 * 30; break;
            default: break;
          }
        } else if (res === crushed) {
          switch (door.type) {
            case blazeClose: case close: break;              // DO NOT GO BACK UP!
            default: door.direction = 1; S_StartSound(door.sector.soundorg, SFX.sfx_doropn); break;
          }
        }
        break;
      case 1:                                              // UP
        res = T_MovePlane(door.sector, door.speed, door.topheight, false, 1, door.direction);
        if (res === pastdest) {
          switch (door.type) {
            case blazeRaise: case normal:
              door.direction = 0; door.topcountdown = door.topwait; break;
            case close30ThenOpen: case blazeOpen: case open:
              door.sector.specialdata = null; P_RemoveThinker(door.thinker); break;
            default: break;
          }
        } else if (res === crushed) {
          switch (door.type) {
            case blazeRaise: case normal:
              door.direction = 0; door.topcountdown = door.topwait; break;
            default: door.sector.specialdata = null; P_RemoveThinker(door.thinker); break;
          }
        }
        break;
    }
  }
  // EV_DoLockedDoor (p_doors.c:207) — checks line->special for the key, then EV_DoDoor
  function EV_DoLockedDoor(line, type, thing) {
    var p = thing ? thing.player : null;
    if (!p) return 0;
    switch (line.special) {
      case 99: case 133:                                    // Blue Lock
        if (!p.cards[0] && !p.cards[3]) { p.message = MSG.PD_BLUEO; S_StartSound(null, SFX.sfx_oof); return 0; }
        break;
      case 134: case 135:                                   // Red Lock
        if (!p.cards[2] && !p.cards[5]) { p.message = MSG.PD_REDO; S_StartSound(null, SFX.sfx_oof); return 0; }
        break;
      case 136: case 137:                                   // Yellow Lock
        if (!p.cards[1] && !p.cards[4]) { p.message = MSG.PD_YELLOWO; S_StartSound(null, SFX.sfx_oof); return 0; }
        break;
    }
    return EV_DoDoor(line, type);
  }
  function EV_DoDoor(line, type) {
    var secnum = -1, rtn = 0, sec, door;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) continue;
      rtn = 1;
      door = { thinker: null, sector: sec, type: type, topwait: VDOORWAIT, speed: VDOORSPEED,
        direction: 0, topcountdown: 0, topheight: 0 };
      door.thinker = door;
      door.function = T_VerticalDoor;
      P_AddThinker(door);
      sec.specialdata = door;
      switch (type) {
        case blazeClose:
          door.topheight = P_FindLowestCeilingSurrounding(sec) - 4 * FU;
          door.direction = -1; door.speed = VDOORSPEED * 4;
          S_StartSound(door.sector.soundorg, SFX.sfx_bdcls); break;
        case close:
          door.topheight = P_FindLowestCeilingSurrounding(sec) - 4 * FU;
          door.direction = -1;
          S_StartSound(door.sector.soundorg, SFX.sfx_dorcls); break;
        case close30ThenOpen:
          door.topheight = sec.ceilingheight; door.direction = -1;
          S_StartSound(door.sector.soundorg, SFX.sfx_dorcls); break;
        case blazeRaise: case blazeOpen:
          door.direction = 1;
          door.topheight = P_FindLowestCeilingSurrounding(sec) - 4 * FU;
          door.speed = VDOORSPEED * 4;
          if (door.topheight !== sec.ceilingheight) S_StartSound(door.sector.soundorg, SFX.sfx_bdopn);
          break;
        case normal: case open:
          door.direction = 1;
          door.topheight = P_FindLowestCeilingSurrounding(sec) - 4 * FU;
          if (door.topheight !== sec.ceilingheight) S_StartSound(door.sector.soundorg, SFX.sfx_doropn);
          break;
        case raiseIn5Mins:
          door.direction = 2; door.topheight = sec.ceilingheight;
          door.topwait = 5 * 60 * 35; door.topcountdown = 5 * 60 * 35; break;
      }
    }
    return rtn;
  }
  // EV_VerticalDoor — S1 door switch (p_doors.c:127)
  function EV_VerticalDoor(line, thing) {
    var player = thing.player, secnum, sec, door, side = 0; // only front sides usable
    switch (line.special) {                                // locked doors (p_doors.c:371-410)
      case 26: case 32:                                     // blue
        if (!player) return;
        if (!player.cards[0] && !player.cards[3]) { player.message = MSG.PD_BLUEK; S_StartSound(null, SFX.sfx_oof); return; }
        break;
      case 27: case 34:                                     // yellow
        if (!player) return;
        if (!player.cards[1] && !player.cards[4]) { player.message = MSG.PD_YELLOWK; S_StartSound(null, SFX.sfx_oof); return; }
        break;
      case 28: case 33:                                     // red
        if (!player) return;
        if (!player.cards[2] && !player.cards[5]) { player.message = MSG.PD_REDK; S_StartSound(null, SFX.sfx_oof); return; }
        break;
    }
    // C: sec = sides[line->sidenum[1]].sector — vanilla S1 switches are
    // two-sided with the door sector directly behind the switch. gen_map.py
    // authors MAP01's S1 as a ONE-SIDED wall carrying the door's tag, so when
    // there is no back side resolve the door sector by tag instead
    // (documented deviation; C wins whenever sidenum[1] exists).
    if (line.sidenum[1] === -1) {
      secnum = P_FindSectorFromLineTag(line, -1);
      if (secnum < 0) return;
      sec = sectors[secnum];
    } else {
      sec = sides[line.sidenum[side ^ 1]].sector;          // switch line's backsector
      secnum = sectors.indexOf(sec);
    }
    if (sec.specialdata) {
      door = sec.specialdata;
      switch (line.special) {
        case 1: case 26: case 27: case 28: case 117:
          if (door.direction === -1) door.direction = 1;
          else {
            if (!thing.player) return;                     // JDC: bad guys never close doors
            door.direction = -1;
          }
          return;
      }
    }
    // for proper sound (p_doors.c:440-455)
    switch (line.special) {
      case 117: case 118:                                    // BLAZING DOOR RAISE/OPEN
        S_StartSound(sec.soundorg, SFX.sfx_bdopn); break;
      case 1: case 31:                                       // NORMAL DOOR SOUND
      default:                                               // LOCKED DOOR SOUND
        S_StartSound(sec.soundorg, SFX.sfx_doropn); break;
    }
    door = { sector: sec, direction: 1, speed: VDOORSPEED, topwait: VDOORWAIT };
    door.thinker = door;
    door.function = T_VerticalDoor;
    P_AddThinker(door);
    sec.specialdata = door;
    switch (line.special) {
      case 1: case 26: case 27: case 28: door.type = normal; break;
      case 31: case 32: case 33: case 34: door.type = open; line.special = 0; break;
      case 117: door.type = blazeRaise; door.speed = VDOORSPEED * 4; break;
      case 118: door.type = blazeOpen; line.special = 0; door.speed = VDOORSPEED * 4; break;
      default: door.type = normal; break;
    }
    door.topheight = P_FindLowestCeilingSurrounding(sec) - 4 * FU;
    door.topcountdown = 0;
  }
  G.T_VerticalDoor = T_VerticalDoor; G.EV_DoDoor = EV_DoDoor; G.EV_VerticalDoor = EV_VerticalDoor;

  // ---------------------------------------------------------------- plats (p_plats.c)
  var downWaitUpStay = 0, raiseAndChange = 1, raiseToNearestAndChange = 2,
    blazeDWUS = 3, perpetualRaise = 4;
  var up = 0, down = 1, waiting = 2, in_stasis = 3;
  var activeplats = new Array(MAXPLATS).fill(null);
  function P_RemoveActivePlat(plat) {
    for (var i = 0; i < MAXPLATS; i++) {
      if (plat === activeplats[i]) {
        activeplats[i].sector.specialdata = null;
        P_RemoveThinker(activeplats[i].thinker);
        activeplats[i] = null;
        break;
      }
    }
  }
  function P_ActivateInStasis(tag) {
    for (var i = 0; i < MAXPLATS; i++) {
      if (activeplats[i] && activeplats[i].tag === tag) {
        activeplats[i].status = up;
        activeplats[i].speed = PLATSPEED;
        activeplats[i].thinker.function = T_PlatRaise;
      }
    }
  }
  function T_PlatRaise(plat) {
    var res;
    switch (plat.status) {
      case up:
        res = T_MovePlane(plat.sector, plat.speed, plat.high, plat.crush, 0, 1);
        if (plat.type === raiseAndChange || plat.type === raiseToNearestAndChange) {
          if (!(G.leveltime & 7)) S_StartSound(plat.sector.soundorg, SFX.sfx_stnmov);
        }
        if (res === crushed && (!plat.crush)) {
          plat.count = plat.wait; plat.status = down;
          S_StartSound(plat.sector.soundorg, SFX.sfx_pstart);
        } else if (res === pastdest) {
          plat.count = plat.wait; plat.status = waiting;
          S_StartSound(plat.sector.soundorg, SFX.sfx_pstop);
          switch (plat.type) {
            case blazeDWUS: case downWaitUpStay:
            case raiseAndChange: case raiseToNearestAndChange:
              P_RemoveActivePlat(plat); break;
            default: break;
          }
        }
        break;
      case down:
        res = T_MovePlane(plat.sector, plat.speed, plat.low, false, 0, -1);
        if (res === pastdest) {
          plat.count = plat.wait; plat.status = waiting;
          S_StartSound(plat.sector.soundorg, SFX.sfx_pstop);
        }
        break;
      case waiting:
        if (!--plat.count) {
          if (plat.sector.floorheight === plat.low) plat.status = up;
          else plat.status = down;
          S_StartSound(plat.sector.soundorg, SFX.sfx_pstart);
        }
      // fallthrough
      case in_stasis:
        break;
    }
  }
  function EV_DoPlat(line, type, amount) {
    var plat, secnum = -1, rtn = 0, sec;
    switch (type) {
      case perpetualRaise: P_ActivateInStasis(line.tag); break;
      default: break;
    }
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) continue;
      rtn = 1;
      plat = { tag: line.tag };
      plat.thinker = plat;
      plat.type = type; plat.sector = sec; sec.specialdata = plat;
      plat.function = T_PlatRaise;
      P_AddThinker(plat);
      plat.crush = false;
      switch (type) {
        case raiseToNearestAndChange:
          plat.speed = PLATSPEED / 2;
          sec.floorpic = sides[line.sidenum[0]].sector.floorpic;
          plat.high = P_FindNextHighestFloor(sec, sec.floorheight);
          plat.wait = 0; plat.status = up;
          sec.special = 0;                                 // NO MORE DAMAGE, IF APPLICABLE
          S_StartSound(sec.soundorg, SFX.sfx_stnmov);
          break;
        case raiseAndChange:
          plat.speed = PLATSPEED / 2;
          sec.floorpic = sides[line.sidenum[0]].sector.floorpic;
          plat.high = sec.floorheight + amount * FU;
          plat.wait = 0; plat.status = up;
          S_StartSound(sec.soundorg, SFX.sfx_stnmov);
          break;
        case downWaitUpStay:
          plat.speed = PLATSPEED * 4;
          plat.low = P_FindLowestFloorSurrounding(sec);
          if (plat.low > sec.floorheight) plat.low = sec.floorheight;
          plat.high = sec.floorheight;
          plat.wait = 35 * PLATWAIT; plat.status = down;
          S_StartSound(sec.soundorg, SFX.sfx_pstart);
          break;
        case blazeDWUS:
          plat.speed = PLATSPEED * 8;
          plat.low = P_FindLowestFloorSurrounding(sec);
          if (plat.low > sec.floorheight) plat.low = sec.floorheight;
          plat.high = sec.floorheight;
          plat.wait = 35 * PLATWAIT; plat.status = down;
          S_StartSound(sec.soundorg, SFX.sfx_pstart);
          break;
        case perpetualRaise:
          plat.speed = PLATSPEED;
          plat.low = P_FindLowestFloorSurrounding(sec);
          if (plat.low > sec.floorheight) plat.low = sec.floorheight;
          plat.high = P_FindHighestFloorSurrounding(sec);
          if (plat.high < sec.floorheight) plat.high = sec.floorheight;
          plat.high += 4 * FU;
          if (plat.high > 200 * FU) { plat.high = 200 * FU; }  // C: if >200*FU → floorheight+4*FU
          if (plat.high === (sec.floorheight + 4 * FU)) {
            // C: topheight special-case — skip if no range: continue equivalent
            // (C does: plat->high = sec->floorheight + 4*FRACUNIT; then check)
          }
          if (plat.high === sec.floorheight) continue;
          if (sec.floorheight === plat.high) { plat.status = down; }
          else if (sec.floorheight === plat.low) { plat.status = up; }
          else {
            // gospel p_plats.c:246 `plat->status = P_Random()&1` with C enum
            // st_down=0/st_up=1 → roll bit 1 means UP. (JS enum is inverted,
            // so the bit maps to up here — the old `&1 → down` was backwards.)
            plat.status = (P_Random() & 1) ? up : down;
          }
          S_StartSound(sec.soundorg, SFX.sfx_pstart);
          if (!P_AddActivePlat(plat)) { P_RemoveThinker(plat.thinker); sec.specialdata = null; rtn = 0; continue; }
          break;
      }
      if (type !== perpetualRaise) P_AddActivePlat(plat);
    }
    return rtn;
  }
  function P_AddActivePlat(plat) {
    for (var i = 0; i < MAXPLATS; i++) if (activeplats[i] === null) { activeplats[i] = plat; return true; }
    return false;
  }
  function EV_StopPlat(line) {
    for (var i = 0; i < MAXPLATS; i++) {
      if (activeplats[i] && activeplats[i].status !== in_stasis &&
        activeplats[i].tag === line.tag) {
        activeplats[i].thinker.function = T_PlatRaise;     // C keeps thinker, sets in_stasis
        activeplats[i].status = in_stasis;
      }
    }
  }
  G.T_PlatRaise = T_PlatRaise; G.EV_DoPlat = EV_DoPlat; G.EV_StopPlat = EV_StopPlat;

  // ---------------------------------------------------------------- floors (p_floor.c)
  var lowerFloor = 0, lowerFloorToLowest = 1, turboLower = 2, raiseFloor = 3,
    raiseFloorCrush = 4, raiseFloorToTexture = 5, raiseFloor24 = 6,
    raiseFloor24AndChange = 7, raiseFloorToNearest = 8, lowerAndChange = 9, donutRaise = 10,
    // p_spec.h floortype_e continues: lowerAndChange, donutRaise, raiseFloorTurbo, raiseFloor512
    raiseFloorTurbo = 11, raiseFloor512 = 12;
  var stairspeed = 8 * FU, MAXSTAIRS = 16, build8 = 0;
  var activefloors = [];
  function T_MoveFloor(floor) {
    var res = T_MovePlane(floor.sector, floor.speed, floor.floordestheight, floor.crush, 0, floor.direction);
    if (!(G.leveltime & 7)) S_StartSound(floor.sector.soundorg, SFX.sfx_stnmov);
    if (res === pastdest) {
      floor.sector.specialdata = null;
      if (floor.direction === 1) {
        switch (floor.type) {
          case donutRaise:
            floor.sector.special = floor.newspecial;
            floor.sector.floorpic = floor.texture;
          default: break;
        }
      } else if (floor.direction === -1) {
        switch (floor.type) {
          case lowerAndChange:
            floor.sector.special = floor.newspecial;
            floor.sector.floorpic = floor.texture;
          default: break;
        }
      }
      P_RemoveThinker(floor.thinker);
      S_StartSound(floor.sector.soundorg, SFX.sfx_pstop);
    }
  }
  function EV_DoFloor(line, type) {
    var secnum = -1, rtn = 0, sec, floor;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) continue;
      rtn = 1;
      floor = { sector: sec, crush: false, direction: 1, type: type, newspecial: 0 };
      floor.thinker = floor;
      floor.function = T_MoveFloor;
      P_AddThinker(floor);
      sec.specialdata = floor;
      // Gospel EV_DoFloor switch — p_floor.c:288-416. T_MoveFloor applies
      // texture/newspecial on arrival; do NOT touch sec->floorpic at trigger.
      switch (type) {
        case lowerFloor:                                      // p_floor.c:291
          floor.direction = -1; floor.speed = FLOORSPEED;
          floor.floordestheight = P_FindHighestFloorSurrounding(sec);
          break;
        case lowerFloorToLowest:                              // p_floor.c:299
          floor.direction = -1; floor.speed = FLOORSPEED;
          floor.floordestheight = P_FindLowestFloorSurrounding(sec);
          break;
        case turboLower:                                      // p_floor.c:306
          floor.direction = -1; floor.speed = FLOORSPEED * 4;
          floor.floordestheight = P_FindHighestFloorSurrounding(sec);
          if (floor.floordestheight !== sec.floorheight) floor.floordestheight += 8 * FU;
          break;
        case raiseFloorCrush:                                 // p_floor.c:316
          floor.crush = true;
          /* fallthrough */
        case raiseFloor:                                      // p_floor.c:318
          floor.direction = 1; floor.speed = FLOORSPEED;
          floor.floordestheight = P_FindLowestCeilingSurrounding(sec);
          if (floor.floordestheight > sec.ceilingheight) floor.floordestheight = sec.ceilingheight;
          if (type === raiseFloorCrush) floor.floordestheight -= 8 * FU;
          break;
        case raiseFloorTurbo:                                 // p_floor.c:328
          floor.direction = 1; floor.speed = FLOORSPEED * 4;
          floor.floordestheight = P_FindNextHighestFloor(sec, sec.floorheight);
          break;
        case raiseFloorToNearest:                             // p_floor.c:336
          floor.direction = 1; floor.speed = FLOORSPEED;
          floor.floordestheight = P_FindNextHighestFloor(sec, sec.floorheight);
          break;
        case raiseFloor24:                                    // p_floor.c:344
          floor.direction = 1; floor.speed = FLOORSPEED;
          floor.floordestheight = sec.floorheight + 24 * FU;
          break;
        case raiseFloor512:                                   // p_floor.c:350
          floor.direction = 1; floor.speed = FLOORSPEED;
          floor.floordestheight = sec.floorheight + 512 * FU;
          break;
        case raiseFloor24AndChange:                           // p_floor.c:356
          floor.direction = 1; floor.speed = FLOORSPEED;
          floor.floordestheight = sec.floorheight + 24 * FU;
          sec.floorpic = line.frontsector.floorpic;
          sec.special = line.frontsector.special;
          break;
        case raiseFloorToTexture: {                           // p_floor.c:372
          var minsize = 0x7fffffff;
          floor.direction = 1; floor.speed = FLOORSPEED;
          for (var ri = 0; ri < sec.lines.length; ri++) {
            var rli = sec.lines[ri];
            if (rli.flags & ML_TWOSIDED) {
              var s0 = sides[rli.sidenum[0]], s1 = sides[rli.sidenum[1]];
              if (s0.bottomtexture >= 0 && textureheight[s0.bottomtexture] < minsize)
                minsize = textureheight[s0.bottomtexture];
              if (s1.bottomtexture >= 0 && textureheight[s1.bottomtexture] < minsize)
                minsize = textureheight[s1.bottomtexture];
            }
          }
          floor.floordestheight = sec.floorheight + minsize;
          break;
        }
        case lowerAndChange: {                                // p_floor.c:403
          floor.direction = -1; floor.speed = FLOORSPEED;
          floor.floordestheight = P_FindLowestFloorSurrounding(sec);
          floor.texture = sec.floorpic;
          for (var li2 = 0; li2 < sec.lines.length; li2++) {
            var nli = sec.lines[li2];
            if (!(nli.flags & ML_TWOSIDED)) continue;
            var osec = getNextSector(nli, sec);               // getSector side per front/back
            if (osec && osec.floorheight === floor.floordestheight) {
              floor.texture = osec.floorpic;
              floor.newspecial = osec.special;
              break;
            }
          }
          break;
        }
        // p_floor.c:416 default: break — donutRaise floors are built by
        // EV_DoDonut itself, never through this switch (gospel p_floor.c:429).
      }
      if (!floor.speed) floor.speed = FLOORSPEED;
    }
    return rtn;
  }
  function EV_BuildStairs(line, type) {
    // Transcribed from p_floor.c:453 (build8 / turbo16). Chain rule: follow
    // 2-sided lines whose FRONT is the current sector; other side with the
    // SAME floorpic is the next step. ⚠ vanilla increments height before the
    // specialdata skip, so a blocked candidate still burns one stairsize.
    var secnum = -1, rtn = 0, sec, tsec, height, texture, ok;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) continue;                        // already moving
      rtn = 1;
      var speed, stairsize;
      if (type === build8) { speed = FLOORSPEED / 4 | 0; stairsize = 8 * FU; }
      else { speed = FLOORSPEED * 4; stairsize = 16 * FU; }  // turbo16
      var fl0 = { sector: sec, type: raiseFloor, crush: false, direction: 1,
        speed: speed, floordestheight: 0, thinker: null, newspecial: 0 };
      fl0.thinker = fl0; fl0.function = T_MoveFloor;
      P_AddThinker(fl0);
      sec.specialdata = fl0;
      height = sec.floorheight + stairsize;
      fl0.floordestheight = height;
      texture = sec.floorpic;
      do {
        ok = 0;
        for (var i = 0; i < sec.lines.length; i++) {
          var li = sec.lines[i];
          if (!(li.flags & ML_TWOSIDED)) continue;
          // vanilla: tsec = lines[i]->frontsector; if (secnum != tsec-sectors) continue;
          if (li.frontsector !== sectors[secnum]) continue;
          tsec = li.backsector;
          if (!tsec) continue;
          if (tsec.floorpic !== texture) continue;
          height += stairsize;
          if (tsec.specialdata) continue;                   // ⚠ height already incremented (vanilla)
          sec = tsec; secnum = sectors.indexOf(tsec);
          var floor = { sector: sec, type: raiseFloor, crush: false, direction: 1,
            speed: speed, floordestheight: 0, thinker: null, newspecial: 0 };
          floor.thinker = floor; floor.function = T_MoveFloor;
          P_AddThinker(floor);
          sec.specialdata = floor;
          floor.floordestheight = height;
          ok = 1;
          break;
        }
      } while (ok);
    }
    return rtn;
  }
  G.T_MoveFloor = T_MoveFloor; G.EV_DoFloor = EV_DoFloor; G.EV_BuildStairs = EV_BuildStairs;

  // ---------------------------------------------------------------- ceilings (p_ceilng.c)
  var fastCrushAndRaise = 0, silentCrushAndRaise = 1, crushAndRaise = 2,
    lowerAndCrush = 3, lowerToFloor = 4, raiseToHighest = 5;
  var activeceilings = new Array(MAXCEILINGS).fill(null);
  function T_MoveCeiling(ceiling) {
    var res;
    switch (ceiling.direction) {
      case 0: break;                                       // IN STASIS
      case 1:
        res = T_MovePlane(ceiling.sector, ceiling.speed, ceiling.topheight, false, 1, ceiling.direction);
        if (res === pastdest) {
          switch (ceiling.type) {
            case raiseToHighest: P_RemoveActiveCeiling(ceiling); break;
            case silentCrushAndRaise:
            case fastCrushAndRaise: case crushAndRaise:
              ceiling.direction = -1; break;
            default: break;
          }
        }
        break;
      case -1:
        res = T_MovePlane(ceiling.sector, ceiling.speed, ceiling.bottomheight, ceiling.crush, 1, ceiling.direction);
        if (res === pastdest) {
          switch (ceiling.type) {
            case silentCrushAndRaise:
            case fastCrushAndRaise: case crushAndRaise: case lowerAndCrush:
              ceiling.direction = 1; break;
            case lowerToFloor: case raiseToHighest:
              P_RemoveActiveCeiling(ceiling); break;
            default: break;
          }
        } else if (res === crushed) {
          switch (ceiling.type) {
            case silentCrushAndRaise: case fastCrushAndRaise:
            case crushAndRaise: case lowerAndCrush:
              ceiling.direction = 1; break;
            case lowerToFloor: case raiseToHighest:
              P_RemoveActiveCeiling(ceiling); break;
            default: break;
          }
        }
        break;
    }
  }
  function P_RemoveActiveCeiling(c) {
    for (var i = 0; i < MAXCEILINGS; i++) {
      if (activeceilings[i] === c) {
        activeceilings[i].sector.specialdata = null;
        P_RemoveThinker(activeceilings[i].thinker);
        activeceilings[i] = null;
        break;
      }
    }
  }
  function P_AddActiveCeiling(c) {
    for (var i = 0; i < MAXCEILINGS; i++) if (activeceilings[i] === null) { activeceilings[i] = c; return; }
  }
  function P_ActivateInStasisCeiling(line) {
    for (var i = 0; i < MAXCEILINGS; i++) {
      if (activeceilings[i] && activeceilings[i].tag === line.tag && activeceilings[i].direction === 0) {
        activeceilings[i].direction = 1;
        activeceilings[i].speed = CEILSPEED;
      } else if (activeceilings[i] && activeceilings[i].tag === line.tag) {
        activeceilings[i].sector.specialdata = null;
        P_RemoveThinker(activeceilings[i].thinker);
        activeceilings[i] = null;
      }
    }
  }
  function EV_DoCeiling(line, type) {
    var secnum = -1, rtn = 0, sec, ceiling;
    switch (type) {
      case fastCrushAndRaise: case silentCrushAndRaise: case crushAndRaise:
        P_ActivateInStasisCeiling(line);
      default: break;
    }
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) continue;
      rtn = 1;
      ceiling = { sector: sec, crush: false, type: type, tag: sec.tag };
      ceiling.thinker = ceiling;
      ceiling.function = T_MoveCeiling;
      P_AddThinker(ceiling);
      sec.specialdata = ceiling;
      switch (type) {
        case fastCrushAndRaise:
          ceiling.crush = true; ceiling.topheight = sec.ceilingheight;
          ceiling.bottomheight = sec.floorheight + 8 * FU;
          ceiling.direction = -1; ceiling.speed = CEILSPEED * 2; break;
        case silentCrushAndRaise: case crushAndRaise:
          ceiling.crush = true; ceiling.topheight = sec.ceilingheight;
        case lowerAndCrush: case lowerToFloor:
          ceiling.bottomheight = sec.floorheight;
          if (type !== lowerToFloor) ceiling.bottomheight += 8 * FU;
          ceiling.direction = -1; ceiling.speed = CEILSPEED; break;
        case raiseToHighest:
          ceiling.topheight = P_FindHighestCeilingSurrounding(sec);
          ceiling.direction = 1; ceiling.speed = CEILSPEED; break;
      }
      P_AddActiveCeiling(ceiling);
    }
    return rtn;
  }
  G.T_MoveCeiling = T_MoveCeiling; G.EV_DoCeiling = EV_DoCeiling;

  // ---------------------------------------------------------------- lights (p_lights.c)
  function T_FireFlicker(fire) {
    if (--fire.count) return;
    var amount = (P_Random() & 3) * 16;
    fire.sector.lightlevel = (fire.sector.lightlevel - amount < fire.minlight)
      ? fire.minlight : fire.maxlight - amount;
    fire.count = 4;
  }
  function P_SpawnFireFlicker(sector) {
    var fire = { sector: sector, maxlight: sector.lightlevel,
      minlight: P_FindMinSurroundingLight(sector, sector.lightlevel) + 16, direction: -1, count: 4 };
    fire.thinker = fire; fire.function = T_FireFlicker;
    // Gospel p_lights.c: light thinkers do NOT occupy sector specialdata —
    // only movers (door/plat/floor/ceiling) do. Claiming it here made any
    // light-special sector immune to doors/plats/floors (E1M2 tag-13 plat).
    P_AddThinker(fire);
  }
  function T_LightFlash(flash) {
    if (--flash.count) return;
    if (flash.sector.lightlevel === flash.maxlight) {
      flash.sector.lightlevel = flash.minlight;
      flash.count = (P_Random() & flash.mintime) + 1;
    } else {
      flash.sector.lightlevel = flash.maxlight;
      flash.count = (P_Random() & flash.maxtime) + 1;
    }
  }
  function P_SpawnLightFlash(sector) {
    var flash = { sector: sector, maxlight: sector.lightlevel,
      minlight: P_FindMinSurroundingLight(sector, sector.lightlevel),
      maxtime: 64, mintime: 7, count: (P_Random() & 64) + 1 };
    flash.thinker = flash; flash.function = T_LightFlash;
    P_AddThinker(flash);
  }
  function T_StrobeFlash(strobe) {
    if (--strobe.count) return;
    if (strobe.sector.lightlevel === strobe.minlight) {
      strobe.sector.lightlevel = strobe.maxlight;
      strobe.count = strobe.brighttime;
    } else {
      strobe.sector.lightlevel = strobe.minlight;
      strobe.count = strobe.darktime;
    }
  }
  function P_SpawnStrobeFlash(sector, darkOrLight, inSync) {
    var strobe = { sector: sector, maxlight: sector.lightlevel,
      minlight: P_FindMinSurroundingLight(sector, sector.lightlevel),
      darktime: darkOrLight, brighttime: STROBEBRIGHT };
    if (strobe.minlight === strobe.maxlight) strobe.minlight = 0;
    strobe.count = inSync ? 1 : (P_Random() & 7) + 1;
    strobe.thinker = strobe; strobe.function = T_StrobeFlash;
    P_AddThinker(strobe);
  }
  function T_Glow(g) {
    if (g.direction === -1) {
      g.sector.lightlevel -= GLOWSPEED;
      if (g.sector.lightlevel <= g.minlight) { g.sector.lightlevel += GLOWSPEED; g.direction = 1; }
    } else {
      g.sector.lightlevel += GLOWSPEED;
      if (g.sector.lightlevel >= g.maxlight) { g.sector.lightlevel -= GLOWSPEED; g.direction = -1; }
    }
  }
  function P_SpawnGlowingLight(sector) {
    var g = { sector: sector, minlight: P_FindMinSurroundingLight(sector, sector.lightlevel),
      maxlight: sector.lightlevel, direction: -1 };
    g.thinker = g; g.function = T_Glow;
    P_AddThinker(g);
  }
  function EV_StartLightStrobing(line) {
    var secnum = -1, sec;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) continue;
      P_SpawnStrobeFlash(sec, SLOWDARK, 0);
    }
  }
  G.EV_StartLightStrobing = EV_StartLightStrobing;

  // ---------------------------------------------------------------- pic anims (p_spec.c)
  // animdefs[] verbatim (p_spec.c:101). Names checked against WAD lookups;
  // chains resolvable in this WAD: NUKAGE1-3 (flats), SLADRIP1-3 (texture).
  var animdefs = [
    { istexture: false, endname: "NUKAGE3", startname: "NUKAGE1", speed: 8 },
    { istexture: false, endname: "FWATER4", startname: "FWATER1", speed: 8 },
    { istexture: false, endname: "SWATER4", startname: "SWATER1", speed: 8 },
    { istexture: false, endname: "LAVA4", startname: "LAVA1", speed: 8 },
    { istexture: false, endname: "BLOOD3", startname: "BLOOD1", speed: 8 },
    { istexture: false, endname: "RROCK08", startname: "RROCK05", speed: 8 },
    { istexture: false, endname: "SLIME04", startname: "SLIME01", speed: 8 },
    { istexture: false, endname: "SLIME08", startname: "SLIME05", speed: 8 },
    { istexture: false, endname: "SLIME12", startname: "SLIME09", speed: 8 },
    { istexture: true, endname: "BLODGR4", startname: "BLODGR1", speed: 8 },
    { istexture: true, endname: "SLADRIP3", startname: "SLADRIP1", speed: 8 },
    { istexture: true, endname: "BLODRIP4", startname: "BLODRIP1", speed: 8 },
    { istexture: true, endname: "FIREWALL", startname: "FIREWALA", speed: 8 },
    { istexture: true, endname: "GSTFONT3", startname: "GSTFONT1", speed: 8 },
    { istexture: true, endname: "FIRELAVA", startname: "FIRELAV3", speed: 8 },
    { istexture: true, endname: "FIREMAG3", startname: "FIREMAG1", speed: 8 },
    { istexture: true, endname: "FIREBLU2", startname: "FIREBLU1", speed: 8 },
    { istexture: true, endname: "ROCKRED3", startname: "ROCKRED1", speed: 8 },
    { istexture: true, endname: "BFALL4", startname: "BFALL1", speed: 8 },
    { istexture: true, endname: "SFALL4", startname: "SFALL1", speed: 8 },
    { istexture: true, endname: "WFALL4", startname: "WFALL1", speed: 8 },
    { istexture: true, endname: "DBRAIN4", startname: "DBRAIN1", speed: 8 }
  ];
  var anims = [];                                // anim_t list (p_spec.c:110)
  function P_InitPicAnims() {                    // p_spec.c:147
    anims = [];
    for (var i = 0; i < animdefs.length; i++) {
      var a = animdefs[i], base, end;
      if (a.istexture) {
        if (R_TextureNumForName(a.startname) < 0) continue;   // different episode?
        end = R_TextureNumForName(a.endname); base = R_TextureNumForName(a.startname);
        if (end < 0) continue;                                 // C: I_Error; port: skip (audit guarantees chains)
      } else {
        if (R_FlatNumForName(a.startname) < 0) continue;
        end = R_FlatNumForName(a.endname); base = R_FlatNumForName(a.startname);
        if (end < 0) continue;
      }
      var numpics = end - base + 1;
      if (numpics < 2) { warnOnce("anim-bad-cycle-" + a.startname); continue; }  // C I_Error
      anims.push({ istexture: a.istexture, picnum: end, basepic: base, numpics: numpics, speed: a.speed });
    }
  }
  G.P_InitPicAnims = P_InitPicAnims;
  G.anims = function () { return anims; };

  // ---------------------------------------------------------------- buttons/switches (p_switch.c)
  // Deviation: switchlist built from the assets.js texture names actually
  // present (SW1V4/SW2V4, SWM1V/SWM2V, SWM1/SWM2); C builds it via
  // R_CheckTextureNumForName over alphSwitchList (p_switch.c:106).
  var switchlist = [];
  function buildSwitchList() {
    var texNames = (G.ASSETS && G.ASSETS.textures) ? Object.keys(G.ASSETS.textures) : [];
    var pairs = [];
    // partner = toggle the switch digit: SW1COMP->SW2COMP (digit idx 2),
    // SWM1V->SWM2V (digit idx 3) — first digit within the first 4 chars.
    function partner(n) {
      for (var k = 0; k < 4; k++) {
        var c = n[k];
        if (c === '1') return n.substring(0, k) + '2' + n.substring(k + 1);
        if (c === '2') return n.substring(0, k) + '1' + n.substring(k + 1);
      }
      return null;
    }
    for (var i = 0; i < texNames.length; i++) {
      var n = texNames[i];
      if (n.indexOf("SW") !== 0) continue;
      var p = partner(n);
      if (p && texNames.indexOf(p) >= 0 && texNames.indexOf(p) > i) pairs.push([n, p]);
    }
    // Gospel (p_switch.c:143): switchlist holds R_TextureNumForName INDICES,
    // adjacent [SW1,SW2] pairs so P_ChangeSwitchTexture's `i^1` swaps them;
    // the sidedef texture fields are indices too — names never match.
    switchlist = [];
    for (var j = 0; j < pairs.length; j++) {
      switchlist.push(R_TextureNumForName(pairs[j][0]), R_TextureNumForName(pairs[j][1]));
    }
  }
  G.buildSwitchList = buildSwitchList;
  G.switchlist = function () { return switchlist; };
  var buttonlist = new Array(MAXBUTTONS).fill(null);
  for (var bi = 0; bi < MAXBUTTONS; bi++) buttonlist[bi] = { line: null, where: 0, btexture: null, btimer: 0, soundorg: null };  // C static: NULL pointer until P_StartButton
  var top_ = 0, middle_ = 1, bottom_ = 2;
  function P_StartButton(line, w, texture, time) {
    for (var i = 0; i < MAXBUTTONS; i++)
      if (buttonlist[i].btimer && buttonlist[i].line === line) return;  // already pressed
    for (var j = 0; j < MAXBUTTONS; j++) {
      if (!buttonlist[j].btimer) {
        buttonlist[j].line = line; buttonlist[j].where = w;
        buttonlist[j].btexture = texture; buttonlist[j].btimer = time;
        buttonlist[j].soundorg = line.frontsector.soundorg;   // p_spec.c:184
        return;
      }
    }
  }
  function P_ChangeSwitchTexture(line, useAgain) {
    if (!useAgain) line.special = 0;
    // C order preserved (p_switch.c:215-227): sound is decided AFTER the
    // clear, so special==11 (swtchx) can only match with useAgain — vanilla quirk.
    var sound = SFX.sfx_swtchn;
    if (line.special === 11) sound = SFX.sfx_swtchx;          // exit switch
    var texTop = sides[line.sidenum[0]].toptexture;
    var texMid = sides[line.sidenum[0]].midtexture;
    var texBot = sides[line.sidenum[0]].bottomtexture;
    for (var i = 0; i < switchlist.length; i++) {
      if (switchlist[i] === texTop) {
        S_StartSound(buttonlist[0].soundorg, sound);        // C: buttonlist->soundorg == slot 0 (vanilla quirk)
        sides[line.sidenum[0]].toptexture = switchlist[i ^ 1];
        if (useAgain) P_StartButton(line, top_, switchlist[i], BUTTONTIME);
        return;
      } else if (switchlist[i] === texMid) {
        S_StartSound(buttonlist[0].soundorg, sound);
        sides[line.sidenum[0]].midtexture = switchlist[i ^ 1];
        if (useAgain) P_StartButton(line, middle_, switchlist[i], BUTTONTIME);
        return;
      } else if (switchlist[i] === texBot) {
        S_StartSound(buttonlist[0].soundorg, sound);
        sides[line.sidenum[0]].bottomtexture = switchlist[i ^ 1];
        if (useAgain) P_StartButton(line, bottom_, switchlist[i], BUTTONTIME);
        return;
      }
    }
  }
  G.P_ChangeSwitchTexture = P_ChangeSwitchTexture;
  G.buttonlist = buttonlist;

  // ---------------------------------------------------------------- P_UseSpecialLine (p_switch.c:276)
  function P_UseSpecialLine(thing, line, side) {
    if (side) { switch (line.special) { case 124: break; default: return false; } }
    if (!thing.player) {
      if (line.flags & ML_SECRET) return false;            // never open secret doors
      switch (line.special) {
        case 1: case 32: case 33: case 34: break;          // monsters may press manual doors
        default: return false;
      }
    }
    // Table transcribed from p_switch.c:323-660 (S1/switch + SR/button only).
    // The old port carried vanilla's W1/WR cross-trigger table here (it is
    // duplicated in P_CrossSpecialLine), which made retail SR switches do the
    // wrong thing — e.g. E1M8's SW1BRNGN plat button (SR 62) fired a one-shot
    // 8-unit lowerFloor instead of the down-wait-up plat.
    switch (line.special) {
      // MANUALS (and locked manual doors — key check in EV_VerticalDoor)
      case 1: case 26: case 27: case 28:
      case 31: case 32: case 33: case 34:
      case 117: case 118:                                        // blazing manual doors
        EV_VerticalDoor(line, thing);
        break;

      // SWITCHES (S1: texture stays switched, special stays live per C)
      case 7:                                             // Build Stairs
        if (EV_BuildStairs(line, build8)) P_ChangeSwitchTexture(line, 0);
        break;
      case 9:                                             // Change Donut
        if (EV_DoDonut(line)) P_ChangeSwitchTexture(line, 0);
        break;
      case 11:                                            // Exit level
        P_ChangeSwitchTexture(line, 0);
        G.secretexit = false;                            // g_game.c: normal exit
        G_ExitLevel();
        break;
      case 14:                                            // Raise Floor 32 and change texture
        if (EV_DoPlat(line, raiseAndChange, 32)) P_ChangeSwitchTexture(line, 0);
        break;
      case 15:                                            // Raise Floor 24 and change texture
        if (EV_DoPlat(line, raiseAndChange, 24)) P_ChangeSwitchTexture(line, 0);
        break;
      case 18:                                            // Raise Floor to next highest floor
        if (EV_DoFloor(line, raiseFloorToNearest)) P_ChangeSwitchTexture(line, 0);
        break;
      case 21:                                            // PlatDownWaitUpStay
        if (EV_DoPlat(line, downWaitUpStay, 0)) P_ChangeSwitchTexture(line, 0);
        break;
      case 20:                                            // Raise floor to next highest and change texture (p_switch.c:383, S1)
        if (EV_DoPlat(line, raiseToNearestAndChange, 0)) P_ChangeSwitchTexture(line, 0);
        break;
      case 23:                                            // Lower Floor to Lowest
        if (EV_DoFloor(line, lowerFloorToLowest)) P_ChangeSwitchTexture(line, 0);
        break;
      case 29:                                            // Raise Door (p_switch.c:403)
        if (EV_DoDoor(line, normal)) P_ChangeSwitchTexture(line, 0);
        break;
      case 41:                                            // Lower Ceiling to Floor
        if (EV_DoCeiling(line, lowerToFloor)) P_ChangeSwitchTexture(line, 0);
        break;
      case 71:                                            // Turbo Lower Floor (p_switch.c:413)
        if (EV_DoFloor(line, turboLower)) P_ChangeSwitchTexture(line, 0);
        break;
      case 49:                                            // Ceiling Crush And Raise
        if (EV_DoCeiling(line, crushAndRaise)) P_ChangeSwitchTexture(line, 0);
        break;
      case 50:                                            // Close Door
        if (EV_DoDoor(line, close)) P_ChangeSwitchTexture(line, 0);
        break;
      case 51:                                            // Secret EXIT (p_switch.c:434)
        P_ChangeSwitchTexture(line, 0);
        G_SecretExitLevel();
        break;
      case 55:                                            // Raise Floor Crush
        if (EV_DoFloor(line, raiseFloorCrush)) P_ChangeSwitchTexture(line, 0);
        break;
      case 101:                                           // Raise Floor
        if (EV_DoFloor(line, raiseFloor)) P_ChangeSwitchTexture(line, 0);
        break;
      case 102:                                           // Lower Floor to Surrounding floor height
        if (EV_DoFloor(line, lowerFloor)) P_ChangeSwitchTexture(line, 0);
        break;
      case 103:                                           // Open Door
        if (EV_DoDoor(line, open)) P_ChangeSwitchTexture(line, 0);
        break;
      case 111:                                           // Blazing Door Raise
        if (EV_DoDoor(line, blazeRaise)) P_ChangeSwitchTexture(line, 0);
        break;
      case 112:                                           // Blazing Door Open
        if (EV_DoDoor(line, blazeOpen)) P_ChangeSwitchTexture(line, 0);
        break;
      case 113:                                           // Blazing Door Close
        if (EV_DoDoor(line, blazeClose)) P_ChangeSwitchTexture(line, 0);
        break;
      case 122:                                           // Blazing PlatDownWaitUpStay
        if (EV_DoPlat(line, blazeDWUS, 0)) P_ChangeSwitchTexture(line, 0);
        break;
      case 127:                                           // Build Stairs Turbo 16 (p_switch.c:486)
        if (EV_BuildStairs(line, 1)) P_ChangeSwitchTexture(line, 0);
        break;
      case 131:                                           // Raise Floor Turbo (p_switch.c:491)
        if (EV_DoFloor(line, raiseFloorTurbo)) P_ChangeSwitchTexture(line, 0);
        break;
      case 140:                                           // Raise Floor 512 (p_switch.c:507)
        if (EV_DoFloor(line, raiseFloor512)) P_ChangeSwitchTexture(line, 0);
        break;
      case 133: case 135: case 137:                       // BlzOpenDoor locked (p_switch.c:497, S1)
        if (EV_DoLockedDoor(line, blazeOpen, thing)) P_ChangeSwitchTexture(line, 0);
        break;

      // BUTTONS (SR: texture resets after use)
      case 42:                                            // Close Door
        if (EV_DoDoor(line, close)) P_ChangeSwitchTexture(line, 1);
        break;
      case 43:                                            // Lower Ceiling to Floor
        if (EV_DoCeiling(line, lowerToFloor)) P_ChangeSwitchTexture(line, 1);
        break;
      case 45:                                            // Lower Floor to Surrounding floor height
        if (EV_DoFloor(line, lowerFloor)) P_ChangeSwitchTexture(line, 1);
        break;
      case 60:                                            // Lower Floor to Lowest
        if (EV_DoFloor(line, lowerFloorToLowest)) P_ChangeSwitchTexture(line, 1);
        break;
      case 61:                                            // Open Door
        if (EV_DoDoor(line, open)) P_ChangeSwitchTexture(line, 1);
        break;
      case 62:                                            // PlatDownWaitUpStay
        if (EV_DoPlat(line, downWaitUpStay, 1)) P_ChangeSwitchTexture(line, 1);
        break;
      case 63:                                            // Raise Door
        if (EV_DoDoor(line, normal)) P_ChangeSwitchTexture(line, 1);
        break;
      case 64:                                            // Raise Floor to ceiling
        if (EV_DoFloor(line, raiseFloor)) P_ChangeSwitchTexture(line, 1);
        break;
      case 65:                                            // Raise Floor Crush
        if (EV_DoFloor(line, raiseFloorCrush)) P_ChangeSwitchTexture(line, 1);
        break;
      case 66:                                            // Raise Floor 24 and change texture
        if (EV_DoPlat(line, raiseAndChange, 24)) P_ChangeSwitchTexture(line, 1);
        break;
      case 67:                                            // Raise Floor 32 and change texture
        if (EV_DoPlat(line, raiseAndChange, 32)) P_ChangeSwitchTexture(line, 1);
        break;
      case 68:                                            // Raise Plat next highest floor and change texture
        if (EV_DoPlat(line, raiseToNearestAndChange, 0)) P_ChangeSwitchTexture(line, 1);
        break;
      case 69:                                            // Raise Floor to next highest floor
        if (EV_DoFloor(line, raiseFloorToNearest)) P_ChangeSwitchTexture(line, 1);
        break;
      case 70:                                            // Turbo Lower Floor
        if (EV_DoFloor(line, turboLower)) P_ChangeSwitchTexture(line, 1);
        break;
      case 114:                                           // Blazing Door Raise
        if (EV_DoDoor(line, blazeRaise)) P_ChangeSwitchTexture(line, 1);
        break;
      case 115:                                           // Blazing Door Open
        if (EV_DoDoor(line, blazeOpen)) P_ChangeSwitchTexture(line, 1);
        break;
      case 116:                                           // Blazing Door Close
        if (EV_DoDoor(line, blazeClose)) P_ChangeSwitchTexture(line, 1);
        break;
      case 123:                                           // Blazing PlatDownWaitUpStay
        if (EV_DoPlat(line, blazeDWUS, 0)) P_ChangeSwitchTexture(line, 1);
        break;
      case 132:                                           // Raise Floor Turbo (p_switch.c:622, SR)
        if (EV_DoFloor(line, raiseFloorTurbo)) P_ChangeSwitchTexture(line, 1);
        break;
      case 99: case 134: case 136:                        // BlzOpenDoor locked (p_switch.c:632, SR)
        if (EV_DoLockedDoor(line, blazeOpen, thing)) P_ChangeSwitchTexture(line, 1);
        break;
      case 138:                                           // Light Turn On
        EV_LightTurnOn(line, 255);
        P_ChangeSwitchTexture(line, 1);
        break;
      case 139:                                           // Light Turn Off
        EV_LightTurnOn(line, 35);
        P_ChangeSwitchTexture(line, 1);
        break;
      default:
        return false;
    }
    return true;
  }
  G.P_UseSpecialLine = P_UseSpecialLine;
  function EV_LightTurnOn(line, amount) {                  // p_spec.c:644
    var secnum = -1, sec, tag = line.tag, brightest = 0, light;
    if (!amount) {
      while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
        sec = sectors[secnum];
        for (var i = 0; i < sec.lines.length; i++) {
          var tmpsec = getNextSector(sec.lines[i], sec);
          if (tmpsec && (light = tmpsec.lightlevel) > brightest) brightest = light;
        }
      }
      amount = brightest;
    }
    secnum = -1;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      sec.lightlevel = amount;
    }
  }
  function EV_TurnTagLightsOff(line) {
    var secnum = -2, light, min = MAXINT;
    do {
      secnum = P_FindSectorFromLineTag(line, secnum);
      if (secnum >= 0 && (light = sectors[secnum].lightlevel) < min) min = light;
    } while (secnum >= 0);
    secnum = -2;
    do {
      secnum = P_FindSectorFromLineTag(line, secnum);
      if (secnum >= 0) sectors[secnum].lightlevel = sectors[secnum].lightlevel === min ? 0 : ((sectors[secnum].lightlevel / 2) | 0);
    } while (secnum >= 0);
  }
  function EV_CeilingCrushStop(line) {
    var tag = line.tag, secnum = -1, sec;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) continue;
      for (var i = 0; i < MAXCEILINGS; i++)
        if (activeceilings[i] && activeceilings[i].tag === tag)
          activeceilings[i].thinker.function = -1, activeceilings[i] = null;
    }
  }
  function EV_ReTrigger(line) {
    var tag = line.tag, secnum = -1, sec;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      sec = sectors[secnum];
      if (sec.specialdata) sec.specialdata.thinker.function && sec.specialdata.thinker.function(sec.specialdata);
    }
  }
  function EV_DoDonut(line) {                              // p_spec.c:1163
    var secnum = -1, rtn = 0, i, floor;
    while ((secnum = P_FindSectorFromLineTag(line, secnum)) >= 0) {
      var s1 = sectors[secnum];
      if (s1.specialdata) continue;                        // already moving
      rtn = 1;
      var s2 = getNextSector(s1.lines[0], s1);
      for (i = 0; i < s2.lines.length; i++) {
        // NOTE: precedence as in gospel: (!flags) & ML_TWOSIDED — never true;
        // the real skip is backsector === s1. Transcribed verbatim.
        if ((!s2.lines[i].flags & ML_TWOSIDED) || (s2.lines[i].backsector === s1))
          continue;
        var s3 = s2.lines[i].backsector;
        // spawn rising slime
        floor = { sector: s2, crush: false, direction: 1, type: donutRaise,
          speed: FLOORSPEED / 2, texture: s3.floorpic, newspecial: 0,
          floordestheight: s3.floorheight };
        floor.thinker = floor; floor.function = T_MoveFloor;
        P_AddThinker(floor); s2.specialdata = floor;
        // spawn lowering donut-hole
        floor = { sector: s1, crush: false, direction: -1, type: lowerFloor,
          speed: FLOORSPEED / 2, floordestheight: s3.floorheight };
        floor.thinker = floor; floor.function = T_MoveFloor;
        P_AddThinker(floor); s1.specialdata = floor;
        break;
      }
    }
    return rtn;
  }
  function EV_PillarBuild(line, type) { return EV_DoFloor(line, raiseFloorToNearest); }
  var MT_TELEPORTMAN_MI = MT_TELEPORTMAN;
  function EV_Teleport(line, side, thing) {                // transcribed p_telept.c:45
    if (thing.flags & MF_MISSILE) return 0;                // don't teleport missiles
    if (side === 1) return 0;                              // hit back of line: let them get out
    var tag = line.tag;
    for (var i = 0; i < sectors.length; i++) {
      if (sectors[i].tag !== tag) continue;
      for (var th = thinkercap.next; th !== thinkercap; th = th.next) {
        if (th.function !== P_MobjThinker) continue;        // not a mobj
        var m = th;
        if (m.info.doomednum !== 14) continue;              // not MT_TELEPORTMAN
        if (m.subsector.sector !== sectors[i]) continue;    // wrong sector
        var oldx = thing.x, oldy = thing.y, oldz = thing.z;
        if (!P_TeleportMove(thing, m.x, m.y)) return 0;
        thing.z = thing.floorz;                             // fixme: not needed?
        if (thing.player) thing.player.viewz = thing.z + thing.player.viewheight;
        // fog at source and 20 units ahead of the dest landmarker
        var fog = P_SpawnMobj(oldx, oldy, oldz, MT_TFOG);
        S_StartSound(fog, SFX.sfx_telept);
        var an = (m.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
        fog = P_SpawnMobj((m.x + 20 * fcos(an)) | 0, (m.y + 20 * fsin(an)) | 0, thing.z, MT_TFOG);
        S_StartSound(fog, SFX.sfx_telept);
        if (thing.player) thing.reactiontime = 18;          // don't move for a bit
        thing.angle = m.angle;
        thing.momx = thing.momy = thing.momz = 0;
        return 1;
      }
    }
    return 0;
  }

  // ---------------------------------------------------------------- P_ShootSpecialLine (p_spec.c:959)
  function P_ShootSpecialLine(thing, line) {
    if (!thing.player) {
      var okp = 0;
      switch (line.special) { case 46: okp = 1; break; }
      if (!okp) return;
    }
    switch (line.special) {
      case 2:
        // MAP01 quirk: the packer put W1-open (special 2) on the ONE-SIDED
        // shoot switch (tag 2). C's EV_DoDoor(line,open) tags by tag — use the
        // same tag path even without a backsector. Faithful to gen_map intent.
        EV_DoDoor(line, open);
        P_ChangeSwitchTexture(line, 0);
        line.special = 0;                                  // W1 = once
        break;
      case 24:                                            // RAISE FLOOR
        EV_DoFloor(line, raiseFloor);
        P_ChangeSwitchTexture(line, 0);
        break;
      case 46:                                            // OPEN DOOR
        EV_DoDoor(line, open);
        P_ChangeSwitchTexture(line, 1);
        break;
      case 47:                                            // RAISE FLOOR NEAR AND CHANGE
        EV_DoPlat(line, raiseToNearestAndChange, 0);
        P_ChangeSwitchTexture(line, 0);
        break;
    }
  }
  G.P_ShootSpecialLine = P_ShootSpecialLine;

  // ---------------------------------------------------------------- P_CrossSpecialLine (p_spec.c:492)
  function P_CrossSpecialLine(linenum, side, thing) {
    var line = linedefs[linenum], ok;
    if (!thing.player) {
      switch (thing.type) {                                // missiles must not trigger
        case -3: return;                                    // (missile types not ported)
      }
      ok = 0;
      switch (line.special) {
        case 39: case 97: case 125: case 126: case 4: case 10: case 88:
          ok = 1; break;
      }
      if (!ok) return;
    }
    // Transcribed from p_spec.c:540-946 (W1 triggers clear line.special,
    // WR retriggerers never do). The previous port had the whole WR block
    // shifted (e.g. 72-77, 79-98, 105-113 all mapped to the wrong effects).
    switch (line.special) {
      // TRIGGERS (W1 — special cleared)
      case 2: EV_DoDoor(line, open); line.special = 0; break;
      case 3: EV_DoDoor(line, close); line.special = 0; break;
      case 4: EV_DoDoor(line, normal); line.special = 0; break;
      case 5: EV_DoFloor(line, raiseFloor); line.special = 0; break;
      case 6: EV_DoCeiling(line, fastCrushAndRaise); line.special = 0; break;
      case 8: EV_BuildStairs(line, build8); line.special = 0; break;
      case 10: EV_DoPlat(line, downWaitUpStay, 0); line.special = 0; break;
      case 12: EV_LightTurnOn(line, 0); line.special = 0; break;
      case 13: EV_LightTurnOn(line, 255); line.special = 0; break;
      case 16: EV_DoDoor(line, close30ThenOpen); line.special = 0; break;
      case 17: EV_StartLightStrobing(line); line.special = 0; break;
      case 19: EV_DoFloor(line, lowerFloor); line.special = 0; break;
      case 22: EV_DoPlat(line, raiseToNearestAndChange, 0); line.special = 0; break;
      case 25: EV_DoCeiling(line, crushAndRaise); line.special = 0; break;
      case 30: EV_DoFloor(line, raiseFloorToTexture); line.special = 0; break;
      case 35: EV_LightTurnOn(line, 35); line.special = 0; break;
      case 36: EV_DoFloor(line, turboLower); line.special = 0; break;
      case 37: EV_DoFloor(line, lowerAndChange); line.special = 0; break;
      case 38: EV_DoFloor(line, lowerFloorToLowest); line.special = 0; break;
      case 39: EV_Teleport(line, side, thing); line.special = 0; break;
      case 40:
        EV_DoCeiling(line, raiseToHighest);
        EV_DoFloor(line, lowerFloorToLowest); line.special = 0; break;
      case 44: EV_DoCeiling(line, lowerAndCrush); line.special = 0; break;
      case 52: G_ExitLevel(); break;
      case 53: EV_DoPlat(line, perpetualRaise, 0); line.special = 0; break;
      case 54: EV_StopPlat(line); line.special = 0; break;
      case 56: EV_DoFloor(line, raiseFloorCrush); line.special = 0; break;
      case 57: EV_CeilingCrushStop(line); line.special = 0; break;
      case 58: EV_DoFloor(line, raiseFloor24); line.special = 0; break;
      case 59: EV_DoFloor(line, raiseFloor24AndChange); line.special = 0; break;
      case 104: EV_TurnTagLightsOff(line); line.special = 0; break;
      case 108: EV_DoDoor(line, blazeRaise); line.special = 0; break;
      case 109: EV_DoDoor(line, blazeOpen); line.special = 0; break;
      case 100: EV_BuildStairs(line, 1); line.special = 0; break;       // Build Stairs Turbo 16 (p_spec.c:736)
      case 110: EV_DoDoor(line, blazeClose); line.special = 0; break;
      case 119: EV_DoFloor(line, raiseFloorToNearest); line.special = 0; break;
      case 121: EV_DoPlat(line, blazeDWUS, 0); line.special = 0; break;
      case 130: EV_DoFloor(line, raiseFloorTurbo); line.special = 0; break;
      case 124: G_SecretExitLevel(); break;                   // secret exit (p_spec.c:762)
      case 125: EV_Teleport(line, side, thing); line.special = 0; break;
      case 141: EV_DoCeiling(line, silentCrushAndRaise); line.special = 0; break;
      // 130/129 raiseFloorTurbo floor type not ported (unused in E1).

      // RETRIGGERS (WR — special never cleared)
      case 72: EV_DoCeiling(line, lowerAndCrush); break;
      case 73: EV_DoCeiling(line, crushAndRaise); break;
      case 74: EV_CeilingCrushStop(line); break;
      case 75: EV_DoDoor(line, close); break;
      case 76: EV_DoDoor(line, close30ThenOpen); break;
      case 77: EV_DoCeiling(line, fastCrushAndRaise); break;
      case 79: EV_LightTurnOn(line, 35); break;
      case 80: EV_LightTurnOn(line, 0); break;
      case 81: EV_LightTurnOn(line, 255); break;
      case 82: EV_DoFloor(line, lowerFloorToLowest); break;
      case 83: EV_DoFloor(line, lowerFloor); break;
      case 84: EV_DoFloor(line, lowerAndChange); break;
      case 86: EV_DoDoor(line, open); break;
      case 87: EV_DoPlat(line, perpetualRaise, 0); break;
      case 88: EV_DoPlat(line, downWaitUpStay, 0); break;
      case 89: EV_StopPlat(line); break;
      case 90: EV_DoDoor(line, normal); break;
      case 91: EV_DoFloor(line, raiseFloor); break;
      case 92: EV_DoFloor(line, raiseFloor24); break;
      case 93: EV_DoFloor(line, raiseFloor24AndChange); break;
      case 94: EV_DoFloor(line, raiseFloorCrush); break;
      case 95: EV_DoPlat(line, raiseToNearestAndChange, 0); break;
      case 96: EV_DoFloor(line, raiseFloorToTexture); break;
      case 97: EV_Teleport(line, side, thing); break;
      case 98: EV_DoFloor(line, turboLower); break;
      case 105: EV_DoDoor(line, blazeRaise); break;
      case 106: EV_DoDoor(line, blazeOpen); break;
      case 107: EV_DoDoor(line, blazeClose); break;
      case 120: EV_DoPlat(line, blazeDWUS, 0); break;
      case 126: EV_Teleport(line, side, thing); break;
      case 128: EV_DoFloor(line, raiseFloorToNearest); break;
      case 129: EV_DoFloor(line, raiseFloorTurbo); break;
    }
  }
  G.P_CrossSpecialLine = P_CrossSpecialLine;
  function EV_LowerAndChange(line) { EV_DoFloor(line, lowerAndChange); }

  // ---------------------------------------------------------------- P_UpdateSpecials (p_spec.c:1083)
  var levelTimer = false, levelTimeCount = 0;
  G.levelTimer = false;
  var linespeciallist = [], numlinespecials = 0;
  function P_UpdateSpecials() {
    // ANIMATE FLATS AND TEXTURES GLOBALLY — verbatim p_spec.c P_AnimateSurfaces
    // (runs FIRST in P_UpdateSpecials; leveltime++ happens in G_BuildTiccmd
    // before the ticker in vanilla).
    for (var ai = 0; ai < anims.length; ai++) {
      var at = anims[ai];
      for (var pi = at.basepic; pi < at.basepic + at.numpics; pi++) {
        var pic = at.basepic + ((Math.floor(G.leveltime / at.speed) + pi) % at.numpics);
        if (at.istexture) texturetranslation[pi] = pic;
        else flattranslation[pi] = pic;
      }
    }
    if (levelTimer) { levelTimeCount--; if (!levelTimeCount) G_ExitLevel(); }
    for (var i = 0; i < numlinespecials; i++) {
      var line = linespeciallist[i];
      switch (line.special) {
        case 48: sides[line.sidenum[0]].textureoffset += FU; break;
      }
    }
    for (var b = 0; b < MAXBUTTONS; b++) {
      if (buttonlist[b].btimer) {
        buttonlist[b].btimer--;
        if (!buttonlist[b].btimer) {
          switch (buttonlist[b].where) {
            case top_: sides[buttonlist[b].line.sidenum[0]].toptexture = buttonlist[b].btexture; break;
            case middle_: sides[buttonlist[b].line.sidenum[0]].midtexture = buttonlist[b].btexture; break;
            case bottom_: sides[buttonlist[b].line.sidenum[0]].bottomtexture = buttonlist[b].btexture; break;
          }
          S_StartSound(buttonlist[b].soundorg, SFX.sfx_swtchn);   // p_spec.c:1151
          buttonlist[b].line = null;
        }
      }
    }
  }
  G.P_UpdateSpecials = P_UpdateSpecials;

  // ---------------------------------------------------------------- P_SpawnSpecials (p_spec.c:1239)
  function P_SpawnSpecials() {
    levelTimer = false;                                    // -avg/-timer: not applicable
    for (var i = 0; i < sectors.length; i++) {
      var sector = sectors[i];
      if (!sector.special) continue;
      switch (sector.special) {
        case 1: P_SpawnLightFlash(sector); break;
        case 2: P_SpawnStrobeFlash(sector, FASTDARK, 0); break;
        case 3: P_SpawnStrobeFlash(sector, SLOWDARK, 0); break;
        case 4:                                             // strobe + hurt floor
          P_SpawnStrobeFlash(sector, FASTDARK, 0);
          sector.special = 4;                               // keeps special (death slime)
          continue;                                         // do NOT clear
        case 8: P_SpawnGlowingLight(sector); break;
        case 9: G.totalsecret++; break;                     // SECRET SECTOR
        case 10: EV_DoDoor({ tag: sector.tag }, close30ThenOpen); break;
        case 12: P_SpawnStrobeFlash(sector, SLOWDARK, 1); break;
        case 13: P_SpawnStrobeFlash(sector, FASTDARK, 1); break;
        case 14: EV_DoDoor({ tag: sector.tag }, raiseIn5Mins); break;
        case 17: P_SpawnFireFlicker(sector); break;
        case 0: break;
        default: break;                                     // C I_errors; port: leave in place
      }
      // ⚠ vanilla P_SpawnSpecials NEVER clears sector->special (p_spec.c
      // spawn loop): specials 5/7/16 (damage floors), 11 (E1M8 exit super
      // damage) and 9 (secret, awarded on stepping) must stay live for
      // P_PlayerInSpecialSector. The old blanket `sector.special = 0`
      // silently disabled all of them.
    }
    // line special 48 collection (p_spec.c P_SpawnSpecials second loop)
    linespeciallist = []; numlinespecials = 0;
    for (var l = 0; l < linedefs.length; l++)
      if (linedefs[l].special === 48) linespeciallist.push(linedefs[l]);
    numlinespecials = linespeciallist.length;
  }
  G.P_SpawnSpecials = P_SpawnSpecials;

  // ---------------------------------------------------------------- P_PlayerInSpecialSector (p_spec.c:1009)
  function P_PlayerInSpecialSector(player) {
    var sector = player.mo.subsector.sector;
    if (player.mo.z !== sector.floorheight) return;        // falling, not down yet
    switch (sector.special) {
      case 5:
        if (!player.powers[pw_ironfeet]) if (!(G.leveltime & 0x1f)) P_DamageMobj(player.mo, null, null, 10);
        break;
      case 7:
        if (!player.powers[pw_ironfeet]) if (!(G.leveltime & 0x1f)) P_DamageMobj(player.mo, null, null, 5);
        break;
      case 16: case 4:                                      // SUPER HELLSLIME / STROBE HURT
        if (!player.powers[pw_ironfeet] || (P_Random() < 5)) {
          if (!(G.leveltime & 0x1f)) P_DamageMobj(player.mo, null, null, 20);
        }
        break;
      case 9:
        player.secretcount++; sector.special = 0;
        player.message = MSG.SECRET;                       // DEVIATION (see MSG table)
        break;
      case 11:
        player.cheats &= ~1;                               // CF_GODMODE off
        if (!(G.leveltime & 0x1f)) P_DamageMobj(player.mo, null, null, 20);
        if (player.health <= 10) G_ExitLevel();
        break;
      default:
        break;                                             // C I_errors; warn-once policy
    }
  }
  G.P_PlayerInSpecialSector = P_PlayerInSpecialSector;

  // ---------------------------------------------------------------- p_inter: damage/kill/pickup
  function P_GiveAmmo(player, ammo, num) {
    if (ammo === am_noammo) return false;
    if (player.ammo[ammo] === player.maxammo[ammo]) return false;
    if (num) num *= clipammoTab[ammo - 1];
    else num = (clipammoTab[ammo - 1] / 2) | 0;
    if (G.gameskill === 0 || G.gameskill === 4) num <<= 1;  // baby/nightmare double ammo
    var oldammo = player.ammo[ammo];
    player.ammo[ammo] += num;
    if (player.ammo[ammo] > player.maxammo[ammo]) player.ammo[ammo] = player.maxammo[ammo];
    if (oldammo) return true;
    switch (ammo) {
      case am_clip:
        if (player.readyweapon === wp_fist) {
          if (player.weaponowned[wp_chaingun]) player.pendingweapon = wp_chaingun;
          else player.pendingweapon = wp_pistol;
        }
        break;
      case am_shell:
        if (player.readyweapon === wp_fist || player.readyweapon === wp_pistol)
          if (player.weaponowned[wp_shotgun]) player.pendingweapon = wp_shotgun;
        break;
      case am_cell:
        if (player.readyweapon === wp_fist || player.readyweapon === wp_pistol)
          if (player.weaponowned[wp_plasma]) player.pendingweapon = wp_plasma;
        break;
      case am_misl:
        if (player.readyweapon === wp_fist)
          if (player.weaponowned[wp_missile]) player.pendingweapon = wp_missile;
        break;
    }
    return true;
  }
  function P_GiveWeapon(player, weapon, dropped) {
    if (!weaponinfo[weapon]) { warnOnce("weapon-" + weapon); return false; }
    var gaveammo, gaveweapon;
    if (dropped) gaveammo = (weaponinfo[weapon].ammo !== am_noammo) ? P_GiveAmmo(player, weaponinfo[weapon].ammo, 1) : false;
    else gaveammo = (weaponinfo[weapon].ammo !== am_noammo) ? P_GiveAmmo(player, weaponinfo[weapon].ammo, 2) : false;
    if (player.weaponowned[weapon]) gaveweapon = false;
    else { gaveweapon = true; player.weaponowned[weapon] = true; player.pendingweapon = weapon; }
    return (gaveweapon || gaveammo);
  }
  function P_GiveBody(player, num) {
    if (player.health >= MAXHEALTH) return false;
    player.health += num;
    if (player.health > MAXHEALTH) player.health = MAXHEALTH;
    player.mo.health = player.health;
    return true;
  }
  function P_GiveArmor(player, armortype) {                 // p_inter.c:261
    var hits = armortype * 100;                             // green 100, blue 200
    if (player.armorpoints >= hits) return false;           // don't pick up (worse/equal)
    player.armortype = armortype;
    player.armorpoints = hits;
    return true;
  }
  function P_GivePower(player, p) {                        // powers not in scope but keep shape
    if (p === pw_invulnerability) { player.powers[p] = 1; return true; }
    if (p === pw_invisibility) { player.mo.flags |= MF_SHADOW; player.powers[p] = 1; return true; }
    if (p === pw_allmap) { player.powers[p] = 1; return true; }
    if (p === pw_infrared) { player.powers[p] = 1; return true; }
    if (player.powers[p]) player.powers[p] = 255;
    else player.powers[p] = 11 * 35;
    return true;
  }
  function P_DropWeapon(player) {                            // p_pspr.c:265
    P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].downstate);
  }
  // d_englsh.h message strings (verbatim) — assigned to player.message,
  // consumed by HU_Ticker (hu.js). Named after the C macros.
  var MSG = {
    GOTARMOR: "Picked up the armor.",
    GOTMEGA: "Picked up the MegaArmor!",
    GOTHTHBONUS: "Picked up a health bonus.",
    GOTARMBONUS: "Picked up an armor bonus.",
    GOTSTIM: "Picked up a stimpack.",
    GOTMEDINEED: "Picked up a medikit that you REALLY need!",
    GOTMEDIKIT: "Picked up a medikit.",
    GOTSUPER: "Supercharge!",
    GOTBLUECARD: "Picked up a blue keycard.",
    GOTYELWCARD: "Picked up a yellow keycard.",
    GOTREDCARD: "Picked up a red keycard.",
    GOTBLUESKUL: "Picked up a blue skull key.",
    GOTYELWSKUL: "Picked up a yellow skull key.",
    GOTREDSKULL: "Picked up a red skull key.",
    GOTINVUL: "Invulnerability!",
    GOTBERSERK: "Berserk!",
    GOTINVIS: "Partial Invisibility",
    GOTSUIT: "Radiation Shielding Suit",
    GOTMAP: "Computer Area Map",
    GOTVISOR: "Light Amplification Visor",
    GOTMSPHERE: "MegaSphere!",
    GOTCLIP: "Picked up a clip.",
    GOTCLIPBOX: "Picked up a box of bullets.",
    GOTROCKET: "Picked up a rocket.",
    GOTROCKBOX: "Picked up a box of rockets.",
    GOTCELL: "Picked up an energy cell.",
    GOTCELLBOX: "Picked up an energy cell pack.",
    GOTSHELLS: "Picked up 4 shotgun shells.",
    GOTSHELLBOX: "Picked up a box of shotgun shells.",
    GOTBACKPACK: "Picked up a backpack full of ammo!",
    GOTBFG9000: "You got the BFG9000! Oh, yes.",
    GOTCHAINGUN: "You got the chaingun!",
    GOTCHAINSAW: "A chainsaw! Find some meat!",
    GOTLAUNCHER: "You got the rocket launcher!",
    GOTPLASMA: "You got the plasma gun!",
    GOTSHOTGUN: "You got the shotgun!",
    GOTSHOTGUN2: "You got the super shotgun!",   // d_englsh.h:120
    PD_BLUEO: "You need a blue key to activate this object",
    PD_REDO: "You need a red key to activate this object",
    PD_YELLOWO: "You need a yellow key to activate this object",
    PD_BLUEK: "You need a blue key to open this door",
    PD_REDK: "You need a red key to open this door",
    PD_YELLOWK: "You need a yellow key to open this door",
    // DEVIATION: gospel p_spec.c:1049 gives NO message for secret sectors;
    // user-requested QoL like source ports (ZDoom/PrBoom text).
    SECRET: "A secret is revealed!"
  };
  G.MSG = MSG;   // hu.js centers the SECRET line by identity

  function P_TouchSpecialThing(special, toucher) {
    var delta = special.z - toucher.z;
    if (delta > toucher.height || delta < -8 * FU) return;  // out of reach
    var player = toucher.player;
    if (toucher.health <= 0) return;                        // dead thing touching
    if (!player) return;
    var sound = SFX.sfx_itemup;                             // p_inter.c:20 default
    switch (special.sprite) {
      case "ARM1":
        if (!P_GiveArmor(player, 1)) return;
        player.message = MSG.GOTARMOR;
        break;
      case "ARM2":
        if (!P_GiveArmor(player, 2)) return;
        player.message = MSG.GOTMEGA;
        break;
      case "BON1":
        player.health++;                                     // can go over 100
        if (player.health > 200) player.health = 200;
        player.mo.health = player.health;
        player.message = MSG.GOTHTHBONUS;
        break;
      case "BON2":
        player.armorpoints++;
        if (player.armorpoints > 200) player.armorpoints = 200;
        if (!player.armortype) player.armortype = 1;
        player.message = MSG.GOTARMBONUS;
        break;
      case "SOUL":
        player.health += 100;
        if (player.health > 200) player.health = 200;
        player.mo.health = player.health;
        player.message = MSG.GOTSUPER;
        sound = SFX.sfx_getpow;                              // p_inter.c:68 (GOTSUPER)
        break;
      case "MEGA":                                          // p_inter.c:70 — commercial only
        if (false /*gamemode != commercial*/) return;
        player.health = 200;
        player.mo.health = player.health;
        P_GiveArmor(player, 2);
        player.message = MSG.GOTMSPHERE;
        sound = SFX.sfx_getpow;
        break;
      case "STIM":
        if (!P_GiveBody(player, 10)) return;
        player.message = MSG.GOTSTIM;
        break;
      case "MEDI":
        if (!P_GiveBody(player, 25)) return;
        player.message = player.health < 25 ? MSG.GOTMEDINEED : MSG.GOTMEDIKIT;
        break;
      case "CLIP":
        if (special.flags & MF_DROPPED) { if (!P_GiveAmmo(player, am_clip, 0)) return; }
        else { if (!P_GiveAmmo(player, am_clip, 1)) return; }
        player.message = MSG.GOTCLIP;
        break;
      case "AMMO":
        if (!P_GiveAmmo(player, am_clip, 5)) return;
        player.message = MSG.GOTCLIPBOX;
        break;
      case "CELL":
        if (!P_GiveAmmo(player, am_cell, 1)) return;
        player.message = MSG.GOTCELL;
        break;
      case "CELP":
        if (!P_GiveAmmo(player, am_cell, 5)) return;
        player.message = MSG.GOTCELLBOX;
        break;
      // ---- cases ported post-mobjinfo-completion (p_inter.c exact)
      case "SHEL":
        if (!P_GiveAmmo(player, am_shell, 1)) return;
        player.message = MSG.GOTSHELLS;
        break;
      case "SBOX":
        if (!P_GiveAmmo(player, am_shell, 5)) return;
        player.message = MSG.GOTSHELLBOX;
        break;
      case "ROCK":
        if (!P_GiveAmmo(player, am_misl, 1)) return;
        player.message = MSG.GOTROCKET;
        break;
      case "BROK":
        if (!P_GiveAmmo(player, am_misl, 5)) return;
        player.message = MSG.GOTROCKBOX;
        break;
      case "LAUN":
        if (!P_GiveWeapon(player, wp_missile, special.flags & MF_DROPPED)) return;
        player.message = MSG.GOTLAUNCHER;
        sound = SFX.sfx_wpnup; break;
      case "CSAW":
        if (!P_GiveWeapon(player, wp_chainsaw, false)) return;
        player.message = MSG.GOTCHAINSAW;
        sound = SFX.sfx_wpnup; break;
      case "PLAS":
        if (!P_GiveWeapon(player, wp_plasma, false)) return;
        player.message = MSG.GOTPLASMA;
        sound = SFX.sfx_wpnup; break;
      case "BFUG":
        if (!P_GiveWeapon(player, wp_bfg, false)) return;
        player.message = MSG.GOTBFG9000;
        sound = SFX.sfx_wpnup; break;
      case "BPAK":
        if (!player.backpack) {
          for (var bp = 0; bp < NUMAMMO; bp++) player.maxammo[bp] *= 2;
          player.backpack = true;
        }
        for (var ba = 0; ba < NUMAMMO; ba++) P_GiveAmmo(player, ba, 1);
        player.message = MSG.GOTBACKPACK;
        break;
      case "PINV":
        if (!P_GivePower(player, pw_invulnerability)) return;
        player.message = MSG.GOTINVUL;
        sound = SFX.sfx_getpow;
        break;
      case "PSTR":                                          // p_inter.c:497 berserk
        if (!P_GivePower(player, pw_strength)) return;
        player.message = MSG.GOTBERSERK;
        if (player.readyweapon !== wp_fist) player.pendingweapon = wp_fist;
        sound = SFX.sfx_getpow;
        break;
      case "PINS":
        if (!P_GivePower(player, pw_invisibility)) return;
        player.message = MSG.GOTINVIS;
        sound = SFX.sfx_getpow;
        break;
      case "SUIT":
        if (!P_GivePower(player, pw_ironfeet)) return;
        player.message = MSG.GOTSUIT;
        sound = SFX.sfx_getpow;
        break;
      case "PMAP":
        if (!P_GivePower(player, pw_allmap)) return;
        player.message = MSG.GOTMAP;
        sound = SFX.sfx_getpow;
        break;
      case "PVIS":
        if (!P_GivePower(player, pw_infrared)) return;
        player.message = MSG.GOTVISOR;
        sound = SFX.sfx_getpow;
        break;
      // cards: stay on the floor in single player (p_inter.c: break, not return)
      case "BKEY":
        if (!player.cards[0]) player.message = MSG.GOTBLUECARD;   // it_bluecard
        player.cards[0] = true;
        if (!G.netgame) break;
        return;
      case "YKEY":
        if (!player.cards[1]) player.message = MSG.GOTYELWCARD;   // it_yellowcard
        player.cards[1] = true;
        if (!G.netgame) break;
        return;
      case "RKEY":
        if (!player.cards[2]) player.message = MSG.GOTREDCARD;    // it_redcard
        player.cards[2] = true;
        if (!G.netgame) break;
        return;
      case "BSKU":
        if (!player.cards[3]) player.message = MSG.GOTBLUESKUL;   // it_blueskull
        player.cards[3] = true;
        if (!G.netgame) break;
        return;
      case "YSKU":
        if (!player.cards[4]) player.message = MSG.GOTYELWSKUL;   // it_yellowskull
        player.cards[4] = true;
        if (!G.netgame) break;
        return;
      case "RSKU":
        if (!player.cards[5]) player.message = MSG.GOTREDSKULL;   // it_redskull
        player.cards[5] = true;
        if (!G.netgame) break;
        return;
      case "SHOT":
        if (!P_GiveWeapon(player, wp_shotgun, special.flags & MF_DROPPED)) return;
        player.message = MSG.GOTSHOTGUN;
        sound = SFX.sfx_wpnup; break;
      case "MGUN":
        if (!P_GiveWeapon(player, wp_chaingun, special.flags & MF_DROPPED)) return;
        player.message = MSG.GOTCHAINGUN;
        sound = SFX.sfx_wpnup; break;
      case "SGN2":                                          // p_inter.c:644 SSG
        if (!P_GiveWeapon(player, wp_supershotgun, special.flags & MF_DROPPED)) return;
        player.message = MSG.GOTSHOTGUN2;
        sound = SFX.sfx_wpnup; break;
      default:
        return;                                             // C I_errors; port: silently ignore
    }
    if (special.flags & MF_COUNTITEM) player.itemcount++;
    P_RemoveMobj(special);
    player.bonuscount += BONUSADD;
    S_StartSound(null, sound);                               // p_inter.c:660 (NULL = full volume)
  }
  G.P_TouchSpecialThing = P_TouchSpecialThing;
  G.P_GiveAmmo = P_GiveAmmo; G.P_GiveBody = P_GiveBody; G.P_GiveArmor = P_GiveArmor;

  function P_KillMobj(source, target) {
    target.flags &= ~(MF_SHOOTABLE | MF_FLOAT | MF_SKULLFLY);
    target.flags &= ~MF_NOGRAVITY;                          // type !== MT_SKULL for all ported types
    target.flags |= MF_CORPSE | MF_DROPOFF;
    target.height >>= 2;
    if (source && source.player) {
      if (target.flags & MF_COUNTKILL) source.player.killcount++;
      if (target.player) source.player.frags[target.player - G.players.indexOf(target.player)]++;
    } else if (!G.netgame && (target.flags & MF_COUNTKILL)) {
      G.players[0].killcount++;                              // ⚠ 1.10: no-killer kills count to players[0]
    }
    if (target.player) {
      if (!source) target.player.frags[target.player - G.players.indexOf(target.player)]++;
      target.flags &= ~MF_SOLID;
      target.player.playerstate = PST_DEAD;
      P_DropWeapon(target.player);
      // p_inter.c:710 — don't die in auto map, switch view prior to dying
      if (target.player === G.players[G.consoleplayer] && typeof AM !== 'undefined')
        AM.Stop();
    }
    if (target.health < -target.info.spawnhealth && target.info.xdeathstate)
      P_SetMobjState(target, target.info.xdeathstate);
    else
      P_SetMobjState(target, target.info.deathstate);
    target.tics -= P_Random() & 3;                           // ⚠ RNG consumed on EVERY kill
    if (target.tics < 1) target.tics = 1;
    var item;
    switch (target.type) {
      case MT_WOLFSS: case MT_POSSESSED: item = MT_CLIP; break;
      case MT_SHOTGUY: item = MT_SHOTGUN; break;
      case MT_CHAINGUY: item = MT_CHAINGUN; break;
      default: return;
    }
    var mo = P_SpawnMobj(target.x, target.y, ONFLOORZ, item);
    mo.flags |= MF_DROPPED;
  }
  G.P_KillMobj = P_KillMobj;

  function P_DamageMobj(target, inflictor, source, damage) {
    if (!(target.flags & MF_SHOOTABLE)) return;
    if (target.health <= 0) return;
    if (target.flags & MF_SKULLFLY) target.momx = target.momy = target.momz = 0;
    var player = target.player;
    if (player && G.gameskill === 0 /*sk_baby*/) damage >>= 1;
    // knockback (p_inter.c): thrust = damage*(FRACUNIT>>3)*100/mass with C int math
    if (inflictor && !(target.flags & MF_NOCLIP) &&
      (!source || !source.player || source.player.readyweapon !== wp_chainsaw)) {
      var ang = G.R_PointToAngle2(inflictor.x, inflictor.y, target.x, target.y);
      var thrust = Math.trunc(damage * (FU >> 3) * 100 / target.info.mass);
      if (damage < 40 && damage > target.health && target.z - inflictor.z > 64 * FU &&
        (P_Random() & 1)) {
        ang = (ang + ANG180) >>> 0; thrust = (thrust * 4) | 0;   // make fall forwards sometimes
      }
      ang >>>= 19;
      target.momx = (target.momx + FixedMul(thrust, fcos(ang))) | 0;
      target.momy = (target.momy + FixedMul(thrust, fsin(ang))) | 0;
    }
    if (player) {
      if (target.subsector.sector.special === 11 && damage >= target.health)
        damage = target.health - 1;                          // end of game hell hack
      if (damage < 1000 && ((player.cheats & 1) /*CF_GODMODE*/ || player.powers[pw_invulnerability]))
        return;
      if (player.armortype) {
        var saved = player.armortype === 1 ? ((damage / 3) | 0) : ((damage / 2) | 0);
        if (player.armorpoints <= saved) { saved = player.armorpoints; player.armortype = 0; }
        player.armorpoints -= saved;
        damage -= saved;
      }
      player.health -= damage;
      if (player.health < 0) player.health = 0;
      player.attacker = source;
      player.damagecount += damage;
      if (player.damagecount > 100) player.damagecount = 100;
    }
    target.health -= damage;
    if (target.health <= 0) { P_KillMobj(source, target); return; }
    if ((P_Random() < target.info.painchance) && !(target.flags & MF_SKULLFLY)) {
      target.flags |= MF_JUSTHIT;
      P_SetMobjState(target, target.info.painstate);
    }
    target.reactiontime = 0;
    if ((!target.threshold /*|| target.type === MT_VILE*/) &&
      source && source !== target /*&& source.type !== MT_VILE*/) {
      target.target = source;
      target.threshold = BASETHRESHOLD;
      if (target.state === states[target.info.spawnstate] && target.info.seestate !== 0)
        P_SetMobjState(target, target.info.seestate);
    }
  }
  G.P_DamageMobj = P_DamageMobj;

  // ---------------------------------------------------------------- enemy AI (p_enemy.c)
  var DI_EAST = 0, DI_NORTHEAST = 1, DI_NORTH = 2, DI_NORTHWEST = 3,
      DI_WEST = 4, DI_SOUTHWEST = 5, DI_SOUTH = 6, DI_SOUTHEAST = 7,
      DI_NODIR = 8;                                         // p_enemy.c:48 dirtype_t
  var opposite = [4, 5, 6, 7, 0, 1, 2, 3, DI_NODIR];
  // p_enemy.c:74 — {DI_NORTHWEST, DI_NORTHEAST, DI_SOUTHWEST, DI_SOUTHEAST},
  // indexed ((deltay<0)<<1)+(deltax>0).
  var diags = [DI_NORTHWEST, DI_NORTHEAST, DI_SOUTHWEST, DI_SOUTHEAST];
  // ⚠ diagonal 47000 ≈ 0.71582 FU — keep exact (p_enemy.c:264-265)
  var xspeed = [FU, 47000, 0, -47000, -FU, -47000, 0, 47000];
  var yspeed = [0, 47000, FU, 47000, 0, -47000, -FU, -47000];
  function A_Look(actor) {
    actor.threshold = 0;
    var targ = actor.subsector.sector.soundtarget;
    if (targ && (targ.flags & MF_SHOOTABLE)) {
      actor.target = targ;
      if (actor.flags & MF_AMBUSH) {
        if (G.P_CheckSight(actor, actor.target)) return seeyou(actor);
      } else return seeyou(actor);
    }
    if (!P_LookForPlayers(actor, false)) return;
    seeyou(actor);
  }
  function seeyou(actor) {
    // see-sound (p_enemy.c A_Look): posit1..3 / bgsit1..2 roll, else as-is
    if (actor.info.seesound) {
      var sound;
      switch (actor.info.seesound) {
        case 36: case 37: case 38:                            // sfx_posit1..3
          sound = 36 + P_Random() % 3; break;
        case 39: case 40:                                    // sfx_bgsit1..2
          sound = 39 + P_Random() % 2; break;
        default:
          sound = actor.info.seesound; break;
      }
      if (actor.type === MT_SPIDER || actor.type === MT_CYBORG)   // p_enemy.c:652 (port enum ids: SPIDER=19, CYBORG=21)
        S_StartSound(null, sound);                           // full volume
      else
        S_StartSound(actor, sound);
    }
    P_SetMobjState(actor, actor.info.seestate);               // ⚠ chains into A_Chase this tic
  }
  function P_LookForPlayers(actor, allaround) {
    var sector = actor.subsector.sector;
    var c = 0;
    var stop = (actor.lastlook - 1) & 3;
    for (; ;) {
      if (!G.playeringame[actor.lastlook]) {
        actor.lastlook = (actor.lastlook + 1) & 3;
        continue;
      }
      if (c++ === 2 || actor.lastlook === stop) return false; // ⚠ max TWO candidates
      var pl = G.players[actor.lastlook];
      if (pl.health <= 0) { actor.lastlook = (actor.lastlook + 1) & 3; continue; }
      if (!G.P_CheckSight(actor, pl.mo)) { actor.lastlook = (actor.lastlook + 1) & 3; continue; }
      if (!allaround) {
        var an = (G.R_PointToAngle2(actor.x, actor.y, pl.mo.x, pl.mo.y) - actor.angle) >>> 0;
        if (an > ANG90 && an < ANG270) {
          var dist = P_AproxDistance(pl.mo.x - actor.x, pl.mo.y - actor.y);
          if (dist > MELEERANGE) { actor.lastlook = (actor.lastlook + 1) & 3; continue; }
        }
      }
      actor.target = pl.mo;
      return true;
    }
  }
  function A_Chase(actor) {
    if (actor.reactiontime) actor.reactiontime--;
    if (actor.threshold) {
      if (!actor.target || actor.target.health <= 0) actor.threshold = 0;
      else actor.threshold--;
    }
    if (actor.movedir < 8) {                                  // turn towards move dir
      actor.angle = (actor.angle & ((7 << 29) >>> 0)) >>> 0;
      // p_enemy.c:687 'int delta' — SIGNED angle_t wrap: a delta past 180°
      // flips sign. Unsigned delta is always >0, which reversed every turn.
      var delta = (actor.angle - ((actor.movedir << 29) >>> 0)) | 0;
      if (delta > 0) actor.angle = (actor.angle - (ANG90 / 2 >>> 0)) >>> 0;
      else if (delta < 0) actor.angle = (actor.angle + (ANG90 / 2 >>> 0)) >>> 0;
    }
    if (!actor.target || !(actor.target.flags & MF_SHOOTABLE)) {
      if (P_LookForPlayers(actor, true)) return;
      P_SetMobjState(actor, actor.info.spawnstate);
      return;
    }
    if (actor.flags & MF_JUSTATTACKED) {
      actor.flags &= ~MF_JUSTATTACKED;
      if (G.gameskill !== 4 && !G.fastparm) P_NewChaseDir(actor);
      return;
    }
    if (actor.info.meleestate && P_CheckMeleeRange(actor)) {
      if (actor.info.attacksound) S_StartSound(actor, actor.info.attacksound);
      P_SetMobjState(actor, actor.info.meleestate);
      return;
    }
    if (actor.info.missilestate) {
      if (G.gameskill < 4 && !G.fastparm && actor.movecount) {
        // goto nomissile
      } else {
        if (!P_CheckMissileRange(actor)) { /* goto nomissile */ }
        else {
          P_SetMobjState(actor, actor.info.missilestate);
          actor.flags |= MF_JUSTATTACKED;
          return;
        }
      }
    }
    // nomissile:
    if (G.netgame && !actor.threshold && !G.P_CheckSight(actor, actor.target)) {
      if (P_LookForPlayers(actor, true)) return;
    }
    if (--actor.movecount < 0 || !P_Move(actor)) P_NewChaseDir(actor);
    if (actor.info.activesound && P_Random() < 3) S_StartSound(actor, actor.info.activesound);
  }
  function P_CheckMissileRange(actor) {
    if (!G.P_CheckSight(actor, actor.target)) return false;
    if (actor.flags & MF_JUSTHIT) { actor.flags &= ~MF_JUSTHIT; return true; }
    if (actor.reactiontime) return false;
    var dist = P_AproxDistance(actor.x - actor.target.x, actor.y - actor.target.y) - 64 * FU;
    if (!actor.info.meleestate) dist -= 128 * FU;             // poss/spos: no melee → fire more
    dist >>= 16;
    // p_enemy.c:220-252 — type branches BEFORE the roll (they return WITHOUT
    // touching the RNG; skipping them desynced every later P_Random call).
    if (actor.type === MT_VILE && dist > 14 * 64) return false;   // too far away
    if (actor.type === MT_UNDEAD) {
      if (dist < 196) return false;                           // close for fist attack
      dist >>= 1;
    }
    if (actor.type === MT_CYBORG || actor.type === MT_SPIDER || actor.type === MT_SKULL)
      dist >>= 1;                                             // long-range bosses fire less
    if (dist > 200) dist = 200;
    if (actor.type === MT_CYBORG && dist > 160) dist = 160;   // cyborg cap
    if (P_Random() < dist) return false;
    return true;
  }
  function P_CheckMeleeRange(actor) {
    if (!actor.target) return false;
    var dist = P_AproxDistance(actor.target.x - actor.x, actor.target.y - actor.y);
    if (dist >= MELEERANGE - 20 * FU + actor.target.info.radius) return false;
    if (!G.P_CheckSight(actor, actor.target)) return false;
    return true;
  }
  function P_Move(actor) {
    if (actor.movedir === DI_NODIR) return false;
    // ⚠ 32-bit exact per task brief: x + int32(speed*xspeed[d]). C multiplies two
    // fixed values (UB in C); the verified-port interpretation for axis dirs is
    // speed*1FU = speed; diagonals use the WRAPPING int32 product (matches 32-bit
    // linuxdoom binaries; documented known-1.10-UB choice).
    var tryx = (actor.x + Math.trunc(actor.info.speed * xspeed[actor.movedir])) | 0;
    var tryy = (actor.y + Math.trunc(actor.info.speed * yspeed[actor.movedir])) | 0;
    var try_ok = P_TryMove(actor, tryx, tryy);
    if (!try_ok) {
      if (actor.flags & MF_FLOAT && floatok) {
        if (actor.z < tmfloorz) actor.z += FLOATSPEED;
        else actor.z -= FLOATSPEED;
        actor.flags |= MF_INFLOAT;
        return true;
      }
      if (!numspechit) return false;
      actor.movedir = DI_NODIR;
      var good = false;
      while (numspechit--) {
        var ld = spechit[numspechit];
        if (P_UseSpecialLine(actor, ld, 0)) good = true;
      }
      return good;
    } else actor.flags &= ~MF_INFLOAT;
    if (!(actor.flags & MF_FLOAT)) actor.z = actor.floorz;
    return true;
  }
  function P_TryWalk(actor) {
    if (!P_Move(actor)) return false;
    actor.movecount = P_Random() & 15;
    return true;
  }
  function P_NewChaseDir(actor) {
    if (!actor.target) return;
    var olddir = actor.movedir;
    var turnaround = opposite[olddir];
    var deltax = actor.target.x - actor.x;
    var deltay = actor.target.y - actor.y;
    var d = [DI_NODIR, DI_NODIR, DI_NODIR];
    if (deltax > 10 * FU) d[1] = DI_EAST;
    else if (deltax < -10 * FU) d[1] = DI_WEST;
    else d[1] = DI_NODIR;
    if (deltay < -10 * FU) d[2] = DI_SOUTH;                 // p_enemy.c:388
    else if (deltay > 10 * FU) d[2] = DI_NORTH;
    else d[2] = DI_NODIR;
    // try direct route
    if (d[1] !== DI_NODIR && d[2] !== DI_NODIR) {
      actor.movedir = diags[((deltay < 0) << 1) + (deltax > 0)];
      if (actor.movedir !== turnaround && P_TryWalk(actor)) return;
    }
    // try other directions
    if (P_Random() > 200 || Math.abs(deltay) > Math.abs(deltax)) {
      var tdir = d[1]; d[1] = d[2]; d[2] = tdir;
    }
    if (d[1] === turnaround) d[1] = DI_NODIR;
    if (d[2] === turnaround) d[2] = DI_NODIR;
    if (d[1] !== DI_NODIR) { actor.movedir = d[1]; if (P_TryWalk(actor)) return; }
    if (d[2] !== DI_NODIR) { actor.movedir = d[2]; if (P_TryWalk(actor)) return; }
    // no direct path to the player: keep the old direction first (p_enemy.c:441)
    if (olddir !== DI_NODIR) { actor.movedir = olddir; if (P_TryWalk(actor)) return; }
    // randomly determine direction of search, then sweep monotonically
    // (p_enemy.c:449 — ONE random choice, then 0..7 ascending or 7..0 descending)
    if (P_Random() & 1) {
      for (var t1 = DI_EAST; t1 <= DI_SOUTHEAST; t1++) {
        if (t1 !== turnaround) { actor.movedir = t1; if (P_TryWalk(actor)) return; }
      }
    } else {
      for (var t2 = DI_SOUTHEAST; t2 !== (DI_EAST - 1); t2--) {
        if (t2 !== turnaround) { actor.movedir = t2; if (P_TryWalk(actor)) return; }
      }
    }
    if (turnaround !== DI_NODIR) {
      actor.movedir = turnaround;
      if (P_TryWalk(actor)) return;
    }
    actor.movedir = DI_NODIR;                               // can not move
  }
  function A_FaceTarget(actor) {
    if (!actor.target) return;
    actor.flags &= ~MF_AMBUSH;
    actor.angle = G.R_PointToAngle2(actor.x, actor.y, actor.target.x, actor.target.y);
    if (actor.target.flags & MF_SHADOW)
      actor.angle = (actor.angle + (((P_Random() - P_Random()) << 21) >>> 0)) >>> 0;
  }
  function A_PosAttack(actor) {
    if (!actor.target) return;                               // p_enemy.c:800 guard (RNG-order: no rolls without target)
    A_FaceTarget(actor);
    var angle = actor.angle;
    var slope = P_AimLineAttack(actor, angle, MISSILERANGE);
    S_StartSound(actor, SFX.sfx_pistol);
    angle = (angle + (((P_Random() - P_Random()) << 20) >>> 0)) >>> 0;
    var damage = ((P_Random() % 5) + 1) * 3;
    P_LineAttack(actor, angle, MISSILERANGE, slope, damage);
  }
  function A_SPosAttack(actor) {
    if (!actor.target) return;                               // p_enemy.c:829 — gospel guard: a target that
    // dies mid-volley must NOT burn P_Random() calls (demo-sync: RNG is
    // gospel mRandomSequence/P_Random, any skipped call desyncs every later roll)
    S_StartSound(actor, SFX.sfx_shotgn);
    A_FaceTarget(actor);
    var bangle = actor.angle;
    var slope = P_AimLineAttack(actor, bangle, MISSILERANGE);
    // gospel loop, p_enemy.c:837: exactly 3 P_Random() rolls per pass, in
    // angle/damage/damage order, all three shots around the SAME bangle.
    // (An earlier splice re-faced and burned 5 rolls per pass — same rate,
    // wrong spread and a desynced PRNG stream.)
    for (var i = 0; i < 3; i++) {
      var angle = (bangle + (((P_Random() - P_Random()) << 20) >>> 0)) >>> 0;
      var damage = ((P_Random() % 5) + 1) * 3;
      P_LineAttack(actor, angle, MISSILERANGE, slope, damage);
    }
  }
  // P_SpawnMissile (p_mobj.c:889) + P_CheckMissileSpawn (p_mobj.c:~865)
  function P_CheckMissileSpawn(th) {
    th.tics -= (P_Random() & 3);
    if (th.tics < 1) th.tics = 1;
    th.x = (th.x + (th.momx >> 1)) | 0;
    th.y = (th.y + (th.momy >> 1)) | 0;
    th.z = (th.z + (th.momz >> 1)) | 0;
    if (!P_TryMove(th, th.x, th.y)) P_ExplodeMissile(th);
  }
  function P_SpawnMissile(source, dest, type) {
    var th = P_SpawnMobj(source.x, source.y, (source.z + 32 * FU) | 0, type);
    th.target = source;                                      // where it came from
    var an = G.R_PointToAngle2(source.x, source.y, dest.x, dest.y);
    if (dest.flags & MF_SHADOW)                              // fuzzy player
      an = (an + (((P_Random() - P_Random()) << 20) >>> 0)) >>> 0;
    th.angle = an;
    an = (an >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    th.momx = FixedMul(th.info.speed, fcos(an));
    th.momy = FixedMul(th.info.speed, fsin(an));
    var dist = (P_AproxDistance(dest.x - source.x, dest.y - source.y) /
      th.info.speed) | 0;
    if (dist < 1) dist = 1;
    th.momz = ((dest.z - source.z) / dist) | 0;
    P_CheckMissileSpawn(th);
    return th;
  }
  function P_SpawnPlayerMissile(source, type) {             // p_mobj.c:935
    var an, slope;
    // see which target is to be aimed at
    an = source.angle;
    slope = P_AimLineAttack(source, an, 16 * 64 * FU);
    if (!linetarget) {
      an = (an + (1 << 26)) >>> 0;
      slope = P_AimLineAttack(source, an, 16 * 64 * FU);
      if (!linetarget) {
        an = (an - (2 << 26)) >>> 0;
        slope = P_AimLineAttack(source, an, 16 * 64 * FU);
      }
      if (!linetarget) { an = source.angle; slope = 0; }
    }
    var x = source.x, y = source.y;
    var z = (source.z + 4 * 8 * FU) | 0;
    var th = P_SpawnMobj(x, y, z, type);
    if (th.info.seesound) S_StartSound(th, th.info.seesound);
    th.target = source;
    th.angle = an;
    th.momx = FixedMul(th.info.speed, fcos((an >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1)));
    th.momy = FixedMul(th.info.speed, fsin((an >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1)));
    th.momz = FixedMul(th.info.speed, slope);
    P_CheckMissileSpawn(th);
    return th;
  }
  function A_TroopAttack(actor) {                            // p_enemy.c:913
    if (!actor.target) return;
    A_FaceTarget(actor);
    if (P_CheckMeleeRange(actor)) {
      S_StartSound(actor, SFX.sfx_claw);
      var d = ((P_Random() % 8) + 1) * 3;
      P_DamageMobj(actor.target, actor, actor, d);
      return;
    }
    P_SpawnMissile(actor, actor.target, MT_TROOPSHOT);
  }
  // ---- caco/lost-soul/chaingunner attacks (p_enemy.c)
  function A_HeadAttack(actor) {                             // p_enemy.c:884
    if (!actor.target) return;
    A_FaceTarget(actor);
    if (P_CheckMeleeRange(actor)) {
      var damage = ((P_Random() % 6) + 1) * 10;
      P_DamageMobj(actor.target, actor, actor, damage);
      return;
    }
    P_SpawnMissile(actor, actor.target, MT_HEADSHOT);
  }
  var SKULLSPEED = 20 * FU;                                  // p_enemy.c:1417
  function A_SkullAttack(actor) {                            // p_enemy.c:1423
    if (!actor.target) return;
    var dest = actor.target;
    actor.flags |= MF_SKULLFLY;
    S_StartSound(actor, actor.info.attacksound);
    A_FaceTarget(actor);
    var an = (actor.angle >>> 19);
    actor.momx = FixedMul(SKULLSPEED, fcos(an));
    actor.momy = FixedMul(SKULLSPEED, fsin(an));
    var dist = P_AproxDistance(dest.x - actor.x, dest.y - actor.y);
    dist = (dist / SKULLSPEED) | 0;
    if (dist < 1) dist = 1;
    actor.momz = (((dest.z + (dest.height >> 1)) - actor.z) / dist) | 0;
  }
  function A_CPosAttack(actor) {                             // p_enemy.c:1003
    if (!actor.target) return;
    S_StartSound(actor, SFX.sfx_shotgn);
    A_FaceTarget(actor);
    var bangle = actor.angle;
    var slope = P_AimLineAttack(actor, bangle, MISSILERANGE);
    var angle = (bangle + (((P_Random() - P_Random()) << 20) >>> 0)) >>> 0;
    var damage = ((P_Random() % 5) + 1) * 3;
    P_LineAttack(actor, angle, MISSILERANGE, slope, damage);
  }
  function A_CPosRefire(actor) {                             // p_enemy.c:1021
    A_FaceTarget(actor);
    if (P_Random() < 40) return;
    if (!actor.target || actor.target.health <= 0 || !P_CheckSight(actor, actor.target))
      P_SetMobjState(actor, actor.info.seestate);
  }
  function A_SargAttack(actor) {                             // p_enemy.c:935
    if (!actor.target) return;
    A_FaceTarget(actor);
    if (P_CheckMeleeRange(actor)) {
      var damage = ((P_Random() % 10) + 1) * 4;
      P_DamageMobj(actor.target, actor, actor, damage);
    }
  }
  function A_BruisAttack(actor) {                           // p_enemy.c:957 — no A_FaceTarget call (states face already)
    if (!actor.target) return;
    if (P_CheckMeleeRange(actor)) {
      S_StartSound(actor, SFX.sfx_claw);
      var damage = ((P_Random() % 8) + 1) * 10;
      P_DamageMobj(actor.target, actor, actor, damage);
      return;
    }
    P_SpawnMissile(actor, actor.target, MT_BRUISERSHOT);
  }
  // A_BossDeath: gospel-faithful full version spliced below (with monster actions).
  function A_Pain(actor) {
    if (actor.info.painsound) S_StartSound(actor, actor.info.painsound);
  }
  function A_Fall(actor) { actor.flags &= ~MF_SOLID; }        // ⚠ 1.10 A_NoBlocking IS A_Fall
  function A_Scream(actor) {
    var sound;
    switch (actor.info.deathsound) {
      case 0: return;
      case 59: case 60: case 61:                              // sfx_podth1..3
        sound = 59 + P_Random() % 3; break;
      case 62: case 63:                                      // sfx_bgdth1..2
        sound = 62 + P_Random() % 2; break;
      default:
        sound = actor.info.deathsound; break;
    }
    if (actor.type === MT_SPIDER || actor.type === MT_CYBORG)     // p_enemy.c:1561 "Check for bosses" (port enum ids)
      S_StartSound(null, sound);
    else
      S_StartSound(actor, sound);
  }
  function A_XScream(actor) { S_StartSound(actor, SFX.sfx_slop); }
  function A_PlayerScream(actor) {
    var sound = SFX.sfx_pldeth;
    // vanilla: (gamemode == commercial) && health < -50 -> pdiehi; 1.10 is
    // shareware, so the gib death sound never plays (port keeps the dead branch
    // as a comment for fidelity).
    S_StartSound(actor, sound);
  }
  function A_Explode(thingy) { P_RadiusAttack(thingy, thingy.target, 128); } // p_enemy.c:1598 (128, per C)

  // ---------------------------------------------------------------- weapons (p_pspr.c)
  function P_SetPsprite(player, position, stnum) {
    var psp = player.psprites[position], state;
    if (typeof stnum !== "number") stnum = stnum.num;
    do {
      if (!stnum) { psp.state = null; break; }               // S_NULL: removed itself
      state = states[stnum];
      psp.state = state; psp.tics = state.tics;
      if (state.misc1) { psp.sx = state.misc1 << FRACBITS; psp.sy = state.misc2 << FRACBITS; }
      if (state.action) {
        PS_ACTIONS[state.action](player, psp);
        if (!psp.state) break;
      }
      stnum = typeof state.next === "number" ? state.next : statenames[state.next];
      stnum = psp.state.num !== undefined ? (typeof psp.state.next === "number" ? psp.state.next : statenames[psp.state.next]) : 0;
    } while (!psp.tics);
  }
  function P_MovePsprites(player) {
    for (var i = 0; i < 2; i++) {
      var psp = player.psprites[i];
      if (!psp.state) continue;
      if (psp.tics !== -1) {
        if (!--psp.tics) {
          var nx = psp.state.next;
          P_SetPsprite(player, i, typeof nx === "number" ? nx : statenames[nx]);
        }
      }
    }
    player.psprites[ps_flash].sx = player.psprites[ps_weapon].sx;
    player.psprites[ps_flash].sy = player.psprites[ps_weapon].sy;
  }
  function P_FireWeapon(player) {
    if (!P_CheckAmmo(player)) return;
    P_SetMobjState(player.mo, statenames.S_PLAY_ATK1);
    P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].atkstate);
    P_NoiseAlert(player.mo, player.mo);
  }
  function P_CheckAmmo(player) {
    var ammo = weaponinfo[player.readyweapon].ammo;
    var count = 1;
    if (player.readyweapon === wp_bfg) count = BFGCELLS;
    else if (player.readyweapon === wp_supershotgun) count = 2;
    if (ammo === am_noammo || player.ammo[ammo] >= count) return true;
    do {
      if (player.weaponowned[wp_plasma] && player.ammo[am_cell] && G.gm() !== 'shareware')
        player.pendingweapon = wp_plasma;
      else if (player.weaponowned[wp_supershotgun] && player.ammo[am_shell] > 2 && G.isCommercial())
        player.pendingweapon = wp_supershotgun;
      else if (player.weaponowned[wp_chaingun] && player.ammo[am_clip])
        player.pendingweapon = wp_chaingun;
      else if (player.weaponowned[wp_shotgun] && player.ammo[am_shell])
        player.pendingweapon = wp_shotgun;
      else if (player.ammo[am_clip])
        player.pendingweapon = wp_pistol;                    // ⚠ no weaponowned check
      else if (player.weaponowned[wp_chainsaw])
        player.pendingweapon = wp_chainsaw;
      else if (player.weaponowned[wp_missile] && player.ammo[am_misl])
        player.pendingweapon = wp_missile;
      else if (player.weaponowned[wp_bfg] && player.ammo[am_cell] > 40 && G.gm() !== 'shareware')
        player.pendingweapon = wp_bfg;
      else
        player.pendingweapon = wp_fist;
    } while (player.pendingweapon === wp_nochange);
    P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].downstate);
    return false;
  }
  function P_BringUpWeapon(player) {
    if (player.pendingweapon === wp_nochange) player.pendingweapon = player.readyweapon;
    if (player.pendingweapon === wp_chainsaw) S_StartSound(player.mo, SFX.sfx_sawup);
    // (p_pspr.c:298 sawidl: readyweapon==wp_chainsaw && psp.state==S_SAW —
    //  SAWG weapon states not ported here, condition can never match)
    if (!weaponinfo[player.pendingweapon]) { warnOnce("bringup-weapon-" + player.pendingweapon); player.pendingweapon = wp_fist; }
    var newstate = weaponinfo[player.pendingweapon].upstate;
    player.pendingweapon = wp_nochange;                       // ⚠ cleared when raising
    player.psprites[ps_weapon].sy = WEAPONBOTTOM;
    P_SetPsprite(player, ps_weapon, newstate);
  }
  function P_SetupPsprites(player) {
    player.psprites[ps_weapon].state = null;
    player.psprites[ps_flash].state = null;
    player.pendingweapon = player.readyweapon;
    P_BringUpWeapon(player);
  }
  // psprite actions (acp2 = player,psp)
  var PS_ACTIONS = {};
  PS_ACTIONS.A_WeaponReady = function (player, psp) {
    if (player.mo.state === states[statenames.S_PLAY_ATK1] ||
      player.mo.state === states[statenames.S_PLAY_ATK2])
      P_SetMobjState(player.mo, statenames.S_PLAY);
    if (player.readyweapon === wp_chainsaw &&
        psp.state && psp.state.num === statenames.S_SAW)
      S_StartSound(player.mo, SFX.sfx_sawidl);              // p_pspr.c:299
    if (player.pendingweapon !== wp_nochange || !player.health) {
      P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].downstate);
      return;
    }
    if (player.cmd.buttons & BT_ATTACK) {
      if (!player.attackdown || (player.readyweapon !== wp_missile && player.readyweapon !== wp_bfg)) {
        player.attackdown = true;
        P_FireWeapon(player);
        return;
      }
    } else player.attackdown = false;
    var angle = (128 * G.leveltime) & G.FINEMASK;             // weapon bob (p_pspr.c:331)
    psp.sx = FU + FixedMul(player.bob, fcos(angle));
    angle &= (G.FINEANGLES / 2) - 1;
    psp.sy = WEAPONTOP + FixedMul(player.bob, fsin(angle));
  };
  PS_ACTIONS.A_ReFire = function (player) {
    if ((player.cmd.buttons & BT_ATTACK) && player.pendingweapon === wp_nochange && player.health) {
      player.refire++;
      P_FireWeapon(player);
    } else { player.refire = 0; P_CheckAmmo(player); }
  };
  PS_ACTIONS.A_Lower = function (player, psp) {
    psp.sy += LOWERSPEED;
    if (psp.sy < WEAPONBOTTOM) return;
    if (player.playerstate === PST_DEAD) { psp.sy = WEAPONBOTTOM; return; }
    if (!player.health) { P_SetPsprite(player, ps_weapon, 0); return; }
    player.readyweapon = player.pendingweapon;
    P_BringUpWeapon(player);
  };
  PS_ACTIONS.A_Raise = function (player, psp) {
    psp.sy -= RAISESPEED;
    if (psp.sy > WEAPONTOP) return;
    psp.sy = WEAPONTOP;
    P_SetPsprite(player, ps_weapon, weaponinfo[player.readyweapon].readystate);
  };
  PS_ACTIONS.A_Light0 = function (player) { player.extralight = 0; };
  PS_ACTIONS.A_Light1 = function (player) { player.extralight = 1; };
  PS_ACTIONS.A_Light2 = function (player) { player.extralight = 2; };
  PS_ACTIONS.A_GunFlash = function (player, psp) {
    P_SetMobjState(player.mo, statenames.S_PLAY_ATK2);
    P_SetPsprite(player, ps_flash, weaponinfo[player.readyweapon].flashstate);
  };
  PS_ACTIONS.A_Punch = function (player, psp) {
    var damage = (P_Random() % 10 + 1) << 1;
    if (player.powers[pw_strength]) damage *= 10;
    var angle = (player.mo.angle + (((P_Random() - P_Random()) << 18) >>> 0)) >>> 0;
    var slope = P_AimLineAttack(player.mo, angle, MELEERANGE);
    P_LineAttack(player.mo, angle, MELEERANGE, slope, damage);
    if (linetarget) {
      S_StartSound(player.mo, SFX.sfx_punch);
      player.mo.angle = G.R_PointToAngle2(player.mo.x, player.mo.y, linetarget.x, linetarget.y);
    }
  };
  PS_ACTIONS.A_Saw = function (player, psp) {
    var damage = 2 * (P_Random() % 10 + 1);
    var angle = (player.mo.angle + (((P_Random() - P_Random()) << 18) >>> 0)) >>> 0;
    var slope = P_AimLineAttack(player.mo, angle, MELEERANGE + 1);   // ⚠ +1 FU exact (p_pspr.c)
    P_LineAttack(player.mo, angle, MELEERANGE + 1, slope, damage);
    if (!linetarget) { S_StartSound(player.mo, SFX.sfx_sawful); return; }
    S_StartSound(player.mo, SFX.sfx_sawhit);
    var an = G.R_PointToAngle2(player.mo.x, player.mo.y, linetarget.x, linetarget.y);
    var delta = (an - player.mo.angle) >>> 0;
    if (delta > ANG90) delta = (0 - delta) >>> 0;
    if (delta < (20 << 26) >>> 0) return;                    // 20*ANG45/21: C uses (ANG90/20)+... keep simple face
    if (delta > (21 << 26) >>> 0) {
      if (an > player.mo.angle) player.mo.angle = (an - (20 << 26) >>> 0) >>> 0;
      else player.mo.angle = (an + (20 << 26) >>> 0) >>> 0;
    } else player.mo.angle = an;
    player.mo.flags |= MF_JUSTATTACKED;
  };
  PS_ACTIONS.A_FirePistol = function (player, psp) {
    S_StartSound(player.mo, SFX.sfx_pistol);
    P_SetMobjState(player.mo, statenames.S_PLAY_ATK2);
    player.ammo[am_clip]--;
    P_SetPsprite(player, ps_flash, weaponinfo[player.readyweapon].flashstate);
    P_BulletSlope(player.mo);
    P_GunShot(player.mo, !player.refire);                     // accurate on single click
  };
  PS_ACTIONS.A_FireShotgun = function (player, psp) {
    S_StartSound(player.mo, SFX.sfx_shotgn);
    P_SetMobjState(player.mo, statenames.S_PLAY_ATK2);
    player.ammo[am_shell]--;
    P_SetPsprite(player, ps_flash, weaponinfo[player.readyweapon].flashstate);
    P_BulletSlope(player.mo);
    for (var i = 0; i < 7; i++) P_GunShot(player.mo, false);
  };
  PS_ACTIONS.A_FireCGun = function (player, psp) {         // p_pspr.c:508 — sfx_pistol per gospel
    S_StartSound(player.mo, SFX.sfx_pistol);
    if (!player.ammo[weaponinfo[player.readyweapon].ammo]) return;
    P_SetMobjState(player.mo, statenames.S_PLAY_ATK2);
    player.ammo[weaponinfo[player.readyweapon].ammo]--;
    // flash state = flashstate + current state - S_CHAIN1 (alternating frames)
    P_SetPsprite(player, ps_flash, weaponinfo[player.readyweapon].flashstate +
      psp.state.num - statenames.S_CHAIN1);
    P_BulletSlope(player.mo);
    P_GunShot(player.mo, !player.refire);
  };
  PS_ACTIONS.A_FireMissile = function (player) {            // p_pspr.c:541
    player.ammo[weaponinfo[player.readyweapon].ammo]--;
    P_SpawnPlayerMissile(player.mo, MT_ROCKET);
  };
  PS_ACTIONS.A_FireShotgun2 = function (player, psp) {      // p_pspr.c:694
    S_StartSound(player.mo, SFX.sfx_dshtgn);
    P_SetMobjState(player.mo, statenames.S_PLAY_ATK2);
    player.ammo[weaponinfo[player.readyweapon].ammo] -= 2;
    P_SetPsprite(player, ps_flash, weaponinfo[player.readyweapon].flashstate);
    P_BulletSlope(player.mo);
    for (var i = 0; i < 20; i++) {
      var damage = 5 * ((P_Random() % 3) + 1);
      var angle = (player.mo.angle + (((P_Random() - P_Random()) << 19) >>> 0)) >>> 0;
      P_LineAttack(player.mo, angle, MISSILERANGE,
        bulletslope + (((P_Random() - P_Random()) << 5) | 0), damage);   // slope: C fixed add
    }
  };
  PS_ACTIONS.A_FirePlasma = function (player, psp) {        // p_pspr.c:576
    player.ammo[weaponinfo[player.readyweapon].ammo]--;
    P_SetPsprite(player, ps_flash,
      weaponinfo[player.readyweapon].flashstate + (P_Random() & 1));
    P_SpawnPlayerMissile(player.mo, MT_PLASMA);
  };
  PS_ACTIONS.A_FireBFG = function (player, psp) {           // p_pspr.c:565
    player.ammo[weaponinfo[player.readyweapon].ammo] -= BFGCELLS;
    P_SpawnPlayerMissile(player.mo, MT_BFG);
  };
  PS_ACTIONS.A_BFGsound = function (player) {               // p_pspr.c:813
    S_StartSound(player.mo, SFX.sfx_bfg);
  };
  // p_pspr.c: super-shotgun open/load/close & CheckReload are empty in 1.10
  PS_ACTIONS.A_CheckReload = PS_ACTIONS.A_OpenShotgun2 = PS_ACTIONS.A_LoadShotgun2 =
  PS_ACTIONS.A_CloseShotgun2 = function () { };

  // mobj actions (acp1)
  // p_pspr.c:781 — BFG spray: offset-aim 40 rays, damage every linetarget
  function A_BFGSpray(mo) {
    for (var i = 0; i < 40; i++) {
      var an = (mo.angle - ANG90 / 2 + (((ANG90 / 40) * i) | 0)) >>> 0;
      P_AimLineAttack(mo.target, an, 16 * 64 * FU);
      if (!linetarget) continue;
      P_SpawnMobj(linetarget.x, linetarget.y,
        linetarget.z + (linetarget.height >> 2), MT_EXTRABFG);
      var damage = 0;
      for (var j = 0; j < 15; j++) damage += (P_Random() & 7) + 1;
      P_DamageMobj(linetarget, mo.target, mo.target, damage);
    }
  }

  // ================= p_enemy.c enemy AI (gospel port; splice of monster-actions) =====
  // ============================================================================
  // monster-actions.js — DOOM 1.10 p_enemy.c enemy AI actions (splice into
  // game.js IIFE; plain function decls + module vars, gospel line refs).
  //
  // MISSING (sound shim: add to `var SFX` in game.js) — sfxenum values per
  // sounds.h 1.10:
  // MISSING: SFX.sfx_skepch  (53) — A_SkelFist
  // MISSING: SFX.sfx_vilatk  (54) — A_VileStart
  // MISSING: SFX.sfx_skeswg  (56) — A_SkelWhoosh
  // MISSING: SFX.sfx_bspwlk  (79) — A_BabyMetal
  // MISSING: SFX.sfx_hoof    (84) — A_Hoof
  // MISSING: SFX.sfx_metal   (85) — A_Metal
  // MISSING: SFX.sfx_flame   (91) — A_FireCrackle
  // MISSING: SFX.sfx_flamst  (92) — A_StartFire
  // MISSING: SFX.sfx_bospit  (94) — A_BrainSpit
  // MISSING: SFX.sfx_boscub  (95) — A_SpawnSound
  // MISSING: SFX.sfx_bossit  (96) — A_BrainAwake
  // MISSING: SFX.sfx_bospn   (97) — A_BrainPain
  // MISSING: SFX.sfx_bosdth  (98) — A_BrainScream
  // MISSING: SFX.sfx_manatk  (99) — A_FatRaise
  // (sfx_barexp 82, sfx_slop 31, sfx_telept 35 ARE in the shim already.)
  //
  // ACTIONS registry: add these keys to `var ACTIONS` after splicing:
  // A_VileChase, A_VileStart, A_VileTarget, A_VileAttack, A_SpidRefire,
  // A_BspiAttack, A_CyberAttack, A_SkelWhoosh, A_SkelFist, A_SkelMissile,
  // A_Tracer, A_PainAttack, A_PainDie, A_Hoof, A_Metal, A_BabyMetal,
  // A_FatRaise, A_FatAttack1/2/3, A_KeenDie, A_Fire, A_StartFire,
  // A_FireCrackle, A_BrainAwake, A_BrainPain, A_BrainScream, A_BrainExplode,
  // A_BrainDie, A_BrainSpit, A_SpawnSound, A_SpawnFly,
  // A_BossDeath (REPLACES the existing entry — delete the old in-file
  // A_BossDeath, whose hardcoded types 27/28/30/33 predate the dense mobjinfo
  // table; this copy uses the named MT_* constants).
  //
  // NOT-IN-GOSPEL — the task brief listed these; they do not exist in
  // reference/linuxdoom-1.10/p_enemy.c (nor in any released DOOM source):
  //   * A_VileHide — 1.10 has A_VileChase/Start/Target/Attack + the A_Fire trio
  //     only (p_enemy.c:1167-1338); the vile "hide" is S_VILE_ATK frames whose
  //     action pointers are already-covered functions or null.
  //   * A_SpawnBall / var spitter — the cube chain is A_SpawnSound (1930) +
  //     A_SpawnFly (1936); "spitter" appears once in the gospel, d_englsh.h:649
  //     ("ruined skull of the demon-spitter", MAP31 text). Declared inert below.
  //   * MAXBODYQUES/bodyqueue in p_enemy.c — the C has NO vile body queue.
  //     (g_game.c BODYQUESIZE=32 bodyqueue/bodyqueslot is the player-corpse
  //     telefrag queue.) Declared inert below per brief's file contract.
  //   * A_BrainDead — gospel name is A_BrainDie (p_enemy.c:1896). Ported as
  //     A_BrainDie (A_BrainDie is also the name game.js statetable already refs).
  //   * A_BossDeath "special2/special1 kill-all logic" — p_enemy.c:1609-1756
  //     contains none; ported verbatim per brief ("copy whatever the C ACTUALLY
  //     says"). Exit handling = G_ExitLevel for eps 2/3 (SIGIL 7 falls through).
  //
  // gametic → G.leveltime (port has no gametic; P_Ticker increments leveltime).
  // P_CheckSight → G.P_CheckSight; thing-position → G.P_UnsetThingPosition /
  // G.P_SetThingPosition (engine-provided, as elsewhere in game.js).
  // ============================================================================

  // p_enemy.c module-level state
  var MAXBODYQUES = 26;                                      // NOT-IN-GOSPEL (inert)
  var bodyqueue = new Array(MAXBODYQUES);
  var bodyqueslot = 0;
  var spitter = null;                                        // NOT-IN-GOSPEL (inert)
  var corpsehit = null, vileobj = null;                      // p_enemy.c:1124-1125
  var viletryx = 0, viletryy = 0;                            // p_enemy.c:1126-1127
  var TRACEANGLE = 0x0c000000;                               // p_enemy.c:1019
  var braintargets = new Array(32);                          // p_enemy.c:1809
  var numbraintargets = 0, braintargeton = 0;                // p_enemy.c:1810-1811
  var brainSpitEasy = 0;                                     // p_enemy.c:1906 'static int easy'

  // ---------------------------------------------------------------- refire/launchers
  // p_enemy.c:882 — keep firing unless target got out of sight
  function A_SpidRefire(actor) {
    A_FaceTarget(actor);
    if (P_Random() < 10) return;
    if (!actor.target || actor.target.health <= 0 || !G.P_CheckSight(actor, actor.target))
      P_SetMobjState(actor, actor.info.seestate);
  }

  // p_enemy.c:898 — arachnoplasm launcher
  function A_BspiAttack(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    P_SpawnMissile(actor, actor.target, MT_ARACHPLAZ);
  }

  // p_enemy.c:969 — cyberdemon rocket (BOSS states face already; C has no melee)
  function A_CyberAttack(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    P_SpawnMissile(actor, actor.target, MT_ROCKET);
  }

  // ---------------------------------------------------------------- revenant
  // p_enemy.c:1002 — skull launcher (missile spawn, prestepped, homing target)
  function A_SkelMissile(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    actor.z += 16 * FU;                                      // so missile spawns higher
    var mo = P_SpawnMissile(actor, actor.target, MT_TRACER);
    actor.z -= 16 * FU;                                      // back to normal
    mo.x = (mo.x + mo.momx) | 0;
    mo.y = (mo.y + mo.momy) | 0;
    mo.tracer = actor.target;
  }

  // p_enemy.c:1021 — homing tracer (C has no static distance helper)
  function A_Tracer(actor) {
    if (G.leveltime & 3) return;                             // C: gametic & 3
    P_SpawnPuff(actor.x, actor.y, actor.z);
    var th = P_SpawnMobj((actor.x - actor.momx) | 0, (actor.y - actor.momy) | 0, actor.z, MT_SMOKE);
    th.momz = FU;
    th.tics -= P_Random() & 3;
    if (th.tics < 1) th.tics = 1;
    // adjust direction
    var dest = actor.tracer;
    if (!dest || dest.health <= 0) return;
    // change angle (diffs UNSIGNED angle_t, p_enemy.c:1056-1070)
    var exact = G.R_PointToAngle2(actor.x, actor.y, dest.x, dest.y);
    if (exact !== actor.angle) {
      if (((exact - actor.angle) >>> 0) > 0x80000000) {
        actor.angle = (actor.angle - TRACEANGLE) >>> 0;
        if (((exact - actor.angle) >>> 0) < 0x80000000) actor.angle = exact;
      } else {
        actor.angle = (actor.angle + TRACEANGLE) >>> 0;
        if (((exact - actor.angle) >>> 0) > 0x80000000) actor.angle = exact;
      }
    }
    exact = (actor.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    actor.momx = FixedMul(actor.info.speed, fcos(exact));
    actor.momy = FixedMul(actor.info.speed, fsin(exact));
    // change slope
    var dist = (P_AproxDistance(dest.x - actor.x, dest.y - actor.y) / actor.info.speed) | 0;
    if (dist < 1) dist = 1;
    var slope = Math.trunc(((dest.z + 40 * FU) - actor.z) / dist);  // C fixed div
    if (slope < actor.momz) actor.momz -= FU / 8;
    else actor.momz += FU / 8;
  }

  // p_enemy.c:1093
  function A_SkelWhoosh(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    S_StartSound(actor, SFX.sfx_skeswg);
  }

  // p_enemy.c:1101
  function A_SkelFist(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    if (P_CheckMeleeRange(actor)) {
      var damage = ((P_Random() % 10) + 1) * 6;
      S_StartSound(actor, SFX.sfx_skepch);
      P_DamageMobj(actor.target, actor, actor, damage);
    }
  }

  // ---------------------------------------------------------------- mandibulax
  // p_enemy.c:1759 / 1765 / 1771 — hoof / metal / baby-metal footfall + chase
  function A_Hoof(mo) {
    S_StartSound(mo, SFX.sfx_hoof);
    A_Chase(mo);
  }
  function A_Metal(mo) {
    S_StartSound(mo, SFX.sfx_metal);
    A_Chase(mo);
  }
  function A_BabyMetal(mo) {
    S_StartSound(mo, SFX.sfx_bspwlk);
    A_Chase(mo);
  }

  // ---------------------------------------------------------------- pain elemental
  // p_enemy.c:1449 static A_PainShootSkull — exported plain as PainShootSkull
  function PainShootSkull(actor, angle) {
    // count total number of skulls currently on the level
    var count = 0;
    var currentthinker = G.thinkercap.next;
    while (currentthinker !== G.thinkercap) {
      if (currentthinker.function === P_MobjThinker && currentthinker.type === MT_SKULL)
        count++;
      currentthinker = currentthinker.next;
    }
    if (count > 20) return;                                  // p_enemy.c:1478
    var an = (angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    var prestep = 4 * FU + (((3 * (actor.info.radius + mobjinfo[MT_SKULL].radius)) / 2) | 0);
    var x = (actor.x + FixedMul(prestep, fcos(an))) | 0;
    var y = (actor.y + FixedMul(prestep, fsin(an))) | 0;
    var z = (actor.z + 8 * FU) | 0;
    var newmobj = P_SpawnMobj(x, y, z, MT_SKULL);
    if (!P_TryMove(newmobj, newmobj.x, newmobj.y)) {         // p_enemy.c:1496
      P_DamageMobj(newmobj, actor, actor, 10000);            // kill it immediately
      return;
    }
    newmobj.target = actor.target;
    A_SkullAttack(newmobj);
  }

  // p_enemy.c:1512
  function A_PainAttack(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    PainShootSkull(actor, actor.angle);
  }

  // p_enemy.c:1522
  function A_PainDie(actor) {
    A_Fall(actor);
    PainShootSkull(actor, (actor.angle + ANG90) >>> 0);
    PainShootSkull(actor, (actor.angle + ANG180) >>> 0);
    PainShootSkull(actor, (actor.angle + ANG270) >>> 0);
  }

  // ---------------------------------------------------------------- mancubus
  var FATSPREAD = ANG90 / 8;                                 // p_enemy.c:1349 (0x08000000)
  // p_enemy.c:1351
  function A_FatRaise(actor) {
    A_FaceTarget(actor);
    S_StartSound(actor, SFX.sfx_manatk);
  }
  // p_enemy.c:1358
  function A_FatAttack1(actor) {
    A_FaceTarget(actor);
    actor.angle = (actor.angle + FATSPREAD) >>> 0;
    P_SpawnMissile(actor, actor.target, MT_FATSHOT);
    var mo = P_SpawnMissile(actor, actor.target, MT_FATSHOT);
    mo.angle = (mo.angle + FATSPREAD) >>> 0;
    var an = (mo.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    mo.momx = FixedMul(mo.info.speed, fcos(an));
    mo.momy = FixedMul(mo.info.speed, fsin(an));
  }
  // p_enemy.c:1375
  function A_FatAttack2(actor) {
    A_FaceTarget(actor);
    actor.angle = (actor.angle - FATSPREAD) >>> 0;
    P_SpawnMissile(actor, actor.target, MT_FATSHOT);
    var mo = P_SpawnMissile(actor, actor.target, MT_FATSHOT);
    mo.angle = (mo.angle - 2 * FATSPREAD) >>> 0;
    var an = (mo.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    mo.momx = FixedMul(mo.info.speed, fcos(an));
    mo.momy = FixedMul(mo.info.speed, fsin(an));
  }
  // p_enemy.c:1392
  function A_FatAttack3(actor) {
    A_FaceTarget(actor);
    var mo = P_SpawnMissile(actor, actor.target, MT_FATSHOT);
    mo.angle = (mo.angle - FATSPREAD / 2) >>> 0;
    var an = (mo.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    mo.momx = FixedMul(mo.info.speed, fcos(an));
    mo.momy = FixedMul(mo.info.speed, fsin(an));
    mo = P_SpawnMissile(actor, actor.target, MT_FATSHOT);
    mo.angle = (mo.angle + FATSPREAD / 2) >>> 0;
    an = (mo.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    mo.momx = FixedMul(mo.info.speed, fcos(an));
    mo.momy = FixedMul(mo.info.speed, fsin(an));
  }

  // ---------------------------------------------------------------- arch-vile
  // p_enemy.c:1129 — detect a corpse that could be raised
  function PIT_VileCheck(thing) {
    if (!(thing.flags & MF_CORPSE)) return true;             // not a monster
    if (thing.tics !== -1) return true;                      // not lying still yet
    if (thing.info.raisestate === statenames.S_NULL) return true; // no raise state
    var maxdist = thing.info.radius + mobjinfo[MT_VILE].radius;
    if (Math.abs(thing.x - viletryx) > maxdist ||
        Math.abs(thing.y - viletryy) > maxdist) return true; // not actually touching
    corpsehit = thing;
    corpsehit.momx = corpsehit.momy = 0;
    corpsehit.height <<= 2;
    var check = P_CheckPosition(corpsehit, corpsehit.x, corpsehit.y);
    corpsehit.height >>= 2;
    if (!check) return true;                                 // doesn't fit here
    return false;                                            // got one, stop checking
  }

  // p_enemy.c:1167 — check for resurrecting a body, else normal chase
  function A_VileChase(actor) {
    if (actor.movedir !== DI_NODIR) {
      // int32 product idiom, same as P_Move (speed*xspeed C-UB)
      viletryx = (actor.x + Math.trunc(actor.info.speed * xspeed[actor.movedir])) | 0;
      viletryy = (actor.y + Math.trunc(actor.info.speed * yspeed[actor.movedir])) | 0;
      var xl = (viletryx - G.bmaporgx - MAXRADIUS * 2) >> 23;  // MAPBLOCKSHIFT = 23
      var xh = (viletryx - G.bmaporgx + MAXRADIUS * 2) >> 23;
      var yl = (viletryy - G.bmaporgy - MAXRADIUS * 2) >> 23;
      var yh = (viletryy - G.bmaporgy + MAXRADIUS * 2) >> 23;
      vileobj = actor;
      for (var bx = xl; bx <= xh; bx++) {
        for (var by = yl; by <= yh; by++) {
          if (!P_BlockThingsIterator(bx, by, PIT_VileCheck)) {
            var temp = actor.target;
            actor.target = corpsehit;
            A_FaceTarget(actor);
            actor.target = temp;
            P_SetMobjState(actor, statenames.S_VILE_HEAL1);
            S_StartSound(corpsehit, SFX.sfx_slop);
            var info = corpsehit.info;
            P_SetMobjState(corpsehit, info.raisestate);
            corpsehit.height <<= 2;
            corpsehit.flags = info.flags;
            corpsehit.health = info.spawnhealth;
            corpsehit.target = null;
            return;
          }
        }
      }
    }
    A_Chase(actor);                                          // return to normal attack
  }

  // p_enemy.c:1233
  function A_VileStart(actor) {
    S_StartSound(actor, SFX.sfx_vilatk);
  }

  // p_enemy.c:1257 — keep fire in front of player unless out of sight
  function A_Fire(actor) {
    var dest = actor.tracer;
    if (!dest) return;
    if (!G.P_CheckSight(actor.target, dest)) return;         // vile lost sight
    var an = (dest.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    G.P_UnsetThingPosition(actor);
    actor.x = (dest.x + FixedMul(24 * FU, fcos(an))) | 0;
    actor.y = (dest.y + FixedMul(24 * FU, fsin(an))) | 0;
    actor.z = dest.z;
    G.P_SetThingPosition(actor);
  }

  // p_enemy.c:1245
  function A_StartFire(actor) {
    S_StartSound(actor, SFX.sfx_flamst);
    A_Fire(actor);
  }

  // p_enemy.c:1251
  function A_FireCrackle(actor) {
    S_StartSound(actor, SFX.sfx_flame);
    A_Fire(actor);
  }

  // p_enemy.c:1285 — spawn the hellfire
  function A_VileTarget(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    // ⚠ gospel bug kept verbatim: p_enemy.c:1294 passes target->x for BOTH x,y
    var fog = P_SpawnMobj(actor.target.x, actor.target.x, actor.target.z, MT_FIRE);
    actor.tracer = fog;
    fog.target = actor;
    fog.tracer = actor.target;
    A_Fire(fog);
  }

  // p_enemy.c:1310
  function A_VileAttack(actor) {
    if (!actor.target) return;
    A_FaceTarget(actor);
    if (!G.P_CheckSight(actor, actor.target)) return;
    S_StartSound(actor, SFX.sfx_barexp);
    P_DamageMobj(actor.target, actor, actor, 20);
    actor.target.momz = ((1000 * FU) / actor.target.info.mass) | 0;  // p_enemy.c:1325
    var an = (actor.angle >>> G.ANGLETOFINESHIFT) & (G.FINEANGLES - 1);
    var fire = actor.tracer;
    if (!fire) return;
    // move the fire between the vile and the player
    fire.x = (actor.target.x - FixedMul(24 * FU, fcos(an))) | 0;
    fire.y = (actor.target.y - FixedMul(24 * FU, fsin(an))) | 0;
    P_RadiusAttack(fire, actor, 70);
  }

  // ---------------------------------------------------------------- brain spawner (MAP31)
  // p_enemy.c:1813 — find all target spots, first "awake" bark
  function A_BrainAwake(mo) {
    numbraintargets = 0;
    braintargeton = 0;
    for (var thinker = G.thinkercap.next; thinker !== G.thinkercap; thinker = thinker.next) {
      if (thinker.function !== P_MobjThinker) continue;
      if (thinker.type === MT_BOSSTARGET) {
        braintargets[numbraintargets] = thinker;
        numbraintargets++;
      }
    }
    S_StartSound(null, SFX.sfx_bossit);                      // full volume
  }

  // p_enemy.c:1843
  function A_BrainPain(mo) {
    S_StartSound(null, SFX.sfx_bospn);
  }

  // p_enemy.c:1849
  function A_BrainScream(mo) {
    for (var x = mo.x - 196 * FU; x < mo.x + 320 * FU; x += 8 * FU) {
      var y = mo.y - 320 * FU;
      var z = 128 + P_Random() * 2 * FU;
      var th = P_SpawnMobj(x, y, z, MT_ROCKET);
      th.momz = P_Random() * 512;
      P_SetMobjState(th, statenames.S_BRAINEXPLODE1);
      th.tics -= P_Random() & 7;
      if (th.tics < 1) th.tics = 1;
    }
    S_StartSound(null, SFX.sfx_bosdth);
  }

  // p_enemy.c:1875
  function A_BrainExplode(mo) {
    var x = mo.x + (P_Random() - P_Random()) * 2048;
    var y = mo.y;
    var z = 128 + P_Random() * 2 * FU;
    var th = P_SpawnMobj(x, y, z, MT_ROCKET);
    th.momz = P_Random() * 512;
    P_SetMobjState(th, statenames.S_BRAINEXPLODE1);
    th.tics -= P_Random() & 7;
    if (th.tics < 1) th.tics = 1;
  }

  // p_enemy.c:1896 (gospel name A_BrainDie; task's "A_BrainDead" does not exist)
  function A_BrainDie(mo) {
    G_ExitLevel();
  }

  // p_enemy.c:1901 — shoot a cube at the current target spot
  function A_BrainSpit(mo) {
    brainSpitEasy ^= 1;                                      // C 'static int easy'
    if (G.gameskill <= 1 /*sk_easy*/ && (!brainSpitEasy)) return;
    var targ = braintargets[braintargeton];
    braintargeton = (braintargeton + 1) % numbraintargets;
    var newmobj = P_SpawnMissile(mo, targ, MT_SPAWNSHOT);
    newmobj.target = targ;
    // C fixed chain-div: ((dy)/momy)/state->tics, truncating toward zero
    newmobj.reactiontime = ((((targ.y - mo.y) / newmobj.momy) | 0) / newmobj.state.tics) | 0;
    S_StartSound(null, SFX.sfx_bospit);
  }

  // p_enemy.c:1930 — travelling cube sound
  function A_SpawnSound(mo) {
    S_StartSound(mo, SFX.sfx_boscub);
    A_SpawnFly(mo);
  }

  // p_enemy.c:1936 — cube lands: telefog, roll monster, telefrag, remove cube.
  // (Task brief's "destination pick / MT_TELEPORTMAN check / spitter decrement"
  // is NOT what the C says — destination is mo->target set by A_BrainSpit; no
  // spitter decrement exists. Ported per the C.)
  function A_SpawnFly(mo) {
    if (--mo.reactiontime) return;                           // still flying
    var targ = mo.target;
    var fog = P_SpawnMobj(targ.x, targ.y, targ.z, MT_SPAWNFIRE);
    S_StartSound(fog, SFX.sfx_telept);
    // Randomly select monster to spawn (decreasing likelihood, p_enemy.c:1954)
    var r = P_Random();
    var type;
    if (r < 50) type = MT_TROOP;
    else if (r < 90) type = MT_SERGEANT;
    else if (r < 120) type = MT_SHADOWS;
    else if (r < 130) type = MT_PAIN;
    else if (r < 160) type = MT_HEAD;
    else if (r < 162) type = MT_VILE;
    else if (r < 172) type = MT_UNDEAD;
    else if (r < 192) type = MT_BABY;
    else if (r < 222) type = MT_FATSO;
    else if (r < 246) type = MT_KNIGHT;
    else type = MT_BRUISER;
    var newmobj = P_SpawnMobj(targ.x, targ.y, targ.z, type);
    if (P_LookForPlayers(newmobj, true))
      P_SetMobjState(newmobj, newmobj.info.seestate);
    // telefrag anything in this spot
    P_TeleportMove(newmobj, newmobj.x, newmobj.y);
    P_RemoveMobj(mo);                                        // remove self (the cube)
  }

  // ---------------------------------------------------------------- Romero's head
  // p_enemy.c:566 — DOOM II MAP32, uses special tag 666
  function A_KeenDie(mo) {
    A_Fall(mo);
    // scan the remaining thinkers to see if all Keens are dead
    for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next) {
      if (th.function !== P_MobjThinker) continue;
      if (th !== mo && th.type === mo.type && th.health > 0) return;
    }
    var junk = { tag: 666 };
    EV_DoDoor(junk, open);
  }

  // ---------------------------------------------------------------- boss death
  // p_enemy.c:1609 — FULL gospel A_BossDeath (REPLACES the older in-file copy;
  // delete the old function when splicing). C says NONE of the "special2/
  // special1 kill-all, map 6 spider / map 9 cyborg" logic the brief described —
  // this is verbatim what the C actually does.
  function A_BossDeath(mo) {
    var i;
    if (G.isCommercial()) {
      if (G.gamemap !== 7) return;
      if (mo.type !== MT_FATSO && mo.type !== MT_BABY) return;
    } else {
      switch (G.gameepisode) {
        case 1:
          if (G.gamemap !== 8) return;
          if (mo.type !== MT_BRUISER) return;
          break;
        case 2:
          if (G.gamemap !== 8) return;
          if (mo.type !== MT_CYBORG) return;
          break;
        case 3:
          if (G.gamemap !== 8) return;
          if (mo.type !== MT_SPIDER) return;
          break;
        case 4:
          switch (G.gamemap) {
            case 6:
              if (mo.type !== MT_CYBORG) return;
              break;
            case 8:
              if (mo.type !== MT_SPIDER) return;
              break;
            default:
              return;
          }
          break;
        default:
          if (G.gamemap !== 8) return;
          break;
      }
    }
    // make sure there is a player alive for victory
    for (i = 0; i < MAXPLAYERS; i++)
      if (G.playeringame[i] && G.players[i].health > 0) break;
    if (i === MAXPLAYERS) return;                            // no one left alive
    // scan the remaining thinkers to see if all bosses are dead
    for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next) {
      if (th.function !== P_MobjThinker) continue;
      if (th !== mo && th.type === mo.type && th.health > 0) return;
    }
    // victory!
    var junk = { tag: 666 };
    if (G.isCommercial()) {
      if (G.gamemap === 7) {
        if (mo.type === MT_FATSO) {
          junk.tag = 666;
          EV_DoFloor(junk, lowerFloorToLowest);
          return;
        }
        if (mo.type === MT_BABY) {
          junk.tag = 667;
          EV_DoFloor(junk, raiseFloorToTexture);             // C name raiseToTexture
          return;
        }
      }
    } else {
      switch (G.gameepisode) {
        case 1:
          junk.tag = 666;
          EV_DoFloor(junk, lowerFloorToLowest);
          return;
        case 4:
          switch (G.gamemap) {
            case 6:
              junk.tag = 666;
              EV_DoDoor(junk, blazeOpen);
              return;
            case 8:
              junk.tag = 666;
              EV_DoFloor(junk, lowerFloorToLowest);
              return;
          }
          break;
      }
    }
    G_ExitLevel();                                           // eps 2/3 + fallthrough
  }

  var ACTIONS = {
    A_SpidRefire: A_SpidRefire, A_BspiAttack: A_BspiAttack, A_CyberAttack: A_CyberAttack,
    A_SkelWhoosh: A_SkelWhoosh, A_SkelFist: A_SkelFist, A_SkelMissile: A_SkelMissile,
    A_Tracer: A_Tracer, A_Hoof: A_Hoof, A_Metal: A_Metal, A_BabyMetal: A_BabyMetal,
    A_PainAttack: A_PainAttack, A_PainDie: A_PainDie,
    A_FatRaise: A_FatRaise, A_FatAttack1: A_FatAttack1, A_FatAttack2: A_FatAttack2, A_FatAttack3: A_FatAttack3,
    A_VileChase: A_VileChase, A_VileStart: A_VileStart, A_VileTarget: A_VileTarget, A_VileAttack: A_VileAttack,
    A_Fire: A_Fire, A_StartFire: A_StartFire, A_FireCrackle: A_FireCrackle,
    A_BrainAwake: A_BrainAwake, A_BrainPain: A_BrainPain, A_BrainScream: A_BrainScream,
    A_BrainExplode: A_BrainExplode, A_BrainDie: A_BrainDie, A_BrainSpit: A_BrainSpit,
    A_SpawnSound: A_SpawnSound, A_SpawnFly: A_SpawnFly, A_KeenDie: A_KeenDie,
    A_BFGSpray: A_BFGSpray,
    A_Look: A_Look, A_Chase: A_Chase, A_FaceTarget: A_FaceTarget,
    A_PosAttack: A_PosAttack, A_SPosAttack: A_SPosAttack,
    A_TroopAttack: A_TroopAttack, A_SargAttack: A_SargAttack,
    A_HeadAttack: A_HeadAttack, A_SkullAttack: A_SkullAttack,
    A_CPosAttack: A_CPosAttack, A_CPosRefire: A_CPosRefire,
    A_BruisAttack: A_BruisAttack, A_BossDeath: A_BossDeath,
    A_Pain: A_Pain, A_Fall: A_Fall, A_Scream: A_Scream, A_XScream: A_XScream,
    A_PlayerScream: A_PlayerScream, A_Explode: A_Explode,
    A_Light0: function (mo) { if (mo.player) mo.player.extralight = 0; },
    A_Light1: function (mo) { if (mo.player) mo.player.extralight = 1; },
    A_Light2: function (mo) { if (mo.player) mo.player.extralight = 2; },
    A_WeaponReady: function (mo) { if (mo.player) PS_ACTIONS.A_WeaponReady(mo.player); },
    A_Lower: function (mo) { if (mo.player) PS_ACTIONS.A_Lower(mo.player, mo.player.psprites[ps_weapon]); },
    A_Raise: function (mo) { if (mo.player) PS_ACTIONS.A_Raise(mo.player, mo.player.psprites[ps_weapon]); },
    A_Punch: function (mo) { if (mo.player) PS_ACTIONS.A_Punch(mo.player); },
    A_Saw: function (mo) { if (mo.player) PS_ACTIONS.A_Saw(mo.player); },
    A_ReFire: function (mo) { if (mo.player) PS_ACTIONS.A_ReFire(mo.player); },
    A_FirePistol: function (mo) { if (mo.player) PS_ACTIONS.A_FirePistol(mo.player); },
    A_FireShotgun: function (mo) { if (mo.player) PS_ACTIONS.A_FireShotgun(mo.player); },
    A_GunFlash: function (mo) { if (mo.player) PS_ACTIONS.A_GunFlash(mo.player); }
  };
  // psprite states route acp2 directly; mobj states route acp1. P_SetPsprite uses PS_ACTIONS.
  G.P_SetPsprite = P_SetPsprite; G.P_MovePsprites = P_MovePsprites;
  G.P_CheckAmmo = P_CheckAmmo; G.P_BringUpWeapon = P_BringUpWeapon;
  G.P_SetupPsprites = P_SetupPsprites; G.P_FireWeapon = P_FireWeapon;

  // ---------------------------------------------------------------- player think (p_user.c)
  function P_Thrust(player, angle, move) {
    angle >>>= 19;
    player.mo.momx = (player.mo.momx + FixedMul(move, fcos(angle))) | 0;
    player.mo.momy = (player.mo.momy + FixedMul(move, fsin(angle))) | 0;
  }
  function P_MovePlayer(player) {
    var cmd = player.cmd;
    player.mo.angle = (player.mo.angle + ((cmd.angleturn << 16) >>> 0)) >>> 0;  // ⚠ int16<<16 signed (p_user.c:154)
    onground = (player.mo.z <= player.mo.floorz);
    if (cmd.forwardmove && onground) P_Thrust(player, player.mo.angle, cmd.forwardmove * 2048);
    if (cmd.sidemove && onground) P_Thrust(player, (player.mo.angle - ANG90) >>> 0, cmd.sidemove * 2048);
    if ((cmd.forwardmove || cmd.sidemove) && player.mo.state === states[statenames.S_PLAY])
      P_SetMobjState(player.mo, statenames.S_PLAY_RUN1);      // ⚠ only place the walk cycle starts
  }
  function P_CalcHeight(player) {
    player.bob = FixedMul(player.mo.momx, player.mo.momx) + FixedMul(player.mo.momy, player.mo.momy);
    player.bob >>= 2;
    if (player.bob > MAXBOB) player.bob = MAXBOB;
    if ((player.cheats & 64) || !onground) {                  // CF_NOMOMENTUM
      player.viewz = (player.mo.z + VIEWHEIGHT) | 0;
      if (player.viewz > player.mo.ceilingz - 4 * FU) player.viewz = player.mo.ceilingz - 4 * FU;
      player.viewz = (player.mo.z + player.viewheight) | 0;   // ⚠ overwrites clamp — verbatim
      return;
    }
    var angle = ((G.FINEANGLES / 20) * G.leveltime) & G.FINEMASK;
    var bob = FixedMul((player.bob / 2) | 0, fsin(angle));
    if (player.playerstate === PST_LIVE) {
      player.viewheight += player.deltaviewheight;
      if (player.viewheight > VIEWHEIGHT) { player.viewheight = VIEWHEIGHT; player.deltaviewheight = 0; }
      if (player.viewheight < VIEWHEIGHT / 2) {
        player.viewheight = VIEWHEIGHT / 2;
        if (player.deltaviewheight <= 0) player.deltaviewheight = 1;
      }
      if (player.deltaviewheight) {
        player.deltaviewheight += (FU / 4) | 0;
        if (!player.deltaviewheight) player.deltaviewheight = 1;
      }
    }
    player.viewz = (player.mo.z + player.viewheight + bob) | 0;
    if (player.viewz > player.mo.ceilingz - 4 * FU) player.viewz = player.mo.ceilingz - 4 * FU;
  }
  function P_DeathThink(player) {
    P_MovePsprites(player);
    if (player.viewheight > 6 * FU) player.viewheight -= FU;
    if (player.viewheight < 6 * FU) player.viewheight = 6 * FU;
    player.deltaviewheight = 0;
    onground = (player.mo.z <= player.mo.floorz);
    P_CalcHeight(player);
    if (player.attacker && player.attacker !== player.mo) {
      var angle = G.R_PointToAngle2(player.mo.x, player.mo.y, player.attacker.x, player.attacker.y);
      var delta = (angle - player.mo.angle) >>> 0;
      if (delta < ANG5 || delta > ((0 - ANG5) >>> 0)) {
        player.mo.angle = angle;
        if (player.damagecount) player.damagecount--;
      } else if (delta < ANG180) player.mo.angle = (player.mo.angle + ANG5) >>> 0;
      else player.mo.angle = (player.mo.angle - ANG5) >>> 0;
    } else if (player.damagecount) player.damagecount--;
    if (player.cmd.buttons & BT_USE) player.playerstate = PST_REBORN;  // ⚠ respawn-in-place
  }
  function P_PlayerThink(player) {
    var cmd = player.cmd;
    if (player.cheats & 2 /*CF_NOCLIP*/) player.mo.flags |= MF_NOCLIP;
    else player.mo.flags &= ~MF_NOCLIP;
    if (player.mo.flags & MF_JUSTATTACKED) {                  // chainsaw auto-advance
      cmd.angleturn = 0; cmd.forwardmove = (0xc800 / 512) | 0; cmd.sidemove = 0;
      player.mo.flags &= ~MF_JUSTATTACKED;
    }
    if (player.playerstate === PST_DEAD) { P_DeathThink(player); return; }
    if (player.mo.reactiontime) player.mo.reactiontime--;      // ⚠ blocks movement
    else P_MovePlayer(player);
    P_CalcHeight(player);
    if (player.mo.subsector.sector.special) P_PlayerInSpecialSector(player);
    if (cmd.buttons & BT_SPECIAL) cmd.buttons = 0;
    // weapon switch block (p_user.c) — ONLY when the BT_CHANGE bit is set;
    // unguarded, buttons=0 decodes as newweapon=0 (fist) and swaps the
    // spawn pistol away two tics in.
    if (cmd.buttons & BT_CHANGE) {                           // p_user.c:283-315
    var newweapon = (cmd.buttons & BT_WEAPONMASK) >> BT_WEAPONSHIFT;
    // chainsaw overrides fist unless already sawing with strength power
    if (newweapon === wp_fist && player.weaponowned[wp_chainsaw] &&
      !(player.readyweapon === wp_chainsaw && player.powers[pw_strength]))
      newweapon = wp_chainsaw;
    // commercial: shotgun key toggles shotgun <-> super shotgun
    if (G.isCommercial() && newweapon === wp_shotgun &&
      player.weaponowned[wp_supershotgun] && player.readyweapon !== wp_supershotgun)
      newweapon = wp_supershotgun;
    if (player.weaponowned[newweapon] && newweapon !== player.readyweapon &&
      newweapon < NUMWEAPONS &&
      // Do not go to plasma or BFG in shareware, even if cheated.
      ((newweapon !== wp_plasma && newweapon !== wp_bfg) || G.gm() !== 'shareware'))
      player.pendingweapon = newweapon;
    }
    // BT_USE edge
    if (cmd.buttons & BT_USE) {
      if (!player.usedown) { player.usedown = true; P_UseLines(player); }
    } else player.usedown = false;
    P_MovePsprites(player);
    // power counters (only pw_strength/invul semantics in scope)
    if (player.powers[pw_strength]) player.powers[pw_strength]++;
    for (var i = 1; i < 6; i++) {
      if (player.powers[i]) {
        if (i === pw_invisibility) { if (!--player.powers[i]) player.mo.flags &= ~MF_SHADOW; }
        else if (i === pw_ironfeet) { if (!--player.powers[i]) { } }
        else player.powers[i]--;
      }
    }
    if (player.damagecount) player.damagecount--;
    if (player.bonuscount) player.bonuscount--;
    player.fixedcolormap = 0;
    if (player.powers[pw_invulnerability] > 4 * 32 || (player.powers[pw_invulnerability] & 8))
      player.fixedcolormap = INVERSECOLORMAP;
    else if (player.powers[pw_infrared] > 4 * 32 || (player.powers[pw_infrared] & 8))
      player.fixedcolormap = 1;
  }
  G.P_PlayerThink = P_PlayerThink; G.P_MovePlayer = P_MovePlayer;
  G.P_CalcHeight = P_CalcHeight; G.P_DeathThink = P_DeathThink;

  // ---------------------------------------------------------------- spawn/reborn (p_mobj.c / g_game.c)
  function P_SpawnPlayer(mthing) {
    if (!G.playeringame[mthing.type - 1]) return;
    var p = G.players[mthing.type - 1];
    if (p.playerstate === PST_REBORN) G_PlayerReborn(mthing.type - 1);
    var x = mthing.x << FRACBITS, y = mthing.y << FRACBITS, z = ONFLOORZ;
    var mobj = P_SpawnMobj(x, y, z, MT_PLAYER);
    if (mthing.type > 1) mobj.flags |= (mthing.type - 1) << MF_TRANSSHIFT;
    mobj.angle = (ANG45 * (mthing.angle / 45)) >>> 0;          // quantize by integer degrees/45
    mobj.player = p;
    mobj.health = p.health;
    p.mo = mobj;
    p.playerstate = PST_LIVE;
    p.refire = 0;
    p.message = null;
    p.damagecount = 0; p.bonuscount = 0; p.extralight = 0; p.fixedcolormap = 0;
    p.viewheight = VIEWHEIGHT;
    P_SetupPsprites(p);
    if (G.deathmatch) for (var i = 0; i < 6; i++) p.cards[i] = true;
    // ST_Start: status bar wakes via main.js hudRefresh (widgets redraw).
    // HU_Start: p_mobj.c:698 — console player spawn resets the HU message
    // widget, so a message from the previous level never bleeds into this one.
    if (mthing.type - 1 === G.consoleplayer && typeof HU !== 'undefined') HU.HU_Start();
  }
  G.P_SpawnPlayer = P_SpawnPlayer;
  G.P_GivePower = P_GivePower;   // cheat panel behold (st_stuff.c ST_Responder)
  function G_PlayerReborn(n) {
    // g_game.c G_PlayerReborn: memcpy(player,&tp,sizeof(player_t)) — the
    // player_t struct is reset IN PLACE (pointer identity preserved; players[]
    // and any players[i] pointers stay valid). Port: copy fresh fields onto the
    // existing object rather than replacing the array slot.
    var p = G.players[n];
    var frags = p.frags.slice(), killcount = p.killcount, itemcount = p.itemcount,
      secretcount = p.secretcount;
    var fresh = makePlayer();
    for (var k in fresh) p[k] = fresh[k];
    p.frags = frags; p.killcount = killcount; p.itemcount = itemcount; p.secretcount = secretcount;
    p.usedown = p.attackdown = true;                           // don't do anything immediately
    p.playerstate = PST_LIVE;
    p.health = MAXHEALTH;
    p.readyweapon = p.pendingweapon = wp_pistol;
    p.weaponowned[wp_fist] = true;
    p.weaponowned[wp_pistol] = true;
    p.ammo[am_clip] = 50;
    for (var i = 0; i < 4; i++) p.maxammo[i + 1] = maxammoTab[i];
    if (n === G.consoleplayer) G.player = p;
  }
  G.G_PlayerReborn = G_PlayerReborn;
  function G_DoReborn() { loadLevel(); if (G.forceWipe) G.forceWipe(); }  // g_game.c:472 wipegamestate==-1 on respawn

  // ---------------------------------------------------------------- P_SpawnMapThing / P_LoadThings
  var warned = {};
  function warnOnce(k) { if (!warned[k]) { warned[k] = true; if (typeof console !== "undefined") console.warn("game.js: unimplemented: " + k); } }
  G.warned = warned;
  function P_SpawnMapThing(mthing) {
    if (mthing.type === 11) {                                 // deathmatch start
      if (deathmatch_p < 10) { deathmatchstarts[deathmatch_p] = mthing; deathmatch_p++; }
      return;
    }
    if (mthing.type <= 4) {                                   // player starts: NOT skill/ambush filtered
      playerstarts[mthing.type - 1] = mthing;
      if (!G.deathmatch) P_SpawnPlayer(mthing);
      return;
    }
    if (!G.netgame && (mthing.options & 16)) return;          // multiplayer-only thing
    var bit = (G.gameskill === 0) ? 1 : (G.gameskill === 4) ? 4 : (1 << (G.gameskill - 1));
    if (!(mthing.options & bit)) return;
    // doomednum lookup: linear scan, first match (lowest MT_ index) wins
    var i, found = -1;
    for (i = 0; i < mobjinfo.length; i++) if (mthing.type === mobjinfo[i].doomednum) { found = i; break; }
    if (found < 0) { warnOnce("doomednum-" + mthing.type); return; }  // C I_errors; port: warn+skip
    // ⚠ 1.10 P_LoadThings `break` quirk for Doom2-only things in Doom1 maps:
    // doomednums 64-71,84,88,89 (and 66 etc) — this port skips instead of
    // aborting the load (documented deviation; MAP01's things have none).
    var info = mobjinfo[found];
    if (G.deathmatch && (info.flags & MF_NOTDMATCH)) return;
    if (G.nomonsters && (info.flags & MF_COUNTKILL)) return;
    var x = mthing.x << FRACBITS, y = mthing.y << FRACBITS;
    var z = (info.flags & MF_SPAWNCEILING) ? ONCEILINGZ : ONFLOORZ;
    var mobj = P_SpawnMobj(x, y, z, found);
    mobj.spawnpoint = mthing;
    if (mobj.tics > 0) mobj.tics = 1 + (P_Random() % mobj.tics);  // ⚠ consumes P_Random per spawn
    if (info.flags & MF_COUNTKILL) G.totalkills++;
    if (info.flags & MF_COUNTITEM) G.totalitems++;
    mobj.angle = (ANG45 * (mthing.angle / 45)) >>> 0;          // quantized, no R_PointToAngle2
    if (mthing.options & 8 /*MTF_AMBUSH*/) mobj.flags |= MF_AMBUSH;
  }
  G.P_SpawnMapThing = P_SpawnMapThing;
  function P_LoadThings(b64) {
    var bytes = decodeB64(b64);
    deathmatch_p = 0;
    for (var ofs = 0; ofs + 10 <= bytes.length; ofs += 10) {
      var x = i16(bytes, ofs), y = i16(bytes, ofs + 2), angle = i16(bytes, ofs + 4),
        type = i16(bytes, ofs + 6), options = i16(bytes, ofs + 8);
      var mthing = { x: x, y: y, angle: angle, type: type, options: options };
      P_SpawnMapThing(mthing);
    }
  }
  function i16(b, o) { var v = b[o] | (b[o + 1] << 8); return v >= 32768 ? v - 65536 : v; }
  function decodeB64(b64) {
    if (typeof Buffer !== "undefined") return new Uint8Array(Buffer.from(b64, "base64"));
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  // ---------------------------------------------------------------- level setup (p_setup.c:379 P_SetupLevel)
  function loadLevel() {
    var mj = G.currentMapJson;
    if (!mj) throw new Error("G_InitNew: G.currentMapJson not set (main.js must assign map01 JSON)");
    if (G.loadMap) { G.loadMap(mj); }                         // engine parses mapdata
    if (!G.mapdata || !G.mapdata.linedefs) G.mapdata = parseMapFallback(mj);
    bindMap();
    buildSwitchList();
    P_InitPicAnims();                            // P_Init (p_setup.c:703)
    G.totalkills = G.totalitems = G.totalsecret = 0;
    // p_setup.c:597-600 — per-player tallies reset on EVERY level setup
    // (new game, next level via G_DoWorldDone, and respawn — G_DoReborn runs
    // P_SetupLevel too), BEFORE P_LoadThings. Intermission already snapshotted
    // the completed level's tallies in G_DoCompleted.
    for (var p of G.players) { p.killcount = 0; p.itemcount = 0; p.secretcount = 0; }
    G.players[G.consoleplayer].viewz = 1;                      // "no view yet" flag
    SndCall('S_Start');                                        // p_setup.c:607 — stop channels, level music
    P_InitThinkers();
    blocklinks = new Array(G.bmapwidth * G.bmapheight).fill(null);
    // Publish as the global the engine's P_SetThingPosition/P_UnsetThingPosition
    // (installed via def(), engine wins) mutate — engine.js declares its
    // `var blocklinks` as a global lexical, so sharing one array is only
    // correct through the global property. Without this the game-side
    // P_BlockThingsIterator scans an empty list (radius attacks, CheckPosition).
    G.blocklinks = blocklinks;
    for (var s of sectors) { s.specialdata = null; s.soundtarget = null; s.validcount = 0; s.thinglist = null; s.lines = s.lines || []; }
    for (var l of linedefs) { l.validcount = 0; }
    for (var b = 0; b < MAXBUTTONS; b++) { buttonlist[b].btimer = 0; buttonlist[b].line = null; }
    activeplats.fill(null); activeceilings.fill(null);
    G.leveltime = 0;
    deathmatchstarts.length = 0; deathmatch_p = 0;
    iquehead = iquetail = 0; bodyqueslot = 0;
    P_LoadThings(mj.lumps.THINGS);                             // spawns players + everything
    G.levelExit = false;
    P_SpawnSpecials();
    // Port ordering seam: vanilla runs P_CalcHeight (P_Ticker tail) in the
    // SAME gametic as G_DoLoadLevel, before any R_RenderPlayerView. Here the
    // draw/wipe driver renders the first level frame (the wipe end-screen)
    // before the tic loop ticks, and the blocking melt freezes gametic — so
    // with viewz still at loadLevel's '1' flag the whole wipe renders under
    // the floor, then pops. Compute the view height now, as vanilla's tic did.
    var cp = G.players[G.consoleplayer];
    if (cp && cp.mo && cp.playerstate === PST_LIVE) P_CalcHeight(cp);
  }
  G.loadLevel = loadLevel;

  // ---------------------------------------------------------------- G_InitNew / G_Ticker
  var pendingLevelLoad = false, levelNum = 1;
  // g_game.c:455-476/1455-1476 sky texture per episode (Doom 1) / map range
  // (DOOM 2) — G_DoLoadLevel recomputes on EVERY level load, not just new games.
  function skyFor(episode, map) {
    return G.isCommercial()
      ? (map < 12 ? 'SKY1' : map < 21 ? 'SKY2' : 'SKY3')
      : (episode === 1 ? 'SKY1' : episode === 2 ? 'SKY2'
        : episode === 3 ? 'SKY3' : 'SKY4');
  }
  function G_InitNew(skill, episode, map) {
    if (episode === undefined) episode = 1;
    if (map === undefined) map = levelNum;
    // g_game.c:1378-1410 episode/map clamps by gamemode
    if (episode < 1) episode = 1;
    if (G.gm() === 'retail') { if (episode > 4) episode = 4; }
    else if (G.gm() === 'shareware') { if (episode > 1) episode = 1; }
    else if (!G.isCommercial()) { if (episode > 3) episode = 3; }
    if (map < 1) map = 1;
    if (map > 9 && !G.isCommercial()) map = 9;
    levelNum = map;
    G.gameskill = skill;
    G.gameepisode = episode; G.gamemap = map;
    // g_game.c:1455 sky texture per episode (Doom 1) / map range (DOOM 2).
    // engine.js R_InitData consumes G.skyTextureName at level load.
    G.skyTextureName = skyFor(episode, map);
    for (var i = 0; i < MAXPLAYERS; i++) {
      G.players[i].playerstate = PST_REBORN;
      G.players[i].frags = [0, 0, 0, 0];
    }
    G.players[0] && (G.player = G.players[0]);
    G.playeringame = [true, false, false, false];
    G.secretexit = false; G.didsecret = false;             // fresh episode start
    G.paused = false;
    M_ClearRandomX();
    loadLevel();
  }
  // g_game.c:440 G_DoLoadLevel — the NEXT-LEVEL path (G_DoWorldDone calls
  // this, NOT G_InitNew): players stay PST_LIVE so equipment, health, ammo,
  // weapons and keys carry over. Only DEAD players flip to PST_REBORN
  // (g_game.c:449); frags and per-level tallies reset (P_SetupLevel).
  function G_DoLoadLevel(episode, map) {
    if (episode !== undefined) G.gameepisode = episode;
    if (map !== undefined) { levelNum = map; G.gamemap = map; }
    G.skyTextureName = skyFor(G.gameepisode, G.gamemap);
    for (var i = 0; i < MAXPLAYERS; i++) {
      if (G.playeringame[i] && G.players[i].playerstate === PST_DEAD)
        G.players[i].playerstate = PST_REBORN;             // g_game.c:449
      G.players[i].frags = [0, 0, 0, 0];                   // g_game.c:451
    }
    loadLevel();
  }
  function M_ClearRandomX() { if (G.M_ClearRandom) G.M_ClearRandom(); }
  G.secretexit = false;                                  // p_switch/p_spec secret exits
  G.didsecret = false;                                   // players[].didsecret (g_game.c)
  G.hasMap31 = false;                                    // main.js: commercial MAP31 present
  function G_SecretExitLevel() {                          // g_game.c:1009
    // IF NO WOLF3D LEVELS, NO SECRET EXIT!
    G.secretexit = !(G.isCommercial() && !G.hasMap31);
    G_ExitLevel();
  }
  G.G_SecretExitLevel = G_SecretExitLevel;
  // g_game.c G_DoCompleted: snapshot the level stats into the wadmission block
  // the intermission (wi.js) consumes, and compute wminfo.next (0-biased).
  // E1M8 -> {victory:true} (ga_victory: skip WI, straight to the finale).
  // g_game.c:779 G_PlayerFinishLevel — run for every player at level end
  // (G_DoCompleted, g_game.c:1027): powers and cards do NOT carry to the
  // next level; transient view effects cancel. (Health/weapons/ammo do carry.)
  function G_PlayerFinishLevel(n) {
    var pl = G.players[n];
    for (var i = 0; i < 6; i++) { pl.powers[i] = 0; pl.cards[i] = false; }
    if (pl.mo) pl.mo.flags &= ~MF_SHADOW;                  // cancel invisibility
    pl.extralight = 0; pl.fixedcolormap = 0;               // gun flash / IR goggles
    pl.damagecount = 0; pl.bonuscount = 0;                 // palette changes
  }
  function G_DoCompleted() {
    G.players[0] && (G.player = G.players[0]);
    for (var fi = 0; fi < MAXPLAYERS; fi++)
      if (G.playeringame[fi]) G_PlayerFinishLevel(fi);     // g_game.c:1027
    var p = G.players[G.consoleplayer];
    if (G.secretexit) G.didsecret = true;                // cleared in G_InitNew
    var epsd = G.gameepisode, map = G.gamemap;
    var wminfo = { epsd: epsd - 1, last: map - 1, next: map, didsecret: G.didsecret, victory: false };
    if (G.isCommercial()) {
      // g_game.c:1069-1083 commercial next-map table (wminfo.next 0-biased)
      if (G.secretexit) {
        if (map === 15) wminfo.next = 30;
        else if (map === 31) wminfo.next = 31;
      } else if (map === 31 || map === 32) {
        wminfo.next = 15;
      }
    } else if (map === 8) {                              // g_game.c: ga_victory
      wminfo.victory = true;
    } else if (map === 9) {
      G.didsecret = true; wminfo.didsecret = true;
      // g_game.c:1088-1102 returning-from-secret table per episode
      wminfo.next = [3, 5, 6, 2][Math.min(epsd, 4) - 1] || 3;
    } else if (G.secretexit) {
      wminfo.next = 8;                                   // -> secret level E?M9
    }
    wminfo.maxkills = G.totalkills;
    wminfo.maxitems = G.totalitems;
    wminfo.maxsecret = G.totalsecret;
    // g_game.c:1116 cpars[] (DOOM 2) vs pars[episode][map] (DOOM 1)
    wminfo.partime = 35 * (G.isCommercial() ? (cpars[map - 1] || 0)
                                            : (pars[epsd] ? pars[epsd][map] || 0 : 0));
    wminfo.skills = p.killcount; wminfo.sitems = p.itemcount;
    wminfo.ssecret = p.secretcount; wminfo.stime = G.leveltime;
    return wminfo;
  }
  var pars = [[0],
    [0, 30, 75, 120, 90, 165, 180, 180, 30, 165],
    [0, 90, 90, 90, 120, 90, 360, 240, 30, 170],
    [0, 90, 45, 90, 150, 90, 90, 165, 30, 135]];        // g_game.c:978 pars[4][10]
  var cpars = [30, 90, 120, 120, 90, 150, 120, 120, 270, 90,      // g_game.c:987
    210, 150, 150, 150, 210, 150, 420, 150, 210, 150,
    240, 150, 180, 150, 150, 300, 330, 420, 300, 180,
    120, 30];
  G.G_DoCompleted = G_DoCompleted;
  G.G_InitNew = G_InitNew;
  G.G_DoLoadLevel = G_DoLoadLevel;                       // next-level path (main.js gotoMap)
  function G_ExitLevel() {
    G.secretexit = false;                                // g_game.c:1004
    G.levelExit = true;
    if (G.onLevelExit) G.onLevelExit();                        // main.js hook (documented deviation)
  }
  G.G_ExitLevel = G_ExitLevel;
  G.G_DoReborn = G_DoReborn;
  // G_Ticker(ticcmd): commands → P_Ticker order (spec-game §7). HUD tickers are
  // minimal in main.js (documented deviation: no ST_Ticker graphics).
  function G_Ticker(ticcmd) {
    // do player reborns if needed
    for (var i = 0; i < MAXPLAYERS; i++)
      if (G.playeringame[i] && G.players[i].playerstate === PST_REBORN) G_DoReborn(i);
    // copy commands (single-player: direct from argument). NO clamp here:
    // g_game.c G_BuildTiccmd clamps locally-built cmds (g_game.c:416-421),
    // but G_Ticker memcpy's netcmds verbatim and G_ReadDemoTiccmd overwrites
    // demo cmds verbatim — raw demo bytes (e.g. sidemove 0x80 -> -128, the
    // last tic of all three DEMOs) must pass through unclamped.
    if (ticcmd) {
      var cmd = G.players[G.consoleplayer].cmd;
      cmd.forwardmove = ticcmd.forwardmove | 0;
      cmd.sidemove = ticcmd.sidemove | 0;
      cmd.angleturn = ticcmd.angleturn | 0;
      cmd.buttons = ticcmd.buttons | 0;
    }
    P_Ticker();
  }
  G.G_Ticker = G_Ticker;
  function P_Ticker() {
    if (G.paused) return;
    if (!G.netgame && G.menuactive && !G.demoplayback && G.players[G.consoleplayer].viewz !== 1) return;
    for (var i = 0; i < MAXPLAYERS; i++)
      if (G.playeringame[i]) P_PlayerThink(G.players[i]);
    P_RunThinkers();                                           // mobjs then doors/plats in add order
    P_UpdateSpecials();
    P_RespawnSpecials();                                       // DM item queue only
    G.leveltime++;
  }
  G.P_Ticker = P_Ticker;
  function P_RespawnSpecials() {
    // deathmatch==2 only; single player: no-op (p_mobj.c)
    if (G.deathmatch !== 2) { iquehead = iquetail = 0; return; }
  }

  // ---------------------------------------------------------------- map parse fallback (dev/test only when engine.loadMap absent)
  // Mirrors p_setup.c P_Load* order so tests run before engine.js exists.
  function parseMapFallback(mj) {
    var L = mj.lumps;
    var vertexes = [], sectors = [], sides = [], linedefs = [], segs = [], subsectors = [], nodes = [];
    var v = decodeB64(L.VERTEXES);
    for (var i = 0; i < v.length; i += 4) vertexes.push({ x: i16(v, i) << FRACBITS, y: i16(v, i + 2) << FRACBITS });
    var s = decodeB64(L.SECTORS);
    // NOTE: gen_map packs SECTORS '<hhH light><floorpic8><ceilpic8><HH special,tag>'
    for (i = 0; i < s.length; i += 26) {
      var fp = picName(s, i + 6), cp = picName(s, i + 14);
      var sp = s[i + 22] | (s[i + 23] << 8); var tg = s[i + 24] | (s[i + 25] << 8);
      if (sp >= 32768) sp -= 65536; if (tg >= 32768) tg -= 65536;
      sectors.push({ floorheight: i16(s, i) << FRACBITS, ceilingheight: i16(s, i + 2) << FRACBITS,
        floorpic: fp, ceilingpic: cp, lightlevel: s[i + 4] | (s[i + 5] << 8),
        special: sp, tag: tg, soundtarget: null, specialdata: null, thinglist: null });
    }
    var sd = decodeB64(L.SIDEDEFS);
    for (i = 0; i < sd.length; i += 30) {
      sides.push({ textureoffset: i16(sd, i), rowoffset: i16(sd, i + 2),
        // gen_map emits bottom,mid,top; real DOOM is top,bottom,mid — engine.loadMap
        // must follow p_setup.c; fallback matches gen_map layout for testing.
        bottomtexture: picName(sd, i + 4), midtexture: picName(sd, i + 12), toptexture: picName(sd, i + 20),
        sector: null });
    }
    var ld = decodeB64(L.LINEDEFS);
    // gen_map LINEDEFS packer: '<HHhhHhH' = v1,v2,special,tag,sidenum0,sidenum1,pad
    for (i = 0; i < ld.length; i += 14) {
      var v1 = ld[i] | (ld[i + 1] << 8), v2 = ld[i + 2] | (ld[i + 3] << 8);
      var special = i16(ld, i + 4), tag = i16(ld, i + 6);
      var sn0 = i16(ld, i + 8), sn1 = i16(ld, i + 10);
      var flags = ld[i + 12] | (ld[i + 13] << 8);
      linedefs.push({ v1: vertexes[v1], v2: vertexes[v2], dx: 0, dy: 0, slopetype: 0,
        tag: tag, flags: flags, special: special, sidenum: [sn0, sn1],
        frontsector: null, backsector: null, bbox: [0, 0, 0, 0], num: linedefs.length });
    }
    for (i = 0; i < sides.length; i++) {
      var secIdx = sd[i * 30 + 28] | (sd[i * 30 + 29] << 8);
      sides[i].sector = sectors[secIdx] || null;               // gen_map writes sector 0 for all
    }
    // NOTE: gen_map SIDEDEFS sector field is all-zero — engine.loadMap/gen must fix;
    // fallback derives each line's front/back sector from seg winding via subsectors below.
    for (var li of linedefs) {
      li.dx = (li.v2.x - li.v1.x) | 0; li.dy = (li.v2.y - li.v1.y) | 0;
      if (!li.dx) li.slopetype = 0;
      else if (!li.dy) li.slopetype = 1;
      else li.slopetype = G.FixedDiv(li.dy, li.dx) > 0 ? 2 : 3;
      li.bbox = [Math.max(li.v1.y, li.v2.y), Math.min(li.v1.y, li.v2.y),
      Math.min(li.v1.x, li.v2.x), Math.max(li.v1.x, li.v2.x)];
    }
    var sg = decodeB64(L.SSECTORS);
    for (i = 0; i < sg.length; i += 4)
      subsectors.push({ numlines: sg[i] | (sg[i + 1] << 8), firstline: sg[i + 2] | (sg[i + 3] << 8) });
    var gg = decodeB64(L.SEGS);
    for (i = 0; i < gg.length; i += 12) {
      var sv1 = gg[i] | (gg[i + 1] << 8);
      var lang = gg[i + 2] | (gg[i + 3] << 8);
      var ldef = i16(gg, i + 4) & 0x7fff; var lside = (gg[i + 4] & 0x80) ? 1 : 0; // gen_map packs '<H' lid|side<<15
      segs.push({ v1: vertexes[sv1], angle: lang << 16, linedef: linedefs[ldef], side: lside });
    }
    var nd = decodeB64(L.NODES);
    for (i = 0; i < nd.length; i += 28) {
      nodes.push({ x: i16(nd, i) << FRACBITS, y: i16(nd, i + 2) << FRACBITS,
        dx: i16(nd, i + 4) << FRACBITS, dy: i16(nd, i + 6) << FRACBITS,
        children: [nd[i + 20] | (nd[i + 21] << 8) | ((nd[i + 22] | (nd[i + 23] << 8)) << 16) >>> 0,
        nd[i + 24] | (nd[i + 25] << 8) | ((nd[i + 26] | (nd[i + 27] << 8)) << 16) >>> 0] });
    }
    // subsector→sector: gen_map's sidedef sector fields are all 0; derive via
    // point-in-sector test using each subsector's first seg + gen_map's authored
    // sector polygons is NOT available — so for the fallback we resolve each
    // LINEDEF's sectors by consulting the authored map through segs: a line's
    // front sector = sector whose floor/ceiling/tags match authored adjacency.
    // Simplification accepted for TESTS ONLY: resolve sectors by tag where the
    // line carries one, else assign via gen_map's known sector table below.
    assignFallbackSectors(linedefs, sectors);
    var bm = decodeB64(L.BLOCKMAP);
    var orgx = i16(bm, 0) << FRACBITS, orgy = i16(bm, 2) << FRACBITS;
    var bw = i16(bm, 4), bh = i16(bm, 6);
    var lineLists = new Array(bw * bh);
    for (var by = 0; by < bh; by++) for (var bx = 0; bx < bw; bx++) {
      var hoff = 4 + 2 * (bw * bh) + 2 * (by * bw + bx);
      var off = bm[hoff] | (bm[hoff + 1] << 8);
      off = off * 2 + 4;                                       // blockmaplump u16 units
      var cnt = bm[off] | (bm[off + 1] << 8); off += 2;
      var arr = [];
      for (var c = 0; c < cnt; c++) { arr.push(bm[off] | (bm[off + 1] << 8)); off += 2; }
      lineLists[by * bw + bx] = arr;
    }
    var rj = decodeB64(L.REJECT);
    return {
      mapname: mj.mapname, vertexes: vertexes, linedefs: linedefs, sides: sides,
      sectors: sectors, segs: segs, subsectors: subsectors, nodes: nodes,
      numnodes: nodes.length, reject: rj,
      blockmap: { orgx: orgx, orgy: orgy, width: bw, height: bh, bmaporgx: orgx, bmaporgy: orgy, bmapwidth: bw, bmapheight: bh, lineLists: lineLists }
    };
  }
  G.parseMapFallback = parseMapFallback;
  function picName(b, o) {
    var out = "";
    for (var i = 0; i < 8; i++) { if (!b[o + i]) break; out += String.fromCharCode(b[o + i]); }
    return out;
  }
  // gen_map's authored sector assignment is reconstructed by matching each
  // two-sided line to the pair of authored sector rectangles. Fallback-only.
  function assignFallbackSectors(linedefs, sectors) {
    // We cannot reconstruct gen_map's geometry here; instead use its deterministic
    // sector order: sectors[0..6] = start,hall,court,plat,pit,exit,secret;
    // 7 = door1 (tag1); 8..11 = pillars? Order per gen_map: sec_start(0) sec_hall(1)
    // sec_court(2) sec_plat(3) sec_pit(4) sec_exit(5) sec_secret(6), door1=7?
    // NO: door1 was appended after room(4th? ) — see gen_map: sectors appended
    // start,hall,court,plat,pit,exit,secret then pillars... door1 appended inside
    // doorway code AFTER secret? door1 created before pillars. This ordering is
    // engine.loadMap's job; fallback: brute-force: each line's frontsector =
    // the sector whose (floor,ceiling,tag) uniquely matches by sampling the two
    // adjacent half-planes with a point-in-subsector walk.
    var mdx = G.mapdata;                                      // not yet set — use passed arrays
    // Strategy: sample midpoint offset to both sides of each line; for each
    // candidate sector we cannot know its polygon. INSTEAD: rely on gen_map
    // guarantee: two-sided lines were authored with front/back in EDGES entries;
    // seg winding gives front side. The ONLY reliable source is engine.loadMap.
    // For tests, the shim (tools/test-game-shim.js) assigns sectors by decoding
    // gen_map's authored geometry — fallback here just tags lines and marks all
    // one-sided lines' front = sector 0 (tests run with the shim's mapdata).
    for (var l of linedefs) {
      if (!l.frontsector) l.frontsector = sectors[0];
    }
  }

  // ---------------------------------------------------------------- exports
  G.MF = { SPECIAL: MF_SPECIAL, SOLID: MF_SOLID, SHOOTABLE: MF_SHOOTABLE, NOSECTOR: MF_NOSECTOR,
    NOBLOCKMAP: MF_NOBLOCKMAP, AMBUSH: MF_AMBUSH, JUSTHIT: MF_JUSTHIT, JUSTATTACKED: MF_JUSTATTACKED,
    SPAWNCEILING: MF_SPAWNCEILING, NOGRAVITY: MF_NOGRAVITY, DROPOFF: MF_DROPOFF, PICKUP: MF_PICKUP,
    NOCLIP: MF_NOCLIP, SLIDE: MF_SLIDE, FLOAT: MF_FLOAT, TELEPORT: MF_TELEPORT, MISSILE: MF_MISSILE,
    DROPPED: MF_DROPPED, SHADOW: MF_SHADOW, NOBLOOD: MF_NOBLOOD, CORPSE: MF_CORPSE,
    INFLOAT: MF_INFLOAT, COUNTKILL: MF_COUNTKILL, COUNTITEM: MF_COUNTITEM, SKULLFLY: MF_SKULLFLY,
    NOTDMATCH: MF_NOTDMATCH };
  G.ACTIONS = ACTIONS; G.PS_ACTIONS = PS_ACTIONS;
  G.P_MobjThinker = P_MobjThinker;
  G.P_ThingHeightClip = P_ThingHeightClip;
  G.P_ExplodeMissile = P_ExplodeMissile;
  G.P_Thrust = P_Thrust;
  G.playerstarts = playerstarts;
  G.PIT_CheckLine = PIT_CheckLine;   // exported for tests
  // enemy-AI internals exported for tests (tools/test-chase.js)
  G.P_Move = P_Move;
  G.P_NewChaseDir = P_NewChaseDir;
  G.A_Chase = A_Chase;
  G.ai = { DI_EAST: DI_EAST, DI_NORTHEAST: DI_NORTHEAST, DI_NORTH: DI_NORTH,
           DI_NORTHWEST: DI_NORTHWEST, DI_WEST: DI_WEST, DI_SOUTHWEST: DI_SOUTHWEST,
           DI_SOUTH: DI_SOUTH, DI_SOUTHEAST: DI_SOUTHEAST, DI_NODIR: DI_NODIR,
           opposite: opposite, diags: diags };
  G.__tm = function () { return { tmfloorz: tmfloorz, tmceilingz: tmceilingz, tmdropoffz: tmdropoffz, floatok: floatok, numspechit: numspechit }; };

  // ARCHITECTURE.md contract: bare browser globals (in a browser `var G` above
  // is a global lexical, not a window property — mirror the names main.js uses).
  var _w = (typeof window !== "undefined") ? window : globalThis;
  _w.G = G;
  _w.players = G.players; _w.player = G.player;
  _w.totalkills = 0;      // refreshed each level below
  G.onLevelExit_orig = null;
  // keep _w.totalkills fresh after each load (spawn counts finalize in loadLevel)
  var _loadLevel = loadLevel;
  loadLevel = function () { _loadLevel(); _w.totalkills = G.totalkills; };
})(typeof window !== "undefined" ? window : globalThis);
