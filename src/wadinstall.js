// wadinstall.js — hot-swap the engine's baked ASSETS with live WAD data.
// Emits the exact shapes R_InitData / R_InitColormaps / R_InitSprites read
// (255=hole row-major, b64 payloads), so no engine code changes: a map load
// re-runs all three R_Init* and the new WAD textures/flats/sprites/palette
// are live. Sound/music/statusbar/title stay baked (documented limitation).
'use strict';

// --- no-baked-assets shim -------------------------------------------------
// index.html no longer loads assets.js / audio.js / statusbar.js /
// intermission.js / title.js. Declare the containers every consumer reads
// (bare identifiers resolve through globalThis), empty; WadInstall.install()
// fills them from the WAD. If a bundle global somehow pre-exists it wins
// (harmless belt-and-braces; tools/wadboot-host.js routes vm tests the same
// WAD-first way the browser boots).
if (typeof ASSETS === 'undefined') {
  globalThis.ASSETS = {
    textures: {}, flats: {}, sprites: {},
    palette: null, palettes: null, colormaps: '',
    sounds: {}, music: {}, genmidi: null,
  };
}
if (typeof STATUSBAR === 'undefined') globalThis.STATUSBAR = { patches: {} };
if (typeof INTERLUDE === 'undefined')
  globalThis.INTERLUDE = { patches: {}, palette: null, flat: '' };
if (typeof TITLE === 'undefined') globalThis.TITLE = { patches: {}, demos: {} };

