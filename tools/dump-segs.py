#!/usr/bin/env python3
"""Print seg details for flagged subsectors."""
import json, base64, struct, sys

def nm(b): return b.decode(errors='replace').rstrip('\x00')

d = json.load(open(sys.argv[1] if len(sys.argv) > 1 else 'map01.json'))
L = {k: base64.b64decode(v) for k, v in d['lumps'].items()}
def dec(name, rec, fmt):
    raw = L[name]; n = len(raw) // rec
    return [struct.unpack_from(fmt, raw, i * rec) for i in range(n)]
verts   = dec('VERTEXES', 4, '<hh')
lines   = dec('LINEDEFS', 14, '<hhhhhhh')
sides   = dec('SIDEDEFS', 30, '<hh8s8s8sh')
segs    = dec('SEGS', 12, '<hhHHhh')
ssecs   = dec('SSECTORS', 4, '<hh')

def seginfo(k):
    v1, v2, ang, li, side, off = segs[k]
    a, b = verts[v1], verts[v2]
    l = lines[li]
    c, e = verts[l[0]], verts[l[1]]
    sf, sb = l[5], l[6]
    fs = sides[sf][5] if sf != -1 else None
    bs = sides[sb][5] if sb != -1 else None
    return ('seg%-3d (%4d,%4d)->(%4d,%4d) ld%-3d v(%4d,%4d)->(%4d,%4d) '
            'side=%d off=%d fs=%s bs=%s flags=%d top=%s mid=%s bot=%s' %
            (k, a[0], a[1], b[0], b[1], li, c[0], c[1], e[0], e[1], side, off,
             fs, bs, l[2], nm(sides[sf][2]), nm(sides[sf][3]), nm(sides[sf][4])))

want = [int(x) for x in sys.argv[2:]] or list(range(len(ssecs)))
for si in want:
    cnt, off = ssecs[si]
    print('== ssec %d (%d segs)' % (si, cnt))
    a2 = 0.0
    for k in range(off, off + cnt):
        x1, y1 = verts[segs[k][0]]; x2, y2 = verts[segs[k][1]]
        a2 += x1 * y2 - x2 * y1
        print('  ' + seginfo(k))
    print('  area2 = %.0f (%s)' % (a2, 'CW' if a2 < 0 else 'CCW/degen'))
