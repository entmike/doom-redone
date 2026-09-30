#!/usr/bin/env python3
"""Procedural test-map builder emitting a byte-exact DOOM MAP01 data lump
(THINGS/LINEDEFS/SIDEDEFS/VERTEXES/SEGS/SSECTORS/NODES/SECTORS/REJECT/BLOCKMAP)
plus a BSP builder producing the same tree format id's rnodes emitted
(front=right child first, postorder nodes, NF_SUBSECTOR leaves).

DOOM conventions honored:
  - linedef front side on the RIGHT of v1->v2
  - subsector boundary segs have their sector on the RIGHT (CW winding)
  - seg.side = 0 when seg runs WITH the linedef direction, 1 when reversed
  - doors are tagged SECTORS whose ceiling rises; door *lines* just texture
  - node partition dx,dy taken from the chosen seg direction
"""
import struct, math, json, sys, base64

class Map:
    def __init__(self):
        self.vertexes = {}
        self.sectors = []
        self.sides = []
        self.things = []
    def vert(self, x, y):
        k = (int(x), int(y))
        if k not in self.vertexes:
            self.vertexes[k] = len(self.vertexes)
        return self.vertexes[k]
    def sector(self, floor=0, ceiling=128, light=160, special=0, tag=0,
               ff="FLOOR4_8", cf="FLOOR7_2"):
        self.sectors.append(dict(floor=floor, ceiling=ceiling, light=light,
                                 special=special, tag=tag, ff=ff, cf=cf))
        return len(self.sectors) - 1
    def side(self, mid="", top="", bottom=""):
        self.sides.append(dict(mid=mid, top=top, bottom=bottom))
        return len(self.sides) - 1
    def thing(self, x, y, ang, typ, flags=7):
        self.things.append(dict(x=x, y=y, angle=ang, type=typ, flags=flags))

MAP = Map()
MAP.side_sector = []   # sidenum -> sector, filled as linedefs flush
EDGES = {}   # sorted endpoints -> [authored segment dicts in call order]
ROOM_WALLS = []  # (sorted-key, front, back, mid) authored by room(): 1-sided
                 # perimeter walls that may coincide with a room boundary

def W(x1, y1, x2, y2, front, back=None, special=0, tag=0,
      mid="BRICKV4", top="", bot="", backmid=None):
    """Author a wall segment; `front` sector lies on the RIGHT of v1->v2."""
    key = tuple(sorted([(x1, y1), (x2, y2)]))
    EDGES.setdefault(key, []).append(
        dict(pts=((x1, y1), (x2, y2)), front=front, back=back,
             special=special, tag=tag, mid=mid, top=top, bot=bot,
             backmid=backmid))

def drop_wall(x1, y1, x2, y2):
    EDGES.pop(tuple(sorted([(x1, y1), (x2, y2)])), None)

def room(pts, sec, mid="BRICKV4"):
    """pts authored CCW (interior-left); emit reversed (CW) so interior is
    on the RIGHT of v1->v2 per DOOM front-side convention."""
    n = len(pts)
    for i in range(n):
        a = pts[i]; b = pts[(i + 1) % n]
        W(b[0], b[1], a[0], a[1], sec, None, 0, 0, mid)

# ------------------------------------------------------------- map design ---
START  = [(-640,-640),(-256,-640),(-256,-256),(-640,-256)]
HALL   = [(-256,-512),(64,-512),(64,-384),(-256,-384)]
COURT  = [(64,-704),(704,-704),(704,-64),(64,-64)]
PLAT   = [(192,-320),(448,-320),(448,-64),(192,-64)]
PIT    = [(-640,-64),(-128,-64),(-128,448),(-640,448)]
EXIT   = [(-128,-64),(64,-64),(64,192),(-128,192)]
SECRET = [(128,0),(192,0),(192,128),(128,128)]

sec_start  = MAP.sector(0, 128, 176, ff="FLOOR4_8", cf="FLOOR7_2")
sec_hall   = MAP.sector(0, 128, 128, ff="SARG2",    cf="SARG2")
sec_court  = MAP.sector(0, 256, 200, ff="FLOOR7_2", cf="DOOM32_1")
sec_plat   = MAP.sector(16, 256, 160, ff="TLMM1",   cf="DOOM32_1")
sec_pit    = MAP.sector(-128, 160, 96, special=4, ff="NUKAGE1", cf="FLOOR7_2")
sec_exit   = MAP.sector(0, 160, 192, ff="SP_DU11",  cf="COMP2")
sec_secret = MAP.sector(0, 128, 64, ff="RROCK13",   cf="RROCK13")

POLYS = {sec_start: [START], sec_hall: [HALL], sec_court: [COURT],
         sec_plat: [list(PLAT)], sec_pit: [PIT], sec_exit: [EXIT],
         sec_secret: [SECRET]}
HOLES = {i: [] for i in range(32)}

