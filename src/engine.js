// ===========================================================================
// engine.js — DOOM 1.10 software renderer + map loader + blockmap/sight layer
// Faithful port of id Software linuxdoom-1.10 (r_main.c, r_bsp.c, r_segs.c,
// r_plane.c, r_draw.c, r_things.c, r_data.c, r_sky.c, tables.c, m_fixed.c,
// m_random.c, p_setup.c, p_maputl.c, p_map.c, p_sight.c) to plain JS globals.
//
// Load order: assets.js -> engine.js -> game.js -> main.js  (ARCHITECTURE.md)
// Fixed point FU = 65536; angles are unsigned 32-bit BAM (>>>0 everywhere).
// Framebuffer: global `viewbuffer` = Uint32Array(320*200), XRGB8888 with
// 0xFF alpha: pixel = 0xFF000000 | (r<<16)|(g<<8)|b after COLORMAP LUT.
// ===========================================================================
'use strict';

// --- fixed point / angle constants (m_fixed.h, tables.h, doomdef.h) --------
var FU = 65536, FRACBITS = 16, FRACUNIT = 65536;
var ANG45 = 0x20000000, ANG90 = 0x40000000, ANG180 = 0x80000000, ANG270 = 0xc0000000;
var FINEANGLES = 8192, FINEMASK = 8191, ANGLETOFINESHIFT = 19;
var SLOPERANGE = 2048, SLOPEBITS = 11, DBITS = FRACBITS - SLOPEBITS; // 5
var MAXINT = 0x7fffffff, MININT = -2147483648;
var MAXSHORT = 0x7fff;
var SCREENWIDTH = 320, SCREENHEIGHT = 200, SBARHEIGHT = 32; // doomdef.h, r_draw.c
var FIELDOFVIEW = 2048;                                    // r_main.c:48
var MINZ = FRACUNIT * 4, BASEYCENTER = 100;                // r_things.c
var MAXVISSPRITES = 128;                                   // r_things.h
var MAXDRAWSEGS = 256, MAXSEGS = 32;                       // r_defs.h, r_bsp.c
var MAXVISPLANES = 128, MAXOPENINGS = SCREENWIDTH * 64;    // r_plane.c
var SIL_BOTTOM = 1, SIL_TOP = 2, SIL_BOTH = 3;             // r_defs.h
var LIGHTLEVELS = 16, LIGHTSEGSHIFT = 4, MAXLIGHTSCALE = 48, LIGHTSCALESHIFT = 12;
var MAXLIGHTZ = 128, LIGHTZSHIFT = 20;                     // 1.10 = 20 (spec §14)
var NUMCOLORMAPS = 32, DISTMAP = 2;                        // r_main.c
var INVERSECOLORMAP = 32;                                  // p_user.c:41
var ANGLETOSKYSHIFT = 22;                                  // r_sky.h
var FF_FULLBRIGHT = 0x8000, FF_FRAMEMASK = 0x7fff;         // p_pspr.h
// mobj flags (p_mobj.h)
// p_mobj.h 1.10 values (NOT the 1.9 enum: NOSECTOR=8/NOBLOCKMAP=16,
// DROPPED=0x20000). Wrong 1.9 values made the engine link MF_NOSECTOR things
// (teleport pads, BOSSTARGETs) into sector thinglists — visible S_NULL/TROO
// "imps" on every E2M1 teleport pad.
var MF_SPECIAL = 1, MF_SOLID = 2, MF_SHOOTABLE = 4, MF_NOSECTOR = 8,
    MF_NOBLOCKMAP = 16, MF_SHADOW = 0x40000, MF_DROPPED = 0x20000,
    MF_SKULLFLY = 0x1000000, MF_TRANSLATION = 0xc000000, MF_TRANSSHIFT = 26;
// line flags (p_setup.h / doomdata.h)
var ML_BLOCKING = 1, ML_BLOCKMONSTERS = 2, ML_TWOSIDED = 4, ML_DONTPEGTOP = 8,
    ML_DONTPEGBOTTOM = 16, ML_SECRET = 32, ML_SOUNDBLOCK = 64, ML_DONTDRAW = 128,
    ML_MAPPED = 256;
var NF_SUBSECTOR = 0x8000;                                 // p_setup.h
// slopetype (p_local.h)
var ST_VERTICAL = 0, ST_HORIZONTAL = 1, ST_POSITIVE = 2, ST_NEGATIVE = 3;
// bbox indices (m_bbox.h)
// m_bbox.h order: BOXTOP, BOXBOTTOM, BOXLEFT, BOXRIGHT (bboxes are stored
// [TOP,BOTTOM,LEFT,RIGHT] on disk and in node.bbox[] — DO NOT reorder)
var BOXTOP = 0, BOXBOTTOM = 1, BOXLEFT = 2, BOXRIGHT = 3;
// blockmap (spec-game.md §1)
var MAPBLOCKUNITS = 128, MAPBLOCKSIZE = 128 * FRACUNIT, MAPBLOCKSHIFT = 23,
    MAPBMASK = MAPBLOCKSIZE - 1;
var MAXRADIUS = 32 * FRACUNIT;
// m_random.c
var PRANDMASK = 0xff;

// --- fixed point (m_fixed.c — exact: saturate pre-check, C truncation) ----
function FixedMul(a, b) {
    // C: (int)(((long long)a * b) >> FRACBITS) — arithmetic shift FLOORS
    // toward -inf. Math.trunc (toward zero) is off by one for every
    // negative non-exact product, e.g. FixedMul(-3000000,1): C=-46,
    // trunc=-45. That silently shifted friction/thrust every tic (player
    // drifts off vanilla routes). f64 product is exact under 2^53, so the
    // fast path holds for |a|,|b| < 2^26; BigInt covers the rest.
    if (a > -67108864 && a < 67108864 && b > -67108608 && b < 67108608)
        return Math.floor(a * b / 65536) | 0;
    return Number(BigInt(a | 0) * BigInt(b | 0) >> 16n) | 0;
}
function FixedDiv(a, b) {
    a = a | 0; b = b | 0;
    // C: if ((abs(a)>>14) >= abs(b)) return (a^b)<0 ? MININT : MAXINT;
    // (abs(INT_MIN) == INT_MIN on glibc — replicated with |0 for fidelity)
    var aa = (a === MININT ? MININT : (a < 0 ? -a : a)) | 0;
    var ab = (b === MININT ? MININT : (b < 0 ? -b : b)) | 0;
    if (((aa >> 14) | 0) >= ab)
        return (a ^ b) < 0 ? MININT : MAXINT;
    // FixedDiv2: double division, truncate toward zero; in 1.10 C an
    // out-of-int32 result is I_Error — unreachable here, saturate as guard.
    var c = a / b * 65536;
    if (c >= 2147483648 || c < -2147483648) return (a ^ b) < 0 ? MININT : MAXINT;
    return Math.trunc(c) | 0;
}
// tables.c SlopeDiv — unsigned, truncating. num<<3 may exceed int32 in C only
// for num >= 2^28 (never in practice); f64 division is exact here.
function SlopeDiv(num, den) {
    num = num >>> 0; den = den >>> 0;
    if (den < 512) return SLOPERANGE;
    var ans = Math.floor(num * 8 / (den >>> 8));
    return ans <= SLOPERANGE ? ans : SLOPERANGE;
}

// --- random (m_random.c — verbatim) ----------------------------------------
var rndtable = [0,8,109,220,222,241,149,107,75,248,254,140,16,66,74,21,211,
47,80,242,154,27,205,128,161,89,77,36,95,110,85,48,212,140,211,249,22,79,
200,50,28,188,52,140,202,120,68,145,62,70,184,190,91,197,152,224,149,104,25,
178,252,182,202,182,141,197,4,81,181,242,145,42,39,227,156,198,225,193,219,
93,122,175,249,0,175,143,70,239,46,246,163,53,163,109,168,135,2,235,25,92,
20,145,138,77,69,166,78,176,173,212,166,113,94,161,41,50,239,49,111,164,70,
60,2,37,171,75,136,156,11,56,42,146,138,229,73,146,77,61,98,196,135,106,63,
197,195,86,96,203,113,101,170,247,181,113,80,250,108,7,255,237,129,226,79,
107,112,166,103,241,24,223,239,120,198,58,60,82,128,3,184,66,143,224,145,
224,81,206,163,45,63,90,168,114,59,33,159,95,28,139,123,98,125,196,15,70,
194,253,54,14,109,226,71,17,161,93,186,87,244,138,20,52,123,251,26,36,17,46,
52,231,232,76,31,221,84,37,216,165,212,106,197,242,98,43,39,175,254,145,190,
84,118,222,187,136,120,163,236,249];
// verbatim from m_random.c (256 entries).
var rndindex = 0;    // M_Random counter
var prndindex = 0;   // P_Random counter — SEPARATE index, same table (C)
function M_Random() { rndindex = (rndindex + 1) & PRANDMASK; return rndtable[rndindex]; }
function P_Random() { prndindex = (prndindex + 1) & PRANDMASK; return rndtable[prndindex]; }
function M_ClearRandom() { rndindex = prndindex = 0; }

// --- trig tables -----------------------------------------------------------
// tables.c ships hand-tuned 1995 literals; JS Math.sin/tan/atan does NOT
// reproduce them (finesine: 33 entries off by 1, finetangent: 204, tantoangle:
// 1880/2049 — up to 1 BAM, enough to rotate monster aim and shift routes).
// src/tables.js (tools/extract_tables.py) embeds them verbatim; the
// computed generation remains only as a headless-fallback if it is missing.
var finesine = new Int32Array(5 * FINEANGLES / 4);
var finetangent = new Int32Array(FINEANGLES / 2);
var tantoangle = new Int32Array(SLOPERANGE + 1);
(function R_InitTables() {
    var i, vt = (typeof VANILLA_TABLES !== 'undefined') ? VANILLA_TABLES : null;
    if (vt) {
        finesine.set(vt.finesine);
        finetangent.set(vt.finetangent);
        tantoangle.set(vt.tantoangle);
        return;
    }
    for (i = 0; i < 5 * FINEANGLES / 4; i++)
        finesine[i] = (FRACUNIT * Math.sin((i + 0.5) * 2 * Math.PI / FINEANGLES)) | 0;
    for (i = 0; i < FINEANGLES / 2; i++)
        finetangent[i] = (FRACUNIT * Math.tan((i - FINEANGLES / 4 + 0.5) * 2 * Math.PI / FINEANGLES)) | 0;
    for (i = 0; i <= SLOPERANGE; i++)
        tantoangle[i] = Math.trunc(Math.atan(i / SLOPERANGE) / (3.141592657 * 2) * 0x100000000) >>> 0;
})();
// finecosine = &finesine[FINEANGLES/4] — offset view (r_main.c:113)
var finecosine = finesine.subarray ? finesine.subarray(FINEANGLES / 4) : finesine;

// --- base64 decode (browser atob / node Buffer) ----------------------------
function b64decode(s) {
    var len = s.length;
    while (len > 0 && s.charCodeAt(len - 1) === 61) len--; // strip '='
    var out = new Uint8Array((len * 3) >> 2);
    var a = new Int32Array(128), i, c;
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    if (!a[65]) for (i = 0; i < 64; i++) a[A.charCodeAt(i)] = i;
    if (typeof Buffer !== 'undefined') {
        var b = Buffer.from(s.slice(0, len), 'base64');
        out.set(b);
        return out;
    }
    var v = 0, bits = 0, o = 0;
    for (i = 0; i < len; i++) {
        v = (v << 6) | a[s.charCodeAt(i)];
        bits += 6;
        if (bits >= 8) { bits -= 8; out[o++] = (v >> bits) & 255; }
    }
    return out;
}

// --- indexed-pixel → post/pcolumn encoder ----------------------------------
// Builds the 1.10 masked-patch post structure in spirit: per column a list of
// posts [topdelta, length, pixStart] into a flat pixel array; value 255 is the
// transparent sentinel (skipped, never blended — ARCHITECTURE.md).
function buildPosts(px, w, h) {
    var cols = new Array(w), pix = [];
    for (var x = 0; x < w; x++) {
        var posts = [], prevEnd = 0, y = 0;
        while (y < h) {
            if (px[y * w + x] === 255) { y++; continue; }
            var start = y;
            while (y < h && px[y * w + x] !== 255) y++;
            var runEnd = y;
            while (start < runEnd) {
                if (start >= prevEnd) {
                    var len = runEnd - start; if (len > 255) len = 255;
                    posts.push([start - prevEnd, len, pix.length]);
                    for (var k = 0; k < len; k++) pix.push(px[(start + k) * w + x]);
                    prevEnd = start + len; start += len;
                } else {
                    // overlapping post in C corrupts; clip to prevEnd instead
                    start = prevEnd;
                }
            }
        }
        cols[x] = posts;
    }
    return { pix: pix, cols: cols };
}

// --- asset tables built from ASSETS (by NAME — documented pipeline change) -
// texture / flat name → index (R_*NumForName: -1 unknown; flats: caller maps
// -1 → 0 per ARCHITECTURE.md).
var texturenames = [], flatnames = [];
var numtextures = 0;       // = texturenames.length (ARCHITECTURE.md)
var texturewidth = [], textureheight = [], texturewidthmask = [], texturestride = [];
var texturepix = [];      // indexed pixels per texture (full-bitmap)
var textureposts = [];    // post columns for hole-bearing textures (null = solid)
var flatpix = [];         // decoded flat pixels
var skyflatnum = -1, skytexture = -1;
var skyBands = [];        // F_SKY1 columns as gradient bands (deviation, §sky)
var texturetranslation, flattranslation;

function R_FlatNumForName(name) {
    // vanilla strcasecmp (e1m2/e1m4 sidedefs carry lowercase names)
    var up = (name || '').toUpperCase();
    for (var i = 0; i < flatnames.length; i++) if (flatnames[i] === up) return i;
    return -1;
}
function R_TextureNumForName(name) {
    // r_data.c R_CheckTextureNumForName: ""/"-"/"AAAAAAAA" == texture 0
    // (the missing-texture slot, never drawn: `if (toptexture)` etc.)
    if (!name || name[0] === '-') return 0;
    var up = name.toUpperCase();
    for (var i = 0; i < texturenames.length; i++) if (texturenames[i] === up) return i;
    return -1;
}
function R_InitData() {
    var k, d, i;
    texturenames = Object.keys(ASSETS.textures);   // numtextures order
    numtextures = texturenames.length;
    for (i = 0; i < texturenames.length; i++) {
        d = ASSETS.textures[texturenames[i]];
        var px = b64decode(d[2]);
        // Generator stores textures row-major (y*w+x); the id column drawer
        // (R_GetColumn + R_DrawColumn) walks a COLUMN linearly:
        // src[col*stride + row]. Transpose once at load, and replicate r_data.c
        // doubling (textures <128 wide are stored repeated to 128 columns) so
        // the drawer's `(frac>>FRACBITS)&127` quirk wraps in-texture exactly
        // like vanilla instead of bleeding into the neighbouring column.
        var tw = d[0], th = d[1];
        if (px.length === tw * th) {
            // Post chain for the masked pass (r_data.c parity): vanilla
            // R_GenerateLookup points R_GetColumn at the patch post data and
            // R_DrawMaskedColumn's inter-post gaps ARE the knockout. Rebuild
            // the same structure from the 255 sentinel holes; solid columns
            // collapse to one full-height post, so only hole-bearing
            // textures get the (lazily sized) posts table.
            var hasHole = false;
            for (var hp = 0; hp < px.length; hp++)
                if (px[hp] === 255) { hasHole = true; break; }
            textureposts[i] = hasHole ? buildPosts(px, tw, th) : null;
            var dup = 1;
            while (tw * dup < 128) dup += dup;      // r_data.c doubles to >=128
            var cm = new Uint8Array(tw * dup * th);
            for (var yy = 0; yy < th; yy++)
                for (var xx = 0; xx < tw; xx++) {
                    var v = px[yy * tw + xx];
                    // solid tiers (R_DrawColumn) read the bitmap contiguously:
                    // holes hold index 0, matching the previous baked assets
                    if (v === 255) v = 0;
                    for (var dd = 0; dd < dup; dd++)
                        cm[(xx + dd * tw) * th + yy] = v;
                }
            texturepix[i] = cm;
            texturestride[i] = th;                  // bytes per column block
        } else {
            texturepix[i] = px;                     // already column-major blob
            texturestride[i] = px.length / tw;
        }
        texturewidth[i] = d[0];
        textureheight[i] = d[1] << FRACBITS;       // fixed (r_data.c)
        var j = 1;
        while (j < d[0]) j += j;
        texturewidthmask[i] = j - 1;               // r_data.c doubling
    }
    flatnames = Object.keys(ASSETS.flats);
    // DEVIATION: move F_SKY1 last so unknown-flat -> 0 (ARCHITECTURE.md)
    // resolves to a real flat, as 'F_SKY1' is never a valid unknown default.
    var skyi = flatnames.indexOf('F_SKY1');
    if (skyi >= 0) { flatnames.push(flatnames[skyi]); flatnames.splice(skyi, 1); }
    for (i = 0; i < flatnames.length; i++)
        flatpix[i] = b64decode(ASSETS.flats[flatnames[i]][2]);
    numflats = flatnames.length;
    skyflatnum = R_FlatNumForName('F_SKY1');       // p_setup.c P_SetupLevel
    // real SKY1 texture (WAD SKY1 patch through TEXTURE1); vanilla picks
    // SKY1-4 per episode (SKY1-3 per map range in DOOM 2) in g_game.c —
    // game.js G_InitNew computes the name into G.skyTextureName (gamedef
    // equivalent); shareware default SKY1 when absent.
    skytexture = R_TextureNumForName(
      (typeof G !== 'undefined' && G.skyTextureName) || 'SKY1');
    if (skytexture <= 0) skytexture = 0;   // stand-in: texture 0 (black)
    texturetranslation = new Int32Array(texturenames.length + 1);
    for (i = 0; i <= texturenames.length; i++) texturetranslation[i] = i;
    // name lookup missed (-1): treat like C's missing-texture slot 0 (black)
    texturetranslation[0] = 0;
    flattranslation = new Int32Array(flatnames.length + 1);
    for (i = 0; i <= flatnames.length; i++) flattranslation[i] = i;
    // Sky: documented deviation — no composited SKY1 texture. Build 16
    // vertical-gradient band columns from the F_SKY1 flat; each screen column
    // picks a band by view angle exactly like R_DrawPlanes sky (>>22), so the
    // horizon scrolls with yaw like the real thing.
    skyBands = [];
    var sf = b64decode(ASSETS.flats.F_SKY1[2]);
    for (i = 0; i < 16; i++) {
        var col = new Uint8Array(128);
        for (var y = 0; y < 128; y++) col[y] = sf[y * 64 + i * 4];
        skyBands.push(col);
    }
    // black stand-in texture for names that resolved to -1 (draws black;
    // C maps unknown names to its flat-black TFLAMMA0 lump)
    var blacktex = new Uint8Array(128 * 128);
    texturepix[texturenames.length] = blacktex;
    texturewidth[texturenames.length] = 128;
    textureheight[texturenames.length] = 128 << FRACBITS;
    texturewidthmask[texturenames.length] = 127;
}

