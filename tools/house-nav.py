"""
Measure the apartment and cut it into rooms.

Same idea as the village: the model carries no names, no materials and no
semantics, so everything the game needs is measured off the geometry. The
apartment is simpler in one way — it is an interior with no roof, so a ray
dropped from above lands on the floor, on furniture, or on the top of a wall —
and harder in another: it has ROOMS, and rooms are what make a house read as a
house rather than as a big cluttered box.

Rooms are found by erosion. Floor cells form one connected blob because the
doorways join them; eroding that blob by half a doorway pinches the doorways
shut, which separates the rooms; labelling and then dilating back recovers each
room at full size. The alternative — looking for wall lines — falls apart on a
mesh whose walls are not axis-aligned, and this one's are not quite.
"""
import bpy, sys, json, math, mathutils
import heapq
from collections import deque, Counter

src, out, SCALE = sys.argv[-3], sys.argv[-2], float(sys.argv[-1])
N = 320
print("SKALA", SCALE)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
dg = bpy.context.evaluated_depsgraph_get()
bpy.context.view_layer.update()

mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
for c in obj.bound_box:
    w = obj.matrix_world @ mathutils.Vector(c)
    for i in range(3):
        mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])

# --- height field -----------------------------------------------------------
# TWO measurements per cell, and the difference between them is the whole
# reason the first attempt sealed every door in the flat:
#
#   height    what a ray dropped from above lands on. Good for deciding what a
#             surface IS — floor, worktop, wall — and so for painting it.
#
#   headroom  how far it is from the floor to the first thing overhead. This is
#             what decides where you can WALK, and it is not the same question.
#             Every doorway in this model has a header over it, so from above a
#             doorway reads as solid wall — measuring the flat that way left the
#             players sealed in the living room with 27% of the flat reachable.
#             Measured from the floor up, a doorway has two and a half metres of
#             air in it and a sofa has none.
#
# Headroom is emitted raw, in model units, and the game thresholds it by how
# tall a player actually is. Baking the threshold in here would put the number
# in the wrong place: only the game knows how big a monster is.
top = mx.z + 1.0
height = [[None] * N for _ in range(N)]
headroom = [[None] * N for _ in range(N)]
for j in range(N):
    for i in range(N):
        x = mn.x + (mx.x - mn.x) * (i + 0.5) / N
        y = mn.y + (mx.y - mn.y) * (j + 0.5) / N
        hit, loc, nor, idx, o, m = bpy.context.scene.ray_cast(dg, (x, y, top), (0, 0, -1))
        height[j][i] = loc.z if hit else None

# The floor has to be known before headroom can be measured from it, so this
# runs in two passes over the same grid.
vals = [h for row in height for h in row if h is not None]
hist = Counter(round(h, 3) for h in vals)
floor_z = hist.most_common(1)[0][0]
print("PADLO z =", floor_z, "| mintak", len(vals), "/", N * N)
for z, n in sorted(hist.items())[:6]:
    print("   alacsony szint", z, n)
print("   legmagasabb", max(vals))

WALL_TOP = max(vals)
cell = (mx.x - mn.x) / N

# Room ids as single characters: 0 is "no room", then 1-9, then letters. A flat
# with more than thirty-five rooms is not this flat.
ROOM_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz"

def to_world(c):
    return [mn.x + (mx.x - mn.x) * (c[0] + 0.5) / N, mn.y + (mx.y - mn.y) * (c[1] + 0.5) / N]


# Where can a player GO? Asked as an edge question, not a cell question.
#
# Three cell-based rules were tried and all three broke on this model's walls,
# which are hollow shells, open at the bottom: two thin skins with air between.
# A ray dropped from the sky finds the header over every doorway and seals the
# flat. A ray fired up from the floor sails out through the top of a wall. A
# ray dropped from head height goes down the hollow and lands on the floor, so
# the inside of a wall reports as a room.
#
# The question that has no such failure is the one the player actually asks:
# can I get from HERE to THERE. Cast a ray at head height between the centres
# of two neighbouring cells; if it hits, that step is blocked. A doorway has
# clear steps through it. A wall does not, at any height, because its skins are
# in the way — and the air inside it becomes a pocket with no way in, which is
# exactly what it is.
#
# PLAYER is a monster's height in model units — the one number here that
# depends on the game's scale, and it has to: how tall you are decides what you
# can walk under. The scale is passed in and written into the output, and
# VillageHouse refuses a grid that was measured for a different one.
PLAYER = 1.7 / SCALE
EYE = floor_z + PLAYER * 0.55

