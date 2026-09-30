// main.js — DOOM 1.10 JS integration: fixed 35 tps loop, input, blit.
// Faithful to d_main.c D_DoomMain loop / TryRunTics accumulation (no realticcmd).
/* global ASSETS, loadMap, G_InitNew, G_Ticker, R_RenderPlayerView, R_SetViewSize,
          players, player, levelExit, G_DoReborn */
'use strict';

const SCREENW = 320, SCREENH = 200, SCALE = 3;
// Vanilla drew 320x200 into a 4:3 CRT frame (non-square pixels). The CSS box
// is presented at 320:240; the framebuffer stays the vanilla 320x200.
const DISPLAYH = 240;
const canvas = document.getElementById('screen');
canvas.width = SCREENW; canvas.height = SCREENH;      // native res: putImageData blits 1:1
// CSS size is computed by fitGameCanvas(): always fills the full vertical
// browser space at the vanilla 320:240 display aspect (letterboxed
// horizontally only when too wide for the row); upscaling stays pixel-crisp.
canvas.style.imageRendering = 'pixelated';
// shrink-to-height: the canvas always occupies all vertical window space;
// width follows from the 4:3 display aspect, clamped if it would clip.
function fitGameCanvas() {
  const wrap = document.getElementById('gamewrap');
  if (!wrap) return;
  // With the side panel open the wrap hugs the canvas (flex:0 0 auto), so
  // measuring wrap width would feed back on itself; clamp against the stage
  // row instead — the panel simply takes whatever horizontal space is left.
  const stage = document.getElementById('stage');
  const panel = document.getElementById('mapside');
  // panel visible? (media query hides it under 700px regardless of the class)
  const panelOpen = !!(panel && panel.offsetParent !== null);
  // panel-open: gamewrap hugs the canvas, so measure the stage minus the gap
  // and the automap panel's minimum (280px) — the panel takes the rest.
  const availW = Math.max(160, panelOpen && stage ? stage.clientWidth - 8 - 280 : wrap.clientWidth);
  const availH = Math.max(100, wrap.clientHeight);
  let h = availH;
  let w = h * SCREENW / DISPLAYH;
  if (w > availW) { w = availW; h = w * DISPLAYH / SCREENW; }
  canvas.style.width = Math.floor(w) + 'px';
  canvas.style.height = Math.floor(h) + 'px';
  // Sizing the canvas changes the panel's flex width; the automap baked its
  // backing store at boot (before the canvas grew), so re-fit it every time.
  // (top-level const: not on window — use typeof like the other call sites)
  if (typeof Automap !== 'undefined') Automap.resize();
}
window.addEventListener('resize', fitGameCanvas);
// external side-panel map toggle (deviation: was Tab before the in-game
// automap took it; lives at top level so it works on the title screen too —
// bootTitle never loaded a map json but the demo level rebinds it).
window.addEventListener('keydown', e => {
  if (e.code !== 'Backquote' || typeof Automap === 'undefined') return;
  const el = document.getElementById('mapside');
  el.style.display = (el.style.display === 'none') ? '' : 'none';
  const open = el.style.display !== 'none';
  const stage = document.getElementById('stage');
  if (stage) stage.classList.toggle('panel-open', open);
  if (open) { Automap.resize(); Automap.rebind(); }
  fitGameCanvas();   // re-run AFTER class flip: canvas may widen into freed space
});
// (The old browser css-zoom control is gone; -/= now resize the in-game view
// window via M_SizeDisplay, handled inside MEN.Responder — m_menu.c:1522.)
const ctx = canvas.getContext('2d');
const frameImg = ctx.createImageData(SCREENW, SCREENH);

// ---- framebuffer: engine draws into Uint32Array(320*200) 'viewbuffer';
// blit the full 320x200 (view is inset by viewwindowx/y by the renderer).
function blit() {
  const dst = new Uint32Array(frameImg.data.buffer);
  dst.set(viewbuffer);
  ctx.putImageData(frameImg, 0, 0);
}

// ---- WAD loading progress: canvas-drawn bar + STCFN text, shown while the
// WAD downloads (streamed) and installs. Vanilla has no such screen (the
// WAD read is synchronous at startup); this is a browser-only affordance,
// so it borrows the WIPLNUM font (STCFN) and stays in the 320x200 buffer.
let loadProgress = null;           // {label, frac|null, note}
function drawLoadProgress() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, SCREENW, SCREENH);
  const lp = loadProgress || {};
  const cx = SCREENW / 2;
  // canvas text (not STCFN): this screen shows DURING the WAD download,
  // before any patches exist to build the font from.
  ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.font = '10px monospace'; ctx.fillStyle = '#bcbcbc';
  ctx.fillText(lp.label || 'LOADING WAD', cx, 96);
  if (lp.note) { ctx.fillStyle = '#6e6e6e'; ctx.fillText(lp.note, cx, 132); }
  const bw = 200, bh = 8, bx = cx - bw / 2, by = 104;
  ctx.strokeStyle = '#bcbcbc'; ctx.lineWidth = 1;
  ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, bh - 1);
  if (lp.frac === null || lp.frac === undefined) {
    const t = (Date.now() / 30) % (bw - 2);        // indeterminate sweep
    ctx.fillStyle = '#00a800';
    ctx.fillRect(bx + 1 + Math.floor(t), by + 1, 12, bh - 2);
  } else if (lp.frac > 0) {
    ctx.fillStyle = '#00a800';
    ctx.fillRect(bx + 1, by + 1, Math.floor((bw - 2) * Math.min(1, lp.frac)), bh - 2);
  }
}
// Stream a fetch with byte progress (Content-Length when the server sends it).
async function fetchWithProgress(url, label, onFrac) {
  const r = await fetch(url, { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const total = +(r.headers.get('content-length') || 0);
  let buf;
  if (!r.body || !total) {
    buf = await r.arrayBuffer();                   // unknown length: one shot
    loadProgress = { label, frac: 1, note: '' }; drawLoadProgress();
  } else {
    const chunks = []; let got = 0, last = 0;
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length;
      const now = performance.now();
      if (now - last > 60 || got === total) {      // ~16 fps repaint cap
        last = now;
        loadProgress = { label, frac: got / total, note: '' };
        if (onFrac) onFrac(got / total);
        drawLoadProgress();
      }
    }
    buf = new Uint8Array(got);
    let o = 0; for (const c of chunks) { buf.set(c, o); o += c.length; }
    buf = buf.buffer;
  }
  return { buf, status: r.status };
}

// ---- screen wipe (d_main.c:222-345 + f_wipe.c wipe_Melt) ----
// On every gamestate change D_Display saves the pre-change screen
// (wipe_StartScreen), renders one frame of the new state, then drips the
// new screen down column-wise over the old (wipe_doMelt) at 35 tics/sec.
let wipeActive = false, wipeStart = 0;
let wipeScrStart = new Uint32Array(SCREENW * SCREENH);
let wipeScrEnd = new Uint32Array(SCREENW * SCREENH);
let wipeRenderedState = null;    // gamestate of the last drawn frame
function drawState() {
  if (gamestate === 'intermission') {
    WI.Drawer();                                // WI_Drawer (full screen)
  } else if (gamestate === 'finale') {
    FINALE.Drawer();
  } else if (gamestate === 'title') {
    MEN.Drawer(true);                           // D_PageDrawer + M_Drawer
  } else if (window.AM && AM.active()) {
    // d_main.c:240 — AM_Drawer replaces the 3D view; ST_Drawer keeps the bar
    // (st_statusbaron = (!fullscreen) || automapactive), then HU_Drawer adds
    // the w_title map-name line (hu_stuff.c:491).
    AM.Drawer();
    hudRefresh = hudRefresh || AM.takeBarRefresh();  // ST_Responder AM_MSG*
    HUD.blitToViewbuffer(viewbuffer);
    HU.HU_Drawer();
    if (MEN.menuactive || MEN.messageToPrint) MEN.Drawer(false);
  } else {
    R_RenderPlayerView(player);
    R_DrawViewBorder();                 // pattern border outside the view
                                        // window. Gospel runs this in
                                        // D_Display AFTER HU_Drawer but only
                                        // while borderdrawcount is active
                                        // (screens[] persists otherwise);
                                        // our port clears viewbuffer per
                                        // frame, so we redraw it every frame
                                        // BEFORE HU_Drawer — net visible
                                        // order matches vanilla: view ->
                                        // border -> bar -> HU text on top.
    // st_stuff.c:1110 — if (st_statusbaron) { ... widgets ...; V_CopyRect(BG->FG) }.
    // st_statusbaron = (!fullscreen) || automapactive (set at d_main.c:246 /
    // am enter); the automap branch above blits separately. fullscreen here
    // is d_main.c's static, updated each D_Display as (viewheight == 200).
    if (viewheight !== 200) HUD.blitToViewbuffer(viewbuffer);
    HU.HU_Drawer();                     // d_main.c:271 — messages over the view
    if (MEN.menuactive || MEN.messageToPrint) MEN.Drawer(false);  // M_Drawer over the view
  }
}
function wipeTick() {
  const now = performance.now();
  // d_main.c:330-341: `do { tics = I_GetTime() - wipestart; } while (!tics)`
  // — the wipe advances at exactly TICRATE (35 Hz), tics usually == 1 per
  // render loop (DOS ~70 fps render, busy-wait floor). Columns move `tics`
  // rows per call: pre-delay (≤16) + accel (1..16 rows) + 8/tic => ~40 tics
  // ≈ 1.1 s total. Do NOT force ≥1 per animation frame (ran at display
  // rate = 60 Hz ≈ 1.7x vanilla speed).
  const tics = Math.floor((now - wipeStart) / TICTIME);
  if (tics < 1) return;                         // vanilla: spin until a tic lands
  wipeStart += tics * TICTIME;
  const done = Wipe.doMelt(viewbuffer, tics);
  if (MEN.menuactive || MEN.messageToPrint) MEN.Drawer(false);  // M_Drawer on top of wipes
  blit();
  if (done) wipeActive = false;
}
window.forceWipe = function () { pendingForcedWipe = true; };  // f_finale.c:245/379 (wipegamestate=-1)
let pendingForcedWipe = false;
// CDP/automation readiness: true while the melt wipe animates. Screenshot
// and probe drivers must wait for this to clear (window.wipeActive would be
// undefined — `let` is script-scope, not a window property).
window.isWiping = function () { return wipeActive; };
window.simTic = function () { return oldtics; };   // sim-clock probe (cdp-pace.js)
window.simStats = function () { return { simTic: oldtics }; };

// ---- input → ticcmd (d_net.h ticcmd_t; g_game.c G_BuildTiccmd values)
const cmd = { forwardmove: 0, sidemove: 0, angleturn: 0, buttons: 0 };
const keys = {};
window.addEventListener('keydown', e => { keys[e.code] = true; if (['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Tab'].includes(e.code)) e.preventDefault(); });
window.addEventListener('keyup',   e => { keys[e.code] = false; });
// Losing the window (Alt+Tab etc.) swallows the matching keyups — clear all
// held-key state, including the strafe modifier tracked outside `keys`.
function releaseAllKeys() {
  for (const k in keys) keys[k] = false;
  strafeOn = false;
}
window.addEventListener('blur', releaseAllKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllKeys(); });