// texturetranslation with the -1 -> black-stand-in clamp; the translation
// itself is gospel (r_segs.c:459/573/...: texturetranslation[sidedef->midtexture]) —
// P_InitPicAnims + P_UpdateSpecials rewrite entries to animate textures.
function texTr(t) { return texturetranslation[t < 0 ? texturenames.length : t]; }

// --- column source for walls: returns [pixArray, byteOffset] (a "dc_source")
function R_GetColumn(tex, col) {
    // R_GetColumn: col &= texturewidthmask[tex]  (arithmetic wrap, C %)
    var w = texturewidth[tex], hpx = texturestride[tex];
    col = ((col % w) + w) % w;
    // single-run "post" covering the full texture height
    return [texturepix[tex], col * hpx | 0, hpx | 0];
}

// --- colormaps / pixel LUT --------------------------------------------------
// 1.10 colormaps is 34x256 byte tables (0=darkest .. 31=bright, 32=inverse,
// 33=pickup-flash). There is NO R_InstallColormap in 1.10 (§16); the real
// mechanism is player->fixedcolormap + scalelightfixed (R_SetupFrame).
// A "colormap" here = table index (0 = none/unset like the C NULL, truthy =
// table number). Pixel write: viewbuffer[i] = PIX_LUT[colormaps[tbl][src]].
var numflats = 0;
var COLORMAPS = null;      // Uint8Array 34*256 (exposed as global `colormaps`)
var colormaps = null;      // alias per ARCHITECTURE.md / r_data.c naming
var PIX_LUT = new Int32Array(65536);  // (tbl<<8|src) -> 0xFFrrggbb
// Orientation flag: C ships colormaps[0]=fullbright (index==level, larger =
// darker). ASSETS.colormaps documents "0..31 dark->full light" per
// ARCHITECTURE.md — if detection finds table 31 (not 0) as the identity map,
// every light-table level L is remapped to 31-L at table-build time.
// FULLCOLORMAP is byte offset of the fullbright table (32 per ASSETS docs).
var CMAP_ORDER_C = true;
var FULLCOLORMAP = 32 << 8;
function cmapLevel(L) { return CMAP_ORDER_C ? L : 31 - L; }
// R_InstallColormap: spec-render §16 — does NOT exist in 1.10 (added in
// 1.2+/finaldoom). 1.10 uses player->fixedcolormap + scalelightfixed only;
// kept as a no-op alias so callers matching later-version docs don't crash.
function R_InstallColormap(map) { /* 1.10: nothing to install */ }

function R_InitColormaps() {
    COLORMAPS = b64decode(ASSETS.colormaps);
    colormaps = COLORMAPS;
    // detect level order: identity table == fullbright == C table 0
    var t0id = true, t31id = true, s;
    for (s = 0; s < 256; s++) {
        if (COLORMAPS[s] !== s) t0id = false;
        if (COLORMAPS[31 * 256 + s] !== s) t31id = false;
    }
    CMAP_ORDER_C = !(!t0id && t31id);
    if (CMAP_ORDER_C) FULLCOLORMAP = 0;          // real WAD: table 0 = fullbright
    else FULLCOLORMAP = 32 << 8;                 // ASSETS docs: table 32
    var pal = ASSETS.palette;
    buildPixLut(pal);
}

// I_SetPalette equivalent: rebuild PIX_LUT from the given 256-color table.
// Called on ST_doPaletteStuff palette changes (pickup flash, pain red,
// radiation). Cheap: 34*256 entries, only on actual changes.
var paletteVersion = 0;   // bump on every palette change (back-screen cache)
function buildPixLut(pal) {
    paletteVersion++;
    fuzzCache = null;   // fuzz cache inverts PIX_LUT; rebuild for new palette
    var p255 = pal[255];
    for (var t = 0; t < 34; t++) {
        for (var s = 0; s < 256; s++) {
            var c = COLORMAPS[t * 256 + s];
            // palette index 255 is the sprite-transparent sentinel: never
            // emitted by a post (posts exclude it); walls/flats mapping 255
            // would draw the sentinel colour exactly like the WAD.
            var rgb = pal[c] || p255;
            // ImageData bytes are R,G,B,A in memory; viewbuffer is a
            // Uint32Array over those bytes and x86 is little-endian, so the
            // u32 must be 0xFFbbggrr — packing rgb<<16 swaps R/B on screen.
            PIX_LUT[(t << 8) | s] = 0xff000000 | (rgb[2] << 16) | (rgb[1] << 8) | rgb[0];
        }
    }
}

// --- translation tables (r_draw.c R_InitTranslationTables — verbatim) ------
var translationtables = new Uint8Array(256 * 3);
function R_InitTranslationTables() {
    for (var i = 0; i < 256; i++) {
        if (i >= 0x70 && i <= 0x7f) { // translate just the 16 greens
            translationtables[i] = 0x60 + (i & 0xf);       // gray
            translationtables[i + 256] = 0x40 + (i & 0xf); // brown
            translationtables[i + 512] = 0x20 + (i & 0xf); // red
        } else {
            translationtables[i] = translationtables[i + 256] =
                translationtables[i + 512] = i;
        }
    }
}

// --- blockmap grid (blocklinks) --------------------------------------------
var blocklinks = [];       // Int-ish refs: blocklinks[y*bmapwidth+x] = head mobj
var visThinkers = [];      // engine fallback sprite list (see R_AddSprites note)
var thingHeadNode = { sector: { thinglist: null } };  // p_local headnode trick
function blockIndexAt(x, y) {
    var bx = ((x - bmaporgx) >> MAPBLOCKSHIFT) | 0;
    var by = ((y - bmaporgy) >> MAPBLOCKSHIFT) | 0;
    if (bx < 0 || by < 0 || bx >= bmapwidth || by >= bmapheight) return -1;
    return by * bmapwidth + bx;
}
// p_map.c P_UnsetThingPosition — exact unlink order. The C headnode trick
// (p_local.h headnode) routes out-of-range things into one shared sector +
// block list; _blkIdx < 0 marks "on the headnode block list".
function P_UnsetThingPosition(mobj) {
    if (!(mobj.flags & MF_NOSECTOR)) {
        if (mobj.snext) mobj.snext.sprev = mobj.sprev;
        if (mobj.sprev) mobj.sprev.snext = mobj.snext;
        else if (mobj._secList) mobj._secList.thinglist = mobj.snext;
    }
    if (!(mobj.flags & MF_NOBLOCKMAP)) {
        if (mobj.bnext) mobj.bnext.bprev = mobj.bprev;
        if (mobj.bprev) mobj.bprev.bnext = mobj.bnext;
        else if (mobj._blkIdx >= 0) blocklinks[mobj._blkIdx] = mobj.bnext;
        else if (mobj._blkIdx === -1) thingHeadNode.bnext = mobj.bnext;
    }
    mobj.snext = mobj.sprev = mobj.bnext = mobj.bprev = null;
    mobj._secList = null; mobj._blkIdx = undefined;
}
// p_map.c P_SetThingPosition — link into blockmap cell + sector thinglist
function P_SetThingPosition(mobj) {
    var ssi = R_PointInSubsector(mobj.x, mobj.y);
    P_UnsetThingPosition(mobj);
    mobj.subsector = subsectors[ssi];
    var flags = mobj.flags;
    if (!(flags & MF_NOSECTOR)) {
        var head = mobj.subsector.sector, link;
        link = head.thinglist || null;
        mobj.snext = link; mobj.sprev = null;
        if (link) link.sprev = mobj;
        head.thinglist = mobj;
        mobj._secList = head;
    }
    if (!(flags & MF_NOBLOCKMAP)) {
        var b = blockIndexAt(mobj.x, mobj.y);
        var bl = b < 0 ? (thingHeadNode.bnext || null) : (blocklinks[b] || null);
        mobj.bnext = bl; mobj.bprev = null;
        if (bl) bl.bprev = mobj;
        if (b < 0) thingHeadNode.bnext = mobj; else blocklinks[b] = mobj;
        mobj._blkIdx = b;
    }
}

// ===========================================================================
// MAP LOADER (p_setup.c — THINGS handled by game.js; we store raw things)
// ===========================================================================
var mapdata = null;
var vertexes = [], linedefs = [], sides = [], sectors = [], segs = [],
    subsectors = [], nodes = [];
var numvertexes = 0, numlines = 0, numsides = 0, numsectors = 0,
    numsegs = 0, numsubsectors = 0, numnodes = 0;
var reject = null;
var blockmaplump = null, blockmap = null, bmaporgx = 0, bmaporgy = 0,
    bmapwidth = 0, bmapheight = 0;
var things = [];           // raw THINGS records (game.js spawns them)
var validcount = 1;        // r_main.c — bumped in R_SetupFrame

function name8(bytes, off) {
    var s = '';
    for (var i = 0; i < 8; i++) {
        var c = bytes[off + i];
        if (!c) break;
        s += String.fromCharCode(c);
    }
    return s;
}

function loadMap(jsonObj) {
    R_InitData();
    R_InitColormaps();
    R_InitTranslationTables();

    var L = jsonObj.lumps;
    var dv;

    // ---- VERTEXES (4 B) ----
    dv = new DataView(b64decode(L.VERTEXES).buffer);
    numvertexes = dv.byteLength / 4 | 0;
    vertexes = new Array(numvertexes);
    for (var i = 0; i < numvertexes; i++) {
        vertexes[i] = { x: dv.getInt16(i * 4, true) << FRACBITS,
                        y: dv.getInt16(i * 4 + 2, true) << FRACBITS };
    }

    // ---- SECTORS (26 B) ----
    dv = new DataView(b64decode(L.SECTORS).buffer);
    numsectors = dv.byteLength / 26 | 0;
    sectors = new Array(numsectors);
    for (i = 0; i < numsectors; i++) {
        var o = i * 26;
        sectors[i] = {
            floorheight: dv.getInt16(o, true) << FRACBITS,
            ceilingheight: dv.getInt16(o + 2, true) << FRACBITS,
            floorpic: R_FlatNumForName(name8(new Uint8Array(dv.buffer), o + 4)),
            ceilingpic: R_FlatNumForName(name8(new Uint8Array(dv.buffer), o + 12)),
            lightlevel: dv.getInt16(o + 20, true),
            special: dv.getInt16(o + 22, true),
            tag: dv.getInt16(o + 24, true),
            soundtraversed: 0, validcount: 0, tag_untouched: 0,
            linecount: 0, lines: null, thinglist: null,
            soundorg: { x: 0, y: 0 }, blockbox: [0, 0, 0, 0]
        };
        // unknown flat name -> flat 0 (ARCHITECTURE.md)
        if (sectors[i].floorpic < 0) sectors[i].floorpic = 0;
        if (sectors[i].ceilingpic < 0) sectors[i].ceilingpic = 0;
    }

    // ---- SIDEDEFS (30 B) ----
    dv = new DataView(b64decode(L.SIDEDEFS).buffer);
    numsides = dv.byteLength / 30 | 0;
    sides = new Array(numsides);
    var sb = new Uint8Array(dv.buffer);
    for (i = 0; i < numsides; i++) {
        o = i * 30;
        sides[i] = {
            textureoffset: dv.getInt16(o, true) << FRACBITS,
            rowoffset: dv.getInt16(o + 2, true) << FRACBITS,
            toptexture: R_TextureNumForName(name8(sb, o + 4)),
            bottomtexture: R_TextureNumForName(name8(sb, o + 12)),
            midtexture: R_TextureNumForName(name8(sb, o + 20)),
            sector: sectors[dv.getInt16(o + 28, true)]
        };
    }

    // ---- LINEDEFS (14 B) ----
    dv = new DataView(b64decode(L.LINEDEFS).buffer);
    numlines = dv.byteLength / 14 | 0;
    linedefs = new Array(numlines);
    for (i = 0; i < numlines; i++) {
        o = i * 14;
        var v1 = vertexes[dv.getInt16(o, true)],
            v2 = vertexes[dv.getInt16(o + 2, true)];
        var sn0 = dv.getInt16(o + 10, true), sn1 = dv.getInt16(o + 12, true);
        var dx = v2.x - v1.x, dy = v2.y - v1.y;
        var slope;
        if (!dx) slope = ST_VERTICAL;
        else if (!dy) slope = ST_HORIZONTAL;
        else slope = FixedDiv(dy, dx) > 0 ? ST_POSITIVE : ST_NEGATIVE;
        var front = sn0 === -1 ? null : sides[sn0].sector;
        var back = sn1 === -1 ? null : sides[sn1].sector;
        linedefs[i] = {
            num: i,                                   // ld-lines index (p_map.c)
            v1: v1, v2: v2, dx: dx, dy: dy,
            slopetype: slope,
            frontsector: front, backsector: back,
            validcount: 0,
            sidenum: [sn0, sn1],
            // P_CloneLine special fields exist for later gameplay port
            special: dv.getInt16(o + 6, true),
            tag: dv.getInt16(o + 8, true),
            flags: dv.getInt16(o + 4, true),
            health: 0, hitcount: 0
        };
        linedefs[i].bbox = [
            v1.x < v2.x ? v1.x : v2.x, v1.x > v2.x ? v1.x : v2.x,
            v1.y < v2.y ? v1.y : v2.y, v1.y > v2.y ? v1.y : v2.y
        ];
    }

    // ---- SSECTORS (4 B) ----
    dv = new DataView(b64decode(L.SSECTORS).buffer);
    numsubsectors = dv.byteLength / 4 | 0;
    subsectors = new Array(numsubsectors);
    for (i = 0; i < numsubsectors; i++) {
        subsectors[i] = {
            numlines: dv.getInt16(i * 4, true),
            firstline: dv.getInt16(i * 4 + 2, true),
            sector: null,
            _oob: false
        };
    }

    // ---- NODES (28 B) — children u16, NF_SUBSECTOR & 0x7fff (P_LoadNodes
    // casts to short: 0x8000 -> -32768 handled by the bspnum==-1 quirk) ----
    dv = new DataView(b64decode(L.NODES).buffer);
    numnodes = dv.byteLength / 28 | 0;
    nodes = new Array(numnodes);
    for (i = 0; i < numnodes; i++) {
        o = i * 28;
        var bb = new Int32Array(8);
        for (var c = 0; c < 8; c++) bb[c] = dv.getInt16(o + 8 + c * 2, true) << FRACBITS;
        nodes[i] = {
            x: dv.getInt16(o, true) << FRACBITS,
            y: dv.getInt16(o + 2, true) << FRACBITS,
            dx: dv.getInt16(o + 4, true) << FRACBITS,
            dy: dv.getInt16(o + 6, true) << FRACBITS,
            // bbox[child][BOXLEFT..RIGHT..TOP..BOTTOM]
            bbox: [bb.subarray(0, 4), bb.subarray(4, 8)],
            // C SHORT() yields a positive int (16-bit value promoted, no
            // signed cast in d_main.h), so 0x8000|sid stays 0x8000|sid here
            children: [dv.getUint16(o + 24, true),
                       dv.getUint16(o + 26, true)]
        };
    }

    // ---- SEGS (12 B) ----
    dv = new DataView(b64decode(L.SEGS).buffer);
    numsegs = dv.byteLength / 12 | 0;
    segs = new Array(numsegs);
    for (i = 0; i < numsegs; i++) {
        o = i * 12;
        // layout: v1:i16 v2:i16 angle:u16(BAM<<16) linedef:i16 side:i16 offset:i16
        var ld = linedefs[dv.getInt16(o + 6, true)];
        var side = dv.getInt16(o + 8, true);
        var sd = sides[ld.sidenum[side]];
        segs[i] = {
            v1: vertexes[dv.getInt16(o, true)],
            v2: vertexes[dv.getInt16(o + 2, true)],
            angle: (dv.getUint16(o + 4, true) << 16) >>> 0,
            linedef: ld,
            sidx: side,
            sidedef: sd,
            offset: dv.getInt16(o + 10, true) << FRACBITS,
            frontsector: sd.sector,
            // P_LoadSegs: backsector gated on ML_TWOSIDED flag (spec-game §1)
            backsector: (ld.flags & ML_TWOSIDED) && ld.sidenum[side ^ 1] !== -1
                ? sides[ld.sidenum[side ^ 1]].sector : null
        };
    }

    // ---- THINGS (10 B) raw ----
    dv = new DataView(b64decode(L.THINGS).buffer);
    things = [];
    for (i = 0; i < dv.byteLength / 10; i++) {
        o = i * 10;
        things.push({ x: dv.getInt16(o, true), y: dv.getInt16(o + 2, true),
                      angle: dv.getInt16(o + 4, true), type: dv.getInt16(o + 6, true),
                      options: dv.getInt16(o + 8, true) });
    }

    // ---- REJECT ----
    reject = b64decode(L.REJECT);

    // ---- BLOCKMAP ----
    var bl = new Int16Array(b64decode(L.BLOCKMAP).buffer);
    blockmaplump = bl;
    blockmap = bl.subarray(4);
    bmaporgx = bl[0] << FRACBITS;
    bmaporgy = bl[1] << FRACBITS;
    bmapwidth = bl[2];
    bmapheight = bl[3];
    blocklinks = new Array(bmapwidth * bmapheight);
    for (i = 0; i < blocklinks.length; i++) blocklinks[i] = null;

    // things that fall out of the node range land in subsector 0 (C
    // R_PointInSubsector doesn't check; keep, but flag those subsectors as
    // "out of bounds" holders like the headnode trick for mobjs)
    mapdata = {
        vertexes: vertexes, linedefs: linedefs, sides: sides, sectors: sectors,
        segs: segs, subsectors: subsectors, nodes: nodes,
        numnodes: numnodes, root: numnodes ? nodes[numnodes - 1] : null,
        reject: reject, things: things,
        blockmap: { orgx: bmaporgx, orgy: bmaporgy, width: bmapwidth,
                    height: bmapheight, lineLists: blockmaplump }
    };

    P_GroupLines();
    R_InstallLevelSprites();
    return mapdata;
}