stepx = (mx.x - mn.x) / N
stepy = (mx.y - mn.y) / N
def centre(i, j):
    return (mn.x + stepx * (i + 0.5), mn.y + stepy * (j + 0.5))

passx = [[False] * N for _ in range(N)]   # (i,j) -> (i+1,j)
passy = [[False] * N for _ in range(N)]   # (i,j) -> (i,j+1)
for j in range(N):
    for i in range(N):
        x, y = centre(i, j)
        # There also has to be something to walk ON. Without this the flood
        # goes out of the front door and keeps going: open sky has nothing to
        # hit, so every step across it is "clear", and the garden, the street
        # and the edge of the world all count as part of the flat.
        grounded = height[j][i] is not None
        if i + 1 < N and grounded and height[j][i + 1] is not None:
            hit, loc, nor, idx, o, m = bpy.context.scene.ray_cast(
                dg, (x, y, EYE), (1, 0, 0), distance=stepx)
            passx[j][i] = not hit
        if j + 1 < N and grounded and height[j + 1][i] is not None:
            hit, loc, nor, idx, o, m = bpy.context.scene.ray_cast(
                dg, (x, y, EYE), (0, 1, 0), distance=stepy)
            passy[j][i] = not hit

# Flood from the biggest patch of clear floor there is: the middle of the
# largest room. Seeding anywhere specific would only be another thing to get
# wrong.
seed = None
best = -1
for j in range(2, N - 2):
    for i in range(2, N - 2):
        if height[j][i] is None or abs(height[j][i] - floor_z) > 0.004:
            continue
        room = sum(1 for a, b in ((1,0),(-1,0),(0,1),(0,-1))
                   if height[j+b][i+a] is not None and abs(height[j+b][i+a] - floor_z) < 0.004)
        if room == 4 and passx[j][i] and passy[j][i]:
            d = min(i, j, N - 1 - i, N - 1 - j)
            if d > best:
                best = d; seed = (i, j)

reach = [[False] * N for _ in range(N)]
q = deque([seed]); reach[seed[1]][seed[0]] = True
while q:
    i, j = q.popleft()
    for di, dj, open_ in ((1, 0, passx[j][i]), (-1, 0, passx[j][i-1] if i else False),
                          (0, 1, passy[j][i]), (0, -1, passy[j-1][i] if j else False)):
        a, b = i + di, j + dj
        if open_ and 0 <= a < N and 0 <= b < N and not reach[b][a]:
            reach[b][a] = True; q.append((a, b))

for j in range(N):
    for i in range(N):
        headroom[j][i] = PLAYER if reach[j][i] else 0.0

walkable = sum(1 for row in headroom for h in row if h)
print("JARHATO CELLAK", walkable, "/", N * N)

# What counts as standing on the floor rather than being the floor.
STEP = 0.004   # in model units; converted to metres by the game's own scale
floor = [[bool(r) for r in row] for row in headroom]
solid = [[not r for r in row] for row in headroom]

print("PADLOCELLAK", sum(sum(r) for r in floor), "| fal/butor", sum(sum(r) for r in solid))

# --- the rooms --------------------------------------------------------------
# The camera shows the room you are standing in and nothing else, so the flat
# has to be cut into rooms — and cut correctly, because a mistake here is a
# wall of black across the middle of a room, or a view into the bathroom.
#
# Erosion was the first attempt and it does not work: this model's doors are
# open and the openings are twelve to nineteen cells wide, so a brush big
# enough to pinch them shut also eats the small rooms whole. There is no
# threshold that does both.
#
# The right tool is a WATERSHED on the distance transform. Every room has a
# middle that is far from any wall; every doorway is a pinch where that
# distance collapses. Flooding outwards from the local maxima in order of
# DECREASING clearance means each room grows from its own middle and the two
# floods meet exactly at the narrowest point between them — which is the
# doorway. No thresholds to tune, and it cannot eat a small room, because a
# small room still has a middle.
clearance = [[-1] * N for _ in range(N)]
q = deque()
for j in range(N):
    for i in range(N):
        if not floor[j][i]:
            clearance[j][i] = 0; q.append((i, j))
