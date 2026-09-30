#!/usr/bin/env python3
"""Debug map: one OCTAGONAL room (square with chamfered corners), flat
floor/ceiling — same structure as mapbox.json / gen_box_map.py but 8 walls.
Reuses gen_map.py's machinery (BSP builder, seg matcher, blockmap, packing).

Usage: python3 tools/gen_octagon_map.py <out.json> [size=512] [chamf=128] [light=192]
"""
import sys, re

GEN = __file__.rsplit('/', 1)[0] + '/gen_map.py'
src = open(GEN).read()

out_path = sys.argv[1]
size = int(sys.argv[2]) if len(sys.argv) > 2 else 512
chamf = int(sys.argv[3]) if len(sys.argv) > 3 else size // 4
light = int(sys.argv[4]) if len(sys.argv) > 4 else 192
half = size // 2
c = half - chamf

# CCW octagon: square corners cut by `chamf` on each axis
design = f'''# ---- minimal debug octagon (authored by gen_octagon_map.py) ----
ROOM = [({-half},{-c}),({-c},{-half}),({c},{-half}),({half},{-c}),
        ({half},{c}),({c},{half}),({-c},{half}),({-half},{c})]
sec_box = MAP.sector(0, 128, {light}, ff="FLOOR4_8", cf="FLOOR7_2")
room(ROOM, sec_box, "BRICKV4")
POLYS = {{sec_box: [ROOM]}}
HOLES = {{i: [] for i in range(32)}}
MAP.thing(0, 0, 0, 1)   # player 1 start, facing east
'''

start = src.index('# ------------------------------------------------------------- map design ---')
end = src.index('# ------------------------------------------------------------- blockmap ---')
flush = src[src.index('linedefs = []\n'):end]
src = src[:start] + design + '\n' + flush + src[end:]

src = re.sub(r"SAMPLES = \[.*?\]\nnames = \{.*?\}\n",
             f"SAMPLES = [(0,0,'box'),({half}-64,0,'box'),({c}-16,{c}-16,'box'),({-c}+16,({-c})+16,'box')]\n"
             + f"names = {{sec_box: 'box'}}\n",
             src, count=1, flags=re.S)
src = src.replace("names.setdefault(s, 'step%d' % s)", "names.setdefault(s, 'box')")

sys.argv = [sys.argv[0], out_path]
exec(compile(src, 'gen_octagon_map(spliced)', 'exec'))
print('octagon map written:', out_path)