// p_setup.c P_GroupLines — exact (degenerate lines double-counted in build)
function P_GroupLines() {
    var i, j, total = 0, bbox = new Int32Array(4);
    for (i = 0; i < numsubsectors; i++)
        subsectors[i].sector = segs[subsectors[i].firstline].sidedef.sector;
    for (i = 0; i < numlines; i++) {
        var li = linedefs[i];
        total++;
        if (li.frontsector) li.frontsector.linecount++;
        if (li.backsector && li.backsector !== li.frontsector) { li.backsector.linecount++; total++; }
    }
    var linebuffer = new Array(total);
    var lb = 0;
    for (i = 0; i < numsectors; i++) {
        var sector = sectors[i];
        bbox[BOXLEFT] = bbox[BOXRIGHT] = bbox[BOXTOP] = bbox[BOXBOTTOM] = 0;
        sector.lines = new Array(sector.linecount);
        var k = 0;
        for (j = 0; j < numlines; j++) {
            li = linedefs[j];
            if (li.frontsector === sector || li.backsector === sector) {
                sector.lines[k++] = li;
                // M_AddToBox
                if (k === 1) { bbox[BOXLEFT] = bbox[BOXRIGHT] = li.v1.x;
                               bbox[BOXTOP] = bbox[BOXBOTTOM] = li.v1.y; }
                if (li.v1.x < bbox[BOXLEFT]) bbox[BOXLEFT] = li.v1.x;
                if (li.v1.x > bbox[BOXRIGHT]) bbox[BOXRIGHT] = li.v1.x;
                if (li.v1.y < bbox[BOXBOTTOM]) bbox[BOXBOTTOM] = li.v1.y;
                if (li.v1.y > bbox[BOXTOP]) bbox[BOXTOP] = li.v1.y;
                if (li.v2.x < bbox[BOXLEFT]) bbox[BOXLEFT] = li.v2.x;
                if (li.v2.x > bbox[BOXRIGHT]) bbox[BOXRIGHT] = li.v2.x;
                if (li.v2.y < bbox[BOXBOTTOM]) bbox[BOXBOTTOM] = li.v2.y;
                if (li.v2.y > bbox[BOXTOP]) bbox[BOXTOP] = li.v2.y;
            }
        }
        // C asserts k == linecount (degenerate maps can differ; warn only)
        // p_setup.c:556 — soundorg stays in FIXED-POINT (like every mobj
        // origin); S_AdjustSoundParams subtracts it from listener->x/y.
        // The old >>FRACBITS made door/switch sounds appear ~65536 units
        // from the player -> clipped by S_CLIPPING_DIST -> silent doors.
        sector.soundorg = { x: ((bbox[BOXRIGHT] + bbox[BOXLEFT]) / 2) | 0,
                            y: ((bbox[BOXTOP] + bbox[BOXBOTTOM]) / 2) | 0 };
        var block;
        block = (bbox[BOXTOP] - bmaporgy + MAXRADIUS) >> MAPBLOCKSHIFT;
        sector.blockbox[BOXTOP] = block >= bmapheight ? bmapheight - 1 : block;
        block = (bbox[BOXBOTTOM] - bmaporgy - MAXRADIUS) >> MAPBLOCKSHIFT;
        sector.blockbox[BOXBOTTOM] = block < 0 ? 0 : block;
        block = (bbox[BOXRIGHT] - bmaporgx + MAXRADIUS) >> MAPBLOCKSHIFT;
        sector.blockbox[BOXRIGHT] = block >= bmapwidth ? bmapwidth - 1 : block;
        block = (bbox[BOXLEFT] - bmaporgx - MAXRADIUS) >> MAPBLOCKSHIFT;
        sector.blockbox[BOXLEFT] = block < 0 ? 0 : block;
    }
}

// p_maputl.c — P_PointOnLineSide / P_PointOnDivlineSide / P_BoxOnLineSide
function P_PointOnLineSide(x, y, line) {
    if (!line.dx) return x <= line.v1.x ? (line.dy > 0 ? 0 : 1) : (line.dy < 0 ? 0 : 1);
    if (!line.dy) return y <= line.v1.y ? (line.dx < 0 ? 1 : 0) : (line.dx > 0 ? 0 : 1);
    var dx = x - line.v1.x, dy = y - line.v1.y;
    if (((line.dy ^ line.dx ^ dx ^ dy) & 0x80000000))
        return ((line.dy ^ dx) & 0x80000000) ? 1 : 0;
    var left = FixedMul(line.dy >> 8, dx >> 8);
    var right = FixedMul(dy >> 8, line.dx >> 8);
    return right < left ? 0 : 1;
}
function P_PointOnDivlineSide(x, y, dl) {
    if (!dl.dx) return x <= dl.x ? (dl.dy > 0 ? 0 : 1) : (dl.dy < 0 ? 0 : 1);
    if (!dl.dy) return y <= dl.y ? (dl.dx < 0 ? 1 : 0) : (dl.dx > 0 ? 0 : 1);
    var dx = x - dl.x, dy = y - dl.y;
    if (((dl.dy ^ dl.dx ^ dx ^ dy) & 0x80000000))
        return ((dl.dy ^ dx) & 0x80000000) ? 1 : 0;
    var left = FixedMul(dl.dy >> 8, dx >> 8);
    var right = FixedMul(dy >> 8, dl.dx >> 8);
    return right < left ? 0 : 1;
}
function P_BoxOnLineSide(tmbox, ld) {
    var p1, p2;
    switch (ld.slopetype) {
      case ST_HORIZONTAL:
        p1 = tmbox[BOXTOP] > ld.v1.y ? 1 : 0;
        p2 = tmbox[BOXBOTTOM] > ld.v1.y ? 1 : 0;
        if (ld.dx < 0) { p1 ^= 1; p2 ^= 1; }
        break;
      case ST_VERTICAL:
        p1 = tmbox[BOXRIGHT] < ld.v1.x ? 1 : 0;
        p2 = tmbox[BOXLEFT] < ld.v1.x ? 1 : 0;
        if (ld.dy < 0) { p1 ^= 1; p2 ^= 1; }
        break;
      case ST_POSITIVE:
        p1 = P_PointOnLineSide(tmbox[BOXLEFT], tmbox[BOXTOP], ld);
        p2 = P_PointOnLineSide(tmbox[BOXRIGHT], tmbox[BOXBOTTOM], ld);
        break;
      default: // ST_NEGATIVE
        p1 = P_PointOnLineSide(tmbox[BOXRIGHT], tmbox[BOXTOP], ld);
        p2 = P_PointOnLineSide(tmbox[BOXLEFT], tmbox[BOXBOTTOM], ld);
        break;
    }
    return p1 === p2 ? p1 : -1;
}

// p_maputl.c globals
var opentop = 0, openbottom = 0, openrange = 0, lowfloor = 0;
function P_LineOpening(line) {
    if (line.sidenum[1] === -1) { openrange = 0; return; }
    var front = line.frontsector, back = line.backsector;
    opentop = front.ceilingheight < back.ceilingheight
        ? front.ceilingheight : back.ceilingheight;
    if (front.floorheight > back.floorheight) {
        openbottom = front.floorheight; lowfloor = back.floorheight;
    } else {
        openbottom = back.floorheight; lowfloor = front.floorheight;
    }
    openrange = opentop - openbottom;
}

// p_maputl.c P_BlockLinesIterator (caller bumps validcount first)
function P_BlockLinesIterator(x, y, func) {
    if (x < 0 || y < 0 || x >= bmapwidth || y >= bmapheight) return true;
    var offset = y * bmapwidth + x;
    // C: offset = *(blockmap+offset) with blockmap = blockmaplump+4, i.e. the
    // table entry (absolute index into blockmaplump) read at lump[4+cell].
    // This map's BLOCKMAP lists are [count id0 id1 ... -1] (gen_map.py);
    // vanilla lists have no count word, so skip one short to reproduce
    // p_maputl.c's iteration: for (list = ...; *list != -1; list++)
    //     ld = &lines[*list];
    offset = blockmaplump[4 + offset] + 1;
    for (var p = offset; blockmaplump[p] !== -1; p++) {
        var ld = linedefs[blockmaplump[p]];
        if (ld.validcount === validcount) continue;
        ld.validcount = validcount;
        if (!func(ld)) return false;
    }
    return true;
}

// ===========================================================================
// BSP point lookup + sight (r_main.c, p_sight.c — exact)
// ===========================================================================
function R_PointOnSide(x, y, node) {
    var dx, dy, left, right;
    if (!node.dx) { if (x <= node.x) return node.dy > 0 ? 1 : 0; return node.dy < 0 ? 1 : 0; }
    if (!node.dy) { if (y <= node.y) return node.dx < 0 ? 1 : 0; return node.dx > 0 ? 1 : 0; }
    dx = (x - node.x) | 0; dy = (y - node.y) | 0;
    if (((node.dy ^ node.dx ^ dx ^ dy) & 0x80000000))
        return ((node.dy ^ dx) & 0x80000000) ? 1 : 0;
    left = FixedMul(node.dy >> FRACBITS, dx);
    right = FixedMul(dy, node.dx >> FRACBITS);
    return right < left ? 0 : 1;
}
function R_PointOnSegSide(x, y, line) {
    var lx = line.v1.x, ly = line.v1.y;
    var ldx = (line.v2.x - lx) | 0, ldy = (line.v2.y - ly) | 0;
    if (!ldx) { if (x <= lx) return ldy > 0 ? 1 : 0; return ldy < 0 ? 1 : 0; }
    if (!ldy) { if (y <= ly) return ldx < 0 ? 1 : 0; return ldx > 0 ? 1 : 0; }
    var dx = (x - lx) | 0, dy = (y - ly) | 0;
    if (((ldy ^ ldx ^ dx ^ dy) & 0x80000000))
        return ((ldy ^ dx) & 0x80000000) ? 1 : 0;
    var left = FixedMul(ldy >> FRACBITS, dx);
    var right = FixedMul(dy, ldx >> FRACBITS);
    return right < left ? 0 : 1;
}
// returns subsector INDEX (per ARCHITECTURE contract)
function R_PointInSubsector(x, y) {
    if (!numnodes) return 0;
    var nodenum = numnodes - 1;
    while (!(nodenum & NF_SUBSECTOR)) {
        var node = nodes[nodenum];
        nodenum = node.children[R_PointOnSide(x, y, node)];
    }
    return nodenum & ~NF_SUBSECTOR & 0x7fff;
}
var viewx = 0, viewy = 0, viewz = 0, viewangle = 0;
var viewcos = 0, viewsin = 0, viewplayer = null;
function R_PointToAngle(x, y) {
    x = (x - viewx) | 0; y = (y - viewy) | 0;
    if (!x && !y) return 0;
    if (x >= 0) {
        if (y >= 0) {
            if (x > y) return tantoangle[SlopeDiv(y, x)] >>> 0;            // oct 0
            return (ANG90 - 1 - tantoangle[SlopeDiv(x, y)]) >>> 0;         // oct 1
        } else {
            y = -y;
            if (x > y) return (-tantoangle[SlopeDiv(y, x)]) >>> 0;         // oct 8
            return (ANG270 + tantoangle[SlopeDiv(x, y)]) >>> 0;            // oct 7
        }
    } else {
        x = -x;
        if (y >= 0) {
            if (x > y) return (ANG180 - 1 - tantoangle[SlopeDiv(y, x)]) >>> 0; // oct 3
            return (ANG90 + tantoangle[SlopeDiv(x, y)]) >>> 0;             // oct 2
        } else {
            y = -y;
            if (x > y) return (ANG180 + tantoangle[SlopeDiv(y, x)]) >>> 0; // oct 4
            return (ANG270 - 1 - tantoangle[SlopeDiv(x, y)]) >>> 0;        // oct 5
        }
    }
}
function R_PointToAngle2(x1, y1, x2, y2) {  // CLOBBERS viewx/viewy (quirk)
    viewx = x1; viewy = y1;
    return R_PointToAngle(x2, y2);
}
function R_PointToDist(x, y) {
    var dx = Math.abs(x - viewx), dy = Math.abs(y - viewy), temp;
    if (dy > dx) { temp = dx; dx = dy; dy = temp; }
    // C: FixedDiv(dy,dx) is an angle_t (unsigned) — MUST >>>0 before >>DBITS
    var angle = ((tantoangle[(FixedDiv(dy, dx) >>> 0) >>> DBITS] >>> 0) + ANG90) >>> 0;
    angle = angle >>> ANGLETOFINESHIFT;
    return FixedDiv(dx, finesine[angle]);
}

// ---- p_sight.c — verbatim port --------------------------------------------
var sightzstart = 0, topslope = 0, bottomslope = 0;
var strace = { x: 0, y: 0, dx: 0, dy: 0 }, t2x = 0, t2y = 0;
function P_DivlineSide(x, y, node) {
    if (!node.dx) {
        if (x === node.x) return 2;
        if (x <= node.x) return node.dy > 0 ? 1 : 0;   // C: return node->dy > 0
        return node.dy < 0 ? 1 : 0;                    // C: return node->dy < 0
    }
    if (!node.dy) {
        if (x === node.y) return 2;   // C original quirk: compares x to y!
        if (y <= node.y) return node.dx < 0 ? 1 : 0;
        return node.dx > 0 ? 1 : 0;
    }
    var dx = (x - node.x) | 0, dy = (y - node.y) | 0;
    var left = ((node.dy >> FRACBITS) | 0) * ((dx >> FRACBITS) | 0);
    var right = ((dy >> FRACBITS) | 0) * ((node.dx >> FRACBITS) | 0);
    if (right < left) return 0;
    if (left === right) return 2;
    return 1;
}
function P_InterceptVector2(v2, v1) {
    var den = FixedMul(v1.dy >> 8, v2.dx) - FixedMul(v1.dx >> 8, v2.dy) | 0;
    if (den === 0) return 0;
    var num = FixedMul((v1.x - v2.x) >> 8, v1.dy) + FixedMul((v2.y - v1.y) >> 8, v1.dx);
    return FixedDiv(num, den);
}
function P_CrossSubsector(num) {
    var sub = subsectors[num];
    var count = sub.numlines;
    for (var si = sub.firstline; count; si++, count--) {
        var seg = segs[si];
        var line = seg.linedef;
        if (line.validcount === validcount) continue;
        line.validcount = validcount;
        var v1 = line.v1, v2 = line.v2;
        var s1 = P_DivlineSide(v1.x, v1.y, strace);
        var s2 = P_DivlineSide(v2.x, v2.y, strace);
        if (s1 === s2) continue;
        var divl = { x: v1.x, y: v1.y, dx: (v2.x - v1.x) | 0, dy: (v2.y - v1.y) | 0 };
        s1 = P_DivlineSide(strace.x, strace.y, divl);
        s2 = P_DivlineSide(t2x, t2y, divl);
        if (s1 === s2) continue;
        if (!(line.flags & ML_TWOSIDED)) return false;
        var front = seg.frontsector, back = seg.backsector;
        if (!back) continue;    // degenerate: C seg always has back if TWOSIDED
        if (front.floorheight === back.floorheight &&
            front.ceilingheight === back.ceilingheight) continue;
        var ct = front.ceilingheight < back.ceilingheight ? front.ceilingheight : back.ceilingheight;
        var cb = front.floorheight > back.floorheight ? front.floorheight : back.floorheight;
        if (cb >= ct) return false;
        var frac = P_InterceptVector2(strace, divl);
        if (front.floorheight !== back.floorheight) {
            var slope = FixedDiv(cb - sightzstart, frac);
            if (slope > bottomslope) bottomslope = slope;
        }
        if (front.ceilingheight !== back.ceilingheight) {
            slope = FixedDiv(ct - sightzstart, frac);
            if (slope < topslope) topslope = slope;
        }
        if (topslope <= bottomslope) return false;
    }
    return true;
}
function P_CrossBSPNode(bspnum) {
    if (bspnum & NF_SUBSECTOR) {
        if (bspnum === -1) return P_CrossSubsector(0);
        return P_CrossSubsector(bspnum & (~NF_SUBSECTOR));
    }
    var bsp = nodes[bspnum];
    var side = P_DivlineSide(strace.x, strace.y, bsp);
    if (side === 2) side = 0;
    if (!P_CrossBSPNode(bsp.children[side])) return false;
    if (side === P_DivlineSide(t2x, t2y, bsp)) return true;
    return P_CrossBSPNode(bsp.children[side ^ 1]);
}
function P_CheckSight(t1, t2) {
    var s1 = sectors.indexOf(t1.subsector.sector);
    var s2 = sectors.indexOf(t2.subsector.sector);
    var pnum = s1 * numsectors + s2;
    var bytenum = pnum >> 3;
    var bitnum = 1 << (pnum & 7);
    if (reject[bytenum] & bitnum) return false;   // trivial reject
    validcount++;
    sightzstart = t1.z + t1.height - (t1.height >> 2);
    topslope = (t2.z + t2.height) - sightzstart;
    bottomslope = (t2.z) - sightzstart;
    strace.x = t1.x; strace.y = t1.y;
    t2x = t2.x; t2y = t2.y;
    strace.dx = (t2.x - t1.x) | 0; strace.dy = (t2.y - t1.y) | 0;
    return P_CrossBSPNode(numnodes - 1);
}

