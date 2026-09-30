// hu.js — heads-up display port: hu_stuff.c + hu_lib.c (SText message
// widget + text line primitives). The intermission bundle already carries
// the verbatim STCFN033..095 font patches (hu_stuff.c:406 loads exactly
// '!' (33) .. '_' (95) = HU_FONTSTART..HU_FONTEND).
//
// Vanilla pipeline (g_game.c:733 GS_LEVEL): P_Ticker, ST_Ticker, AM_Ticker,
// HU_Ticker — HU_Ticker moves players[consoleplayer].message into the
// w_message SText widget for HU_MSGTIMEOUT = 4*TICRATE tics; D_Display
// draws it with HU_Drawer (d_main.c:271) after R_RenderPlayerView.
//
// Documented deviations from 1.10:
//  - No chat input / HU_Erase: the port redraws the whole framebuffer each
//    frame (engine fills, then blits the bar), so stale-line erasure and the
//    IText chat widget / netgame chat queue (HU_Ticker netgame branch) have
//    nothing to do in a single-player browser port.
//  - w_title (automap title line) lives in the side-panel automap instead.
'use strict';
(function (global) {
  var SCREENWIDTH = 320;
  var TRANS = 255;
  var HU_FONTSTART = 33;          // '!'   hu_stuff.h:30
  var HU_FONTEND = 95;            // '_'   hu_stuff.h:31
  var HU_MAXLINELENGTH = 80;      // hu_lib.h:37
  var HU_MSGTIMEOUT = 4 * 35;     // 4*TICRATE  hu_stuff.h:44
  var HU_MSGX = 0, HU_MSGY = 0;   // hu_stuff.h:39-40
  var HU_MSGHEIGHT = 1;           // hu_stuff.h:42 (HU_MSGWIDTH 64 unused w/o wrap)

  var font = null;                // 63 decoded STCFN patches
  var lut = null;                 // fallback LUT (only if PIX_LUT absent)
  // V_DrawPatchDirect draws through the FG buffer's current video palette;
  // in this port that is the engine's PIX_LUT table 0, which hud.js keeps in
  // sync with ST_doPaletteStuff (pickup flash / pain red / radiation suit).
  function glyphLut() {
    if (global.PIX_LUT) return global.PIX_LUT;
    if (!lut) {
      var pal = ASSETS.palette || INTERLUDE.palette;
      lut = new Uint32Array(256);
      for (var s = 0; s < 256; s++) {
        var c = pal.slice(s * 3, s * 3 + 3);
        lut[s] = 0xff000000 | (c[2] << 16) | (c[1] << 8) | c[0];
      }
    }
    return lut;
  }
  function b64decode(b64) {
    if (typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(b64, 'base64'));
    var bin = atob(b64), u = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  }
  // HU_Init: hu_stuff.c:406-410  sprintf("STCFN%.3d", '!'+i)
  function HU_Init() {
    if (font) return;
    var f = [];
    for (var i = 0; i <= HU_FONTEND - HU_FONTSTART; i++) {
      var name = 'STCFN' + String(HU_FONTSTART + i).padStart(3, '0');  // %.3d
      var d = INTERLUDE.patches[name];
      if (!d) throw new Error('hu.js: missing ' + name);
      f.push({ w: d[0], h: d[1], px: b64decode(d[2]), left: d[3], top: d[4] });
    }
    font = f;                                               // commit only on success
  }

  // ---- hu_lib.c textline --------------------------------------------------
  function makeTextLine(x, y) {
    return { x: x, y: y, len: 0, l: '', needsupdate: 4 };
  }
  // Width a line will occupy under drawTextLine's advance rules (glyph w or
  // 4px for space/out-of-range), used for centered lines.
  function measureTextLine(l) {
    var x = 0;
    for (var i = 0; i < l.len; i++) {
      var c = l.l.charCodeAt(i);
      if (c >= 97 && c <= 122) c -= 32;
      x += (c !== 32 && c >= HU_FONTSTART && c <= HU_FONTEND)
        ? font[c - HU_FONTSTART].w : 4;
    }
    return x;
  }
  // HUlib_addCharToTextLine (hu_lib.c:70): append char, mark needsupdate=4
  function addChar(t, ch) {
    if (t.len === HU_MAXLINELENGTH) return false;
    t.l += String.fromCharCode(ch);
    t.len++;
    t.needsupdate = 4;
    return true;
  }
  function addString(t, s) {
    if (!s) return;
    for (var i = 0; i < s.length; i++) addChar(t, s.charCodeAt(i) & 0xff);
  }
  // HUlib_drawTextLine (hu_lib.c:102): toupper each char; ' ' and chars
  // outside sc..'_' advance x without drawing (space 8px via ' '->x+=? C:
  // unknown chars x+=4; ' ' falls through to the width lookup? No:
  // c != ' ' && c>=sc && c<='_' -> draw patch; else x += 4. BUT ' ' == 32 <
  // sc==33, so spaces take the x+=4 branch.)
  function drawTextLine(l) {
    var vb = global.viewbuffer;
    if (!vb) return;
    // DEVIATION support: centered line (secret-reveal) — recompute from the
    // text each draw so it stays centered regardless of content.
    var x = l.center ? ((SCREENWIDTH - measureTextLine(l)) / 2) | 0 : l.x;
    // vertical: center the font block in the 200-row screen too
    var baseY = l.center ? ((200 - font[0].h) / 2) | 0 : l.y;
    for (var i = 0; i < l.len; i++) {
      var c = l.l.charCodeAt(i);
      if (c >= 97 && c <= 122) c -= 32;                    // toupper (C locale)
      if (c !== 32 && c >= HU_FONTSTART && c <= HU_FONTEND) {
        var p = font[c - HU_FONTSTART];
        if (x + p.w > SCREENWIDTH) break;                  // hu_lib.c:119
        var lutv = glyphLut();
        var px = x - p.left, py = baseY - p.top;
        for (var yy = 0; yy < p.h; yy++) {
          var row = (py + yy) * SCREENWIDTH + px;
          if (py + yy < 0 || py + yy >= 200) continue;
          var src = yy * p.w;
          for (var xx = 0; xx < p.w; xx++) {
            var col = px + xx;
            if (col < 0 || col >= SCREENWIDTH) continue;
            var v = p.px[src + xx];
            if (v !== TRANS) vb[row + xx] = lutv[v];
          }
        }
        x += p.w;                                          // hu_lib.c:122
      } else {
        x += 4;                                            // hu_lib.c:126
        if (x >= SCREENWIDTH) break;
      }
    }
  }

  // ---- hu_lib.c SText (message queue) --------------------------------------
  // HUlib_initSText (hu_lib.c:168): h lines stacked upward by (font height+1).
  // C stores s->on as a POINTER to message_on; model that indirection here by
  // keeping a getter rather than a copied bool (drawSText must observe the
  // live flag HU_Ticker sets).
  function makeSText(x, y, h) {
    var lines = [];
    var lh = font[0].h + 1;
    for (var i = 0; i < h; i++) lines.push(makeTextLine(x, y - i * lh));
    return { h: h, cl: 0, on: function () { return message_on; }, l: lines };
  }
  function addLine(s) {
    if (++s.cl === s.h) s.cl = 0;
    s.l[s.cl].len = 0; s.l[s.cl].l = ''; s.l[s.cl].center = false;
    for (var i = 0; i < s.h; i++) s.l[i].needsupdate = 4;
  }
  // HUlib_addMessageToSText (hu_lib.c:217)
  function addMessage(s, prefix, msg) {
    addLine(s);
    addString(s.l[s.cl], prefix);
    addString(s.l[s.cl], msg);
  }
  function drawSText(s) {
    if (!s.on()) return;                                    // hu_lib.c:246 (!*s->on)
    for (var i = 0; i < s.h; i++) {
      var idx = s.cl - i;
      if (idx < 0) idx += s.h;
      drawTextLine(s.l[idx]);
    }
  }

  // ---- hu_stuff.c module state ---------------------------------------------
  var w_message = null;
  var w_title = null;                 // hu_stuff.c:91 — automap title line
  var message_on = false, message_counter = 0;
  var message_dontfuckwithme = false, message_nottobefuckedwith = false;

  // hu_stuff.c:115 mapnames[] — d_englsh.h HUSTR_E1M1.. (shareware/retail
  // gamemode branch, hu_stuff.c:49 #define HU_TITLE)
  var mapnames = [
    'E1M1: Hangar', 'E1M2: Nuclear Plant', 'E1M3: Toxin Refinery',
    'E1M4: Command Control', 'E1M5: Phobos Lab', 'E1M6: Central Processing',
    'E1M7: Computer Station', 'E1M8: Phobos Anomaly', 'E1M9: Military Base',
    'E2M1: Deimos Anomaly', 'E2M2: Containment Area', 'E2M3: Refinery',
    'E2M4: Deimos Lab', 'E2M5: Command Center', 'E2M6: Halls of the Damned',
    'E2M7: Spawning Vats', 'E2M8: Tower of Babel', 'E2M9: Fortress of Mystery',
    'E3M1: Hell Keep', 'E3M2: Slough of Despair', 'E3M3: Pandemonium',
    'E3M4: House of Pain', 'E3M5: Unholy Cathedral', 'E3M6: Mt. Erebus',
    'E3M7: Limbo', 'E3M8: Dis', 'E3M9: Warrens',
    'E4M1: Hell Beneath', 'E4M2: Perfect Hatred', 'E4M3: Sever The Wicked',
    'E4M4: Unruly Evil', 'E4M5: They Will Repent', 'E4M6: Against Thee Wickedly',
    'E4M7: And Hell Followed', 'E4M8: Unto The Cruel', 'E4M9: Fear',
    'NEWLEVEL', 'NEWLEVEL', 'NEWLEVEL', 'NEWLEVEL', 'NEWLEVEL',
    'NEWLEVEL', 'NEWLEVEL', 'NEWLEVEL', 'NEWLEVEL'
  ];
  // hu_stuff.c:115 mapnames2[] — d_englsh.h HUSTR_1..HUSTR_32 (DOOM 2,
  // HU_TITLE2). The original doom2.wad table; TNT/PLUTONIA swap only the
  // names via their own HUSTR lumps (out of scope; documented deviation).
  var mapnames2 = [
    'level 1: entryway', 'level 2: underhalls', 'level 3: the gantlet',
    'level 4: the focus', 'level 5: the waste tunnels', 'level 6: the crusher',
    'level 7: dead simple', 'level 8: tricks and traps', 'level 9: the pit',
    'level 10: refueling base', "level 11: 'o' of destruction!",
    'level 12: the factory', 'level 13: downtown', 'level 14: the inmost dens',
    'level 15: industrial zone', 'level 16: suburbs', 'level 17: tenements',
    'level 18: the courtyard', 'level 19: the citadel', 'level 20: gotcha!',
    'level 21: nirvana', 'level 22: the catacombs', "level 23: barrels o' fun",
    'level 24: the chasm', 'level 25: bloodfalls', 'level 26: the abandoned mines',
    'level 27: monster condo', 'level 28: the spirit world', 'level 29: the living end',
    'level 30: icon of sin', 'level 31: wolfenstein', 'level 32: grosse'
  ];

  // HU_Start (hu_stuff.c:419): fresh widget per level start
  function HU_Start() {
    HU_Init();
    w_message = makeSText(HU_MSGX, HU_MSGY, HU_MSGHEIGHT);
    // w_title line: HU_TITLEX/Y, text = mapnames[(episode-1)*9 + map-1]
    // (DOOM 2: HU_TITLE2 = mapnames2[gamemap-1], hu_stuff.c:465)
    w_title = makeTextLine(0, 167 - font[0].h);   // HU_TITLEX=0, HU_TITLEY
    var commercial = global.gamemode === 'commercial';
    var s = commercial
      ? (mapnames2[((global.G && G.gamemap || 1) - 1)] || 'level ?')
      : (mapnames[((global.G && G.gameepisode || 1) - 1) * 9 +
                  ((global.G && G.gamemap || 1) - 1)] || 'NEWLEVEL');
    addString(w_title, s);
    message_on = false;
    message_counter = 0;
    message_dontfuckwithme = false;
    message_nottobefuckedwith = false;
  }

  // HU_Ticker (hu_stuff.c:505) — single-player branch (netgame chat skipped)
  function HU_Ticker(plr, showMessages) {
    if (!w_message) HU_Start();
    // tick down message counter if message is up
    if (message_counter && !--message_counter) {
      message_on = false;
      message_nottobefuckedwith = false;
    }
    if (showMessages || message_dontfuckwithme) {
      // hu_stuff.c:521 — both branches identical in vanilla (chat sets
      // message_dontfuckwithme); pickup messages queue while an un-fuckable
      // (chat) message is up only when allowed
      if ((plr.message && !message_nottobefuckedwith) ||
          (plr.message && message_dontfuckwithme)) {
        addMessage(w_message, null, plr.message);
        // DEVIATION: the secret-reveal line draws screen-centered
        // (user-requested); every other message stays vanilla left-x.
        w_message.l[w_message.cl].center = global.G && global.G.MSG &&
          plr.message === global.G.MSG.SECRET;
        plr.message = null;
        message_on = true;
        message_counter = HU_MSGTIMEOUT;
        message_nottobefuckedwith = message_dontfuckwithme;
        message_dontfuckwithme = false;
      }
    }
  }

  // HU_Drawer (hu_stuff.c:486) — message + automap title line
  function HU_Drawer() {
    if (!w_message) return;
    drawSText(w_message);
    if (global.AM && global.AM.active() && w_title)
      drawTextLine(w_title);              // hu_stuff.c:491
  }

  global.HU = {
    HU_Start: HU_Start,
    HU_Ticker: HU_Ticker,
    HU_Drawer: HU_Drawer,
    ResetFontCache: function () { font = null; },   // WAD hot-swap: HU_Start re-decodes
    // test/debug accessors
    _state: function () { return { on: message_on, counter: message_counter }; },
    _widgetLine: function () { return w_message ? w_message.l[w_message.cl].l : null; },
    _title: function () { return w_title ? w_title.l : ''; }
  };
})(typeof window !== 'undefined' ? window : globalThis);