// ---- D_PostEvent: keydown events -> doomdef.h keycodes, consumed per-tic by
// the responder chain (d_main.c D_ProcessEvents). Only mapped keys are
// queued; gameplay keys flow through the `keys` array above.
const keyQueue = [];
(function installKeyEvents() {
  const CH = {                      // doomdef.h single-key event codes
    Enter: 13, NumpadEnter: 13, Escape: 27, Backspace: 127, Space: 32,
    Tab: 9,                         // AM_STARTKEY (am_map.c) — in-game automap
    Backquote: 96,                  // deviation: side-panel map toggle
    ArrowUp: 0xad, ArrowDown: 0xaf, ArrowLeft: 0xac, ArrowRight: 0xae,
    Minus: 0x2d, Equal: 0x3d,
    F1: 0x80 + 0x3b, F2: 0x80 + 0x3c, F3: 0x80 + 0x3d, F4: 0x80 + 0x3e,
    F5: 0x80 + 0x3f, F6: 0x80 + 0x40, F7: 0x80 + 0x41, F8: 0x80 + 0x42,
    F9: 0x80 + 0x43, F10: 0x80 + 0x44, F12: 0x80 + 0x58
  };
  window.addEventListener('keydown', e => {
    if (e.repeat) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;  // cheat panel text fields
    let ch = CH[e.code];
    if (ch === undefined) {
      const m = /^Key([A-Z])$/.exec(e.code);          // letters -> lowercase ASCII
      if (m) ch = m[1].toLowerCase().charCodeAt(0);
      else {
        const d = /^Digit([0-9])$/.exec(e.code);
        if (d) ch = 48 + +d[1];
      }
    }
    // Function keys: swallow browser defaults (F3 find, F5 reload, F1 help)
    // ONLY while the mouse is captured, i.e. mid-game — otherwise the browser
    // UI opening also releases the lock and steals focus. With the pointer
    // free the game still receives the key (queued above) but the browser's
    // own binding works too. F11 stays free either way (browser fullscreen).
    if (ch !== undefined) {
      keyQueue.push(ch);
      if (/^F(\d{1,2})$/.test(e.code)) {
        if (document.pointerLockElement === canvas) {
          e.preventDefault();
          lastFKeyAt = performance.now();
        }
      } else if (['Enter', 'Escape', 'Tab'].includes(e.code)) e.preventDefault();
    }
    // pause: vanilla raises BT_SPECIAL|BTS_PAUSE via ticcmd (g_game.c
    // G_BuildTiccmd); browser port has no Pause key reliability, so we toggle
    // directly here — same effect as the G_Ticker BTS_PAUSE branch.
    if (e.code === 'Pause' || (e.shiftKey && e.code === 'Pause')) {
      if (gamestate === 'level') {
        G.paused = !G.paused;
        if (window.Snd) { G.paused ? Snd.S_PauseSound() : Snd.S_ResumeSound(); }
      }
    }
  });
  // keyup events (d_main.c D_ProcessEvents carries both directions; am_map.c
  // AM_Responder's ev_keyup branch zeroes pan/zoom multipliers)
  window.addEventListener('keyup', e => {
    if (!window.AM) return;
    let ch = CH[e.code];
    if (ch === undefined) {
      const m = /^Key([A-Z])$/.exec(e.code);
      if (m) ch = m[1].toLowerCase().charCodeAt(0);
      else {
        const d = /^Digit([0-9])$/.exec(e.code);
        if (d) ch = 48 + +d[1];
      }
    }
    if (ch !== undefined) AM.OnKeyUp(ch);
  });
})();

