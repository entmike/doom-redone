#!/usr/bin/env python3
"""Procedural DOOM-style asset generator.
Emits palette/colormap/texture/flat/sprite data as JS for the faithful port.
Dimensions follow DOOM WAD conventions: textures 64x128 (some wide), flats 64x64,
sprites per original lump sizes where known.
"""
import math, random, json, struct, zlib, base64, io, sys, os

random.seed(19931010)

# ---------------------------------------------------------------- palette ---
# Build a 256-color palette with a hand-tuned set of hues and a 32-level light
# ramp per color (DOOM colormaps remap indices; we instead precompute
# colormaps as index->index tables exactly like COLORMAPS lump: 34 tables x 256
# bytes, tables 0..31 darken, 32 fullbright identity, 33 inverted).

def hsv2rgb(h, s, v):
    i = int(h * 6) % 6
    f = h * 6 - int(h * 6)
    p, q, t = v*(1-s), v*(1-f*s), v*(1-(1-f)*s)
    return [(v,p,p),(q,v,p),(p,q,v),(p,v,t),(t,p,v),(v,p,q)][i]

palette = []
def add(color):
    palette.append(tuple(max(0,min(255,int(round(c*255)))) for c in color))
    return len(palette)-1

# grey ramp (DOOM has ~24 greys; we give 24)
greys = []
for i in range(24):
    v = (i+1)/25.0
    greys.append(add((v*0.85, v*0.83, v*0.80)))  # slight brown tint, DOOM-ish concrete
# browns / tech
browns = []
for i in range(16):
    v = 0.12 + i*0.052
    browns.append(add((v*1.05, v*0.72, v*0.5)))
# reds
reds = []
for i in range(14):
    v = 0.10 + i*0.064
    reds.append(add((v*1.15, v*0.18, v*0.12)))
# greens
greens = []
for i in range(14):
    v = 0.08 + i*0.066
    greens.append(add((v*0.55, v*1.0, v*0.35)))
# blues
blues = []
for i in range(14):
    v = 0.08 + i*0.066
    blues.append(add((v*0.4, v*0.65, v*1.05)))
# yellows/orange
yellows = []
for i in range(12):
    v = 0.10 + i*0.076
    yellows.append(add((v*1.1, v*0.85*min(1.0,v*1.2), v*0.12)))
# tech cyan/grey-blue (computer panels)
cyans = []
for i in range(12):
    v = 0.1 + i*0.074
    cyans.append(add((v*0.5, v*0.95, v*1.0)))
# purples (lava glow accents)
purples = []
for i in range(10):
    v = 0.1 + i*0.09
    purples.append(add((v*0.9, v*0.3, v*1.0)))
# skin/flesh (zombie)
flesh = []
for i in range(12):
    v = 0.15 + i*0.07
    flesh.append(add((v*1.05, v*0.72, v*0.6)))
# dark support colors (metals) — NEUTRAL gray tint: DOOM palette ramp 130-139
# is saturated blue-gray, so any blue bias in this ramp nearest-matches into
# it and metals read as bright blue stripes. Keep r==g==b for gray ramps.
metals = []
for i in range(12):
    v = 0.12 + i*0.07
    metals.append(add((v*0.9, v*0.9, v*0.92)))
# fire ramp (used by fireflog-like anim flats)
fireram = []
for i in range(16):
    t = i/15.0
    r = min(1.0, t*2.0)
    g = max(0.0, min(1.0, (t-0.3)*2.0))
    b = max(0.0, min(1.0, (t-0.75)*4.0))*0.6 if t<0.8 else 1.0
    if t > 0.8: r,g,b = 1.0,0.9,0.5
    fireram.append(add((r,g,b)))
# pads: bright hazard
pads = []
for i in range(8):
    v = 0.2 + i*0.1
    pads.append(add((v*1.0, v*0.9, v*0.05)))
# fill remaining with dark greys / misc; index 255 reserved as sprite
# transparency (DOOM PLAYPAL 0 convention)
while len(palette) < 255:
    i = len(palette)
    add((0.02 + (i%4)*0.01, 0.02, 0.025))
add((0, 254, 0))
assert len(palette) == 256
palettes_all = None    # replaced with the 14-table PLAYPAL under --wad

PAL = {
    'grey': greys, 'brown': browns, 'red': reds, 'green': greens,
    'blue': blues, 'yellow': yellows, 'cyan': cyans, 'purple': purples,
    'flesh': flesh, 'metal': metals, 'fire': fireram, 'pad': pads,
}

def g(name, idx, jitter=0):
    """get palette index from ramp"""
    i = max(0, min(len(PAL[name])-1, idx+jitter))
    return PAL[name][i]

# ------------------------------------------------------------- colormaps ---
# Faithful semantics: colormap table N maps every palette index to the palette
# index of its darkened color (nearest-match), N=0 darkest .. 31 lightest?
# DOOM: colormaps[0] = darkest? Actually colormaps index 0..31 with 0 the
# darkest (light level 31 full). Light tables pick colormaps+level*256 where
# level 0 = darkest. So table 0 = fully dark, table 31 = full bright.
def nearest(rgb, avoid=None):
    best, bi = 1e9, 0
    for i, c in enumerate(palette):
        d = (c[0]-rgb[0])**2*2 + (c[1]-rgb[1])**2*1.5 + (c[2]-rgb[2])**2
        if d < best: best, bi = d, i
    return bi