while q:
    a, b = q.popleft()
    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        p, r = a + da, b + db
        if 0 <= p < N and 0 <= r < N and clearance[r][p] < 0:
            clearance[r][p] = clearance[b][a] + 1; q.append((p, r))

# Seeds: every local maximum of the clearance field. Deliberately too many —
# furniture puts a bump in the field wherever it stands, so this over-segments
# on purpose, and the merging below decides what is really one room.
#
# Trying to seed exactly one point per room was two rounds of threshold-fiddling
# and never worked: "how open must a spot be to be a room's middle" has no
# answer that holds for a 23 m living room and a 3 m WC at the same time.
SEED_MIN = max(4, int(math.ceil((1.0 / SCALE) / cell)))
seeds = []
for j in range(2, N - 2):
    for i in range(2, N - 2):
        c = clearance[j][i]
        if c < SEED_MIN:
            continue
        if any(clearance[j + b][i + a] > c for b in (-1, 0, 1) for a in (-1, 0, 1)):
            continue
        if any((i - si) ** 2 + (j - sj) ** 2 < (SEED_MIN * 1.5) ** 2 for si, sj in seeds):
            continue
        seeds.append((i, j))

label = [[0] * N for _ in range(N)]
# Flood in order of DECREASING clearance: open floor is claimed first and the
# pinch points — the doorways — are settled last, by whichever region reached
# them. That is what puts every boundary in a narrow place.
heap = []
for k, (i, j) in enumerate(seeds, start=1):
    label[j][i] = k
    heapq.heappush(heap, (-clearance[j][i], i, j))
while heap:
    _, i, j = heapq.heappop(heap)
    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, b = i + da, j + db
        if 0 <= a < N and 0 <= b < N and floor[b][a] and label[b][a] == 0:
            label[b][a] = label[j][i]
            heapq.heappush(heap, (-clearance[b][a], a, b))

# --- merge the regions that are really one room -----------------------------
#
# This is the step that makes the whole thing work, and it needs no threshold
# in metres — only a RATIO. Two regions meet along a saddle: the most open
# point on their shared border. A doorway is a pinch, so its saddle is a
# fraction of either room's own openness. An imaginary line across the middle
# of one room is not a pinch at all, so its saddle is nearly as open as the
# room. Merge while the saddle is a large share of the smaller region, and what
# survives is exactly the set of places separated by doorways.
peak = {}
for j in range(N):
    for i in range(N):
        r = label[j][i]
        if r and clearance[j][i] > peak.get(r, -1):
            peak[r] = clearance[j][i]

saddle = {}
for j in range(1, N - 1):
    for i in range(1, N - 1):
        r = label[j][i]
        if not r:
            continue
        for da, db in ((1, 0), (0, 1)):
            o = label[j + db][i + da]
            if not o or o == r:
                continue
            key = (min(r, o), max(r, o))
            width = min(clearance[j][i], clearance[j + db][i + da])
            if width > saddle.get(key, -1):
                saddle[key] = width

parent = {r: r for r in peak}
def find(r):
    while parent[r] != r:
        parent[r] = parent[parent[r]]
        r = parent[r]
    return r

MERGE_RATIO = 0.55
for (a, b), width in sorted(saddle.items(), key=lambda kv: -kv[1]):
    ra, rb = find(a), find(b)
    if ra == rb:
        continue
    if width >= MERGE_RATIO * min(peak[ra], peak[rb]):
        parent[rb] = ra
        peak[ra] = max(peak[ra], peak[rb])

for j in range(N):
    for i in range(N):
        if label[j][i]:
            label[j][i] = find(label[j][i])

# A cupboard is part of the room it opens off# A cupboard is part of the room it opens off, not a place the camera cuts to.
sizes = {}
for j in range(N):
    for i in range(N):
        if label[j][i]:
            sizes[label[j][i]] = sizes.get(label[j][i], 0) + 1
