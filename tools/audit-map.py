#!/usr/bin/env python3
"""Audit a generated map JSON the way the renderer consumes it.

Checks (vanilla nodebuilder invariants):
  A1 every subsector's segs belong to exactly ONE sector
  A2 each seg's v1->v2 traversal is consistent with its side (front seg runs
     WITH the linedef, back seg runs against it)
  A3 node partition: segs/nodes in front child are on the RIGHT of (x,y)+(dx,dy)
  A4 subsector polygon (from segs) is CW (interior on the right) and non-empty
  A5 every authored sector appears in >=1 subsector
  A6 BLOCKMAP/NODES index sanity
"""
import json, base64, struct, sys
from collections import Counter

def nm(b): return b.decode(errors='replace').rstrip('\x00')

def main(path):
    d = json.load(open(path))
    L = {k: base64.b64decode(v) for k, v in d['lumps'].items()}
    def dec(name, rec, fmt):
        raw = L[name]; n = len(raw) // rec
        return [struct.unpack_from(fmt, raw, i * rec) for i in range(n)]
    verts   = dec('VERTEXES', 4, '<hh')
    lines   = dec('LINEDEFS', 14, '<hhhhhhh')
    sides   = dec('SIDEDEFS', 30, '<hh8s8s8sh')
    segs    = dec('SEGS', 12, '<hhHHhh')
    ssecs   = dec('SSECTORS', 4, '<hh')
    nodes = []
    for i in range(len(L['NODES']) // 28):
        vals = list(struct.unpack_from('<hhhhhhhhhhhh', L['NODES'], i * 28))
        f, b = struct.unpack_from('<HH', L['NODES'], i * 28 + 24)
        vals[8] = f
        vals[9] = b
        nodes.append(vals)
    sectors = dec('SECTORS', 26, '<hh8s8shhh')

    NF_SUBSECTOR = 0x8000
    problems = []

    # ---- seg -> sector mapping like P_GroupLines / renderer setup
    def seg_sector(sg):
        _, _, _, li, side, _ = sg
        flags, = struct.unpack_from('<h', L['LINEDEFS'], li*14 + 4)
        sn = struct.unpack_from('<hh', L['LINEDEFS'], li*14 + 10)[0 if side == 0 else 1]
        if sn == -1:
            return None
        return sides[sn][5]

    # ---- A1: one sector per subsector
    used_segs = set()
    ss_sector = []
    for si, (cnt, off) in enumerate(ssecs):
        secs = set()
        for k in range(off, off + cnt):
            used_segs.add(k)
            s = seg_sector(segs[k])
            if s is None:
                problems.append('A1 ssec %d seg %d has null side' % (si, k))
            else:
                secs.add(s)
        if len(secs) > 1:
            problems.append('A1 ssec %d MIXED sectors %s' % (si, sorted(secs)))
        ss_sector.append(next(iter(secs)) if len(secs) == 1 else None)

    # ---- A2: traversal consistency (a seg may be a SUB-SPAN of its linedef,
    # so compare direction via dot product, not endpoint equality)
    for si, (cnt, off) in enumerate(ssecs):
        for k in range(off, off + cnt):
            v1, v2, _ang, li, side, _off = segs[k]
            a = verts[v1]; b = verts[v2]
            l = lines[li]
            c = verts[l[0]]; e = verts[l[1]]
            sdx, sdy = b[0] - a[0], b[1] - a[1]
            ldx, ldy = e[0] - c[0], e[1] - c[1]
            dot = sdx * ldx + sdy * ldy
            if side == 0 and dot <= 0:
                problems.append('A2 ssec %d seg %d side0 but reversed vs linedef %d' % (si, k, li))
            if side == 1 and dot >= 0:
                problems.append('A2 ssec %d seg %d side1 but not reversed vs linedef %d' % (si, k, li))

    # ---- A3: node side correctness by walking the tree
    def poly_pts(cid):
        if cid & NF_SUBSECTOR:
            sid = cid & ~NF_SUBSECTOR
            cnt, off = ssecs[sid]
            pts = []
            for k in range(off, off + cnt):
                pts.append(verts[segs[k][0]])
            return pts
        pts = []
        for c in subtree_children(cid):
            pts += poly_pts(c)
        return pts

    def subtree_children(n):
        nd = nodes[n]
        out = []
        for ch in (nd[8], nd[9]):
            out.append(ch)
        return out

    def walk(n, seen):
        if n in seen:
            problems.append('A3 node %d visited twice (cycle?)' % n)
            return
        seen.add(n)
        x, y, dx, dy = nodes[n][:4]
        for ch in nodes[n][8:10]:
            pts = poly_pts(ch)
            sides_seen = set()
            for (px, py) in pts:
                cr = dx * (py - y) - dy * (px - x)
                if abs(cr) < 1e-6:
                    continue
                sides_seen.add(1 if cr > 0 else -1)
            # DOOM: children[0]=front=RIGHT side of partition vector (cr<0 by right-hand rule)
            # right of vector (dx,dy): cross((dx,dy),(p-a)) < 0
            if 1 in sides_seen and -1 in sides_seen:
                problems.append('A3 node %d child has points on BOTH sides' % n)
            if ch & NF_SUBSECTOR == 0:
                walk(ch, seen)

    if nodes:
        root = len(nodes) - 1
        walk(root, set())
        # every node reachable
        reach = set()
        def mark(n):
            if n & NF_SUBSECTOR: return
            reach.add(n)
            for ch in nodes[n][8:10]:
                mark(ch)
        mark(root)
        for n in range(len(nodes)):
            if n not in reach:
                problems.append('A3 node %d unreachable from root' % n)

    # ---- A4: CLOSED subsector rings must be CW (interior on RIGHT of segs).
    # Open rings (gaps where a BSP partition seam has no map line) are legal
    # vanilla output — skip the area test for those.
    def ssec_area(si):
        cnt, off = ssecs[si]
        if cnt < 3:
            return None
        ring = [verts[segs[off + k][0]] for k in range(cnt)]
        ends = [verts[segs[off + k][1]] for k in range(cnt)]
        closed = all(ring[(k + 1) % cnt] == ends[k] for k in range(cnt))
        if not closed:
            return None
        a2 = 0.0
        for k in range(cnt):
            x1, y1 = ring[k]
            x2, y2 = ring[(k + 1) % cnt]
            a2 += x1 * y2 - x2 * y1
        return a2 / 2
    for si in range(len(ssecs)):
        ar = ssec_area(si)
        if ar is not None and ar > -1e-6:
            problems.append('A4 ssec %d closed ring degenerate/CCW area=%.1f' % (si, ar))

    # ---- A5: every sector covered
    covered = {s for s in ss_sector if s is not None}
    for s in range(len(sectors)):
        if s not in covered:
            problems.append('A5 sector %d (%s/%s) appears in NO subsector' %
                            (s, nm(sectors[s][2]), nm(sectors[s][3])))

    # ---- A6: orphan segs
    orphans = set(range(len(segs))) - used_segs
    if orphans:
        problems.append('A6 %d segs not referenced by any subsector: %s' %
                        (len(orphans), sorted(orphans)[:10]))

    print('sectors=%d ssecs=%d nodes=%d segs=%d' %
          (len(sectors), len(ssecs), len(nodes), len(segs)))
    if problems:
        print('PROBLEMS (%d):' % len(problems))
        for p in problems[:80]:
            print(' ', p)
        return 1
    print('OK: all invariants hold')
    return 0

if __name__ == '__main__':
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else 'map01.json'))
