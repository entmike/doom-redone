#!/usr/bin/env python3
"""Render every patch in the generated asset bundles to one labeled PNG sprite
sheet under assets-debug/, for visual QC of glyph decoding (top-row doubling,
shear, etc.). Transparency = magenta; each cell is 1px-outlined with its name.

Usage: python3 tools/glyph_sheet.py [wad-irrelevant]
Reads: assets/statusbar.js, assets/title.js, assets/intermission.js
Writes: assets-debug/glyphs.png
"""
import base64
import json
import os
import re
import struct
import sys
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT_DIR = os.path.join(ROOT, "assets-debug")

BUNDLES = [
    ("SB", "assets/statusbar.js"),
    ("TITLE", "assets/title.js"),
    ("WI", "assets/intermission.js"),
]

PATCH_RE = re.compile(r'"([A-Za-z0-9_]+)":\s*\[(\d+),(\d+),"([^"]+)"')

MAGENTA = (255, 0, 255)
GRID = (40, 40, 40)
TXT = (255, 255, 255)


def load_palette():
    """PLAYPAL table 1 from assets/assets.js: 'palette: [[r,g,b], ...]'."""
    src = open(os.path.join(ROOT, "assets/assets.js")).read()
    m = re.search(r"palette:\s*(\[.*?\]\s*\])\s*[,}]", src, re.S)
    if not m:
        return None
    pal = json.loads(m.group(1))
    return [(r, g, b) for (r, g, b) in pal] if len(pal) == 256 else None

# --- tiny 5x7 bitmap font for labels (subset: A-Z 0-9 _ - space .) ----------
F = {
    'A': "01110,10001,10001,11111,10001,10001,10001",
    'B': "11110,10001,10001,11110,10001,10001,11110",
    'C': "01110,10001,10000,10000,10000,10001,01110",
    'D': "11110,10001,10001,10001,10001,10001,11110",
    'E': "11111,10000,10000,11110,10000,10000,11111",
    'F': "11111,10000,10000,11110,10000,10000,10000",
    'G': "01110,10001,10000,10111,10001,10001,01111",
    'H': "10001,10001,10001,11111,10001,10001,10001",
    'I': "11111,00100,00100,00100,00100,00100,11111",
    'J': "00111,00010,00010,00010,00010,10010,01100",
    'K': "10001,10010,10100,11000,10100,10010,10001",
    'L': "10000,10000,10000,10000,10000,10000,11111",
    'M': "10001,11011,10101,10101,10001,10001,10001",
    'N': "10001,11001,10101,10011,10001,10001,10001",
    'O': "01110,10001,10001,10001,10001,10001,01110",
    'P': "11110,10001,10001,11110,10000,10000,10000",
    'Q': "01110,10001,10001,10001,10101,10011,01111",
    'R': "11110,10001,10001,11110,10100,10010,10001",
    'S': "01111,10000,10000,01110,00001,00001,11110",
    'T': "11111,00100,00100,00100,00100,00100,00100",
    'U': "10001,10001,10001,10001,10001,10001,01110",
    'V': "10001,10001,10001,10001,10001,01010,00100",
    'W': "10001,10001,10001,10101,10101,11011,10001",
    'X': "10001,10001,01010,00100,01010,10001,10001",
    'Y': "10001,10001,01010,00100,00100,00100,00100",
    'Z': "11111,00001,00010,00100,01000,10000,11111",
    '0': "01110,10001,10011,10101,11001,10001,01110",
    '1': "00100,01100,00100,00100,00100,00100,01110",
    '2': "01110,10001,00001,00010,00100,01000,11111",
    '3': "11111,00010,00100,00010,00001,10001,01110",
    '4': "00010,00110,01010,10010,11111,00010,00010",
    '5': "11111,10000,11110,00001,00001,10001,01110",
    '6': "00110,01000,10000,11110,10001,10001,01110",
    '7': "11111,00001,00010,00100,01000,01000,01000",
    '8': "01110,10001,10001,01110,10001,10001,01110",
    '9': "01110,10001,10001,01111,00001,00010,01100",
    '_': "00000,00000,00000,00000,00000,00000,11111",
    '-': "00000,00000,00000,11111,00000,00000,00000",
    '.': "00000,00000,00000,00000,00000,01100,01100",
    ' ': "00000,00000,00000,00000,00000,00000,00000",
}


def load_bundle(path):
    src = open(os.path.join(ROOT, path)).read()
    out = []
    for name, w, h, b64 in PATCH_RE.findall(src):
        w, h = int(w), int(h)
        px = base64.b64decode(b64)
        if len(px) != w * h:
            continue
        out.append((name, w, h, px))
    return out


