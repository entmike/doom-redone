/* p_saveg.js — faithful port of reference/linuxdoom-1.10 p_saveg.c
   (P_ArchivePlayers/World/Thinkers/Specials + UnArchive counterparts) plus
   the g_game.c G_SaveGame/G_DoSaveGame/G_LoadGame/G_DoLoadGame drivers.

   DEVIATIONS (documented):
   - Storage: localStorage replaces doomsavN.dsg files. Key =
     'doom-redone:save:doomsavN'. The byte stream is ported structurally
     identical to vanilla (24-byte description, 16-byte "version 110",
     skill/episode/map/playeringame bytes, 3-byte leveltime, players/world/
     thinkers/specials, 0x1d consistancy marker, PADSAVEP 4-byte alignment
     before every player/mobj/special record) — except the archiver is
     field-wise instead of struct memcpy (JS has no sizeof(player_t)), and
     pointers become indices exactly where C did the same swizzle
     (state->index, player->1-based index, sector->index).
   - The map to reload comes from the stored map-json filename (the port
     loads maps by URL, not by lump name), kept in the JSON envelope so the
     byte stream itself stays vanilla-shaped.
   - G_DoLoadGame is async (the level JSON may need a fetch); the menu
     pauses the game for the (sub-frame) duration.
   - C leaves mobj->tracer/src stale pointers on unarchive (address-reuse
     luck); the port NULLs them — same observable behavior, no UB.
   - Vanilla quicksave/quickload F6/F9 keys, save-name entry and all menu
     wiring are restored per m_menu.c (port previously stubbed the whole
     load/save system as "no .dsg in a browser").
*/
'use strict';
(function (global) {
  var FRACBITS = 16;
  var SAVESTRINGSIZE = 24, VERSIONSIZE = 16, VERSION = 110;
  var MAXCEILINGS = 30, MAXPLATS = 30;                       // p_local.h
  var tc_end = 0, tc_mobj = 1;                               // p_saveg.c thinkerclass_t
  var tc_ceiling = 0, tc_door = 1, tc_floor = 2, tc_plat = 3,
      tc_flash = 4, tc_strobe = 5, tc_glow = 6, tc_endspecials = 7;   // specials_e
  var KEY_PREFIX = 'doom-redone:save:';
  var SAVEGAMENAME = 'doomsav';                              // dstrings.h
  // WAD-specific slot namespacing (browser persistence deviation): the
  // installed IWAD's content fingerprint (WadInstall.fingerprint) goes into
  // every key, so doom1 / DOOM2 / PLUTONIA / TNT saves never cross-talk, and
  // the envelope stores 'w' = same fp as a second guard on load. Slots from a
  // different WAD are hidden from the menus and REFUSED on load but kept in
  // localStorage (each WAD sees only its own slots); only legacy pre-
  // namespacing keys are nuked on boot (user-approved: 'nuke old saves if
  // need be').
  function wadFp() {
    // NB: wadinstall.js declares `const WadInstall` at classic-script top
    // level -> global lexical binding, NOT a window property. Reference the
    // bare identifier (typeof-guarded), never global.WadInstall.
    try { if (typeof WadInstall !== 'undefined' && WadInstall.fingerprint) return WadInstall.fingerprint(); } catch (e) {}
    try { if (global.WadInstall && global.WadInstall.fingerprint) return global.WadInstall.fingerprint(); } catch (e) {}
    return null;                                             // host/boot before install
  }
  function slotKey(slot) {
    var fp = wadFp();
    return KEY_PREFIX + (fp ? fp + ':' : '') + SAVEGAMENAME + slot;
  }
  // Delete legacy save keys that predate WAD namespacing (un-namespaced
  // 'doom-redone:save:doomsavN'). Saves belonging to OTHER WADs are keyspaced
  // under their own fingerprint: they stay invisible to this WAD's menus and
  // refuse to load here, so they are preserved (not nuked) — switching back
  // and forth between doom1/DOOM2/PLUTONIA keeps every WAD's slots intact.
  function nukeForeignSaves() {
    var fp = wadFp();
    try {
      var doomed = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (!k || k.indexOf(KEY_PREFIX) !== 0) continue;
        if (fp && k.indexOf(KEY_PREFIX + fp + ':') === 0) continue;   // ours
        if (k.slice(KEY_PREFIX.length).indexOf(':') !== -1) continue; // another WAD's namespaced key
        doomed.push(k);                                               // legacy un-namespaced
      }
      for (i = 0; i < doomed.length; i++) localStorage.removeItem(doomed[i]);
      return doomed.length;
    } catch (e) { return 0; }
  }
  var GGSAVED = 'game saved.';                               // d_englsh.h

  function G_() { return global.G; }

  // ---------------------------------------------------------------- writer
  function Writer() { this.b = []; this.al = 0; }
  Writer.prototype.align = function () {                     // PADSAVEP()
    var n = (4 - (this.al & 3)) & 3;
    for (var i = 0; i < n; i++) { this.b.push(0); this.al++; }
  };
  Writer.prototype.byte = function (v) { this.b.push((v | 0) & 0xff); this.al++; };
  Writer.prototype.word = function (v) { this.byte(v); this.byte(v >> 8); };
  Writer.prototype.int = function (v) {
    v = v | 0;
    this.byte(v); this.byte(v >> 8); this.byte(v >> 16); this.byte(v >> 24);
  };
  Writer.prototype.strN = function (s, n) {                  // char[] field memcpy
    s = s || '';
    for (var i = 0; i < n; i++) this.byte(i < s.length ? s.charCodeAt(i) : 0);
  };

  // ---------------------------------------------------------------- reader
  function Reader(b) { this.b = b; this.p = 0; this.al = 0; }
  Reader.prototype.align = function () { var n = (4 - (this.al & 3)) & 3; this.p += n; this.al += n; };
  Reader.prototype.byte = function () { var v = this.b[this.p] & 0xff; this.p++; this.al++; return v; };
  Reader.prototype.word = function () { var v = this.byte() | (this.byte() << 8); return v >= 32768 ? v - 65536 : v; };
  Reader.prototype.int = function () { return (this.byte() | (this.byte() << 8) | (this.byte() << 16) | (this.byte() << 24)) | 0; };
  Reader.prototype.strN = function (n) {
    var s = '';
    for (var i = 0; i < n; i++) { var c = this.byte(); if (c) s += String.fromCharCode(c); }
    return s;
  };

  function b64enc(bytes) {
    if (typeof btoa !== 'undefined') {
      var s = '', CH = 8192;
      for (var i = 0; i < bytes.length; i += CH)
        s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CH, bytes.length)));
      return btoa(s);
    }
    return Buffer.from(bytes).toString('base64');             // node (tests)
  }
  function b64dec(b64s) {
    if (typeof atob !== 'undefined') {
      var bin = atob(b64s), u = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
      return u;
    }
    return new Uint8Array(Buffer.from(b64s, 'base64'));       // node (tests)
  }

  // ------------------------------------------------ P_Archive/UnArchivePlayers
  // player_t fields in a fixed order (game.js newPlayer shape). C memcpy's
  // the whole struct; we enumerate every value field. cmd[] is the ticcmd.
  var PFIELDS = [
    ['playerstate', 0, 0], ['health', 0, 0], ['bonuscount', 0, 0],
    ['armorpoints', 0, 0], ['armortype', 0, 0],
    ['weaponowned', 2, 9, 1], ['ammo', 2, 5], ['maxammo', 2, 5],
    ['cards', 2, 6, 1], ['powers', 2, 6],
    ['backpack', 1, 0], ['readyweapon', 0, 0], ['pendingweapon', 0, 0],
    ['attackdown', 1, 0], ['refire', 0, 0], ['usedown', 1, 0],
    ['cheats', 0, 0], ['killcount', 0, 0], ['itemcount', 0, 0],
    ['secretcount', 0, 0], ['frags', 2, 5], ['damagecount', 0, 0],
    ['extralight', 0, 0], ['fixedcolormap', 0, 0], ['pitch', 0, 0],
    ['viewz', 0, 0], ['viewheight', 0, 0], ['deltaviewheight', 0, 0],
    ['bob', 0, 0], ['inventorycount', 2, 7], ['inventorytics', 2, 7]
  ];
  function P_ArchivePlayers(W) {
    var G = G_();
    for (var i = 0; i < 4; i++) {
      if (!G.playeringame[i]) continue;
      W.align();
      var p = G.players[i];
      W.byte(p.cmd.forwardmove); W.byte(p.cmd.sidemove);
      W.byte(p.cmd.angleturn); W.byte(p.cmd.buttons);
      for (var f = 0; f < PFIELDS.length; f++) {
        var fd = PFIELDS[f];
        if (fd[1] === 1) W.byte(p[fd[0]] ? 1 : 0);
        else if (fd[1] === 2) {
          var a = p[fd[0]] || [];
          for (var k = 0; k < fd[2]; k++) W.byte(fd[3] ? (a[k] ? 1 : 0) : (a[k] | 0));
        } else W.int(p[fd[0]] | 0);
      }
      // NUMPSPRITES: psprite state saved as states[] index (C: state - states)
      for (var j = 0; j < 2; j++) {
        var psp = p.psprites[j];
        W.int(psp.state ? (psp.state.num | 0) : 0);
        W.int(psp.tics | 0); W.int(psp.sx | 0); W.int(psp.sy | 0);
      }
    }
  }
  function P_UnArchivePlayers(R) {
    var G = G_();
    for (var i = 0; i < 4; i++) {
      if (!G.playeringame[i]) continue;
      R.align();
      var p = G.players[i];
      p.cmd.forwardmove = R.byte() << 24 >> 24; p.cmd.sidemove = R.byte() << 24 >> 24;
      p.cmd.angleturn = R.byte() << 24 >> 24;   p.cmd.buttons = R.byte();
      for (var f = 0; f < PFIELDS.length; f++) {
        var fd = PFIELDS[f];
        if (fd[1] === 1) p[fd[0]] = !!R.byte();
        else if (fd[1] === 2) {
          p[fd[0]] = [];
          for (var k = 0; k < fd[2]; k++) p[fd[0]][k] = fd[3] ? !!R.byte() : (R.byte() | 0);
        } else p[fd[0]] = R.int();
      }
      for (var j = 0; j < 2; j++) {
        var psp = p.psprites[j];
        var stn = R.int(); psp.tics = R.int(); psp.sx = R.int(); psp.sy = R.int();
        psp.state = stn ? G.states[stn] : null;
      }
      // p_saveg.c: pointers cleared; player->mo relinked at thinker restore
      p.mo = null; p.message = null; p.attacker = null;
    }
  }

  // ------------------------------------------------ P_Archive/UnArchiveWorld
  function P_ArchiveWorld(W) {
    var G = G_(), sectors = G.sectors, lines = G.lines, sides = G.sides;
    for (var i = 0; i < sectors.length; i++) {
      var sec = sectors[i];
      W.word(sec.floorheight >> FRACBITS); W.word(sec.ceilingheight >> FRACBITS);
      W.word(sec.floorpic); W.word(sec.ceilingpic);
      W.word(sec.lightlevel); W.word(sec.special); W.word(sec.tag);
    }
    for (i = 0; i < lines.length; i++) {
      var li = lines[i];
      W.word(li.flags); W.word(li.special); W.word(li.tag);
      for (var j = 0; j < 2; j++) {
        if (li.sidenum[j] === -1) continue;
        var si = sides[li.sidenum[j]];
        W.word(si.textureoffset >> FRACBITS); W.word(si.rowoffset >> FRACBITS);
        W.word(si.toptexture); W.word(si.bottomtexture); W.word(si.midtexture);
      }
    }
  }
  function P_UnArchiveWorld(R) {
    var G = G_(), sectors = G.sectors, lines = G.lines, sides = G.sides;
    for (var i = 0; i < sectors.length; i++) {
      var sec = sectors[i];
      sec.floorheight = R.word() << FRACBITS; sec.ceilingheight = R.word() << FRACBITS;
      sec.floorpic = R.word(); sec.ceilingpic = R.word();
      sec.lightlevel = R.word(); sec.special = R.word(); sec.tag = R.word();
      sec.specialdata = null; sec.soundtarget = null;         // p_saveg.c: = 0
    }
    for (i = 0; i < lines.length; i++) {
      var li = lines[i];
      li.flags = R.word(); li.special = R.word(); li.tag = R.word();
      for (var j = 0; j < 2; j++) {
        if (li.sidenum[j] === -1) continue;
        var si = sides[li.sidenum[j]];
        si.textureoffset = R.word() << FRACBITS; si.rowoffset = R.word() << FRACBITS;
        si.toptexture = R.word(); si.bottomtexture = R.word(); si.midtexture = R.word();
      }
    }
  }

  // ------------------------------------------------ P_Archive/UnArchiveThinkers
  // mobj_t value fields in a fixed order (P_SpawnMobj shape + runtime).
  var MFIELDS = ['x', 'y', 'z', 'momx', 'momy', 'momz', 'angle', 'radius', 'height',
    'flags', 'health', 'movedir', 'reactiontime', 'threshold', 'damagecount',
    'movecount', 'refire', 'lastlook', 'tics', 'floorz', 'ceilingz'];
  function spriteCode(spr) {
    if (spr == null) return 255;
    if (typeof spr === 'number') return spr;
    var idx = global.spriteNameIdx[spr];
    return idx === undefined ? 255 : idx;
  }
  function spriteName(code) {
    if (code === 255) return null;
    return global.sprites[code].name;
  }
  function P_ArchiveThinkers(W) {
    var G = G_();
    for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next) {
      if (th.function !== G.P_MobjThinker) continue;
      W.byte(tc_mobj); W.align();
      for (var i = 0; i < MFIELDS.length; i++) W.int(th[MFIELDS[i]] | 0);
      W.int(th.state ? (th.state.num | 0) : 0);
      W.byte(spriteCode(th.sprite));
      W.word(th.frame | 0);                                   // FF_FULLBRIGHT frames exceed 255
      W.word(th.type | 0);
      W.byte(th.player ? (G.players.indexOf(th.player) + 1) : 0);
      var sp = th.spawnpoint;                                 // C: mthing ptr (stable level array)
      W.int(sp ? 1 : 0);
      if (sp) { W.word(sp.x | 0); W.word(sp.y | 0); W.int(sp.angle | 0); W.word(sp.type | 0); W.word(sp.options | 0); }
    }
    W.byte(tc_end);
  }
  function P_UnArchiveThinkers(R) {
    var G = G_();
    // p_saveg.c: drop every current thinker (level freshly spawned by
    // G_InitNew), re-init the list, then re-create from the stream.
    for (var t = G.thinkercap.next; t !== G.thinkercap;) {
      var nx = t.next;
      if (t.info) G.P_RemoveMobj(t); else G.P_RemoveThinker(t);
      t = nx;
    }
    G.P_InitThinkers();
    for (;;) {
      var tclass = R.byte();
      if (tclass === tc_end) return;
      if (tclass !== tc_mobj) throw new Error('Unknown tclass ' + tclass + ' in savegame');
      R.align();
      var mobj = {};
      for (var i = 0; i < MFIELDS.length; i++) mobj[MFIELDS[i]] = R.int();
      var stateN = R.int(), sprCode = R.byte(), frame = R.word(), type = R.word(), plr = R.byte();
      var hasSp = R.int();
      var sp = null;
      if (hasSp) sp = { x: R.word(), y: R.word(), angle: R.int(), type: R.word(), options: R.word() };
      mobj.state = G.states[stateN];
      mobj.sprite = spriteName(sprCode);
      mobj.frame = frame;
      mobj.type = type;
      mobj.info = G.mobjinfo[type];
      mobj.player = plr ? G.players[plr - 1] : null;
      mobj.spawnpoint = sp;
      mobj.target = null; mobj.tracer = null;                 // C leaves them stale; we NULL (deviation noted)
      mobj.thinker = mobj;                                    // port: mobj IS its thinker
      mobj.function = G.P_MobjThinker;
      mobj.snext = mobj.sprev = mobj.bnext = mobj.bprev = null;
      if (mobj.player) mobj.player.mo = mobj;                 // p_saveg.c: player->mo = mobj
      G.P_SetThingPosition(mobj);
      mobj.floorz = mobj.subsector.sector.floorheight;
      mobj.ceilingz = mobj.subsector.sector.ceilingheight;
      G.P_AddThinker(mobj);
    }
  }

  // ------------------------------------------------ P_Archive/UnArchiveSpecials
  // Per-type field lists (union structs from p_local.h; port object shapes).
  var SP_FIELDS = {
    ceiling: { struct: ['type', 'crush', 'tag', 'speed', 'topheight', 'bottomheight', 'direction'] },
    door:    { struct: ['type', 'direction', 'topwait', 'topcountdown', 'speed', 'topheight'] },
    floor:   { struct: ['type', 'crush', 'direction', 'speed', 'floordestheight', 'wait', 'newspecial'] },
    plat:    { struct: ['tag', 'type', 'status', 'speed', 'low', 'high', 'wait', 'crush'] },
    flash:   { struct: ['maxlight', 'minlight', 'maxtime', 'mintime', 'count'] },
    strobe:  { struct: ['maxlight', 'minlight', 'darktime', 'brighttime', 'count'] },
    glow:    { struct: ['minlight', 'maxlight', 'direction'] }
  };
  var SP_FN = [
    ['ceiling', 'T_MoveCeiling'], ['door', 'T_VerticalDoor'], ['floor', 'T_MoveFloor'],
    ['plat', 'T_PlatRaise'], ['flash', 'T_LightFlash'], ['strobe', 'T_StrobeFlash'],
    ['glow', 'T_Glow']
  ];
  function spWrite(W, kind, code, th) {
    W.byte(code); W.align();
    var f = SP_FIELDS[kind].struct, sec = th.sector;
    W.int(G_().sectors.indexOf(sec));
    for (var i = 0; i < f.length; i++) W.int(th[f[i]] | 0);
  }
  function spRead(R, kind, secSetter) {
    R.align();
    var G = G_(), o = {};
    o.sector = G.sectors[R.int()];
    var f = SP_FIELDS[kind].struct;
    for (var i = 0; i < f.length; i++) o[f[i]] = R.int();
    if (secSetter) secSetter(o);
    return o;
  }
  function P_ArchiveSpecials(W) {
    var G = G_();
    for (var th = G.thinkercap.next; th !== G.thinkercap; th = th.next) {
      if (th.function === G.P_MobjThinker) continue;          // not a special
      for (var s = 0; s < SP_FN.length; s++) {
        if (th.function === G[SP_FN[s][1]]) { spWrite(W, SP_FN[s][0], tc_ceiling + s, th); break; }
      }
    }
    W.byte(tc_endspecials);
  }
  function P_UnArchiveSpecials(R) {
    var G = G_();
    for (;;) {
      var tclass = R.byte();
      if (tclass === tc_endspecials) return;
      if (tclass < tc_ceiling || tclass > tc_glow)
        throw new Error('P_UnarchiveSpecials: Unknown tclass ' + tclass + ' in savegame');
      var kind = SP_FN[tclass][0], fnName = SP_FN[tclass][1];
      var o = null;
      switch (kind) {
        case 'ceiling':
          o = spRead(R, kind, function (c) { c.sector.specialdata = c; });
          o.thinker = o; o.function = G.T_MoveCeiling;
          G.P_AddThinker(o); G.P_AddActiveCeiling(o); break;
        case 'door':
          o = spRead(R, kind, function (c) { c.sector.specialdata = c; });
          o.thinker = o; o.function = G.T_VerticalDoor;
          G.P_AddThinker(o); break;
        case 'floor':
          o = spRead(R, kind, function (c) { c.sector.specialdata = c; });
          o.thinker = o; o.function = G.T_MoveFloor;
          G.P_AddThinker(o); break;
        case 'plat':
          o = spRead(R, kind, function (c) { c.sector.specialdata = c; });
          o.thinker = o; o.function = G.T_PlatRaise;           // port keeps fn live even in stasis (status preserved)
          G.P_AddThinker(o); G.P_AddActivePlat(o); break;
        case 'flash':
          o = spRead(R, kind); o.thinker = o; o.function = G.T_LightFlash;
          G.P_AddThinker(o); break;
        case 'strobe':
          o = spRead(R, kind); o.thinker = o; o.function = G.T_StrobeFlash;
          G.P_AddThinker(o); break;
        case 'glow':
          o = spRead(R, kind); o.thinker = o; o.function = G.T_Glow;
          G.P_AddThinker(o); break;
      }
    }
  }

  // ---------------------------------------------------------------- G_DoSaveGame (g_game.c:1270)
  function G_DoSaveGame() {
    var G = G_();
    var W = new Writer();
    W.strN(SAVE.savedescription, SAVESTRINGSIZE);
    W.strN('version ' + VERSION, VERSIONSIZE);
    W.byte(G.gameskill); W.byte(G.gameepisode); W.byte(G.gamemap);
    for (var i = 0; i < 4; i++) W.byte(G.playeringame[i] ? 1 : 0);
    W.byte(G.leveltime >> 16); W.byte(G.leveltime >> 8); W.byte(G.leveltime);
    P_ArchivePlayers(W);
    P_ArchiveWorld(W);
    P_ArchiveThinkers(W);
    P_ArchiveSpecials(W);
    W.byte(0x1d);                                             // consistancy marker
    var bytes = new Uint8Array(W.b);
    var env = {
      d: SAVE.savedescription,
      n: G.currentMapName || null,
      secretexit: !!G.secretexit, didsecret: !!G.didsecret,
      a: b64enc(bytes)
    };
    try {
      env.w = wadFp();                                       // WAD fingerprint guard
      localStorage.setItem(slotKey(SAVE.savegameslot), JSON.stringify(env));
      // Persistence audit: an item that reads back missing means the browser
      // context has no localStorage (opaque origin / blocked storage) — the
      // save is gone. Never claim "game saved." then.
      var back = null;
      try { back = localStorage.getItem(slotKey(SAVE.savegameslot)); } catch (e2) {}
      if (back === null) {
        G.players[G.consoleplayer].message = 'SAVE FAILED: browser storage blocked';
        SAVE.pendingSave = null;
        return;
      }
    } catch (e) {                                            // quota / blocked storage
      G.players[G.consoleplayer].message = 'SAVE FAILED: browser storage unavailable';
      SAVE.pendingSave = null;
      return;
    }
    SAVE.savedescription = '';
    G.players[G.consoleplayer].message = GGSAVED;
    SAVE.pendingSave = null;
  }

  // G_SaveGame — called by the menu; save happens next tic (C: sendsave ->
  // gameaction = ga_savegame inside G_BuildTiccmd, processed by next G_Ticker).
  function G_SaveGame(slot, description) {
    SAVE.savegameslot = slot;
    SAVE.savedescription = (description || '').slice(0, SAVESTRINGSIZE - 1);
    SAVE.pendingSave = true;
  }

  // ---------------------------------------------------------------- G_DoLoadGame (g_game.c:1201)
  function G_DoLoadGame(slot, done) {
    var G = G_();
    var raw = null;
    try { raw = localStorage.getItem(slotKey(slot)); } catch (e) {}
    if (!raw) { if (done) done(false); return; }
    var env;
    try { env = JSON.parse(raw); } catch (e) { if (done) done(false); return; }
    // foreign-WAD save (namespaced key predates a hot-load, or envelope fp
    // mismatches the installed WAD): reject rather than corrupt the run.
    if (env.w && wadFp() && env.w !== wadFp()) { if (done) done(false); return; }
    var bytes = b64dec(env.a);
    var save_p = new Reader(bytes);
    save_p.strN(SAVESTRINGSIZE);                              // skip description
    var vcheck = save_p.strN(VERSIONSIZE);
    if (vcheck !== 'version ' + VERSION) { if (done) done(false); return; }  // bad version
    var gameskill = save_p.byte(), gameepisode = save_p.byte(), gamemap = save_p.byte();
    for (var i = 0; i < 4; i++) G.playeringame[i] = !!save_p.byte();
    G.gameskill = gameskill; G.gameepisode = gameepisode; G.gamemap = gamemap;

    function apply() {
      G.leveltime = (save_p.byte() << 16) + (save_p.byte() << 8) + save_p.byte();
      P_UnArchivePlayers(save_p);
      P_UnArchiveWorld(save_p);
      P_UnArchiveThinkers(save_p);
      P_UnArchiveSpecials(save_p);
      // if (*save_p != 0x1d) I_Error("Bad savegame")
      if (save_p.byte() !== 0x1d) { if (done) done(false); return; }
      G.secretexit = !!env.secretexit; G.didsecret = !!env.didsecret;
      if (done) done(true);
    }

    // load a base level (G_InitNew). Map JSON: reuse cache when the name
    // matches what's already loaded, else fetch (main.js seam).
    var mapName = env.n || G.currentMapName;
    function initAndApply() {
      G.G_InitNew(gameskill, gameepisode, gamemap);
      apply();
    }
    if (mapName && mapName !== G.currentMapName) {
      if (SAVE.fetchMap) {
        SAVE.fetchMap(mapName, function (json) {
          if (!json) { if (done) done(false); return; }
          G.currentMapName = mapName;
          G.currentMapJson = json;
          initAndApply();
        });
      } else { if (done) done(false); }
    } else {
      initAndApply();
    }
  }

  // G_LoadGame — menu entry point; deferred to next G_Ticker (gameaction).
  function G_LoadGame(slot) { SAVE.pendingLoad = slot; }

  // ---------------------------------------------------------------- save listing (M_ReadSaveStrings)
  function readSlot(slot) {
    try {
      var raw = localStorage.getItem(slotKey(slot));
      if (!raw) return null;
      var env = JSON.parse(raw);
      return env && typeof env.d === 'string' ? env.d : null;
    } catch (e) { return null; }
  }

  var SAVE = {
    savegameslot: 0, savedescription: '',
    pendingSave: null, pendingLoad: null,
    fetchMap: null,
    G_SaveGame: G_SaveGame, G_LoadGame: G_LoadGame,
    nukeForeignSaves: nukeForeignSaves, slotKey: slotKey,
    readSlot: readSlot,
    // test/CDR entry points (synchronous drivers of the deferred actions):
    DoSaveGame: G_DoSaveGame, DoLoadGame: G_DoLoadGame,
    ArchiveAll: function () { var W = new Writer(); P_ArchivePlayers(W); P_ArchiveWorld(W); P_ArchiveThinkers(W); P_ArchiveSpecials(W); return W; },
    UnArchiveAll: function (W) {                              // round-trip helper for tests
      var R = new Reader(new Uint8Array(W.b)); R.al = W.al;
      // NOTE: test helper — callers must position past headers; used only
      // for same-session archive/unarchive equivalence checks.
      return R;
    }
  };
  global.SAVE = SAVE;
})(typeof window !== 'undefined' ? window : globalThis);
