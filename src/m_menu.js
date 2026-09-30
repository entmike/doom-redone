/* m_menu.js — title screen, intro/demo loop and the menu system.
   Verbatim ports of reference/linuxdoom-1.10 m_menu.c (menus, responder,
   drawer, skull ticker), d_main.c D_DoAdvanceDemo/D_PageTicker/D_PageDrawer
   and g_game.c demo playback (G_DoPlayDemo/G_ReadDemoTiccmd/
   G_CheckDemoStatus). Draws into a 320x200 indexed screen and LUTs to the
   engine viewbuffer, same pattern as wi.js.

   Deviations (documented):
   - gamemode from wadinstall.detectMode (globalThis.gamemode); M_Init /
     menus / demo loop branch on it per m_menu.c's version switches
     IdentifyVersion fallback). M_Init applies the shareware hack
     (EpiDef.numitems-- removes the 4th episode).
   - Load/Save games: no .dsg files in a browser; M_ReadSaveStrings shows all
     slots "Empty" and selecting a slot pops the vanilla "you can't ..."
     message instead of G_LoadGame (menu still fully navigable).
   - M_QuitDOOM response reloads the page (I_Quit analogue).
   - The demo ticcmd reader feeds players[].cmd inside G_Ticker (the port's
     G_Ticker takes a single ticcmd argument; main.js passes the user cmd
     which the demo reader overwrites, mirroring G_BuildTiccmd).
   - pause key: vanilla toggles `paused` in G_Ticker via BT_SPECIAL buttons;
     main.js raises those bits and game.js executes the toggle. */