// ---- mouse: d_input.c style. DOOM mouselook doesn't exist in 1.10; mouse x
// accumulates into a turning balance consumed by G_BuildTiccmd:
//   angleturn += (mousex << 2) * (mouseSensitivity+5) / 10, then *8 (defaults.h
//   mouseSensitivity=5 -> <<2*(5+5)/10 = <<2, then m_forward/m_side scaled by
//   0x8<<mouse_acceleration... for sensitivity only: angleturn += mousex<<2
//   *sens*... we use the canonical I_/G_ combination:
//   angleturn = (mousex << 2) * (mouseSensitivity + 5) / 10; angleturn *= 0x8;
let mousex = 0;
let mouseSensitivity = 5;        // defaults.h default
let mouselookEnabled = false;    // deviation: pointer-lock gives analog turning
window.addEventListener('mousemove', e => {
  if (document.pointerLockElement === canvas) mousex += e.movementX;
});
canvas.addEventListener('click', () => {
  if (window.Snd) Snd.unlock();              // AudioContext gesture unlock
  // Clicking the game view means "I want to play": dismiss any menu/prompt
  // first. Without this the tick loop keeps force-releasing the lock while
  // the (possibly invisible-to-the-user) panel is open, so the click could
  // never capture until ESC closed the panel.
  if (typeof MEN !== 'undefined' && (MEN.menuactive || MEN.messageToPrint)) {
    MEN.M_ClearMenus();
    MEN.ClearMessage();
  }
  if (document.pointerLockElement !== canvas) {
    lockAcquireAt = performance.now();
    // Retrying variant: if this click lands inside Chrome's ~1s post-Esc
    // penalty window the first request is refused; the 350ms retry chain
    // picks it up so ONE click is enough.
    relockCanvas(6);
  }
});
// Deviation: while pointer-locked, the browser consumes the Escape keydown
// (it exits pointer lock instead of reaching the page), so vanilla's
// "Esc opens M_StartControlPanel" never fires mid-game. Treat the
// pointer-lock release itself as the Esc press. Guards: ignore the change
// events that belong to an acquire (or the browser's failed-reacquire
// chatter right after one), so only a user Esc release opens the panel.
let lockAcquireAt = -1e9;
// Some browsers release pointer lock when an F-key triggers their own UI
// (help overlay, find bar, devtools) even when the keydown was cancelled.
// Remember the last mapped F-key press; a lock release right after one is
// that churn — re-acquire instead of treating it as Esc.
let lastFKeyAt = -1e9;
let relockInFlight = false;
let relockRetryTimer = null;
function relockCanvas(retries) {
  // Chrome rejects requestPointerLock while a previous request is still
  // pending, for ~1s after an Esc release, and rejects plain (non-gesture)
  // requests outright. Track in-flight state, swallow refusals, and when
  // asked (click path) keep retrying until the penalty window passes.
  if (relockInFlight || document.pointerLockElement === canvas) return;
  relockInFlight = true;
  const done = (ok) => {
    relockInFlight = false;
    if (!ok && retries > 0) {
      clearTimeout(relockRetryTimer);
      relockRetryTimer = setTimeout(() => relockCanvas(retries - 1), 350);
    }
  };
  try {
    const p = canvas.requestPointerLock();
    if (p && p.then) p.then(() => done(true), () => done(false));
    else done(true);    // legacy sync API (no promise): trust pointerlockchange
  } catch (e) { done(false); }
}
document.addEventListener('pointerlockchange', () => {
  const now = performance.now();
  if (document.pointerLockElement === canvas) { lockAcquireAt = now; return; }
  if (now - lockAcquireAt < 1000) return;              // acquire-side churn
  if (typeof gamestate === 'undefined') return;
  if (now - lastFKeyAt < 250 && (gamestate === 'level' || gamestate === 'intermission' || gamestate === 'finale')) {
    // Deferred re-grab: if this release was actually an F-key that opened a
    // menu (line 736 exits the lock for the cursor), M_Responder runs on the
    // next tic and menuactive is set by then — don't steal the cursor back.
    setTimeout(() => {
      if (!(MEN && (MEN.menuactive || MEN.messageToPrint))) relockCanvas();
    }, 120);
    return;
  }
  if (gamestate === 'level' || gamestate === 'intermission' || gamestate === 'finale') {
    if (MEN && !MEN.menuactive && !MEN.messageToPrint) keyQueue.push(27);
  }
});
window.addEventListener('mousedown', e => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) keys['__mouse0'] = true;
  if (e.button === 2) keys['__mouse2'] = true;
});
window.addEventListener('mouseup', e => {
  if (e.button === 0) keys['__mouse0'] = false;
  if (e.button === 2) keys['__mouse2'] = false;
});
// Scroll-wheel weapon cycling (browser-port deviation: vanilla 1.10 has no
// wheel input). One notch steps one slot around a loop:
//   fist/chainsaw -> pistol -> shotgun -> ssg -> chaingun -> rocket ->
//   plasma -> bfg -> (start over)
// Same slot layout as the number keys: chainsaw takes the fist slot (it is
// preferred when owned, like the gospel p_user.c:288 override), and the SSG
// gets its own slot after the shotgun when owned in DOOM 2. Up = forward,
// down = backward, looping forever. Picks ride a single-tic BT_CHANGE pulse
// in buildTiccmd (identical to a key tap) so the gospel switch block does
// all gating — EXCEPT the SSG: the ticcmd weapon field is only 3 bits
// (BT_WEAPONMASK=56) so it cannot carry weapon 8, and a key-2 tap from the
// SSG falls back to the plain shotgun. The SSG pick therefore sets
// pendingweapon directly — exactly what G_Responder's wp_supershotgun case
// (g_game.c:346) does for the local player.
let wheelWeapon = null;            // weapon field to send on the next tic
let wheelCursor = -1;              // persistent position in the rotation
function wheelPickWeapon(deltaY) {
  const pl = window.G && G.player;
  if (!pl) return null;
  const rot = [];
  if (pl.weaponowned[7]) rot.push(7);
  else if (pl.weaponowned[0]) rot.push(0);
  if (pl.weaponowned[1]) rot.push(1);
  if (pl.weaponowned[2]) rot.push(2);
  if (G.isCommercial() && pl.weaponowned[8]) rot.push(8);
  if (pl.weaponowned[3]) rot.push(3);
  if (pl.weaponowned[4]) rot.push(4);
  if (pl.weaponowned[5]) rot.push(5);
  if (pl.weaponowned[6]) rot.push(6);
  if (rot.length < 2) return null;
  let cur = rot.indexOf(pl.readyweapon);
  if (cur >= 0) wheelCursor = cur;      // stay in sync with number-key picks
  else cur = wheelCursor;               // off-slot (e.g. ssg owned, on gun 2)
  const dir = deltaY > 0 ? -1 : 1;      // scroll up = forward, down = back
  cur = (((cur + dir) % rot.length) + rot.length) % rot.length;
  wheelCursor = cur;
  const pick = rot[cur];
  return pick === pl.readyweapon ? null : pick;
}
window.addEventListener('wheel', e => {
  if (document.pointerLockElement !== canvas || gamestate !== 'level') return;
  const pick = wheelPickWeapon(e.deltaY);
  if (pick === null) return;
  e.preventDefault();
  // Direct pendingweapon path whenever the gospel p_user.c switch block
  // would rewrite the pick: SSG can't ride the 3-bit ticcmd field at all,
  // and in commercial a shotgun tap is rewritten to SSG whenever SSG is
  // owned (p_user.c:298) — but the wheel loop shows them as separate slots.
  if (pick === 8 ||
      (pick === 2 && G.isCommercial() && G.player.weaponowned[8])) {
    G.player.pendingweapon = pick;
  } else {
    wheelWeapon = pick;
  }
}, { passive: false });
window.addEventListener('contextmenu', e => { if (document.pointerLockElement === canvas) e.preventDefault(); });

// strafe key toggles mouse x -> sidemove (like DOOM's mouseb strafe)
let strafeOn = false;
window.addEventListener('keydown', e => { if (e.code === 'AltLeft' || e.code === 'AltRight') strafeOn = true; });
window.addEventListener('keyup',   e => { if (e.code === 'AltLeft' || e.code === 'AltRight') strafeOn = false; });

// Vanilla movement constants (g_game.c:175-179). speed=1 while the run key
// (right/left Shift — X11 i_video maps both to KEY_RSHIFT) is held.
const FORWARDMOVE = [0x19, 0x32];   // forwardmove[2] = {0x19, 0x32}
const SIDEMOVE = [0x18, 0x28];      // sidemove[2]   = {0x18, 0x28}
const ANGLETURN = [640, 1280, 320]; // angleturn[3]  = {640, 1280, 320} (+ slow turn)
const SLOWTURNTICS = 6;             // g_game.c:179
const MAXPLMOVE = FORWARDMOVE[1];   // g_game.c:171
let turnheld = 0;
function buildTiccmd() {
  let fwd = 0, side = 0, turn = 0;
  // g_game.c:567 — when AM_Responder returns false (follow mode: arrows do
  // NOT pan, rc=false), the keydown falls through and sets gamekeydown, so
  // the player WALKS with the arrows while the automap follows them. Only
  // with follow OFF does AM eat the arrows (pan) — then keyboard arrows must
  // not move/turn. WASD is a browser convenience with no vanilla key analog,
  // so it stays live in both modes.
  const mapPan = window.AM && AM.active() && !AM.following();
  const speed = (keys['ShiftLeft'] || keys['ShiftRight']) ? 1 : 0;  // key_speed
  // two-stage accelerative turning (G_BuildTiccmd): first SLOWTURNTICS tics
  // of a held turn key use the slow index, then it jumps to walk/run speed.
  if (keys['ArrowRight'] || keys['ArrowLeft']) turnheld++; else turnheld = 0;
  const tspeed = turnheld < SLOWTURNTICS ? 2 : speed;
  if (strafeOn && !mapPan) {             // key_strafe (Alt): left/right strafe
    if (keys['ArrowRight']) side += SIDEMOVE[speed];
    if (keys['ArrowLeft']) side -= SIDEMOVE[speed];
  } else {
    // angle convention: angle += angleturn<<16 is CCW (p_user.c:154), so
    // turning RIGHT must SUBTRACT (g_game.c:299). WASD strafes stay
    // browser-convenience additions to vanilla's numpad defaults.
    if (!mapPan) {
      if (keys['ArrowRight']) turn -= ANGLETURN[tspeed];
      if (keys['ArrowLeft'])  turn += ANGLETURN[tspeed];
    }
  }
  if (keys['KeyW']) fwd += FORWARDMOVE[speed];
  if (keys['KeyS']) fwd -= FORWARDMOVE[speed];
  if (keys['KeyD']) side += SIDEMOVE[speed];   // strafe right
  if (keys['KeyA']) side -= SIDEMOVE[speed];
  // mouse turn (g_game.c G_BuildTiccmd): balance->angleturn, scaled by
  // sensitivity then *8; strafe key routes x to sidemove (x<<3, no sens)
  if (mousex) {
    // Gospel order: I_ layer scales raw dx by <<2 (i_video.c:250), G_Responder
    // then truncs mousex = d*(sens+5)/10 (g_game.c:579) BEFORE G_BuildTiccmd
    // consumes it (side += mousex*2 :407 / angleturn -= mousex*8 :409). The
    // C intermediate trunc matters at non-default sensitivity.
    const mx = Math.trunc((mousex << 2) * (mouseSensitivity + 5) / 10);
    if (strafeOn) {
      side += (mx * 2);                  // C: side += mousex*2 (g_game.c:407)
    } else {
      // C: cmd->angleturn -= mousex*0x8 — positive angleturn turns LEFT
      // (p_user.c angle += angleturn<<16, CCW), so mouse-right must NEGATE.
      turn -= mx * 8;
    }
    mousex = 0;
  }
  // vanilla clamps BOTH axes to ±MAXPLMOVE before storing (g_game.c:416-421)
  cmd.forwardmove = Math.max(-MAXPLMOVE, Math.min(MAXPLMOVE, fwd));
  cmd.sidemove = Math.max(-MAXPLMOVE, Math.min(MAXPLMOVE, side));
  cmd.angleturn = Math.max(-32768, Math.min(32767, turn | 0));
  let b = 0;
  if (keys['ControlLeft'] || keys['ControlRight'] || keys['Space'] || keys['__mouse0']) b |= 1;   // BT_ATTACK
  // BT_USE: vanilla key_use = Enter (g_game.c:329; X11 KEY_ENTER). Shift is
  // NO LONGER use — it is key_speed (run). E/RMB kept as browser conveniences.
  if (keys['KeyE'] || keys['Enter'] || keys['__mouse2']) b |= 2;                                  // BT_USE
  // BT_CHANGE: gospel g_game.c:342-348 loops i<NUMWEAPONS-1 over '1'+i, so
  // keys 1..8 select weapons 0..7 (fist..chainsaw); the super shotgun (8) has
  // NO direct key — it is reached via the shotgun key in commercial mode.
  // Bits <<3 plus BT_CHANGE (bit 2): game.js only reads them under BT_CHANGE.
  const wmap = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7,
                 Numpad1: 0, Numpad2: 1, Numpad3: 2, Numpad4: 3, Numpad5: 4, Numpad6: 5, Numpad7: 6, Numpad8: 7 };
  for (const k in wmap) if (keys[k]) { b |= (wmap[k] << 3) | 4; break; }
  // wheel cycle pulse: one tic only, cleared immediately (a key tap, not a hold)
  if (wheelWeapon !== null && !(b & 4)) b |= (wheelWeapon << 3) | 4;
  if (wheelWeapon !== null) wheelWeapon = null;
  cmd.buttons = b;
}