// ===========================================================================
// VIEW / FRAMEBUFFER (r_main.c + r_draw.c R_InitBuffer)
// viewbuffer: Uint32Array(320*200) XRGB8888 (0xFF000000|rrggbb) — main.js
// uploads it directly (little-endian byte order == DOOM palette RGB).
// ===========================================================================
var viewbuffer = new Uint32Array(SCREENWIDTH * SCREENHEIGHT);
var ylookup = new Int32Array(SCREENHEIGHT);
var columnofs = new Int32Array(SCREENWIDTH);
var viewwindowx = 0, viewwindowy = 0;
var scaledviewwidth = 0, viewheight = 0, viewwidth = 0, detailshift = 0;
var setblocks = 11, setdetail = 0, setsizeneeded = true;
var centerx = 0, centery = 0, centerxfrac = 0, centeryfrac = 0, projection = 0;
var framecount = 0;
var viewangleoffset = 0;               // always 0 — no splitscreen here
var negonearray = new Int16Array(SCREENWIDTH);
var screenheightarray = new Int16Array(SCREENWIDTH);
var viewangletox = new Int32Array(FINEANGLES / 2);
var xtoviewangle = new Uint32Array(SCREENWIDTH + 1);
var clipangle = 0;
var yslope = new Int32Array(SCREENHEIGHT);
var distscale = new Int32Array(SCREENWIDTH);
var scalelight = [], scalelightfixed = new Int32Array(MAXLIGHTSCALE);
var zlight = [];
var fixedcolormap = 0;                 // COLORMAPS byte offset; 0 == C NULL
var extralight = 0;
var walllights = scalelightfixed;
for (var _i0 = 0; _i0 < SCREENWIDTH; _i0++) negonearray[_i0] = -1;
for (var _l = 0; _l < LIGHTLEVELS; _l++) {
    scalelight[_l] = new Int32Array(MAXLIGHTSCALE);
    zlight[_l] = new Int32Array(MAXLIGHTZ);
}

// R_InitLightTables (r_main.c:614) — entries are COLORMAPS byte offsets
// (level*256), standing in for the C `colormaps + level*256` lighttable_t*.
function R_InitLightTables() {
    var i, j, level, startmap, scale;
    for (i = 0; i < LIGHTLEVELS; i++) {
        startmap = (((LIGHTLEVELS - 1 - i) * 2) * NUMCOLORMAPS / LIGHTLEVELS) | 0;  // C int div
        for (j = 0; j < MAXLIGHTZ; j++) {
            scale = FixedDiv((SCREENWIDTH / 2 * FRACUNIT), (j + 1) << LIGHTZSHIFT);
            scale >>= LIGHTSCALESHIFT;
            level = startmap - (scale / DISTMAP | 0);   // C: int / int
            if (level < 0) level = 0;
            if (level >= NUMCOLORMAPS) level = NUMCOLORMAPS - 1;
            zlight[i][j] = cmapLevel(level) * 256 | 0;  // COLORMAPS byte offset (C: colormaps + level*256)
        }
    }
}

// R_SetViewSize (r_main.c:657) — deferred; takes effect next Execute.
function R_SetViewSize(blocks, detail) {
    setsizeneeded = true; setblocks = blocks; setdetail = detail;
}
function setScreenSize(screenblocks) {  // ARCHITECTURE.md name
    R_SetViewSize(screenblocks, 0);
    R_ExecuteSetViewSize();
}

// R_ExecuteSetViewSize (r_main.c:671) — full port. QUIRK: projection IS
// centerxfrac (r_main.c:700), and the angle tables are rebuilt right here.
function R_ExecuteSetViewSize() {
    var cosadj, dy, i, j, level, startmap;
    setsizeneeded = false;
    if (setblocks === 11) { scaledviewwidth = SCREENWIDTH; viewheight = SCREENHEIGHT; }
    else { scaledviewwidth = setblocks * 32; viewheight = (setblocks * 168 / 10) & ~7; }
    detailshift = setdetail;
    viewwidth = scaledviewwidth >> detailshift;
    centery = viewheight / 2 | 0;
    centerx = viewwidth / 2 | 0;
    centerxfrac = centerx << FRACBITS;
    centeryfrac = centery << FRACBITS;
    projection = centerxfrac;
    colfunc = basecolfunc = detailshift ? R_DrawColumnLow : R_DrawColumn;
    fuzzcolfunc = R_DrawFuzzColumn;    // 1.10: NO fuzz-low variant
    transcolfunc = R_DrawTranslatedColumn;
    spanfunc = detailshift ? R_DrawSpanLow : R_DrawSpan;
    R_InitBuffer(scaledviewwidth, viewheight);
    R_InitTextureMapping();
    pspritescale = FRACUNIT * viewwidth / SCREENWIDTH | 0;
    pspriteiscale = FRACUNIT * SCREENWIDTH / viewwidth | 0;
    for (i = 0; i < viewwidth; i++) screenheightarray[i] = viewheight;
    for (i = 0; i < viewheight; i++) {
        dy = (((i - viewheight / 2) << FRACBITS) + FRACUNIT / 2) | 0;
        dy = dy < 0 ? -dy : dy;
        yslope[i] = FixedDiv((viewwidth << detailshift) / 2 * FRACUNIT, dy);
    }
    for (i = 0; i < viewwidth; i++) {
        cosadj = finecosine[xtoviewangle[i] >>> ANGLETOFINESHIFT];
        if (cosadj < 0) cosadj = -cosadj;
        distscale[i] = FixedDiv(FRACUNIT, cosadj);
    }
    for (i = 0; i < LIGHTLEVELS; i++) {
        startmap = (((LIGHTLEVELS - 1 - i) * 2) * NUMCOLORMAPS / LIGHTLEVELS) | 0;  // C int div
        for (j = 0; j < MAXLIGHTSCALE; j++) {
            // C integer math truncates BOTH divisions. A fractional level
            // (e.g. 0.5) becomes a +0x80 byte offset, and PIX_LUT then
            // resolves into the NEXT palette index's row (brown texel
            // +128 -> hazard-yellow) — the depth-dependent palette flip.
            level = (startmap - ((j * SCREENWIDTH / (viewwidth << detailshift)) | 0) / DISTMAP) | 0;
            if (level < 0) level = 0;
            if (level >= NUMCOLORMAPS) level = NUMCOLORMAPS - 1;
            scalelight[i][j] = cmapLevel(level) * 256 | 0;  // COLORMAPS byte offset
        }
    }
    R_InitLightTables();               // zlight is start-up-only in C; same math
}

// R_InitBuffer (r_draw.c:696)
function R_InitBuffer(width, height) {
    var i;
    viewwindowx = (SCREENWIDTH - width) >> 1;
    for (i = 0; i < width; i++) columnofs[i] = viewwindowx + i;
    if (width === SCREENWIDTH) viewwindowy = 0;
    else viewwindowy = (SCREENHEIGHT - SBARHEIGHT - height) >> 1;
    for (i = 0; i < height; i++) ylookup[i] = (i + viewwindowy) * SCREENWIDTH;
}

// ---- R_FillBackScreen / R_DrawViewBorder (r_draw.c:726 / r_draw.c:832) ----
// Vanilla fills the 320x168 back screen with the FLOOR7_2 pattern tiled,
// stamps the BRDR_* bevel patches around the view window, then memcpy-copies
// just the border regions into screens[0] (which vanilla never clears).
// Our port clears viewbuffer every frame (deviation noted in
// R_RenderPlayerView), so the cache is rebuilt only when the view geometry
// or palette changes and the border regions are re-copied after each
// R_RenderPlayerView — pixel-identical to vanilla's persistent screens[].
// gamemode is always Doom 1 here, so name1/FLOOR7_2 applies (GRNROCK is the
// commercial-only alternative). Rebuild triggers = view geometry OR palette:
// vanilla memcpy-copies raw palette INDEX bytes and remaps at blit time, so
// the border flashes with pickup/invuln palette changes — paletteVersion
// rebuilds our cached RGB cache on every I_SetPalette to match.
var backScreen = null;            // Uint32Array(320*200) RGB pattern+bevel
var backScreenKey = '';
function R_FillBackScreen(force) {
    if (scaledviewwidth === SCREENWIDTH) return;
    var key = scaledviewwidth + 'x' + viewheight + '@' + viewwindowx + ',' + viewwindowy + '#' + paletteVersion;
    if (!force && backScreen && backScreenKey === key) return;
    if (!backScreen) backScreen = new Uint32Array(SCREENWIDTH * SCREENHEIGHT);
    backScreenKey = key;
    var flat = b64decode(ASSETS.flats.FLOOR7_2[2]);   // 64x64 PLAYPAL indices
    var rows = SCREENHEIGHT - SBARHEIGHT;
    for (var y = 0; y < rows; y++) {
        var src = (y & 63) << 6;
        var row = y * SCREENWIDTH;
        for (var x = 0; x < SCREENWIDTH; x++)
            backScreen[row + x] = PIX_LUT[flat[src + (x & 63)]] >>> 0;  // raw index, table 0
    }
    // Beveled edge around the view window (V_DrawPatch: x-=left, y-=top).
    function bevel(name, px, py) {
        var d = STATUSBAR.patches[name];
        if (!d) return;
        var w = d[0], h = d[1], pxi = b64decode(d[2]);
        px -= d[3]; py -= d[4];
        var x1 = px < 0 ? -px : 0, y1 = py < 0 ? -py : 0;
        var x2 = Math.min(w, SCREENWIDTH - px), y2 = Math.min(h, rows - py);
        for (var yy = y1; yy < y2; yy++) {
            var orow = (py + yy) * SCREENWIDTH + px;
            var srow = yy * w;
            for (var xx = x1; xx < x2; xx++) {
                var c = pxi[srow + xx];
                if (c !== 255) backScreen[orow + xx] = PIX_LUT[c] >>> 0;
            }
        }
    }
    for (var bx = 0; bx < scaledviewwidth; bx += 8) {
        bevel('BRDR_T', viewwindowx + bx, viewwindowy - 8);
        bevel('BRDR_B', viewwindowx + bx, viewwindowy + viewheight);
    }
    for (var by = 0; by < viewheight; by += 8) {
        bevel('BRDR_L', viewwindowx - 8, viewwindowy + by);
        bevel('BRDR_R', viewwindowx + scaledviewwidth, viewwindowy + by);
    }
    bevel('BRDR_TL', viewwindowx - 8, viewwindowy - 8);
    bevel('BRDR_TR', viewwindowx + scaledviewwidth, viewwindowy - 8);
    bevel('BRDR_BL', viewwindowx - 8, viewwindowy + viewheight);
    bevel('BRDR_BR', viewwindowx + scaledviewwidth, viewwindowy + viewheight);
}

// R_DrawViewBorder (r_draw.c:832): erase-to-pattern outside the view window.
// Vanilla's three R_VideoErase passes (top+left, bottom-right, alternating
// side strips) cover exactly the same pixels as this explicit decomposition.
function R_DrawViewBorder() {
    if (scaledviewwidth === SCREENWIDTH) return;
    R_FillBackScreen(false);
    var top = viewwindowy, side = viewwindowx, w = scaledviewwidth, h = viewheight;
    var i, y, row;
    var n = top * SCREENWIDTH;                       // rows above the view
    for (i = 0; i < n; i++) viewbuffer[i] = backScreen[i];
    var bstart = (top + h) * SCREENWIDTH;            // rows below (to the bar)
    var bend = (SCREENHEIGHT - SBARHEIGHT) * SCREENWIDTH;
    for (i = bstart; i < bend; i++) viewbuffer[i] = backScreen[i];
    for (y = top; y < top + h; y++) {                // side strips per row
        row = y * SCREENWIDTH;
        for (i = 0; i < side; i++) viewbuffer[row + i] = backScreen[row + i];
        var rs = row + side + w;
        var rend = row + SCREENWIDTH;
        for (i = rs; i < rend; i++) viewbuffer[i] = backScreen[i];
    }
}

// R_InitTextureMapping (r_main.c:544) — verbatim. QUIRKS kept: viewangletox
// gives the NEXT greatest x after the angle (fenceposts -1/viewwidth+1 fixed
// up in a second pass), xtoviewangle[x] is the smallest angle mapping to x
// (linear sweep), and the dead `t = centerx - t` in the fixup loop is C's too.
function R_InitTextureMapping() {
    var i, x, t, focallength;
    focallength = FixedDiv(centerxfrac, finetangent[FINEANGLES / 4 + FIELDOFVIEW / 2]);
    for (i = 0; i < FINEANGLES / 2; i++) {
        if (finetangent[i] > FRACUNIT * 2) t = -1;
        else if (finetangent[i] < -FRACUNIT * 2) t = viewwidth + 1;
        else {
            t = FixedMul(finetangent[i], focallength);
            t = (centerxfrac - t + FRACUNIT - 1) >> FRACBITS;
            if (t < -1) t = -1;
            else if (t > viewwidth + 1) t = viewwidth + 1;
        }
        viewangletox[i] = t;
    }
    for (x = 0; x <= viewwidth; x++) {
        i = 0;
        while (viewangletox[i] > x) i++;
        xtoviewangle[x] = ((i << ANGLETOFINESHIFT) - ANG90) >>> 0;
    }
    for (i = 0; i < FINEANGLES / 2; i++) {
        if (viewangletox[i] === -1) viewangletox[i] = 0;
        else if (viewangletox[i] === viewwidth + 1) viewangletox[i] = viewwidth;
    }
    clipangle = xtoviewangle[0];
}

// R_SetupFrame (r_main.c:830). 1.10 has NO R_InstallColormap (§16); the real
// mechanism is player->fixedcolormap -> fixedcolormap + scalelightfixed.
// Our "colormap" value = byte offset into COLORMAPS (256 B per table); 0 is
// the C NULL pointer sentinel. Table 32 = fullbright (used via colormaps+…
// by callers as in C: fullbright uses colormaps[0]… wait: 1.10 r_things uses
// `colormaps` (table 0 = bright full map? NO — table 32 is the fullbright
// map in COLORMAP lump order: 0..31 shades, 32 inverse? see r_data note);
// we follow the WAD convention ASSETS.colormaps ships: 32 = fullbright.
function R_SetupFrame(player) {
    var i;
    // Adapter: ARCHITECTURE's synthetic viewplayer carries x/y/angle on the
    // top object with the C player_t fields under .player (test harness);
    // game.js passes a real player_t (viewx from ->mo) — support both.
    var pl = player.player ? player.player : player;
    player = pl;
    viewplayer = player;
    viewx = (player.mo && player.mo.x !== undefined) ? player.mo.x
            : (arguments[1] !== undefined ? arguments[1] : player.x);
    viewy = (player.mo && player.mo.y !== undefined) ? player.mo.y
            : player.y;
    viewangle = (((player.mo && player.mo.angle !== undefined ? player.mo.angle : player.angle) >>> 0) + viewangleoffset) >>> 0;
    extralight = player.extralight | 0;
    viewz = player.viewz;
    viewsin = finesine[viewangle >>> ANGLETOFINESHIFT];
    viewcos = finecosine[viewangle >>> ANGLETOFINESHIFT];
    if (player.fixedcolormap) {
        fixedcolormap = player.fixedcolormap * 256 | 0;
        walllights = scalelightfixed;
        for (i = 0; i < MAXLIGHTSCALE; i++) scalelightfixed[i] = fixedcolormap;
    } else fixedcolormap = 0;
    framecount++;
    validcount++;
}

// ===========================================================================
// DRAW PRIMITIVES (r_draw.c) — pixels land in viewbuffer as
// 0xff000000 | (r<<16)|(g<<8)|b via PIX_LUT[(colormapTable<<8)|srcIndex].
// dc_colormap etc. carry the COLORMAPS byte offset (table<<8).
// ===========================================================================
var dc_x = 0, dc_yl = 0, dc_yh = 0;
var dc_iscale = 0, dc_texturemid = 0, dc_colormap = 0;
var dc_source = null, dc_srcoff = 0, dc_translation = null;
var ds_y = 0, ds_x1 = 0, ds_x2 = 0, ds_colormap = 0;
var ds_xfrac = 0, ds_yfrac = 0, ds_xstep = 0, ds_ystep = 0, ds_source = null;
var colfunc = null, basecolfunc = null, fuzzcolfunc = null,
    transcolfunc = null, spanfunc = null;

function R_DrawColumn() {
    var count = dc_yh - dc_yl;
    if (count < 0 || count >= SCREENHEIGHT) return;  // JS guard vs C UB (clipped by caller)
    var dest = ylookup[dc_yl] + columnofs[dc_x];
    var fracstep = dc_iscale;
    var frac = (dc_texturemid + (dc_yl - centery) * fracstep) | 0;
    var src = dc_source, off = dc_srcoff, cm = dc_colormap;
    do {
        // QUIRK (r_draw.c:142): texture column index masked to &127 — walls
        // are assumed 128 wide; procedural textures wrap by power of 2.
        viewbuffer[dest] =
            PIX_LUT[(cm + (src[off + ((frac >> FRACBITS) & 127)] & 0xff)) >>> 0];
        dest += SCREENWIDTH;
        frac = (frac + fracstep) | 0;
    } while (count--);
}
function R_DrawColumnLow() {
    var count = dc_yh - dc_yl;
    if (count < 0 || count >= SCREENHEIGHT) return;  // JS guard vs C UB (clipped by caller)
    // DEVIATION (user-reported "sprites not rendering in LOW mode"): gospel
    // R_DrawColumnLow (r_draw.c) does `dc_x <<= 1` on the GLOBAL dc_x, and
    // gospel R_DrawVisSprite (r_things.c:430) loops `for (dc_x=vis->x1;
    // dc_x<=vis->x2; dc_x++)` — the mutation blows the loop bound past x2
    // after ONE column, so vanilla blocky mode drew every sprite as a
    // single 1-px strip. THIS is the "detailshift bug" id flagged at
    // r_draw.c:317 ("Keep till detailshift bug in blocky mode fixed, or
    // blocky mode removed") and why M_ChangeDetail was disabled
    // (m_menu.c:1131). Multi-post columns (R_DrawMaskedColumn) were also
    // thrown right. Wall/plane/sky loops re-assign dc_x every iteration,
    // which is why only sprites broke. Modern ports fix it identically:
    // derive the doubled destination from a LOCAL, never mutate dc_x.
    var dx = dc_x << 1;
    var dest = ylookup[dc_yl] + columnofs[dx];
    var dest2 = ylookup[dc_yl] + columnofs[dx + 1];
    var fracstep = dc_iscale;
    var frac = (dc_texturemid + (dc_yl - centery) * fracstep) | 0;
    var src = dc_source, off = dc_srcoff, cm = dc_colormap;
    do {
        var px = PIX_LUT[(cm + (src[off + ((frac >> FRACBITS) & 127)] & 0xff)) >>> 0];
        viewbuffer[dest2] = px; viewbuffer[dest] = px;
        dest += SCREENWIDTH; dest2 += SCREENWIDTH;
        frac = (frac + fracstep) | 0;
    } while (count--);
}

