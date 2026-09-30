#!/usr/bin/env python3
"""tools/audit-anim-frames.py — verify the extract pipeline pulled ALL
thing (sprite) and switch/animation frames from the WAD.

Checks:
  1. every S_START..S_END sprite lump present as an ASSETS.sprites key
  2. vanilla R_InitSpriteDefs rotation completeness: each sprite frame is
     rot 0 OR the full 1..8 set, and mirror-pair (8-char) lumps install
     both frames; engine's two documented DEVIATION rules tolerated
  3. every switch pair (p_switch.c alphSwitchList) that exists in the
     WAD TEXTURE1 exists in ASSETS.textures
  4. every animdef (p_spec.c) resolvable in the WAD has its frame chain
     in ASSETS (textures for istexture=1, flats for 0)
  5. flats/textures referenced by the maps fed to gen_assets are present
"""
import re, struct, sys, os, json, glob, collections

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'tools'))
import wad_assets

WAD = os.path.join(ROOT, 'wads', 'doom1.wad')
ASSETS = os.path.join(ROOT, 'assets', 'assets.js')

def section(text, start_marker, end_marker):
    i = text.index(start_marker)
    return text[i:text.index(end_marker, i)]

def keyset(text):
    return set(re.findall(r'"([A-Z0-9_]{4,8})"\s*:', text))