// ---- automap side panel (automap.js): top-down map + player + angle
// init once, globally: the panel should exist on the title/demo pages too,
// not only in ?map= direct-load mode.
const automapCv = document.getElementById('automap');
if (automapCv && typeof Automap !== 'undefined') Automap.init(automapCv);
const mapNameEl = document.getElementById('mapname');

// error line (gameplay numbers moved to #debugstrip; STBAR is the in-game HUD)
const hud = document.getElementById('hud');
let hudRefresh = true;             // force full widget redraw after level (re)start

// ---- debug readout under the automap panel: coords / angle / time / stats
const debugEl = document.getElementById('debugtext');
let debugTick = 0;
function updateDebugStrip() {
  if (debugTick++ % 7) return;
  const p = G.player;
  if (!p || !p.mo || !debugEl) return;
  debugEl.textContent =
    `X:${(p.mo.x>>16)} Y:${(p.mo.y>>16)} Z:${(p.mo.z>>16)}\n` +
    `ANG:${((p.mo.angle>>>0)*360/4294967296).toFixed(1)}\u00b0  ` +
    `T:${G.leveltime} (${(G.leveltime/35)|0}s)\n` +
    `KILLS:${p.killcount}/${totalkills||'?'}  ITEMS:${p.itemcount}/${G.totalitems||'?'}  ` +
    `SEC:${p.secretcount}/${G.totalsecret||0}`;
}

// copy icon: clipboard gets the current readout (plus map name for context)
document.getElementById('copystrip').addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  const text = `${G.currentMapName || 'map'}  ` + debugEl.textContent.replace(/\n/g, '  ');
  window.__lastCopy = text;              // debug/CDP hook
  const btn = e.currentTarget;           // currentTarget nulls out async — capture
  const flash = () => {
    btn.classList.add('copied');
    setTimeout(() => btn.classList.remove('copied'), 600);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(flash, () => fallbackCopy(text, flash));
  } else fallbackCopy(text, flash);
});
function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch (_) {}
  ta.remove();
}