// Fuzz = palette-based dither (r_draw.c:285): copy a neighbour column pixel
// (±320 px == one screen column) and re-look it up through colormap table 6
// ("a bit brighter than average"). No alpha anywhere in 1.10 (§16). The C
// reads the indexed byte straight out of the framebuffer; ours is RGB, so we
// reverse-map with an exact-colour cache (every pixel in viewbuffer was
// produced by PIX_LUT, so the reverse hit is always exact).
var FUZZTABLE = 50, FUZZOFF = SCREENWIDTH;
var fuzzoffset = [
    FUZZOFF, -FUZZOFF, FUZZOFF, -FUZZOFF, FUZZOFF, FUZZOFF, -FUZZOFF,
    FUZZOFF, FUZZOFF, -FUZZOFF, FUZZOFF, FUZZOFF, FUZZOFF, -FUZZOFF,
    FUZZOFF, FUZZOFF, FUZZOFF, -FUZZOFF, -FUZZOFF, -FUZZOFF, -FUZZOFF,
    FUZZOFF, -FUZZOFF, -FUZZOFF, FUZZOFF, FUZZOFF, FUZZOFF, FUZZOFF, -FUZZOFF,
    FUZZOFF, -FUZZOFF, FUZZOFF, FUZZOFF, -FUZZOFF, -FUZZOFF, FUZZOFF,
    FUZZOFF, -FUZZOFF, -FUZZOFF, -FUZZOFF, -FUZZOFF, FUZZOFF, FUZZOFF,
    FUZZOFF, FUZZOFF, -FUZZOFF, FUZZOFF, FUZZOFF, -FUZZOFF, FUZZOFF];
var fuzzpos = 0;
var fuzzCache = null;                  // Map rgb->palette idx, built lazily
function R_DrawFuzzColumn() {
    if (!dc_yl) dc_yl = 1;             // adjust borders, low...
    if (dc_yh === viewheight - 1) dc_yh = viewheight - 2;   // ...and high
    var count = dc_yh - dc_yl;
    if (count < 0 || count >= SCREENHEIGHT) return;  // JS guard vs C UB (clipped by caller)
    if (!fuzzCache) R_BuildFuzzCache();
    // DEVIATION (user-reported "spectres skinny / misplaced in LOW mode"):
    // 1.10 has no fuzz-Low variant at all (r_main.c fuzzcolfunc is always
    // the hi-res one), so in blocky mode every fuzz sprite (spectres,
    // shadows, invisibility) drew a SINGLE pixel at the half-res dc_x —
    // half-width and shoved toward the left edge of the view. Double it
    // like R_DrawColumnLow: write the pair [2*dx, 2*dx+1] and sample the
    // neighbour column of the doubled position (dest ± one SCREENWIDTH
    // row, same ±1 screen column as C).
    var dx = detailshift ? dc_x << 1 : dc_x;
    var dest = ylookup[dc_yl] + columnofs[dx];
    var dest2 = detailshift ? ylookup[dc_yl] + columnofs[dx + 1] : 0;
    do {
        var idx = fuzzCache.get(viewbuffer[dest + fuzzoffset[fuzzpos]]) | 0;
        var px = PIX_LUT[6 * 256 + idx];
        viewbuffer[dest] = px;
        if (detailshift) viewbuffer[dest2] = px;
        if (++fuzzpos === FUZZTABLE) fuzzpos = 0;
        dest += SCREENWIDTH;
        if (detailshift) dest2 += SCREENWIDTH;
    } while (count--);
}
function R_BuildFuzzCache() {
    fuzzCache = new Map();
    // exact inverse of PIX_LUT for every (table,src) we can produce.
    // PIX_LUT is an Int32Array: the packed 0xFFrrggbb words come back NEGATIVE,
    // while viewbuffer is a Uint32Array and yields POSITIVE. Without >>>0 every
    // fuzz probe misses the Map, `undefined | 0` collapses to palette index 0,
    // and fuzz sprites (spectres, shadows, the invisibility powerup) render as
    // solid black silhouettes instead of the translucent static (r_draw.c:285
    // reads an indexed byte and can never miss).
    for (var t = 0; t < 34; t++)
        for (var s = 0; s < 256; s++) {
            var px = PIX_LUT[(t << 8) | s] >>> 0;
            if (!fuzzCache.has(px)) fuzzCache.set(px, s);
        }
}
function R_DrawTranslatedColumn() {
    var count = dc_yh - dc_yl;
    if (count < 0 || count >= SCREENHEIGHT) return;  // JS guard vs C UB (clipped by caller)
    // DEVIATION (same class as the fuzz fix): gospel never swaps
    // transcolfunc for blocky mode, so translated sprites (MF_TRANSLATION)
    // drew one pixel per half-res column = half width. Double like
    // R_DrawColumnLow when detailshift is on.
    var dx = detailshift ? dc_x << 1 : dc_x;
    var dest = ylookup[dc_yl] + columnofs[dx];
    var dest2 = detailshift ? ylookup[dc_yl] + columnofs[dx + 1] : 0;
    var fracstep = dc_iscale;
    var frac = (dc_texturemid + (dc_yl - centery) * fracstep) | 0;
    do {
        // C masks nothing here (frac>>FRACBITS) — sprites clip their own x1/x2
        var px = PIX_LUT[dc_colormap +
            dc_translation[dc_source[dc_srcoff + ((frac >> FRACBITS) | 0)]]];
        viewbuffer[dest] = px;
        if (detailshift) viewbuffer[dest2] = px;
        dest += SCREENWIDTH;
        if (detailshift) dest2 += SCREENWIDTH;
        frac = (frac + fracstep) | 0;
    } while (count--);
}
function R_DrawSpan() {
    var xfrac = ds_xfrac, yfrac = ds_yfrac;
    var dest = ylookup[ds_y] + columnofs[ds_x1];
    var count = ds_x2 - ds_x1;
    if (count < 0 || count >= 2*SCREENWIDTH) return;  // JS guard vs C UB
    if (count < 0 || count >= 2 * SCREENWIDTH) return;  // JS guard vs C UB
    var cm = ds_colormap, src = ds_source;
    do {
        var spot = ((((yfrac >> (16 - 6)) & (63 * 64)) + ((xfrac >> 16) & 63)) | 0);
        viewbuffer[dest++] = PIX_LUT[cm + (src[spot] & 0xff)];
        xfrac = (xfrac + ds_xstep) | 0;
        yfrac = (yfrac + ds_ystep) | 0;
    } while (count--);
}
function R_DrawSpanLow() {
    var xfrac = ds_xfrac, yfrac = ds_yfrac;
    ds_x1 <<= 1; ds_x2 <<= 1;
    var dest = ylookup[ds_y] + columnofs[ds_x1];
    // DEVIATION (user-reported "sector tearing" in low mode): gospel C
    // (r_draw.c:643 R_DrawSpanLow) counts the DOUBLED coordinates —
    // count = ds_x2-ds_x1 = 2*delta — then writes 2 px per iteration, so
    // every floor/ceiling span overdraws 2*delta pixels to the RIGHT,
    // smearing the flat across neighbouring walls/sectors. The DOS/VGA
    // builds ran the hand-written asm R_DrawSpanLow (overdraw <= 8 px,
    // which later draws mask), so vanilla never showed it; the C fallback
    // bug smears visibly. Modern ports fix exactly this line (PrBoom:
    // "count = (ds_x2 - ds_x1)/2;"). Halve the doubled delta: iterations
    // become delta+1 low-res columns == 2*delta+2 px == the inclusive
    // doubled span [2*x1, 2*x2+1].
    var count = (ds_x2 - ds_x1) >> 1;
    if (count < 0 || count >= SCREENWIDTH) return;  // JS guard vs C UB
    var cm = ds_colormap, src = ds_source;
    do {
        var spot = ((((yfrac >> (16 - 6)) & (63 * 64)) + ((xfrac >> 16) & 63)) | 0);
        var px = PIX_LUT[cm + (src[spot] & 0xff)];
        viewbuffer[dest++] = px; viewbuffer[dest++] = px;
        xfrac = (xfrac + ds_xstep) | 0;
        yfrac = (yfrac + ds_ystep) | 0;
    } while (count--);
}

// ===========================================================================
// VISPLANES (r_plane.c)
// C layout quirk: visplane_t.top is short[SCREENWIDTH] with bottom[] directly
// after it, so top[maxx+1]/top[minx-1] sentinel writes at the edges spill into
// neighbouring arrays (r_plane.c:438-439). We keep in-bounds arrays and
// return -1 (0xff) for out-of-range reads — observable behaviour identical:
// every index outside [minx,maxx] reads as "closed".
// ===========================================================================
var visplanes = [], lastvisplane = 0;
var floorplane = null, ceilingplane = null;
// +512 headroom: maskedBase = lastopening - rw_x can go negative when the
// first masked seg starts mid-view; C happily wrote pool[-n]. Shift all
// pool traffic by MPOOLBIAS.
var MPOOLBIAS = 512;
var openings = new Int16Array(MAXOPENINGS + MPOOLBIAS);
var lastopening = 0;
var floorclip = new Int16Array(SCREENWIDTH);
var ceilingclip = new Int16Array(SCREENWIDTH);
// C: static int spanstart[SCREENHEIGHT]; OOB reads (y=-1 sentinel row) hit
// static storage that reads 0 in practice. Typed arrays give undefined -> NaN
// counts -> infinite do/while. Wrap with 2-row pad so index -1 and SCREENHEIGHT
// are real zeros (never written by in-range code paths).
var spanstart = new Int32Array(SCREENHEIGHT + 2);
var spanstop = new Int32Array(SCREENHEIGHT);
var planezlight = 0, planeheight = 0;
var basexscale = 0, baseyscale = 0;
var cachedheight = new Int32Array(SCREENHEIGHT);
var cacheddistance = new Int32Array(SCREENHEIGHT);
var cachedxstep = new Int32Array(SCREENHEIGHT);
var cachedystep = new Int32Array(SCREENHEIGHT);
var skytexturemid = 100 * FRACUNIT;    // R_InitSkyMap (r_sky.h value)

// Faithful visplane_t layout (r_defs.h:460): top/bottom are BYTE arrays with
// byte pads around them:
//   byte pad1; byte top[320]; byte pad2; byte pad3; byte bottom[320]; byte pad4;
// Sentinel is the byte value 0xff (255), NOT short -1. bottom[] is NEVER
// cleared on plane (re)use (memsets only cover sizeof(top)); stale entries
// stay 0xff == closed — which is exactly why a reused pool plane leaks no
// spans in C. Model the pad1..pad4 block as ONE Uint8Array:
//   marks[0]=pad1, marks[1..320]=top[0..319], marks[321]=pad2, marks[322]=pad3,
//   marks[323..642]=bottom[0..319], marks[643]=pad4.
var VP_PAD1 = 0, VP_TOP = 1, VP_PAD2 = 321, VP_PAD3 = 322, VP_BOT = 323, VP_PAD4 = 643;
var VP_SENT = 255;
function newVisplane() {
    return { height: 0, picnum: 0, lightlevel: 0, minx: SCREENWIDTH, maxx: -1,
             marks: new Uint8Array(2 * SCREENWIDTH + 4) };
}
function vpTop(pl, x) { return (x >= 0 && x < SCREENWIDTH) ? pl.marks[VP_TOP + x] : VP_SENT; }
function vpBot(pl, x) { return (x >= 0 && x < SCREENWIDTH) ? pl.marks[VP_BOT + x] : VP_SENT; }

// R_MapPlane (r_plane.c:120)
function R_MapPlane(y, x1, x2) {
    var angle, distance, length, index;
    if (planeheight !== cachedheight[y]) {
        cachedheight[y] = planeheight;
        distance = cacheddistance[y] = FixedMul(planeheight, yslope[y]);
        ds_xstep = cachedxstep[y] = FixedMul(distance, basexscale);
        ds_ystep = cachedystep[y] = FixedMul(distance, baseyscale);
    } else {
        distance = cacheddistance[y];
        ds_xstep = cachedxstep[y];
        ds_ystep = cachedystep[y];
    }
    length = FixedMul(distance, distscale[x1]);
    angle = ((viewangle + xtoviewangle[x1]) >>> 0) >>> ANGLETOFINESHIFT;
    ds_xfrac = (viewx + FixedMul(finecosine[angle], length)) | 0;
    ds_yfrac = (-viewy - FixedMul(finesine[angle], length)) | 0;
    if (fixedcolormap) ds_colormap = fixedcolormap;
    else {
        index = distance >> LIGHTZSHIFT;
        if (index >= MAXLIGHTZ) index = MAXLIGHTZ - 1;
        ds_colormap = planezlight[index];
    }
    ds_y = y; ds_x1 = x1; ds_x2 = x2;
    spanfunc();
}

// R_ClearPlanes (r_plane.c:185)
function R_ClearPlanes() {
    var i, angle;
    for (i = 0; i < viewwidth; i++) {
        floorclip[i] = viewheight;
        ceilingclip[i] = -1;
    }
    lastvisplane = 0; lastopening = 0;
    // maskedtexturecol pool sentinel = MAXSHORT (C pool was malloc garbage;
    // only columns written by R_RenderSegLoop are ever non-sentinel)
    openings.fill(0x7fff);
    cachedheight.fill(0);
    angle = ((viewangle - ANG90) >>> 0) >>> ANGLETOFINESHIFT;
    basexscale = FixedDiv(finecosine[angle], centerxfrac);
    baseyscale = -FixedDiv(finesine[angle], centerxfrac);
}

// R_FindPlane (r_plane.c:217). 1.10 I_Errors on MAXVISPLANES overflow —
// replicated as a throw (game.js/main.js never hit it on stock maps).
function R_FindPlane(height, picnum, lightlevel) {
    if (picnum === skyflatnum) { height = 0; lightlevel = 0; }  // all sky merges
    var check;
    for (check = 0; check < lastvisplane; check++)
        if (height === visplanes[check].height &&
            picnum === visplanes[check].picnum &&
            lightlevel === visplanes[check].lightlevel) break;
    if (check < lastvisplane) return visplanes[check];
    if (lastvisplane === MAXVISPLANES)
        throw new Error("R_FindPlane: no more visplanes");   // r_plane.c:246
    if (visplanes.length === lastvisplane) visplanes.push(newVisplane());
    var pl = visplanes[lastvisplane++];
    pl.height = height; pl.picnum = picnum; pl.lightlevel = lightlevel;
    pl.minx = SCREENWIDTH; pl.maxx = -1;
    pl.marks.fill(VP_SENT, VP_TOP, VP_TOP + SCREENWIDTH);  // memset(top,0xff,320)
    return pl;
}

// R_CheckPlane (r_plane.c:266) — splits when the new range overlaps marked
// columns. NOTE: 1.10 does NOT bounds-check this path (real crash bug with
// >128 visplanes); we clamp to reuse to stay crash-free (documented).
function R_CheckPlane(pl, start, stop) {
    var intrl, intrh, unionl, unionh, x;
    if (start < pl.minx) { intrl = pl.minx; unionl = start; }
    else { unionl = pl.minx; intrl = start; }
    if (stop > pl.maxx) { intrh = pl.maxx; unionh = stop; }
    else { unionh = pl.maxx; intrh = stop; }
    for (x = intrl; x <= intrh; x++)
        if (pl.marks[VP_TOP + x] !== VP_SENT) break;
    if (x > intrh) {
        pl.minx = unionl; pl.maxx = unionh;
        return pl;
    }
    if (lastvisplane >= MAXVISPLANES) return pl;   // deviation: no crash
    var npl = visplanes.length === lastvisplane ? (visplanes.push(newVisplane()), visplanes[lastvisplane]) : visplanes[lastvisplane];
    npl.height = pl.height; npl.picnum = pl.picnum; npl.lightlevel = pl.lightlevel;
    lastvisplane++;
    npl.minx = start; npl.maxx = stop;
    npl.marks.fill(VP_SENT, VP_TOP, VP_TOP + SCREENWIDTH);  // memset(top,0xff,320); bottom keeps pool
    return npl;
}

// R_MakeSpans (r_plane.c:330)
function R_MakeSpans(x, t1, b1, t2, b2) {
    while (t1 < t2 && t1 <= b1) { R_MapPlane(t1, spanstart[(t1)+1], x - 1); t1++; }
    while (b1 > b2 && b1 >= t1) { R_MapPlane(b1, spanstart[(b1)+1], x - 1); b1--; }
    while (t2 < t1 && t2 <= b2) { spanstart[(t2)+1] = x; t2++; }
    while (b2 > b1 && b2 >= t2) { spanstart[(b2)+1] = x; b2--; }
}

// R_DrawPlanes (r_plane.c:367) — SKY DEVIATION: F_SKY1 columns are painted
// with 1px-wide vertical gradient bands picked by (viewangle+xtoviewangle[x])
// >> ANGLETOSKYSHIFT (16 bands), fullbright table (index 32 in ASSETS
// colormaps = the fullbright map; C's `colormaps`==table 0 plays that role —
// ASSETS table order is dark->bright so fullbright is 32 here).
function R_DrawPlanes() {
    var pl, light, x, stop, angle;
    for (var pi = 0; pi < lastvisplane; pi++) {
        pl = visplanes[pi];
        if (pl.minx > pl.maxx) continue;
        if (pl.picnum === skyflatnum) {
            dc_iscale = pspriteiscale >> detailshift;
            dc_colormap = FULLCOLORMAP;      // always full bright (see note)
            dc_texturemid = skytexturemid;
            for (x = pl.minx; x <= pl.maxx; x++) {
                dc_yl = pl.marks[VP_TOP + x];
                dc_yh = vpBot(pl, x);
                if (dc_yl <= dc_yh) {
                    angle = ((viewangle + xtoviewangle[x]) >>> 0) >> ANGLETOSKYSHIFT;
                    dc_x = x;
                    var c = R_GetColumn(skytexture, angle);
                    dc_source = c[0]; dc_srcoff = c[1];
                    colfunc();
                }
            }
            continue;
        }
        ds_source = flatpix[flattranslation[pl.picnum]];   // r_plane.c:424
        planeheight = Math.abs(pl.height - viewz) | 0;
        light = (pl.lightlevel >> LIGHTSEGSHIFT) + extralight;
        if (light >= LIGHTLEVELS) light = LIGHTLEVELS - 1;
        if (light < 0) light = 0;
        planezlight = zlight[light];
        // faithful (r_plane.c:438-439): byte writes into the pads, no clamp.
        // top[maxx+1] at maxx==319 -> pad2 (byte, harmless); top[minx-1] at
        // minx==0 -> pad1 (byte, harmless). Neither is ever read back as a mark.
        if (pl.maxx + 1 >= 0 && pl.maxx + 1 < SCREENWIDTH)
            pl.marks[VP_TOP + pl.maxx + 1] = VP_SENT;
        else if (pl.maxx + 1 === SCREENWIDTH)
            pl.marks[VP_PAD2] = VP_SENT;
        if (pl.minx - 1 >= 0 && pl.minx - 1 < SCREENWIDTH)
            pl.marks[VP_TOP + pl.minx - 1] = VP_SENT;
        else if (pl.minx - 1 === -1)
            pl.marks[VP_PAD1] = VP_SENT;
        stop = pl.maxx + 1;
        for (x = pl.minx; x <= stop; x++)
            R_MakeSpans(x, vpTop(pl, x - 1), vpBot(pl, x - 1),
                           vpTop(pl, x), vpBot(pl, x));
    }
}