# Family bookkeeping: vanilla COLORMAPS keeps every index inside its own
# hue ramp when darkening (PLAYPAL stair-step layout means the nearest
# darker color is the next entry down the SAME ramp). A global
# nearest-match hops families (brown -> flesh -> hazard-pad yellow), which
# is exactly the "texture flips palette with depth" artifact. Track each
# index's family and darken within it.
FAMILY_OF = [None]*len(palette)
FULLBRIGHT = [False]*len(palette)
for _ramp in (greys, browns, reds, greens, blues, yellows, cyans,
              purples, flesh, metals, pads):
    for _i in _ramp:
        FAMILY_OF[_i] = _ramp
for _i in fireram:                        # fire/computer lights: fullbright
    FULLBRIGHT[_i] = True
    FAMILY_OF[_i] = fireram
_fill = []
for _i in range(len(palette)):
    if FAMILY_OF[_i] is None:
        FAMILY_OF[_i] = _fill
        _fill.append(_i)
if not _fill:
    _fill = None

def nearest_in(ramp, rgb):
    best, bi = 1e9, ramp[0]
    for i in ramp:
        c = palette[i]
        d = (c[0]-rgb[0])**2*2 + (c[1]-rgb[1])**2*1.5 + (c[2]-rgb[2])**2
        if d < best: best, bi = d, i
    return bi

# VANILLA COLORMAPS lump convention: table 0 = fullbright (identity),
# tables 1..31 progressively darker (lightom 1.000 .. 0.125 steps),
# table 32 = fullbright copy, table 33 = inverse.
LIGHTOM = [1.000,0.970,0.941,0.912,0.882,0.853,0.824,0.794,
           0.765,0.735,0.706,0.676,0.647,0.618,0.588,0.559,
           0.529,0.500,0.471,0.441,0.412,0.382,0.353,0.324,
           0.294,0.265,0.235,0.206,0.176,0.147,0.125,0.098]
colormaps = bytearray()
for level in range(32):
    f = LIGHTOM[level]
    if level == 0:
        colormaps += bytes(range(256))   # identity (fullbright)
        continue
    table = []
    for ci, c in enumerate(palette):
        if FULLBRIGHT[ci]:
            table.append(ci)             # fullbright survives all light levels
            continue
        target = (c[0]*f, c[1]*f, c[2]*f)
        table.append(nearest_in(FAMILY_OF[ci], target))
    colormaps += bytes(table)
colormaps += bytes(range(256))          # 32: fullbright
# 33: inverse (DOOM's inverted colormap used by nothing gameplay-critical here)
inv = bytes(nearest((255-c[0],255-c[1],255-c[2])) for c in palette)
colormaps += inv

# --------------------------------------------------------------- helpers ---
def clamp_idx(i): return max(0, min(255, int(i)))

def h1(n):
    """deterministic hash -> [0,1)"""
    n = (n ^ 61) ^ (n >> 16)
    n = (n * 9) & 0xffffffff
    n = n ^ (n >> 4)
    n = (n * 0x27d4eb2d) & 0xffffffff
    n = n ^ (n >> 15)
    return (n & 0xffffff) / 0x1000000

def noise_field(w, h, base, fn):
    px = [0]*(w*h)
    for y in range(h):
        for x in range(w):
            px[y*w+x] = fn(x, y)
    return px

def tile64(fn):
    """64x64 flat"""
    return 64, 64, noise_field(64, 64, 0, fn)

