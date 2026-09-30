// tools/test-automap.js — headless test for am_map.js (in-game automap).
// Boots WAD+tables+engine+game, loads E1M1 from the binary WAD,
// starts the map, renders, and asserts vanilla am_map.c behavior:
//   - Tab enters/exits; automapactive mirrors G.automapactive
//   - scale init: FD(min, .7) clamped by max (AM_LevelInit)
//   - window centered on player; follow mode tracks the player
//   - walls drawn: red WALLCOLORS pixels appear once lines are ML_MAPPED
//   - allmap (powerup 4) draws GRAYS+3 for unmapped lines
//   - zoom clamps at min/max scale; '0' go-big saves/restores
//   - marks: 'm' stores center point, 'c' clears; message strings gospel
//   - grid 'g' toggles; follow 'f' toggles with AMSTR messages
//   - cheat seq idkfa-like amap 'iddqd'-adjacent: b2 26 26 2e = "idfa"? no —
//     AM cheat is IDDT (0xb2 0x26 0x26 0x2e scrambled 'i','d','d','t')
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const ctx = vm.createContext({ console, Buffer, performance: { now: () => 0 } });

require('./wadboot-host')(ctx);   // WAD-derived bundles (replaces deleted assets/*.js)
for (const f of ['src/tables.js', 'src/engine.js', 'src/game.js', 'src/am_map.js'])
  vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });

ctx.__map = JSON.parse(require('./wadboot-host').mapJSON(ctx, 'E1M1'));
const G = new Proxy({}, { get: (_, k) => ctx[k], set: (_, k, v) => { ctx[k] = v; return true; } });

let failures = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok   -', name);
  else { failures++; console.log('FAIL -', name, extra === undefined ? '' : JSON.stringify(extra)); }
}
const run = e => vm.runInContext(e, ctx);
const AM = run('AM');

// ---- boot a level (same as test-game.js: G_InitNew loads the level) --------
G.currentMapJson = ctx.__map;
G.onLevelExit = () => {};
run('G_InitNew(2)');                    // sk_medium
check('player mo exists', !!(G.player && G.player.mo));

const FU = 65536;
// seed framebuffer
ctx.viewbuffer = new Uint32Array(320 * 200);

// ---- enter map with Tab (9) --------------------------------------------------
check('Tab enters automap', AM.Responder(9) === true && AM.active() && G.automapactive === true);
const st0 = AM._state();
check('bar refresh queued on enter', AM.takeBarRefresh() === true);
// AM_LevelInit: scale = FD(min, .7*FU) unless > max → min
const FD = (a, b) => run(`FixedDiv(${a},${b})`);
const expect = Math.min(FD(st0.min_scale_mtof, Math.floor(0.7 * FU)), st0.max_scale_mtof) === st0.min_scale_mtof
  ? st0.min_scale_mtof : FD(st0.min_scale_mtof, Math.floor(0.7 * FU));
// C clamps: if (scale > max) scale = min
check('initial scale matches AM_LevelInit',
  st0.scale_mtof === (FD(st0.min_scale_mtof, Math.floor(0.7 * FU)) > st0.max_scale_mtof ? st0.min_scale_mtof : FD(st0.min_scale_mtof, Math.floor(0.7 * FU))),
  { scale: st0.scale_mtof, min: st0.min_scale_mtof, max: st0.max_scale_mtof });
check('followplayer default', st0.follow === 1);
// window must be centered on the player: player map coords map to fb center
{
  const p = G.player.mo;
  const cx = run(`(function(){var s=AM._state();return ${0} + ((FixedMul(${p.x} - s.m_x, s.scale_mtof) >> 16))})()`);
  const cy = run(`(function(){var s=AM._state();return 168 - ((FixedMul(${p.y} - s.m_y, s.scale_mtof) >> 16))})()`);
  check('player centered in window (CXMTOF/CYMTOF)', Math.abs(cx - 160) <= 2 && Math.abs(cy - 84) <= 2, { cx, cy });
}

// ---- ticker + drawer paint ----------------------------------------------------
AM.Ticker();
AM.Drawer();
// count nonblack pixels (map must paint SOMETHING — player arrow alone is >30 px)
function countPix(pred) {
  const vb = ctx.viewbuffer; let n = 0;
  for (let y = 0; y < 168; y++) for (let x = 0; x < 320; x++)
    if (pred(vb[y * 320 + x])) n++;
  return n;
}
const redIdx = 256 - 5 * 16, whiteIdx = 256 - 47, gray3 = 6 * 16 + 3;
// PIX_LUT is Int32Array; viewbuffer Uint32Array — wrap unsigned
const redRGB = ctx.PIX_LUT[redIdx] >>> 0, whiteRGB = ctx.PIX_LUT[whiteIdx] >>> 0, gray3RGB = ctx.PIX_LUT[gray3] >>> 0;
check('drawer painted non-black', countPix(p => p !== 0xff000000) > 5, countPix(p => p !== 0xff000000));
// at full-map-entry zoom (~0.085x) the 32-unit arrow is ~3 px — gospel tiny
check('player arrow white pixels', countPix(p => p === whiteRGB) >= 3, countPix(p => p === whiteRGB));