square = (cell * SCALE) ** 2
small = {k for k, n in sizes.items() if n * square < 8.0}
if small:
    for j in range(N):
        for i in range(N):
            if label[j][i] in small:
                label[j][i] = 0
    q2 = deque((i, j) for j in range(N) for i in range(N) if label[j][i])
    while q2:
        i, j = q2.popleft()
        for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            a, b = i + da, j + db
            if 0 <= a < N and 0 <= b < N and floor[b][a] and label[b][a] == 0:
                label[b][a] = label[j][i]
                q2.append((a, b))

room_ids = sorted({label[j][i] for j in range(N) for i in range(N) if label[j][i]})
remap = {old: new for new, old in enumerate(room_ids, start=1)}
for j in range(N):
    for i in range(N):
        if label[j][i]:
            label[j][i] = remap[label[j][i]]
print("SZOBAK", len(room_ids), "| magok", len(seeds), "| beolvasztott apro", len(small))

room_info = []
for rid in range(1, len(room_ids) + 1):
    cells = [(i, j) for j in range(N) for i in range(N) if label[j][i] == rid]
    xs = [c[0] for c in cells]; ys = [c[1] for c in cells]
    room_info.append({
        "id": rid,
        "cells": len(cells),
        "area": len(cells) * square,
        "min": to_world((min(xs) - 0.5, min(ys) - 0.5)),
        "max": to_world((max(xs) + 0.5, max(ys) + 0.5)),
        "centre": to_world((sum(xs) / len(cells), sum(ys) / len(cells))),
    })
    print(f"   szoba {rid}: {room_info[-1]['area']:.0f} m2, {len(cells)} cella")

# Where a whole PLAYER can get to, which is a smaller place than where the
# grid says there is floor: a corridor one cell wider than a monster is not a
# corridor. Anchors go here and nowhere else — the first version used the raw
# floor and left one sweet and one patrol stop in pockets nobody could enter.
BODY_CELLS = max(2, int(math.ceil((0.45 / SCALE) / cell)) + 1)

def body_fits(i, j):
    for b in range(-BODY_CELLS, BODY_CELLS + 1):
        for a in range(-BODY_CELLS, BODY_CELLS + 1):
            p, r = i + a, j + b
            if not (0 <= p < N and 0 <= r < N) or not floor[r][p]:
                return False
    return True

# Seeded from the middle of the biggest room rather than from the doorway,
# because the door has not been found yet at this point in the script — and the
# two give the same region anyway, since the door opens into the flat.
_start = seed
_body = [[False] * N for _ in range(N)]
if body_fits(*_start):
    _q = deque([_start]); _body[_start[1]][_start[0]] = True
else:
    _q = deque()
    for _r in range(1, 40):
        found = False
        for _b in range(-_r, _r + 1):
            for _a in range(-_r, _r + 1):
                i, j = _start[0] + _a, _start[1] + _b
                if 0 <= i < N and 0 <= j < N and body_fits(i, j):
                    _q.append((i, j)); _body[j][i] = True; found = True; break
            if found: break
        if found: break
while _q:
    a, b = _q.popleft()
    for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        p, r = a + da, b + db
        if 0 <= p < N and 0 <= r < N and not _body[r][p] and body_fits(p, r):
            _body[r][p] = True; _q.append((p, r))

walkable_cells = [(i, j) for j in range(N) for i in range(N) if _body[j][i]]
print("JATEKOSSAL BEJARHATO", len(walkable_cells), "cella")

def spread(count, seed, min_clearance):
    """`count` points, each as far as possible from the ones before it."""
    pool = [c for c in walkable_cells if clearance[c[1]][c[0]] >= min_clearance]
    while len(pool) < count * 20 and min_clearance > 2:
        # Nowhere in this house is that open. Ask for less rather than falling
        # back to the whole floor, which would put sweets in the corners.
        min_clearance -= 1
        pool = [c for c in walkable_cells if clearance[c[1]][c[0]] >= min_clearance]
    if not pool:
        pool = walkable_cells
    chosen = []
    best = {c: (c[0] - seed[0]) ** 2 + (c[1] - seed[1]) ** 2 for c in pool}
    for _ in range(count):
        pick = max(pool, key=lambda c: best[c])
        chosen.append(pick)
        for c in pool:
            d = (c[0] - pick[0]) ** 2 + (c[1] - pick[1]) ** 2
            if d < best[c]:
                best[c] = d
    return chosen

