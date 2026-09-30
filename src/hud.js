// hud.js — status bar port: st_stuff.c + st_lib.c.
// Real WAD patch graphics (src/statusbar.js legacy (statusbar art now WAD-hotloaded), extracted verbatim from
// wads/Doom1.wad by tools/extract_statusbar.py). The bar renders into its
// own 320x32 indexed buffer: a BG copy of STBAR that widgets restore over
// (STlib_drawNum's V_CopyRect dirty-rect erase — kept verbatim), then
// HUD.blitToViewbuffer() copies BG -> viewbuffer rows ST_Y..199
// (st_stuff.c:509 V_CopyRect(BG -> FG)).
// ST_doPaletteStuff palette shifts (red pain / yellow pickup / radiation
// suit) are ported and drive I_SetPalette via engine buildPixLut, plus the
// face widget state machine and the arms-row widgets.
// Note: STWS* ammo-cost icons do not exist in the Doom 1.10 WAD set, so the
// arms row is STARMS backdrop + gray/yellow weapon numbers only.
'use strict';
(function (global) {
  var SCREENWIDTH = 320, SCREENHEIGHT = 200, ST_Y = SCREENHEIGHT - 32;
  var TRANS = 255;

  // ---- patch table (lazy; STATUSBAR is a plain <script> global) ----------
  var P = null;                    // name -> {w,h,px,left,top}
  var BG = null;                   // Uint8Array 320*32 working bar (widgets draw here)
  var BACK = null;                 // pristine backdrop (STBAR+faceback+STARMS);
                                   // widget erases restore from BACK — vanilla's
                                   // BG->FG copy. With BG doubling as FG, a BG->BG
                                   // self-copy would be a no-op and stale digits
                                   // would linger under new ones.
  function patch(name) {
    var d = STATUSBAR.patches[name];      // bare: const ASSETS/STATUSBAR are
    return { w: d[0], h: d[1], px: b64decode(d[2]), left: d[3], top: d[4] };  // lexical globals
  }

  // V_DrawPatch onto the 32-row bar buffer; y is BAR-relative (0..31).
  function drawPatch(x, y, p) {
    x -= p.left; y -= p.top;
    var x1 = x < 0 ? -x : 0, y1 = y < 0 ? -y : 0;
    var x2 = Math.min(p.w, SCREENWIDTH - x), y2 = Math.min(p.h, 32 - y);
    for (var yy = y1; yy < y2; yy++) {
      var row = (y + yy) * SCREENWIDTH + x;
      var src = yy * p.w;
      for (var xx = x1; xx < x2; xx++) {
        var c = p.px[src + xx];
        if (c !== TRANS) BG[row + xx] = c;
      }
    }
  }
  // Widget dirty-rect erase: restore the rect from the pristine BACK drop
  // onto the working BG (= vanilla's V_CopyRect(BG -> FG)).
  function copyRect(x, y, w, h, dx, dy) {
    if (x < 0) { w += x; dx -= x; x = 0; }
    if (y < 0) { h += y; dy -= y; y = 0; }
    if (x + w > SCREENWIDTH) w = SCREENWIDTH - x;
    if (y + h > 32) h = 32 - y;
    if (dx < 0) { w += dx; dx = 0; }
    if (dy < 0) { h += dy; dy = 0; }
    if (dx + w > SCREENWIDTH) w = SCREENWIDTH - dx;
    if (dy + h > 32) h = 32 - dy;
    for (var yy = h - 1; yy >= 0; yy--) {
      var s = (y + yy) * SCREENWIDTH + x, d = (dy + yy) * SCREENWIDTH + dx;
      for (var xx = 0; xx < w; xx++) BG[d + xx] = BACK[s + xx];
    }
  }

  // ---- st_number_t (st_lib.c STlib_drawNum, verbatim) --------------------
  // Widget y is a FULL-screen coordinate (168..199); draw into BG at y-ST_Y.
  function Number_(x, y, pl, numFn, width) {
    return { x: x, y: y, p: pl, num: numFn, width: width };
  }
  function updateNum(n, refresh) {
    var numdigits = n.width;
    var num = n.num();
    var w = n.p(0).w, h = n.p(0).h;
    var neg = num < 0;
    if (neg) {
      if (numdigits === 2 && num < -9) num = -9;
      else if (numdigits === 3 && num < -99) num = -99;
      num = -num;
    }
    // clear the area
    var x = n.x - numdigits * w;
    copyRect(x, n.y - ST_Y, w * numdigits, h, x, n.y - ST_Y);
    if (num === 1994) return;            // "n/a" sentinel (w_ready, no-ammo weapons)
    x = n.x;
    if (!num) drawPatch(x - w, n.y - ST_Y, n.p(0));
    while (num && numdigits--) {
      x -= w;
      drawPatch(x, n.y - ST_Y, n.p(num % 10));
      num = (num / 10) | 0;
    }
    if (neg) drawPatch(x - 8, n.y - ST_Y, P.sttminus);
  }

  // st_percent_t: percent sign drawn only on refresh, right of the digits
  function updatePercent(per, refresh) {
    if (refresh) drawPatch(per.n.x, per.n.y - ST_Y, per.p);
    updateNum(per.n, refresh);
  }
  function Percent_(x, y, pl, numFn, percent) {
    return { n: Number_(x, y, pl, numFn, 3), p: percent };
  }

  // ---- st_multicon_t ------------------------------------------------------
  function MultIcon(x, y, il, inumFn) {
    return { x: x, y: y, p: il, inum: inumFn, oldinum: -1 };
  }
  function updateMultIcon(mi, refresh) {
    var inum = mi.inum();
    if (mi.oldinum !== inum || refresh) {
      if (mi.oldinum !== -1) {
        var q = mi.p(mi.oldinum);
        copyRect(mi.x - q.left, mi.y - ST_Y - q.top, q.w, q.h,
                 mi.x - q.left, mi.y - ST_Y - q.top);
      }
      if (inum !== -1) drawPatch(mi.x, mi.y - ST_Y, mi.p(inum));
      mi.oldinum = inum;
    }
  }

  // ---- widget geometry (st_stuff.c #defines) ------------------------------
  var ST_AMMOX = 44,   ST_AMMOY = 171;   // ready-weapon ammo, tall
  var ST_HEALTHX = 90, ST_HEALTHY = 171; // health %, tall
  var ST_ARMSX = 111,  ST_ARMSY = 172;
  var ST_ARMSBGX = 104, ST_ARMSBGY = 168;
  var ST_ARMSXSPACE = 12, ST_ARMSYSPACE = 10;
  var ST_FX = 143, ST_FY = 169;          // faceback
  var ST_FACESX = 143, ST_FACESY = 168;
  var ST_ARMORX = 221, ST_ARMORY = 171;  // armor %, tall
  var ST_KEYX = 239, ST_KEY0Y = 171;     // keyboxes, short stride 10
  var ST_AMMO0X = 288;                   // ammo totals column, short
  var ST_AMMO0Y = 173, ST_AMMO1Y = 179, ST_AMMO3Y = 185, ST_AMMO2Y = 191;
  var ST_MAXAMMO0X = 314;
  var ST_MAXAMMO0Y = 173, ST_MAXAMMO1Y = 179, ST_MAXAMMO3Y = 185, ST_MAXAMMO2Y = 191;

  var ST_NUMPAINFACES = 5, ST_NUMSTRAIGHTFACES = 3, ST_FACESTRIDE = 8;
  var ST_TURNOFFSET = ST_NUMSTRAIGHTFACES, ST_OUCHOFFSET = ST_TURNOFFSET + 2,
      ST_EVILGRINOFFSET = ST_OUCHOFFSET + 1, ST_RAMPAGEOFFSET = ST_EVILGRINOFFSET + 1;
  var ST_GODFACE = ST_NUMPAINFACES * ST_FACESTRIDE, ST_DEADFACE = ST_GODFACE + 1;
  var ST_EVILGRINCOUNT = 2 * 35, ST_STRAIGHTFACECOUNT = 35 / 2 | 0,
      ST_TURNCOUNT = 35, ST_RAMPAGEDELAY = 2 * 35, ST_MUCHPAIN = 20;
  var CF_GODMODE = 16, pw_invulnerability = 0, NUMWEAPONS = 9, NUMCARDS = 6;

  // ---- face state machine (ST_updateFaceWidget, verbatim) ----------------
  var st_faceindex = 0, st_facecount = 0, st_randomnumber = 0;
  var st_oldhealth = -1, lastattackdown = -1, priority = 0;
  var lastcalc = 0, oldhealthCalc = -1;
  var oldweaponsowned = new Array(NUMWEAPONS);

  function calcPainOffset(health) {
    health = health > 100 ? 100 : health;
    if (health !== oldhealthCalc) {
      lastcalc = ST_FACESTRIDE * (((100 - health) * ST_NUMPAINFACES) / 101 | 0);
      oldhealthCalc = health;
    }
    return lastcalc;
  }

  function updateFaceWidget(p) {
    var i, badguyangle, diffang, doevilgrin;
    if (priority < 10 && !p.health) {
      priority = 9; st_faceindex = ST_DEADFACE; st_facecount = 1;
    }
    if (priority < 9 && p.bonuscount) {
      doevilgrin = false;
      for (i = 0; i < NUMWEAPONS; i++)
        if (oldweaponsowned[i] !== p.weaponowned[i]) {
          doevilgrin = true; oldweaponsowned[i] = p.weaponowned[i];
        }
      if (doevilgrin) {
        priority = 8; st_facecount = ST_EVILGRINCOUNT;
        st_faceindex = calcPainOffset(p.health) + ST_EVILGRINOFFSET;
      }
    }
    if (priority < 8 && p.damagecount && p.attacker && p.attacker !== p.mo) {
      priority = 7;
      if (p.health - st_oldhealth > ST_MUCHPAIN) {
        st_facecount = ST_TURNCOUNT;
        st_faceindex = calcPainOffset(p.health) + ST_OUCHOFFSET;
      } else {
        badguyangle = global.R_PointToAngle2(p.mo.x, p.mo.y, p.attacker.x, p.attacker.y);
        if (badguyangle > p.mo.angle) {
          diffang = (badguyangle - p.mo.angle) >>> 0;
          i = diffang > 0x80000000;
        } else {
          diffang = (p.mo.angle - badguyangle) >>> 0;
          i = diffang <= 0x80000000;
        }
        st_facecount = ST_TURNCOUNT;
        st_faceindex = calcPainOffset(p.health);
        if (diffang < 0x10000000) st_faceindex += ST_RAMPAGEOFFSET;      // head-on
        else if (i) st_faceindex += ST_TURNOFFSET;                       // turn right
        else st_faceindex += ST_TURNOFFSET + 1;                          // turn left
      }
    }
    if (priority < 7 && p.damagecount) {
      if (p.health - st_oldhealth > ST_MUCHPAIN) {
        priority = 7; st_facecount = ST_TURNCOUNT;
        st_faceindex = calcPainOffset(p.health) + ST_OUCHOFFSET;
      } else {
        priority = 6; st_facecount = ST_TURNCOUNT;
        st_faceindex = calcPainOffset(p.health) + ST_RAMPAGEOFFSET;
      }
    }
    if (priority < 6 && p.attackdown) {
      if (lastattackdown === -1) lastattackdown = ST_RAMPAGEDELAY;
      else if (!--lastattackdown) {
        priority = 5;
        st_faceindex = calcPainOffset(p.health) + ST_RAMPAGEOFFSET;
        st_facecount = 1; lastattackdown = 1;
      }
    } else lastattackdown = -1;
    if (priority < 5 && ((p.cheats & CF_GODMODE) || p.powers[pw_invulnerability])) {
      priority = 4; st_faceindex = ST_GODFACE; st_facecount = 1;
    }
    if (!st_facecount) {
      st_faceindex = calcPainOffset(p.health) + (st_randomnumber % 3);
      st_facecount = ST_STRAIGHTFACECOUNT;
      priority = 0;
    }
    st_facecount--;
  }

  // ---- widget instances ----------------------------------------------------
  var w_ready, w_health, w_armor, w_ammo = [], w_maxammo = [], w_arms = [],
      w_keyboxes = [], w_faces;
  var keyboxes = [-1, -1, -1];
  var armsOn = [0, 0, 0, 0, 0, 0];
  var largeammo = 1994;
  var plyr = null;

  // ---- ST_doPaletteStuff (st_stuff.c:1000, verbatim) ----------------------
  // damagecount red flash > bonuscount pickup flash > radiation suit. The
  // engine renders 1.10-style (PIX_LUT from COLORMAP LUTs), so "I_SetPalette"
  // = rebuild PIX_LUT (and the bar LUT) from the chosen PLAYPAL table.
  var STARTREDPALS = 1, STARTBONUSPALS = 9, RADIATIONPAL = 13;
  var NUMREDPALS = 8, NUMBONUSPALS = 4;
  var st_palette = 0;
  var pw_strength = 0, pw_ironfeet = 3;
  var currentPal = null;               // active PLAYPAL table (bar LUT source)
  function doPaletteStuff() {
    var palette, cnt, bzc;
    var p = plyr;
    cnt = p.damagecount;
    if (p.powers[pw_strength]) {        // slowly fade the berzerk out
      bzc = 12 - (p.powers[pw_strength] >> 6);
      if (bzc > cnt) cnt = bzc;
    }
    if (cnt) {
      palette = (cnt + 7) >> 3;
      if (palette >= NUMREDPALS) palette = NUMREDPALS - 1;
      palette += STARTREDPALS;
    } else if (p.bonuscount) {
      palette = (p.bonuscount + 7) >> 3;
      if (palette >= NUMBONUSPALS) palette = NUMBONUSPALS - 1;
      palette += STARTBONUSPALS;
    } else if (p.powers[pw_ironfeet] > 4 * 32 || p.powers[pw_ironfeet] & 8) {
      palette = RADIATIONPAL;
    } else {
      palette = 0;
    }
    if (palette !== st_palette) {
      st_palette = palette;
      var pals = ASSETS.palettes || [ASSETS.palette];
      var pal = pals[Math.min(palette, pals.length - 1)];
      currentPal = pal;
      buildPixLut(pal);                 // I_SetPalette
      barLut = null;                    // bar re-LUTs from new palette
    }
  }

  function tallnum(i) { return P['tallnum' + i]; }
  function shortnum(i) { return P['shortnum' + i]; }
  function idxFn(v) { return function () { return v; }; }

  function createWidgets() {
    w_ready = Number_(ST_AMMOX, ST_AMMOY, tallnum, function () {
      var wi = global.G.weaponinfo[plyr.readyweapon];
      return (wi && wi.ammo) ? plyr.ammo[wi.ammo] : largeammo;
    }, 3);
    w_health = Percent_(ST_HEALTHX, ST_HEALTHY, tallnum,
      function () { return plyr.health; }, P.tallpercent);
    w_armor = Percent_(ST_ARMORX, ST_ARMORY, tallnum,
      function () { return plyr.armorpoints; }, P.tallpercent);
    // vanilla widget rows top->bottom: bullets 173, shells 179, rockets 185,
    // cells 191 (ST_AMMO0/1/3/2Y defines: vanilla ammo is 0-based
    // clip,shell,cell,misl; this port's plyr.ammo is d_player.h 1-based
    // [noammo,clip,shell,cell,misl], so map rows to engine indices).
    var ammoY = [ST_AMMO0Y, ST_AMMO1Y, ST_AMMO3Y, ST_AMMO2Y];
    var maxAmmoY = [ST_MAXAMMO0Y, ST_MAXAMMO1Y, ST_MAXAMMO3Y, ST_MAXAMMO2Y];
    var ammoIdx = [1, 2, 4, 3];  // am_clip, am_shell, am_misl, am_cell (1-based)
    for (var i = 0; i < 4; i++) {
      (function (k) {
        w_ammo[k] = Number_(ST_AMMO0X, ammoY[k], shortnum,
          function () { return plyr.ammo[ammoIdx[k]]; }, 3);
        w_maxammo[k] = Number_(ST_MAXAMMO0X, maxAmmoY[k], shortnum,
          function () { return plyr.maxammo[ammoIdx[k]]; }, 3);
      })(i);
    }
    for (i = 0; i < 6; i++) {
      (function (k) {
        w_arms[k] = MultIcon(ST_ARMSX + (k % 3) * ST_ARMSXSPACE,
          ST_ARMSY + ((k / 3) | 0) * ST_ARMSYSPACE,
          function (idx) { return idx ? P['shortnum' + (k + 2)] : P['stgnum' + (k + 2)]; },
          function () { return armsOn[k]; });
      })(i);
    }
    w_faces = MultIcon(ST_FACESX, ST_FACESY,
      function (idx) { return P.faces[idx]; }, function () { return st_faceindex; });
    for (i = 0; i < 3; i++) {
      (function (k) {
        w_keyboxes[k] = MultIcon(ST_KEYX, ST_KEY0Y + k * 10,
          function (idx) { return P['keys' + idx]; },
          function () { return keyboxes[k]; });
      })(i);
    }
  }

  function updateWidgets(p) {
    for (var i = 0; i < 3; i++) {
      keyboxes[i] = p.cards[i] ? i : -1;
      if (p.cards[i + 3]) keyboxes[i] = i + 3;
    }
    updateFaceWidget(p);
    for (i = 0; i < 6; i++) armsOn[i] = p.weaponowned[i + 1] ? 1 : 0;
  }

  function ST_Ticker(p) {
    st_randomnumber = global.G.M_Random();
    updateWidgets(p);
    st_oldhealth = p.health;
  }

  function drawWidgets(refresh) {
    updateNum(w_ready, refresh);
    for (var i = 0; i < 4; i++) { updateNum(w_ammo[i], refresh); updateNum(w_maxammo[i], refresh); }
    updatePercent(w_health, refresh);
    updatePercent(w_armor, refresh);
    for (i = 0; i < 6; i++) updateMultIcon(w_arms[i], refresh);
    updateMultIcon(w_faces, refresh);
    for (i = 0; i < 3; i++) updateMultIcon(w_keyboxes[i], refresh);
  }

  // ---- init: composite the BG (ST_start + ST_createWidgets backdrop) ------
  var inited = false;
  function init() {
    P = {};
    P.sttminus = patch('STTMINUS');
    P.tallpercent = patch('STTPRCNT');
    for (var i = 0; i < 10; i++) { P['tallnum' + i] = patch('STTNUM' + i); P['shortnum' + i] = patch('STYSNUM' + i); }
    for (i = 2; i < 8; i++) P['stgnum' + i] = patch('STGNUM' + i);
    for (i = 0; i < NUMCARDS; i++) P['keys' + i] = patch('STKEYS' + i);
    P.faces = [];
    for (i = 0; i < ST_NUMPAINFACES; i++) {
      for (var j = 0; j < ST_NUMSTRAIGHTFACES; j++) P.faces.push(patch('STFST' + i + '' + j));
      P.faces.push(patch('STFTR' + i + '0'), patch('STFTL' + i + '0'), patch('STFOUCH' + i),
                   patch('STFEVL' + i), patch('STFKILL' + i));
    }
    P.faces.push(patch('STFGOD0'), patch('STFDEAD0'));

    BACK = new Uint8Array(SCREENWIDTH * 32);
    BG = BACK;                          // draw the backdrop itself into BACK
    drawPatch(0, 0, patch('STBAR'));               // V_DrawPatch(ST_X, 0, BG, sbar)
    drawPatch(ST_FX, ST_FY - ST_Y, patch('STFB0')); // faceback (consoleplayer 0)
    // armsbg is a binicon (always on in SP): draw STARMS into BG/FG once.
    drawPatch(ST_ARMSBGX, ST_ARMSBGY - ST_Y, patch('STARMS'));
    BG = BACK.slice();                  // working copy; BACK stays pristine

    createWidgets();
    inited = true;
  }

  function ST_init(player) {                    // ST_start (level restart)
    // vanilla ST_Start composites the bar (STlib backdrop) at game load, so
    // the FIRST level frame — the wipe's end screen for the title->demo melt —
    // already carries the statusbar. Compose it here instead of lazily on the
    // first ST_refresh: the tic loop is frozen during the blocking wipe, so a
    // deferred init melts toward a bar-less (black) frame and pops the bar in
    // afterwards.
    if (!inited) init();
    plyr = player;
    st_faceindex = 0; st_facecount = 0; st_oldhealth = -1;
    lastattackdown = -1; priority = 0; oldhealthCalc = -1;
    for (var i = 0; i < NUMWEAPONS; i++) oldweaponsowned[i] = player.weaponowned[i];
    for (i = 0; i < 3; i++) { keyboxes[i] = -1; }
    for (i = 0; i < 6; i++) armsOn[i] = 0;
    if (w_faces) {                        // widgets exist after first init()
      for (i = 0; i < 6; i++) w_arms[i].oldinum = -1;
      w_faces.oldinum = -1;
      for (i = 0; i < 3; i++) w_keyboxes[i].oldinum = -1;
    }
    // ST_Drawer's first pass (st_stuff.c): ST_updateWidgets + draw-everything
    // (all oldinum == -1 forces refresh). Without this the wipe's end screen
    // melts toward a backdrop-only bar — the tic loop can't populate widgets
    // while the blocking melt freezes gametic.
    if (inited) { updateWidgets(player); drawWidgets(true); }
  }

  // per-tic update + widget redraw into BG (call after G_Ticker)
  function ST_refresh(p, refresh) {
    if (!inited) init();
    plyr = p;
    ST_Ticker(p);
    doPaletteStuff();                  // st_stuff.c: ST_update does this too
    drawWidgets(!!refresh);
  }

  // RGB LUT for the bar (unlit: palette direct, like FG with fullbright).
  // Pack 0xFF|BBGGRR: viewbuffer is a Uint32Array over ImageData bytes
  // (little-endian byte order R,G,B,A) — same convention as PIX_LUT.
  var barLut = null;
  function buildBarLut() {
    var pal = currentPal || ASSETS.palette;
    barLut = new Int32Array(256);
    for (var i = 0; i < 256; i++)
      barLut[i] = 0xff000000 | (pal[i][2] << 16) | (pal[i][1] << 8) | pal[i][0];
  }

  // blit bar BG -> RGB viewbuffer rows ST_Y..199
  function blitToViewbuffer(viewbuffer) {
    if (!BG) return;      // ST_refresh/init hasn't run yet (demo playback —
                          // vanilla demos have no statusbar anyway)
    if (!barLut) buildBarLut();
    for (var y = 0; y < 32; y++) {
      var s = y * SCREENWIDTH, d = (ST_Y + y) * SCREENWIDTH;
      for (var x = 0; x < SCREENWIDTH; x++) viewbuffer[d + x] = barLut[BG[s + x]];
    }
  }

  global.HUD = {
    ST_Y: ST_Y,
    ST_init: ST_init,
    ST_refresh: ST_refresh,
    blitToViewbuffer: blitToViewbuffer,
    _bg: function () { return BG; },
    _reset: function () { inited = false; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
