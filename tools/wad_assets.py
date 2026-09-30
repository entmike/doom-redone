#!/usr/bin/env python3
"""WAD asset extraction for gen_assets.py — vanilla palette passthrough.

Reads an IWAD (PLAYPAL, COLORMAPS, PNAMES, TEXTURE1/2, F_START..F_END,
P_START..P_END) and hands back raw vanilla-indexed data:
  palette   256 x [r,g,b]          (PLAYPAL)
  colormaps bytes                  (COLORMAPS, 34x256)
  flats     {name: (w,h,px)}
  textures  {name: (w,h,px)}       (patches composited per TEXTURE1 records)
  sprites   {name: (w,h,px,left,top)}  (patch posts, TRANS holes preserved)
The port skins everything by palette index, so the real COLORMAPS lump
works unmodified once ASSETS.palette is PLAYPAL itself.
"""
import struct

TRANS = 255   # vanilla post-gap marker; never an emitted color here


class Wad:
    def __init__(self, path):
        data = open(path, 'rb').read()
        tag, n, off = struct.unpack_from('<4sii', data, 0)
        self.data = data
        self.lumps = []
        for i in range(n):
            o, size, nm = struct.unpack_from('<ii8s', data, off + i * 16)
            self.lumps.append((nm.rstrip(b'\0').decode('latin1'), o, size))

    def get(self, name, after=0):
        for i in range(after, len(self.lumps)):
            if self.lumps[i][0] == name:
                nm, o, size = self.lumps[i]
                return self.data[o:o + size], i
        return None, -1

    def region(self, start, end):
        si = next(i for i, l in enumerate(self.lumps) if l[0] == start)
        ei = next(i for i, l in enumerate(self.lumps) if l[0] == end and i > si)
        return [(nm, self.data[o:o + sz])
                for nm, o, sz in self.lumps[si + 1:ei] if sz]


def decode_flat(raw):
    if len(raw) < 64 * 64:
        return None
    return 64, 64, list(raw[:64 * 64])


def decode_patch(raw):
    """column-post patch -> (w, h, row-major px w/ TRANS holes, left, top).

    Header is normally four int32 (width, height, leftoffset, topoffset)
    with the column table at 32; some IWADs (this Doom 3.1 build) store
    the four fields as int16 pairs with the table at 8. Pick whichever
    header's implied first column offset matches (vanilla table starts
    right after it)."""
    if len(raw) < 16:
        return None
    w, h, left, top = struct.unpack_from('<4h', raw, 0)
    coltab = 8
    if 0 < w <= 512 and 0 < h <= 512 and len(raw) >= 12:
        if struct.unpack_from('<i', raw, 8)[0] != 8 + w * 4:
            w32, h32, left32, top32 = struct.unpack_from('<4i', raw, 0)
            if (0 < w32 <= 512 and 0 < h32 <= 512 and
                    len(raw) >= 36 and
                    struct.unpack_from('<i', raw, 32)[0] == 32 + w32 * 4):
                w, h, left, top, coltab = w32, h32, left32, top32, 32
    if not (0 < w <= 512 and 0 < h <= 512):
        return None
    px = [TRANS] * (w * h)
    # Post format, per gospel v_video.c V_DrawPatch (:248-259):
    #   source = (byte *)column + 3;              // data at +3, byte at +2 spare
    #   count  = column->length;                  // topdelta at +0, length at +1
    #   column = (byte *)column + column->length + 4;
    #   while (column->topdelta != 0xff)          // 0xff at +0 ends the column
    # topdelta is ABSOLUTE y for patch drawing (desttop + topdelta*WIDTH, no
    # accumulation; accumulation exists only in R_DrawColumnInCache for
    # texture composites). Verified byte-exact on STYSNUM0: with data at +3
    # the '0' is a proper yellow glyph with red drop shadow; at +2 every
    # post loses its last pixel and starts on the spare byte (which this
    # WAD's packer fills with a copy of data[0] — the "repeated top row").
    offs = [struct.unpack_from('<i', raw, coltab + x * 4)[0] for x in range(w)]
    offs.append(len(raw))

    def scan(cumulative):
        out = [TRANS] * (w * h)
        aligned = True
        clipped = 0
        for x in range(w):
            p = offs[x]
            end = offs[x + 1]
            columnY = 0
            term = -1
            while p < end:
                topdelta = raw[p]
                if topdelta == 0xff:
                    term = p
                    break               # end-of-column marker (v_video.c:248)
                length = raw[p + 1]
                src = p + 3             # +2 is the reserved spare byte (:249)
                if src + length > end:
                    aligned = False     # data does not fit its column span
                    break
                columnY = columnY + topdelta if cumulative else topdelta
                for k in range(length):
                    y = columnY + k
                    if 0 <= y < h:
                        out[y * w + x] = raw[src + k]
                    else:
                        clipped += 1    # post ran off the patch: wrong rule
                p += length + 4         # next post (:258 column->length + 4)
                columnY += length
                if cumulative and columnY >= h:
                    break
            if term < 0:
                aligned = False
                break
            if raw[term + 1:end].count(0) != end - term - 1:
                aligned = False         # slack after terminator: zero-fill
                break
        return out, aligned, clipped

    # Gospel walk (v_video.c V_DrawPatch:248-259, identical for r_things.c
    # sprites): topdelta@0, length@1, spare@2, data@3, next post +length+4,
    # topdelta ABSOLUTE for patch/sprite drawing. A relative-topdelta
    # fallback stays only so odd third-party WADs still parse; on this WAD
    # the gospel scan aligns everywhere.
    first = None
    for cumulative in (False, True):
        out, aligned, clipped = scan(cumulative)
        if first is None:
            first = out
        if aligned and clipped == 0:
            px = out
            break
    else:
        px = first                      # nothing parsed: keep first read
    return w, h, px, left, top