// unmapped walls: E1M1 fresh level — mapped lines are only those the player
// shot at (P_LoadLineDefs doesn't pre-map). allmap off + nothing mapped →
// red wall pixels may be ZERO. That's gospel: check GRAYS+3 also zero, then
// force pw_allmap and expect non-gray3 zero.
let reds = countPix(p => p === redRGB);
run('G.players[0].powers[4] = 1');    // pw_allmap
AM.Drawer();
let gray3s = countPix(p => p === gray3RGB);
check('allmap draws GRAYS+3 wall pixels', gray3s > 100, { reds, gray3s });

// ML_MAPPED lines draw WALLCOLORS red
run(`linedefs[0].flags |= 256; linedefs[1].flags |= 256; linedefs[2].flags |= 256`);
AM.Drawer();
check('ML_MAPPED draws red walls', countPix(p => p === redRGB) > 0, countPix(p => p === redRGB));
run('G.players[0].powers[4] = 0');

// ---- follow mode tracks player -------------------------------------------------
const s1 = AM._state();
const px = G.player.mo.x, py = G.player.mo.y;
// player center should be at screen center: CXMTOF(px)≈160, CYMTOF(py)≈84
// recompute inline
const cx = run(`(function(){var s=AM._state();return null})()`);
// simplest: move player far, tick, expect window center follows
G.player.mo.x = px + 10 * FU; G.player.mo.y = py + 10 * FU;
AM.Ticker();
const s2 = AM._state();
check('follow moves window', s2.m_x !== s1.m_x || s2.m_y !== s1.m_y);
G.player.mo.x = px; G.player.mo.y = py;

// ---- zoom clamps ----------------------------------------------------------------
AM.Responder(0x3d);                    // '=' zoom in
for (let i = 0; i < 400; i++) AM.Ticker();
const sIn = AM._state();
check('zoom-in clamps at max_scale_mtof', sIn.scale_mtof <= sIn.max_scale_mtof * 1.001, sIn.scale_mtof);
AM.OnKeyUp(0x3d);
AM.Responder(0x2d);                    // '-' zoom out
for (let i = 0; i < 600; i++) AM.Ticker();
const sOut = AM._state();
check('zoom-out clamps at min-scale path', sOut.scale_mtof >= sOut.min_scale_mtof ||
      sOut.scale_mtof === sOut.min_scale_mtof, sOut.scale_mtof);
AM.OnKeyUp(0x2d);

// ---- '0' go-big save/restore ------------------------------------------------------
const sPre = AM._state();
AM.Responder(48);                       // bigstate on → minOutWindowScale
const sBig = AM._state();
// C: minOutWindowScale sets scale = min_scale_mtof — BUT AM_activateNewScale
// then re-derives nothing (scale stays); clamp check allows either the exact
// min OR the clamped min path result (identical): assert equals min.
check('0 go-big zooms to min scale', sBig.scale_mtof === sBig.min_scale_mtof && sBig.big === 1, sBig.scale_mtof);
AM.Responder(48);                       // restore
const sRest = AM._state();
check('0 restores saved scale', sRest.scale_mtof === sPre.scale_mtof, sRest.scale_mtof);

// ---- follow/grid/mark messages -----------------------------------------------------
AM.Responder(102);                      // 'f'
check('f toggles follow OFF + msg', AM._state().follow === 0 && G.player.message === 'Follow Mode OFF');
AM.Ticker();                            // consume into HU? message read directly
AM.Responder(102);
check('f back ON + msg', AM._state().follow === 1 && G.player.message === 'Follow Mode ON');
AM.Responder(103);                      // 'g'
check('g grid + msg', AM._state().grid === 1 && G.player.message === 'Grid ON');
AM.Responder(99);                       // 'c' clear marks first
AM.Responder(109);                      // 'm' mark
check('m marks spot ' + 0 + ' + msg', AM._state().marks === 1 && /^Marked Spot \d+$/.test(G.player.message));
AM.Responder(99);                       // 'c'
check('c clears marks + msg', AM._state().marks === 0 && G.player.message === 'All Marks Cleared');

// mark renders AMMNUM patch pixels at the window center (follow on → center
// is the player, so the mark digits sit at fb center like vanilla)
AM.Responder(109);                      // 'm'
AM.Drawer();
const markPix = countPix(p => p !== 0xff000000 && p !== whiteRGB);
check('mark digit patches painted', markPix > 0, markPix);
AM.Responder(99);

// ---- cheat seq iddt toggles cheating (3-cycle) --------------------------------------
for (const c of 'iddt') AM.Responder(c.charCodeAt(0));
check('iddt cheat cycles cheating', AM._state().cheating === 1);
for (const c of 'iddt') AM.Responder(c.charCodeAt(0));
check('iddt twice = 2 (things visible)', AM._state().cheating === 2);
for (const c of 'iddt') AM.Responder(c.charCodeAt(0));
check('iddt thrice = 0', AM._state().cheating === 0);

// ---- Tab exits ----------------------------------------------------------------------
check('Tab exits automap', AM.Responder(9) === true && !AM.active() && G.automapactive === false);
check('bar refresh queued on exit', AM.takeBarRefresh() === true);
check('Responder ignores keys when inactive', AM.Responder(102) === false);

// ---- re-entry per level: AM_Start re-inits after G_InitNew changed gamemap ----------
G.gamemap = 2;
AM.Responder(9);
const sL2 = AM._state();
check('re-entry works on new map', AM.active() && sL2.m_w > 0);
AM.Stop();

console.log(failures ? `${failures} FAILURES` : 'ALL CHECKS PASSED');
process.exit(failures ? 1 : 0);