def door_corridor_v(rect, left_sec, right_sec, tag):
    """Vertical door strip (x0<x1): left half belongs to left_sec, right half
    to right_sec; door sector floor==ceiling==0 (closed). Door face walls are
    the west/east faces (player walks through along x)."""
    x0, y0, x1, y1 = rect
    xm = (x0 + x1) // 2
    sec = MAP.sector(0, 0, 160, tag=tag, ff="FLOOR4_8", cf="FLOOR4_8")
    POLYS[sec] = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    HOLES[left_sec].append((x0, y0, xm, y1))
    HOLES[right_sec].append((xm, y0, x1, y1))
    # west face v1->v2 south-bound: right side = west = left_sec boundary;
    # this is the door face between strip and left room: front on right must
    # be the DOOR sector for the door line, so orient north-bound with front=
    # door? Door face lines: the engine only cares about the tagged sector for
    # motion; the visible double-sided line is strip|room. Front (right) = strip
    # so the strip sector's segs see the DOOR3 texture.
    W(x0, y0, x0, y1, sec, left_sec, 0, tag, "DOOR3")   # north-bound: right=east=strip? 
    # NOTE: right of (x0,y0)->(x0,y1) is EAST = strip. But front must be the
    # sector on the right: strip's neighbor face belongs on LEFT. Flip:
    EDGES[tuple(sorted([(x0, y0), (x0, y1)]))].pop()
    W(x0, y1, x0, y0, left_sec, sec, 0, tag, "DOOR3")   # south-bound: right=west... 
    EDGES[tuple(sorted([(x0, y0), (x0, y1)]))].pop()
    # Correct: front=left_sec with left_sec on RIGHT of v1->v2 (south-bound
    # along x0: right side is WEST). Wrong again: left_sec is WEST of x0, so
    # south-bound gives right=west=left_sec. Front side=left_sec, back=strip.
    W(x0, y1, x0, y0, left_sec, sec, 0, tag, "DOOR3")
    W(x1, y0, x1, y1, right_sec, sec, 0, tag, "DOOR3")
    # north/south faces: room beyond is north of y1; strip below it.
    # Segment west half: boundary left_sec(north) | strip(south): front=strip
    # on right of a WEST-bound run (right=north? no: west-bound right=north).
    # east-bound along y1: right=south=strip => front=strip.
    W(x0, y1, xm, y1, sec, left_sec, 0, 0, "BRICKV4")
    W(xm, y1, x1, y1, sec, right_sec, 0, 0, "TECH1")
    # south face y0: room beyond is south; strip above. front=strip on right
    # of EAST-bound? east-bound right=south. We need front=strip which is
    # NORTH of y0 -> front on right requires WEST-bound (right=north).
    W(x1, y0, xm, y0, sec, right_sec, 0, 0, "TECH1")
    W(xm, y0, x0, y0, sec, left_sec, 0, 0, "BRICKV4")
    return sec

# ---- main rooms (CCW authored)
room(START, sec_start, "BRICKV4")
room(HALL, sec_hall, "TECH1")
room(COURT, sec_court, "STONE2")
room(PLAT, sec_plat, "TECH2")
room(PIT, sec_pit, "SLIME3")
room(EXIT, sec_exit, "COMP1")
room(SECRET, sec_secret, "RROCK14")

# ---- start<->hall vertical door strip x -288..-224, y -480..-416
# carve the doorway holes out of start/hall rooms first
HOLES.setdefault(sec_start, []).append((-288, -480, -256, -416))
HOLES.setdefault(sec_hall, []).append((-256, -480, -224, -416))
# remove the original room wall segments crossing the doorway
drop_wall(-256, -640, -256, -256)     # start east full wall
W(-256, -480, -256, -640, sec_start, None, 0, 0, "BRICKV4")
W(-256, -256, -256, -416, sec_start, None, 0, 0, "BRICKV4")
drop_wall(-256, -512, -256, -384)     # hall west wall
W(-256, -384, -256, -512, sec_hall, None, 0, 0, "TECH1")
# the strip replaces those; re-emit start east wall parts bounding the strip:
drop_wall(-256, -640, -256, -256)
W(-256, -640, -256, -480, sec_start, None, 0, 0, "BRICKV4")
W(-256, -416, -256, -256, sec_start, None, 0, 0, "BRICKV4")
drop_wall(-256, -512, -256, -384)
W(-256, -512, -256, -480, sec_hall, None, 0, 0, "TECH1")
W(-256, -416, -256, -384, sec_hall, None, 0, 0, "TECH1")
# strip geometry (its own holes above already recorded; POLYS set inside)
# Door slot 1: a real sector (x -288..-224, y -480..-416) carved out of both
# rooms; closed slot floor==ceiling==0. The ROOM-facing faces are authored
# front=room, back=slot, mid=DOOR3 so r_segs.c two-sided path sees
# backsector.ceiling(0) <= frontsector.floor(0) and paints the wall solid
# DOOR3 from both rooms (that is the "closed door" look); when the slot
# ceiling rises to 128 the opening appears and the doorway opens. Faces carry
# no ML_BLOCKING so P_UseLines traces work through them; the closed slot
# stops the player via the ceiling-height check (p_map.c) like vanilla doors.
sec_door1 = MAP.sector(0, 0, 160, tag=1, ff="FLOOR4_8", cf="FLOOR4_8")
POLYS[sec_door1] = [(-288,-480),(-224,-480),(-224,-416),(-288,-416)]
HOLES[sec_start].append((-288, -480, -256, -416))
HOLES[sec_hall].append((-256, -480, -224, -416))
# west face x=-288 (start west / slot east): front=start on right => south-
# bound. THE USE LINE: special=1 tag=1 (door line IS the trigger: vanilla
# blue-door dispatch happens before any openrange check, and no separate
# switch line can be shadowed by this line's infinite extension).
# DOOR3 as TOPTEXTURE, not mid: a masked MID texture only draws inside the
# back-sector opening, which is EMPTY while the slot is closed (black door!).
# The two-sided TOP band (worldhigh<worldtop) paints slot-ceiling..room-
# ceiling = the whole face while closed, and shrinks upward as the slot
# rises — exactly how vanilla door faces animate (r_segs.c:603 + pegging).
W(-288, -416, -288, -480, sec_start, sec_door1, 1, 1, "", top="DOOR3")
# east face x=-224 (slot west / hall east): front=hall on right => north-bound.
W(-224, -480, -224, -416, sec_hall, sec_door1, 0, 0, "", top="DOOR3")
# north face y=-416 (slot south / rooms north): front=slot on right => east-bound
W(-288, -416, -256, -416, sec_door1, sec_start, 0, 0, "", bot="", backmid="BRICKV4")
W(-256, -416, -224, -416, sec_door1, sec_hall, 0, 0, "", bot="", backmid="TECH1")
# south face y=-480 (slot north / rooms south): front=slot => west-bound
W(-224, -480, -288, -480, sec_door1, sec_start, 0, 0, "", bot="", backmid="BRICKV4")
W(-224, -480, -256, -480, sec_door1, sec_hall, 0, 0, "", bot="", backmid="TECH1")

# ---- (separate switch line removed: the door's room-facing line is now
# special 1 itself, so stand anywhere facing the door and press E)
drop_wall(-256, -640, -256, -480)
W(-256, -480, -256, -640, sec_start, None, 0, 0, "BRICKV4")