// ---- cheat panel (side bar above the external map) ------------------------
// Each button runs the exact cheat BODY from st_stuff.c ST_Responder — same
// mutations, same d_englsh.h STSTR messages routed through player.message so
// HU_Ticker shows them like typed cheats. (The keystroke sequences
// themselves still work through the normal key path; this panel just exposes
// them for the mouse.)
(function installCheatPanel() {
  const $ = id => document.getElementById(id);
  const p = () => G.players[G.consoleplayer || 0];
  const live = () => p() && p().mo;
  const CF_GODMODE = 1, CF_NOCLIP = 2;

  // cht_CheckCheat bodies need nothing here — buttons ARE the resolved seq.
  function refresh() {
    if (typeof G === 'undefined' || !G.players) return;
    const pl = p();
    $('ch-god').classList.toggle('on', !!(pl && pl.cheats & CF_GODMODE));
    $('ch-noclip').classList.toggle('on', !!(pl && pl.cheats & CF_NOCLIP));
  }
  window.setInterval(refresh, 250);

  function guard() { return gamestate === 'level' && live(); }

  $('ch-god').onclick = () => {
    if (!guard()) return;
    const pl = p();
    pl.cheats ^= CF_GODMODE;                       // st_stuff.c:566
    if (pl.cheats & CF_GODMODE) {
      if (pl.mo) pl.mo.health = 100;
      pl.health = 100;
      pl.message = 'Degreelessness Mode On';
    } else pl.message = 'Degreelessness Mode Off';
  };
  $('ch-noclip').onclick = () => {
    if (!guard()) return;
    const pl = p();
    pl.cheats ^= CF_NOCLIP;
    pl.message = (pl.cheats & CF_NOCLIP) ? 'No Clipping Mode ON' : 'No Clipping Mode OFF';
  };
  // idfa / idkfa (st_stuff.c:563-600): armor 200/2, all weapons+ammo (+keys)
  function arsenal(withKeys) {
    if (!guard()) return;
    const pl = p();
    pl.armorpoints = 200; pl.armortype = 2;
    for (let i = 0; i < 9; i++) pl.weaponowned[i] = true;
    for (let i = 0; i < 5; i++) pl.ammo[i] = pl.maxammo[i];
    if (withKeys) for (let i = 0; i < 6; i++) pl.cards[i] = true;
    pl.message = withKeys ? 'Very Happy Ammo Added' : 'Ammo (no keys) Added';
  }
  $('ch-idfa').onclick = () => arsenal(false);
  $('ch-kfa').onclick = () => arsenal(true);
  $('ch-choppers').onclick = () => {                  // st_stuff.c:690
    if (!guard()) return;
    const pl = p();
    pl.weaponowned[7] = true;                         // wp_chainsaw
    pl.powers[2] = 1;                                 // pw_invulnerability (⚠ port P_GivePower sets 1)
    pl.message = "... doesn't suck - GM";
  };
  // behold? (st_stuff.c:666-680): give if none; else drain to 1 except
  // strength which toggles off. Letters from STSTR_BEHOLD + d_englsh order.
  const BEHOLD = { v: 2, s: 0, i: 1, r: 3, a: 4, l: 5 };  // pw_* indices
  $('ch-behold').onkeydown = e => {
    if (e.key !== 'Enter') return;
    if (!guard()) return;
    const k = $('ch-behold').value.toLowerCase();
    $('ch-behold').value = '';
    const i = BEHOLD[k];
    if (i === undefined) return;
    const pl = p();
    if (typeof G.P_GivePower === 'function' && !pl.powers[i]) G.P_GivePower(pl, i);
    else if (i !== 0) pl.powers[i] = 1;
    else pl.powers[i] = 0;
    pl.message = 'Power-up Toggled';
  };
  $('ch-mypos').onclick = () => {                     // st_stuff.c:697
    if (!guard()) return;
    const mo = p().mo;
    p().message = 'ang=0x' + (mo.angle >>> 0).toString(16) +
      ';x,y=(0x' + (mo.x | 0).toString(16) + ',0x' + (mo.y | 0).toString(16) + ')';
  };
  $('ch-mus').onclick = () => {                       // S_Start(): level theme
    if (window.Snd) Snd.S_Start();
    if (live()) p().message = 'Music Change';         // STSTR_MUS
  };
  $('ch-reborn').onclick = () => {                    // clev-style restart
    if (gamestate !== 'level') return;
    startGame(G.gameskill, G.gameepisode, G.gamemap, null);
    if (live()) p().message = 'Changing Level...';    // STSTR_CLEV
  };
  // --- map warp dropdown (deviation: idclev with a chooser) --------------
  const chMap = $('ch-map');
  function populateMapChoices() {
    chMap.length = 1;                                 // keep placeholder
    const wadMaps = window.WadInstall && WadInstall.maps();
    if (wadMaps && wadMaps.length) {
      for (const m of wadMaps) {
        const o = document.createElement('option');
        o.value = m.name; o.textContent = m.name;
        chMap.appendChild(o);
      }
    } else {
      for (let m = 1; m <= 9; m++) {                  // shareware E1M1-E1M9
        const o = document.createElement('option');
        o.value = String(m); o.textContent = 'E1M' + m;
        chMap.appendChild(o);
      }
    }
  }
  populateMapChoices();
  let warping = false;
  async function doWarp() {
    if (warping || !chMap.value) return;
    // WAD map name (E1M5 / MAP01 / HM01 ...): warp by name through the cache
    if (/^(E\dM\d|MAP\d\d|HM\d\d)$/.test(chMap.value)) {
      warping = true;
      try {
        const mj = titleMapCache[chMap.value];
        if (!mj) throw new Error('map not in cache');
        if (gamestate === 'level') pendingForcedWipe = true;
        const em = /^E(\d)M(\d)$/.exec(chMap.value);
        const ep = em ? +em[1] : (G.gameepisode || 0);
        const num = em ? +em[2] : +(/(\d\d)$/.exec(chMap.value) || [0, 1])[1];
        // Same next-level path as the normal exit flow (G_DoWorldDone ->
        // G_DoLoadLevel): warp CARRIES equipment; G_InitNew here reborn-reset
        // the player to pistol+50 ("inventory resets when loading next level").
        await gotoMap(ep, num);
        if (live()) p().message = 'Changing Level...';
        chMap.value = '';
      } catch (e) { /* stay put */ }
      warping = false;
      return;
    }
    const num = +chMap.value;
    if (!num) { warping = false; return; }
    warping = true;
    try {
      if (gamestate === 'level') pendingForcedWipe = true;  // level->level: no state change to trip the wipe
      await gotoMap(1, num);
      if (live()) p().message = 'Changing Level...';        // STSTR_CLEV (idclev)
      chMap.value = '';
    } catch (e) { /* missing map json: stay put */ }
    warping = false;
  }
  $('ch-warp').onclick = doWarp;
  chMap.addEventListener('change', () => { if (chMap.value) doWarp(); });
  const wadFile = $('ch-wadfile');
  $('ch-loadwad').onclick = () => wadFile.click();
  wadFile.addEventListener('change', async () => {
    const f = wadFile.files[0];
    wadFile.value = '';
    if (!f) return;
    try {
      loadProgress = { label: 'LOADING ' + f.name.toUpperCase(), frac: 0, note: '' };
      drawLoadProgress();
      const { buf } = await fetchWithProgress(URL.createObjectURL(f), 'LOADING ' + f.name.toUpperCase());
      const rep = await hotLoadWad(buf, f.name);
      if (live()) p().message = rep;
    } catch (e) { loadProgress = null; if (live()) p().message = 'WAD load failed: ' + e.message; }
  });
  // /wads dropdown: fed exclusively from the server's GET /wads JSON API
  // (tools/server.js). Populate is exported as window.wadListReady and
  // boot() AWAITS it before fetching the game WAD, so the listing lands
  // first and never races the big download. Selection hot-loads exactly
  // like the file picker and rewrites ?wad= so RESTART/quit-reload keep
  // the choice. Failures are visible in the placeholder, never silent.
  const wadList = $('ch-wadlist');
  window.wadListReady = (async () => {
    let names = null;
    for (let tries = 0; tries < 8 && names === null; tries++) {
      if (tries) await new Promise(r => setTimeout(r, 500));
      try {
        const r = await fetch('wads', { cache: 'no-store' });
        if (r.ok && (r.headers.get('content-type') || '').includes('json'))
          names = await r.json();
      } catch (e) { /* server not up yet: retry */ }
    }
    if (names === null) {
      wadList.disabled = true;
      wadList.options[0].textContent = 'load from /wads… (no /wads API)';
      return;
    }
    const cur = new URLSearchParams(location.search).get('wad') || '';
    for (const name of names) {
      const opt = document.createElement('option');
      opt.value = 'wads/' + name;
      opt.textContent = name;
      if ('wads/' + name === cur) opt.selected = true;
      wadList.appendChild(opt);
    }
    wadList.options[0].textContent =
      'load from /wads… (' + names.length + ')' + (names.length ? '' : ' EMPTY');
    if (!names.length) wadList.disabled = true;
  })();
  wadList.addEventListener('change', async () => {
    const url = wadList.value;
    if (!url) return;
    try {
      const lab = (url.split('/').pop() || 'WAD').toUpperCase();
      loadProgress = { label: 'LOADING ' + lab, frac: 0, note: '' };
      drawLoadProgress();
      const { buf } = await fetchWithProgress(url, 'LOADING ' + lab);
      const rep = await hotLoadWad(buf, url.split('/').pop());
      if (live()) p().message = rep;
      // quit/reload keeps the WAD choice via the ?wad= query string
      history.replaceState(null, '', (() => {
        const q = new URLSearchParams(location.search);
        q.set('wad', url);
        return location.pathname + '?' + q.toString();
      })());
    } catch (e) { if (live()) p().message = 'WAD load failed: ' + e.message; }
    wadList.blur();                       // don't hold focus from the game keys
  });
})();
// Title art/menu patches + DEMO lumps: shipped-in-the-WAD only. The boot
// path installs the WAD before this runs, and wadinstall's shim declares
// TITLE empty + applyBundles fills it, so there is nothing to lazy-load.
async function loadTitleAssets() {
  if (typeof TITLE === 'undefined' && !window.TITLE)
    throw new Error('WAD not installed: TITLE bundle unavailable');
  if (window.WadInstall && WadInstall.active()) {
    WadInstall.applyBundles();
    if (window.MEN) MEN.ResetPatchCache();
  }
}

// Maps needed by the intro loop + menu new-game: demo headers are
// (version,skill,ep,map) at byte 0..3 — DEMO1=E1M5, DEMO2=E1M3, DEMO3=E1M7,
// new game starts E1M1. Preload so demo start is synchronous (vanilla W_Cache
// semantics).
const titleMapCache = {};
async function preloadTitleMaps() {
  // No baked assets: hotLoadWad's seedTitleCache must already carry every
  // demo/title map under its legacy key. Missing entries mean the loaded
  // WAD lacks that map (PWAD) — leave absent; startGame falls back to the
  // current map rather than fetching baked JSON.
  return;
}

let bootQS = 'wad=wads/doom1.wad';   // query string to restore on quit/reload
let usergame = false;              // g_game.c usergame (save/end allowed)
let demoReader = null;             // G_ReadDemoTiccmd when playing back

function startGame(skill, ep, map, reader) {
  // g_game.c:472: G_DoLoadLevel forces a wipe when loading OVER a level
  // (in-game menu New Game keeps gamestate 'level', so the state-change
  // driver can't fire; from the title screen title->level wipes on its own).
  if (gamestate === 'level') pendingForcedWipe = true;
  const name = mapCacheKey(ep, map);
  const mapJson = titleMapCache[name] || G.currentMapJson;
  G.currentMapName = name;
  G.currentMapJson = mapJson;
  G.G_InitNew(skill, ep, map);
  HUD.ST_init(player);
  hudRefresh = true;
  Automap.rebind();
  if (mapNameEl) mapNameEl.textContent = '\u00b7 ' + (mapJson.mapname || name);
  demoReader = reader || null;
  // p_tick.c:137 — P_Ticker's menu-pause is skipped while demoplayback.
  // game.js reads G.demoplayback; keep it in sync with the demoReader seam
  // (new game => false, demo start => true; gotoMap/demo-end also clear it).
  G.demoplayback = !!reader;
  usergame = !reader;
  if (!reader && MEN.G_ClearDemoPlayback) MEN.G_ClearDemoPlayback();  // g_game.c:1445
  G.menuactive = false;
  gamestate = 'level';
}

function initSound() {
  if (window.Snd) {
    Snd.S_Init();                                // s_sound.c S_Init(15,15)
    // NOTE: assets.js declares `const ASSETS` — script-scope lexical, NOT a
    // window property. window.ASSETS is undefined; must reference bare.
    if (window.OPLMusic && typeof ASSETS !== "undefined" && ASSETS.genmidi) {
      OPLMusic.init('src/opl2.wasm')            // native chip rate — music is not in the 11025 DMX mixer
        .then(m => Snd.attachMusic(m))
        .catch(e => console.warn('OPL init failed:', e));
    }
  }
}

// m_misc.c M_LoadDefaults analogue: pull localStorage defaults into the
// menu module, then push them into the live subsystems. Call AFTER
// initSound() so S_SetSfxVolume/S_SetMusicVolume reach the mixer.
function applySavedSettings() {
  // p_saveg.js map fetch seam: load a save whose map differs from the one
  // currently loaded (titleMapCache first, then network — vanilla G_InitNew
  // equivalent lump reload).
  if (window.SAVE) SAVE.fetchMap = async (name, cb) => {
    try {
      const json = titleMapCache[name] ||
        await (await fetch(name, { cache: 'no-store' })).json();
      titleMapCache[name] = json;
      cb(json);
    } catch (e) { cb(null); }
  };
  MEN.LoadDefaults();
  R_SetViewSize(MEN.screenblocks, MEN.detailLevel);
  R_ExecuteSetViewSize();
  mouseSensitivity = MEN.mouseSensitivity;
  if (window.Snd) {
    Snd.S_SetSfxVolume(MEN.snd_SfxVolume);
    Snd.S_SetMusicVolume(MEN.snd_MusicVolume);
  }
}