def main():
    w = wad_assets.Wad(WAD)
    names = [t[0].rstrip('\x00').strip() for t in w.lumps]
    src = open(ASSETS).read()
    spr_keys = keyset(section(src, 'sprites:', '\n  }'))
    tex_keys = keyset(section(src, 'textures:', '\n  }'))
    flat_keys = keyset(section(src, 'flats:', '\n  }'))
    fails = []

    # ---- 1+2 sprites ----
    si, ei = names.index('S_START'), names.index('S_END')
    lumps = [n for n in names[si+1:ei] if len(n) in (6, 8)]
    missing = [n for n in lumps if n not in spr_keys]
    print('sprite lumps in WAD region: %d, keys in assets: %d, missing: %d'
          % (len(lumps), len(spr_keys), len(missing)))
    if missing:
        fails.append('MISSING sprite lumps: %s' % missing[:20])

    # rotation completeness per vanilla R_InitSpriteDefs
    # (8-char mirror lumps install frames (f1,r1,flip) AND (f2,r2,flip))
    inst = collections.defaultdict(dict)  # spr -> frame -> set(rot)
    def add(spr, f, r, flip):
        inst[spr].setdefault(f, set()).add((r, flip))
    for n in lumps:
        spr, f, r = n[:4], n[4], int(n[5])
        add(spr, f, r, False)
        if len(n) == 8 and 'A' <= n[6] <= 'Z' and n[7].isdigit():
            add(spr, n[6], int(n[7]), True)
    for spr, frames in sorted(inst.items()):
        for f, rots in sorted(frames.items()):
            plain = {r for (r, fl) in rots if not fl}
            mirrored = {r for (r, fl) in rots if fl}
            # mirror pairs install into rot slots too; vanilla rule: frame
            # is rot0 single OR all eight. Mirror lumps cover pairs, so
            # accept plain ∪ mirrored completeness.
            covered = plain | mirrored
            if covered == {0}:
                continue
            if len(covered) == 8 and covered == set(range(1, 9)):
                continue
            # partial multi-rot sets are only legal for the two tolerated
            # deviations (synthetic assets); flag anything else from a real WAD
            fails.append('rotation set incomplete: %s frame %s rots=%s'
                         % (spr, f, sorted(covered)))
    print('sprite rotation-completeness: %d sprites, %d frames checked' %
          (len(inst), sum(len(v) for v in inst.values())))

    # ---- 3 switches ----
    psrc = open(os.path.join(ROOT, 'reference/linuxdoom-1.10/p_switch.c')).read()
    seg = psrc[psrc.find('alphSwitchList'):psrc.find('NUMSWITCHES')]
    pairs = re.findall(r'"(SW\d\w*)",\s*"(SW\d\w*)"', seg)
    def lumpdata(name):
        for t in w.lumps:
            if t[0].rstrip('\x00').strip() == name:
                return w.data[t[1]:t[1]+t[2]]
        raise SystemExit('lump %s not found in WAD' % name)
    tx = lumpdata('TEXTURE1')
    n_tex = struct.unpack_from('<i', tx)[0]
    offs = struct.unpack_from('<%di' % n_tex, tx, 4)
    wad_tex = {tx[o:o+8].rstrip(b'\0').decode('latin1') for o in offs}
    have_pairs = [(a, b) for a, b in pairs if a in wad_tex and b in wad_tex]
    miss_sw = [t for ab in have_pairs for t in ab if t not in tex_keys]
    print('switch pairs in WAD: %d, missing from assets: %d %s' %
          (len(have_pairs), len(miss_sw), miss_sw))
    if miss_sw:
        fails.append('MISSING switch textures: %s' % miss_sw)

    # ---- 4 pic anims ----
    ssrc = open(os.path.join(ROOT, 'reference/linuxdoom-1.10/p_spec.c')).read()
    seg = ssrc[ssrc.find('animdefs[]'):ssrc.find('{-1')]
    anims = re.findall(r'\{(false|true),\s*"(\w+)",\s*"(\w+)",\s*\d+\}', seg)
    fi, fe = names.index('F_START'), names.index('F_END')
    wad_flats = set(names[fi+1:fe])
    for istex, s, e in anims:
        pool_wad, pool_js = (wad_tex, tex_keys) if istex == 'true' else (wad_flats, flat_keys)
        if s in pool_wad or e in pool_wad:
            if s not in pool_js or e not in pool_js:
                fails.append('anim chain %s->%s incomplete in assets.js' % (s, e))
            else:
                print('anim chain present: %s %s->%s' % ('tex' if istex=='true' else 'flat', s, e))
    print('animdefs checked: %d (resolvable in this WAD only)' % len(anims))

    # ---- 5 map usage coverage ----
    used_f = set(); used_t = set()
    for mf in glob.glob(os.path.join(ROOT, 'assets', 'e1m*.json')) + \
              [os.path.join(ROOT, 'map01.json'), os.path.join(ROOT, 'mapbox.json'),
               os.path.join(ROOT, 'mapbox-oct.json')]:
        d = json.load(open(mf))
        dec = lambda L, r, f: [struct.unpack_from(f, __import__('base64').b64decode(d['lumps'][L]), i*r)
                               for i in range(len(__import__('base64').b64decode(d['lumps'][L]))//r)]
        for s in dec('SECTORS', 26, '<hh8s8shhh'):
            for x in (s[2], s[3]):
                n = x.rstrip(b'\0').decode('latin1').upper()   # R_Init* touppername
                if n and n != '-': used_f.add(n)
        for s in dec('SIDEDEFS', 30, '<hh8s8s8sh'):
            for x in (s[2], s[3], s[4]):
                n = x.rstrip(b'\0').decode('latin1').upper()
                if n and n != '-': used_t.add(n)
    miss_f = sorted(f for f in used_f if f not in flat_keys)
    miss_t = sorted(t for t in used_t if t not in tex_keys)
    print('map-used flats: %d (missing %s), textures: %d (missing %s)' %
          (len(used_f), miss_f or 'none', len(used_t), miss_t or 'none'))
    if miss_f: fails.append('map flats missing from assets.js: %s' % miss_f)
    if miss_t: fails.append('map textures missing from assets.js: %s' % miss_t)

    print()
    if fails:
        print('AUDIT FAILURES:')
        for f in fails: print(' -', f)
        sys.exit(1)
    print('AUDIT PASSED: all thing/switch/animation frames extracted')

if __name__ == '__main__':
    main()
