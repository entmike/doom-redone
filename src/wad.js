// wad.js — browser-side binary WAD reader (dev/wad-hotload).
// Parses IWAD/PWAD directories and decodes lumps into the SAME shapes the
// port's baked assets use, so engine/game code paths stay untouched:
//   map JSON shape:  { mapname, lumps: { NAME: base64, ... } }   (engine.js loadMap)
//   ASSETS.textures: name -> [w, h, b64 row-major, 255=hole]      (R_InitData)
//   ASSETS.flats:    name -> [64, 64, b64]                         (R_InitData)
//   ASSETS.sprites:  lump -> [w, h, b64 row-major, leftOff, topOff](R_GetOrMakePatch)
// Post-composite textures emit row-major with 255 holes so R_InitData's
// existing composition branch (posts rebuild + doubling + transpose) runs
// verbatim on WAD data — same semantics the baked assets went through.
'use strict';
const WAD = (() => {

  // ---------------------------------------------------------------- directory
  function parse(arrayBuffer) {
    const dv = new DataView(arrayBuffer);
    const u8 = new Uint8Array(arrayBuffer);
    const magic = String.fromCharCode(u8[0], u8[1], u8[2], u8[3]);
    if (magic !== 'IWAD' && magic !== 'PWAD')
      throw new Error('WAD: bad magic ' + JSON.stringify(magic));
    const numLumps = dv.getInt32(4, true);
    let dirOfs = dv.getInt32(8, true);
    // Some PWADs are written with a bogus (negative/huge) dir offset but a
    // sane lump chain; walk to the end like the shareware editors tolerate.
    if (dirOfs < 16 || dirOfs + 64 > u8.length) dirOfs = findDirByChain(dv, u8);
    const lumps = new Array(numLumps);
    for (let i = 0; i < numLumps; i++) {
      const o = dirOfs + i * 16;
      if (o + 16 > u8.length) throw new Error('WAD: directory overruns file at lump ' + i);
      let end = i + 1 < numLumps ? dv.getInt32(o + 16, true) : u8.length;
      // Some wads' last-entry size is wrong; clamp like the C W_CheckNumForName guards
      const pos = dv.getInt32(o, true), size = dv.getInt32(o + 4, true);
      if (pos < 0 || pos + size > u8.length)
        throw new Error('WAD: lump ' + i + ' outside file');
      if (end <= pos || end > u8.length) end = Math.min(pos + size, u8.length);
      lumps[i] = {
        name: lumpName(u8, o + 8),
        pos, size,
        data: () => u8.subarray(pos, pos + size),
      };
    }
    // name index (first occurrence wins, like W_CheckNumForName scanning 0..n)
    const byName = new Map();
    for (let i = 0; i < numLumps; i++)
      if (!byName.has(lumps[i].name)) byName.set(lumps[i].name, i);
    return { magic, lumps, byName,
      find: (n) => byName.has(n) ? byName.get(n) : -1,
      lump: (n) => byName.has(n) ? lumps[byName.get(n)] : null,
    };
  }
  function lumpName(u8, o) {
    let s = '';
    for (let i = 0; i < 8; i++) { const c = u8[o + i]; if (!c) break; s += String.fromCharCode(c); }
    return s.toUpperCase();
  }
  function findDirByChain(dv, u8) {
    let pos = 12, i = 0;
    while (i < 100000) {
      const size = dv.getInt32(pos, true);
      if (size < 0 || pos + size >= u8.length) break;
      pos += size + 16; i++;
    }
    throw new Error('WAD: directory offset invalid, chain walk inconclusive');
  }

  // -------------------------------------------------------------- base64 out
  const B64CH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  function b64(u8) {
    let out = '';
    const n = u8.length;
    for (let i = 0; i < n; i += 3) {
      const a = u8[i], b = i + 1 < n ? u8[i + 1] : 0, c = i + 2 < n ? u8[i + 2] : 0;
      out += B64CH[a >> 2] + B64CH[((a & 3) << 4) | (b >> 4)];
      out += i + 1 < n ? B64CH[((b & 15) << 2) | (c >> 6)] : '=';
      out += i + 2 < n ? B64CH[c & 63] : '=';
    }
    return out;
  }

  // Find a graphic patch: global first-match, exactly like W_CheckNumForName
  // (statusbar patches like STBAR live OUTSIDE P_START in real IWADs).
  function patchLump(wad, name) {
    return wad.lump(name);
  }
  function graphicRanges(wad) {
    // patches live in P_START..P_END (with optional P1_START sub-markers);
    // sprites in S_START..S_END; flats in F_START..F_END (never patch lookups)
    const ranges = [];
    for (const [s, e] of [['P_START', 'P_END'], ['S_START', 'S_END']]) {
      const a = wad.find(s), b = wad.find(e);
      if (a >= 0 && b > a) ranges.push([a, b]);
    }
    wad._ranges = ranges;
    return ranges;
  }

  // ------------------------------------------------------- patch (sprite/masked)
  // Gospel R_ReadPatch: each column is a chain of posts
  //   [u8 topdelta][u8 length][u8 pad][length pixels], chain ends at topdelta
  //   0xFF; next post starts at columnPost + topdelta + length + 4.
  // Emits row-major px (255 = transparent hole) + the patch header offsets.
  function decodePatch(wad, name) {
    const L = patchLump(wad, name);
    if (!L || L.size < 16) return null;
    const dv = new DataView(wad._buf), o0 = L.pos, oEnd = L.pos + L.size;
    // Header format sniff (verified against this Doom 3.1-era build by
    // tools/wad_assets.py): four int16 pairs with the column table at 8,
    // OR the standard four int32s with the table at 32. Pick whichever
    // column table actually starts where its first column offset says.
    // Column offsets in BOTH variants are lump-start-relative (gospel
    // realpatch->columnofs[x]): standard table@32 has offs[0] = 32 + w*4,
    // the int16 variant table@8 has offs[0] = 8 + w*4 — sniff both.
    let w = dv.getInt16(o0, true), h = dv.getInt16(o0 + 2, true);
    let leftOff = dv.getInt16(o0 + 4, true), topOff = dv.getInt16(o0 + 6, true);
    let coltab = 8;
    const int16ok = w > 0 && w <= 512 && h > 0 && h <= 512 &&
      o0 + 8 + w * 4 <= oEnd && dv.getInt32(o0 + 8, true) === 8 + w * 4;
    if (!int16ok) {
      const w32 = dv.getInt32(o0, true), h32 = dv.getInt32(o0 + 4, true);
      if (w32 > 0 && w32 <= 512 && h32 > 0 && h32 <= 512 && o0 + 36 <= oEnd &&
          dv.getInt32(o0 + 32, true) === 32 + w32 * 4) {
        w = w32; h = h32; leftOff = dv.getInt32(o0 + 8, true); topOff = dv.getInt32(o0 + 12, true);
        coltab = 32;
      } else if (!int16ok && !(w > 0 && w <= 512 && h > 0 && h <= 512)) return null;
    }
    if (o0 + coltab + w * 4 > oEnd) return null;
    const px = new Uint8Array(w * h).fill(255);
    for (let col = 0; col < w; col++) {
      const postOff = dv.getInt32(o0 + coltab + col * 4, true);
      let columnPost = o0 + postOff;        // lump-relative, gospel columnofs
      if (postOff < 0 || columnPost >= oEnd) return null;   // bogus chain
      let topdelta = dv.getUint8(columnPost);
      let guard = 0;
      while (topdelta !== 0xff) {
        const len = dv.getUint8(columnPost + 1);
        if (columnPost + 3 + len > oEnd) return null;           // truncating chain
        let row = topdelta;                     // absolute y (v_video.c:251)
        for (let i = 0; i < len; i++, row++) {
          if (row >= 0 && row < h) px[row * w + col] = dv.getUint8(columnPost + 3 + i);
        }
        columnPost += len + 4;                  // gospel: patch + length + 4
        topdelta = columnPost < oEnd ? dv.getUint8(columnPost) : 0xff;
        if (++guard > 1024) return null;                     // corrupt loop guard
      }
    }
    return { w, h, leftOff, topOff, px };
  }

  // ------------------------------------------------------------- TEXTURE1/2
  // Gospel r_data.c R_InitTextures layout, which id Software made genuinely
  // evil: TEXTURE1 lump = [int32 npatch][npatch x 8-byte names][ntex int32
  // offsets] — the SAME int32 at offset 4 is both the PNAMES count (read by
  // R_ReadPNAMES with directory=maptex+1) and texture offset #0 (directory
  // starts at maptex+0). PNAMES itself is a redundant standalone lump.
  // Texture patch indices are GLOBAL across TEXTURE1+TEXTURE2 in lump order
  // (patchlookup[pnamesIdx] = running texturecompositesize index).
  function readPNAMES(wad) {
    const L = wad.lump('PNAMES');
    if (!L) return [];
    const dv = new DataView(wad._buf), u8 = new Uint8Array(wad._buf);
    const o0 = L.pos, n = dv.getInt32(o0, true);
    const out = new Array(n);
    for (let i = 0; i < n; i++) out[i] = lumpName(u8, o0 + 4 + i * 8);
    return out;
  }
  // Returns { textures: [{name,width,height,comps:[{x,y,patch}]}], patchNames }
  function readTextures(wad) {
    const pnames = readPNAMES(wad);
    const lookup = new Int32Array(pnames.length).fill(-1);
    const patchNames = [];
    const textures = [];
    for (const tl of ['TEXTURE1', 'TEXTURE2']) {
      const L = wad.lump(tl);
      if (!L) continue;
      const dv = new DataView(wad._buf), u8 = new Uint8Array(wad._buf);
      const o0 = L.pos, maxoff = L.size;
      const nt = dv.getInt32(o0, true);
      for (let i = 0; i < nt; i++) {
        const off = dv.getInt32(o0 + i * 4, true);
        if (off > maxoff) throw new Error('R_InitTextures: bad texture directory in ' + tl);
        const to = o0 + off;
        const name = lumpName(u8, to);
        // On-disk maptexture_t (r_data.h): name[8], masked+pad, width@12,
        // height@14, void** columndirectory (OBSOLETE, zero)@16,
        // patchcount@20, mappatch_t[10B each: ox,oy,patch,stepdir,colormap]@22.
        const width = dv.getInt16(to + 12, true), height = dv.getInt16(to + 14, true);
        const ncomp = dv.getInt16(to + 20, true);
        const comps = new Array(ncomp);
        for (let c = 0; c < ncomp; c++) {
          const co = to + 22 + c * 10;
          const pi = dv.getInt16(co + 4, true) & 0xffff;   // index into PNAMES
          if (lookup[pi] < 0) { lookup[pi] = patchNames.length; patchNames.push(pnames[pi]); }
          comps[c] = { x: dv.getInt16(co, true), y: dv.getInt16(co + 2, true),
                       patch: lookup[pi] };
        }
        textures.push({ name, width, height, comps });
      }
    }
    return { textures, patchNames };
  }

  // Compose one texture def into row-major px (255 = hole). `patches` is the
  // patchNames array from readTextures (index -> F_START lump name).
  // Faithful to r_data.c R_GenerateComposite + R_GenerateLookup semantics
  // (same algorithm as tools/wad_assets.py ComposedTexture, which fixed this
  // in the Python pipeline — see commit b3c0023): a texture column covered by
  // EXACTLY ONE patch points straight at that patch's raw column
  // (collump[x]=patch, colofs[x]=columnofs[x]+3) and the patch's originy is
  // NEVER applied. Only multi-patch columns get an R_DrawColumnInCache
  // composite, which DOES apply originy (position = originy + topdelta,
  // clipped — no wraparound). Baking originy into single-patch columns
  // shifts the sky (SKY1: single 256x128 patch at originy=-8 → sky drawn 8px
  // too high with a garbage bottom band) and seams multi-patch walls
  // (BROWN144).
  function composeTexture(wad, def, patches) {
    const w = def.width, h = def.height;
    const px = new Uint8Array(w * h).fill(255);
    // Pass 1: resolve patches, count column coverage (patchcount[] gospel).
    // Clip x exactly like R_GenerateLookup: [max(0,x1), min(w, x1+pw)).
    const covers = new Array(w);
    for (let x = 0; x < w; x++) covers[x] = [];
    for (const c of def.comps) {
      const p = decodePatch(wad, patches[c.patch]);
      if (!p) continue;
      const x1 = c.x, x2 = x1 + p.w;
      for (let x = Math.max(0, x1); x < Math.min(w, x2); x++)
        covers[x].push({ p: p, pc: x - x1, oy: c.y });
    }
    // Pass 2: single-patch columns = raw patch column (no originy);
    // multi-patch columns = post-run walk clipped per R_DrawColumnInCache.
    for (let x = 0; x < w; x++) {
      const cl = covers[x];
      if (!cl.length) continue;
      if (cl.length === 1) {
        const { p, pc } = cl[0];
        const lim = Math.min(p.h, h);
        for (let y = 0; y < lim; y++) px[y * w + x] = p.px[y * p.w + pc];
        continue;
      }
      for (const { p, pc, oy } of cl) {
        let y = 0;
        while (y < p.h) {
          if (p.px[y * p.w + pc] === 255) { y++; continue; }
          const start = y;
          while (y < p.h && p.px[y * p.w + pc] !== 255) y++;
          let pos = oy + start, cnt = y - start;
          if (pos < 0) { cnt += pos; pos = 0; }
          if (pos + cnt > h) cnt = h - pos;
          for (let i = 0; i < cnt; i++)
            px[(pos + i) * w + x] = p.px[(start + i) * p.w + pc];
        }
      }
    }
    return px;
  }

  // ------------------------------------------------------------------ flats
  function readFlat(wad, name) {          // exactly 64*64 column-major in WAD
    const L = wad.lump(name);
    if (!L || L.size !== 4096) return null;
    return wad.lump(name).data();          // column-major; baked flats were column-major too
  }

  // ------------------------------------------------------------- PLAYPAL/BLOCK
  function readPalette(wad, lump = 'PLAYPAL') {
    const L = wad.lump(lump);
    if (!L) return null;
    const d = L.data();
    const n = d.length / 768 | 0;
    const pals = new Array(n);
    for (let p = 0; p < n; p++) {
      const t = new Array(256);
      for (let i = 0; i < 256; i++) {
        const o = p * 768 + i * 3;
        // WAD palette is 0..255; ASSETS.palette convention is 0..255 ints rgb
        t[i] = [d[o], d[o + 1], d[o + 2]];
      }
      pals[p] = t;
    }
    return pals;
  }
  function readColormaps(wad, lump = 'COLORMAP') {
    const L = wad.lump(lump);
    if (!L) return null;
    return b64(L.data());                  // 34*256 byte tables, same as ASSETS.colormaps
  }

  // --------------------------------------------------------------- maps
  const MAP_LUMPS = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS',
                     'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP'];
  function mapList(wad) {
    const out = [];
    for (let i = 0; i < wad.lumps.length; i++) {
      const n = wad.lumps[i].name;
      if (/^(E\dM\d|MAP\d\d|HM\d\d)$/.test(n) && i + 10 < wad.lumps.length) {
        let ok = true;
        for (let k = 1; k <= 10; k++)
          if (wad.lumps[i + k].name !== MAP_LUMPS[k - 1]) { ok = false; break; }
        if (ok) out.push({ name: n, index: i });
      }
    }
    return out;
  }
  // Build the engine's map-JSON shape straight from the binary lumps.
  function mapJson(wad, mapName) {
    const i = wad.find(mapName);
    if (i < 0) return null;
    const lumps = {};
    for (let k = 0; k < 10; k++)
      lumps[MAP_LUMPS[k]] = b64(wad.lumps[i + 1 + k].data());
    return { mapname: mapName, lumps };
  }

  // -------------------------------------------------------------- entry
  function load(arrayBuffer) {
    const wad = parse(arrayBuffer);
    wad._buf = arrayBuffer;
    graphicRanges(wad);
    return wad;
  }

  return { load, parse, mapList, mapJson, decodePatch, readTextures, readPNAMES,
           composeTexture, readFlat, readPalette, readColormaps, b64,
           MAP_LUMPS };
})();
if (typeof module !== 'undefined') module.exports = WAD;
