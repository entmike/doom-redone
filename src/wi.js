/* wi.js — intermission screen. Verbatim port of reference/linuxdoom-1.10
   wi_stuff.c single-player path (WI_Start/WI_Ticker/WI_Drawer, StatCount ->
   ShowNextLoc -> NoState), drawn into a 320x200 indexed screen the way
   V_DrawPatch does it (screens[1] bg copy + patches skipping 255 = post gaps),
   then LUT'd into the engine viewbuffer. Data comes from the WAD (wadinstall INTERLUDE bundles)
   (WIMAP0/WILV0x/WIA00xxx/WIURH/WISPLAT/WINUM/WIPCNT/... patches).
   Deviations (documented): single-player only (port has no netgame),
   palette table 0 of PLAYPAL[0] always (port never shifts the WI palette). */
'use strict';
(function (global) {
  var SCREENWIDTH = 320, SCREENHEIGHT = 200, TICRATE = 35;
  var TRANS = 255;

  // wi_stuff.c:80-95 single-player layout constants
  var WI_TITLEY = 2, WI_SPACINGY = 33;
  var SP_STATSX = 50, SP_STATSY = 50;
  var SP_TIMEX = 16, SP_TIMEY = (SCREENHEIGHT - 32);
  var SHOWNEXTLOCDELAY = 4;          // in seconds (wi_stuff.c:299)

  // g_game.c:978 pars[4][10] (episode rows); wminfo.partime = 35*pars[ep][map]
  var pars = [[0],
    [0, 30, 75, 120, 90, 165, 180, 180, 30, 165],
    [0, 90, 90, 90, 120, 90, 360, 240, 30, 170],
    [0, 90, 45, 90, 150, 90, 90, 165, 30, 135]];

  // wi_stuff.c:186-195 lnodes episode 0 ("location of level N (CJ)")
  // wi_stuff.c:176-220 lnodes[NUMEPISODES][NUMMAPS]
  var lnodesEp = [
    [[185, 164], [148, 143], [69, 122], [209, 102], [116, 89],
     [166, 55], [71, 56], [135, 29], [71, 24]],
    [[254, 25], [97, 50], [188, 64], [128, 78], [214, 92],
     [133, 130], [208, 136], [148, 140], [235, 158]],
    [[156, 168], [48, 154], [174, 95], [265, 75], [130, 48],
     [279, 23], [198, 48], [140, 25], [281, 136]]
  ];
  var lnodes0 = lnodesEp[0];
  // wi_stuff.c:226-262 animinfo tables {type, period, nanims, [x,y], data1}.
  // type: ANIM_ALWAYS=0 ANIM_RANDOM=1 ANIM_LEVEL=2. data1 = level trigger
  // for ANIM_LEVEL (wbs->next match). epsd1 anim 8 reuses anim 4's frames
  // (the gospel 'MONDO HACK', wi_stuff.c:1620).
  var animInfo = [
    [[0, 11, 3, 224, 104], [0, 11, 3, 184, 160], [0, 11, 3, 112, 136], [0, 11, 3, 72, 112],
     [0, 11, 3, 88, 96], [0, 11, 3, 64, 48], [0, 11, 3, 192, 40], [0, 11, 3, 136, 16],
     [0, 11, 3, 80, 16], [0, 11, 3, 64, 24]],
    [[2, 11, 1, 128, 136, 1], [2, 11, 1, 128, 136, 2], [2, 11, 1, 128, 136, 3],
     [2, 11, 1, 128, 136, 4], [2, 11, 1, 128, 136, 5], [2, 11, 1, 128, 136, 6],
     [2, 11, 1, 128, 136, 7], [2, 11, 3, 192, 144, 8], [2, 11, 1, 128, 136, 8]],
    [[0, 11, 3, 104, 168], [0, 11, 3, 40, 136], [0, 11, 3, 160, 96], [0, 11, 3, 104, 80],
     [0, 11, 3, 120, 32], [0, 8, 3, 40, 0]]
  ];

  // wi_stuff.c:233-244 epsd0animinfo: { ANIM_ALWAYS, TICRATE/3, 3, {x,y} }
  var epsd0anims = [[224, 104], [184, 160], [112, 136], [72, 112], [88, 96],
                    [64, 48], [192, 40], [136, 16], [80, 16], [64, 24]];

  // states (wi_stuff.c I_ScreenState enum): 0 None,1 StatCount,2 ShowNextLoc,3 NoState
  var state = 0;
  var bcnt = 0, acceleratestage = 0;
  var sp_state = 0, cnt_kills = -1, cnt_items = -1, cnt_secret = -1,
      cnt_time = -1, cnt_par = -1, cnt_pause = 0;
  var cnt = 0, snl_pointeron = false;
  var wbs = null;                   // wadmission_t equivalent (captured at exit)
  var anims = null;                 // per-anim {ctr, nexttic} runtime state

  var P = null;                     // name -> decoded patch
  var FB = null;                    // screens[0] (indexed)
  var BG = null;                    // screens[1] (WI_slamBackground source)
  var lut = null;                   // 256-entry fullbright LUT -> packed RGB

  function b64(s) {
    if (typeof atob === 'function') { var b = atob(s), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; }
    return new Uint8Array(Buffer.from(s, 'base64'));   // node tests
  }
  function patch(name) {
    if (!P) {
      P = {};
      // const INTERLUDE is a script-scope lexical (not a window property) —
      // reference bare in browser scope, global fallback covers node tests.
      var L = (typeof INTERLUDE !== 'undefined') ? INTERLUDE : global.INTERLUDE;
      var src = L.patches;
      for (var k in src) P[k] = { w: src[k][0], h: src[k][1], px: b64(src[k][2]), left: src[k][3], top: src[k][4] };
    }
    return P[name];
  }
  function buildLut() {
    // colormap table 0 (fullbright) of PLAYPAL[0], packed like engine PIX_LUT
    var A = (typeof ASSETS !== 'undefined') ? ASSETS : global.ASSETS;
    var pals = A.palettes || [A.palette];
    var pal = pals[0], cm = global.COLORMAPS;
    lut = new Uint32Array(256);
    for (var s = 0; s < 256; s++) {
      var idx = cm ? cm[s] : s;                        // table 0 maps s->s
      var c = pal[idx];
      lut[s] = 0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0];
    }
  }

  // V_DrawPatch onto the indexed screen (clip off-screen, skip post gaps)
  function drawPatch(x, y, p) {
    x -= p.left; y -= p.top;
    var x1 = x < 0 ? -x : 0, y1 = y < 0 ? -y : 0;
    var x2 = Math.min(p.w, SCREENWIDTH - x), y2 = Math.min(p.h, SCREENHEIGHT - y);
    for (var yy = y1; yy < y2; yy++) {
      var row = (y + yy) * SCREENWIDTH + x, src = yy * p.w;
      for (var xx = x1; xx < x2; xx++) {
        var c = p.px[src + xx];
        if (c !== TRANS) FB[row + xx] = c;
      }
    }
  }
  function slamBackground() { FB.set(BG); }            // WI_slamBackground

  // ---- WI_initAnimatedBack / WI_updateAnimatedBack / WI_drawAnimatedBack ----
  var epsd = 0;                       // wbs.epsd (0-biased episode)
  var commercial = false;             // gamemode == commercial for this run
  function animAnimIdx(i) {           // wi_stuff.c:1614 'MONDO HACK'
    return (epsd === 1 && i === 8) ? 4 : i;
  }
  function initAnimatedBack() {
    if (commercial || epsd > 2) return;                 // WI_initAnimatedBack guards
    anims = animInfo[epsd].map(function (a) {
      return { ctr: -1, nexttic: bcnt + 1 + (global.G.M_Random() % a[1]) };
    });
  }
  function updateAnimatedBack() {
    if (!anims || commercial || epsd > 2) return;
    var tbl = animInfo[epsd];
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i], t = tbl[i];
      if (bcnt !== a.nexttic) continue;
      if (t[0] === 0) {                                 // ANIM_ALWAYS
        if (++a.ctr >= t[2]) a.ctr = 0;
        a.nexttic = bcnt + t[1];
      } else if (t[0] === 1) {                          // ANIM_RANDOM (unused)
        a.ctr++;
        if (a.ctr === t[2]) { a.ctr = -1; a.nexttic = bcnt + 30 + (global.G.M_Random() % 100); }
        else a.nexttic = bcnt + t[1];
      } else {                                          // ANIM_LEVEL
        if (!(state === 1 && i === 7) && wbs.next === t[5]) {
          a.ctr++;
          if (a.ctr === t[2]) a.ctr--;
          a.nexttic = bcnt + t[1];
        }
      }
    }
  }
  function drawAnimatedBack() {
    if (!anims || commercial || epsd > 2) return;
    var tbl = animInfo[epsd];
    for (var i = 0; i < anims.length; i++) {
      var a = anims[i];
      // sprintf("WIA%d%.2d%.2d", epsd, anim, frame) — MONDO hack remaps j
      if (a.ctr >= 0) drawPatch(tbl[i][3], tbl[i][4],
        patch('WIA' + epsd + ('0' + animAnimIdx(i)).slice(-2) + ('0' + a.ctr).slice(-2)));
    }
  }

  // ---- WI_drawNum / WI_drawPercent / WI_drawTime (verbatim) -----------------
  function drawNum(x, y, n, digits) {
    var fontwidth = patch('WINUM0').w, neg;
    if (digits < 0) {
      if (!n) digits = 1;
      else { digits = 0; var temp = n; while (temp) { temp = (temp / 10) | 0; digits++; } }
    }
    neg = n < 0; if (neg) n = -n;
    if (n === 1994) return 0;                           // "n/a" sentinel
    while (digits--) { x -= fontwidth; drawPatch(x, y, patch('WINUM' + (n % 10))); n = (n / 10) | 0; }
    if (neg) { x -= 8; drawPatch(x, y, patch('WIMINUS')); }
    return x;
  }
  function drawPercent(x, y, p) {
    if (p < 0) return;
    drawPatch(x, y, patch('WIPCNT'));
    drawNum(x, y, p, -1);
  }
  function drawTime(x, y, t) {
    if (t < 0) return;
    if (t <= 61 * 59) {
      var div = 1;
      do {
        var n = ((t / div) | 0) % 60;
        x = drawNum(x, y, n, 2) - patch('WICOLON').w;
        div *= 60;
        if (div === 60 || (t / div) | 0) drawPatch(x, y, patch('WICOLON'));
      } while ((t / div) | 0);
    } else {
      var s = patch('WISUCKS');
      drawPatch(x - s.w, y, s);                          // "sucks"
    }
  }

  // ---- WI_drawOnLnode --------------------------------------------------------
  function drawOnLnode(n, cs) {
    var lnodes = lnodesEp[epsd] || lnodesEp[0];
    var fits = false, i = 0;
    do {
      var c = cs[i], nx = lnodes[n][0], ny = lnodes[n][1];
      var left = nx - c.left, top = ny - c.top;
      var right = left + c.w, bottom = top + c.h;
      if (left >= 0 && right < SCREENWIDTH && top >= 0 && bottom < SCREENHEIGHT) fits = true;
      else i++;
    } while (!fits && i !== 2);
    if (fits && i < 2) drawPatch(lnodes[n][0], lnodes[n][1], cs[i]);
  }

  // ---- <Levelname> Finished! / Entering <Levelname> -------------------------
  function levelNamePatch(n) {           // WI_loadData lnames[]
    return commercial ? patch('CWILV' + ('0' + n).slice(-2))
                      : patch('WILV' + epsd + n);
  }
  function drawLF() {
    var y = WI_TITLEY;
    var l = levelNamePatch(wbs.last);
    drawPatch(((SCREENWIDTH - l.w) / 2) | 0, y, l);
    y += (5 * l.h) / 4 | 0;
    var f = patch('WIF');
    drawPatch(((SCREENWIDTH - f.w) / 2) | 0, y, f);
  }
  function drawEL() {
    var y = WI_TITLEY;
    var e = patch('WIENTER');
    drawPatch(((SCREENWIDTH - e.w) / 2) | 0, y, e);
    var l = levelNamePatch(wbs.next);
    y += (5 * l.h) / 4 | 0;
    drawPatch(((SCREENWIDTH - l.w) / 2) | 0, y, l);
  }

  // ---- StatCount (WI_initStats / WI_updateStats / WI_drawStats) -------------
  function initStats() {
    state = 1; acceleratestage = 0; sp_state = 1;
    cnt_kills = cnt_items = cnt_secret = -1;
    cnt_time = cnt_par = -1;
    cnt_pause = TICRATE;
    initAnimatedBack();
  }
  function updateStats() {
    updateAnimatedBack();
    var pk = (wbs.skills * 100 / wbs.maxkills) | 0;
    var pi = (wbs.sitems * 100 / wbs.maxitems) | 0;
    var ps = (wbs.ssecret * 100 / wbs.maxsecret) | 0;
    if (acceleratestage && sp_state !== 10) {
      acceleratestage = 0;
      cnt_kills = pk; cnt_items = pi; cnt_secret = ps;
      cnt_time = (wbs.stime / TICRATE) | 0; cnt_par = (wbs.partime / TICRATE) | 0;
      sfx('barexp');
      sp_state = 10;
    }
    if (sp_state === 2) {
      cnt_kills += 2;
      if (!(bcnt & 3)) sfx('pistol');
      if (cnt_kills >= pk) { cnt_kills = pk; sfx('barexp'); sp_state++; }
    } else if (sp_state === 4) {
      cnt_items += 2;
      if (!(bcnt & 3)) sfx('pistol');
      if (cnt_items >= pi) { cnt_items = pi; sfx('barexp'); sp_state++; }
    } else if (sp_state === 6) {
      cnt_secret += 2;
      if (!(bcnt & 3)) sfx('pistol');
      if (cnt_secret >= ps) { cnt_secret = ps; sfx('barexp'); sp_state++; }
    } else if (sp_state === 8) {
      if (!(bcnt & 3)) sfx('pistol');
      cnt_time += 3;
      // NOTE: `x >= a / b | 0` would parse as `(x >= a/b) | 0` in JS (>= binds
      // tighter than |), silently disabling the clamp — C's integer division
      // has no such trap. Parenthesize the truncation. (Live E2M1 intermission
      // hung here: cnt_time climbed unclamped, sp_state 8 never advanced.)
      if (cnt_time >= ((wbs.stime / TICRATE) | 0)) cnt_time = (wbs.stime / TICRATE) | 0;
      cnt_par += 3;
      if (cnt_par >= ((wbs.partime / TICRATE) | 0)) {
        cnt_par = (wbs.partime / TICRATE) | 0;
        if (cnt_time >= ((wbs.stime / TICRATE) | 0)) { sfx('barexp'); sp_state++; }
      }
    } else if (sp_state === 10) {
      if (acceleratestage) {
        sfx('sgcock');
        if (commercial) initNoState();     // wi_stuff.c:1419 commercial skips ShowNextLoc
        else initShowNextLoc();
      }
    } else if (sp_state & 1) {
      if (!--cnt_pause) { sp_state++; cnt_pause = TICRATE; }
    }
  }
  function drawStats() {
    var lh = (3 * patch('WINUM0').h) / 2 | 0;           // lh = 3*tallnum height / 2
    slamBackground();
    drawAnimatedBack();
    drawLF();
    drawPatch(SP_STATSX, SP_STATSY, patch('WIOSTK'));
    drawPercent(SCREENWIDTH - SP_STATSX, SP_STATSY, cnt_kills);
    drawPatch(SP_STATSX, SP_STATSY + lh, patch('WIOSTI'));
    drawPercent(SCREENWIDTH - SP_STATSX, SP_STATSY + lh, cnt_items);
    drawPatch(SP_STATSX, SP_STATSY + 2 * lh, patch('WISCRT2'));
    drawPercent(SCREENWIDTH - SP_STATSX, SP_STATSY + 2 * lh, cnt_secret);
    drawPatch(SP_TIMEX, SP_TIMEY, patch('WITIME'));
    drawTime(SCREENWIDTH / 2 - SP_TIMEX, SP_TIMEY, cnt_time);
    drawPatch(SCREENWIDTH / 2 + SP_TIMEX, SP_TIMEY, patch('WIPAR'));
    drawTime(SCREENWIDTH - SP_TIMEX, SP_TIMEY, cnt_par);
  }

  // ---- ShowNextLoc / NoState -------------------------------------------------
  function initShowNextLoc() {
    state = 2; acceleratestage = 0; cnt = SHOWNEXTLOCDELAY * TICRATE;
    initAnimatedBack();
  }
  function updateShowNextLoc() {
    updateAnimatedBack();
    if (!--cnt || acceleratestage) initNoState();
    else snl_pointeron = (cnt & 31) < 20;
  }
  function drawShowNextLoc() {
    slamBackground();
    drawAnimatedBack();
    if (commercial) {
      // commercial: no splat map (wi_stuff.c:782), only the EL banner below
    } else if (epsd > 2) {
      // epsd 3 (retail E4): WI_drawEL and return — no lnodes for episode 4
    } else {
      var last = (wbs.last === 8) ? wbs.next - 1 : wbs.last;
      var splat = patch('WISPLAT');
      for (var i = 0; i <= last; i++) drawOnLnode(i, [splat]);
      if (wbs.didsecret) drawOnLnode(8, [splat]);
      if (snl_pointeron) drawOnLnode(wbs.next, [patch('WIURH0'), patch('WIURH1')]);
    }
    if (!commercial || wbs.next !== 30) drawEL();    // wi_stuff.c:806
  }
  function initNoState() { state = 3; acceleratestage = 0; cnt = 10; }
  function updateNoState() {
    updateAnimatedBack();
    if (!--cnt) { state = 0; if (onDone) onDone(); }    // G_WorldDone
  }
  function drawNoState() {
    slamBackground();
    drawAnimatedBack();
    drawEL();
  }

  function sfx(name) {
    if (global.Snd && global.Snd.S_StartSound) global.Snd.S_StartSound(null, global.Snd.sfx['sfx_' + name]);
  }

  // WI_checkForAccelerate: fresh BT_ATTACK (1) / BT_USE (2) press edges.
  // (Port: P_Ticker is frozen during intermission, so the edges are tracked
  // here from the raw ticcmd buttons instead of player->attackdown/usedown.)