const WadInstall = (() => {
  let _wad = null, _bundles = null, _demos = null, _fp = null, _base = null;
  // ---- IWAD+PWAD layering -------------------------------------------------
  // A PWAD that carries maps but no content (no F_START flats, no TEXTURE1,
  // no PLAYPAL, no sprites — e.g. wads/myhouse.wad: MAP01 + 10 map lumps,
  // zero graphics) is an OVERLAY, not a game: vanilla's -iwad/-file model.
  // isOverlay() classifies it; the host keeps the previous install as the
  // base and calls overlay() so the base's ASSETS/bundles stay live while
  // only the PWAD's maps + fingerprint swap. A graphics-less install on
  // top of a content WAD otherwise leaves ASSETS.flats at the empty shim
  // and R_InitData dies on its F_SKY1 sky-band read (BOOT ERROR).
  function isOverlay(wad) {
    const maps = WAD.mapList(wad);
    if (!maps.length) return false;
    if (wad.lump('PLAYPAL') || wad.lump('COLORMAP') ||
        wad.lump('TEXTURE1') || wad.lump('PNAMES')) return false;
    if (wad.find('S_START') >= 0) return false;
    const fa = wad.find('F_START'), fe = wad.find('F_END');
    if (fa >= 0 && fe > fa) {
      for (let i = fa + 1; i < fe; i++)
        if (wad.lumps[i].size === 4096) return false;
    }
    // any decodable patch candidate => it ships real graphics: not an overlay
    for (const L of wad.lumps) {
      if (!L.size || L.size < 16) continue;
      if (/_START$|_END$/.test(L.name)) continue;
      const p = WAD.decodePatch(wad, L.name);
      if (p && p.w > 0 && p.h > 0) return false;
    }
    return true;
  }
  // ZDoom/UDMF format tripwire. A map authored in UDMF carries a TEXTMAP
  // lump (text-format namespace) instead of the ten vanilla binary lumps,
  // 'XGL3' extended GL-nodes in ZNODES, and DECORATE actors. None of it is
  // parseable by this port's vanilla-1.10 loader, and such files typically
  // also skip PLAYPAL/TEXTURE1 (ZDoom synthesizes them), which made the
  // failure surface as the cryptic R_InitData 'reading 2' crash. Detect the
  // format and say so instead: return the reason or null.
  function detectZDoom(wad) {
    if (wad.find('TEXTMAP') >= 0)
      return 'UDMF map (TEXTMAP lump)';
    const zn = wad.lump('ZNODES');
    if (zn && zn.size >= 4) {
      const u = zn.data();
      if (u[0] === 0x58 && u[1] === 0x47 && u[2] === 0x4C)   // 'XGL' / 'XZNL'
        return 'ZDoom extended node data (ZNODES "' +
          String.fromCharCode(u[0], u[1], u[2], u[3]) + '")';
    }
    if (wad.find('BEHAVIOR') >= 0) return 'ZDoom ACS bytecode (BEHAVIOR)';
    return null;
  }

  // Coverage check for layering: every texture/flAT name referenced by
  // mapWad's maps (SIDEDEFS 30-byte records: tex fields @4/@12/@20;
  // SECTORS 26-byte records: flat/ceil @4/@12; '-' and empty = no texture)
  // must exist as a composed texture / flat in baseWad, else it renders
  // black. Returns the missing names so the host can pick another base.
  function missingGraphics(baseWad, mapWad) {
    const nm = (b, o) => {
      let s = '';
      for (let i = 0; i < 8 && b[o + i]; i++) s += String.fromCharCode(b[o + i]);
      return s;
    };
    // vanilla lookup is case-insensitive (R_*NumForName uppercases; some
    // maps' SIDEDEFS carry lowercase names) — normalize both sides
    const texs = new Set(), flats = new Set();
    for (const m of WAD.mapList(mapWad)) {
      // mapList guarantees the 10 map lumps follow the marker in MAP_LUMPS order
      const siB = new Uint8Array(mapWad.lumps[m.index + 3].data());   // SIDEDEFS
      const scB = new Uint8Array(mapWad.lumps[m.index + 8].data());   // SECTORS
      for (let i = 0; i + 30 <= siB.length; i += 30)
        for (const s of [4, 12, 20]) {
          const t = nm(siB, i + s);
          if (t && t !== '-') texs.add(t.toUpperCase());
        }
      for (let i = 0; i + 26 <= scB.length; i += 26)
        for (const s of [4, 12]) {
          const f = nm(scB, i + s);
          if (f && f !== '-') flats.add(f.toUpperCase());
        }
    }
    const haveTex = new Set(WAD.readTextures(baseWad).textures.map(t => t.name.toUpperCase()));
    const haveFlat = new Set();
    for (const L of baseWad.lumps) if (L.size === 4096) haveFlat.add(L.name.toUpperCase());
    return {
      textures: [...texs].filter(t => !haveTex.has(t)).sort(),
      flats: [...flats].filter(f => !haveFlat.has(f)).sort(),
    };
  }

  // Apply a map-only PWAD over the currently installed base. Only maps and
  // the save-namespace fingerprint change; ASSETS/patches/demos belong to
  // the base IWAD and stay exactly as installed.
  function overlay(wad) {
    const base = _base;                   // install() rewrites both below
    const baseFp = _fp;
    const report = install(wad);          // content guards leave ASSETS alone
    _base = base;                         // graphics/saves still belong to base
    _fp = baseFp;                         // vanilla: saves namespace by IWAD,
                                          // never by the -file PWAD
    _bundles = null;                      // PWAD ships no graphics: applyBundles
    _demos = null;                        // now no-ops, base art/demos stay live
    report.overlay = true;
    return report;
  }

  // d_main.c IdentifyVersion analogue. Gospel keys the mode off the IWAD
  // *filename* (doom2.wad → commercial, doomu.wad → retail, doom.wad →
  // registered, doom1.wad → shareware); a browser hot-load has no such
  // probe, so the mode is derived from lump content instead (documented
  // deviation). Content signatures are unambiguous for every shipped IWAD:
  //   MAPxx maps present          -> commercial (DOOM 1 never has MAPxx)
  //   E4Mx present               -> retail (Ultimate DOOM: 4 episodes)
  //   E2Mx present (no E4)       -> registered (3 episodes)
  //   otherwise                  -> shareware (episode 1 only)
  function detectMode(wad) {
    const maps = WAD.mapList(wad);
    if (maps.some(m => /^MAP\d\d$/.test(m.name))) return 'commercial';
    if (maps.some(m => /^E4M\d$/.test(m.name))) return 'retail';
    if (maps.some(m => /^E2M\d$/.test(m.name))) return 'registered';
    return 'shareware';
  }

  // Content fingerprint of the loaded IWAD (FNV-1a over every lump name +
  // size). Stable for the same WAD under any filename, and different for any
  // two distinct WADs — the savegame layer (p_saveg.js) namespaces slots by
  // it so a PLUTONIA save can never load against DOOM2/TNT/doom1.
  function fingerprint(wad) {
    var h = 0x811c9dc5 >>> 0;
    var lum = wad.lumps;
    for (var i = 0; i < lum.length; i++) {
      var nm = lum[i].name;
      for (var j = 0; j < nm.length; j++) {
        h ^= nm.charCodeAt(j); h = Math.imul(h, 0x01000193) >>> 0;
      }
      var sz = lum[i].size | 0;
      h ^= sz & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
      h ^= (sz >>> 8) & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
      h ^= (sz >>> 16) & 0xff; h = Math.imul(h, 0x01000193) >>> 0;
    }
    return 'w' + (h >>> 0).toString(36);
  }

  function collectDemos(wad) {
    const demos = {};
    for (const n of ['DEMO1', 'DEMO2', 'DEMO3', 'DEMO4', 'DEMO5', 'DEMO6']) {
      const L = wad.lump(n);
      if (L && L.size) demos[n] = WAD.b64(L.data());
    }
    return demos;
  }
  // (Re)apply WAD bundles onto whatever graphic globals exist right now.
  // Safe to call any time; returns patch count (0 = nothing installed).
  function applyBundles() {
    if (!_bundles || !Object.keys(_bundles).length) return 0;
    try { if (typeof STATUSBAR !== 'undefined') STATUSBAR.patches = _bundles; } catch (e) {}
    try { if (typeof INTERLUDE !== 'undefined') INTERLUDE.patches = _bundles; } catch (e) {}
    try { if (typeof TITLE !== 'undefined') TITLE.patches = _bundles; } catch (e) {}
    try { if (window.TITLE) window.TITLE.patches = _bundles; } catch (e) {}
    if (_demos) {
      try { if (typeof TITLE !== 'undefined') TITLE.demos = _demos; } catch (e) {}
      try { if (window.TITLE) window.TITLE.demos = _demos; } catch (e) {}
    }
    return Object.keys(_bundles).length;
  }

  function install(wad) {
    const report = { flats: 0, textures: 0, sprites: 0, maps: 0, palette: false, colormaps: false };

    // doomstat.c gamemode — every version-gated module path reads this.
    globalThis.gamemode = detectMode(wad);
    report.gamemode = globalThis.gamemode;
    _fp = fingerprint(wad);            // save/load namespace (p_saveg.js)
    report.wadfp = _fp;

    const pals = WAD.readPalette(wad);
    if (pals && pals.length) {
      ASSETS.palettes = pals;
      ASSETS.palette = pals[0];
      report.palette = true;
      // hu.js fallback reads INTERLUDE.palette; baked intermission.js carried
      // its own copy — with the bundle shimmed, hand it PLAYPAL table 0.
      try { if (typeof INTERLUDE !== 'undefined' && !INTERLUDE.palette) INTERLUDE.palette = pals[0]; } catch (e) {}
    }
    const cm = WAD.readColormaps(wad);
    if (cm) { ASSETS.colormaps = cm; report.colormaps = true; }

    // flats: F_START..F_END, exact 4096-byte lumps, raw column-major bytes
    // (baked flats came from the same WAD layout — identical byte order).
    const flats = {};
    const fa = wad.find('F_START'), fe = wad.find('F_END');
    if (fa >= 0 && fe > fa) {
      for (let i = fa + 1; i < fe; i++) {
        const L = wad.lumps[i];
        if (L.size === 4096) { flats[L.name] = [64, 64, WAD.b64(L.data())]; report.flats++; }
      }
    }
    if (report.flats) ASSETS.flats = flats;

    // textures: TEXTURE1(+2) defs composed row-major with 255 holes —
    // the same shape gen_assets emitted, so R_InitData's posts/doubling/
    // transpose branch runs verbatim on WAD composites.
    const { textures: defs, patchNames } = WAD.readTextures(wad);
    const textures = {};
    for (const def of defs) {
      if (def.width <= 0 || def.height <= 0) continue;
      textures[def.name] = [def.width, def.height,
        WAD.b64(WAD.composeTexture(wad, def, patchNames))];
      report.textures++;
    }
    if (report.textures) ASSETS.textures = textures;

    // sprites: S_START..S_END, 6-char lumps plus 8-char extended mirror
    // pairs (POSSA1A8) which R_InitSprites already understands.
    const sprites = {};
    const sa = wad.find('S_START'), se = wad.find('S_END');
    if (sa >= 0 && se > sa) {
      for (let i = sa + 1; i < se; i++) {
        const L = wad.lumps[i];
        const n = L.name;
        if (L.size === 0 || n.length < 6 || n.length > 8) continue;
        const p = WAD.decodePatch(wad, n);
        if (!p || p.w <= 0 || p.h <= 0) continue;
        sprites[n] = [p.w, p.h, WAD.b64(p.px), p.leftOff, p.topOff];
        report.sprites++;
      }
    }
    if (report.sprites) ASSETS.sprites = sprites;

    // Sprite patch cache is built lazily once and keyed by lump name —
    // clear it so R_GetOrMakePatch re-decodes from the new ASSETS.sprites.
    // Engine declares these with top-level `var` (global lexical): they can
    // be read but NOT rebound from here — mutate the arrays in place.
    try {
      spriteCacheIdx = {};
      spritePatch.length = 0; spritePix.length = 0;
      spriteoffset.length = 0; spritewidth.length = 0;
      spriteoffsety.length = 0; spritetopoffset.length = 0;
    } catch (e) { /* engine not loaded (node test): skip */ }

    // ---- graphic patch bundles: statusbar, title/menu, intermission ----
    // Decode EVERY P_START..P_END patch once and hand the same name-keyed
    // superset to all three bundles. Consumers (hud/m_menu/wi/f_finale)
    // look up by lump name, so extra entries are harmless and any lump the
    // WAD ships overrides its baked twin. const bundles: rebind properties,
    // never the objects themselves. title.js lazy-loads AFTER install in the
    // browser flow, so applyBundles() is stored and re-runnable from
    // loadTitleAssets() — otherwise title.js's baked TITLE clobbers the swap.
    // First-occurrence-wins like W_CheckNumForName: statusbar art (STBAR,
    // face digits) lives OUTSIDE the markers in real IWADs. Junk lumps that
    // aren't patches fail the header sanity checks and are skipped.
    const bundles = {};
    for (let i = 0; i < wad.lumps.length; i++) {
      const L = wad.lumps[i];
      if (!L.size || L.size < 12 || bundles[L.name]) continue;
      const p = WAD.decodePatch(wad, L.name);
      // no size floor: 6x3 STCFN glyphs are legitimately smaller than
      // their padded lump; the post-chain bounds checks reject garbage.
      if (!p || p.w <= 0 || p.h <= 0) continue;
      bundles[L.name] = [p.w, p.h, WAD.b64(p.px), p.leftOff, p.topOff];
    }
    _bundles = bundles;
    _demos = collectDemos(wad);
    const nb = applyBundles();
    if (nb) report.patches = nb;
    // finale flats: f_finale.c tiles a per-episode/commercial-chapter flat
    // behind the typed text (FLOOR4_8 e1 ... MFLR8_3 e4, SLIME16/RROCK1x for
    // the DOOM 2 chapters). Stash every one we have under INTERLUDE.flats by
    // name; f_finale.js picks by (gamemode, episode/map) with FLOOR4_8 fallback.
    try {
      if (typeof INTERLUDE !== 'undefined') {
        if (!INTERLUDE.flats) INTERLUDE.flats = {};
        for (const fn of ['FLOOR4_8', 'SFLR6_1', 'MFLR8_4', 'MFLR8_3',
                          'SLIME16', 'RROCK14', 'RROCK07', 'RROCK17', 'RROCK13', 'RROCK19']) {
          const ff = wad.lump(fn);
          if (ff && ff.size === 4096) INTERLUDE.flats[fn] = WAD.b64(ff.data());
        }
        if (INTERLUDE.flats.FLOOR4_8) INTERLUDE.flat = INTERLUDE.flats.FLOOR4_8;
      }
    } catch (e) {}

    // ---- sound / music / GENMIDI (read by name at play time) ----
    const sounds = {}, music = {};
    for (const L of wad.lumps) {
      if (!L.size) continue;
      if (L.name.length > 2 && L.name.startsWith('DS') &&
          !/_START$|_END$/.test(L.name))
        sounds[L.name.slice(2)] = WAD.b64(L.data());        // DSPISTOL -> PISTOL
      else if (L.name.startsWith('D_'))
        music[L.name.slice(2)] = WAD.b64(L.data());         // D_E1M1   -> E1M1
    }
    if (Object.keys(sounds).length) { ASSETS.sounds = sounds; report.sounds = Object.keys(sounds).length; }
    if (Object.keys(music).length) { ASSETS.music = music; report.music = Object.keys(music).length; }
    const gm = wad.lump('GENMIDI');
    if (gm && gm.size > 0) { ASSETS.genmidi = WAD.b64(gm.data()); report.genmidi = true; }

    report.demos = Object.keys(_demos).length;

    report.maps = WAD.mapList(wad).length;
    _wad = wad;
    _base = wad;                          // full install: this WAD is the base
    return report;
  }

  // Fill main.js's titleMapCache under BOTH the WAD name and the legacy
  // assets/e1mN.json keys, so startGame/gotoMap/SAVE.fetchMap all resolve
  // WAD maps with zero further changes.
  function seedTitleCache(cache, wadOverride) {
    const w = wadOverride || _wad;
    if (!w) return 0;
    let n = 0;
    for (const m of WAD.mapList(w)) {
      const mj = WAD.mapJson(w, m.name);
      cache[m.name] = mj;
      // legacy keys: pre-WAD tooling/tests address maps as
      // assets/e1mN.json / assets/mapNN.json — keep both spellings live.
      const em = /^E1M(\d)$/.exec(m.name);
      if (em) cache['assets/e1m' + (+em[1]) + '.json'] = mj;
      const cm = /^MAP(\d\d)$/.exec(m.name);
      if (cm) cache['assets/map' + (+cm[1]) + '.json'] = mj;
      n++;
    }
    return n;
  }

  const maps = () => (_wad ? WAD.mapList(_wad) : []);
  const active = () => _wad;
  const base = () => _base;               // content IWAD under any overlay

  // Side-panel branding: rasterize a menu/title patch lump (M_DOOM above the
  // main menu, TITLEPIC on commercial) into a PNG data URL for DOM <img>s —
  // the side panel is plain HTML, so it can't run the canvas drawPatch path.
  // Palette-indexed px (255 = TRANS) -> RGBA via PLAYPAL table 0; 3x nearest
  // upscale keeps the blocky look crisp at panel width. Returns null when no
  // document/canvas exists (node tests) or the lump is missing.
  function logoPNG(names, scale) {
    if (!_wad || typeof document === 'undefined') return null;
    const pals = WAD.readPalette(_wad);
    const pal = pals && pals[0];
    if (!pal) return null;
    const list = [].concat(names);
    for (const name of list) {
      const p = WAD.decodePatch(_wad, name);
      if (!p || p.w <= 0 || p.h <= 0) continue;
      const s = scale || 3;
      const cv = document.createElement('canvas');
      cv.width = p.w * s; cv.height = p.h * s;
      const ctx2 = cv.getContext('2d');
      const img = ctx2.createImageData(cv.width, cv.height);
      const d = img.data;
      for (let y = 0; y < p.h; y++) {
        for (let x = 0; x < p.w; x++) {
          const c = p.px[y * p.w + x];
          if (c === 255) continue;             // TRANS
          const rgb = pal[c] || [0, 0, 0];
          for (let dy = 0; dy < s; dy++) {
            for (let dx = 0; dx < s; dx++) {
              const o = ((y * s + dy) * cv.width + x * s + dx) * 4;
              d[o] = rgb[0]; d[o + 1] = rgb[1]; d[o + 2] = rgb[2]; d[o + 3] = 255;
            }
          }
        }
      }
      ctx2.putImageData(img, 0, 0);
      return cv.toDataURL('image/png');
    }
    return null;
  }

  // Test seam: pretend a different IWAD is installed (cross-WAD isolation
  // checks in tools/test-save.js exercise the save/load namespacing).
  return { install, overlay, isOverlay, missingGraphics, detectZDoom, seedTitleCache, applyBundles, maps, active, base, detectMode,
    logoPNG,
    fingerprint: () => _fp, setFingerprint: (fp) => { _fp = fp; } };
})();
if (typeof module !== 'undefined') module.exports = WadInstall;