// ===========================================================================
// BSP TRAVERSAL (r_bsp.c)
// ===========================================================================
var curline = null, sidedef = null, linedef = null,
    frontsector = null, backsector = null;
var drawsegs = [], ds_p = 0;
var solidsegs = [], newend = 0;

function R_ClearDrawSegs() { ds_p = 0; }
// QUIRK (r_bsp.c:586): front subtree visited first, back subtree only if
// R_CheckBBox says its far bbox may still peek through solidsegs.
function R_ClearClipSegs() {
    solidsegs[0] = { first: -0x7fffffff, last: -1 };
    solidsegs[1] = { first: viewwidth, last: 0x7fffffff };
    newend = 2;
}

// R_ClipSolidWallSegment (r_bsp.c:103) — pointer arithmetic rewritten with
// indices; semantics line-for-line (crunch loop = slide tail down over the
// ranges start+1..next that start now covers).
function R_ClipSolidWallSegment(first, last) {
    var start = 0;
    while (solidsegs[start].last < first - 1) start++;
    var next;
    if (first < solidsegs[start].first) {
        if (last < solidsegs[start].first - 1) {
            // Post is entirely visible (above start): insert a new clippost.
            R_StoreWallRange(first, last);
            next = newend++;
            while (next !== start) { solidsegs[next] = solidsegs[next - 1]; next--; }
            solidsegs[start] = { first: first, last: last };
            return;
        }
        // There is a fragment above *start.
        R_StoreWallRange(first, solidsegs[start].first - 1);
        solidsegs[start].first = first;
    }
    if (last <= solidsegs[start].last) return;   // bottom contained in start
    next = start;
    var crunched = false;
    while (last >= solidsegs[next + 1].first - 1) {
        // There is a fragment between two posts.
        R_StoreWallRange(solidsegs[next].last + 1, solidsegs[next + 1].first - 1);
        next++;
        if (last <= solidsegs[next].last) {
            // Bottom is contained in next. Adjust the clip size.
            solidsegs[start].last = solidsegs[next].last;
            crunched = true;
            break;
        }
    }
    if (!crunched) {
        // There is a fragment after *next.
        R_StoreWallRange(solidsegs[next].last + 1, last);
        solidsegs[start].last = last;
    }
    // crunch: remove start+1..next from the clip list
    if (next === start) return;
    while (next + 1 < newend) {
        next++; start++;
        solidsegs[start] = solidsegs[next];
    }
    newend = start + 1;
}

// R_ClipPassWallSegment (r_bsp.c:196)
function R_ClipPassWallSegment(first, last) {
    var start = 0;
    while (solidsegs[start].last < first - 1) start++;
    if (first < solidsegs[start].first) {
        if (last < solidsegs[start].first - 1) {
            R_StoreWallRange(first, last);
            return;
        }
        R_StoreWallRange(first, solidsegs[start].first - 1);
    }
    if (last <= solidsegs[start].last) return;
    while (last >= solidsegs[start + 1].first - 1) {
        R_StoreWallRange(solidsegs[start].last + 1, solidsegs[start + 1].first - 1);
        start++;
        if (last <= solidsegs[start].last) return;
    }
    R_StoreWallRange(solidsegs[start].last + 1, last);
}