# ---- hall<->courtyard open archway at x=64, y -512..-384
drop_wall(64, -704, 64, -64)
W(64, -704, 64, -512, sec_court, None, 0, 0, "STONE2")
W(64, -512, 64, -384, sec_court, sec_hall, 0, 0, "TECH1")
W(64, -384, 64, -64, sec_court, None, 0, 0, "STONE2")

# ---- raised platform ledge inside courtyard (hole in court)
HOLES[sec_court].append((192, -320, 448, -64))

# ---- courtyard pillars
# NOTE: the north band is where the raised PLAT sector lives
# (x192..448, y-320..-64). 128x128 pillars centred on x=192/512 either
# OVERLAP the plat sector (its west edge cuts through x192..256) or share a
# coincident edge at x=448. Overlapping sector polygons produce BSP
# subsectors that mix two sectors' segs -> the renderer picks the wrong
# floor/ceiling flat for the leaf (stair-stepped flat seams, wall texture
# stretched to the ceiling). Keep north pillars clear of the plat rect.
PILLARS = [(192, -576, 64), (512, -576, 64),   # south band
           (128, -192, 32), (576, -192, 32)]   # north band, clear of plat
for (px, py, h) in PILLARS:
    s = MAP.sector(16, 256, 200, ff="TLMM1", cf="DOOM32_1")
    rect = [(px - h, py - h), (px + h, py - h), (px + h, py + h), (px - h, py + h)]
    POLYS[s] = rect
    HOLES[sec_court].append((px - h, py - h, px + h, py + h))
    for i in range(4):
        a = rect[i]; b = rect[(i+1) % 4]
        W(b[0], b[1], a[0], a[1], s, sec_court, 0, 0, "STONE2")
    MAP.thing(px + h + 16, py, 90, 2028)   # clear of the pillar footprint

# ---- exit<->secret door strip x 64..128 y 32..96 (secret room x128..192:
# carve secret's west half hole at x=128)
# the strip abuts the exit west wall x=64 and the secret west wall x=128:
# only the SECRET rect (x128..192) overlaps the strip region (x64..128)? No:
# strip is x64..128, secret starts at x128 -> no overlap for either room.
# (door1's strip DID overlap both rooms because it straddled x=-256.)
# secret room's original west wall x=128 spans y 0..128; drop doorway part
drop_wall(128, 0, 128, 128)
W(128, 32, 128, 0, sec_secret, None, 0, 0, "RROCK14")
W(128, 128, 128, 96, sec_secret, None, 0, 0, "RROCK14")
# exit east wall x=64 spans y -64..192; drop doorway part
drop_wall(64, -64, 64, 192)
W(64, 32, 64, -64, sec_exit, None, 0, 0, "COMP1")
W(64, 192, 64, 96, sec_exit, None, 0, 0, "COMP1")
# Secret door slot 2: vestibule x64..128, y32..96 between exit (west wall
# x=64) and secret room (east wall x=128); closed floor==ceiling==0.
# Room-facing faces front=room, back=slot, mid=DOOR3 (solid while closed,
# per r_segs.c backsector->ceilingheight <= frontsector->floorheight).
sec_door2 = MAP.sector(0, 0, 96, tag=2, ff="RROCK13", cf="RROCK13")
POLYS[sec_door2] = [(64,32),(128,32),(128,96),(64,96)]
# west face x=64 (exit west / slot east): front=exit on right => south-bound.
# THE USE LINE: special=2 tag=2; DOOR3 as top band (closed-slot-safe).
W(64, 96, 64, 32, sec_exit, sec_door2, 2, 2, "", top="DOOR3")
# east face x=128: plain DOOR3 top band from the secret side
W(128, 96, 128, 32, sec_secret, sec_door2, 0, 0, "", top="DOOR3")
# north face y=96 (slot south): front=slot => east-bound
W(64, 96, 96, 96, sec_door2, sec_exit, 0, 0, "", bot="", backmid="COMP1")
W(96, 96, 128, 96, sec_door2, sec_secret, 0, 0, "", bot="", backmid="RROCK14")
# south face y=32 (slot north): front=slot => west-bound
W(96, 32, 64, 32, sec_door2, sec_exit, 0, 0, "", bot="", backmid="COMP1")
W(128, 32, 96, 32, sec_door2, sec_secret, 0, 0, "", bot="", backmid="RROCK14")
# shootable switch opens secret door (P_ShootSpecialLine special 2: open
# door for shoot trigger? specials 1-8 doors; 1 = door open once, shootable)
# shoot switch facing the exit room. NOTE: tag 2 (opens secret door).
# The stairs loop drops its own authored edges by (fx,step_y0) coords; use
# literals that its (64..128, 24..72) steps never shadow.
W(0, -64, -128, -64, sec_exit, None, 1, 2, "SW1V4")   # shoot switch, tag 2
W(64, -64, 0, -64, sec_exit, None, 0, 0, "COMP1")

# ---- exit<->pit open ledge x=-128 y -64..128 (24-step stairs climb out of
# pit along the ledge; ledge floor 0, pit floor -128)
drop_wall(-128, -64, -128, 192)
W(-128, -64, -128, 128, sec_exit, sec_pit, 0, 0, "COMP1")
# pit east wall y 192..448 from room(PIT) already exists for y -64..448?
# room(PIT) east edge was (-128,-64)->(-128,448) authored; we dropped it.
W(-128, 192, -128, 448, sec_pit, None, 0, 0, "SLIME3")

# ---- stairs: 5 steps 24 high, 32 wide, y 128..192, west of ledge
step_y0, step_y1 = 128, 192
# create all step sectors FIRST so east/west neighbours are known; steps run
# west from the ledge: k0 at x[-160,-128] (highest, floor 120) ... k4 at
# x[-288,-256] (floor 24). Pit slime floor -128.
step_sectors = []
for k in range(5):
    fx = -160 - 32 * k
    fl = -8 - 24 * k        # east step (k0, at ledge)=-8 ... k4=-104; pit=-128
    s = MAP.sector(fl, 160, 96, ff="STEP2", cf="FLOOR7_2")
    step_sectors.append(s)
    POLYS[s] = [(fx, step_y0), (fx + 32, step_y0), (fx + 32, step_y1), (fx, step_y1)]
    HOLES[sec_pit].append((fx, step_y0, fx + 32, step_y1))