# --- where the front door is ------------------------------------------------
# The porch gives it away. Everything outside the building has no geometry at
# all, so the one patch of FLOOR that sits outside the walls is the doorstep,
# and the door is the nearest point of the shell to it. Looking for a gap in
# the wall instead does not work here: the model's front door is shut, and a
# shut door is not a gap.
outside = [[False] * N for _ in range(N)]
q = deque()
for i in range(N):
    for j in (0, N - 1):
        if height[j][i] is None and not outside[j][i]:
            outside[j][i] = True; q.append((i, j))
        if height[i][j] is None and not outside[i][j]:
            outside[i][j] = True; q.append((j, i))
while q:
    a, b = q.popleft()
    for da, db in ((1,0),(-1,0),(0,1),(0,-1)):
        p, r = a + da, b + db
        if 0 <= p < N and 0 <= r < N and not outside[r][p] and height[r][p] is None:
            outside[r][p] = True; q.append((p, r))

# The porch: the doorstep, which is the one bit of walkable ground that is
# OUTSIDE the walls.
#
# "Floor that touches the outside, flooded" was the first attempt and it walks
# straight in through the front door and claims the whole flat. The fix is to
# flood only through cells that are themselves out in the open: the doorstep is
# open on three sides, and the moment the flood steps through the door it is
# indoors, with the wall between it and the sky, and stops.
open_air = [[False] * N for _ in range(N)]
for j in range(N):
    for i in range(N):
        if not floor[j][i]:
            continue
        open_air[j][i] = any(
            0 <= i + a < N and 0 <= j + b < N and outside[j + b][i + a]
            for a, b in ((1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2))
        )

porch = []
seen_p = [[False] * N for _ in range(N)]
for j in range(N):
    for i in range(N):
        if not open_air[j][i] or seen_p[j][i]:
            continue
        blob = deque([(i, j)]); seen_p[j][i] = True; cells = []
        while blob:
            a, b = blob.popleft(); cells.append((a, b))
            for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                p, r = a + da, b + db
                if 0 <= p < N and 0 <= r < N and open_air[r][p] and not seen_p[r][p]:
                    seen_p[r][p] = True; blob.append((p, r))
        porch.append(cells)

# The doorstep is the bit of the building that STICKS OUT of it.
#
# Five rules were tried before this one and every one of them picked a gap in
# a wall at a far corner instead: biggest blob, furthest from the centre, most
# sky around its edge, least enclosed by walls, and combinations. They all
# fail for the same reason — a corner of a building looks, locally, exactly
# like a thing sticking out of it.
#
# The tool for "what sticks out" is a morphological OPENING. Erode the
# building's footprint and dilate it back: anything narrower than the brush
# vanishes and does not come back, while the body of the building is untouched.
# What the opening removed IS the protrusion, and on this model that is the
# porch and nothing else. A corner survives an opening; a doorstep does not.
footprint = [[height[j][i] is not None for i in range(N)] for j in range(N)]

def morph(mask, k, keep_all):
    """Separable min (erode) or max (dilate) over a (2k+1) square."""
    tmp = [[False] * N for _ in range(N)]
    for j in range(N):
        row = mask[j]
        for i in range(N):
            lo = max(0, i - k); hi = min(N - 1, i + k)
            window = row[lo:hi + 1]
            tmp[j][i] = all(window) if keep_all else any(window)
    out = [[False] * N for _ in range(N)]
    for i in range(N):
        column = [tmp[j][i] for j in range(N)]
        for j in range(N):
            lo = max(0, j - k); hi = min(N - 1, j + k)
            window = column[lo:hi + 1]
            out[j][i] = all(window) if keep_all else any(window)
    return out