def png_write(path, w, h, rgb):
    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += rgb[y * w * 3:(y + 1) * w * 3]
    comp = zlib.compress(bytes(raw), 6)

    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n')
        f.write(chunk(b'IHDR', ihdr))
        f.write(chunk(b'IDAT', comp))
        f.write(chunk(b'IEND', b''))


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    pal = load_palette()
    if pal:
        print(f"palette loaded: PLAYPAL table 1 ({len(pal)} colors)")
    else:
        print("WARNING: no palette in assets/assets.js — falling back to gray")
    items = []
    for bundle, path in BUNDLES:
        if not os.path.exists(os.path.join(ROOT, path)):
            print(f"skip missing {path}")
            continue
        items += [(bundle, n, w, h, px) for (n, w, h, px) in load_bundle(path)]
    if not items:
        print("no patches found")
        return 1

    LABEL_H = 9
    PAD = 2
    GAP = 3
    TARGET_W = 1600

    def zoom_for(pw, ph):
        m = max(pw, ph)
        return 4 if m <= 16 else (2 if m <= 32 else 1)

    def cell_w(it):
        return it[2] * zoom_for(it[2], it[3]) + 2 * PAD

    def cell_h(it):
        return it[3] * zoom_for(it[2], it[3])

    # group into sections by lump-name prefix (trailing digits stripped)
    def prefix_of(name):
        p = re.sub(r'\d+$', '', name)
        return p or name
    groups = {}
    for it in items:
        groups.setdefault(prefix_of(it[1]), []).append(it)

    def pack(group_items):
        group_items.sort(key=lambda it: (-it[3], it[0], it[1]))
        rows, cur, cur_w, row_h = [], [], 0, 0
        for it in group_items:
            cw = cell_w(it)
            if cur and cur_w + cw > TARGET_W:
                rows.append((cur, row_h))
                cur, cur_w, row_h = [], 0, 0
            cur.append(it)
            cur_w += cw + GAP
            row_h = max(row_h, cell_h(it) + 2 * PAD + LABEL_H)
        if cur:
            rows.append((cur, row_h))
        return rows

    sections = [(p, pack(groups[p])) for p in sorted(groups)]

    HDR_H = 16                      # section header band (2x-scaled label)
    W = max([sum(cell_w(it) + GAP for it in r) for p, rs in sections for r, _ in rs] + [200]) + GAP
    H = GAP + sum(HDR_H + sum(h for _, h in rs) + GAP * (len(rs) + 1) for _, rs in sections) + GAP
    buf = bytearray(bytes(GRID) * (W * H))

    def px_set(x, y, c):
        if 0 <= x < W and 0 <= y < H:
            i = (y * W + x) * 3
            buf[i:i + 3] = bytes(c)

    def text(x, y, s, c, scale=1):
        for ch in s:
            g = F.get(ch.upper(), F[' '])
            for ry, line in enumerate(g.split(',')):
                for rx, b in enumerate(line):
                    if b == '1':
                        for zy in range(scale):
                            for zx in range(scale):
                                px_set(x + rx * scale + zx, y + ry * scale + zy, c)
            x += 6 * scale

    y = GAP
    for prefix, rs in sections:
        n = sum(len(r) for r, _ in rs)
        text(GAP + 2, y + 4, f"{prefix}  ({n})", (120, 200, 255), 2)
        y += HDR_H
        for r, rh in rs:
            x = GAP
            for bundle, name, pw, ph, pdata in r:
                zoom = zoom_for(pw, ph)
                dw, dh = pw * zoom, ph * zoom
                ox, oy = x + PAD, y + PAD
                for py in range(ph):
                    for ppx in range(pw):
                        v = pdata[py * pw + ppx]
                        col = MAGENTA if v == 255 else (pal[v] if pal else (v, v, v))
                        if zoom == 1:
                            px_set(ox + ppx, oy + py, col)
                        else:
                            for zy in range(zoom):
                                for zx in range(zoom):
                                    px_set(ox + ppx * zoom + zx, oy + py * zoom + zy, col)
                # outline
                for xx in range(ox - 1, ox + dw + 1):
                    px_set(xx, oy - 1, TXT)
                    px_set(xx, oy + dh, TXT)
                for yy in range(oy - 1, oy + dh + 1):
                    px_set(ox - 1, yy, TXT)
                    px_set(ox + dw, yy, TXT)
                text(ox, oy + dh + 2, name, TXT)
                x += dw + 2 * PAD + GAP
            y += rh + GAP
        y += GAP

    out = os.path.join(OUT_DIR, "glyphs.png")
    png_write(out, W, H, bytes(buf))
    print(f"assets-debug/glyphs.png: {W}x{H}, {len(items)} patches")
    return 0


if __name__ == "__main__":
    sys.exit(main())
