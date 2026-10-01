#!/usr/bin/env python3
"""Render a contact sheet of selected sprite lumps straight from the WAD
through the fixed decode_patch — for eyeballing post-decode fixes.
usage: python3 tools/sprite_sheet.py [out.png] [LUMP LUMP ...]
"""
import struct
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import wad_assets
from PIL import Image

TRANS = 255
SCALE = 4
CELL_PAD = 6

DEFAULT = ['POSSA1', 'POSSA2', 'POSSA8', 'POSSA3', 'POSSB1', 'POSSG1',
           'POSSA0', 'SPOSA1', 'TROOA1', 'TROOA2', 'TROOA3', 'HEADA1',
           'BOSSA1', 'PLAYA1', 'PLAYA2', 'BAR1A0', 'MEDIA0', 'CSAWA0',
           'SHOTA0', 'PISGA0', 'TROOA5']


def decode(wad, name):
    raw, _ = wad.get(name)
    if raw is None:
        return None
    return wad_assets.decode_patch(raw)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else '/tmp/sprites.png'
    names = sys.argv[2:] or DEFAULT
    wad = wad_assets.Wad(os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        'wads', os.environ.get('DOOM_WAD', 'Doom1.wad')))
    pal = struct.unpack('<768B', wad.get('PLAYPAL')[0][:768])
    rgb = [(pal[i*3], pal[i*3+1], pal[i*3+2]) for i in range(256)]

    cells = []
    for nm in names:
        d = decode(wad, nm)
        cells.append((nm, d))

    cell_w = max((d[0] for _, d in cells if d), default=64) * SCALE + CELL_PAD*2
    cell_h = max((d[1] for _, d in cells if d), default=64) * SCALE + CELL_PAD*2 + 12
    cols = 6
    rows = (len(cells) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * cell_w, rows * cell_h), (24, 24, 28))
    from PIL import ImageDraw
    dr = ImageDraw.Draw(sheet)

    for idx, (nm, d) in enumerate(cells):
        cx = (idx % cols) * cell_w + CELL_PAD
        cy = (idx // cols) * cell_h + CELL_PAD
        dr.text((cx, cy - 10), nm, fill=(200, 200, 200))
        if d is None:
            dr.text((cx, cy), 'MISSING', fill=(255, 60, 60))
            continue
        w, h, px, left, top = d
        img = Image.new('RGB', (w, h), (60, 0, 60))   # magenta = hole
        for y in range(h):
            for x in range(w):
                v = px[y*w + x]
                if v != TRANS:
                    img.putpixel((x, y), rgb[v])
        img = img.resize((w*SCALE, h*SCALE), Image.NEAREST)
        sheet.paste(img, (cx, cy))
    sheet.save(out)
    print('sheet -> %s (%d lumps, %dx%d)' % (out, len(names), *sheet.size))


if __name__ == '__main__':
    main()