for k in range(5):
    fx = -160 - 32 * k
    s = step_sectors[k]
    east  = step_sectors[k + 1] if k < 4 else sec_exit   # k0 east = ledge(exit)
    west  = step_sectors[k - 1] if k > 0 else sec_pit    # k4 west = slime
    # east face: front=this step on right of south-bound (right=west=this)
    W(fx + 32, step_y1, fx + 32, step_y0, s, east, 0, 0, "STONE2")
    # west face: front=this step on right of north-bound (right=east=this)
    W(fx, step_y0, fx, step_y1, s, west, 0, 0, "STONE2")
    # south face y=128: step sector is NORTH of this edge, so front=step
    # needs right-of-travel=north => travel WEST-bound; back=pit slime south
    W(fx + 32, step_y0, fx, step_y0, s, sec_pit, 0, 0, "STONE2")
    # north face y=192: step is SOUTH of edge => travel EAST-bound (right=south)
    W(fx, step_y1, fx + 32, step_y1, s, sec_pit, 0, 0, "STONE2")
# ---- S1 exit switch on plat north wall (special 11 = exit switch)
drop_wall(192, -64, 448, -64)
W(192, -64, 320, -64, sec_plat, None, 0, 0, "TECH2")
W(320, -64, 448, -64, sec_plat, None, 11, 0, "SWM1V")

# ---- things
MAP.thing(-512, -576, 0, 1)
MAP.thing(-128, -448, 0, 2035)
MAP.thing(320, -640, 0, 3004)
MAP.thing(576, -256, 180, 3004)
MAP.thing(256, -128, 270, 3001)
MAP.thing(-400, 300, 0, 3004)
MAP.thing(-500, 100, 90, 3001)
MAP.thing(-500, -300, 0, 2015)
MAP.thing(300, -500, 0, 2014)
MAP.thing(400, -200, 0, 2007)
MAP.thing(150, 60, 0, 2018)
MAP.thing(-200, 350, 0, 2014)

# ------------------------------- merge coincident one-sided room walls ------
# Adjacent rooms each author their own one-sided perimeter wall on the shared
# boundary (opposite directions).  Coincident 1-sided walls are illegal map
# geometry (BSP slivers, two textures fighting for the same columns).  Split
# collinear segments at every shared endpoint and pair up opposite-direction
# overlaps into a single two-sided wall.
def _merge_coincident():
    lines = {}  # ('v',x)/('h',y) -> [(lo, hi, asc, entry)]  asc = coords increase
    for ents in EDGES.values():
        for e in ents:
            if e['back'] is not None or e['special']:
                continue
            (ax, ay), (bx, by) = e['pts']
            if ax == bx:
                lines.setdefault(('v', ax), []).append(
                    (min(ay, by), max(ay, by), ay < by, e))
            elif ay == by:
                lines.setdefault(('h', ay), []).append(
                    (min(ax, bx), max(ax, bx), ax < bx, e))
    for lkey, segs in lines.items():
        # split every entry at all shared endpoints
        cuts = sorted(set([s[0] for s in segs] + [s[1] for s in segs]))
        subs = {}   # (a,b) -> {front: entry}  (first author wins per front)
        drop = set()
        for lo, hi, asc, e in segs:
            pieces = [c for c in cuts if lo <= c <= hi]
            for a, b in zip(pieces, pieces[1:]):
                if b <= a:
                    continue
                g = subs.setdefault((a, b), {})
                if e['front'] not in g:
                    g[e['front']] = (asc, e)
                drop.add(id(e))
        fresh = []
        for (a, b), g in subs.items():
            fronts = list(g.items())     # front -> (asc, entry)
            if lkey[0] == 'v':
                pa, pb = (lkey[1], a), (lkey[1], b)
            else:
                pa, pb = (a, lkey[1]), (b, lkey[1])
            if len(fronts) == 1:
                asc, e = fronts[0][1]
                p1, p2 = (pa, pb) if asc else (pb, pa)
                fresh.append((tuple(sorted([p1, p2])),
                    dict(pts=(p1, p2), front=e['front'], back=None, special=0,
                         tag=0, mid=e['mid'], top=e['top'], bot=e['bot'])))
            elif len(fronts) == 2:
                # Vanilla rule: a two-sided line between two SAME-HEIGHT
                # sectors is always see-through, so walls between equal-height
                # rooms must stay as two coincident ONE-sided linedefs (the
                # drawseg clipper lets them occlude each other, exactly like
                # real nodebuilder output). Only merge when heights differ.
                # same-height shared walls merge to a two-sided, ML_BLOCKING
                # line WITH a full-height mid texture: the masked mid hides
                # the sector behind, BLOCKING stops movement (vanilla mappers
                # avoid exact equal-height 2-sided walls; this is the closest
                # faithful encoding of one).
                (fA, (ascA, eA)), (fB, (ascB, eB)) = fronts
                if ascA and not ascB:
                    fF, eF, fK, eK = fA, eA, fB, eB
                    p1, p2 = pa, pb
                elif ascB and not ascA:
                    fF, eF, fK, eK = fB, eB, fA, eA
                    p1, p2 = pa, pb
                else:
                    # both same direction (author oddity): pick either as
                    # front, flip orientation for the other side
                    fF, eF, fK, eK = fA, eA, fB, eB
                    p1, p2 = pb, pa
                fresh.append((tuple(sorted([p1, p2])),
                    dict(pts=(p1, p2), front=fF, back=fK, special=0, tag=0,
                         mid=eF['mid'], top=eF['top'], bot=eF['bot'],
                         backmid=eK['mid'], blocking=1)))
            else:
                raise AssertionError('triple overlap at %s %s' % (lkey, (a, b)))
        for key, ents in EDGES.items():
            for e in list(ents):
                if id(e) in drop:
                    ents.remove(e)
        for key in list(EDGES.keys()):
            if not EDGES[key]:
                EDGES.pop(key)
        for key, ne in fresh:
            EDGES.setdefault(key, []).append(ne)
_merge_coincident()