// R_AddLine (r_bsp.c:259)
function R_AddLine(line) {
    var x1, x2, angle1, angle2, span, tspan;
    curline = line;
    angle1 = R_PointToAngle(line.v1.x, line.v1.y);
    angle2 = R_PointToAngle(line.v2.x, line.v2.y);
    span = ((angle1 - angle2) >>> 0);
    if (span >= ANG180) return;           // backface
    rw_angle1 = angle1;
    angle1 = ((angle1 - viewangle) >>> 0);
    angle2 = ((angle2 - viewangle) >>> 0);
    tspan = ((angle1 + clipangle) >>> 0);
    if (tspan > 2 * clipangle) {
        tspan = ((tspan - 2 * clipangle) >>> 0);
        if (tspan >= span) return;
        angle1 = clipangle;
    }
    tspan = ((clipangle - angle2) >>> 0);
    if (tspan > 2 * clipangle) {
        tspan = ((tspan - 2 * clipangle) >>> 0);
        if (tspan >= span) return;
        angle2 = ((-clipangle) >>> 0);
    }
    angle1 = ((angle1 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
    angle2 = ((angle2 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
    x1 = viewangletox[angle1];
    x2 = viewangletox[angle2];
    if (x1 === x2) return;                 // does not cross a pixel
    backsector = line.backsector;
    // single sided / closed door -> clipsolid; window -> clippass (C goto)
    var pass;
    if (!backsector) pass = false;
    else if (backsector.ceilingheight <= frontsector.floorheight ||
             backsector.floorheight >= frontsector.ceilingheight)
        pass = false;                      // closed door
    else if (backsector.ceilingheight !== frontsector.ceilingheight ||
             backsector.floorheight !== frontsector.floorheight)
        pass = true;                       // window
    else {
        // Reject empty lines used for triggers and special events: identical
        // floors/ceilings/light and no middle texture.
        if (backsector.ceilingpic === frontsector.ceilingpic &&
            backsector.floorpic === frontsector.floorpic &&
            backsector.lightlevel === frontsector.lightlevel &&
            curline.sidedef.midtexture === 0)
            return;
        pass = true;                       // C falls through into clippass:
    }
    if (pass) R_ClipPassWallSegment(x1, x2 - 1);
    else R_ClipSolidWallSegment(x1, x2 - 1);
}

// R_CheckBBox (r_bsp.c:365/381) — 12-entry corner table, row 5 == inside.
var checkcoord = [
    [3, 0, 2, 1], [3, 0, 2, 0], [3, 1, 2, 0], [0, 0, 0, 0],
    [2, 0, 2, 1], [0, 0, 0, 0], [3, 1, 3, 0], [0, 0, 0, 0],
    [2, 0, 3, 1], [2, 1, 3, 1], [2, 1, 3, 0]
];
function R_CheckBBox(bspcoord) {
    var boxx, boxy, boxpos, x1, y1, x2, y2, angle1, angle2, span, tspan, start, sx1, sx2;
    if (viewx <= bspcoord[BOXLEFT]) boxx = 0;
    else if (viewx < bspcoord[BOXRIGHT]) boxx = 1;
    else boxx = 2;
    if (viewy >= bspcoord[BOXTOP]) boxy = 0;
    else if (viewy > bspcoord[BOXBOTTOM]) boxy = 1;
    else boxy = 2;
    boxpos = (boxy << 2) + boxx;
    if (boxpos === 5) return true;
    x1 = bspcoord[checkcoord[boxpos][0]];
    y1 = bspcoord[checkcoord[boxpos][1]];
    x2 = bspcoord[checkcoord[boxpos][2]];
    y2 = bspcoord[checkcoord[boxpos][3]];
    angle1 = ((R_PointToAngle(x1, y1) - viewangle) >>> 0);
    angle2 = ((R_PointToAngle(x2, y2) - viewangle) >>> 0);
    span = ((angle1 - angle2) >>> 0);
    if (span >= ANG180) return true;       // sitting on a line
    tspan = ((angle1 + clipangle) >>> 0);
    if (tspan > 2 * clipangle) {
        tspan = ((tspan - 2 * clipangle) >>> 0);
        if (tspan >= span) return false;
        angle1 = clipangle;
    }
    tspan = ((clipangle - angle2) >>> 0);
    if (tspan > 2 * clipangle) {
        tspan = ((tspan - 2 * clipangle) >>> 0);
        if (tspan >= span) return false;
        angle2 = ((-clipangle) >>> 0);
    }
    angle1 = ((angle1 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
    angle2 = ((angle2 + ANG90) >>> 0) >>> ANGLETOFINESHIFT;
    sx1 = viewangletox[angle1];
    sx2 = viewangletox[angle2];
    if (sx1 === sx2) return false;
    sx2--;
    start = 0;
    while (solidsegs[start].last < sx2) start++;
    if (sx1 >= solidsegs[start].first && sx2 <= solidsegs[start].last)
        return false;                      // clippost contains the new span
    return true;
}

// R_Subsector (r_bsp.c:497)
function R_Subsector(num) {
    var count, line, sub;
    sub = subsectors[num];
    frontsector = sub.sector;
    count = sub.numlines;
    if (frontsector.floorheight < viewz)
        floorplane = R_FindPlane(frontsector.floorheight,
                                 frontsector.floorpic, frontsector.lightlevel);
    else floorplane = null;
    if (frontsector.ceilingheight > viewz ||
        frontsector.ceilingpic === skyflatnum)
        ceilingplane = R_FindPlane(frontsector.ceilingheight,
                                   frontsector.ceilingpic, frontsector.lightlevel);
    else ceilingplane = null;
    R_AddSprites(frontsector);
    line = sub.firstline;
    while (count--) {
        R_AddLine(segs[line]);
        line++;
    }
}

// R_RenderBSPNode (r_bsp.c:552)
function R_RenderBSPNode(bspnum) {
    if (bspnum & NF_SUBSECTOR) {
        if (bspnum === -1) R_Subsector(0);
        else R_Subsector(bspnum & (~NF_SUBSECTOR));
        return;
    }
    var bsp = nodes[bspnum];
    var side = R_PointOnSide(viewx, viewy, bsp);
    R_RenderBSPNode(bsp.children[side]);
    if (R_CheckBBox(bsp.bbox[side ^ 1]))
        R_RenderBSPNode(bsp.children[side ^ 1]);
}

// ===========================================================================
// SEG RENDERING (r_segs.c)
// ===========================================================================
var segtextured = false, markfloor = false, markceiling = false,
    maskedtexture = false;
var toptexture = 0, bottomtexture = 0, midtexture = 0;
var rw_normalangle = 0, rw_angle1 = 0;
var rw_x = 0, rw_stopx = 0;
var rw_centerangle = 0, rw_offset = 0, rw_distance = 0, rw_scale = 0,
    rw_scalestep = 0;
var rw_midtexturemid = 0, rw_toptexturemid = 0, rw_bottomtexturemid = 0;
var worldtop = 0, worldbottom = 0, worldhigh = 0, worldlow = 0;
var pixhigh = 0, pixlow = 0, pixhighstep = 0, pixlowstep = 0;
var topfrac = 0, topstep = 0, bottomfrac = 0, bottomstep = 0;
var maskedtexturecol = 0;                  // base offset into `openings`
var maskedBase = 0;                        // maskedtexturecol + x indexes openings
var HEIGHTBITS = 12, HEIGHTUNIT = (1 << HEIGHTBITS);
var spryscale = 0, sprtopscreen = 0, mfloorclip = null, mceilingclip = null;

// R_RenderSegLoop (r_segs.c:206) — wall tiers + plane marking; masked mid
// texture columns are only STORED here (maskedtexturecol), drawn later from
// the drawseg list (the "masked textureclip trick").
function R_RenderSegLoop() {
    var angle, index, yl, yh, mid, texturecolumn, top, bottom;
    for (; rw_x < rw_stopx; rw_x++) {
        yl = ((topfrac + HEIGHTUNIT - 1) | 0) >> HEIGHTBITS;
        if (yl < ceilingclip[rw_x] + 1) yl = ceilingclip[rw_x] + 1;
        if (markceiling) {
            top = ceilingclip[rw_x] + 1;
            bottom = yl - 1;
            if (bottom >= floorclip[rw_x]) bottom = floorclip[rw_x] - 1;
            if (top <= bottom) {
                ceilingplane.marks[VP_TOP + rw_x] = top;
                ceilingplane.marks[VP_BOT + rw_x] = bottom;
            }
        }
        yh = (bottomfrac | 0) >> HEIGHTBITS;
        if (yh >= floorclip[rw_x]) yh = floorclip[rw_x] - 1;
        if (markfloor) {
            top = yh + 1;
            bottom = floorclip[rw_x] - 1;
            if (top <= ceilingclip[rw_x]) top = ceilingclip[rw_x] + 1;
            if (top <= bottom) {
                floorplane.marks[VP_TOP + rw_x] = top;
                floorplane.marks[VP_BOT + rw_x] = bottom;
            }
        }
        if (segtextured) {
            angle = ((rw_centerangle + xtoviewangle[rw_x]) >>> 0) >>> ANGLETOFINESHIFT;
            texturecolumn = (rw_offset - FixedMul(finetangent[angle], rw_distance)) | 0;
            texturecolumn >>= FRACBITS;
            index = rw_scale >> LIGHTSCALESHIFT;
            if (index >= MAXLIGHTSCALE) index = MAXLIGHTSCALE - 1;
            dc_colormap = walllights[index];
            dc_x = rw_x;
            dc_iscale = Math.floor(0xffffffff / (rw_scale >>> 0)) >>> 0;
        }
        if (midtexture) {
            dc_yl = yl; dc_yh = yh;
            dc_texturemid = rw_midtexturemid;
            var c = R_GetColumn(midtexture, texturecolumn);
            dc_source = c[0]; dc_srcoff = c[1];
            colfunc();
            ceilingclip[rw_x] = viewheight;
            floorclip[rw_x] = -1;
        } else {
            if (toptexture) {
                mid = (pixhigh | 0) >> HEIGHTBITS;
                pixhigh = (pixhigh + pixhighstep) | 0;
                if (mid >= floorclip[rw_x]) mid = floorclip[rw_x] - 1;
                if (mid >= yl) {
                    dc_yl = yl; dc_yh = mid;
                    dc_texturemid = rw_toptexturemid;
                    var c2 = R_GetColumn(toptexture, texturecolumn);
                    dc_source = c2[0]; dc_srcoff = c2[1];
                    colfunc();
                    ceilingclip[rw_x] = mid;
                } else ceilingclip[rw_x] = yl - 1;
            } else if (markceiling) ceilingclip[rw_x] = yl - 1;

            if (bottomtexture) {
                mid = ((pixlow + HEIGHTUNIT - 1) | 0) >> HEIGHTBITS;
                pixlow = (pixlow + pixlowstep) | 0;
                if (mid <= ceilingclip[rw_x]) mid = ceilingclip[rw_x] + 1;
                if (mid <= yh) {
                    dc_yl = mid; dc_yh = yh;
                    dc_texturemid = rw_bottomtexturemid;
                    var c3 = R_GetColumn(bottomtexture, texturecolumn);
                    dc_source = c3[0]; dc_srcoff = c3[1];
                    colfunc();
                    floorclip[rw_x] = mid;
                } else floorclip[rw_x] = yh + 1;
            } else if (markfloor) floorclip[rw_x] = yh + 1;

            if (maskedtexture)
                openings[MPOOLBIAS + maskedBase + rw_x] = texturecolumn & 0xffff;
        }
        rw_scale = (rw_scale + rw_scalestep) | 0;
        topfrac = (topfrac + topstep) | 0;
        bottomfrac = (bottomfrac + bottomstep) | 0;
    }
}

// R_StoreWallRange (r_segs.c:374) — drawseg creation, silhouettes, masked
// column storage, sprite clip snapshot (memcpy from ceilingclip/floorclip at
// THIS point in the back-to-front walk == painter's-order occlusion).
function R_StoreWallRange(start, stop) {
    if (ds_p === MAXDRAWSEGS) return;      // don't overflow and crash (r_bsp)
    var hyp, sineval, distangle, offsetangle, vtop, lightnum;
    sidedef = curline.sidedef;
    linedef = curline.linedef;
    linedef.flags |= ML_MAPPED;
    rw_normalangle = ((curline.angle + ANG90) >>> 0);
    offsetangle = ((rw_normalangle - rw_angle1) >>> 0);
    offsetangle = offsetangle > 0x80000000 ? (0x100000000 - offsetangle) : offsetangle;
    if (offsetangle > ANG90) offsetangle = ANG90;
    distangle = ((ANG90 - offsetangle) >>> 0);
    hyp = R_PointToDist(curline.v1.x, curline.v1.y);
    sineval = finesine[distangle >>> ANGLETOFINESHIFT];
    rw_distance = FixedMul(hyp, sineval);

    var ds = drawsegs[ds_p] || (drawsegs[ds_p] = {});
    ds.maskedBase = 0;
    ds.x1 = rw_x = start;
    ds.x2 = stop;
    ds.curline = curline;
    rw_stopx = stop + 1;
    ds.scale1 = rw_scale =
        R_ScaleFromGlobalAngle(((viewangle + xtoviewangle[start]) >>> 0));
    if (stop > start) {
        ds.scale2 = R_ScaleFromGlobalAngle(((viewangle + xtoviewangle[stop]) >>> 0));
        ds.scalestep = rw_scalestep =
            Math.trunc((ds.scale2 - rw_scale) / (stop - start));
    } else ds.scale2 = ds.scale1;

    worldtop = (frontsector.ceilingheight - viewz) | 0;
    worldbottom = (frontsector.floorheight - viewz) | 0;
    midtexture = toptexture = bottomtexture = 0;
    maskedtexture = false;
    ds.maskedtexturecol = 0;

    if (!backsector) {
        midtexture = texTr(sidedef.midtexture);
        markfloor = markceiling = true;    // terminal: must mark ends
        if (linedef.flags & ML_DONTPEGBOTTOM) {
            vtop = (frontsector.floorheight +
                    textureheight[sidedef.midtexture]) | 0;
            rw_midtexturemid = (vtop - viewz) | 0;   // bottom of tex at bottom
        } else rw_midtexturemid = worldtop;          // top of tex at top
        rw_midtexturemid = (rw_midtexturemid + sidedef.rowoffset) | 0;
        ds.silhouette = SIL_BOTH;
        ds.sprtopclip = screenheightarray;
        ds.sprbottomclip = negonearray;
        ds.bsilheight = MAXINT;
        ds.tsilheight = MININT;
    } else {
        ds.sprtopclip = ds.sprbottomclip = null;
        ds.silhouette = 0;
        if (frontsector.floorheight > backsector.floorheight) {
            ds.silhouette = SIL_BOTTOM; ds.bsilheight = frontsector.floorheight;
        } else if (backsector.floorheight > viewz) {
            ds.silhouette = SIL_BOTTOM; ds.bsilheight = MAXINT;
        }
        if (frontsector.ceilingheight < backsector.ceilingheight) {
            ds.silhouette |= SIL_TOP; ds.tsilheight = frontsector.ceilingheight;
        } else if (backsector.ceilingheight < viewz) {
            ds.silhouette |= SIL_TOP; ds.tsilheight = MININT;
        }
        if (backsector.ceilingheight <= frontsector.floorheight) {
            ds.sprbottomclip = negonearray;
            ds.bsilheight = MAXINT; ds.silhouette |= SIL_BOTTOM;
        }
        if (backsector.floorheight >= frontsector.ceilingheight) {
            ds.sprtopclip = screenheightarray;
            ds.tsilheight = MININT; ds.silhouette |= SIL_TOP;
        }
        worldhigh = (backsector.ceilingheight - viewz) | 0;
        worldlow = (backsector.floorheight - viewz) | 0;
        // hack: outdoor height changes share the sky ceiling
        if (frontsector.ceilingpic === skyflatnum &&
            backsector.ceilingpic === skyflatnum)
            worldtop = worldhigh;
        markfloor = worldlow !== worldbottom ||
            backsector.floorpic !== frontsector.floorpic ||
            backsector.lightlevel !== frontsector.lightlevel;
        markceiling = worldhigh !== worldtop ||
            backsector.ceilingpic !== frontsector.ceilingpic ||
            backsector.lightlevel !== frontsector.lightlevel;
        if (backsector.ceilingheight <= frontsector.floorheight ||
            backsector.floorheight >= frontsector.ceilingheight)
            markceiling = markfloor = true;   // closed door
        if (worldhigh < worldtop) {
            toptexture = texTr(sidedef.toptexture);
            if (linedef.flags & ML_DONTPEGTOP) rw_toptexturemid = worldtop;
            else {
                vtop = (backsector.ceilingheight +
                        textureheight[sidedef.toptexture]) | 0;
                rw_toptexturemid = (vtop - viewz) | 0;
            }
        }
        if (worldlow > worldbottom) {
            bottomtexture = texTr(sidedef.bottomtexture);
            if (linedef.flags & ML_DONTPEGBOTTOM) rw_bottomtexturemid = worldtop;
            else rw_bottomtexturemid = worldlow;
        }
        rw_toptexturemid = (rw_toptexturemid + sidedef.rowoffset) | 0;
        rw_bottomtexturemid = (rw_bottomtexturemid + sidedef.rowoffset) | 0;
        if (sidedef.midtexture > 0) {      // C: texture 0 == AASTINKY none
            // masked midtexture: stash one texturecolumn per covered x
            maskedtexture = true;
            maskedBase = lastopening - rw_x;
            lastopening += rw_stopx - rw_x;
            if (lastopening + MPOOLBIAS > openings.length)
                throw new Error("opening overflow");
            ds.maskedBase = maskedBase;
            ds.maskedtexturecol = 1;
        }
    }

    segtextured = !!(midtexture | toptexture | bottomtexture) || maskedtexture;
    if (segtextured) {
        offsetangle = ((rw_normalangle - rw_angle1) >>> 0);
        if (offsetangle > ANG180) offsetangle = ((-offsetangle) >>> 0);
        if (offsetangle > ANG90) offsetangle = ANG90;
        sineval = finesine[offsetangle >>> ANGLETOFINESHIFT];
        rw_offset = FixedMul(hyp, sineval);
        if (((rw_normalangle - rw_angle1) >>> 0) < ANG180) rw_offset = -rw_offset;
        rw_offset = (rw_offset + sidedef.textureoffset + curline.offset) | 0;
        rw_centerangle = ((ANG90 + viewangle - rw_normalangle) >>> 0);
        if (!fixedcolormap) {
            lightnum = (frontsector.lightlevel >> LIGHTSEGSHIFT) + extralight;
            if (curline.v1.y === curline.v2.y) lightnum--;
            else if (curline.v1.x === curline.v2.x) lightnum++;
            if (lightnum < 0) walllights = scalelight[0];
            else if (lightnum >= LIGHTLEVELS) walllights = scalelight[LIGHTLEVELS - 1];
            else walllights = scalelight[lightnum];
        }
    }

    if (frontsector.floorheight >= viewz) markfloor = false;
    if (frontsector.ceilingheight <= viewz &&
        frontsector.ceilingpic !== skyflatnum) markceiling = false;

    worldtop >>= 4;
    worldbottom >>= 4;
    topstep = -FixedMul(rw_scalestep, worldtop);
    topfrac = ((centeryfrac >> 4) - FixedMul(worldtop, rw_scale)) | 0;
    bottomstep = -FixedMul(rw_scalestep, worldbottom);
    bottomfrac = ((centeryfrac >> 4) - FixedMul(worldbottom, rw_scale)) | 0;
    if (backsector) {
        worldhigh >>= 4;
        worldlow >>= 4;
        if (worldhigh < worldtop) {
            pixhigh = ((centeryfrac >> 4) - FixedMul(worldhigh, rw_scale)) | 0;
            pixhighstep = -FixedMul(rw_scalestep, worldhigh);
        }
        if (worldlow > worldbottom) {
            pixlow = ((centeryfrac >> 4) - FixedMul(worldlow, rw_scale)) | 0;
            pixlowstep = -FixedMul(rw_scalestep, worldlow);
        }
    }

    if (markceiling) ceilingplane = R_CheckPlane(ceilingplane, rw_x, rw_stopx - 1);
    if (markfloor) floorplane = R_CheckPlane(floorplane, rw_x, rw_stopx - 1);
    R_RenderSegLoop();

    // snapshot the current clips for sprite occlusion (C memcpy from
    // ceilingclip+start / floorclip+start into the openings pool)
    if (((ds.silhouette & SIL_TOP) || maskedtexture) && !ds.sprtopclip) {
        openings.fill(0, MPOOLBIAS + lastopening, MPOOLBIAS + lastopening + (rw_stopx - start));
        openings.set(ceilingclip.subarray(start, rw_stopx), MPOOLBIAS + lastopening);
        ds.sprtopclip = lastopening - start;
        lastopening += rw_stopx - start;
    }
    if (((ds.silhouette & SIL_BOTTOM) || maskedtexture) && !ds.sprbottomclip) {
        openings.fill(0, MPOOLBIAS + lastopening, MPOOLBIAS + lastopening + (rw_stopx - start));
        openings.set(floorclip.subarray(start, rw_stopx), MPOOLBIAS + lastopening);
        ds.sprbottomclip = lastopening - start;
        lastopening += rw_stopx - start;
    }
    if (maskedtexture && !(ds.silhouette & SIL_TOP)) {
        ds.silhouette |= SIL_TOP; ds.tsilheight = MININT;
    }
    if (maskedtexture && !(ds.silhouette & SIL_BOTTOM)) {
        ds.silhouette |= SIL_BOTTOM; ds.bsilheight = MAXINT;
    }
    ds_p++;
}

// R_ScaleFromGlobalAngle (r_main.c:453)
function R_ScaleFromGlobalAngle(visangle) {
    var anglea, angleb, sinea, sineb, num, den, scale;
    anglea = ((ANG90 + visangle - viewangle) >>> 0);
    angleb = ((ANG90 + visangle - rw_normalangle) >>> 0);
    sinea = finesine[anglea >>> ANGLETOFINESHIFT];
    sineb = finesine[angleb >>> ANGLETOFINESHIFT];
    num = (FixedMul(projection, sineb) << detailshift) | 0;
    den = FixedMul(rw_distance, sinea);
    if (den > (num >> 16)) {
        scale = FixedDiv(num, den);
        if (scale > 64 * FRACUNIT) scale = 64 * FRACUNIT;
        else if (scale < 256) scale = 256;
    } else scale = 64 * FRACUNIT;
    return scale;
}

// clipView: drawseg clip snapshots live in the openings pool (C short*
// arithmetic); wrap a pool offset as an Int16Array view over the same buffer.
function clipView(v) {
    if (typeof v === 'number')
        return new Int16Array(openings.buffer, (v + MPOOLBIAS) * 2, SCREENWIDTH);
    return v;
}

// R_RenderMaskedSegRange (r_segs.c:102) — the deferred masked-midtexture pass
function R_RenderMaskedSegRange(ds, x1, x2) {
    var index, lightnum, texnum;
    curline = ds.curline;
    frontsector = curline.frontsector;
    backsector = curline.backsector;
    texnum = texTr(curline.sidedef.midtexture);
    lightnum = (frontsector.lightlevel >> LIGHTSEGSHIFT) + extralight;
    if (curline.v1.y === curline.v2.y) lightnum--;
    else if (curline.v1.x === curline.v2.x) lightnum++;
    if (lightnum < 0) walllights = scalelight[0];
    else if (lightnum >= LIGHTLEVELS) walllights = scalelight[LIGHTLEVELS - 1];
    else walllights = scalelight[lightnum];
    var mtcBase = ds.maskedBase;            // ds columns live at openings[mtcBase+x]
    rw_scalestep = ds.scalestep;
    spryscale = Math.trunc(ds.scale1 + (x1 - ds.x1) * rw_scalestep) | 0;
    mfloorclip = clipView(ds.sprbottomclip);
    mceilingclip = clipView(ds.sprtopclip);
    if (curline.linedef.flags & ML_DONTPEGBOTTOM) {
        dc_texturemid = frontsector.floorheight > backsector.floorheight
            ? frontsector.floorheight : backsector.floorheight;
        dc_texturemid = (dc_texturemid + textureheight[texnum] - viewz) | 0;
    } else {
        dc_texturemid = frontsector.ceilingheight < backsector.ceilingheight
            ? frontsector.ceilingheight : backsector.ceilingheight;
        dc_texturemid = (dc_texturemid - viewz) | 0;
    }
    dc_texturemid = (dc_texturemid + curline.sidedef.rowoffset) | 0;
    if (fixedcolormap) dc_colormap = fixedcolormap;
    for (dc_x = x1; dc_x <= x2; dc_x++) {
        if (openings[MPOOLBIAS + mtcBase + dc_x] !== 0x7fff) {
            if (!fixedcolormap) {
                index = spryscale >> LIGHTSCALESHIFT;
                if (index >= MAXLIGHTSCALE) index = MAXLIGHTSCALE - 1;
                dc_colormap = walllights[index];
            }
            sprtopscreen = (centeryfrac - FixedMul(dc_texturemid, spryscale)) | 0;
            dc_iscale = Math.floor(0xffffffff / (spryscale >>> 0)) >>> 0;
            // r_segs.c:178-184: col = (column_t *)(R_GetColumn(texnum,
            // maskedtexturecol[dc_x]) - 3); R_DrawMaskedColumn(col);
            // The knockout IS the inter-post gap, so a hole-bearing texture
            // must hand over its real post chain; a fully-empty column draws
            // nothing at all (vanilla post list = only the 0xff terminator).
            var tp = textureposts[texnum];
            if (tp) {
                var tcol = openings[MPOOLBIAS + mtcBase + dc_x];
                tcol = ((tcol % texturewidth[texnum]) + texturewidth[texnum])
                       % texturewidth[texnum];
                var pcol = tp.cols[tcol];
                if (pcol.length) R_DrawMaskedColumn(pcol, tp.pix);
            } else {
                var col = R_GetColumn(texnum, openings[MPOOLBIAS + mtcBase + dc_x]);
                R_DrawMaskedColumn([[0, col[2], col[1]]], col[0]);
            }
            openings[MPOOLBIAS + mtcBase + dc_x] = 0x7fff;
        }
        spryscale = (spryscale + rw_scalestep) | 0;
    }
}

// ===========================================================================
// SPRITES (r_things.c)
// ===========================================================================
var pspritescale = FRACUNIT, pspriteiscale = FRACUNIT;
var spritelights = scalelight;
// sprite table: sprites[i] = { name, numframes, spriteframes:[{rotate,
// lump[8], flip[8]}] }; lump indexes spritePix[] (post-decoded patches)
var sprites = [];
var spriteoffset = [], spritewidth = [], spriteoffsety = [],
    spritetopoffset = [], spritePix = [], spritePatch = [];
var spriteNameIdx = {};              // "POSS" -> sprites index

// post-decode a sprite lump into {pix, cols} (posts per column, §buildPosts).
// DEVIATION FIXED (mirror monsters angled wrong both sides): this used to
// horizontally pre-mirror the pixels when flip was requested, but
// R_ProjectSprite ALSO sets xiscale<0 for flipped rotations (gospel
// r_things.c:532) — mirror x mirror = identity, so rotations 5-8 drew the
// UNMIRRORED art. Vanilla decodes each lump once, unmirrored: the flip is
// ONLY the negative xiscale column walk. flip param now ignored.
function R_DecodeSpritePatch(b64, w, h, flip) {
    var px = b64decode(b64);
    return buildPosts(px, w, h);
}

// R_InstallSpriteLump (r_things.c:105) — sprtemp lives in the caller
function R_InstallSpriteLump(sprtemp, maxframeRef, lump, frame, rotation, flipped, spritename) {
    if (frame >= 29 || rotation > 8)
        throw new Error("R_InstallSpriteLump: bad frame characters in lump " + lump);
    var r;
    if (maxframeRef.v < frame) maxframeRef.v = frame;
    // DEVIATION (shared by the rot0/rotate clash and the two-lumps clash
    // below): vanilla I_Error's on either conflict. This WAD ships
    // overlapping extended-sprite lumps (PLAYA2A8 pairs into slots already
    // filled by earlier lumps, and rot=0 death frames coexist with
    // rotated frames), so skip the colliding lump and keep the first map.
    if (rotation === 0) {
        if (sprtemp[frame].rotate === true) return;
        sprtemp[frame].rotate = false;
        for (r = 0; r < 8; r++) {
            sprtemp[frame].lump[r] = lump;
            sprtemp[frame].flip[r] = flipped ? 1 : 0;
        }
        return;
    }
    if (sprtemp[frame].rotate === false) return;
    sprtemp[frame].rotate = true;
    rotation--;
    if (sprtemp[frame].lump[rotation] !== -1)
        return;
    sprtemp[frame].lump[rotation] = lump;
    sprtemp[frame].flip[rotation] = flipped ? 1 : 0;
}

// ARCHITECTURE.md runtime aliases (generated WAD lacked these lumps)
var SPRITE_ALIASES = {
    PISF: 'FLASH', SHTF: 'FLASH', BLUD: 'PUFF',
    CLIP: 'MEDA', SBOX: 'MEDA', AMMO: 'MEDA',
    SHOT: 'BAR1', ARM1: 'SK1', BKEY: 'COL5'
};
function resolveSpriteName(name) {
    // aliases exist for the synthetic asset set; a real WAD carries the
    // genuine lumps, so only alias when the real name is absent
    if (SPRITE_LUMPS[name]) return name;
    return SPRITE_ALIASES[name] || name;
}
var SPRITE_LUMPS = {};   // rebuilt in R_InitSprites: real 4-char prefixes

// R_InitSpriteDefs-style build from ASSETS.sprites lump names. Names longer
// than 6 chars carry the mirror pair (PLAYA1A3 -> A1 + flipped A3).
function R_InitSprites() {
    var names = Object.keys(ASSETS.sprites);
    // collect distinct 4-char sprite names (alias targets included)
    var spriteNames = [];
    var seen = {};
    SPRITE_LUMPS = {};
    for (var n = 0; n < names.length; n++) {
        var sn = names[n].slice(0, 4);
        SPRITE_LUMPS[sn] = true;
        if (!seen[sn]) { seen[sn] = 1; spriteNames.push(sn); }
    }
    sprites = [];
    spriteNameIdx = {};
    for (var i = 0; i < spriteNames.length; i++) {
        var spritename = spriteNames[i];
        var real = resolveSpriteName(spritename);
        spriteNameIdx[spritename] = i;
        var sprtemp = new Array(29);
        for (var f = 0; f < 29; f++)
            sprtemp[f] = { rotate: -1, lump: [-1, -1, -1, -1, -1, -1, -1, -1],
                           flip: [0, 0, 0, 0, 0, 0, 0, 0] };
        var maxframeRef = { v: -1 };
        for (n = 0; n < names.length; n++) {
            var ln = names[n];
            if (ln.slice(0, 4) !== real) continue;
            var frame = ln.charCodeAt(4) - 65;
            if (frame < 0 || frame >= 29) continue;
            var rotation = ln.charCodeAt(5) - 48;
            // DEVIATION (synthetic assets): lump names like 'POSSA10' carry
            // multi-digit rotation numbers > 8 which are not WAD rotations —
            // skip them rather than erroring (real WADs never exceed 8).
            if (rotation < 0 || rotation > 8) continue;
            if (ln.length > 6 && ln.charCodeAt(6) >= 48 && ln.charCodeAt(6) <= 57)
                continue;              // multi-digit number = not a WAD lump
            var lumpIdx = R_GetOrMakePatch(real, ln);
            R_InstallSpriteLump(sprtemp, maxframeRef, lumpIdx, frame, rotation, false, spritename);
            if (ln.length > 7 && ln.charCodeAt(6) >= 65 && ln.charCodeAt(6) <= 93) {
                var frame2 = ln.charCodeAt(6) - 65;
                var rotation2 = ln.charCodeAt(7) - 48;
                if (frame2 < 0 || frame2 >= 29 || rotation2 < 1 || rotation2 > 8) continue;
                // mirror pair: same pixels, horizontally flipped at decode
                var flump = R_GetOrMakePatch(real, ln, true);
                R_InstallSpriteLump(sprtemp, maxframeRef, flump, frame2, rotation2, true, spritename);
            }
        }
        if (maxframeRef.v === -1) {
            sprites.push({ name: spritename, numframes: 0, spriteframes: [] });
            continue;
        }
        var mf = maxframeRef.v + 1;
        var sfs = [];
        for (f = 0; f < mf; f++) {
            if (sprtemp[f].rotate === 1) {
                var missing = false;
                for (rotation = 0; rotation < 8; rotation++)
                    if (sprtemp[f].lump[rotation] === -1) missing = true;
                if (missing) {
                    // DEVIATION (synthetic assets): partial rotation sets
                    // (real WADs must be complete, C I_Errors here) collapse
                    // to a single-frame sprite using the first present lump.
                    sprtemp[f].rotate = 0;
                    for (rotation = 1; rotation < 8; rotation++)
                        if (sprtemp[f].lump[rotation] !== -1) {
                            sprtemp[f].lump[0] = sprtemp[f].lump[rotation];
                            sprtemp[f].flip[0] = sprtemp[f].flip[rotation];
                            break;
                        }
                }
            }
            sfs.push(sprtemp[f]);
        }
        sprites.push({ name: spritename, numframes: mf, spriteframes: sfs });
    }
}
function R_GetOrMakePatch(real, lumpname, flip) {
    var key = lumpname + (flip ? 'F' : '');
    if (key in spriteCacheIdx) return spriteCacheIdx[key];
    var d = ASSETS.sprites[lumpname];
    var patch = R_DecodeSpritePatch(d[2], d[0], d[1], flip);
    var idx = spritePatch.length;
    spritePatch.push(patch);
    // WAD patches carry [w,h,px,leftoffset,topoffset]; a flipped (mirrored)
    // copy occupies the SAME screen rect in vanilla (flip only reverses the
    // column scan), so the offsets apply unchanged to the mirrored pixels.
    // Procedural assets keep 0.
    spriteoffset.push((d.length > 3 ? d[3] : 0) << FRACBITS);
    spritewidth.push(d[0] << FRACBITS);        // fixed_t, r_data.c:622
    spriteoffsety.push(0);
    spritetopoffset.push((d.length > 4 ? d[4] : d[1]) << FRACBITS);
    spritePix.push(patch.pix);
    spriteCacheIdx[key] = idx;
    return idx;
}
var spriteCacheIdx = {};

function R_InstallLevelSprites() {
    R_InitSprites();
}
function R_PrecacheLevel() { /* stub — all patches resident (ARCHITECTURE.md) */ }

// vissprites
var vissprites = [], vissprite_p = 0, overflowsprite = {};
function R_ClearSprites() { vissprite_p = 0; }
function R_NewVisSprite() {
    if (vissprite_p === MAXVISSPRITES) return overflowsprite;
    // vissprite_t pool (Z_Malloc'd array in C; lazily materialized here)
    if (!vissprites[vissprite_p]) vissprites[vissprite_p] = {};
    return vissprites[vissprite_p++];
}

// R_DrawMaskedColumn — posts = sprtemp column list [topdelta,len,pixStart].
// DEVIATION (bug-for-bug fix): vanilla r_draw.c:363 consumes topdelta as an
// ABSOLUTE row offset, but both buildPosts() and the raw WAD post format emit
// it RELATIVE to the previous post's end. Vanilla therefore draws every
// second post in a multi-post column prevEnd rows too high (the classic
// "floating sprite sliver" glitch). Accumulate the deltas so multi-post
// columns (pistol, fist, split monster columns) land at their true rows.
// Single-post callers (masked wall columns pass [0,...]) are unaffected.
function R_DrawMaskedColumn(posts, pix) {
    var topscreen, bottomscreen, basetexturemid, yacc;
    basetexturemid = dc_texturemid;
    yacc = 0;   // running end-row of the previous post
    for (var i = 0; i < posts.length; i++) {
        var topdelta = posts[i][0], length = posts[i][1], pstart = posts[i][2];
        topdelta = yacc + topdelta;   // delta is RELATIVE to previous post END
        yacc = topdelta + length;
        topscreen = (sprtopscreen + spryscale * topdelta) | 0;
        bottomscreen = (topscreen + spryscale * length) | 0;
        dc_yl = ((topscreen + FRACUNIT - 1) | 0) >> FRACBITS;
        dc_yh = ((bottomscreen - 1) | 0) >> FRACBITS;
        if (dc_yh >= mfloorclip[dc_x]) dc_yh = mfloorclip[dc_x] - 1;
        if (dc_yl <= mceilingclip[dc_x]) dc_yl = mceilingclip[dc_x] + 1;
        if (dc_yl <= dc_yh) {
            dc_source = pix; dc_srcoff = pstart;
            dc_texturemid = (basetexturemid - (topdelta << FRACBITS)) | 0;
            colfunc();
        }
    }
    dc_texturemid = basetexturemid;
}

// R_DrawVisSprite (r_things.c:396)
function R_DrawVisSprite(vis) {
    var patch = spritePatch[vis.patch];
    dc_colormap = vis.colormap;
    colfunc = basecolfunc;
    if (!dc_colormap && vis.shadow) colfunc = fuzzcolfunc;   // shadow draw
    else if (vis.mobjflags & MF_TRANSLATION) {
        colfunc = R_DrawTranslatedColumn;
        var tr = (vis.mobjflags & MF_TRANSLATION) >> (MF_TRANSSHIFT - 8);
        dc_translation = translationtables.subarray(tr * 256);
    }
    dc_iscale = Math.abs(vis.xiscale) >> detailshift;
    dc_texturemid = vis.texturemid;
    var frac = vis.startfrac;
    spryscale = vis.scale;
    sprtopscreen = (centeryfrac - FixedMul(dc_texturemid, spryscale)) | 0;
    for (dc_x = vis.x1; dc_x <= vis.x2; dc_x++, frac = (frac + vis.xiscale) | 0) {
        var texturecolumn = frac >> FRACBITS;
        if (texturecolumn < 0 || texturecolumn >= patch.cols.length) continue;
        R_DrawMaskedColumn(patch.cols[texturecolumn], patch.pix);
    }
    colfunc = basecolfunc;
}
var dc_translationOff = 0;

// R_ProjectSprite (r_things.c:452) — the x1 scalediv trick: x1 comes from
// FixedMul(tx,xscale) then >>FRACBITS; startfrac is corrected by xiscale*
// (x1-x1) only when clipped, exactly as C (no rescale).
function R_ProjectSprite(thing) {
    var tr_x, tr_y, gxt, gyt, tz, xscale, x1, x2;
    var sprdef, sprframe, lump, rot, flip, index;
    tr_x = (thing.x - viewx) | 0;
    tr_y = (thing.y - viewy) | 0;
    gxt = FixedMul(tr_x, viewcos);
    gyt = -FixedMul(tr_y, viewsin);
    tz = (gxt - gyt) | 0;
    if (tz < MINZ) return;                    // behind view plane
    xscale = FixedDiv(projection, tz);
    gxt = -FixedMul(tr_x, viewsin);
    gyt = FixedMul(tr_y, viewcos);
    tx = -(gyt + gxt) | 0;
    if (Math.abs(tx) > (tz << 2)) return;     // too far off the side
    var sname = thing.sprite;
    if (typeof sname === 'string') {
        var sidx = spriteNameIdx[sname];
        if (sidx === undefined) {
            sidx = spriteNameIdx[resolveSpriteName(sname)];
            if (sidx === undefined) return;   // no art (e.g. invisible)
        }
        sprdef = sprites[sidx];
    } else sprdef = sprites[sname];
    if (!sprdef || (thing.frame & FF_FRAMEMASK) >= sprdef.numframes) return;
    sprframe = sprdef.spriteframes[thing.frame & FF_FRAMEMASK];
    if (sprframe.rotate) {
        var ang = R_PointToAngle(thing.x, thing.y);
        rot = ((ang - (thing.angle >>> 0) + (ANG45 / 2 * 9 >>> 0)) >>> 29);
        lump = sprframe.lump[rot];
        flip = !!sprframe.flip[rot];
    } else {
        lump = sprframe.lump[0];
        flip = !!sprframe.flip[0];
    }
    var tx = (tx - spriteoffset[lump]) | 0;
    x1 = (centerxfrac + FixedMul(tx, xscale)) >> FRACBITS;
    if (x1 > viewwidth) return;
    tx += spritewidth[lump];
    x2 = ((centerxfrac + FixedMul(tx, xscale)) >> FRACBITS) - 1;
    if (x2 < 0) return;
    var vis = R_NewVisSprite();
    vis.mobjflags = thing.flags;
    vis.scale = (xscale << detailshift) | 0;
    vis.gx = thing.x; vis.gy = thing.y; vis.gz = thing.z || 0;
    vis.gzt = ((thing.z || 0) + spritetopoffset[lump]) | 0;
    vis.texturemid = (vis.gzt - viewz) | 0;
    vis.x1 = x1 < 0 ? 0 : x1;
    vis.x2 = x2 >= viewwidth ? viewwidth - 1 : x2;
    var iscale = FixedDiv(FRACUNIT, xscale);
    if (flip) { vis.startfrac = spritewidth[lump] - 1; vis.xiscale = -iscale; }
    else { vis.startfrac = 0; vis.xiscale = iscale; }
    if (vis.x1 > x1) vis.startfrac = (vis.startfrac + vis.xiscale * (vis.x1 - x1)) | 0;
    vis.patch = lump;
    vis.shadow = !!(thing.flags & MF_SHADOW);
    if (thing.flags & MF_SHADOW) vis.colormap = 0;
    else if (fixedcolormap) vis.colormap = fixedcolormap;
    else if (thing.frame & FF_FULLBRIGHT) vis.colormap = FULLCOLORMAP;
    else {
        index = xscale >> (LIGHTSCALESHIFT - detailshift);
        if (index >= MAXLIGHTSCALE) index = MAXLIGHTSCALE - 1;
        vis.colormap = spritelights[index];
    }
    vis.next = vis.prev = null;
}

// R_AddSprites (r_things.c:613) — sector thinglist (P_SetThingPosition links)
function R_AddSprites(sec) {
    if (sec.validcount === validcount) return;
    sec.validcount = validcount;
    var lightnum = (sec.lightlevel >> LIGHTSEGSHIFT) + extralight;
    if (lightnum < 0) spritelights = scalelight[0];
    else if (lightnum >= LIGHTLEVELS) spritelights = scalelight[LIGHTLEVELS - 1];
    else spritelights = scalelight[lightnum];
    for (var thing = sec.thinglist; thing; thing = thing.snext)
        R_ProjectSprite(thing);
}

// R_SortVisSprites (r_things.c:787) — insertion sort by scale (far first)
function R_SortVisSprites() {
    var count = vissprite_p;
    if (!count) return null;
    var sorted = [];
    for (var i = 0; i < count; i++) sorted.push(vissprites[i]);
    // reproduce C exactly: repeatedly pull smallest scale (stable by order)
    sorted.sort(function (a, b) { return a.scale - b.scale; });
    return sorted;
}

// R_DrawSprite (r_things.c:842)
var clipbot = new Int16Array(SCREENWIDTH);
var cliptop = new Int16Array(SCREENWIDTH);
function R_DrawSprite(spr, sortedDrawsegs) {
    var x, r1, r2, scale, lowscale, silhouette;
    for (x = spr.x1; x <= spr.x2; x++) clipbot[x] = cliptop[x] = -2;
    for (var di = ds_p - 1; di >= 0; di--) {
        var ds = drawsegs[di];
        if (ds.x1 > spr.x2 || ds.x2 < spr.x1 ||
            (!ds.silhouette && !ds.maskedtexturecol)) continue;
        r1 = ds.x1 < spr.x1 ? spr.x1 : ds.x1;
        r2 = ds.x2 > spr.x2 ? spr.x2 : ds.x2;
        if (ds.scale1 > ds.scale2) { lowscale = ds.scale2; scale = ds.scale1; }
        else { lowscale = ds.scale1; scale = ds.scale2; }
        if (scale < spr.scale ||
            (lowscale < spr.scale &&
             !R_PointOnSegSide(spr.gx, spr.gy, ds.curline))) {
            if (ds.maskedtexturecol) R_RenderMaskedSegRange(ds, r1, r2);
            continue;
        }
        silhouette = ds.silhouette;
        if (spr.gz >= ds.bsilheight) silhouette &= ~SIL_BOTTOM;
        if (spr.gzt <= ds.tsilheight) silhouette &= ~SIL_TOP;
        if (silhouette === 1) {
            for (x = r1; x <= r2; x++)
                if (clipbot[x] === -2)
                    clipbot[x] = typeof ds.sprbottomclip === 'number'
                        ? openings[MPOOLBIAS + ds.sprbottomclip + x] : ds.sprbottomclip[x];
        } else if (silhouette === 2) {
            for (x = r1; x <= r2; x++)
                if (cliptop[x] === -2)
                    cliptop[x] = typeof ds.sprtopclip === 'number'
                        ? openings[MPOOLBIAS + ds.sprtopclip + x] : ds.sprtopclip[x];
        } else if (silhouette === 3) {
            for (x = r1; x <= r2; x++) {
                if (clipbot[x] === -2)
                    clipbot[x] = typeof ds.sprbottomclip === 'number'
                        ? openings[MPOOLBIAS + ds.sprbottomclip + x] : ds.sprbottomclip[x];
                if (cliptop[x] === -2)
                    cliptop[x] = typeof ds.sprtopclip === 'number'
                        ? openings[MPOOLBIAS + ds.sprtopclip + x] : ds.sprtopclip[x];
            }
        }
    }
    for (x = spr.x1; x <= spr.x2; x++) {
        if (clipbot[x] === -2) clipbot[x] = viewheight;
        if (cliptop[x] === -2) cliptop[x] = -1;
    }
    mfloorclip = clipbot;
    mceilingclip = cliptop;
    R_DrawVisSprite(spr);
}

// R_DrawMasked (r_things.c:958)
function R_DrawMasked() {
    var sorted = R_SortVisSprites();
    if (sorted) {
        // draw back to front (ascending scale == far first)
        for (var i = 0; i < sorted.length; i++) R_DrawSprite(sorted[i]);
    }
    for (var di = ds_p - 1; di >= 0; di--) {
        var ds = drawsegs[di];
        if (ds.maskedtexturecol) R_RenderMaskedSegRange(ds, ds.x1, ds.x2);
    }
    if (!viewangleoffset) R_DrawPlayerSprites();
}

// R_DrawPlayerSprites / R_DrawPSprite (r_things.c:646/746) — psprites list
// comes from viewplayer.psprites = [{state, sx, sy}] when game.js provides it
function R_DrawPSprite(psp) {
    var tx, x1, x2, sprdef, sprframe, lump, flip;
    if (!psp.state || !psp.state.sprite) return;
    var sidx = spriteNameIdx[psp.state.sprite];
    if (sidx === undefined) {
        sidx = spriteNameIdx[resolveSpriteName(psp.state.sprite)];
        if (sidx === undefined) return;
    }
    sprdef = sprites[sidx];
    if ((psp.state.frame & FF_FRAMEMASK) >= sprdef.numframes) return;
    sprframe = sprdef.spriteframes[psp.state.frame & FF_FRAMEMASK];
    lump = sprframe.lump[0];
    flip = !!sprframe.flip[0];
    tx = (psp.sx - 160 * FRACUNIT) | 0;
    tx = (tx - spriteoffset[lump]) | 0;
    x1 = (centerxfrac + FixedMul(tx, pspritescale)) >> FRACBITS;
    if (x1 > viewwidth) return;
    tx += spritewidth[lump];
    x2 = ((centerxfrac + FixedMul(tx, pspritescale)) >> FRACBITS) - 1;
    if (x2 < 0) return;
    var vis = psp._vis || (psp._vis = {});
    vis.mobjflags = 0;
    vis.texturemid = ((BASEYCENTER << FRACBITS) + FRACUNIT / 2 -
        (psp.sy - spritetopoffset[lump])) | 0;
    vis.x1 = x1 < 0 ? 0 : x1;
    vis.x2 = x2 >= viewwidth ? viewwidth - 1 : x2;
    vis.scale = (pspritescale << detailshift) | 0;
    if (flip) {
        vis.xiscale = -pspriteiscale;
        vis.startfrac = spritewidth[lump] - 1;
    } else {
        vis.xiscale = pspriteiscale;
        vis.startfrac = 0;
    }
    if (vis.x1 > x1) vis.startfrac = (vis.startfrac + vis.xiscale * (vis.x1 - x1)) | 0;
    vis.patch = lump;
    if (fixedcolormap) vis.colormap = fixedcolormap;
    else if (psp.state.frame & FF_FULLBRIGHT) vis.colormap = FULLCOLORMAP;
    else vis.colormap = spritelights[MAXLIGHTSCALE - 1];
    R_DrawVisSprite(vis);
}
function R_DrawPlayerSprites() {
    if (!viewplayer) return;
    var lightnum = ((viewplayer.mo.subsector ?
        viewplayer.mo.subsector.sector.lightlevel : 160) >> LIGHTSEGSHIFT) + extralight;
    if (lightnum < 0) spritelights = scalelight[0];
    else if (lightnum >= LIGHTLEVELS) spritelights = scalelight[LIGHTLEVELS - 1];
    else spritelights = scalelight[lightnum];
    mfloorclip = screenheightarray;
    mceilingclip = negonearray;
    var psp = viewplayer.psprites;
    if (!psp) return;
    for (var i = 0; i < psp.length; i++)
        if (psp[i] && psp[i].state) R_DrawPSprite(psp[i]);
}

// ===========================================================================
// R_RenderPlayerView (r_main.c:870)
// ===========================================================================
function R_RenderPlayerView(player) {
    if (viewwidth === 0) { R_SetViewSize(setblocks, setdetail); R_ExecuteSetViewSize(); }
    if (setsizeneeded) R_ExecuteSetViewSize();
    R_SetupFrame(player);
    // 1.10 never clears (planes cover everything); we clear to black so a
    // visplane that misses rows doesn't show last-frame garbage. Deviation:
    // cosmetic only, never visible on stock MAP01 geometry.
    viewbuffer.fill(0xff000000);
    R_ClearClipSegs();
    R_ClearDrawSegs();
    R_ClearPlanes();
    R_ClearSprites();
    R_RenderBSPNode(numnodes - 1);
    R_DrawPlanes();
    R_DrawMasked();
}