BRUSH = 10
opened = morph(morph(footprint, BRUSH, True), BRUSH, False)
protruding = [[footprint[j][i] and not opened[j][i] for i in range(N)] for j in range(N)]
print("KISZOGELLES", sum(sum(r) for r in protruding), "cella")

def protrusion_share(cells):
    return sum(1 for a, b in cells if protruding[b][a]) / len(cells)

print("TORNAC-JELOLTEK:", sorted((len(c) for c in porch), reverse=True)[:8])
porch = [c for c in porch if len(c) >= 25]
porch.sort(key=lambda c: (-protrusion_share(c), -len(c)))
step = porch[0] if porch else []

# HA NINCS TORNAC: a legvekonyabb kulso fal.
#
# A tornac-keresés azt feltételezte, hogy a bejáratnak van KÜSZÖBE — járható
# padló a falakon kívül. Az első lakásnál volt; a folyosós háznál nincs
# egyetlen ilyen cella sem (lemérve: nulla jelölt), mert a modell ajtaja
# csukott lap, nem nyílás.
#
# Ilyenkor a bejáratot onnan ismerjük fel, ahol a KÜLSŐ FAL A LEGVÉKONYABB:
# egy ajtó helyén a fal vagy megszakad, vagy elvékonyodik, és ez a legkisebb
# távolság a belső padló és a szabad ég között. Ez nem találgatás — a
# geometria mondja meg, hol lehet egyáltalán bemenni.
if not step:
    from collections import deque as _deque
    INF = 10 ** 9
    dist = [[INF] * N for _ in range(N)]
    queue = _deque()
    for j in range(N):
        for i in range(N):
            if outside[j][i]:
                dist[j][i] = 0
                queue.append((i, j))
    while queue:
        a, b = queue.popleft()
        for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            p, r = a + da, b + db
            if 0 <= p < N and 0 <= r < N and dist[r][p] > dist[b][a] + 1:
                dist[r][p] = dist[b][a] + 1
                queue.append((p, r))

    best = None
    for j in range(N):
        for i in range(N):
            if not floor[j][i] or dist[j][i] == INF:
                continue
            if best is None or dist[j][i] < dist[best[1]][best[0]]:
                best = (i, j)
    if best is not None:
        step = [best]
        print("TORNAC nincs — a legvekonyabb kulso fal:", best,
              "(%d cella a szabad egig)" % dist[best[1]][best[0]])

px = sum(a for a, _ in step) / max(1, len(step))
py = sum(b for _, b in step) / max(1, len(step))
print("TORNAC", len(step), "cella, kozep cella", round(px, 1), round(py, 1))

# MILYEN MESSZE induljanak a bejárattól?
#
# Nyolc cella volt, beírva — és az véletlenül jó volt az első lakásra, ahol a
# tornác miatt a bejárat amúgy is kintebb esett. A két új háznál viszont a
# rajt NÉGY MÉTERRE került a kijárattól, aminek nyolc méter a sugara: a
# szakasz abban a pillanatban véget ért volna, ahogy elkezdődik.
#
# A szám tehát nem lehet beírt cellaszám, mert a KIJÁRAT SUGARÁHOZ képest
# értelmes. Másfélszerese annak: bent vagy, de nem a küszöbön.
EXIT_RADIUS_M = 8.0
SPAWN_CELLS = (EXIT_RADIUS_M * 1.6 / SCALE) / ((mx.x - mn.x) / N)

# The spawn: walk from the doorstep towards the middle of the house until the
# first inside floor cell wide enough to stand two monsters on.
mid = (N / 2, N / 2)
dx, dy = mid[0] - px, mid[1] - py
length = math.hypot(dx, dy) or 1.0
dx, dy = dx / length, dy / length
door_cell = None
spawn_cell = None
for t in range(0, int(length) + 1):
    i = int(px + dx * t); j = int(py + dy * t)
    if not (0 <= i < N and 0 <= j < N):
        break
    # The threshold: the last of the doorstep, then the wall line, then indoors.
    if door_cell is None and not open_air[j][i] and floor[j][i]:
        door_cell = (i, j)
    if door_cell is not None and floor[j][i] and not open_air[j][i]:
        spawn_cell = (i, j)
        if math.hypot(i - px, j - py) > SPAWN_CELLS:
            break
