/* automap.js — top-down map panel (vanilla automap idiom: red one-sided
   lines, green two-sided, blue special lines, green player arrow, yellow
   90-degree view cone) + realtime thing markers. Wheel = zoom at cursor,
   drag = pan, dblclick = refit. Reads engine globals, never mutates them. */
'use strict';

const Automap = (function () {
  const ML_TWOSIDED = 4;
  // p_mobj.h flag mirror (same values game.js exports as G.MF)
  const MF_SPECIAL = 1, MF_SHOOTABLE = 4, MF_MISSILE = 0x10000,
    MF_CORPSE = 0x100000, MF_COUNTKILL = 0x400000;
  let cv = null, cx = null, W = 0, H = 0;
  let bounds = null;            // {x0,y0,x1,y1} in map units
  let scale = 1, ox = 0, oy = 0;
  let userView = false;         // true once the user zooms/pans manually

  function init(canvas) {
    cv = canvas;
    cx = cv.getContext('2d');
    cv.addEventListener('wheel', onWheel, { passive: false });
    cv.addEventListener('mousedown', onDown);
    cv.addEventListener('dblclick', () => { userView = false; if (bounds) fit(); });
    cv.addEventListener('contextmenu', onRightClick);   // DEVIATION: teleport cheat
    resize();
    window.addEventListener('resize', resize);
    // The panel's own content (debug strip rows, fonts) can grow AFTER boot,
    // shrinking this canvas's box — ResizeObserver catches any layout-driven
    // box change, not just window resizes. Buffer writes don't change the
    // CSS box (flex wins over canvas intrinsic size), so no feedback loop.
    if (window.ResizeObserver) new ResizeObserver(resize).observe(cv);
  }

  function resize() {
    // match CSS box in DEVICE pixels (Hidpi/zoom-safe): setTransform maps
    // our W×H logical space onto the backing store. Drawing into a
    // CSS-px-sized store while the compositor scales by DPR misaligns
    // every line (bottom of the map never painted, stretched look).
    const r = cv.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(64, Math.round(r.width * dpr));
    const h = Math.max(64, Math.round(r.height * dpr));
    if (w === cv.width && h === cv.height && bounds) return;   // keep manual zoom across toggles
    cv.width = W = w;
    cv.height = H = h;
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // W/H stay logical (CSS px) so all draw math and the wheel-anchor
    // hit-tests keep using CSS coordinates.
    W = Math.round(r.width);
    H = Math.round(r.height);
    if (bounds && !userView) fit();
  }

  // Recompute world->screen from current map bounds (called after loadMap).
  function rebind() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < numvertexes; i++) {
      const vx = vertexes[i].x >> 16, vy = vertexes[i].y >> 16;
      if (vx < x0) x0 = vx; if (vx > x1) x1 = vx;
      if (vy < y0) y0 = vy; if (vy > y1) y1 = vy;
    }
    if (!isFinite(x0)) { bounds = null; return; }
    const pad = 32;
    bounds = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    fit();
  }

  function fit() {
    const bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;
    scale = Math.min(W / bw, H / bh);
    // center the map in the canvas
    ox = (W - bw * scale) / 2 - bounds.x0 * scale;
    oy = (H + bh * scale) / 2 + bounds.y0 * scale;   // y flips (map +y is up)
  }

  // --- wheel zoom (anchored at cursor) + drag pan ------------------------
  function onWheel(ev) {
    ev.preventDefault();
    const r = cv.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const f = ev.deltaY < 0 ? 1.25 : 1 / 1.25;
    const wx = (mx - ox) / scale, wy = (oy - my) / scale;   // world pt under cursor
    scale = Math.min(32, Math.max(0.02, scale * f));
    ox = mx - wx * scale;
    oy = my + wy * scale;
    userView = true;
  }
  function onDown(ev) {
    if (ev.button !== 0) return;
    const sx = ev.clientX, sy = ev.clientY, o0 = ox, o1 = oy;
    const move = e => {
      ox = o0 + (e.clientX - sx);
      oy = o1 + (e.clientY - sy);
      userView = true;
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }

  // --- DEVIATION: right-click teleport cheat -----------------------------
  // Not vanilla (no mouse in the automap era of the engine, and this panel is
  // itself a browser-side addition). Right-click anywhere on the map moves
  // the player instantly, reusing the engine's own teleport path
  // (P_TeleportMove + fog + sfx, like P_Teleport in p_telep.c). Blocked
  // outside a live level; refuses spots the engine refuses (walls/monsters).
  const FU = 65536;                                  // FRACUNIT (engine)
  // DEVIATION: right-click teleport cheat — NOT vanilla. Uses G.SFX names
  // (never raw ids: the dense-table lesson); literals only as boot fallback.
  const SFX_TELEPT = (window.G && G.SFX && G.SFX.sfx_telept) || 35;
  const SFX_NOWAY  = (window.G && G.SFX && G.SFX.sfx_noway) || 81;
  function onRightClick(ev) {
    ev.preventDefault();
    if (typeof G === 'undefined' || !G.players || !G.players.length) return;
    if (typeof gamestate !== 'undefined' && gamestate !== 'level') return;
    const p = G.players[G.consoleplayer | 0] || G.players[0];
    if (!p || !p.mo || p.mo.health <= 0) return;
    const r = cv.getBoundingClientRect();
    const mx = ev.clientX - r.left, my = ev.clientY - r.top;
    const wx = Math.round((mx - ox) / scale) * FU;   // CSS px -> map units -> fixed
    const wy = Math.round((oy - my) / scale) * FU;
    const oldx = p.mo.x, oldy = p.mo.y, oldz = p.mo.z;
    if (!G.P_TeleportMove(p.mo, wx, wy)) {           // solid/occupied: refuse
      if (window.Snd && G.S_StartSound) G.S_StartSound(p.mo, SFX_NOWAY);
      return;
    }
    p.mo.z = p.mo.floorz;                            // p_telep.c: thing.z = floorz
    p.viewz = (p.mo.z + p.viewheight) | 0;
    try {
      // G.MT.TFOG — never the literal 7: the dense mobjinfo realignment
      // moved MT_TFOG to 39 (index 7 is MT_SMOKE, the bullet-puff sprite).
      const fogA = G.P_SpawnMobj(oldx, oldy, oldz, G.MT.TFOG);
      const fogB = G.P_SpawnMobj(wx, wy, p.mo.floorz, G.MT.TFOG);
      if (window.Snd && G.S_StartSound) {
        G.S_StartSound(fogA, SFX_TELEPT);
        G.S_StartSound(fogB, SFX_TELEPT);
      }
    } catch (e) { /* fog best-effort */ }
    p.reactiontime = 18;                             // don't move for a bit (p_telep.c)
  }

  const px = mx => mx * scale + ox;
  const py = my => oy - my * scale;
  function fitScaleSafe() {
    if (!bounds) return 1;
    const bw = bounds.x1 - bounds.x0, bh = bounds.y1 - bounds.y0;
    return Math.min(W / bw, H / bh) || 1;
  }

  // classify a live mobj for marker color; null = no marker
  function thingColor(m) {
    if (m.sprite === 'PUFF' || m.sprite === 'BLUD' || m.sprite === 'TFOG' ||
        m.sprite === 'SHT2') return null;            // cosmetic particles
    const f = m.flags;
    if (f & MF_MISSILE) return '#ffffff';            // fireballs etc.
    if (f & MF_CORPSE) return '#5a2626';             // dead monster: dim red
    if (f & MF_COUNTKILL) return '#ff4040';          // live monster: red
    if ((f & MF_SHOOTABLE) && (f & MF_SPECIAL)) return '#ff9c00';  // barrel
    if (f & MF_SPECIAL) return '#ffd24d';            // pickup: gold
    return null;
  }

  function draw() {
    // G.player is the live slot (G_InitNew reloads re-assign it); window.player
    // is a load-time snapshot — prefer G (bare lexical from game.js in browser;
    // under other loaders fall back to window).
    let Gg;
    try { Gg = G; } catch (e) { Gg = window.G; }
    const pl = (Gg && Gg.player) || window.player;
    if (!cx || !bounds || !pl || !pl.mo) return;
    cx.fillStyle = '#000';
    cx.fillRect(0, 0, W, H);

    // --- linedefs
    cx.lineWidth = 1;
    for (let i = 0; i < numlines; i++) {
      const L = linedefs[i];
      const a = L.v1, b = L.v2;
      const twoSided = (L.flags & ML_TWOSIDED) && L.sidenum[1] !== -1;
      cx.strokeStyle = twoSided ? (L.special ? '#8a8aff' : '#6b6b6b') : '#af0000';
      cx.beginPath();
      cx.moveTo(px(a.x >> 16), py(a.y >> 16));
      cx.lineTo(px(b.x >> 16), py(b.y >> 16));
      cx.stroke();
    }

    // --- realtime thing markers from the live thinker list
    if (Gg && Gg.liveThinkers) {
      const th = Gg.liveThinkers();
      const label = scale > 0.55;         // doomednum labels when zoomed in
      cx.font = '10px monospace';
      for (let i = 0; i < th.length; i++) {
        const m = th[i];
        if (!m.info || m === pl.mo) continue;
        const c = thingColor(m);
        if (!c) continue;
        const X = px(m.x >> 16), Y = py(m.y >> 16);
        if (X < -12 || Y < -12 || X > W + 12 || Y > H + 12) continue;
        const r = (m.flags & MF_COUNTKILL) ? 4 : 3;
        cx.fillStyle = c;
        cx.beginPath();
        cx.arc(X, Y, r, 0, Math.PI * 2);
        cx.fill();
        if (label) {
          cx.fillStyle = c;
          const hurt = (m.info.spawnhealth > 1 && m.health < m.info.spawnhealth)
            ? ' ' + m.health : '';
          cx.fillText((m.info.doomednum > 0 ? String(m.info.doomednum) : m.sprite) + hurt,
            X + 6, Y + 3);
        }
      }
    }

    // --- player (world coords, fixed north-up like vanilla automap)
    const pxx = px(pl.mo.x >> 16), pyy = py(pl.mo.y >> 16);
    const ang = (pl.mo.angle >>> 0) * 2 * Math.PI / 4294967296;
    const ax = Math.cos(ang), ay = Math.sin(ang);
    const FOV = Math.PI / 2;

    // view cone (90 deg; grows gently with zoom, clamped)
    const clen = Math.min(140, Math.max(40, 46 * Math.sqrt(scale / fitScaleSafe())));
    cx.strokeStyle = 'rgba(255,220,0,0.55)';
    cx.beginPath();
    cx.moveTo(pxx, pyy);
    cx.lineTo(pxx + Math.cos(ang + FOV / 2) * clen, pyy - Math.sin(ang + FOV / 2) * clen);
    cx.moveTo(pxx, pyy);
    cx.lineTo(pxx + Math.cos(ang - FOV / 2) * clen, pyy - Math.sin(ang - FOV / 2) * clen);
    cx.stroke();

    // green arrow
    const s = 7;
    const perpX = -Math.sin(ang), perpY = -Math.cos(ang);   // screen-space right
    cx.fillStyle = '#00ff00';
    cx.beginPath();
    cx.moveTo(pxx + ax * s, pyy - ay * s);                       // nose
    cx.lineTo(pxx - ax * s * 0.7 + perpX * s * 0.55,
              pyy + ay * s * 0.7 + perpY * s * 0.55);            // rear-right
    cx.lineTo(pxx - ax * s * 0.7 - perpX * s * 0.55,
              pyy + ay * s * 0.7 - perpY * s * 0.55);            // rear-left
    cx.closePath();
    cx.fill();

    // legend + zoom hint
    cx.font = '10px monospace';
    const leg = [['#ff4040', 'monster'], ['#5a2626', 'corpse'],
      ['#ffd24d', 'item'], ['#ff9c00', 'barrel'], ['#ffffff', 'missile']];
    for (let i = 0; i < leg.length; i++) {
      cx.fillStyle = leg[i][0];
      cx.fillText('\u25cf ' + leg[i][1], 6, 12 + i * 12);
    }
    cx.fillStyle = '#777';
    cx.fillText('zoom ' + (scale / fitScaleSafe()).toFixed(1) +
      '\u00d7 \u00b7 wheel: zoom \u00b7 drag: pan \u00b7 dblclick: fit' +
      (typeof G !== 'undefined' ? ' \u00b7 RCLICK: teleport' : ''), 6, H - 6);
  }

  return { init, rebind, resize, draw,
    __bounds: () => bounds, __scale: () => [scale, ox, oy] };
})();
