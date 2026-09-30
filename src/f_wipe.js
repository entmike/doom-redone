'use strict';
// ============================================================================
// f_wipe.js — port of f_wipe.c wipe_Melt (the level→intermission "bleeding"
// transition) used by the D_Display driver in main.js (d_main.c:222-345).
//
// Vanilla melts between screens[2] (start), screens[3] (end) writing into
// screens[0]. Screens there are 16-bit pixels, and the col-major xform packs
// the 320-px row as 160 elements — i.e. each element is 2 screen pixels.
// This port's framebuffer is Uint32 RGBA: element (i) of row r packs pixels
// (2i, 2i+1) directly, so wipe_shittyColMajorXform is implicit — copy the
// one Uint32 (2 pixels) per row/column. Output is pixel-identical.
//
// M_Random comes from engine.js (global), matching f_wipe.c's m_random use.
// ============================================================================
(function (W) {
  var WIDTH = 320, PAIRS = 160, HEIGHT = 200;
  var y = null;                    // per-column drip position (<0: pre-delay)
  var scrStart = null, scrEnd = null;

  // wipe_initMelt (f_wipe.c): initial column positions, random walk −15..0
  W.initMelt = function (start, end) {
    scrStart = start;              // never mutated after init (vanilla)
    scrEnd = end;
    y = new Int32Array(PAIRS);
    y[0] = -(M_Random() % 16);
    for (var i = 1; i < PAIRS; i++) {
      var r = (M_Random() % 3) - 1;
      y[i] = y[i - 1] + r;
      if (y[i] > 0) y[i] = 0;
      else if (y[i] === -16) y[i] = -15;
    }
  };

  // Vanilla screens are 16-bit; its col-major xform packs the 320-px row as
  // 160 elements — one element = 2 screen pixels = TWO adjacent Uint32 RGBA
  // entries here. Copy both entries per element: pixel-identical output.
  W.doMelt = function (scr, tics) {
    var done = true;
    while (tics--) {
      for (var i = 0; i < PAIRS; i++) {
        if (y[i] < 0) {
          y[i]++; done = false;
        } else if (y[i] < HEIGHT) {
          var dy = (y[i] < 16) ? y[i] + 1 : 8;
          if (y[i] + dy >= HEIGHT) dy = HEIGHT - y[i];
          // (1) end-screen rows y..y+dy-1 of column i drip into dest rows y..
          for (var j = 0; j < dy; j++) {
            var b = (y[i] + j) * WIDTH + i * 2;
            scr[b] = scrEnd[b]; scr[b + 1] = scrEnd[b + 1];
          }
          y[i] += dy;
          // (2) remaining rows: start-screen top rows scroll down to fill
          //     dest rows y..HEIGHT-1 (vanilla reads start rows 0..height-y-1)
          for (var k = 0; y[i] + k < HEIGHT; k++) {
            var s = k * WIDTH + i * 2, d = (y[i] + k) * WIDTH + i * 2;
            scr[d] = scrStart[s]; scr[d + 1] = scrStart[s + 1];
          }
          done = false;
        }
      }
    }
    return done;
  };
})(typeof window !== 'undefined' ? window.Wipe = window.Wipe || {} : globalThis.Wipe = globalThis.Wipe || {});