print("AJTO cella", door_cell, "| BELSO INDULAS cella", spawn_cell)


# --- where the game happens -------------------------------------------------
door_cell_xy = spawn_cell or (int(px), int(py))

# Sweets: spread across the flat, in spots with room to stand. Deliberately
# seeded from the door, so the first one chosen is the far corner and nobody
# finishes the house without crossing it.
# Far enough from any wall to be out in a room rather than jammed in a corner.
# A player is about 1.3 cells across; asking for five times that keeps the
# sweets somewhere you have to walk out into the open to get them, which is
# where the danger is.
CANDY_CLEARANCE = max(6, int(round((0.45 / SCALE) / cell)) * 5)
candy = []
for k, c in enumerate(spread(5, door_cell_xy, CANDY_CLEARANCE)):
    d = math.hypot(c[0] - door_cell_xy[0], c[1] - door_cell_xy[1])
    candy.append({"at": to_world(c), "room": 1, "reward": 8 if d > N * 0.4 else 5})
print("CUKORKA", len(candy), "helyen")

# Pranks: against something, not out in the open — a prank has to be where the
# owner will come and look. Low clearance means a wall or a piece of furniture
# is right there.
pranks = []
# Near something, but still standable: a prank the players cannot walk up to
# is not a prank. The lower bound is a player's own half-width in cells plus a
# margin — the first version used 2, which is narrower than the players are,
# and two of the three pranks ended up somewhere nobody could reach.
BODY = max(3, int(math.ceil((0.45 / SCALE) / cell)) + 1)
tight = [c for c in walkable_cells if BODY <= clearance[c[1]][c[0]] <= BODY + 3]
if tight:
    picked = []
    for c in sorted(tight, key=lambda c: -((c[0] - door_cell_xy[0]) ** 2 + (c[1] - door_cell_xy[1]) ** 2)):
        if all((c[0] - p[0]) ** 2 + (c[1] - p[1]) ** 2 > (N * 0.25) ** 2 for p in picked):
            picked.append(c)
        if len(picked) == 3:
            break
    pranks = [{"at": to_world(c), "room": 1} for c in picked]
print("CSINY", len(pranks), "helyen")

# His round: six points around the flat, walked as a circuit rather than in the
# order they were found, so he does not cross the whole place between two
# waypoints.
stops = spread(6, door_cell_xy, CANDY_CLEARANCE)
hx = sum(c[0] for c in stops) / len(stops)
hy = sum(c[1] for c in stops) / len(stops)
stops.sort(key=lambda c: math.atan2(c[1] - hy, c[0] - hx))
patrol = [to_world(c) for c in stops]
print("JARORUT", len(patrol), "pont")

# As far from the front door as he can get and still be standing in a room
# rather than wedged in a corner.
owner = max((c for c in walkable_cells if clearance[c[1]][c[0]] >= BODY + 2),
            key=lambda c: (c[0] - door_cell_xy[0]) ** 2 + (c[1] - door_cell_xy[1]) ** 2)

json.dump({
    "min": list(mn), "max": list(mx), "n": N, "cell": cell, "scale": SCALE,
    "porch": to_world((px, py)),
    "door": to_world(door_cell) if door_cell else None,
    "spawn": to_world(spawn_cell) if spawn_cell else None,
    "entryRoom": 1,
    "candy": candy,
    "pranks": pranks,
    "patrol": patrol,
    "homeowner": to_world(owner),
    "floorZ": floor_z, "wallTop": WALL_TOP,
    "headroom": [[None if r is None else round(r, 4) for r in row] for row in headroom],
    "floor": ["".join("1" if floor[j][i] else "0" for i in range(N)) for j in range(N)],
    "solid": ["".join("1" if solid[j][i] else "0" for i in range(N)) for j in range(N)],
    "rooms": ["".join(ROOM_CHARS[min(label[j][i], len(ROOM_CHARS) - 1)] for i in range(N)) for j in range(N)],
    "roomInfo": room_info,
    "height": [[None if h is None else round(h, 4) for h in row] for row in height],
}, open(out, "w"))
print("OK")