# --------------------------------------------------- flush walls to linedefs
linedefs = []
for key in sorted(EDGES.keys()):
    entries = EDGES[key]
    uniq = []
    for e in entries:
        if not any(e['front'] == u['front'] and e['back'] == u['back']
                   and e['pts'] == u['pts'] for u in uniq):
            uniq.append(e)
    entries = uniq
    two = [e for e in entries if e['back'] is not None]
    if two:
        l = two[0]
        (p1, p2) = l['pts']
        v1 = MAP.vert(*p1); v2 = MAP.vert(*p2)
        front_sec, back_sec = l['front'], l['back']
        # Vanilla leaves an unspecified back texture "-" (none). Defaulting
        # it to BRICKV4 painted phantom masked-mid curtains through opened
        # doorways (the slot-side of each door line got brick).
        bmid = l.get('backmid') or ""
        if not l.get('backmid'):
            for e in entries:
                if e['front'] == back_sec and e['back'] == front_sec:
                    bmid = e['mid']; break
        sf = MAP.side(l['mid'], l['top'], l['bot'])
        sb = MAP.side(bmid, "", "")
        specials = [e['special'] for e in entries if e['special']]
        tags = [e['tag'] for e in entries if e['special']]
        while len(MAP.side_sector) <= sb: MAP.side_sector.append(-1)
        MAP.side_sector[sf] = front_sec; MAP.side_sector[sb] = back_sec
        linedefs.append(dict(v1=v1, v2=v2, front=sf, back=sb,
                             special=specials[0] if specials else 0,
                             tag=tags[0] if tags else 0,
                             blocking=1 if l.get('blocking') else 0,
                             fsec=front_sec, bsec=back_sec))
    else:
        l = entries[0]
        (p1, p2) = l['pts']
        v1 = MAP.vert(*p1); v2 = MAP.vert(*p2)
        specials = [e['special'] for e in entries if e['special']]
        tags = [e['tag'] for e in entries if e['special']]
        sf = MAP.side(l['mid'], l['top'], l['bot'])
        while len(MAP.side_sector) <= sf: MAP.side_sector.append(-1)
        MAP.side_sector[sf] = l['front']
        linedefs.append(dict(v1=v1, v2=v2, front=sf,
                             back=-1, special=specials[0] if specials else 0,
                             tag=tags[0] if tags else 0,
                             fsec=l['front'], bsec=None))

# ------------------------------------------------------------- geometry ops --
def clip_half(poly, x1, y1, x2, y2, keepleft):
    def inside(px, py):
        cr = (x2-x1)*(py-y1) - (y2-y1)*(px-x1)
        return cr >= -1e-9 if keepleft else cr <= 1e-9
    def inter(ax, ay, bx, by):
        # f(p) = cross(edge, p - a) ; intersect where f crosses zero
        fa = (x2-x1)*(ay-y1) - (y2-y1)*(ax-x1)
        fb = (x2-x1)*(by-y1) - (y2-y1)*(bx-x1)
        if abs(fb - fa) < 1e-12: return (ax, ay)
        t = fa / (fa - fb)
        t = 0.0 if t < 0 else (1.0 if t > 1 else t)
        return (ax + t*(bx-ax), ay + t*(by-ay))
    out = []
    n = len(poly)
    for i in range(n):
        ax, ay = poly[i]; bx, by = poly[(i+1) % n]
        ia, ib = inside(ax, ay), inside(bx, by)
        if ia: out.append((ax, ay))
        if ia != ib: out.append(inter(ax, ay, bx, by))
    return out

def poly_area2(poly):
    a = 0.0
    for i in range(len(poly)):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % len(poly)]
        a += x1*y2 - x2*y1
    return a

def dedupe(poly):
    out = []
    for p in poly:
        # epsilon dedupe ONLY — never re-round: rounding would lift clipped
        # points off the partition line and re-introduce straddling
        if not out or (abs(p[0]-out[-1][0]) > 1e-9 or abs(p[1]-out[-1][1]) > 1e-9):
            out.append(p)
    while len(out) > 1 and out[0] == out[-1]: out.pop()
    return out

def to_cw(poly):
    return list(reversed(poly)) if poly_area2(poly) > 0 else list(poly)

def subtract_rect(polys, rect):
    """Peel the rect off each poly, disjointly. Hole boundary runs CCW so the
    hole interior is on the LEFT of each edge: walk the edges, emit the RIGHT
    side (outside the hole) as a piece, keep the LEFT remainder going.
    Partition (no overlaps), unlike unioning 4 independent half-plane clips."""
    x0, y0, x1, y1 = rect
    edges = [((x0,y0),(x1,y0)), ((x1,y0),(x1,y1)),
             ((x1,y1),(x0,y1)), ((x0,y1),(x0,y0))]
    keep_all = []
    for p in polys:
        remaining = p
        for (a, b) in edges:
            if not remaining or len(remaining) < 3: break
            R = dedupe(clip_half(remaining, a[0], a[1], b[0], b[1], False))  # outside hole edge -> piece
            remaining = dedupe(clip_half(remaining, a[0], a[1], b[0], b[1], True))
            if len(R) >= 3 and abs(poly_area2(R)) > 1e-6: keep_all.append(R)
        # whatever remains after all 4 edges lies INSIDE the hole -> dropped
    return keep_all

# ----------------------------------------------------- BSP node builder ----
def snap_line(x1, y1, x2, y2, pts):
    """Snap near-line points exactly onto the partition line so that
    clipped fragments can never straddle it again (kills BSP endless loops)."""
    ax, ay = x2-x1, y2-y1
    L2 = ax*ax + ay*ay
    out = []
    for (px, py) in pts:
        cr = ax*(py-y1) - ay*(px-x1)
        if abs(cr) <= 1e-4 * max(1.0, math.isqrt(int(L2)) if L2 else 1.0):
            t = ((px-x1)*ax + (py-y1)*ay) / L2
            px, py = x1 + t*ax, y1 + t*ay
        out.append((px, py))
    return out