// prevAtk/prevUse deliberately SURVIVE WI_Start: gospel attackdown/usedown
// live in player_t and are never reset entering the intermission, so a key
// still held from pressing the exit switch must NOT read as a fresh press
// (that instant-accelerated the whole tally — totals shown, no count-up).
  var prevAtk = 0, prevUse = 0;
  function checkForAccelerate(buttons) {
    var atk = buttons & 1, use = buttons & 2;
    if (atk && !prevAtk) acceleratestage = 1;
    if (use && !prevUse) acceleratestage = 1;
    prevAtk = atk; prevUse = use;
  }

  var onDone = null;
  var started = false;

  function Start(wadmission, doneCb) {
    wbs = wadmission; onDone = doneCb;
    epsd = wbs.epsd || 0;
    commercial = (typeof gamemode !== 'undefined' ? gamemode : globalThis.gamemode) === 'commercial';
    FB = new Uint8Array(SCREENWIDTH * SCREENHEIGHT);
    BG = new Uint8Array(SCREENWIDTH * SCREENHEIGHT);
    buildLut();
    // WI_loadData: bg = INTERPIC (commercial, or epsd 3 retail) else WIMAP{epsd}
    BG.fill(0);
    var bgName = (commercial || (globalThis.gamemode === 'retail' && epsd === 3))
      ? 'INTERPIC' : 'WIMAP' + epsd;
    var bgp = patch(bgName) || patch('WIMAP0');
    drawPatchTo(BG, 0, 0, bgp);
    bcnt = 0; acceleratestage = 0; snl_pointeron = false;
    // Seed the press-edge trackers from gospel attackdown/usedown: exiting
    // with USE held sets usedown=true during the LAST level tic, and the
    // port's P_Ticker (which clears usedown on release) is frozen during the
    // intermission — without the seed that held key reads as a fresh press
    // on tic 1 and instant-accelerates the whole tally (totals shown, no
    // count-up; user-reported).
    var pl0 = global.G && global.G.player;
    prevAtk = pl0 && pl0.attackdown ? 1 : 0;
    prevUse = pl0 && pl0.usedown ? 1 : 0;
    // WI_Ticker's bcnt==1 branch plays intermission music on the first tic;
    // fire it now so music starts immediately (same frame as vanilla).
    if (global.Snd && global.Snd.S_ChangeMusic)
      global.Snd.S_ChangeMusic(commercial ? global.Snd.mus.mus_dm2int
                                          : global.Snd.mus.mus_inter, true);
    initStats();
    started = true;
  }
  function drawPatchTo(dst, x, y, p) {
    var save = FB; FB = dst; drawPatch(x, y, p); FB = save;
  }

  function Ticker(buttons) {
    bcnt++;                                             // WI_Ticker
    checkForAccelerate(buttons || 0);
    if (state === 1) updateStats();
    else if (state === 2) updateShowNextLoc();
    else if (state === 3) updateNoState();
  }
  function Drawer() {
    if (!started) return;
    if (state === 1) drawStats();
    else if (state === 2) drawShowNextLoc();
    else if (state === 3) drawNoState();
    var vb = global.viewbuffer;
    if (vb) for (var i = 0; i < FB.length; i++) vb[i] = lut[FB[i]];
  }

  global.WI = {
    Start: Start, Ticker: Ticker, Drawer: Drawer,
    ResetPatchCache: function () { P = null; },   // WAD hot-swap
    pars: pars,
    get state() { return state; },
    get sp() { return sp_state; },
    get counts() { return { k: cnt_kills, i: cnt_items, s: cnt_secret, t: cnt_time, p: cnt_par, pause: cnt_pause, acc: acceleratestage }; },
    get bcnt() { return bcnt; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
