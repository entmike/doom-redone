#!/usr/bin/env python3
"""Extract a MAP* / ExMy map from a WAD into the port's JSON map format.

The port's map JSON holds the ten vanilla map lumps base64-encoded; vanilla
lumps are copied byte-for-byte.

usage: python3 tools/wad2map.py <wad> <mapname> <out.json>
"""
import struct, json, base64, sys

MAP_LUMPS = ['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS',
             'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP']

def read_lumps(path):
    data = open(path, 'rb').read()
    tag, n, off = struct.unpack_from('<4sii', data, 0)
    out = []
    for i in range(n):
        o, size, nm = struct.unpack_from('<ii8s', data, off + i * 16)
        out.append((nm.rstrip(b'\0').decode('latin1'), data[o:o + size]))
    return tag, out

def main(wad, mapname, outpath):
    tag, lumps = read_lumps(wad)
    idx = None
    for i, (nm, _) in enumerate(lumps):
        if nm == mapname:
            idx = i
            break
    if idx is None:
        sys.exit('map %s not found in %s' % (mapname, wad))
    out = {}
    for want in MAP_LUMPS:
        nm, data = lumps[idx + 1 + MAP_LUMPS.index(want)]
        if nm != want:
            sys.exit('lump order broken after %s: expected %s got %s'
                     % (mapname, want, nm))
        out[want] = data
    doc = {'mapname': mapname,
           'lumps': {k: base64.b64encode(v).decode() for k, v in out.items()}}
    json.dump(doc, open(outpath, 'w'))
    print('wrote %s: %s from %s (%s); lines=%d verts=%d sectors=%d things=%d' %
          (outpath, mapname, wad, tag,
           len(out['LINEDEFS']) // 14, len(out['VERTEXES']) // 4,
           len(out['SECTORS']) // 26, len(out['THINGS']) // 10))

if __name__ == '__main__':
    if len(sys.argv) != 4:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2], sys.argv[3])