def cut_pair(poly, x1, y1, x2, y2):
    poly = snap_line(x1, y1, x2, y2, poly)
    ax, ay = x2-x1, y2-y1
    crs = [ax*(py-y1) - ay*(px-x1) for (px, py) in poly]
    if max(abs(c) for c in crs) <= 1e-6:
        # polygon lies exactly ON the partition line -> front side only,
        # otherwise it gets duplicated into both children
        return poly, None
    R = dedupe(clip_half(poly, x1, y1, x2, y2, False))
    L = dedupe(clip_half(poly, x1, y1, x2, y2, True))
    okR = len(R) >= 3 and abs(poly_area2(R)) > 1e-3
    okL = len(L) >= 3 and abs(poly_area2(L)) > 1e-3
    if okR and okL:
        return R, L
    if okR: return R, None
    if okL: return None, L
    return None, None

def build_bsp(subpolys, depth=0):
    if len(subpolys) <= 1 or depth > 64:
        return ('sub', subpolys)
    best = None; bestscore = None; seen = set()
    for sec, poly in subpolys:
        n = len(poly)
        for i in range(n):
            a = poly[i]; b = poly[(i+1) % n]
            key = tuple(sorted([a, b]))
            if key in seen: continue
            seen.add(key)
            (x1,y1),(x2,y2) = a, b
            if x1 == x2 and y1 == y2: continue
            nf = nb = cut = 0
            for s2, p2 in subpolys:
                left = right = 0
                for (px, py) in p2:
                    cr = (x2-x1)*(py-y1) - (y2-y1)*(px-x1)
                    if cr > 1e-6: right += 1
                    elif cr < -1e-6: left += 1
                if left and right:
                    cut += 1
                    if cut > 20: break
                elif left: nf += 1
                elif right: nb += 1
            if cut == 0 and not (nf and nb): continue
            axis = 1 if (x1 == x2 or y1 == y2) else 0
            score = (10*cut - 40*axis, abs(x2-x1)+abs(y2-y1))
            if bestscore is None or score < bestscore:
                bestscore = score; best = ((x1,y1),(x2,y2), cut)
    if best is None:
        return ('sub', subpolys)
    (x1,y1),(x2,y2),cutb = best
    front, back = [], []
    for sec, poly in subpolys:
        R, L = cut_pair(poly, x1, y1, x2, y2)
        if R: front.append((sec, R))
        if L: back.append((sec, L))
    if not front or not back:
        return ('sub', subpolys)
    # cut==0 splits are pure separations (front+back == count, both smaller)
    # which still make strict progress; cutting splits may re-add polys, so
    # guard against collinear non-progress there.
    if cutb > 0 and len(front) + len(back) <= len(subpolys):
        return ('sub', subpolys)
    return ('node', build_bsp(front, depth+1), build_bsp(back, depth+1),
            ((x1, y1), (x2, y2)))

SUBS = []
def flatten(tree):
    if tree[0] == 'sub':
        polys = tree[1] if tree[1] else []
        sid = len(SUBS)
        SUBS.append(polys)          # one ssector record per leaf
        return ('sub', sid)
    return ('node', flatten(tree[1]), flatten(tree[2]), tree[3])

final_polys = []
for sec in sorted(POLYS.keys()):
    pl = POLYS[sec]
    # accept either a bare ring [(x,y),...] or a list of rings
    if pl and isinstance(pl[0], tuple) and isinstance(pl[0][0], (int, float)):
        pl = [pl]
    for p in pl:
        final_polys.append((sec, to_cw([(float(x), float(y)) for x, y in p])))
for sec in sorted(HOLES.keys()):
    for rect in HOLES[sec]:
        newlist = []
        for (s, p) in final_polys:
            if s != sec:
                newlist.append((s, p)); continue
            for pp in subtract_rect([p], rect):
                newlist.append((s, pp))
        final_polys = newlist

tree = flatten(build_bsp(final_polys))
print("subsectors:", len(SUBS))

def point_in_poly(x, y, poly):
    inside = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i+1) % n]
        if (y1 > y) != (y2 > y):
            xin = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xin: inside = not inside
    return inside

SAMPLES = [(-500,-550,'start'),(-100,-450,'hall'),(400,-600,'court'),
           (300,-200,'plat'),(-500,300,'pit'),(0,150,'exit'),
           (160,60,'secret'),(-256,-450,'door1'),(96,60,'door2'),
           (-144,160,'step'),(-272,160,'step')]
names = {sec_start:'start',sec_hall:'hall',sec_court:'court',sec_plat:'plat',
         sec_pit:'pit',sec_exit:'exit',sec_secret:'secret',
         sec_door1:'door1',sec_door2:'door2'}
for s in range(len(MAP.sectors)):
    names.setdefault(s, 'step%d' % s)
for (x, y, want) in SAMPLES:
    hits = sorted({names.get(s, s) for grp in SUBS for (s, p) in grp
                   if point_in_poly(x, y, p)})
    ok = (len(hits) == 1 and (want == 'step' or hits[0] == want))
    print(("  ok  " if ok else "  WARN") + f" {(x,y)} -> {hits} want {want}")

# ------------------------------------------------------------- emit segs ----
NODES_OUT = []
SUBSECTORS_OUT = []
SEGS_OUT = []
UNMATCHED = []
VCOORDS = [None] * len(MAP.vertexes)
for (x, y), idx in MAP.vertexes.items():
    VCOORDS[idx] = (float(x), float(y))