'use strict';
(function (global) {
  var SCREENWIDTH = 320, SCREENHEIGHT = 200, TICRATE = 35;
  var TRANS = 255;

  // doomdef.h key codes
  var KEY_RIGHTARROW = 0xae, KEY_LEFTARROW = 0xac, KEY_UPARROW = 0xad,
      KEY_DOWNARROW = 0xaf, KEY_ESCAPE = 27, KEY_ENTER = 13, KEY_BACKSPACE = 127,
      KEY_F1 = 0x80 + 0x3b, KEY_F2 = 0x80 + 0x3c, KEY_F3 = 0x80 + 0x3d,
      KEY_F4 = 0x80 + 0x3e, KEY_F5 = 0x80 + 0x3f, KEY_F6 = 0x80 + 0x40,
      KEY_F7 = 0x80 + 0x41, KEY_F8 = 0x80 + 0x42, KEY_F9 = 0x80 + 0x43,
      KEY_F10 = 0x80 + 0x44, KEY_F12 = 0x80 + 0x58,
      KEY_MINUS = 0x2d, KEY_EQUALS = 0x3d;
  // BT_SPECIAL / BTS_PAUSE (doomdef.h)
  var BT_SPECIAL = 128, BTS_PAUSE = 0x40;

  // m_menu.c:107-133
  var SAVESTRINGSIZE = 24, SKULLXOFF = -32, LINEHEIGHT = 16;
  var EMPTYSTRING = 'Empty';

  // m_menu.c:76-84 + d_main.c defaults (shareware default.cfg: sfx/music 8,
  // mouseSensitivity 5, screenblocks 10, detail 0, showMessages 1)
  var mouseSensitivity = 5, showMessages = 1, detailLevel = 0, screenblocks = 10;
  var snd_SfxVolume = 15, snd_MusicVolume = 15;    // S_Init(15,15) port values
  var screenSize = screenblocks - 3;
  var quickSaveSlot = -1;

  // --------------------------------------------------------------------------
  // default.cfg equivalent -> localStorage (m_misc.c M_SaveDefaults /
  // M_LoadDefaults). Browser deviation: same names, storage instead of file.
  var DEFAULTS_KEY = '⚓DOOM⚓';
  var DEFAULT_KEYS = ['mouse_sensitivity', 'sfx_volume', 'music_volume',
                      'show_messages', 'screenblocks', 'detaillevel'];
  function defaultsObject() {
    return { mouse_sensitivity: mouseSensitivity, sfx_volume: snd_SfxVolume,
             music_volume: snd_MusicVolume, show_messages: showMessages,
             screenblocks: screenblocks, detaillevel: detailLevel };
  }
  function clampInt(v, lo, hi) {
    v = Math.round(+v); if (!isFinite(v)) return null;
    return v < lo ? lo : v > hi ? hi : v;
  }
  function storage() { try { var s = global.localStorage; s.getItem('⚓'); return s; }
                       catch (e) { return null; } }   // private-mode throws
  function SaveDefaults() {
    var st = storage(); if (!st) return;
    try { st.setItem(DEFAULTS_KEY, JSON.stringify(defaultsObject())); }
    catch (e) { /* quota / disabled storage: vanilla's fopen-fail path */ }
  }
  function LoadDefaults() {
    var st = storage(); if (!st) return;
    var raw = null;
    try { raw = st.getItem(DEFAULTS_KEY); } catch (e) { return; }
    if (!raw) return;
    var d; try { d = JSON.parse(raw); } catch (e) { return; }
    if (!d || typeof d !== 'object') return;
    var v;
    if ((v = clampInt(d.mouse_sensitivity, 0, 9)) !== null) mouseSensitivity = v;
    if ((v = clampInt(d.sfx_volume, 0, 15)) !== null) snd_SfxVolume = v;
    if ((v = clampInt(d.music_volume, 0, 15)) !== null) snd_MusicVolume = v;
    if ((v = clampInt(d.show_messages, 0, 1)) !== null) showMessages = v;
    if ((v = clampInt(d.screenblocks, 3, 11)) !== null) screenblocks = v;
    if ((v = clampInt(d.detaillevel, 0, 1)) !== null) detailLevel = v;
    screenSize = screenblocks - 3;
  }

  // d_main.c:414-416 (D_DoAdvanceDemo state)
  var demosequence = -1, pagetic = 0, pagename = 'TITLEPIC';
  var advancedemo = false;

  // menu state (m_menu.c globals)
  var menuactive = 0, itemOn = 0, skullAnimCounter = 10, whichSkull = 0;
  var currentMenu = null;
  var messageToPrint = 0, messageString = null, messageNeedsInput = false,
      messageRoutine = null, messageLastMenuActive = 0;
  var inhelpscreens = false;
  var saveStringEnter = 0, saveSlot = 0, saveCharIndex = 0;
  var savegamestrings = [], saveOldString = '';
  for (var i = 0; i < 10; i++) savegamestrings.push(EMPTYSTRING);

  // g_game.c demo playback state
  var demoplayback = false, demo_p = 0, demobuffer = null;

  // d_englsh.h message strings (shareware set)
  var PRESSKEY = 'press a key.', PRESSYN = 'press y or n.';
  var NEWGAME = 'you can\'t start a new game\nwhile in a network game.\n\n' + PRESSKEY;
  var NIGHTMARE = 'are you sure? this skill level\nisn\'t even remotely fair.\n\n' + PRESSYN;
  var SWSTRING = 'this is the shareware version of doom.\n\nyou need to order the entire trilogy.\n\n' + PRESSKEY;
  var SAVEDEAD = 'you can\'t save if you aren\'t playing!\n\n' + PRESSKEY;
  var LOADNET = 'you can\'t do load while in a net game!\n\n' + PRESSKEY;
  // d_englsh.h quicksave/quickload strings
  var QLOADNET = 'you can\'t quickload during a netgame!\n\n' + PRESSKEY;
  var QSAVESPOT = 'you haven\'t picked a quicksave slot yet!\n\n' + PRESSKEY;
  var QSPROMPT = 'quicksave over your game named\n\n\'%s\'?\n\n' + PRESSYN;
  var QLPROMPT = 'do you want to quickload the game named\n\n\'%s\'?\n\n' + PRESSYN;
  var SAVESTRINGSIZE = 24;                       // g_game.h
  var HU_FONTSTARTC = 33, HU_FONTSIZEC = 63;     // hu_stuff.h ('!'..'_')
  var ENDGAME = 'are you sure you want to end the game?\n\n' + PRESSYN;
  var DOSY = '(press y to quit)';
  // dstrings.c endmsg[] — ALL 23 strings ship in every build (the exe is one
  // compile-time table; M_QuitDOOM indexes 1..20 regardless of gamemode).
  var endmsg = [
    'are you sure you want to\nquit this great game?',
    'please don\'t leave, there\'s more\ndemons to toast!',
    'let\'s beat it -- this is turning\ninto a bloodbath!',
    'i wouldn\'t leave if i were you.\ndos is much worse.',
    'you\'re trying to say you like dos\nbetter than me, right?',
    'don\'t leave yet -- there\'s a\ndemon around that corner!',
    'ya know, next time you come in here\ni\'m gonna toast ya.',
    'go ahead and leave. see if i care.',
    // DOOM II messages
    'you want to quit?\nthen, thou hast lost an eighth!',
    'don\'t go now, there\'s a \ndimensional shambler waiting\nat the dos prompt!',
    'get outta here and go back\nto your boring programs.',
    'if i were your boss, i\'d \n deathmatch ya in a minute!',
    'look, bud. you leave now\nand you forfeit your body count!',
    'just leave. when you come\nback, i\'ll be waiting with a bat.',
    'you\'re lucky i don\'t smack\nyou for thinking about leaving.',
    // FinalDOOM? — dstrings.c keeps these; unreachable via gametic%20+1
    'fuck you, pussy!\nget the fuck out!',
    'you quit and i\'ll jizz\nin your cystholes!',
    'if you leave, i\'ll make\nthe lord drink my jizz.',
    'hey, ron! can we say\n\'fuck\' in the game?',
    'i\'d leave: this is just\nmore monsters and levels.\nwhat a load.',
    'suck it down, asshole!\nyou\'re a fucking wimp!',
    'don\'t quit now! we\'re \nstill spending your money!',
    'THIS IS NO MESSAGE!\nPage intentionally left blank.'
  ];
  var NUM_QUITMESSAGES = 22;   // dstrings.h
  var endstring = '';

  // ------------------------------------------------------------------ patches
  var P = null;
  function b64(s) {
    if (typeof atob === 'function') { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
    return new Uint8Array(Buffer.from(s, 'base64'));
  }
  function src() {
    // title.js may be dynamically appended (script tag) — its `const TITLE`
    // isn't a shared lexical then, so the file also assigns globalThis.TITLE.
    return global.TITLE;
  }
  function huSrc() {   // STCFN glyphs + CREDIT live in INTERLUDE (wi.js assets)
    return (typeof INTERLUDE !== 'undefined') ? INTERLUDE : global.INTERLUDE;
  }
  function patch(name) {
    if (!P) {
      P = {};
      var s = src().patches;
      for (var k in s) P[k] = { w: s[k][0], h: s[k][1], px: b64(s[k][2]), left: s[k][3], top: s[k][4] };
    }
    if (!P[name]) {   // CREDIT etc. from the intermission bundle
      var L = huSrc().patches;
      if (!L[name]) return undefined;
      P[name] = { w: L[name][0], h: L[name][1], px: b64(L[name][2]), left: L[name][3], top: L[name][4] };
    }
    return P[name];
  }
  // hu_font (hu_stuff.c HU_FONTSTART=33, HU_FONTSIZE=95-33+1)
  function huFont(code) {
    if (code < 33 || code > 95) return null;
    return patch('STCFN' + ('00' + code).slice(-3));
  }

  // ------------------------------------------------------------------ indexed screen
  // DST: current patch destination (FB indexed screen, or null = viewbuffer)
  var FB = null, lut = null, DST = null;
  function buildLut() {
    var A = (typeof ASSETS !== 'undefined') ? ASSETS : global.ASSETS;
    var pal = (A.palettes && A.palettes[0]) || A.palette;
    var cm = global.COLORMAPS;
    lut = new Uint32Array(256);
    for (var s = 0; s < 256; s++) {
      var idx = cm ? cm[s] : s;                 // COLORMAP table 0 (fullbright)
      var c = pal[idx];
      lut[s] = 0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0];
    }
  }
  // V_DrawPatch: draws onto DST when set (indexed screen), otherwise straight
  // onto the engine viewbuffer through the fullbright LUT (menu-over-3D-view
  // overlay — the port can't inverse-map shaded pixels back to indices;
  // documented deviation, visually identical: menu art is opaque).
  function drawPatch(x, y, p) {
    if (!p) return;
    x -= p.left; y -= p.top;
    var x1 = x < 0 ? -x : 0, y1 = y < 0 ? -y : 0;
    var x2 = Math.min(p.w, SCREENWIDTH - x), y2 = Math.min(p.h, SCREENHEIGHT - y);
    if (DST) {
      for (var yy = y1; yy < y2; yy++) {
        var row = (y + yy) * SCREENWIDTH + x, srci = yy * p.w;
        for (var xx = x1; xx < x2; xx++) {
          var c = p.px[srci + xx];
          if (c !== TRANS) DST[row + xx] = c;
        }
      }
    } else {
      var vb = global.viewbuffer;
      if (!vb) return;
      for (var yy2 = y1; yy2 < y2; yy2++) {
        var row2 = (y + yy2) * SCREENWIDTH + x, srci2 = yy2 * p.w;
        for (var xx2 = x1; xx2 < x2; xx2++) {
          var c2 = p.px[srci2 + xx2];
          if (c2 !== TRANS) vb[row2 + xx2] = lut[c2];
        }
      }
    }
  }
  function clearFB() { FB.fill(0); }

  // ------------------------------------------------------------------ M_* text (m_menu.c:1809-1866)
  function M_StringWidth(str) {
    var w = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str.toUpperCase()[i].charCodeAt(0) - 33;
      var f = (c >= 0 && c < 63) ? huFont(c + 33) : null;
      if (!f || c < 0 || c >= 63) w += 4;
      else w += f.w;
    }
    return w;
  }
  function M_StringHeight(str) {
    // gospel: SHORT(hu_font[0]->height) — patch cache stores .h (m_menu.c:1857)
    var h = huFont(33).h;
    for (var i = 0; i < str.length; i++) if (str[i] === '\n') h += huFont(33).h;
    return h;
  }
  function M_WriteText(x, y, str) {
    for (var i = 0; i < str.length; i++) {
      var c = str.toUpperCase()[i].charCodeAt(0);
      var p = huFont(c);
      if (!p) { x += 4; }        // m_menu.c: char outside hu_font advances 4 (spaces)
      else { drawPatch(x, y, p); x += p.w; }
    }
  }

  function sfx(name) {
    if (global.Snd && global.Snd.S_StartSound) global.Snd.S_StartSound(null, global.Snd.sfx['sfx_' + name]);
  }

  // ------------------------------------------------------------------ menus (verbatim tables)
  var epi = 0;    // m_menu.c:846 selected episode (0-based)

  function M_SetupNextMenu(menudef) { currentMenu = menudef; itemOn = currentMenu.lastOn; }
  function M_StartControlPanel() {
    if (menuactive) return;             // intro might call this repeatedly
    menuactive = 1;
    currentMenu = MainDef;
    itemOn = currentMenu.lastOn;
  }
  function M_ClearMenus() { menuactive = 0; }
  function M_StartMessage(str, routine, input) {
    messageToPrint = 1; messageString = str; messageRoutine = routine;
    messageNeedsInput = !!input;
    messageLastMenuActive = menuactive;
    menuactive = 1;
  }

  // --- New Game / Episode / Skill ------------------------------------------
  function M_ChooseSkill(choice) {
    if (choice === 4) { M_StartMessage(NIGHTMARE, M_VerifyNightmare, true); return; }
    hooks.newGame(choice, epi + 1, 1);       // G_DeferedInitNew(choice, epi+1, 1)
    M_ClearMenus();
  }
  function M_VerifyNightmare(ch) {
    if (ch !== 121 /* 'y' */) return;
    hooks.newGame(4 /*nightmare*/, epi + 1, 1);
    M_ClearMenus();
  }
  var GM = function () { return globalThis.gamemode || 'shareware'; };
  function M_NewGame(choice) {
    // m_menu.c:881 commercial skips the episode menu (no episodes in DOOM 2)
    M_SetupNextMenu(GM() === 'commercial' ? NewDef : EpiDef);
  }
  function M_Episode(choice) {
    // m_menu.c:919-937: only shareware gates ep 2-4 behind the SW ad message
    if (GM() === 'shareware' && choice) {
      M_StartMessage(SWSTRING, null, false); M_SetupNextMenu(ReadDef1); return;
    }
    epi = choice;
    M_SetupNextMenu(NewDef);
  }

  // --- Options ---------------------------------------------------------------
  function M_Options(choice) { M_SetupNextMenu(OptionsDef); }
  function M_EndGame(choice) {
    if (!hooks.usergame()) { sfx('oof'); return; }
    M_StartMessage(ENDGAME, M_EndGameResponse, true);
  }
  function M_EndGameResponse(ch) {
    if (ch !== 121 /* 'y' */) return;
    currentMenu.lastOn = itemOn;
    M_ClearMenus();
    hooks.startTitle();                  // D_StartTitle()
  }
  function M_ChangeMessages() { showMessages = 1 - showMessages; SaveDefaults(); }
  function M_ChangeDetail() {
    detailLevel = 1 - detailLevel;
    // DEVIATION (user request): gospel M_ChangeDetail (m_menu.c:1131) is a
    // dead no-op ("FIXME - does not work. Remove anyway?"). This port's
    // engine DOES implement blocky mode (R_DrawColumnLow/R_DrawSpanLow,
    // r_main.c:702 colfunc/spanfunc swap), so apply the setting like the
    // commented-out gospel tail did. detailLevel 1 = low (viewwidth halved,
    // each column drawn twice); 0 = high. Persisted via SaveDefaults
    // (default.cfg 'detaillevel'), restored by applySavedSettings at boot.
    hooks.setViewSize(screenblocks, detailLevel);
    SaveDefaults();
  }
  function M_SizeDisplay(choice) {
    switch (choice) {
      case 0: if (screenSize > 0) { screenblocks--; screenSize--; } break;
      case 1: if (screenSize < 8) { screenblocks++; screenSize++; } break;
    }
    hooks.setViewSize(screenblocks, detailLevel);   // R_SetViewSize
    SaveDefaults();
  }
  function M_ChangeSensitivity(choice) {
    switch (choice) {
      case 0: if (mouseSensitivity) mouseSensitivity--; break;
      case 1: if (mouseSensitivity < 9) mouseSensitivity++; break;
    }
    hooks.setMouseSensitivity(mouseSensitivity);
    SaveDefaults();
  }
  function M_Sound(choice) { M_SetupNextMenu(SoundDef); }
  function M_SfxVol(choice) {
    switch (choice) {
      case 0: if (snd_SfxVolume) snd_SfxVolume--; break;
      case 1: if (snd_SfxVolume < 15) snd_SfxVolume++; break;
    }
    if (global.Snd) global.Snd.S_SetSfxVolume(snd_SfxVolume);
    SaveDefaults();
  }
  function M_MusicVol(choice) {
    switch (choice) {
      case 0: if (snd_MusicVolume) snd_MusicVolume--; break;
      case 1: if (snd_MusicVolume < 15) snd_MusicVolume++; break;
    }
    if (global.Snd) global.Snd.S_SetMusicVolume(snd_MusicVolume);
    SaveDefaults();
  }

  // --- Load / Save (localStorage-backed .dsg analogue, p_saveg.js) ----------
  function M_ReadSaveStrings() {
    for (var i = 0; i < 6; i++) {
      var s = global.SAVE ? global.SAVE.readSlot(i) : null;
      if (s === null) { savegamestrings[i] = EMPTYSTRING; LoadMenu[i].status = 0; continue; }
      savegamestrings[i] = s;
      LoadMenu[i].status = 1;
    }
  }
  function M_LoadGame(choice) {                               // m_menu.c:600
    if (hooks.netgame()) { M_StartMessage(LOADNET, null, false); return; }
    M_SetupNextMenu(LoadDef);
    M_ReadSaveStrings();
  }
  function M_LoadSelect(choice) {                             // m_menu.c:579
    global.SAVE.G_LoadGame(choice);                           // G_LoadGame(name)
    M_ClearMenus();
  }
  function M_SaveGame(choice) {                               // m_menu.c:659
    if (!hooks.usergame()) { M_StartMessage(SAVEDEAD, null, false); return; }
    if (hooks.gamestate() !== 'level') return;
    M_SetupNextMenu(SaveDef);
    M_ReadSaveStrings();
  }
  // m_menu.c:644 — start save-string entry, intercept all chars
  function M_SaveSelect(choice) {
    saveStringEnter = 1;
    saveSlot = choice;
    saveOldString = savegamestrings[choice];
    if (savegamestrings[choice] === EMPTYSTRING) savegamestrings[choice] = '';
    saveCharIndex = savegamestrings[choice].length;
  }
  function M_DoSave(slot) {                                   // m_menu.c:631
    global.SAVE.G_SaveGame(slot, savegamestrings[slot]);
    M_ClearMenus();
    if (quickSaveSlot === -2) quickSaveSlot = slot;           // PICK QUICKSAVE SLOT YET?
  }
  // m_menu.c:681 — M_QuickSave / M_QuickLoad (F6 / F9)
  function fmtPrompt(tpl, name) { return tpl.replace('%s', name === EMPTYSTRING ? EMPTYSTRING : name); }
  function M_QuickSaveResponse(ch) {
    if (ch === 121 /* 'y' */) { M_DoSave(quickSaveSlot); sfx('swtchx'); }
  }
  function M_QuickSave() {
    if (!hooks.usergame()) { sfx('oof'); return; }
    if (hooks.gamestate() !== 'level') return;
    if (quickSaveSlot < 0) {
      M_StartControlPanel();
      M_ReadSaveStrings();
      M_SetupNextMenu(SaveDef);
      quickSaveSlot = -2;                                     // means to pick a slot now
      return;
    }
    M_StartMessage(fmtPrompt(QSPROMPT, savegamestrings[quickSaveSlot]), M_QuickSaveResponse, true);
  }
  function M_QuickLoadResponse(ch) {
    if (ch === 121 /* 'y' */) { M_LoadSelect(quickSaveSlot); sfx('swtchx'); }
  }
  function M_QuickLoad() {
    if (hooks.netgame()) { M_StartMessage(QLOADNET, null, false); return; }
    if (quickSaveSlot < 0) { M_StartMessage(QSAVESPOT, null, false); return; }
    M_StartMessage(fmtPrompt(QLPROMPT, savegamestrings[quickSaveSlot]), M_QuickLoadResponse, true);
  }

  // --- Read This! ------------------------------------------------------------
  function M_ReadThis(choice) { M_SetupNextMenu(ReadDef1); }
  function M_ReadThis2() { M_SetupNextMenu(ReadDef2); }
  function M_FinishReadThis() { M_SetupNextMenu(MainDef); }

  // --- Quit DOOM -------------------------------------------------------------
  function M_QuitDOOM(choice) {
    // m_menu.c:1105: endmsg[(gametic%(NUM_QUITMESSAGES-2))+1] — index 1..20
    endstring = endmsg[1 + ((gametic || 0) % 20)] + '\n\n' + DOSY;
    M_StartMessage(endstring, M_QuitResponse, true);
  }
  // m_menu.c quitsounds[] / quitsounds2[] (commercial)
  var quitsounds = ['pldeth', 'dmpain', 'popain', 'slop', 'telept', 'posit1', 'posit3', 'sgtatk'];
  var quitsounds2 = ['vilact', 'getpow', 'boscub', 'slop', 'skeswg', 'kntdth', 'bspact', 'sgtatk'];
  function M_QuitResponse(ch) {
    if (ch !== 121 /* 'y' */) return;
    var qs = GM() === 'commercial' ? quitsounds2 : quitsounds;   // m_menu.c:1086
    sfx(qs[((gametic || 0) >> 2) & 7]);
    hooks.quit();
  }

  var MainMenu = [
    { status: 1, name: 'M_NGAME', routine: M_NewGame, alphaKey: 110 },
    { status: 1, name: 'M_OPTION', routine: M_Options, alphaKey: 111 },
    { status: 1, name: 'M_LOADG', routine: M_LoadGame, alphaKey: 108 },
    { status: 1, name: 'M_SAVEG', routine: M_SaveGame, alphaKey: 115 },
    { status: 1, name: 'M_RDTHIS', routine: M_ReadThis, alphaKey: 114 },
    { status: 1, name: 'M_QUITG', routine: M_QuitDOOM, alphaKey: 113 }
  ];
  var MainDef = { numitems: 6, prevMenu: null, menuitems: MainMenu,
    routine: function () { drawPatch(94, 2, patch('M_DOOM')); },
    x: 97, y: 64, lastOn: 0 };

  var EpisodeMenu = [
    { status: 1, name: 'M_EPI1', routine: M_Episode, alphaKey: 107 },
    { status: 1, name: 'M_EPI2', routine: M_Episode, alphaKey: 116 },
    { status: 1, name: 'M_EPI3', routine: M_Episode, alphaKey: 105 },
    { status: 1, name: 'M_EPI4', routine: M_Episode, alphaKey: 116 }
  ];
  var EpiDef = { numitems: 4, prevMenu: MainDef, menuitems: EpisodeMenu,
    routine: function () { drawPatch(54, 38, patch('M_EPISOD')); },
    x: 48, y: 63, lastOn: 0 };

  var NewGameMenu = [
    { status: 1, name: 'M_JKILL', routine: M_ChooseSkill, alphaKey: 105 },
    { status: 1, name: 'M_ROUGH', routine: M_ChooseSkill, alphaKey: 104 },
    { status: 1, name: 'M_HURT', routine: M_ChooseSkill, alphaKey: 104 },
    { status: 1, name: 'M_ULTRA', routine: M_ChooseSkill, alphaKey: 117 },
    { status: 1, name: 'M_NMARE', routine: M_ChooseSkill, alphaKey: 110 }
  ];
  var NewDef = { numitems: 5, prevMenu: EpiDef, menuitems: NewGameMenu,
    routine: function () { drawPatch(96, 14, patch('M_NEWG')); drawPatch(54, 38, patch('M_SKILL')); },
    x: 48, y: 63, lastOn: 2 };

  var endgame = 0, messages = 1, detail = 2, scrnsize = 3, option_empty1 = 4,
      mousesens = 5, option_empty2 = 6, soundvol = 7;
  var OptionsMenu = [
    { status: 1, name: 'M_ENDGAM', routine: M_EndGame, alphaKey: 101 },
    { status: 1, name: 'M_MESSG', routine: M_ChangeMessages, alphaKey: 109 },
    { status: 1, name: 'M_DETAIL', routine: M_ChangeDetail, alphaKey: 103 },
    { status: 2, name: 'M_SCRNSZ', routine: M_SizeDisplay, alphaKey: 115 },
    { status: -1, name: '', routine: null, alphaKey: 0 },
    { status: 2, name: 'M_MSENS', routine: M_ChangeSensitivity, alphaKey: 109 },
    { status: -1, name: '', routine: null, alphaKey: 0 },
    { status: 1, name: 'M_SVOL', routine: M_Sound, alphaKey: 115 }
  ];
  var OptionsDef = { numitems: 8, prevMenu: MainDef, menuitems: OptionsMenu,
    routine: drawOptions, x: 60, y: 37, lastOn: 0 };

  var ReadMenu1 = [{ status: 1, name: '', routine: M_ReadThis2, alphaKey: 0 }];
  var ReadDef1 = { numitems: 1, prevMenu: MainDef, menuitems: ReadMenu1,
    routine: M_DrawReadThis1, x: 280, y: 185, lastOn: 0 };
  var ReadMenu2 = [{ status: 1, name: '', routine: M_FinishReadThis, alphaKey: 0 }];
  var ReadDef2 = { numitems: 1, prevMenu: ReadDef1, menuitems: ReadMenu2,
    routine: M_DrawReadThis2, x: 330, y: 175, lastOn: 0 };

  var sfx_vol = 0, sfx_empty1 = 1, music_vol = 2;
  var SoundMenu = [
    { status: 2, name: 'M_SFXVOL', routine: M_SfxVol, alphaKey: 115 },
    { status: -1, name: '', routine: null, alphaKey: 0 },
    { status: 2, name: 'M_MUSVOL', routine: M_MusicVol, alphaKey: 109 },
    { status: -1, name: '', routine: null, alphaKey: 0 }
  ];
  var SoundDef = { numitems: 4, prevMenu: OptionsDef, menuitems: SoundMenu,
    routine: drawSound, x: 80, y: 64, lastOn: 0 };

  var LoadMenu = [], SaveMenu = [];
  for (i = 0; i < 6; i++) {
    LoadMenu.push({ status: 1, name: '', routine: M_LoadSelect, alphaKey: 49 + i });
    SaveMenu.push({ status: 1, name: '', routine: M_SaveSelect, alphaKey: 49 + i });
  }
  var LoadDef = { numitems: 6, prevMenu: MainDef, menuitems: LoadMenu,
    routine: drawLoad, x: 80, y: 54, lastOn: 0 };
  var SaveDef = { numitems: 6, prevMenu: MainDef, menuitems: SaveMenu,
    routine: drawSave, x: 80, y: 54, lastOn: 0 };

  // M_Init() version switch (m_menu.c:1864-1890). Applied from Init() every
  // time a WAD installs (hot-swap can change modes), and idempotent.
  function applyGamemodeMenus() {
    var gm = GM();
    // reset to the compiled-in table first (previous hot-swap may have hacked)
    MainDef.numitems = 6; MainDef.y = 64; MainMenu[4] = { status: 1, name: 'M_RDTHIS', routine: M_ReadThis, alphaKey: 114 };
    MainDef.menuitems = MainMenu;
    EpiDef.numitems = 4;
    NewDef.prevMenu = EpiDef;
    ReadDef1.routine = M_DrawReadThis1; ReadDef1.x = 280; ReadDef1.y = 185;
    ReadMenu1[0].routine = M_ReadThis2;
    if (gm === 'commercial') {
      // DOOM 2: no Read This (HELP is one page — hook quit into its slot)
      MainMenu[4] = MainMenu[5];
      MainDef.numitems--;
      MainDef.y += 8;
      NewDef.prevMenu = MainDef;
      ReadDef1.routine = M_DrawReadThis1;   // single HELP page
      ReadDef1.x = 330; ReadDef1.y = 165;
      ReadMenu1[0].routine = M_FinishReadThis;
    } else if (gm === 'shareware' || gm === 'registered') {
      // Episode 4 requires UltimateDOOM
      EpiDef.numitems--;
    }
  }
  // M_LoadSelect/M_SaveSelect alphaKeys: LoadMenu keys '1'..'6'

  // ------------------------------------------------------------------ draw routines
  function M_DrawReadThis1() {                       // m_menu.c:755
    inhelpscreens = true;
    drawPatch(0, 0, patch(GM() === 'commercial' ? 'HELP' : 'HELP1'));
  }
  function M_DrawReadThis2() {                       // m_menu.c:779
    inhelpscreens = true;
    drawPatch(0, 0, patch((GM() === 'retail' || GM() === 'commercial')
      ? 'CREDIT' : 'HELP2'));
  }
  function M_DrawThermo(x, y, thermWidth, thermDot) {
    var xx = x, i;
    drawPatch(xx, y, patch('M_THERML')); xx += 8;
    for (i = 0; i < thermWidth; i++) { drawPatch(xx, y, patch('M_THERMM')); xx += 8; }
    drawPatch(xx, y, patch('M_THERMR'));
    drawPatch((x + 8) + thermDot * 8, y, patch('M_THERMO'));
  }
  function M_DrawSaveLoadBorder(x, y) {
    drawPatch(x - 8, y + 7, patch('M_LSLEFT'));
    for (var i = 0; i < 24; i++) { drawPatch(x, y + 7, patch('M_LSCNTR')); x += 8; }
    drawPatch(x, y + 7, patch('M_LSRGHT'));
  }
  function drawOptions() {
    drawPatch(108, 15, patch('M_OPTTTL'));
    drawPatch(OptionsDef.x + 175, OptionsDef.y + LINEHEIGHT * detail, patch(detailLevel ? 'M_GDLOW' : 'M_GDHIGH'));
    drawPatch(OptionsDef.x + 120, OptionsDef.y + LINEHEIGHT * messages, patch(showMessages ? 'M_MSGON' : 'M_MSGOFF'));
    M_DrawThermo(OptionsDef.x, OptionsDef.y + LINEHEIGHT * (mousesens + 1), 10, mouseSensitivity);
    M_DrawThermo(OptionsDef.x, OptionsDef.y + LINEHEIGHT * (scrnsize + 1), 9, screenSize);
  }
  function drawSound() {
    drawPatch(60, 38, patch('M_SVOL'));
    M_DrawThermo(SoundDef.x, SoundDef.y + LINEHEIGHT * (sfx_vol + 1), 16, snd_SfxVolume);
    M_DrawThermo(SoundDef.x, SoundDef.y + LINEHEIGHT * (music_vol + 1), 16, snd_MusicVolume);
  }
  function drawLoad() {
    drawPatch(72, 28, patch('M_LOADG'));
    for (var i = 0; i < 6; i++) {
      M_DrawSaveLoadBorder(LoadDef.x, LoadDef.y + LINEHEIGHT * i);
      M_WriteText(LoadDef.x, LoadDef.y + LINEHEIGHT * i, savegamestrings[i]);
    }
  }
  function drawSave() {
    drawPatch(72, 28, patch('M_SAVEG'));
    for (var i = 0; i < 6; i++) {
      M_DrawSaveLoadBorder(LoadDef.x, LoadDef.y + LINEHEIGHT * i);
      M_WriteText(LoadDef.x, LoadDef.y + LINEHEIGHT * i, savegamestrings[i]);
    }
    if (saveStringEnter) {
      var w = M_StringWidth(savegamestrings[saveSlot]);
      M_WriteText(LoadDef.x + w, LoadDef.y + LINEHEIGHT * saveSlot, '_');
    }
  }

  // M_Drawer (m_menu.c:1740-1810) — draws onto DST (title page: FB indexed
  // screen; in-level/in-demo overlay: null -> straight onto viewbuffer).
  function M_Drawer() {
    var x, y, i, max, line, start;
    inhelpscreens = false;
    if (messageToPrint) {
      start = 0;
      // gospel m_menu.c:1757 integer division: M_StringHeight()/2 TRUNCATES.
      // Float /2 leaves .5 coords: (y+0.5)*320 shifts writes 160px right (text
      // wraps into the next row) and a .5 x silently drops the typed-array write.
      y = 100 - (M_StringHeight(messageString) / 2 | 0);
      while (start < messageString.length) {
        var rest = messageString.slice(start);
        var nl = rest.indexOf('\n');
        if (nl >= 0) { line = rest.slice(0, nl); start += nl + 1; }
        else { line = rest; start = messageString.length; }
        x = 160 - (M_StringWidth(line) / 2 | 0);   // C truncating /2 (m_menu.c:1774)
        M_WriteText(x, y, line);
        y += huFont(33).h;
      }
      return;
    }
    if (!menuactive) return;
    if (currentMenu.routine) currentMenu.routine();
    x = currentMenu.x; y = currentMenu.y; max = currentMenu.numitems;
    for (i = 0; i < max; i++) {
      if (currentMenu.menuitems[i].name[0]) drawPatch(x, y, patch(currentMenu.menuitems[i].name));
      y += LINEHEIGHT;
    }
    drawPatch(x + SKULLXOFF, currentMenu.y - 5 + itemOn * LINEHEIGHT,
              patch('M_SKULL' + (whichSkull + 1)));
  }

  // ------------------------------------------------------------------ M_Responder (m_menu.c:1347)
  var gametic = 0;
  function M_Responder(ch) {
    var i;
    // Save Game string input (m_menu.c:1452) — intercept all chars
    if (saveStringEnter) {
      switch (ch) {
        case KEY_BACKSPACE:
          if (saveCharIndex > 0) { saveCharIndex--; savegamestrings[saveSlot] = savegamestrings[saveSlot].slice(0, saveCharIndex); }
          break;
        case KEY_ESCAPE:
          saveStringEnter = 0;
          savegamestrings[saveSlot] = saveOldString;
          break;
        case KEY_ENTER:
          saveStringEnter = 0;
          if (savegamestrings[saveSlot]) M_DoSave(saveSlot);
          break;
        default:
          ch = ch >= 97 && ch <= 122 ? ch - 32 : ch;          // toupper
          if (ch !== 32 && (ch - HU_FONTSTARTC < 0 || ch - HU_FONTSTARTC >= HU_FONTSIZEC)) break;
          if (ch >= 32 && ch <= 127 &&
              saveCharIndex < SAVESTRINGSIZE - 1 &&
              M_StringWidth(savegamestrings[saveSlot]) < (SAVESTRINGSIZE - 2) * 8) {
            savegamestrings[saveSlot] += String.fromCharCode(ch);
            saveCharIndex = savegamestrings[saveSlot].length;
          }
          break;
      }
      return true;
    }
    if (messageToPrint) {
      // vanilla compares ev->data1 ints against ' ', 'n', 'y', KEY_ESCAPE
      if (messageNeedsInput && !(ch === 32 || ch === 110 || ch === 121 || ch === KEY_ESCAPE))
        return false;
      menuactive = messageLastMenuActive;
      messageToPrint = 0;
      if (messageRoutine) messageRoutine(ch);     // int keycode, like ev->data1
      menuactive = 0;
      sfx('swtchx');
      return true;
    }
    if (!menuactive) {
      switch (ch) {
        // m_menu.c:1522 — screen size keys work outside the menu, same
        // M_SizeDisplay as the options screen pref (saved via SaveDefaults)
        case KEY_MINUS:
          if (window.AM && AM.active()) return false;   // gospel: automapactive
          M_SizeDisplay(0); sfx('stnmov'); return true;
        case KEY_EQUALS:
          if (window.AM && AM.active()) return false;
          M_SizeDisplay(1); sfx('stnmov'); return true;
        case KEY_F1: M_StartControlPanel(); currentMenu = ReadDef1; itemOn = 0; sfx('swtchn'); return true;
        case KEY_F2: M_StartControlPanel(); sfx('swtchn'); M_SaveGame(); return true;
        case KEY_F3: M_StartControlPanel(); sfx('swtchn'); M_LoadGame(); return true;
        case KEY_F4: M_StartControlPanel(); currentMenu = SoundDef; itemOn = sfx_vol; sfx('swtchn'); return true;
        case KEY_F5: M_ChangeDetail(); sfx('swtchn'); return true;
        case KEY_F6: sfx('swtchn'); M_QuickSave(); return true;
        case KEY_F7: sfx('swtchn'); M_EndGame(); return true;
        case KEY_F8: sfx('swtchn'); M_ChangeMessages(); return true;
        case KEY_F9: sfx('swtchn'); M_QuickLoad(); return true;
        case KEY_F10: sfx('swtchn'); M_QuitDOOM(); return true;
      }
      if (ch === KEY_ESCAPE) { M_StartControlPanel(); sfx('swtchn'); return true; }
      return false;
    }
    switch (ch) {
      case KEY_DOWNARROW:
        do {
          if (itemOn + 1 > currentMenu.numitems - 1) itemOn = 0; else itemOn++;
          sfx('pstop');
        } while (currentMenu.menuitems[itemOn].status === -1);
        return true;
      case KEY_UPARROW:
        do {
          if (!itemOn) itemOn = currentMenu.numitems - 1; else itemOn--;
          sfx('pstop');
        } while (currentMenu.menuitems[itemOn].status === -1);
        return true;
      case KEY_LEFTARROW:
        if (currentMenu.menuitems[itemOn].routine && currentMenu.menuitems[itemOn].status === 2) {
          sfx('stnmov'); currentMenu.menuitems[itemOn].routine(0);
        }
        return true;
      case KEY_RIGHTARROW:
        if (currentMenu.menuitems[itemOn].routine && currentMenu.menuitems[itemOn].status === 2) {
          sfx('stnmov'); currentMenu.menuitems[itemOn].routine(1);
        }
        return true;
      case KEY_ENTER:
        if (currentMenu.menuitems[itemOn].routine && currentMenu.menuitems[itemOn].status) {
          currentMenu.lastOn = itemOn;
          if (currentMenu.menuitems[itemOn].status === 2) {
            currentMenu.menuitems[itemOn].routine(1); sfx('stnmov');
          } else {
            currentMenu.menuitems[itemOn].routine(itemOn); sfx('pistol');
          }
        }
        return true;
      case KEY_ESCAPE:
        currentMenu.lastOn = itemOn;
        M_ClearMenus(); sfx('swtchx');
        return true;
      case KEY_BACKSPACE:
        currentMenu.lastOn = itemOn;
        if (currentMenu.prevMenu) {
          currentMenu = currentMenu.prevMenu;
          itemOn = currentMenu.lastOn;
          sfx('swtchn');
        }
        return true;
      default:
        for (i = itemOn + 1; i < currentMenu.numitems; i++)
          if (currentMenu.menuitems[i].alphaKey === ch) { itemOn = i; sfx('pstop'); return true; }
        for (i = 0; i <= itemOn; i++)
          if (currentMenu.menuitems[i].alphaKey === ch) { itemOn = i; sfx('pstop'); return true; }
        break;
    }
    return false;
  }

  // ------------------------------------------------------------------ D_DoAdvanceDemo / pages (d_main.c)
  function D_AdvanceDemo() { advancedemo = true; }
  function D_PageTicker() { if (--pagetic < 0) D_AdvanceDemo(); }
  function D_StartTitle() {
    hooks.gameActionNothing();
    demosequence = -1;
    D_AdvanceDemo();
  }
  function doAdvanceDemo() {
    hooks.playerLive();
    advancedemo = false;
    hooks.usergame(false);
    hooks.unpause();
    hooks.gameActionNothing();
    // d_main.c:462 retail cycles 7 (demo4), everything else 6
    demosequence = (demosequence + 1) % (GM() === 'retail' ? 7 : 6);
    switch (demosequence) {
      case 0:
        // d_main.c:469 commercial title = TITLEPIC + DM2TTL music
        if (GM() === 'commercial') {
          pagetic = 35 * 11; hooks.state('title'); pagename = 'TITLEPIC';
          if (global.Snd) global.Snd.S_StartMusic(global.Snd.mus.mus_dm2ttl);
        } else {
          pagetic = 170; hooks.state('title'); pagename = 'TITLEPIC';
          if (global.Snd) global.Snd.S_StartMusic(global.Snd.mus.mus_intro);
        }
        break;
      case 1: hooks.playDemo('DEMO1'); break;
      case 2: pagetic = 200; hooks.state('title'); pagename = 'CREDIT'; break;
      case 3: hooks.playDemo('DEMO2'); break;
      case 4:
        hooks.state('title');
        if (GM() === 'commercial') {          // d_main.c:495 second title card
          pagetic = 35 * 11; pagename = 'TITLEPIC';
          if (global.Snd) global.Snd.S_StartMusic(global.Snd.mus.mus_dm2ttl);
        } else {
          pagetic = 200;
          pagename = (GM() === 'retail') ? 'CREDIT' : 'HELP2';
        }
        break;
      case 5: hooks.playDemo('DEMO3'); break;
      case 6: hooks.playDemo('DEMO4'); break;    // retail only (d_main.c:511)
    }
  }

  // ------------------------------------------------------------------ demo playback (g_game.c)
  function G_DoPlayDemo(name) {
    var d = b64(src().demos[name]);
    demo_p = 0;
    if (d[demo_p++] !== 109) {               // vanilla checks != VERSION(110);
      hooks.gameActionNothing();             // doom1.wad demos are v1.9=109 —
      return false;                          // documented deviation: accept
    }
    var skill = d[demo_p++], episode = d[demo_p++], map = d[demo_p++];
    // deathmatch/respawn/fast/nomonsters/consoleplayer + playeringame[4]
    demo_p += 5 + 4;
    demobuffer = d;
    hooks.initNew(skill, episode, map, function (cmd) { readDemoTiccmd(cmd); });
    hooks.usergame(false);
    demoplayback = true;
    return true;
  }
  var DEMOMARKER = 0x80;
  function readDemoTiccmd(cmd) {
    var d = demobuffer;
    if (d[demo_p] === DEMOMARKER || demo_p >= d.length) { G_CheckDemoStatus(); return; }
    var s8 = function (v) { return v > 127 ? v - 256 : v; };
    cmd.forwardmove = s8(d[demo_p++]);
    cmd.sidemove = s8(d[demo_p++]);
    cmd.angleturn = d[demo_p++] << 8;
    cmd.buttons = d[demo_p++];
  }
  function G_CheckDemoStatus() {
    if (demoplayback) {
      demoplayback = false;
      hooks.usergame(false);
      D_AdvanceDemo();
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ hooks from main.js
  // (main.js Init() supplies real implementations; these defaults keep the
  // module loadable standalone for node tests.)
  var hooks = {
    state: function (s) {},                       // enter title/demo page state
    newGame: function (skill, ep, map) {},        // G_DeferedInitNew
    playDemo: function (name) {},                 // G_DeferedPlayDemo
    initNew: function (skill, ep, map, reader) {},// G_InitNew + demo ticcmd reader
    usergame: function (v) { return false; },     // get(false)/set
    unpause: function () {},
    gameActionNothing: function () {},
    gameactionIsNothing: function () { return true; },
    isTitleOrDemo: function () { return false; }, // gamestate==GS_DEMOSCREEN (demo/title)
    gamestate: function () { return 'title'; },   // current gamestate string
    netgame: function () { return false; },       // netgame flag (never true here)
    playerLive: function () {},
    quit: function () { location.reload(); },
    setViewSize: function (blocks, detail) {},
    setMouseSensitivity: function (v) {}
  };

  // ------------------------------------------------------------------ public API
  // Init: M_Init() equivalent (shareware gamemode) + screen alloc. Does NOT
  // start the title loop — main.js calls StartTitle() when it wants the intro
  // (boot without ?map=).
  function Init(h) {
    for (var k in h) hooks[k] = h[k];
    applyGamemodeMenus();
    currentMenu = MainDef;
    menuactive = 0;
    itemOn = currentMenu.lastOn;
    whichSkull = 0; skullAnimCounter = 10;
    skullAnimCounter = 8;
    quickSaveSlot = -1;
    messageToPrint = 0;
    if (!FB) { FB = new Uint8Array(SCREENWIDTH * SCREENHEIGHT); buildLut(); }
  }

  // StartTitle: d_main.c D_StartTitle — resets the demo loop; next Ticker
  // runs D_DoAdvanceDemo -> TITLEPIC page + mus_intro.
  function StartTitle() { D_StartTitle(); }

  // Responder(ch): one keydown event through D_ProcessEvents order —
  // M_Responder, then the G_Responder demo pop-up (any key in demos/title
  // opens the control panel). Returns true if the menu system ate it.
  function Responder(ch) {
    if (M_Responder(ch)) return true;
    if (hooks.gameactionIsNothing() && (demoplayback || hooks.isTitleOrDemo())) {
      M_StartControlPanel();
      return true;
    }
    return false;
  }

  // Ticker(isTitle): one gametic. D_DoAdvanceDemo + M_Ticker only —
  // vanilla order is buildTiccmd, advanceDemo, M_Ticker, G_Ticker, and the
  // G_Ticker tail is main.js's job (P_Ticker with demo cmds, or PageTicker).
  function Ticker(isTitle) {
    gametic++;
    if (advancedemo) doAdvanceDemo();
    SkullTicker();
  }
  // M_Ticker (m_menu.c:1834): the skull selector anim. Vanilla calls this on
  // EVERY gametic via NetUpdate/TryRunTics (d_net.c:730,744), not just in the
  // title loop — main.js calls it per tic in the level branch too, or the
  // in-game menu skull freezes after one toggle.
  function SkullTicker() {
    if (--skullAnimCounter <= 0) { whichSkull ^= 1; skullAnimCounter = 8; }
  }
  function PageTicker() { D_PageTicker(); }

  // Drawer(isTitle): title pages compose on the indexed screen (D_PageDrawer
  // + M_Drawer) then LUT to viewbuffer; in-demo the engine already rendered
  // the view, so DST=null overlays menu art straight onto viewbuffer.
  function Drawer(isTitle) {
    if (isTitle) {
      DST = FB;
      clearFB();
      drawPatch(0, 0, patch(pagename));
      M_Drawer();
      DST = null;
      var vb = global.viewbuffer;
      if (vb) for (var j = 0; j < FB.length; j++) vb[j] = lut[FB[j]];
    } else {
      DST = null;
      M_Drawer();          // patches go straight to viewbuffer via drawPatch
    }
  }

  global.MEN = {
    ResetPatchCache: () => { P = null; },   // WAD hot-swap: re-decode patched art
    Init: Init, Responder: Responder, Ticker: Ticker, PageTicker: PageTicker,
    SkullTicker: SkullTicker,
    Drawer: Drawer,
    StartTitle: StartTitle,
    M_Responder: M_Responder, M_StartControlPanel: M_StartControlPanel,
    M_ClearMenus: M_ClearMenus, M_Drawer: M_Drawer,
    // click-to-play: drop a pending prompt/message too (main.js canvas click)
    ClearMessage: function () {
      messageToPrint = 0; messageString = null; messageRoutine = null;
      messageNeedsInput = false;
    },
    G_CheckDemoStatus: G_CheckDemoStatus, G_DoPlayDemo: G_DoPlayDemo,
    // g_game.c:1445 G_InitNew: demoplayback = false on a new user game
    G_ClearDemoPlayback: function () { demoplayback = false; },
    // m_misc.c M_SaveDefaults / M_LoadDefaults via localStorage
    SaveDefaults: SaveDefaults, LoadDefaults: LoadDefaults,
    defaultsObject: defaultsObject,
    // test-only: deterministic menu state
    getSkull: function () { return whichSkull; },
    resetMenuState: function () {
      M_ClearMenus(); messageToPrint = 0; NewDef.lastOn = 0; itemOn = 0;
      currentMenu = null; saveStringEnter = false;
    },
    D_AdvanceDemo: D_AdvanceDemo,
    get menuactive() { return menuactive; },
    get messageToPrint() { return messageToPrint; },
    get inhelpscreens() { return inhelpscreens; },
    get demoplayback() { return demoplayback; },
    get advancedemo() { return advancedemo; },
    get pagename() { return pagename; },
    get currentMenu() { return currentMenu; },
    get itemOn() { return itemOn; },
    get mouseSensitivity() { return mouseSensitivity; },
    get screenblocks() { return screenblocks; },
    get detailLevel() { return detailLevel; },
    get showMessages() { return showMessages; },
    get snd_SfxVolume() { return snd_SfxVolume; },
    get snd_MusicVolume() { return snd_MusicVolume; },
    set gametic_(v) { gametic = v; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
