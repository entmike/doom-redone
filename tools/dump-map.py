#!/usr/bin/env python3
"""Dump a map JSON (base64 WAD lumps) in human-readable form."""
import json, base64, struct, sys

def nm(x):
    return x.decode(errors='replace').rstrip('\x00') if isinstance(x, bytes) else str(x)

def main(path, what='all'):
    d = json.load(open(path))
    L = {k: base64.b64decode(v) for k, v in d['lumps'].items()}
    def dec(name, rec, fmt):
        raw = L[name]; n = len(raw) // rec
        return [struct.unpack_from(fmt, raw, i * rec) for i in range(n)]
    verts = dec('VERTEXES', 4, '<hh')
    lines = dec('LINEDEFS', 14, '<HHHHHhH')
    sides = dec('SIDEDEFS', 30, '<hh8s8s8sh')
    sectors = dec('SECTORS', 26, '<hh8s8sHHH')
    if what in ('all', 'sectors'):
        for i, s in enumerate(sectors):
            print('S%02d fl=%-8s cl=%-8s floor=%-8s ceil=%-8s light=%3d spec=%3d tag=%d' %
                  (i, s[0], s[1], nm(s[2]), nm(s[3]), s[4], s[5], s[6]))
    if what in ('all', 'lines'):
        for i, l in enumerate(lines):
            v1, v2, fl, fr, ns, t, tag = l
            def s(x):
                if x == 0xffff:
                    return 'none'
                sd = sides[x]
                return 'top=%s mid=%s bot=%s off=%d,%d sec=%d' % (
                    nm(sd[2]), nm(sd[3]), nm(sd[4]), sd[0], sd[1], sd[5])
            a = verts[v1]; b = verts[v2]
            print('L%02d (%d,%d)->(%d,%d) F[%s] B[%s] spec=%d tag=%d' %
                  (i, a[0], a[1], b[0], b[1], s(fl), s(fr), t, tag))

if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else 'all')