class ComposedTexture:
    """TEXTURE1 record + patch list -> row-major pixels (vanilla indices).

    Faithful to r_data.c R_GenerateComposite + R_GenerateLookup semantics:
    a texture column covered by EXACTLY ONE patch points straight at that
    patch's raw column (collump[x]=patch, colofs[x]=columnofs[x]+3) — the
    patch's originy is NEVER applied to such columns. Only columns covered
    by MULTIPLE patches get a composite built by R_DrawColumnInCache, which
    DOES apply originy (position = originy + topdelta, clipped to the
    texture height, no wraparound). Baking originy into single-patch
    columns shifts the sky (SKY1: single 256x128 patch at originy=-8 →
    sky drawn 8px too high with a garbage bottom band) and produces
    vertical seams in multi-patch walls (BROWN144: patches at originy
    -16/-1) — the exact bugs this rewrite fixes.
    """
    def __init__(self, rec, patches, patch_blobs, patch_cache):
        # maptexture_t (r_data.c, 1.10 where boolean==int): name[8],
        # masked:int@8, width:short@12, height:short@14, columndirectory:int@16
        # (obsolete), patchcount:short@20, then mappatch_t[patchcount] of
        # 5 shorts (10 B) each starting @22.
        w, h = struct.unpack_from('<hh', rec, 12)
        ncomp, = struct.unpack_from('<h', rec, 20)
        if not (0 < w <= 4096 and 0 < h <= 512 and 0 <= ncomp <= 256):
            self.w, self.h, self.px = 1, 1, [TRANS]
            return
        self.w, self.h = w, h
        self.px = [TRANS] * (w * h)

        # Pass 1: resolve patches and count column coverage (R_GenerateLookup
        # patchcount[]).  Clip ranges exactly like gospel: x in [max(0,x1),
        # min(w, x1+pw)).
        covers = [[] for _ in range(w)]
        for c in range(ncomp):
            originx, originy, pic = struct.unpack_from('<hhh', rec, 22 + c * 10)
            name = patches[pic] if 0 <= pic < len(patches) else None
            if name is not None and name not in patch_blobs:
                # PNAMES here has one lowercase entry (w94_1) whose lump is
                # upper-case; vanilla matches case-insensitively
                up = name.upper()
                if up in patch_blobs:
                    name = up
            if name not in patch_cache:
                patch_cache[name] = (decode_patch(patch_blobs[name])
                                     if name in patch_blobs else None)
            p = patch_cache[name]
            if p is None:
                continue
            pw, ph, ppx = p[0], p[1], p[2]
            x1 = originx
            x2 = x1 + pw
            for x in range(max(0, x1), min(w, x2)):
                covers[x].append((pw, ph, ppx, x - x1, originy))

        # Pass 2: single-patch columns -> raw patch column (no originy).
        # Multi-patch columns -> R_DrawColumnInCache composite.
        for x in range(w):
            cl = covers[x]
            if not cl:
                continue
            if len(cl) == 1:
                pw, ph, ppx, pc, _oy = cl[0]
                for y in range(min(ph, h)):
                    self.px[y * w + x] = ppx[y * pw + pc]
                continue
            for pw, ph, ppx, pc, originy in cl:
                # Walk the patch column's post runs (runs of non-TRANS in
                # absolute-topdelta patch space), then clip like
                # R_DrawColumnInCache: position = originy + topdelta;
                # count += position if position < 0; clamp to cacheheight.
                y = 0
                while y < ph:
                    if ppx[y * pw + pc] == TRANS:
                        y += 1
                        continue
                    start = y
                    while y < ph and ppx[y * pw + pc] != TRANS:
                        y += 1
                    pos = originy + start
                    cnt = y - start
                    if pos < 0:
                        cnt += pos
                        pos = 0
                    if pos + cnt > h:
                        cnt = h - pos
                    for i in range(cnt):
                        self.px[(pos + i) * w + x] = ppx[(start + i) * pw + pc]