// Menu/title hooks (m_menu.js Init). Vanilla call map in comments.
function menuHooks() {
  return {
    state: (s) => { gamestate = s; },                       // GS_DEMOSCREEN
    newGame: (skill, ep, map) => startGame(skill, ep, map, null), // G_DeferedInitNew
    playDemo: (name) => { MEN.G_DoPlayDemo(name); },        // G_DeferedPlayDemo
    initNew: (skill, ep, map, reader) => {                  // G_DoPlayDemo body
      startGame(skill, ep, map, reader);
      gamestate = 'level';                                  // demo plays a level
    },
    usergame: (v) => { if (v === undefined) return usergame; usergame = !!v; return usergame; },
    unpause: () => { G.paused = false; },
    gameActionNothing: () => {},                            // no deferred actions
    gameactionIsNothing: () => true,
    isTitleOrDemo: () => gamestate === 'title',
    playerLive: () => { if (G.players[0]) G.players[0].playerstate = 2; }, // PST_LIVE
    quit: () => { location.href = location.pathname + '?' + bootQS + location.hash; },
    setViewSize: (blocks, detail) => { R_SetViewSize(blocks, detail); R_ExecuteSetViewSize(); },
    gamestate: () => gamestate,
    netgame: () => false,
    // (SAVE.fetchMap wired below menuHooks consumers — see applySavedSettings)
    setMouseSensitivity: (v) => { mouseSensitivity = v; }
  };
}

// ---- WAD hot-load (dev/wad-hotload): swap ASSETS to binary WAD data ----
// Sound/music/title/menu graphics stay baked assets (documented limitation).
async function hotLoadWad(arrayBuffer, label) {
  const wasTitle = gamestate === 'title';
  // Install decodes every texture/sprite synchronously (vanilla W_Cache at
  // startup); paint the last progress frame and hand one tick to the browser
  // so the bar actually shows before the main thread blocks.
  loadProgress = { label: 'DECODING ' + (label || 'WAD').toUpperCase(), frac: 1, note: '' };
  drawLoadProgress();
  await new Promise(r => setTimeout(r, 0));
  const wad = WAD.load(arrayBuffer);
  const rep = WadInstall.install(wad);
  // Side-panel logo above the cheat panel: the same M_DOOM patch the main
  // menu draws (m_menu.js MainDef); TITLEPIC as fallback for PWAD-less lumps.
  {
    const img = document.getElementById('wadlogo');
    if (img) {
      const url = WadInstall.logoPNG(['M_DOOM', 'TITLEPIC'], 3);
      if (url) { img.src = url; img.style.display = 'block'; }
      else { img.removeAttribute('src'); img.style.display = 'none'; }
    }
  }
  loadProgress = null;                        // engine takes the screen back
  window.__lastWadReport = rep;               // dev/QC probe hook
  // Save slots are WAD-namespaced (p_saveg.js); each WAD sees only its own
  // slots. Other WADs' namespaced saves are preserved for when you switch
  // back; only pre-namespacing legacy keys are deleted on install.
  if (window.SAVE && SAVE.nukeForeignSaves) SAVE.nukeForeignSaves();
  const n = WadInstall.seedTitleCache(titleMapCache);
  // g_game.c:1012 G_SecretExitLevel checks W_CheckNumForName("map31")
  if (window.G) G.hasMap31 = WadInstall.maps().some(m => m.name === 'MAP31');

  // Full engine restart on the new WAD (vanilla restarts the process; the
  // browser equivalent tears down every module cache and re-inits).
  if (window.MEN) MEN.ResetPatchCache();      // menu/title art decode cache
  if (window.WI && WI.ResetPatchCache) WI.ResetPatchCache();
  if (window.HU && HU.ResetFontCache) HU.ResetFontCache();
  // sound: drop decoded DMX samples, kill music, re-run the S_Init getsfx
  // loop against the new ASSETS.sounds; OPL chip reparses GENMIDI.
  if (window.Snd) {
    Snd.S_StopMusic();
    Snd.S_ResetSfxData();
    Snd.S_Init();
    if (window.OPLMusic && OPLMusic.setGenmidi && ASSETS.genmidi)
      OPLMusic.setGenmidi(ASSETS.genmidi);
  }
  // render: rebuild texture/flat/colormap tables + sprite caches from ASSETS
  if (typeof R_InitData === 'function') { R_InitData(); R_InitColormaps(); }
  if (typeof R_InitSprites === 'function') R_InitSprites();
  if (typeof R_InstallLevelSprites === 'function' && gamestate === 'level')
    R_InstallLevelSprites();
  if (gamestate === 'level') Automap.rebind();

  // Re-enter the correct loop with the new content: title screens/demo loop,
  // or reload the current level so no old-WAD geometry/actors linger.
  if (wasTitle) {
    demoReader = null; G.demoplayback = false; usergame = false;
    window.levelExit = false;
    MEN.StartTitle();
    gamestate = 'title';
  } else if (gamestate === 'level') {
    // Reload the current level so no old-WAD geometry/actors/sprites linger
    // (loadMap re-runs R_InitData/R_InitSprites on the swapped ASSETS).
    const ep = G.gameepisode || 1, num = G.gamemap || 1;
    const name = mapCacheKey(ep, num);
    const mapJson = titleMapCache[name];
    if (mapJson) {
      G.currentMapName = name; G.currentMapJson = mapJson;
      G.G_InitNew(G.gameskill || 2, ep, num);
      HUD.ST_init(player); hudRefresh = true; Automap.rebind();
      if (mapNameEl) mapNameEl.textContent = '\u00b7 ' + (mapJson.mapname || name);
      demoReader = null; G.demoplayback = false; usergame = true;
      pendingForcedWipe = true;
    } else {
      // new WAD lacks this map (e.g. shareware PWAD swap): fall back to title
      demoReader = null; G.demoplayback = false; usergame = false;
      window.levelExit = false;
      MEN.StartTitle();
      gamestate = 'title';
    }
  }
  const chMap = document.getElementById('ch-map');
  if (chMap) {
    const keep = chMap.value;
    chMap.length = 1;
    for (const m of WadInstall.maps()) {
      const o = document.createElement('option');
      o.value = m.name; o.textContent = m.name; chMap.appendChild(o);
    }
    chMap.value = keep;
  }
  const mapEl = document.getElementById('wadname');
  if (mapEl) mapEl.textContent = label || 'WAD';
  return `${rep.textures} tex, ${rep.sprites} spr, ${n} maps loaded`;
}

async function bootTitle() {
  await loadTitleAssets();
  await preloadTitleMaps();
  initSound();
  R_SetViewSize(10, 0);
  R_ExecuteSetViewSize();
  if (typeof viewbuffer === 'undefined') globalThis.viewbuffer = new Uint32Array(SCREENW * SCREENH);
  MEN.Init(menuHooks());
  applySavedSettings();                // M_LoadDefaults (localStorage)
  MEN.StartTitle();                    // D_StartTitle: title loop starts next tic
  gamestate = 'title';
  if (mapNameEl) mapNameEl.textContent = '\u00b7 title';
  if (debugEl) debugEl.textContent = '';       // no gameplay readout on title
  fitGameCanvas();
  window.addEventListener('resize', fitGameCanvas);
  requestAnimationFrame(frame);
}