def emit_line(x1, y1, x2, y2, sector):
    """Find the linedef+side for subsector boundary edge (x1,y1)->(x2,y2)
    with `sector` on its right. Authored segments may fully contain the
    clipped edge (BSP splits subsector polys, not the other way round),
    so match on collinearity + containment + direction, not exact vertices."""
    v1 = MAP.vert(round(x1), round(y1)); v2 = MAP.vert(round(x2), round(y2))
    for i, ld in enumerate(linedefs):
        if (ld['v1'], ld['v2']) == (v1, v2) and ld['fsec'] == sector:
            return i, 0, 0
        if (ld['v1'], ld['v2']) == (v2, v1) and ld['bsec'] == sector:
            return i, 1, 0
    # collinear containment pass: authored seg same direction as edge,
    # sector is the side's sector, edge endpoints inside authored span
    ex, ey = x2-x1, y2-y1
    best = None
    for i, ld in enumerate(linedefs):
        ax, ay = VCOORDS[ld['v1']]; bx, by = VCOORDS[ld['v2']]
        for (p1, p2, side, ssec) in (((ax, ay), (bx, by), 0, ld['fsec']),
                                     ((bx, by), (ax, ay), 1, ld['bsec'])):
            if ssec != sector: continue
            dx, dy = p2[0]-p1[0], p2[1]-p1[1]
            LL = dx*dx + dy*dy
            if LL < 1e-12: continue
            # cross-offset of edge endpoints from authored line
            off = max(abs(dx*(y1-p1[1]) - dy*(x1-p1[0])),
                      abs(dx*(y2-p1[1]) - dy*(x2-p1[0])))
            if off > 1e-4 * math.sqrt(LL): continue
            # same direction?
            if dx*ex + dy*ey <= 0: continue
            t1 = (x1-p1[0])*dx + (y1-p1[1])*dy
            t2 = (x2-p1[0])*dx + (y2-p1[1])*dy
            if t1 < -1e-4 or t2 > LL + 1e-4: continue
            if best is None or LL < best[0]:
                best = (LL, i, side)
    if best is None:
        return -1, 0, 0
    LL, i, side = best
    ax, ay = VCOORDS[linedefs[i]['v1']]; bx, by = VCOORDS[linedefs[i]['v2']]
    if side == 0: p1 = (ax, ay)
    else: p1 = (bx, by)
    dx, dy = (bx - ax, by - ay) if side == 0 else (ax - bx, ay - by)
    L = math.hypot(dx, dy)
    off = 0 if L < 1e-9 else round(((x1 - p1[0]) * dx + (y1 - p1[1]) * dy) / L)
    return i, side, max(0, off)

def child_bbox(ci):
    # returns (left, right, bottom, top) in map units
    if ci & 0x8000:
        sid = ci & 0x7fff
        if sid < len(SUBS):
            xs = [q[0] for (_s, poly) in SUBS[sid] for q in poly]
            ys = [q[1] for (_s, poly) in SUBS[sid] for q in poly]
            if not xs: return (0, 0, 0, 0)
            return (min(xs), max(xs), min(ys), max(ys))
        return (0, 0, 0, 0)
    n = NODES_OUT[ci]
    a, b = n['bbox'][0], n['bbox'][1]
    return (min(a[0], b[0]), max(a[1], b[1]), min(a[2], b[2]), max(a[3], b[3]))

def _ring_matches(poly, sec):
    n = len(poly)
    good = 0
    for i in range(n):
        a = poly[i]; b = poly[(i+1) % n]
        if a == b: continue
        lid, _, _ = emit_line(a[0], a[1], b[0], b[1], sec)
        if lid >= 0: good += 1
    return good

def emit_tree(t):
    if t[0] == 'sub':
        sid = t[1]
        start = len(SEGS_OUT)
        if sid < len(SUBS):
            for (sec, poly) in SUBS[sid]:   # SUBS[leaf] = list of (sec,poly)
                # ring orientation guard: subsector polys produced by the BSP
                # split may come out CW for the back child of an axis split;
                # the subsector sector must lie on the RIGHT of every edge.
                if len(poly) > 2 and _ring_matches(poly[::-1], sec) > _ring_matches(poly, sec):
                    poly = poly[::-1]
                n = len(poly)
                for i in range(n):
                    a = poly[i]; b = poly[(i+1) % n]
                    if a == b: continue
                    # split the ring edge at every authored map vertex lying
                    # strictly inside it: real nodebuilders cut subsector
                    # edges at wall endpoints, so one ring edge can cover
                    # several linedefs (and true-seam spans between them)
                    dx, dy = b[0]-a[0], b[1]-a[1]
                    LL = dx*dx + dy*dy
                    ts = [0.0, 1.0]
                    if LL > 1e-9:
                        for (vx, vy) in MAP.vertexes.keys():
                            if (vx, vy) == (round(a[0]), round(a[1])) or \
                               (vx, vy) == (round(b[0]), round(b[1])):
                                continue
                            cr = dx*(vy-a[1]) - dy*(vx-a[0])
                            if abs(cr) > 1e-4 * math.sqrt(LL): continue
                            t = ((vx-a[0])*dx + (vy-a[1])*dy) / LL
                            if 1e-9 < t < 1-1e-9: ts.append(t)
                    ts = sorted(set(ts))
                    for t1, t2 in zip(ts, ts[1:]):
                        ax = a[0] + dx*t1; ay = a[1] + dy*t1
                        bx = a[0] + dx*t2; by = a[1] + dy*t2
                        lid, side, off = emit_line(ax, ay, bx, by, sec)
                        if lid < 0:
                            UNMATCHED.append((sid, sec, (ax, ay), (bx, by)))
                            continue
                        SEGS_OUT.append((round(ax), round(ay), round(bx), round(by), side, lid, off))
        SUBSECTORS_OUT.append((start, len(SEGS_OUT) - start))
        # NODES children are 16-bit: NF_SUBSECTOR = 0x8000 (doomdef.h)
        return 0x8000 | sid
    _, f, b, part = t
    fi = emit_tree(f)
    bi = emit_tree(b)
    (x1, y1), (x2, y2) = part
    NODES_OUT.append(dict(x=round(x1), y=round(y1), dx=round(x2-x1),
                          dy=round(y2-y1), front=fi, back=bi,
                          bbox=(child_bbox(fi), child_bbox(bi))))
    return len(NODES_OUT) - 1

root = emit_tree(tree)
print("nodes:", len(NODES_OUT), "segs:", len(SEGS_OUT), "root:", root)
print("UNMATCHED:", len(UNMATCHED))
for u in UNMATCHED[:30]:
    print("  ssec=%d sec=%s (%.0f,%.0f)->(%.0f,%.0f)" %
          (u[0], u[1], u[2][0], u[2][1], u[3][0], u[3][1]))

# ------------------------------------------------------------- blockmap ----
BLK = 128
vc = [None] * len(MAP.vertexes)
for (x, y), idx in MAP.vertexes.items():
    vc[idx] = (x, y)