def load_wad_assets(path, want_textures=None, want_flats=None,
                    sprite_prefixes=None):
    """Everything from the WAD in vanilla palette indices.
    sprite_prefixes: optional set of 4-char sprite names; other P_START
    patches skipped (wall patches are pulled through TEXTURE1 instead)."""
    wad = Wad(path)
    out = {}

    pal_raw, _ = wad.get('PLAYPAL')
    out['palette'] = [list(pal_raw[i * 3:i * 3 + 3]) for i in range(256)]
    # all 14 PLAYPAL tables (0 normal, 1-8 red, 9-12 pickup bonus, 13 radiation)
    out['palettes'] = [[list(pal_raw[p * 768 + i * 3:p * 768 + i * 3 + 3])
                        for i in range(256)]
                       for p in range(len(pal_raw) // 768)]
    cm_raw, _ = wad.get('COLORMAPS')
    if cm_raw is None:
        # Doom 1.9 WADs name it COLORMAP (no S); 1.10 source uses COLORMAPS
        cm_raw, _ = wad.get('COLORMAP')
    out['colormaps'] = bytes(cm_raw) if cm_raw else None

    flats = {}
    for name, raw in wad.region('F_START', 'F_END'):
        if want_flats is not None and name not in want_flats:
            continue
        d = decode_flat(raw)
        if d:
            flats[name] = d
    out['flats'] = flats

    patch_blobs = dict(wad.region('P_START', 'P_END'))

    pn_raw, _ = wad.get('PNAMES')
    n_pnames = struct.unpack_from('<i', pn_raw, 0)[0]
    pnames = [pn_raw[4 + i * 8:12 + i * 8].rstrip(b'\0').decode('latin1')
              for i in range(n_pnames)]

    textures = {}
    cache = {}
    for tname in ('TEXTURE1', 'TEXTURE2'):
        traw, _ = wad.get(tname)
        if traw is None:
            continue
        n_tex = struct.unpack_from('<i', traw, 0)[0]
        offs = struct.unpack_from('<%di' % n_tex, traw, 4)
        for off in offs:
            name = traw[off:off + 8].rstrip(b'\0').decode('latin1')
            if want_textures is not None and name not in want_textures:
                continue
            tex = ComposedTexture(traw[off:], pnames, patch_blobs, cache)
            textures[name] = (tex.w, tex.h, tex.px)
    out['textures'] = textures

    sprites = {}
    # vanilla R_InitSpriteDefs scans only S_START..S_END; P_START wall
    # patches can carry sprite-shaped names (e.g. PLAYA1A3) and must not
    # collide. Fall back to P_START only if the WAD has no S region.
    regions = []
    try:
        wad.region('S_START', 'S_END')
        regions.append(('S_START', 'S_END'))
    except StopIteration:
        regions.append(('P_START', 'P_END'))
    for reg in regions:
        try:
            items = wad.region(*reg)
        except StopIteration:
            continue
        for name, raw in items:
            if name[:6] in sprites:
                continue
            d = decode_patch(raw)
            if d:
                sprites[name] = d
    out['sprites'] = sprites
    return out