async function boot() {
  const params = new URLSearchParams(location.search);
  // Progress bar owns the canvas until the WAD is in: size the element to
  // the same full-height CSS box the game uses (the canvas element starts
  // at its 320x200 attribute size otherwise), then paint immediately.
  fitGameCanvas();
  window.addEventListener('resize', fitGameCanvas);
  loadProgress = { label: 'LOADING WAD LIST', frac: null, note: '' };
  drawLoadProgress();
  // Listing first: the /wads dropdown must be populated (or have failed
  // visibly) before the game WAD download hogs the connection.
  if (window.wadListReady) await window.wadListReady;
  // No-baked-assets port: the WAD is the only content source. Default to
  // wads/doom1.wad unless ?wad= names another; a missing WAD is a hard boot
  // error (vanilla I_Error("W_AddFile") analogue), never a baked fallback.
  const wadUrl = params.get('wad') || 'wads/doom1.wad';
  const wadLabel = (wadUrl.split('/').pop() || 'WAD').toUpperCase();
  loadProgress = { label: 'LOADING ' + wadLabel, frac: 0, note: '' };
  drawLoadProgress();
  let wadBuf;
  try {
    ({ buf: wadBuf } = await fetchWithProgress(wadUrl, 'LOADING ' + wadLabel));
  } catch (e) {
    throw new Error('WAD not found: ' + wadUrl + ' (' + e.message + ')');
  }
  await hotLoadWad(wadBuf, wadUrl.split('/').pop());
  params.set('wad', wadUrl);            // quit/reload keeps the WAD choice
  bootQS = params.toString();
  const mapName = params.get('map');
  if (!mapName) { return bootTitle(); }        // no ?map= -> intro/menu mode
  G.currentMapName = mapName;   // for map.html tab sync
  // Direct-map mode: WAD-seeded map wins over any on-disk JSON twin.
  let mapJson = titleMapCache[mapName];
  if (!mapJson)
    mapJson = await (await fetch(mapName, { cache: 'no-store' })).json();
  G.currentMapJson = mapJson;   // loadLevel() calls G.loadMap (engine) itself
  // A_BossDeath / level specials key off episode/map: derive them from the
  // JSON (E1M8 → 1/8; MAPxx / map01 → episode 0 per gamemode==commercial).
  const mn = /^(?:E(\d)M(\d)|MAP(\d\d)|map(\d+))/i.exec(mapJson.mapname || mapName);
  const mapEp = mn && mn[1] ? +mn[1] : 0, mapNum = mn ? +(mn[2] || mn[3] || mn[4]) : 1;
  G.onLevelExit = () => { window.levelExit = true; };
  R_SetViewSize(10, 0);          // 10 = view minus the 32px statusbar (C: screensize 8..11,
                                 // 1.10 default view + STBAR occupying rows 168..199)
  R_ExecuteSetViewSize();        // must run before the first R_RenderPlayerView
  initSound();
  await loadTitleAssets();       // menu system needs TITLE even in direct-map mode
  MEN.Init(menuHooks());         // Esc / F1-F10 open the menu even here
  applySavedSettings();          // M_LoadDefaults (localStorage)
  G.G_InitNew(2, mapEp, mapNum); // sk_medium
  usergame = true;               // G_InitNew: usergame = true
  HUD.ST_init(player);           // st_stuff.c ST_start: fresh face/key/arms widgets
  hudRefresh = true;
  // automap panel: bind to the freshly loaded map geometry
  Automap.rebind();
  fitGameCanvas();
  window.addEventListener('resize', fitGameCanvas);
  if (mapNameEl) mapNameEl.textContent = '\u00b7 ' + (mapJson.mapname || mapName);
  // engine owns globalThis.viewbuffer (Uint32Array 320*200); fallback alloc:
  if (typeof viewbuffer === 'undefined') globalThis.viewbuffer = new Uint32Array(SCREENW * SCREENH);
  requestAnimationFrame(frame);
}

// ---- map.html cross-tab live sync: broadcast player + live thing markers
// (throttled to ~15 Hz; the standalone automap tab renders them).
const mapBC = ('BroadcastChannel' in window) ? new BroadcastChannel('doom-redone-map') : null;
let bcTick = 0;
function broadcastMapState() {
  if (!mapBC || (bcTick++ % 2)) return;    // 60 Hz rAF -> every other frame
  const pl = G.player;
  if (!pl || !pl.mo) return;
  const MF = G.MF;
  const things = [];
  for (const m of G.liveThinkers()) {
    if (!m.info || m === pl.mo) continue;
    const f = m.flags;
    const cosmetic = m.sprite === 'PUFF' || m.sprite === 'BLUD' ||
      m.sprite === 'TFOG' || m.sprite === 'SHT2';
    const interesting = (f & MF.MISSILE) || (f & MF.CORPSE) ||
      (f & MF.COUNTKILL) || (f & MF.SHOOTABLE && f & MF.SPECIAL) ||
      (f & MF.SPECIAL);
    if (!interesting || cosmetic) continue;
    things.push([m.x, m.y, f, m.info.doomednum, m.info.spawnhealth, m.health, m.sprite]);
  }
  mapBC.postMessage({ map: G.currentMapName || null,
    x: pl.mo.x, y: pl.mo.y, ang: pl.mo.angle, things });
}

// ---- main loop: d_main.c D_DoomLoop style — accumulate real time into 35Hz tics
const TICTIME = 1000 / 35;
let lastReal = performance.now();
let oldtics = 0;
let dead = false;

// gamestate (doomdef.h): we run 'level', 'intermission' (GS_INTERMISSION) and
// 'finale' (GS_FINALE). The WI/FINALE screens own the viewbuffer while active.
let gamestate = 'level';

// G_DoWorldDone / finale restart: fetch + start the next map. Vanilla wipes
// (F_WipeScreen); the port hard-cuts (documented deviation, like level reload).
// Map cache key for the current WAD: DOOM 1 'E%eM%m', DOOM 2 'MAP%02d'
// (p_setup.c:161 map%02i vs E%1M%1). WadInstall.seedTitleCache seeds both
// the WAD lump name and this legacy key.
function mapCacheKey(ep, num) {
  if (typeof gamemode !== 'undefined' && gamemode === 'commercial')
    return 'MAP' + String(num).padStart(2, '0');
  // canonical WAD lump name (E1M5, E2M1...): the old 'assets/e1mN.json' key
  // DROPPED the episode, so every "Episode 2/3" menu start silently loaded
  // E1MN geometry while G_InitNew set the right episode (correct music!).
  return 'E' + ep + 'M' + num;
}

async function gotoMap(ep, num) {
  const name = mapCacheKey(ep, num);
  // WAD hot-load: WadInstall seeds titleMapCache under this legacy key, so
  // episode warps pull straight from the loaded binary WAD (no fetch).
  const mapJson = titleMapCache[name] ||
    await (await fetch(name, { cache: 'no-store' })).json();
  G.currentMapName = name;
  G.currentMapJson = mapJson;
  // g_game.c G_DoWorldDone -> G_DoLoadLevel (NOT G_InitNew): players stay
  // PST_LIVE so equipment/health/ammo/keys carry to the next level, and the
  // skill is whatever the game started with. G_InitNew here reborn-reset
  // everyone to pistol+50 (user-reported "always reset to default").
  G.G_DoLoadLevel(ep, num);
  HUD.ST_init(player);
  hudRefresh = true;
  Automap.rebind();
  if (mapNameEl) mapNameEl.textContent = '\u00b7 ' + (mapJson.mapname || name);
  usergame = true;
  demoReader = null;
  G.demoplayback = false;
  gamestate = 'level';
}
// g_game.c G_DoCompleted fired by the exit switch: decide WI vs finale.
function doLevelCompleted() {
  // g_game.c:1030 — G_DoCompleted drops the automap before the intermission
  if (window.AM && AM.active()) AM.Stop();
  const wminfo = G.G_DoCompleted();
  window.levelExit = false;
  if (wminfo.victory) {               // Doom 1 map 8 -> ga_victory -> F_StartFinale
    gamestate = 'finale';
    // deviation: restart E1M1 as a NEW game (fresh G_InitNew reset — the
    // playthrough is over; equipment must NOT carry into a restarted game).
    FINALE.Start({ worldDone: () => { startGame(G.gameskill || 2, 1, 1); } });
  } else {
    gamestate = 'intermission';
    // wi_stuff.c:744 WI_End -> G_WorldDone: on commercial maps 6/11/20/30
    // (and secret 15/31) the finale fires INSTEAD of loading the next map
    // (g_game.c:1147 — F_StartFinale overwrites the ga_worlddone action).
    WI.Start(wminfo, () => {
      const commercial = typeof gamemode !== 'undefined' && gamemode === 'commercial';
      const m = G.gamemap;            // still the completed map (DoWorldDone hasn't run)
      const finaleMap = commercial &&
        (m === 6 || m === 11 || m === 20 || m === 30 ||
         (G.secretexit && (m === 15 || m === 31)));
      if (finaleMap) {
        gamestate = 'finale';
        FINALE.Start({ worldDone: () => { gotoMap(G.gameepisode, wminfo.next + 1); } });
      } else {
        gotoMap(G.gameepisode, wminfo.next + 1);
      }
    });
  }
}

