#!/usr/bin/env python3
"""Minimal debug map: one rectangular room, 4 walls, flat floor/ceiling.
Reuses gen_map.py's proven machinery (BSP builder, seg matcher, blockmap,
packing) by exec'ing a spliced copy of its source with a minimal design.

Usage: python3 tools/gen_box_map.py <out.json> [size=512] [light=192]
"""
import sys, re

GEN = __file__.rsplit('/', 1)[0] + '/gen_map.py'
src = open(GEN).read()

size = int(sys.argv[2]) if len(sys.argv) > 2 else 512
light = int(sys.argv[3]) if len(sys.argv) > 3 else 192
half = size // 2

design = f'''# ---- minimal debug box (authored by gen_box_map.py) ----
ROOM = [({-half},{-half}),({half},{-half}),({half},{half}),({-half},{half})]
sec_box = MAP.sector(0, 128, {light}, ff="FLOOR4_8", cf="FLOOR7_2")
room(ROOM, sec_box, "BRICKV4")
POLYS = {{sec_box: [ROOM]}}
HOLES = {{i: [] for i in range(32)}}
MAP.thing(0, 0, 0, 1)   # player 1 start, facing east
'''

start = src.index('# ------------------------------------------------------------- map design ---')
end = src.index('# ------------------------------------------------------------- blockmap ---')
# keep the generic linedef-flush block (authors EDGES -> linedefs) that lives
# between the design and the blockmap section
flush = src[src.index('linedefs = []\n'):end]
src = src[:start] + design + '\n' + flush + src[end:]

# the validation-sample block references the full map's sector names — swap in box ones
src = re.sub(r"SAMPLES = \[.*?\]\nnames = \{.*?\}\n",
             f"SAMPLES = [(0,0,'box'),(0,{-half}+32,'box'),({half}-32,{half}-32,'box')]\nnames = {{sec_box: 'box'}}\n",
             src, count=1, flags=re.S)
src = src.replace("names.setdefault(s, 'step%d' % s)", "names.setdefault(s, 'box')")

out_path = sys.argv[1]
sys.argv = [sys.argv[0], out_path]
exec(compile(src, 'gen_box_map(spliced)', 'exec'))
print('box map written:', out_path)