# value noise, tileable
def make_vnoise(seed, period):
    rs = random.Random(seed)
    size = max(2, 64//period)
    grid = [[rs.random() for _ in range(size)] for _ in range(size)]
    def vnoise(x, y):
        gx = x*period/64.0; gy = y*period/64.0
        x0 = int(gx) % size; y0 = int(gy) % size
        x1 = (x0+1) % size; y1 = (y0+1) % size
        fx = gx - int(gx); fy = gy - int(gy)
        fx = fx*fx*(3-2*fx); fy = fy*fy*(3-2*fy)
        a = grid[y0][x0]*(1-fx)+grid[y0][x1]*fx
        b = grid[y1][x0]*(1-fx)+grid[y1][x1]*fx
        return a*(1-fy)+b*fy
    return vnoise

# --------------------------------------------------------------- FLATS -----
flats = {}

def flat_concrete(seed, light=14):
    vn = make_vnoise(seed, 4); vn2 = make_vnoise(seed+1, 16)
    def f(x, y):
        n = vn(x,y)*0.7 + vn2(x,y)*0.3
        v = light + int((n-0.5)*10)
        if h1(seed*1000+y*67+x) < 0.004: v -= 6  # speck
        return g('grey', v)
    return tile64(f)
flats['FLOOR4_8'] = flat_concrete(11)
flats['SLIME13'] = flats['FLOOR4_8']

def flat_floor7(seed):  # chunky tile
    vn = make_vnoise(seed, 2)
    def f(x, y):
        tx, ty = x % 32, y % 32
        edge = tx < 1 or ty < 1 or tx == 31 or ty == 31
        n = vn(x, y)
        v = 8 + int(n*6)
        if edge: v = 3
        elif (tx < 2 or ty < 2): v = 5
        return g('grey', v)
    return tile64(f)
flats['FLOOR7_2'] = flat_floor7(21)

def flat_nuka13(seed):  # toxic pools
    vn = make_vnoise(seed, 3); vn2 = make_vnoise(seed+7, 8)
    def f(x, y):
        n = vn(x,y)
        e = int((n-0.5)*24)
        if n > 0.62:
            return g('green', 11+e//3)
        if n > 0.5:
            return g('green', 6+int(vn2(x,y)*4))
        return g('green', 2+int(vn2(x,y)*2))
    return tile64(f)
flats['NUKAGE1'] = flat_nuka13(31)

def flat_rrok13(seed):  # blood pool
    vn = make_vnoise(seed, 3); vn2 = make_vnoise(seed+3, 7)
    def f(x, y):
        n = vn(x,y)
        if n > 0.60: return g('red', 5+int(vn2(x,y)*2))
        if n > 0.48: return g('red', 3)
        return g('red', 1+int(vn2(x,y)*2))
    return tile64(f)
flats['RROCK13'] = flat_rrok13(41)

def flat_mflr8(seed):  # lava-ish animated base (also COMP1/2 style)
    vn = make_vnoise(seed, 2); vn2 = make_vnoise(seed+5, 6)
    def f(x, y):
        n = vn(x,y)*0.8 + vn2(x,y)*0.2
        v = int(n*14)
        return g('fire', v)
    return tile64(f)
flats['MFLR8_2'] = flat_mflr8(51)
flats['LAVA1'] = flat_mflr8(51)

def flat_sarg2(seed):  # metal grating
    def f(x, y):
        if y % 8 < 2:
            return g('metal', 3)
        if x % 16 < 2:
            return g('metal', 4)
        v = 6 + (1 if (x//2 + y//2) % 3 else 7)
        return g('metal', v)
    return tile64(f)
flats['SARG2'] = flat_sarg2(61)
flats['CEIL5_1'] = flat_sarg2(61)

def flat_skyl1(seed):  # sky flat: blue with clouds (non-animated sky)
    vn = make_vnoise(seed, 3); vn2 = make_vnoise(seed+9, 6)
    def f(x, y):
        n = vn(x, y)*0.75 + vn2(x, y)*0.25
        if n > 0.66: return g('grey', 22)
        if n > 0.58: return g('blue', 8)
        return g('blue', 5 + int((y/64)*4))
    return tile64(f)
flats['DOOM32_1'] = flat_skyl1(71)
flats['F_SKY1'] = flat_skyl1(71)

def flat_tlmm1(seed):  # tech lights floor
    def f(x, y):
        cx, cy = x % 32 - 16, y % 32 - 16
        d = int(math.hypot(cx, cy))
        if d < 4: return g('yellow', 10)
        if d < 6: return g('yellow', 5)
        if x % 32 < 1 or y % 32 < 1: return g('metal', 2)
        return g('metal', 5 + (1 if (x*y) % 7 == 0 else 0))
    return tile64(f)
flats['TLMM1'] = flat_tlmm1(81)

def flat_sp_hit0(seed):  # computer floors
    vn = make_vnoise(seed, 8)
    def f(x, y):
        n = vn(x,y)
        if (x%16 < 2) or (y%16 < 2): return g('metal', 2)
        if n > 0.65: return g('cyan', 6)
        return g('metal', 4+int(n*3))
    return tile64(f)
flats['SP_DU11'] = flat_sp_hit0(91)
flats['COMP1'] = flat_sp_hit0(92)
flats['COMP2'] = flat_sp_hit0(93)

# ------------------------------------------------------------- TEXTURES ----
textures = {}

def tex(w, h, fn):
    return w, h, noise_field(w, h, 0, fn)

def brick_wall(seed, base=10, mortar=4):
    rs = random.Random(seed)
    tone = { (bx,by): rs.randint(-3,3) for bx in range(8) for by in range(16) }
    def f(x, y):
        row = y // 8
        off = (row % 2) * 16
        bx = ((x + off) % 64) // 32
        t = tone.get((bx, row % 16), 0)
        inmortar = (y % 8) < 2 or ((x + off) % 32) < 2
        if inmortar: return g('grey', mortar + (1 if (x+y)%4==0 else 0))
        n = h1(seed*997+y*71+x)
        v = base + t + int(n*3)
        if (y%8) == 2: v -= 2   # shadow under brick lip
        return g('brown', v)
    return tex(64, 128, f)
textures['BRICKV4'] = brick_wall(1)
textures['BRICKV5'] = brick_wall(2, base=7)

def tech_wall(seed, accent='cyan'):
    vn = make_vnoise(seed, 8)
    def f(x, y):
        # panel: bevels every 64x32, rivets, occasional light strip
        py = y % 32
        px = x % 64
        border = py < 2 or py >= 30 or px < 2 or px >= 62
        if border:
            v = 2
            if py < 3 and px > 2 and px < 61: v = 9   # top bevel light
            if py >= 28 and px > 2 and px < 61: v = 2
            return g('metal', v)
        if 26 <= px < 38 and 12 <= py < 20:
            # inset light
            return g(accent, 8 + int(vn(x,y)*3))
        n = vn(x, y)
        v = 5 + int(n*3)
        if (px in (4,60) and py in (4,28)): v = 10  # rivets
        return g('metal', v)
    return tex(64, 128, f)
textures['TECH1'] = tech_wall(3)
textures['TECH2'] = tech_wall(4, 'cyan')
textures['SW1V4'] = tech_wall(5, 'red')
textures['SW2V4'] = tech_wall(5, 'green')

def comp_wall(seed):
    vn = make_vnoise(seed, 12)
    def f(x, y):
        row = y // 16
        px, py = x % 64, y % 16
        base = g('metal', 3)
        if py < 2: return g('metal', 2)
        if row % 3 == 0:
            if px % 6 < 4 and (px//6) % 2 == 0:
                on = h1(seed + px*31 + row*7) > 0.45
                return g('red' if on else 'green', 9 if on else 2)
            return base
        if row % 3 == 1:
            if 4 <= px < 60 and py in (6,7):
                n = vn(x,y)
                return g('cyan', 4 + int(n*6))
            return base
        if px in (0,63): return g('metal', 6)
        return g('metal', 4 + (1 if py%4==0 else 0))
    return tex(64, 128, f)
textures['COMP1'] = comp_wall(6)
textures['COMP2'] = comp_wall(7)

def stone_wall(seed, base=8, ramp='grey'):
    vn = make_vnoise(seed, 6); vn2 = make_vnoise(seed+3, 2)
    def f(x, y):
        n = vn(x,y)*0.6 + vn2(x,y)*0.4
        v = base + int((n-0.5)*8)
        if x % 32 < 1 or y % 64 < 1: v -= 4
        return g(ramp, v)
    return tex(64, 128, f)
textures['STONE2'] = stone_wall(8)
textures['SLIME3'] = stone_wall(9, base=6, ramp='green')
textures['RROCK14'] = stone_wall(10, base=5, ramp='red')

def support_wall(seed):  # ASHWALL-ish: concrete with support beams
    vn = make_vnoise(seed, 5)
    def f(x, y):
        if x % 64 in range(28, 36):
            py = y % 16
            if py < 3: return g('yellow', 6)
            if py >= 13: return g('yellow', 2)
            return g('yellow', 4)
        n = vn(x,y)
        v = 9 + int((n-0.5)*7)
        if y % 128 < 2: v -= 4
        return g('grey', v)
    return tex(64, 128, f)
textures['ASHWALL'] = support_wall(12)
textures['CEM3'] = support_wall(13)

def door_wall(seed):
    vn = make_vnoise(seed, 9)
    def f(x, y):
        edge = x < 4 or x >= 60
        mid = 28 <= x < 36
        if edge:
            return g('metal', 8 if x % 4 < 2 else 4)
        if mid:
            if 48 <= y < 80: return g('yellow', 8 if (y//8)%2 else 3)  # handle glow
            return g('metal', 6)
        py = y % 32
        if py in (0, 1): return g('metal', 9)
        if py in (30, 31): return g('metal', 2)
        n = vn(x,y)
        return g('metal', 5+int(n*3))
    return tex(64, 128, f)
textures['DOOR3'] = door_wall(14)

def computer_wall(seed):
    vn = make_vnoise(seed, 10)
    def f(x, y):
        if x < 3 or x >= 61: return g('metal', 2)
        band = y % 22
        if band < 3: return g('metal', 3)
        if band < 18:
            on = h1(seed*77 + x*13 + y*101)
            if on > 0.93: return g('red', 10)
            if on > 0.85: return g('yellow', 8)
            if on > 0.75: return g('cyan', 6)
            return g('metal', 4 + (x//4 + y//3) % 2)
        return g('metal', 3)
    return tex(64, 128, f)
textures['SP_DU1'] = computer_wall(15)

def lava_tex(seed):
    vn = make_vnoise(seed, 4); vn2 = make_vnoise(seed+2, 9)
    def f(x, y):
        n = vn(x,y)*0.75 + vn2(x,y)*0.25
        return g('fire', int(n*15))
    return tex(64, 128, f)
textures['LAVA1'] = lava_tex(16)
textures['FIRE1'] = lava_tex(17)

def spike_tex(seed):
    def f(x, y):
        sx = x % 16
        top = 40
        if y < top: return g('grey', 10)
        dy = y - top
        col = abs(sx - 8)
        if dy < 60 and col * 3 < (60 - dy):
            # spike cone shading
            return g('metal', 9 - (dy//12))
        if y % 8 < 2: return g('metal', 2)
        return g('grey', 3)
    return tex(64, 128, f)
textures['SPIKE0'] = spike_tex(18)

def exit_tex(seed):
    def f(x, y):
        if 16 <= x < 48 and 32 <= y < 96:
            d = int(math.hypot(x-32, y-64))
            if d < 20:
                if d % 6 < 2: return g('green', 11)
                return g('green', 4)
            return g('green', 2)
        if x % 64 < 2 or y % 128 < 2: return g('metal', 2)
        return g('metal', 5)
    return tex(64, 128, f)
textures['EXIT'] = exit_tex(19)
textures['SWM1V'] = exit_tex(19)

textures['BIGDOOR2'] = tex(128, 128, lambda x, y: (
    g('metal', 3) if (x < 4 or x >= 124) else (
        g('yellow', 5 if (x in range(60,68) and y in range(48,80)) else 0) if False else
        (g('metal', 9 if (x%32) in (0,1) else (2 if (y%4) in (0,1) else 5 + int(make_vnoise(77,8)(x,y)*3))))
    )))
# wide 128 tech door done crudely above; regenerate cleanly:
_vn = make_vnoise(77, 8)
def bigdoor(x, y):
    if x < 5 or x >= 123: return g('metal', 2)
    if 60 <= x < 68:
        if 40 <= y < 88: return g('yellow', 9 if ((y//6)%2) else 4)
        return g('metal', 7)
    if x % 32 < 2: return g('metal', 8)
    if y % 4 < 1: return g('metal', 3)
    return g('metal', 4 + int(_vn(x, y)*3))
textures['BIGDOOR2'] = tex(128, 128, bigdoor)

# --------------------------------------------------------------- SPRITES ---
# (w,h, pixels with -1 = transparent)
def spr(w, h, fn):
    px = []
    for y in range(h):
        for x in range(w):
            px.append(fn(x, y))
    return w, h, px

TRANS = -1
def sprite_player():
    W, H = 44, 48
    def f(x, y):
        cx = x - 22
        ax = abs(cx)
        # legs
        if 36 <= y < 48:
            if 6 <= ax < 11: return g('grey', 9 if y%4 else 7)   # boots
            if 2 <= ax < 13: return g('green', 6 if y < 40 else 5)
            return TRANS
        # torso armor
        if 16 <= y < 36:
            if ax < 14:
                if ax > 11: return g('green', 3)
                if y < 20 and ax > 8: return g('green', 4)
                if 22 <= y < 30 and 2 <= ax < 5: return g('yellow', 7)  # chest lights
                return g('green', 7 if ax < 6 else 6)
            if ax < 17 and y > 18: return g('green', 4)  # shoulders/arms
            return TRANS
        # head + helmet
        if 4 <= y < 16:
            if ax < 6:
                if y < 8: return g('grey', 12)          # visor
                if y in (9,10) and ax < 4: return g('flesh', 9)
                return g('flesh', 6 if ax > 3 else 7)
            if ax < 8: return g('grey', 8)
            return TRANS
        return TRANS
    return spr(W, H, f)
sprites = {'PLAYA1A3': sprite_player(), 'PLAYF1F3': sprite_player(),
           'PLAYA2A4': sprite_player(), 'PLAYF2F4': sprite_player(),
           'PLAYG1': sprite_player(), 'PLAYH1': sprite_player(),
           'PLAYA5A7': sprite_player(), 'PLAYF5F7': sprite_player(),
           'PLAYA6A8': sprite_player(), 'PLAYF6F8': sprite_player()}

# simple death frame: sprawled
def sprite_play_dead():
    W, H = 44, 48
    def f(x, y):
        if y < 34: return TRANS
        if 34 <= y < 40 and 6 <= x < 38:
            if x < 12: return g('flesh', 5)
            if x > 34: return g('grey', 6)
            return g('green', 5)
        if 40 <= y < 44 and 10 <= x < 34:
            return g('red', 3 if (x+y)%3 else 1)  # blood pool
        return TRANS
    return spr(W, H, f)
sprites['PLAYC5'] = sprite_play_dead(); sprites['PLAYC7'] = sprite_play_dead()

def _mk(zfn):
    """return just the per-pixel function from a sprite fn factory"""
    def outer():
        return zfn
    return zfn

def _zpix(rot=0):
    def f(x, y):
        cx = x - 17 + rot*2
        ax = abs(cx)
        if y >= 28:  # legs
            if 3 <= ax < 9:
                if y > 32: return g('grey', 5)
                return g('flesh', 3 if (x*7+y)%5 else 4)
            return TRANS
        if 10 <= y < 28:  # torso, arms forward (attack pose)
            if ax < 11:
                fleshyness = 4 if (x+y*3) % 7 else 5
                if 20 <= y < 24 and 2 <= ax < 6: return g('red', 2)  # wounds
                return g('flesh', fleshyness)
            if ax < 15 and y < 22: return g('flesh', 3)  # arms
            return TRANS
        if y < 10:  # head
            if ax < 6:
                if y in (3,4) and ax < 4: return g('flesh', 7)  # skull top
                if y in (5,6) and ax < 5: return g('red', 1)    # eye sockets
                return g('flesh', 5)
            return TRANS
        return TRANS
    return f

def sprite_zombie(rot=0):
    return spr(35, 35, _zpix(rot))

def sprite_zombie_pain():
    zp = _zpix(0)
    def f(x, y):
        r = zp(x, y)
        if r != TRANS and (x+y) % 3 == 0: return g('flesh', 8)
        return r
    return spr(35, 35, f)

def sprite_zombie_dead():
    W, H = 35, 35
    def f(x, y):
        if y < 24: return TRANS
        if 24 <= y < 29:
            if 4 <= x < 30:
                if x < 9: return g('flesh', 6)   # head
                return g('flesh', 3 if (x+y) % 4 else 4)
            return TRANS
        if 29 <= y < 34 and 6 <= x < 32:
            return g('red', 2 if (x*3+y) % 4 else 4)  # blood
        return TRANS
    return spr(W, H, f)

for r in ['A','B','C','D','E','F']:
    sprites[f'POSS{r}1'] = sprite_zombie(0)
    sprites[f'POSS{r}2'] = sprite_zombie(1) if r in 'BC' else sprite_zombie(0)
    sprites[f'POSS{r}8'] = sprite_zombie(0)  # pain
    sprites[f'POSS{r}9'] = sprite_zombie(0)
    sprites[f'POSS{r}10'] = sprite_zombie_pain()
    sprites[f'POSS{r}11'] = sprite_zombie_dead()
    sprites[f'POSS{r}12'] = sprite_zombie_dead()
    sprites[f'SPOS{r}1'] = sprite_zombie(0)
    sprites[f'SPOS{r}2'] = sprite_zombie(1) if r in 'BC' else sprite_zombie(0)
    sprites[f'SPOS{r}8'] = sprite_zombie(0)
    sprites[f'SPOS{r}10'] = sprite_zombie_pain()
    sprites[f'SPOS{r}11'] = sprite_zombie_dead()
    sprites[f'SPOS{r}12'] = sprite_zombie_dead()

# pistol (right-hand view) 52x32 anchored bottom-right-ish
def _pist_pix(x, y):
    # barrel
    if 4 <= x < 30 and 16 <= y < 22:
        return g('metal', 8 if y == 16 else 5)
    if 2 <= x < 6 and 20 <= y < 26:
        return g('metal', 4)  # muzzle shadow
    # slide
    if 10 <= x < 40 and 12 <= y < 17:
        return g('metal', 9 if y == 12 else 6)
    # grip + hand
    if 34 <= x < 48 and 17 <= y < 32:
        if x > 40 or y > 24: return g('flesh', 7 if (x+y)%2 else 6)
        return g('metal', 3)
    return TRANS

def sprite_pistol():
    return spr(52, 32, _pist_pix)

def sprite_pistol_fire():
    def f(x, y):
        r = _pist_pix(x, y)
        if x < 8 and 10 <= y <= 28 and (x*x + (y-19)*(y-19)) < 60:
            return g('yellow', 10 if (x+y)%2 else 8)
        return r
    return spr(52, 32, f)
sprites['PISGA0'] = sprite_pistol(); sprites['PISGB0'] = sprite_pistol_fire()

# shotgun 86x64
def _sht_pix(x, y):
    # barrel pair from lower-left to upper-mid
    if 0 <= x < 52:
        by = 30 - x//6  # slight rise to the right... (view: barrels to left)
        for off in (0, 5):
            if by+off <= y < by+off+4:
                return g('metal', 8 if y == by+off else 4)
    # receiver
    if 44 <= x < 62 and 26 <= y < 40:
        return g('metal', 6 if (x+y) % 3 else 8)
    # pump
    if 14 <= x < 34 and 36 <= y < 42:
        return g('brown', 7 if y % 3 else 5)
    # stock + hands
    if 60 <= x < 86 and 30 <= y < 60:
        if 66 <= x < 78 and 40 <= y < 52: return g('flesh', 6 if (x+y)%2 else 7)
        if x > 74: return g('brown', 4)
        return g('brown', 6 if (x//3+y//3)%2 else 5)
    if 30 <= x < 44 and 42 <= y < 54:
        return g('flesh', 6 if (x+y)%2 else 7)  # left hand
    return TRANS

def sprite_shotgun():
    return spr(86, 64, _sht_pix)

def sprite_shotgun_fire():
    def f(x, y):
        r = _sht_pix(x, y)
        if x < 14 and 20 <= y <= 38:
            d = x*x + (y-29)*(y-29)*0.6
            if d < 90: return g('yellow', 11 if d < 40 else 8)
        return r
    return spr(86, 64, f)
sprites['SHTGA0'] = sprite_shotgun(); sprites['SHTGB0'] = sprite_shotgun_fire()

# muzzle flash (FLASH) 42x32
def sprite_flash(frame):
    W, H = 42, 32
    def f(x, y):
        cx, cy = 14 + frame*2, 16
        d = ((x-cx)**2 + (y-cy)**2*1.2) / (60 + frame*45)
        ang = math.atan2(y-cy, x-cx)
        spikes = 1.0 + 0.5*math.sin(ang*5 + frame)
        d /= spikes
        if d < 0.5: return g('yellow', 11)
        if d < 1.0: return g('yellow', 8)
        if d < 1.4: return g('red', 6)
        return TRANS
    return spr(W, H, f)
for i in range(4):
    sprites[f'FLASH{chr(65+i)}0'] = sprite_flash(i)

# bullet puff 15x15 (frames A-D shrink)
def sprite_puff(frame):
    W, H = 15, 15
    rad = [7.5, 5.5, 3.5, 2.0][frame]
    def f(x, y):
        d = math.hypot(x-7, y-7) / rad
        if d < 0.45: return g('grey', 20)
        if d < 0.8: return g('grey', 14)
        if d < 1.05: return g('grey', 9)
        return TRANS
    return spr(W, H, f)
for i, L in enumerate('ABCD'):
    sprites[f'PUFF{L}0'] = sprite_puff(i)

# items we render as sprites for map test: health sphere (medkit 23x46)
def sprite_medkit():
    W, H = 23, 46
    def f(x, y):
        if 6 <= y < 40:
            if 2 <= x < 21:
                if 10 <= x < 13 and 16 <= y < 30: return g('red', 9)
                if 6 <= y < 9 or (36 <= y < 40): return g('grey', 18)
                return g('grey', 22 if (x+y) % 3 else 19)
        if 40 <= y < 46 and 0 <= x < 23:
            return g('grey', 2 if (x+y) % 2 else 1)  # shadow
        return TRANS
    return spr(W, H, f)
sprites['MEDAA0'] = sprite_medkit()
sprites['MEDAB0'] = sprite_medkit()  # blink frame (A/B alternation in states)

# barrel (TRE1/BAR1 style) 43x55
def sprite_barrel():
    W, H = 43, 55
    def f(x, y):
        if y < 3: return TRANS
        if y < 8:
            if 8 <= x < 35: return g('red', 4 if x % 5 else 2)
            return TRANS
        if 8 <= y < 50:
            if x < 4 or x >= 39: return TRANS
            sh = 2 if x < 8 else (8 if x < 14 else (6 if x < 30 else (2 if x < 36 else 0)))
            band = (y // 10) % 2
            if y % 10 in (0, 1): return g('metal', sh+2)  # rib
            if 18 <= y < 34 and 16 <= x < 28 and band == 0:
                return g('red', 7)  # hazard patch
            return g('red', sh)
        if y < 54 and 2 <= x < 41: return g('metal', 1)
        return TRANS
    return spr(W, H, f)
sprites['BAR1A0'] = sprite_barrel(); sprites['BAR1B0'] = sprite_barrel()

# column lamp (COL5) 32x47 tall light
def sprite_lamp():
    W, H = 32, 47
    def f(x, y):
        if y < 4:
            return g('metal', 6) if 8 <= x < 24 else TRANS
        if y < 42:
            if 12 <= x < 20:
                return g('yellow', 11 if y % 6 else 9)
            if 10 <= x < 22: return g('metal', 4)
            return TRANS
        if y < 46:
            return g('metal', 3) if 6 <= x < 26 else TRANS
        return TRANS
    return spr(W, H, f)
sprites['COL5A0'] = sprite_lamp()

# torch (TW1/TSM) simple fire column
def sprite_torch(frame):
    W, H = 32, 56
    vn = make_vnoise(123+frame, 6)
    def f(x, y):
        if y >= 24:
            if 13 <= x < 19: return g('brown', 3 if x % 3 else 4)
            return TRANS
        cy = 16
        d = math.hypot((x-16)*1.2, (y-cy)) / (12 + vn(x, y)*4)
        if d < 0.5: return g('yellow', 11)
        if d < 0.8: return g('yellow', 7)
        if d < 1.0: return g('red', 5)
        return TRANS
    return spr(W, H, f)
for i, L in enumerate('ABCD'):
    sprites[f'TRE1{L}0'] = sprite_torch(i)  # generic animated fire prop

# skull hang (sk1) — decorative
def sprite_skull():
    W, H = 23, 25
    def f(x, y):
        cx = abs(x-11)
        if y < 14:
            if cx + y*0.4 < 10:
                if y in (5,6) and 3 <= cx <= 5: return g('red', 3)
                if y > 10 and cx < 6 and (x % 3) == 0: return g('grey', 4)
                return g('grey', 17 if y < 8 else 15)
        elif y < 17 and cx < 7:
            return g('grey', 12)
        elif 17 <= y < 21 and cx < 5:
            return g('red', 2) if (x+y) % 3 else g('grey', 6)
        return TRANS
    return spr(W, H, f)
sprites['SK1A0'] = sprite_skull(); sprites['SK1B0'] = sprite_skull()

# ------------------------------------------------------------ emit JS ------
def b64(px):
    return base64.b64encode(bytes(clamp_idx(v) if v >= 0 else 255 for v in px)).decode()

# ------------------------------------------- real WAD asset ingestion ------
# --wad <path>: full vanilla palette passthrough. ASSETS.palette becomes
# PLAYPAL and ASSETS.colormaps becomes the real COLORMAPS lump; flats,
# wall textures and sprites are emitted in vanilla palette indices. All
# maps (any *.json passed) are scanned only to sanity-check coverage.
if '--wad' in sys.argv:
    wi = sys.argv.index('--wad')
    wadpath = sys.argv[wi + 1]
    mapfiles = [a for a in sys.argv[wi + 2:] if not a.startswith('--')]
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    import wad_assets

    w = wad_assets.load_wad_assets(wadpath)
    oldpal = list(palette)               # procedural art indices refer to this
    palette[:] = w['palette']            # PLAYPAL passthrough
    palettes_all = w.get('palettes') or [w['palette']]
    if w['colormaps'] is not None:
        colormaps = bytearray(w['colormaps'][:34 * 256])

    # convert procedural flats/textures/sprites from old-palette indices to
    # vanilla indices (nearest RGB), so one palette skins everything
    def nearest_vanilla(rgb):
        best, bi = 1e18, 0
        for i, c in enumerate(palette):
            d = (c[0]-rgb[0])**2 + (c[1]-rgb[1])**2 + (c[2]-rgb[2])**2
            if d < best: best, bi = d, i
        return bi
    old2new = [oldpal[i] and nearest_vanilla(tuple(oldpal[i])) for i in range(256)]

    def topal(px):
        return [v if v < 0 else old2new[v] for v in px]
    for k in list(flats):
        w_, h_, px = flats[k]
        flats[k] = (w_, h_, topal(px))
    # TEXTURE1 composited with TRANS holes PRESERVED (vanilla parity):
    # the holes are the masked-texture knockout data. r_data.c never bakes
    # patches into a filled bitmap for the masked pass — R_GetColumn hands
    # r_things.c R_DrawMaskedColumn a post chain whose inter-post gaps ARE
    # the transparency. The engine rebuilds posts from these holes at load
    # (textureposts / buildPosts) and zeroes them for the solid tiers
    # (R_DrawColumn path, where vanilla reads the first post contiguously).
    for k in list(textures):
        w_, h_, px = textures[k]
        textures[k] = (w_, h_, topal(px))
    for k in list(sprites):
        w_, h_, px = sprites[k]
        sprites[k] = (w_, h_, topal(px))

    # WAD art wins on name collisions; procedural-only names survive for map01
    for n, (w_, h_, px) in w['flats'].items():
        flats[n] = (w_, h_, list(px))
    for n, (w_, h_, px) in w['textures'].items():
        textures[n] = (w_, h_, list(px))

    # sprites: keep TRANS holes (buildPosts rebuilds posts from them);
    # carry patch left/top offsets so R_GetOrMakePatch can position exactly
    # First drop any procedural sprite that would collide with a real WAD
    # lump in the same sprite+frame slot (multi-digit names like PLAYA1A3
    # collide on the first 6 chars with the real PLAYA1).
    wad_slots = {n[:6] for n in w['sprites'] if len(n) >= 6}
    wad_prefixes = {n[:4] for n in w['sprites'] if len(n) >= 6}
    for n in [k for k in sprites
              if k[:4] in wad_prefixes and k[:6] in wad_slots]:
        del sprites[n]
    for n, (w_, h_, px, left, top) in w['sprites'].items():
        if len(n) < 6:
            continue                      # not a sprite lump (wall patch)
        frame = ord(n[4]) - 65 if len(n) > 4 else -1
        rot = ord(n[5]) - 48 if len(n) > 5 else -1
        if not (0 <= frame < 29 and 0 <= rot <= 8):
            continue
        sprites[n] = (w_, h_, list(px), left, top)

    # coverage check against every passed map
    miss_f, miss_t = set(), set()
    for mf in mapfiles:
        raw = json.load(open(mf))
        def dec(lump, rec, fmt):
            b = base64.b64decode(raw['lumps'][lump])
            return [struct.unpack_from(fmt, b, i * rec)
                    for i in range(len(b) // rec)]
        uf, ut = set(), set()
        for s in dec('SECTORS', 26, '<hh8s8shhh'):
            for f in (s[2], s[3]):
                n = f.rstrip(b'\0').decode('latin1').upper()
                if n and n != '-':
                    uf.add(n)
        for s in dec('SIDEDEFS', 30, '<hh8s8s8sh'):
            for f in (s[2], s[3], s[4]):
                n = f.rstrip(b'\0').decode('latin1').upper()
                if n and n != '-':
                    ut.add(n)
        miss_f |= {('%s:%s' % (mf, n)) for n in uf if n not in flats}
        miss_t |= {('%s:%s' % (mf, n)) for n in ut if n not in textures}
    if miss_f or miss_t:
        print('WARNING missing assets:', sorted(miss_f)[:10], sorted(miss_t)[:10])
    print('WAD ingest (%s): %d flats, %d textures, %d sprite lumps; '
          'palette+colormaps = vanilla' %
          (wadpath, len(flats), len(textures), len(sprites)))

out = io.StringIO()
out.write("// AUTO-GENERATED by tools/gen_assets.py — procedural DOOM-style assets\n")
out.write("const ASSETS = {\n")
out.write("  palette: " + json.dumps(palette) + ",\n")
out.write("  palettes: " + json.dumps(palettes_all or [palette]) + ",\n")
out.write("  colormaps: \"" + base64.b64encode(bytes(colormaps)).decode() + "\",\n")
out.write("  flats: {\n")
for name, (w, h, px) in sorted(flats.items()):
    out.write(f'    "{name}": [{w},{h},"{b64(px)}"],\n')
out.write("  },\n  textures: {\n")
for name, (w, h, px) in sorted(textures.items()):
    out.write(f'    "{name}": [{w},{h},"{b64(px)}"],\n')
out.write("  },\n  sprites: {\n")
for name, sd in sorted(sprites.items()):
    w, h, px = sd[0], sd[1], sd[2]
    left, top = (sd[3], sd[4]) if len(sd) > 3 else (None, None)
    if left is None:
        out.write(f'    "{name}": [{w},{h},"{b64(px)}"],\n')
    else:
        out.write(f'    "{name}": [{w},{h},"{b64(px)}",{left},{top}],\n')
out.write("  }\n};\n")
out.write("globalThis.ASSETS = ASSETS;   // expose const for vm/CDP\n")

open(sys.argv[1] if len(sys.argv) > 1 else "assets/assets.js", "w").write(out.getvalue())
print("assets.js written:", out.getvalue().__len__(), "bytes;",
      len(textures), "textures,", len(flats), "flats,", len(sprites), "sprite frames")