function frame(now) {
  // A WAD load in flight: the progress bar owns the canvas (download fetches
  // repaint themselves; this keeps the sweep animating and blocks sim/render).
  if (loadProgress) {
    drawLoadProgress();
    oldtics = Math.floor(now / TICTIME);   // don't bank tics across the load
    requestAnimationFrame(frame);
    return;
  }
  if (!dead) {
    // Vanilla's D_Display runs the blocking melt wipe AFTER drawing the new
    // state, delaying all further tic processing until it finishes (d_main.c
    // :327-345). Mirror that: while wiping, only animate the melt.
    if (wipeActive) {
      // Vanilla's melt is a BLOCKING loop inside D_Display (d_main.c:327-345):
      // gametic does not advance during the ~1.1 s wipe and the elapsed wall
      // clock is absorbed by the wipe itself — no backlog is banked. Re-sync
      // the sim clock here; otherwise the first post-wipe frame replays ~20
      // tics at once and fast-forwards through the weapon-raise animation.
      oldtics = Math.floor(now / TICTIME);
      wipeTick();
      requestAnimationFrame(frame);
      return;
    }
    let newtics = Math.floor(now / TICTIME);
    // No catch-up clamp: vanilla TryRunTics (d_net.c:668-676) runs ALL
    // elapsed tics (counts = availabletics, min 1) — never drops sim time,
    // so gameplay pacing is exactly wall-clock*35 even after a stall. The
    // old 5-tic clamp silently ate tics on frame stalls (capture overhead,
    // tab throttle) — the sim clock then lagged wall clock permanently,
    // which is the one-to-one pacing divergence.
    //
    // Safety cap for browser realities vanilla never had (background-tab
    // rAF freeze): replaying an unbounded backlog would busy-loop the tab
    // for minutes on return. Past 120 tics (vanilla's ~3.4s BACKUPTICS
    // buffer ceiling) fast-forward the clock WITHOUT running the sim:
    // pacing stays 1:1 (no mid-game tic theft at normal capture rates)
    // and returns from a long throttle simply resume where the level was.
    const backlog = newtics - oldtics;
    if (backlog > 120) {
      oldtics += backlog - 120;
      newtics = oldtics + 120;
    }
    while (oldtics < newtics) {
      oldtics++;
      // ---- D_ProcessEvents: M_Responder, then G_Responder (demo pop-up)
      G.menuactive = !!MEN.menuactive;
      // deviation: menu needs a cursor — drop the lock while a menu/message
      // is up, and re-acquire when it closes mid-level (F-key menus would
      // otherwise strand the mouse outside the canvas forever).
      if (G.menuactive && document.pointerLockElement === canvas)
        document.exitPointerLock();          // deviation: menu needs a cursor
      else if (!G.menuactive && G.wasMenuActive && !MEN.menuactive && !MEN.messageToPrint &&
               document.pointerLockElement === null &&
               (gamestate === 'level' || gamestate === 'intermission' || gamestate === 'finale')) {
        // Chrome imposes a pointer-lock re-acquire penalty that differs by
        // release source (immediate after exitPointerLock(); ~1s+ after a
        // browser-UI release). A failed request can extend the penalty, so
        // don't try synchronously — poll on a delay until it lands.
        G.relockTries = 0;
        if (!G.relockTimer) G.relockTimer = setInterval(() => {
          if (document.pointerLockElement !== null ||
              MEN.menuactive || MEN.messageToPrint ||
              !(gamestate === 'level' || gamestate === 'intermission' || gamestate === 'finale') ||
              ++G.relockTries > 8) {
            clearInterval(G.relockTimer); G.relockTimer = null; return;
          }
          relockCanvas();
        }, 400);
      }
      G.wasMenuActive = G.menuactive || !!MEN.messageToPrint;
      while (keyQueue.length) {
        const ch = keyQueue.shift();
        // d_main.c D_ProcessEvents order: M_Responder, then G_Responder whose
        // responder tail is HU/ST/AM. The menu yields -/= (and all AM keys)
        // while automapactive (m_menu.c), so feeding AM after MEN matches
        // vanilla precedence for every key the map cares about.
        if (!MEN.Responder(ch) && gamestate === 'level' && window.AM)
          AM.Responder(ch);
        if (keyQueue.length && gamestate === 'title') break;  // panel now open
      }
      if (gamestate === 'title') {
        // d_main.c: D_DoAdvanceDemo + M_Ticker, then G_Ticker's PageTicker
        MEN.Ticker();
        if (gamestate === 'title') MEN.PageTicker();
        if (window.Snd) { Snd.setGametic(oldtics); Snd.S_UpdateSounds(null); }
        continue;
      }
      // gameaction drain (g_game.c G_Ticker top): SAVE queues saves/loads
      // like G_SaveGame/G_LoadGame set ga_savegame/ga_loadgame; they run at
      // the top of the NEXT gametic, before the sim advances.
      if (window.SAVE) {
        if (SAVE.pendingSave) { SAVE.DoSaveGame(); hudRefresh = true; }
        if (SAVE.pendingLoad !== null && SAVE.pendingLoad !== undefined) {
          const slot = SAVE.pendingLoad; SAVE.pendingLoad = null;
          G.paused = true;                       // hold the sim across the (async) load
          SAVE.DoLoadGame(slot, (ok) => {
            G.paused = false;
            if (ok) {
              demoReader = null; usergame = true; G.demoplayback = false;
              // g_game.c:1445 (G_DoLoadGame): demoplayback = false — the menu
              // keeps its own copy that gates the "any key opens the panel"
              // demo pop-up (m_menu.c:1439); without this, a load from the
              // attract loop makes every keypress pop the control panel.
              if (MEN.G_ClearDemoPlayback) MEN.G_ClearDemoPlayback();
              gamestate = 'level';
              if (window.AM) AM.Stop();
              HUD.ST_init(player); hudRefresh = true;
              Automap.rebind();
              const nm = G.currentMapJson && G.currentMapJson.mapname;
              if (mapNameEl) mapNameEl.textContent = '\u00b7 ' + (nm || 'E1M' + G.gamemap);
              if (window.Snd) Snd.S_Start();     // fresh level music state (S_Start in loadLevel)
              pendingForcedWipe = true;          // D_Display redraws the loaded level
            } else if (G.players[0]) {
              G.players[0].message = 'bad savegame.';   // HU message channel
            }
          });
        }
      }
      buildTiccmd();
      if (demoReader) demoReader(cmd);          // G_ReadDemoTiccmd overwrite
      // gameaction is processed at the TOP of the NEXT G_Ticker in vanilla
      // (g_game.c:605-649) — so the tic that pressed the exit switch still
      // renders the level once, showing the flipped SW2 button, before
      // G_DoCompleted switches to the intermission.
      if (window.levelExit && gamestate === 'level') {
        if (demoReader) { demoReader = null; G.demoplayback = false; usergame = false; window.levelExit = false; MEN.D_AdvanceDemo(); gamestate = 'title'; MEN.StartTitle(); }
        else doLevelCompleted();
      }
      if (gamestate === 'intermission') {          // WI_Ticker only (d_main.c)
        WI.Ticker(cmd.buttons);
        if (window.Snd) { Snd.setGametic(oldtics); Snd.S_UpdateSounds(player.mo); }
      } else if (gamestate === 'finale') {
        FINALE.Ticker(cmd.buttons);   // f_finale.c:212 commercial skip reads ticcmd buttons
        if (window.Snd) { Snd.setGametic(oldtics); Snd.S_UpdateSounds(player.mo); }
      } else {
      MEN.SkullTicker();  // M_Ticker every gametic (d_net.c:744), menu or not
      G.G_Ticker(cmd);
      // D_Display: S_UpdateSounds(players[consoleplayer].mo) once per gametic
      if (window.Snd) {
        Snd.setGametic(oldtics);                 // handle-as-gametic quirk base
        Snd.S_UpdateSounds(player.mo);
      }
      HUD.ST_refresh(player, hudRefresh);   // ST_Ticker per gametic
      hudRefresh = false;
      if (window.AM) AM.Ticker();           // g_game.c:732 AM_Ticker
      HU.HU_Ticker(player, MEN.showMessages ? true : false);  // g_game.c:733
      }
    }
    // ---- D_Display draw + wipe driver (d_main.c:222-345) ----
    // gamestate != wipegamestate  =>  wipe: save old screen, draw new state
    // once, save new screen, then run the melt.
    if (gamestate !== wipeRenderedState || pendingForcedWipe) {
      pendingForcedWipe = false;
      if (wipeRenderedState !== null) {
        // wipe_StartScreen: the last frame of the OLD state is still in the
        // framebuffer (menu was just closed by the transition — vanilla
        // draws its transition frame menu-free, d_main.c:236-259).
        wipeScrStart.set(viewbuffer);
        drawState();                            // first (and only) new-state frame
        wipeScrEnd.set(viewbuffer);
        Wipe.initMelt(wipeScrStart, wipeScrEnd);
        viewbuffer.set(wipeScrStart);           // wipe_EndScreen restores start scr.
        wipeActive = true;
        wipeStart = performance.now() - TICTIME;   // d_main.c:329 wipestart = I_GetTime() - 1
      } else {
        drawState();                            // boot frame, no wipe yet
      }
      wipeRenderedState = gamestate;
      blit();
      if (gamestate === 'level') {
        Automap.draw();
        broadcastMapState();
        updateDebugStrip();
      }
      requestAnimationFrame(frame);
      return;
    }
    drawState();
    blit();
    if (gamestate === 'level') {
      Automap.draw();
      broadcastMapState();
      updateDebugStrip();
    }
  }
  requestAnimationFrame(frame);
}

window.addEventListener('error', ev => {
  hud.style.display = 'block';
  hud.textContent = 'ERROR: ' + ev.message;
  dead = true;
});

boot().catch(err => { hud.style.display = 'block'; hud.textContent = 'BOOT ERROR: ' + err.message; });