orgx = min(p[0] for p in vc) - BLK
orgy = min(p[1] for p in vc) - BLK
bw = (max(p[0] for p in vc) + BLK - orgx) // BLK + 1
bh = (max(p[1] for p in vc) + BLK - orgy) // BLK + 1
blocks = {}
for i, ld in enumerate(linedefs):
    x1, y1 = vc[ld['v1']]; x2, y2 = vc[ld['v2']]
    bx1 = max(0, (min(x1,x2) - orgx) // BLK); bx2 = min(bw-1, (max(x1,x2) - orgx) // BLK)
    by1 = max(0, (min(y1,y2) - orgy) // BLK); by2 = min(bh-1, (max(y1,y2) - orgy) // BLK)
    for by in range(by1, by2+1):
        for bx in range(bx1, bx2+1):
            blocks.setdefault((bx, by), set()).add(i)

# -------------------------------------------------------------- pack -------
TEXPAD = lambda s: s.encode('ascii').ljust(8, b'\0')[:8]
THINGS = b''
for t in MAP.things:
    THINGS += struct.pack('<hhhHH', t['x'], t['y'], t['angle'], t['type'], t['flags'])
LINEDEFS = b''
for ld in linedefs:
    # maplinedef_t: v1,v2,flags,special,tag,sidenum[2] — flags: ML_BLOCKING(1)
    # + ML_TWOSIDED(4) (merged room-boundary walls block like vanilla windows)
    # set iff a back side exists (p_setup/P_AddLine semantics; the renderer
    # gates backsector on this flag, spec-game §1 SEGS note)
    flags = (4 if ld['back'] >= 0 else 0) | (1 if ld.get('blocking') else 0)
    LINEDEFS += struct.pack('<hhhhhhh', ld['v1'], ld['v2'], flags,
                            ld['special'], ld['tag'], ld['front'], ld['back'])
SIDEDEFS = b''
for sd_i, s in enumerate(MAP.sides):
    SIDEDEFS += struct.pack('<hh', 0, 0) + TEXPAD(s['top']) + TEXPAD(s['bottom']) \
                + TEXPAD(s['mid']) + struct.pack('<h', MAP.side_sector[sd_i])
VERTEXES = b''
for (x, y), idx in sorted(MAP.vertexes.items(), key=lambda kv: kv[1]):
    VERTEXES += struct.pack('<hh', x, y)
SEGS = b''
for (x1, y1, x2, y2, side, lid, soff) in SEGS_OUT:
    vv1 = MAP.vert(x1, y1); vv2 = MAP.vert(x2, y2)
    dx = x2 - x1; dy = y2 - y1
    ang = int(round(math.atan2(dy, dx) / (2 * math.pi) * 4294967296)) & 0xFFFFFFFF
    bam16 = (ang >> 16) & 0xFFFF          # mapseg_t stores BAM>>16
    SEGS += struct.pack('<hhHHhh', vv1, vv2, bam16, lid & 0xFFFF, side, soff)
SSECTORS = b''
for (st, cnt) in SUBSECTORS_OUT:
    SSECTORS += struct.pack('<hh', cnt, st)
NODES = b''
for n in NODES_OUT:
    NODES += struct.pack('<hhhh', n['x'], n['y'], n['dx'], n['dy'])
    for cb in n['bbox']:      # per child, m_bbox.h order: TOP,BOTTOM,LEFT,RIGHT
        l_, r_, b_, t_ = cb
        NODES += struct.pack('<hhhh', int(max(-32768, min(32767, t_))),
                             int(max(-32768, min(32767, b_))),
                             int(max(-32768, min(32767, l_))),
                             int(max(-32768, min(32767, r_))))
    NODES += struct.pack('<HH', n['front'] & 0xffff, n['back'] & 0xffff)
SECTORS = b''
for s in MAP.sectors:
    # mapsector_t: floor, ceiling, floorpic[8], ceilingpic[8], light, special, tag
    SECTORS += struct.pack('<hh', s['floor'], s['ceiling'])
    SECTORS += TEXPAD(s['ff']) + TEXPAD(s['cf'])
    SECTORS += struct.pack('<hhh', s['light'], s['special'], s['tag'])
nsec = len(MAP.sectors)
REJECT = bytes((nsec * nsec + 7) // 8)
BLOCKMAP = struct.pack('<hhhh', orgx, orgy, bw, bh)
offsets = b''; blockdata = b''
for by in range(bh):
    for bx in range(bw):
        ids = sorted(blocks.get((bx, by), set()))
        offsets += struct.pack('<H', 4*(bw*bh) + 2 + len(blockdata))
        blockdata += struct.pack('<H', len(ids)) + b''.join(struct.pack('<H', i) for i in ids)
BLOCKMAP += offsets + blockdata
# rewrite in vanilla form: offsets (shorts into blockmaplump), lists
# "count id0 id1 ... 0xFFFF"
_bmoff = b''; _bmdata = b''
for by in range(bh):
    for bx in range(bw):
        ids = sorted(blocks.get((bx, by), set()))
        # short index into blockmaplump (C: blockmaplump is short* and the
        # table holds *short* offsets, not byte offsets)
        _bmoff += struct.pack('<H', (bw * bh + 4) + len(_bmdata) // 2)
        _bmdata += struct.pack('<H', len(ids))
        for i in ids: _bmdata += struct.pack('<H', i)
        _bmdata += b'\xff\xff'
BLOCKMAP = struct.pack('<hhhh', orgx, orgy, bw, bh) + _bmoff + _bmdata

lumps = {'THINGS': THINGS, 'LINEDEFS': LINEDEFS, 'SIDEDEFS': SIDEDEFS,
         'VERTEXES': VERTEXES, 'SEGS': SEGS, 'SSECTORS': SSECTORS,
         'NODES': NODES, 'SECTORS': SECTORS, 'REJECT': REJECT,
         'BLOCKMAP': BLOCKMAP}
out = {'mapname': 'MAP01',
       'lumps': {k: base64.b64encode(v).decode() for k, v in lumps.items()}}
json.dump(out, open(sys.argv[1] if len(sys.argv) > 1 else 'map01.json', 'w'))
print("written:", len(json.dumps(out)), "bytes;", len(MAP.things), "things,",
      len(linedefs), "lines,", nsec, "sectors")
