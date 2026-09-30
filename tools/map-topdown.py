#!/usr/bin/env python3
# Render a top-down PNG of map01.json linedefs (sides with no backsector in red).
import struct, base64, json, zlib, sys

m = json.load(open(sys.argv[1] if len(sys.argv)>1 else 'map01.json'))
L = {k: base64.b64decode(v) for k, v in m['lumps'].items()}

nv = len(L['VERTEXES'])//4
verts = [struct.unpack_from('<hh', L['VERTEXES'], i*4) for i in range(nv)]
nl = len(L['LINEDEFS'])//14
lines = [struct.unpack_from('<HHhhhHH', L['LINEDEFS'], i*14) for i in range(nl)]

SCALE = 0.35
W, H = 900, 900
def tx(x): return int((x + 900) * SCALE)
def ty(y): return int((900 - y) * SCALE)

pix = bytearray(b'\x10\x10\x14' * W * H)
def line_pt(x0, y0, x1, y1, col):
    n = int(max(abs(x1-x0), abs(y1-y0)) * 3) + 1
    for i in range(n+1):
        x = int(x0 + (x1-x0)*i/n); y = int(y0 + (y1-y0)*i/n)
        if 0 <= x < W and 0 <= y < H:
            o = (y*W+x)*3; pix[o:o+3] = col

for (v1, v2, flags, special, tag, sid1, sid2) in lines:
    a, b = verts[v1], verts[v2]
    col = b'\xff\x50\x50' if sid2 == 0xffff else b'\xd0\xd0\xd0'
    line_pt(tx(a[0]), ty(a[1]), tx(b[0]), ty(b[1]), col)

def png(path):
    raw = b''.join(b'\x00' + bytes(pix[y*W*3:(y+1)*W*3]) for y in range(H))
    def chunk(t, d): return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t+d))
    open(path,'wb').write(b'\x89PNG\r\n\x1a\n'
        + chunk(b'IHDR', struct.pack('>IIBBBBB', W, H, 8, 2, 0, 0, 0))
        + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b''))
png('/tmp/map-topdown.png')
print(f'{nv} vertexes, {nl} linedefs -> /tmp/map-topdown.png')
