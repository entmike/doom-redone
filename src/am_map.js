// am_map.js — in-game automap: faithful port of am_map.c (DOOM 1.10).
//
// Draws into the shared engine framebuffer `viewbuffer` (320x200 rows) using
// palette indices through PIX_LUT table 0 — exactly how vanilla wrote raw
// indices into screens[0] and let the FG palette blit them. f_w=320,
// f_h=SCREENHEIGHT-32=168: the status bar rows belong to hud.js (gospel
// st_statusbaron = (!fullscreen) || automapactive — bar stays up in automap).
//
// Responder order mirrors d_main.c D_ProcessEvents + g_game.c G_Responder
// (chat/ST/AM): main.js feeds keydowns here BEFORE the menu module while the
// automap is active so arrows/'='/etc. are eaten by the map (m_menu.c
// explicitly yields KEY_MINUS/KEY_EQUALS to the automap: "if (automapactive
// || chat_on) return false"). Keyups (arrows, zoom) arrive via OnKeyUp.
//
// External side-panel automap (automap.js) is untouched and still lives in
// the HTML page; it no longer shares the Tab key (backquote toggles it in
// direct-map mode — documented deviation, the in-game map owns Tab like
// vanilla AM_STARTKEY/AM_ENDKEY).
'use strict';
(function (global) {

  // ---- am_map.c constants ---------------------------------------------------
  var REDS = (256 - 5 * 16), REDRANGE = 16;
  var BLUES = (256 - 4 * 16 + 8), BLUERANGE = 8;
  var GREENS = (7 * 16), GREENRANGE = 16;
  var GRAYS = (6 * 16), GRAYSRANGE = 16;
  var BROWNS = (4 * 16), BROWNRANGE = 16;
  var YELLOWS = (256 - 32 + 7), YELLOWRANGE = 1;
  var BLACK = 0, WHITE = (256 - 47);

  var BACKGROUND = BLACK, YOURCOLORS = WHITE, YOURRANGE = 0;
  var WALLCOLORS = REDS, WALLRANGE = REDRANGE;
  var TSWALLCOLORS = GRAYS, TSWALLRANGE = GRAYSRANGE;
  var FDWALLCOLORS = BROWNS, FDWALLRANGE = BROWNRANGE;
  var CDWALLCOLORS = YELLOWS, CDWALLRANGE = YELLOWRANGE;
  var THINGCOLORS = GREENS, THINGRANGE = GREENRANGE;
  var SECRETWALLCOLORS = WALLCOLORS, SECRETWALLRANGE = WALLRANGE;
  var GRIDCOLORS = (GRAYS + GRAYSRANGE / 2), GRIDRANGE = 0;
  var XHAIRCOLORS = GRAYS;

  // d_main/i_video key codes as the port's keyQueue delivers them (main.js
  // CH map: arrows 0xac-0xaf, Minus 0x2d, Equal 0x3d, letters lowercase ASCII)
  var AM_PANDOWNKEY = 0xaf, AM_PANUPKEY = 0xad,
      AM_PANRIGHTKEY = 0xae, AM_PANLEFTKEY = 0xac;
  var AM_ZOOMINKEY = 0x3d, AM_ZOOMOUTKEY = 0x2d;
  var AM_STARTKEY = 9, AM_ENDKEY = 9;            // Tab (browser code 9)
  var AM_GOBIGKEY = 48;                          // '0'
  var AM_FOLLOWKEY = 102, AM_GRIDKEY = 103, AM_MARKKEY = 109, AM_CLEARMARKKEY = 99;

  var AM_NUMMARKPOINTS = 10;

  var FRACUNIT = 65536, FRACBITS = 16;           // m_fixed.h (engine mirrors)
  var MAXINT = 0x7fffffff;
  var INITSCALEMTOF = 13107;                     // .2*FRACUNIT
  var F_PANINC = 4;
  var M_ZOOMIN = Math.floor(1.02 * FRACUNIT);    // (int) trunc in C: 66846
  var M_ZOOMOUT = Math.floor(FRACUNIT / 1.02);   // 64280

  var PLAYERRADIUS = 16 * FRACUNIT;              // p_local.h (via p_map.h)
  var SCREENHEIGHT = 200;

  var automapactive = false;

  // window on screen (frame-buffer coords)
  var f_x = 0, f_y = 0, f_w = 320, f_h = SCREENHEIGHT - 32;
  var lightlev = 0;        // funky strobing: AM_updateLightLev is COMMENTED
                           // OUT in vanilla AM_Ticker — lightlev stays 0
  var amclock = 0;

  var m_paninc = { x: 0, y: 0 };
  var mtof_zoommul = FRACUNIT, ftom_zoommul = FRACUNIT;

  var m_x = 0, m_y = 0, m_x2 = 0, m_y2 = 0;      // LL / UR of window (map)
  var m_w = 0, m_h = 0;
  var min_x = 0, min_y = 0, max_x = 0, max_y = 0;
  var max_w = 0, max_h = 0, min_w = 0, min_h = 0;
  var min_scale_mtof = 0, max_scale_mtof = 0;
  var old_m_w = 0, old_m_h = 0, old_m_x = 0, old_m_y = 0;
  var f_oldloc = { x: MAXINT, y: 0 };

  var scale_mtof = INITSCALEMTOF, scale_ftom = 0;

  var plr = null;
  var marknums = new Array(AM_NUMMARKPOINTS);
  var markpoints = [];
  for (var mi = 0; mi < AM_NUMMARKPOINTS; mi++) markpoints.push({ x: -1, y: 0 });
  var markpointnum = 0;
  var followplayer = 1;
  var cheating = 0, grid = 0;
  var stopped = true;
  var leveljuststarted = 1;
  var lastlevel = -1, lastepisode = -1;
  var barRefreshPending = false;   // ST_Responder AM_MSG{ENTERED,EXITED} analogue:
                                   // main.js raises hudRefresh when true

  // mcheat.c cht_CheckCheat + SCRAMBLE (m_cheat.h:30)
  function SCRAMBLE(a) {
    return ((((a) & 1) << 7) + (((a) & 2) << 5) + ((a) & 4) + (((a) & 8) << 1) +
            (((a) & 16) >> 1) + ((a) & 32) + (((a) & 64) >> 5) + (((a) & 128) >> 7));
  }
  var cheat_xlate_table = null;
  var cheat_amap_seq = [0xb2, 0x26, 0x26, 0x2e, 0xff];
  var cheat_amap = { sequence: cheat_amap_seq, p: 0 };
  function cht_CheckCheat(cht, key) {
    var rc = 0;
    if (!cheat_xlate_table) {
      cheat_xlate_table = new Uint8Array(256);
      for (var i = 0; i < 256; i++) cheat_xlate_table[i] = SCRAMBLE(i);
    }
    if (cht.p === 0) cht.sequence[cht.p++] = key & 0xff;
    else if (cheat_xlate_table[key & 0xff] === cht.sequence[cht.p]) cht.p++;
    else cht.p = 0;
    if (cht.sequence[cht.p] === 1) cht.p++;
    else if (cht.sequence[cht.p] === 0xff) { cht.p = 0; rc = 1; }
    return rc;
  }

  // line character geometry (am_map.c lineguys) — R = (8*PLAYERRADIUS)/7
  // C fixed-point initializers, computed once with truncating division
  var _R = ((8 * PLAYERRADIUS / 7) | 0);           // 189394 (trunc, like C)
  var R8 = Math.floor(_R / 8), R4 = Math.floor(_R / 4), R2 = Math.floor(_R / 2),
      R6 = Math.floor(_R / 6), R7 = Math.floor(_R / 7), R32 = Math.floor(_R / 32),
      R10 = Math.floor(_R / 10), R3 = Math.floor(_R / 3);
  var player_arrow = [
    { a: { x: -_R + R8, y: 0 }, b: { x: _R, y: 0 } },
    { a: { x: _R, y: 0 }, b: { x: _R - R2, y: R4 } },
    { a: { x: _R, y: 0 }, b: { x: _R - R2, y: -R4 } },
    { a: { x: -_R + R8, y: 0 }, b: { x: -_R - R8, y: R4 } },
    { a: { x: -_R + R8, y: 0 }, b: { x: -_R - R8, y: -R4 } },
    { a: { x: -_R + Math.floor(3 * _R / 8), y: 0 }, b: { x: -_R + R8, y: R4 } },
    { a: { x: -_R + Math.floor(3 * _R / 8), y: 0 }, b: { x: -_R + R8, y: -R4 } }
  ];
  var cheat_player_arrow = [
    { a: { x: -_R + R8, y: 0 }, b: { x: _R, y: 0 } },
    { a: { x: _R, y: 0 }, b: { x: _R - R2, y: R6 } },
    { a: { x: _R, y: 0 }, b: { x: _R - R2, y: -R6 } },
    { a: { x: -_R + R8, y: 0 }, b: { x: -_R - R8, y: R6 } },
    { a: { x: -_R + R8, y: 0 }, b: { x: -_R - R8, y: -R6 } },
    { a: { x: -_R + Math.floor(3 * _R / 8), y: 0 }, b: { x: -_R + R8, y: R6 } },
    { a: { x: -_R + Math.floor(3 * _R / 8), y: 0 }, b: { x: -_R + R8, y: -R6 } },
    { a: { x: -R2, y: 0 }, b: { x: -R2, y: -R6 } },
    { a: { x: -R2, y: -R6 }, b: { x: -R2 + R6, y: -R6 } },
    { a: { x: -R2 + R6, y: -R6 }, b: { x: -R2 + R6, y: R4 } },
    { a: { x: -R6, y: 0 }, b: { x: -R6, y: -R6 } },
    { a: { x: -R6, y: -R6 }, b: { x: 0, y: -R6 } },
    { a: { x: 0, y: -R6 }, b: { x: 0, y: R4 } },
    { a: { x: R6, y: R4 }, b: { x: R6, y: -R7 } },
    { a: { x: R6, y: -R7 }, b: { x: R6 + R32, y: -R7 - R32 } },
    { a: { x: R6 + R32, y: -R7 - R32 }, b: { x: R6 + R10, y: -R7 } }
  ];
  // -.5*R and -.7*R with R=FRACUNIT — C constant-folds these in int fixed
  var THX = -(FRACUNIT >> 1);                                // -32768
  var THY = -((0.7 * FRACUNIT) | 0);                         // -45875
  var thintriangle_guy = [
    { a: { x: THX, y: THY }, b: { x: FRACUNIT, y: 0 } },
    { a: { x: FRACUNIT, y: 0 }, b: { x: THX, y: -THY } },
    { a: { x: THX, y: -THY }, b: { x: THX, y: THY } }
  ];

  // ---- fixed helpers (m_fixed.c via engine.js globals) ---------------------
  function FM(a, b) { return global.FixedMul(a | 0, b | 0); }
  function FD(a, b) { return global.FixedDiv(a | 0, b | 0); }
  function cdiv(a, b) { return (a / b) | 0; }              // C int division: trunc
  function FTOM(x) { return FM((x << 16) | 0, scale_ftom); }
  function MTOF(x) { return FM(x | 0, scale_mtof) >> 16; } // C: signed >>16
  function CXMTOF(x) { return f_x + MTOF((x | 0) - m_x); }
  function CYMTOF(y) { return f_y + (f_h - MTOF((y | 0) - m_y)); }

  // ---- scale/location -------------------------------------------------------
  function AM_activateNewScale() {
    m_x += cdiv(m_w, 2); m_y += cdiv(m_h, 2);
    m_w = FTOM(f_w); m_h = FTOM(f_h);
    m_x -= cdiv(m_w, 2); m_y -= cdiv(m_h, 2);
    m_x2 = m_x + m_w; m_y2 = m_y + m_h;
  }
  function AM_saveScaleAndLoc() { old_m_x = m_x; old_m_y = m_y; old_m_w = m_w; old_m_h = m_h; }
  function AM_restoreScaleAndLoc() {
    m_w = old_m_w; m_h = old_m_h;
    if (!followplayer) { m_x = old_m_x; m_y = old_m_y; }
    else { m_x = plr.mo.x - cdiv(m_w, 2); m_y = plr.mo.y - cdiv(m_h, 2); }
    m_x2 = m_x + m_w; m_y2 = m_y + m_h;
    scale_mtof = FD(f_w << FRACBITS, m_w);
    scale_ftom = FD(FRACUNIT, scale_mtof);
  }
  function AM_addMark() {
    markpoints[markpointnum].x = m_x + cdiv(m_w, 2);
    markpoints[markpointnum].y = m_y + cdiv(m_h, 2);
    markpointnum = (markpointnum + 1) % AM_NUMMARKPOINTS;
  }
  function AM_findMinMaxBoundaries() {
    var vertexes = global.vertexes, numvertexes = global.numvertexes;
    min_x = min_y = MAXINT; max_x = max_y = -MAXINT;
    for (var i = 0; i < numvertexes; i++) {
      if (vertexes[i].x < min_x) min_x = vertexes[i].x;
      else if (vertexes[i].x > max_x) max_x = vertexes[i].x;
      if (vertexes[i].y < min_y) min_y = vertexes[i].y;
      else if (vertexes[i].y > max_y) max_y = vertexes[i].y;
    }
    max_w = max_x - min_x; max_h = max_y - min_y;
    min_w = 2 * PLAYERRADIUS; min_h = 2 * PLAYERRADIUS;
    var a = FD(f_w << FRACBITS, max_w);
    var b = FD(f_h << FRACBITS, max_h);
    min_scale_mtof = a < b ? a : b;
    max_scale_mtof = FD(f_h << FRACBITS, 2 * PLAYERRADIUS);
  }
  function AM_changeWindowLoc() {
    if (m_paninc.x || m_paninc.y) { followplayer = 0; f_oldloc.x = MAXINT; }
    m_x += m_paninc.x; m_y += m_paninc.y;
    if (m_x + cdiv(m_w, 2) > max_x) m_x = max_x - cdiv(m_w, 2);
    else if (m_x + cdiv(m_w, 2) < min_x) m_x = min_x - cdiv(m_w, 2);
    if (m_y + cdiv(m_h, 2) > max_y) m_y = max_y - cdiv(m_h, 2);
    else if (m_y + cdiv(m_h, 2) < min_y) m_y = min_y - cdiv(m_h, 2);
    m_x2 = m_x + m_w; m_y2 = m_y + m_h;
  }
  function AM_initVariables() {
    automapactive = true;
    if (global.G) global.G.automapactive = true;
    f_oldloc.x = MAXINT;
    amclock = 0; lightlev = 0;
    m_paninc.x = m_paninc.y = 0;
    ftom_zoommul = FRACUNIT; mtof_zoommul = FRACUNIT;
    m_w = FTOM(f_w); m_h = FTOM(f_h);
    plr = global.G.players[global.G.consoleplayer || 0];
    m_x = plr.mo.x - cdiv(m_w, 2);
    m_y = plr.mo.y - cdiv(m_h, 2);
    AM_changeWindowLoc();
    old_m_x = m_x; old_m_y = m_y; old_m_w = m_w; old_m_h = m_h;
    barRefreshPending = true;              // ST_Responder(AM_MSGENTERED)
  }
  function AM_loadPics() {
    // STATUSBAR is a script-scope const (bare reference works in browser and
    // vm; ASSETS/INTERLUDE precedent) — never window.STATUSBAR
    var S = (typeof STATUSBAR !== 'undefined') ? STATUSBAR : null;
    for (var i = 0; i < 10; i++) {
      var d = S && S.patches['AMMNUM' + i];
      if (d) marknums[i] = { w: d[0], h: d[1], px: b64(d[2]), left: d[3], top: d[4] };
    }
  }
  function AM_unloadPics() { /* Z_ChangeTag(PU_CACHE) — nothing to free in JS */ }
  function AM_clearMarks() {
    for (var i = 0; i < AM_NUMMARKPOINTS; i++) markpoints[i].x = -1;
    markpointnum = 0;
  }
  function AM_LevelInit() {
    leveljuststarted = 0;
    f_x = f_y = 0;
    f_w = 320; f_h = SCREENHEIGHT - 32;     // finit_width / finit_height
    AM_clearMarks();
    AM_findMinMaxBoundaries();
    scale_mtof = FD(min_scale_mtof, Math.floor(0.7 * FRACUNIT));
    if (scale_mtof > max_scale_mtof) scale_mtof = min_scale_mtof;
    scale_ftom = FD(FRACUNIT, scale_mtof);
  }
  function AM_Stop() {
    AM_unloadPics();
    automapactive = false;
    if (global.G) global.G.automapactive = false;
    barRefreshPending = true;               // ST_Responder(AM_MSGEXITED)
    stopped = true;
  }
  function AM_Start() {
    if (!stopped) AM_Stop();
    stopped = false;
    if (lastlevel !== global.G.gamemap || lastepisode !== global.G.gameepisode) {
      AM_LevelInit();
      lastlevel = global.G.gamemap; lastepisode = global.G.gameepisode;
    }
    AM_initVariables();
    AM_loadPics();
  }
  function AM_minOutWindowScale() {
    scale_mtof = min_scale_mtof;
    scale_ftom = FD(FRACUNIT, scale_mtof);
    AM_activateNewScale();
  }
  function AM_maxOutWindowScale() {
    scale_mtof = max_scale_mtof;
    scale_ftom = FD(FRACUNIT, scale_mtof);
    AM_activateNewScale();
  }

  // ---- AM_Responder (keydown) / keyup ---------------------------------------
  var bigstate = 0;
  function AM_Responder(ch) {
    var rc = false;
    if (!automapactive) {
      if (ch === AM_STARTKEY) { AM_Start(); rc = true; }
      return rc;
    }
    rc = true;
    switch (ch) {
      case AM_PANRIGHTKEY: if (!followplayer) m_paninc.x = FTOM(F_PANINC); else rc = false; break;
      case AM_PANLEFTKEY:  if (!followplayer) m_paninc.x = -FTOM(F_PANINC); else rc = false; break;
      case AM_PANUPKEY:    if (!followplayer) m_paninc.y = FTOM(F_PANINC); else rc = false; break;
      case AM_PANDOWNKEY:  if (!followplayer) m_paninc.y = -FTOM(F_PANINC); else rc = false; break;
      case AM_ZOOMOUTKEY: mtof_zoommul = M_ZOOMOUT; ftom_zoommul = M_ZOOMIN; break;
      case AM_ZOOMINKEY:  mtof_zoommul = M_ZOOMIN;  ftom_zoommul = M_ZOOMOUT; break;
      case AM_ENDKEY: bigstate = 0; AM_Stop(); break;
      case AM_GOBIGKEY:
        bigstate = bigstate ? 0 : 1;              // C int toggle
        if (bigstate) { AM_saveScaleAndLoc(); AM_minOutWindowScale(); }
        else AM_restoreScaleAndLoc();
        break;
      case AM_FOLLOWKEY:
        followplayer = followplayer ? 0 : 1;
        f_oldloc.x = MAXINT;
        plr.message = followplayer ? 'Follow Mode ON' : 'Follow Mode OFF';
        break;
      case AM_GRIDKEY:
        grid = grid ? 0 : 1;
        plr.message = grid ? 'Grid ON' : 'Grid OFF';
        break;
      case AM_MARKKEY:
        plr.message = 'Marked Spot ' + markpointnum;   // sprintf("%s %d", AMSTR_MARKEDSPOT, n)
        AM_addMark();
        break;
      case AM_CLEARMARKKEY:
        AM_clearMarks();
        plr.message = 'All Marks Cleared';
        break;
      default: cheatstate = 0; rc = false;
    }
    if (!global.netgame && cht_CheckCheat(cheat_amap, ch)) {
      rc = false;
      cheating = (cheating + 1) % 3;
    }
    return rc;
  }
  var cheatstate = 0;
  function AM_OnKeyUp(ch) {
    if (!automapactive) return false;
    var rc = false;
    switch (ch) {
      case AM_PANRIGHTKEY: case AM_PANLEFTKEY: if (!followplayer) m_paninc.x = 0; rc = true; break;
      case AM_PANUPKEY: case AM_PANDOWNKEY:    if (!followplayer) m_paninc.y = 0; rc = true; break;
      case AM_ZOOMOUTKEY: case AM_ZOOMINKEY:
        mtof_zoommul = FRACUNIT; ftom_zoommul = FRACUNIT; rc = true; break;
    }
    return rc;
  }

  // ---- AM_Ticker -------------------------------------------------------------
  function AM_changeWindowScale() {
    scale_mtof = FM(scale_mtof, mtof_zoommul);
    scale_ftom = FD(FRACUNIT, scale_mtof);
    if (scale_mtof < min_scale_mtof) AM_minOutWindowScale();
    else if (scale_mtof > max_scale_mtof) AM_maxOutWindowScale();
    else AM_activateNewScale();
  }
  function AM_doFollowPlayer() {
    if (f_oldloc.x !== plr.mo.x || f_oldloc.y !== plr.mo.y) {
      m_x = FTOM(MTOF(plr.mo.x)) - cdiv(m_w, 2);
      m_y = FTOM(MTOF(plr.mo.y)) - cdiv(m_h, 2);
      m_x2 = m_x + m_w; m_y2 = m_y + m_h;
      f_oldloc.x = plr.mo.x; f_oldloc.y = plr.mo.y;
    }
  }
  function AM_Ticker() {
    if (!automapactive) return;
    amclock++;
    if (followplayer) AM_doFollowPlayer();
    if (ftom_zoommul !== FRACUNIT) AM_changeWindowScale();
    if (m_paninc.x || m_paninc.y) AM_changeWindowLoc();
    // AM_updateLightLev() — commented out in vanilla 1.10; lightlev stays 0
  }

  // ---- drawing ----------------------------------------------------------------
  var fb = null;                              // viewbuffer alias while drawing
  function AM_clearFB(color) {
    var rgb = global.PIX_LUT[color & 255];    // table 0 (fullbright) — FG palette
    for (var y = 0; y < f_h; y++)
      fb.fill(rgb, (f_y + y) * 320 + f_x, (f_y + y) * 320 + f_x + f_w);
  }

  var LEFT = 1, RIGHT = 2, BOTTOM = 4, TOP = 8;
  function outcode(oc, mx, my) {
    oc = 0;
    if (my < 0) oc |= TOP; else if (my >= f_h) oc |= BOTTOM;
    if (mx < 0) oc |= LEFT; else if (mx >= f_w) oc |= RIGHT;
    return oc;
  }
  function AM_clipMline(ml, fl) {
    var outcode1 = 0, outcode2 = 0, outside, dx, dy;
    var tmpx, tmpy;
    if (ml.a.y > m_y2) outcode1 = TOP; else if (ml.a.y < m_y) outcode1 = BOTTOM;
    if (ml.b.y > m_y2) outcode2 = TOP; else if (ml.b.y < m_y) outcode2 = BOTTOM;
    if (outcode1 & outcode2) return false;
    if (ml.a.x < m_x) outcode1 |= LEFT; else if (ml.a.x > m_x2) outcode1 |= RIGHT;
    if (ml.b.x < m_x) outcode2 |= LEFT; else if (ml.b.x > m_x2) outcode2 |= RIGHT;
    if (outcode1 & outcode2) return false;

    fl.ax = CXMTOF(ml.a.x); fl.ay = CYMTOF(ml.a.y);
    fl.bx = CXMTOF(ml.b.x); fl.by = CYMTOF(ml.b.y);

    outcode1 = outcode(outcode1, fl.ax, fl.ay);
    outcode2 = outcode(outcode2, fl.bx, fl.by);
    if (outcode1 & outcode2) return false;

    while (outcode1 | outcode2) {
      if (outcode1) outside = outcode1; else outside = outcode2;
      if (outside & TOP) {
        dy = fl.ay - fl.by; dx = fl.bx - fl.ax;
        tmpx = fl.ax + cdiv(dx * fl.ay, dy); tmpy = 0;
      } else if (outside & BOTTOM) {
        dy = fl.ay - fl.by; dx = fl.bx - fl.ax;
        tmpx = fl.ax + cdiv(dx * (fl.ay - f_h), dy); tmpy = f_h - 1;
      } else if (outside & RIGHT) {
        dy = fl.by - fl.ay; dx = fl.bx - fl.ax;
        tmpy = fl.ay + cdiv(dy * (f_w - 1 - fl.ax), dx); tmpx = f_w - 1;
      } else { // LEFT
        dy = fl.by - fl.ay; dx = fl.bx - fl.ax;
        tmpy = fl.ay + cdiv(dy * (-fl.ax), dx); tmpx = 0;
      }
      if (outside === outcode1) {
        fl.ax = tmpx; fl.ay = tmpy;
        outcode1 = outcode(outcode1, fl.ax, fl.ay);
      } else {
        fl.bx = tmpx; fl.by = tmpy;
        outcode2 = outcode(outcode2, fl.bx, fl.by);
      }
      if (outcode1 & outcode2) return false;
    }
    return true;
  }

  function AM_drawFline(fl, color) {
    // vanilla bails (drawing nothing) if either endpoint left the frame
    if (fl.ax < 0 || fl.ax >= f_w || fl.ay < 0 || fl.ay >= f_h ||
        fl.bx < 0 || fl.bx >= f_w || fl.by < 0 || fl.by >= f_h) return;
    var rgb = global.PIX_LUT[color & 255];
    var x, y, dx, dy, sx, sy, ax, ay, d;
    dx = fl.bx - fl.ax; ax = 2 * (dx < 0 ? -dx : dx); sx = dx < 0 ? -1 : 1;
    dy = fl.by - fl.ay; ay = 2 * (dy < 0 ? -dy : dy); sy = dy < 0 ? -1 : 1;
    x = fl.ax; y = fl.ay;
    if (ax > ay) {
      d = ay - (ax >> 1);
      for (;;) {
        fb[y * 320 + x] = rgb;
        if (x === fl.bx) return;
        if (d >= 0) { y += sy; d -= ax; }
        x += sx; d += ay;
      }
    } else {
      d = ax - (ay >> 1);
      for (;;) {
        fb[y * 320 + x] = rgb;
        if (y === fl.by) return;
        if (d >= 0) { x += sx; d -= ay; }
        y += sy; d += ax;
      }
    }
  }

  var _ml = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  var _fl = { ax: 0, ay: 0, bx: 0, by: 0 };
  function AM_drawMline(ml, color) {
    if (AM_clipMline(ml, _fl)) AM_drawFline(_fl, color);
  }
  function drawSeg(ax, ay, bx, by, color) {
    _ml.a.x = ax; _ml.a.y = ay; _ml.b.x = bx; _ml.b.y = by;
    AM_drawMline(_ml, color);
  }

  function AM_drawGrid(color) {
    var start, end;
    var BLK = global.MAPBLOCKUNITS << FRACBITS;
    var bmaporgx = global.bmaporgx | 0, bmaporgy = global.bmaporgy | 0;
    // vertical gridlines
    start = m_x;
    if ((start - bmaporgx) % BLK) start += BLK - ((start - bmaporgx) % BLK);
    end = m_x + m_w;
    for (var x = start; x < end; x += BLK)
      drawSeg(x, m_y, x, m_y + m_h, color);
    // horizontal gridlines
    start = m_y;
    if ((start - bmaporgy) % BLK) start += BLK - ((start - bmaporgy) % BLK);
    end = m_y + m_h;
    for (var y = start; y < end; y += BLK)
      drawSeg(m_x, y, m_x + m_w, y, color);
  }

  var ML_MAPPED = 256, ML_SECRET = 32, ML_DONTDRAW = 128;
  function AM_drawWalls() {
    var lines = global.linedefs, numlines = global.numlines;
    for (var i = 0; i < numlines; i++) {
      var L = lines[i];
      _ml.a.x = L.v1.x; _ml.a.y = L.v1.y;
      _ml.b.x = L.v2.x; _ml.b.y = L.v2.y;
      if (cheating || (L.flags & ML_MAPPED)) {
        if ((L.flags & ML_DONTDRAW) && !cheating) continue;   // LINE_NEVERSEE
        if (!L.backsector) {
          AM_drawMline(_ml, WALLCOLORS + lightlev);
        } else {
          if (L.special === 39) AM_drawMline(_ml, WALLCOLORS + (WALLRANGE >> 1));
          else if (L.flags & ML_SECRET) {
            if (cheating) AM_drawMline(_ml, SECRETWALLCOLORS + lightlev);
            else AM_drawMline(_ml, WALLCOLORS + lightlev);
          }
          else if (L.backsector.floorheight !== L.frontsector.floorheight)
            AM_drawMline(_ml, FDWALLCOLORS + lightlev);
          else if (L.backsector.ceilingheight !== L.frontsector.ceilingheight)
            AM_drawMline(_ml, CDWALLCOLORS + lightlev);
          else if (cheating) AM_drawMline(_ml, TSWALLCOLORS + lightlev);
        }
      } else if (plr.powers[4]) {                  // pw_allmap
        if (!(L.flags & ML_DONTDRAW)) AM_drawMline(_ml, GRAYS + 3);
      }
    }
  }

  function AM_rotate(xy, a) {                       // in-place rotate (x,y)
    var finecosine = global.finecosine, finesine = global.finesine;
    var sh = a >>> 19;                              // ANGLETOFINESHIFT
    var tmpx = FM(xy.x, finecosine[sh]) - FM(xy.y, finesine[sh]);
    xy.y = FM(xy.x, finesine[sh]) + FM(xy.y, finecosine[sh]);
    xy.x = tmpx;
  }
  var _rl = { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } };
  function AM_drawLineCharacter(guy, scale, angle, color, x, y) {
    for (var i = 0; i < guy.length; i++) {
      _rl.a.x = guy[i].a.x; _rl.a.y = guy[i].a.y;
      if (scale) { _rl.a.x = FM(scale, _rl.a.x); _rl.a.y = FM(scale, _rl.a.y); }
      if (angle) AM_rotate(_rl.a, angle);
      _rl.a.x += x; _rl.a.y += y;
      _rl.b.x = guy[i].b.x; _rl.b.y = guy[i].b.y;
      if (scale) { _rl.b.x = FM(scale, _rl.b.x); _rl.b.y = FM(scale, _rl.b.y); }
      if (angle) AM_rotate(_rl.b, angle);
      _rl.b.x += x; _rl.b.y += y;
      AM_drawMline(_rl, color);
    }
  }

  function AM_drawPlayers() {
    if (cheating)
      AM_drawLineCharacter(cheat_player_arrow, 0, plr.mo.angle, WHITE, plr.mo.x, plr.mo.y);
    else
      AM_drawLineCharacter(player_arrow, 0, plr.mo.angle, WHITE, plr.mo.x, plr.mo.y);
  }

  function AM_drawThings(colors) {
    var sectors = global.sectors, numsectors = global.numsectors;
    for (var i = 0; i < numsectors; i++) {
      var t = sectors[i].thinglist;
      while (t) {
        AM_drawLineCharacter(thintriangle_guy, 16 << FRACBITS, t.angle,
                             colors + lightlev, t.x, t.y);
        t = t.snext;
      }
    }
  }

  function AM_drawMarks() {
    for (var i = 0; i < AM_NUMMARKPOINTS; i++) {
      if (markpoints[i].x !== -1) {
        var w = 5, h = 6;                            // vanilla hardcodes these
        var fx = CXMTOF(markpoints[i].x), fy = CYMTOF(markpoints[i].y);
        if (fx >= f_x && fx <= f_w - w && fy >= f_y && fy <= f_h - h && marknums[i]) {
          var p = marknums[i];
          // V_DrawPatch semantics: x -= leftoffset, y -= topoffset
          var px0 = fx - p.left, py0 = fy - p.top;
          for (var yy = 0; yy < p.h; yy++) {
            var row = (py0 + yy) * 320 + px0;
            for (var xx = 0; xx < p.w; xx++) {
              var v = p.px[yy * p.w + xx];
              if (v !== 255) fb[row + xx] = global.PIX_LUT[v];
            }
          }
        }
      }
    }
  }

  function AM_drawCrosshair(color) {
    fb[(f_w * (f_h + 1)) >> 1] = global.PIX_LUT[color & 255];
  }

  // AM_Drawer (am_map.c:1317) — draws into the shared viewbuffer
  function AM_Drawer() {
    if (!automapactive) return;
    fb = global.viewbuffer;
    if (!fb) return;
    AM_clearFB(BACKGROUND);
    if (grid) AM_drawGrid(GRIDCOLORS);
    AM_drawWalls();
    AM_drawPlayers();
    if (cheating === 2) AM_drawThings(THINGCOLORS);
    AM_drawCrosshair(XHAIRCOLORS);
    AM_drawMarks();
  }

  function b64(s) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
    var bin = atob(s), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }

  global.AM = {
    Responder: AM_Responder,
    OnKeyUp: AM_OnKeyUp,
    Ticker: AM_Ticker,
    Drawer: AM_Drawer,
    Stop: AM_Stop,
    Start: AM_Start,
    active: function () { return automapactive; },
    following: function () { return !!followplayer; },
    // consumed by main.js each draw: status bar refresh on enter/exit
    takeBarRefresh: function () { var v = barRefreshPending; barRefreshPending = false; return v; },
    _state: function () {
      return { active: automapactive, follow: followplayer, grid: grid,
               cheating: cheating, marks: markpointnum, big: bigstate,
               scale_mtof: scale_mtof, m_x: m_x, m_y: m_y, m_w: m_w, m_h: m_h,
               min_scale_mtof: min_scale_mtof, max_scale_mtof: max_scale_mtof };
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
