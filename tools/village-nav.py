"""
Derive the drivable grid for the village from the BAKED mesh.

Everything the game needs to drive on this thing is measured here rather than
authored: the carriageway, what is solid, where the car starts, which house is
where. Measured from the baked mesh and not the 96 MB download, because the
collision the player feels has to match the geometry they can see — deriving
the grid from the original and shipping a simplified mesh is exactly how you
get a car that clips one wall and bounces off thin air at another.

The village turns out to be built in flat levels, which makes the read easy:

    -0.088   carriageway  <- what you are meant to drive on
    -0.083   pavement and lot aprons, one kerb above the road
    -0.06..  lawns, garden paths and kerbs: drivable, but not fast
    +0.9 m   anything standing taller than this stops the car

The carriageway is NOT taken as one connected component. It looked like it
should be — but the village's outer ring road is fenced off from the inner
streets by an unbroken pavement kerb, so a flood fill from the widest tarmac
cell finds the ring and nothing else. Connectivity here belongs to what is not
solid, and the carriageway is only the question "am I on the road or bumping
over someone's lawn".

Output is in VILLAGE units; the game applies its own scale.
"""
import bpy, sys, json, math, mathutils
from collections import deque, Counter

src, out = sys.argv[-2], sys.argv[-1]
N = 384
SCALE = 75.0          # village units → metres; must match VILLAGE_SCALE
# The carriageway level is MEASURED, not written down.
#
# It used to be -0.088, which is where the first village's streets happened to
# lie — and the moment a second village arrived, sitting a couple of
# millimetres higher, the road test matched nothing at all: zero road cells,
# and the script fell over on an empty max(). A number that describes one
# model must not be spelled into a tool that runs on any model.
#
# The streets are the largest flat thing in a village, so the most common
# sampled height IS the carriageway.
ROAD_Y = 0.0          # measured below, once the heights are in

# Both thresholds are stated in METRES and converted, because both are claims
# about the game and not about the file. Guessing them in village units is how
# the first pass ended up calling a 2 m fence drivable and a 20 cm patch of
# decimation noise a hole in the road.
ROAD_TOLERANCE = 0.30 / SCALE   # how far the tarmac may wander and still be tarmac
STEP_HEIGHT    = 0.90 / SCALE   # a kerb you bump over; anything taller stops you

ROAD_LO, ROAD_HI = ROAD_Y - ROAD_TOLERANCE, ROAD_Y + ROAD_TOLERANCE
SOLID_ABOVE = ROAD_Y + STEP_HEIGHT

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
dg = bpy.context.evaluated_depsgraph_get()
bpy.context.view_layer.update()

# A határok MINDEN mesh-re, nem csak az elsőre.
#
# Amíg a falu egyetlen összesütött objektum volt, a kettő ugyanaz volt. Amint
# a 16 ház külön példány lett, az `objects[0]` egy HÁZ lett — a mintavevő rács
# tehát egyetlen telket fedett le, a mért „útszint" pedig az alaplemez alja
# (-0,109) lett a burkolat (-0,066) helyett. A sugárvetés mindig is az egész
# jelenettel dolgozott; csak azt nem tudta, hova célozzon.
mn = mathutils.Vector((1e9,) * 3); mx = mathutils.Vector((-1e9,) * 3)
for obj in meshes:
    for c in obj.bound_box:
        w = obj.matrix_world @ mathutils.Vector(c)
        for i in range(3):
            mn[i] = min(mn[i], w[i]); mx[i] = max(mx[i], w[i])

top = mx.z + 1.0
height = [[None] * N for _ in range(N)]
for j in range(N):
    for i in range(N):
        x = mn.x + (mx.x - mn.x) * (i + 0.5) / N
        y = mn.y + (mx.y - mn.y) * (j + 0.5) / N
        hit, loc, nor, idx, o, m = bpy.context.scene.ray_cast(dg, (x, y, top), (0, 0, -1))
        height[j][i] = loc.z if hit else None

# Az úttest szintje MÉRT, nem beírt szám. Lásd fent a ROAD_Y-nál: a streets
# a falu legnagyobb sík felülete, tehát a leggyakrabban mintázott magasság AZ
# úttest. Az előző, beírt -0.088 az első falura illett, és a másodiknál
# egyetlen útcellát sem talált — a szkript egy üres max()-on hasalt el.
# AZ ÚTSZINT NEM TALÁLGATÁS.
#
# Eddig a leggyakoribb magasság volt — ami addig működött, amíg az aszfalt
# volt a térkép legnagyobb felülete. Amint a város peremére gyep került (a
# korong 54%-a), a „leggyakoribb magasság" a GYEP lett, és az igazi úttest
# kiesett a tűrésből: hetvenötezer úttest-cellából hatvanezer maradt, a
# lámpaoszlopok „az úton" álltak, és az útkeresés egyetlen utat sem talált.
#
# Az útszint viszont TERVEZŐI DÖNTÉS, nem megfigyelés: a térképgenerátor
# tudja, és meg is mondja. Mérésre csak ott van szükség, ahol nem tudjuk —
# letöltött modellnél.
_built = json.load(open('raw/houses/plots.json'))
if 'roadY' in _built:
    ROAD_Y = _built['roadY'] / SCALE
    print("UTSZINT (a terkeptol):", ROAD_Y)
else:
    ROAD_Y = Counter(round(h, 3) for row in height for h in row if h is not None).most_common(1)[0][0]
ROAD_LO, ROAD_HI = ROAD_Y - ROAD_TOLERANCE, ROAD_Y + ROAD_TOLERANCE
SOLID_ABOVE = ROAD_Y + STEP_HEIGHT
print("UTSZINT (mert):", ROAD_Y)

road  = [[h is not None and ROAD_LO < h < ROAD_HI for h in row] for row in height]

# --- ami a KOCSI ÚTJÁBAN van, nem ami fölötte ------------------------------
#
# A `height` a legfelső felület, felülről lelőtt sugárral. Tömörségnek EZT
# használni azt jelenti, hogy egy utca fölé lógó lombkorona fallá válik — az
# autó nekimegy a levegőnek, mert három méterrel a feje fölött van egy ág.
# A felhasználó pontosan ezt látta: járhatatlan utcákat, ahol szemre szabad
# az út.
#
# Ugyanez a hiba egyszer már megtörtént a lakásban: az ütközőket a felülnézeti
# magasságból építettük, és az ajtószemöldökök befalazták az ajtókat — 3359
# járható cella ragadt ütköződobozokba.
#
# A javítás ugyanaz: a sugarat nem a világ tetejéről lőjük, hanem az AUTÓ
# TETEJÉRŐL lefelé. Amit az a sugár talál, az az, aminek a kocsi tényleg
# nekimegy; ami fölötte van, azt átengedi.
CAR_TOP = 2.4 / SCALE
roof = ROAD_Y + CAR_TOP
blocked_h = [[None] * N for _ in range(N)]
for j in range(N):
    for i in range(N):
        x = mn.x + (mx.x - mn.x) * (i + 0.5) / N
        y = mn.y + (mx.y - mn.y) * (j + 0.5) / N
        hit, loc, nor, idx, o, m = bpy.context.scene.ray_cast(dg, (x, y, roof), (0, 0, -1))
        blocked_h[j][i] = loc.z if hit else None

solid = [[h is None or h > SOLID_ABOVE for h in row] for row in blocked_h]

overhead = sum(
    1
    for j in range(N) for i in range(N)
    if (height[j][i] is not None and height[j][i] > SOLID_ABOVE)
    and not solid[j][i]
)
print("ATJARHATO a lombkorona alatt:", overhead, "cella")

# --- close the pinholes in the carriageway ----------------------------------
# A height threshold samples a drain cover, a kerbstone, a paint line as "not
# road", leaving one- and two-cell holes scattered along otherwise solid
# tarmac. They are invisible on a map and vicious in play: the game asks "am I
# on the road" every frame, so a car driving straight over a one-cell hole gets
# a kerb rumble and a speed cut for one frame, and the screen shakes the whole
# length of the street. This is exactly the bug the old town shipped.
#
# The holes are not dots, they are thin STREAKS running across the road — a
# seam left by decimation, the lip of a drain, a painted line. A dot has four
# road neighbours and a streak has two, so a "surrounded by road" rule fills
# none of them; the rule has to be directional. A cell with tarmac on both
# sides along either axis is tarmac, whatever the sampled height says.
#
# This cannot widen a street: a cell off the edge of the road has tarmac on one
# side only. Two passes close a two-cell streak.
total = 0
for _ in range(4):
    filled = 0
    for j in range(1, N - 1):
        for i in range(1, N - 1):
            if road[j][i] or solid[j][i]:
                continue
            if (road[j][i - 1] and road[j][i + 1]) or (road[j - 1][i] and road[j + 1][i]):
                road[j][i] = True; filled += 1
    total += filled
    if not filled:
        break
print("BURKOLAT-LYUKAK betoltve:", total)

# --- clearance: how far is each cell from the nearest solid thing ------------
INF = 10 ** 9
clear = [[INF] * N for _ in range(N)]
q = deque()
for j in range(N):
    for i in range(N):
        if solid[j][i]:
            clear[j][i] = 0; q.append((i, j))
while q:
    i, j = q.popleft()
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, b = i + di, j + dj
        if 0 <= a < N and 0 <= b < N and clear[b][a] > clear[j][i] + 1:
            clear[b][a] = clear[j][i] + 1; q.append((a, b))

# Cellaméret TENGELYENKÉNT.
#
# Eddig egyetlen szám volt, az X kiterjedésből — ami pontosan addig volt
# helyes, amíg a falu négyzet alakú. Egy TÉGLALAP térképen a rács Z irányban
# megnyúlna: az ütközőfalak nem ott lennének, ahol látszanak. Ez ugyanaz a
# hibafajta, ami egyszer már a tükrözött Z-ráccsal megtörtént, és a lakásnál
# már meg is oldottuk (cellX/cellZ) — itt is az a minta.
cell_x = (mx.x - mn.x) / N
cell_z = (mx.y - mn.y) / N
# Ahol EGY szám kell (a kocsi testének sugara cellákban), ott a KISEBBIK a
# biztonságos: abból lesz több cella, tehát a lefedés nem marad hiányos.
cell = min(cell_x, cell_z)

# The car collides as three circles of CAR.bodyRadius along its spine, so half
# a car width is that radius. Everything below asks the same question with the
# same shape — a SQUARE of cells, matching probe-village.ts. It used to ask it
# with the distance transform's diamond, which is more permissive on the
# diagonal, and the difference put one house's kerb in a pocket the car could
# not actually drive into: the exporter called it reachable and the probe,
# rightly, did not.
CAR_PAD = max(1, int(math.ceil((1.02 / SCALE) / cell)))

def body_clear(i, j):
    for b in range(-CAR_PAD, CAR_PAD + 1):
        for a in range(-CAR_PAD, CAR_PAD + 1):
            p, r = i + a, j + b
            if not (0 <= p < N and 0 <= r < N) or solid[r][p]:
                return False
    return True

# --- what the car can actually reach ----------------------------------------
# Connectivity over open ground, not over tarmac. Seeded inside the village
# rather than out on the apron, so "reachable" means reachable from where the
# night starts.
mid = N // 2
seed = max(((i, j) for j in range(N) for i in range(N)
            if road[j][i] and body_clear(i, j)
            and N * 0.16 < i < N * 0.84 and N * 0.16 < j < N * 0.84),
           key=lambda p: (clear[p[1]][p[0]], -abs(p[0] - mid) - abs(p[1] - mid)))
net = [[False] * N for _ in range(N)]
st = [seed]; net[seed[1]][seed[0]] = True
while st:
    i, j = st.pop()
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, b = i + di, j + dj
        if 0 <= a < N and 0 <= b < N and not net[b][a] and body_clear(a, b):
            net[b][a] = True; st.append((a, b))

# --- where the car's whole body fits ----------------------------------------
# `net` is open ground; this is open ground the CAR can occupy, which is a
# smaller thing. It has to agree with probe-village.ts: half a car width is
# CAR.bodyRadius (1.02 m) at VILLAGE_SCALE (75), because the car collides as
# three circles of that radius along its spine.
# `net` is already the set of cells the car's whole body fits in AND can reach
# from the start, so this is just a clearer name for what the stops are chosen
# from.
drivable = net

# --- houses: the tall clusters ----------------------------------------------
# Ami ÉPÜLET, nem ami a talaj fölött van.
#
# A küszöb -0,02 volt: egy abszolút szám, ami csak azért működött, mert az
# addigi térképek útszintje -0,066 és -0,047 volt. Az épített térkép útszintje
# PONTOSAN 0, tehát a feltétel mindenhol teljesült, és a keresés egyetlen
# óriási fürtöt talált tizenhat ház helyett.
#
# Három méter az a magasság, ami a járdát, a telekburkolatot és a sövényt
# kizárja, a házakat és a fákat pedig nem: a magasságok lemért eloszlásában
# 2,5 és 5 méter között nincs semmi.
HOUSE_ABOVE = ROAD_Y + 3.0 / SCALE

# Mekkora alapterülettől ház egy magas folt.
#
# Beírt 120 cella volt, ami a négyszer négyes térkép cellaméretéhez tartozott.
# A kétszeres városban ugyanaz a rács kétszer nagyobb területet fed, tehát egy
# ház NEGYEDANNYI cellát foglal — és a négy háztípusból kettő (86 és 100
# cella) némán kiesett. Most a küszöb egy VALÓDI méretből jön: hat méternél
# kisebb alapterületű dolog nem ház.
MIN_HOUSE_M = 6.0
MIN_HOUSE_CELLS = max(12, int((MIN_HOUSE_M / (cell * SCALE)) ** 2))
tall = [[height[j][i] is not None and height[j][i] > HOUSE_ABOVE for i in range(N)] for j in range(N)]
seen = [[False] * N for _ in range(N)]
clusters = []
for j in range(N):
    for i in range(N):
        if tall[j][i] and not seen[j][i]:
            st = [(i, j)]; seen[j][i] = True; c = []
            while st:
                a, b = st.pop(); c.append((a, b))
                for da, db in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                    p, r = a + da, b + db
                    if 0 <= p < N and 0 <= r < N and tall[r][p] and not seen[r][p]:
                        seen[r][p] = True; st.append((p, r))
            if len(c) >= MIN_HOUSE_CELLS:
                clusters.append(c)
# A járható úttest egyszer számolódik ki, nem házanként: hatvannégy háznál a
# házankénti újraszámolás önmagában hatszázmillió cellavizsgálat lenne.
on_road = [(i, j) for j in range(N) for i in range(N) if drivable[j][i] and road[j][i]]
if not on_road:
    on_road = [(i, j) for j in range(N) for i in range(N) if drivable[j][i]]

# HÁZ CSAK TELKEN LEHET.
#
# A magasságküszöb (3 m) a járdát és a sövényt zárja ki — a FÁKAT nem. Amikor
# a város peremére erdő és temető került, a rendszer 64 helyett 125 „házat"
# talált, és a navigátor elküldhetett volna egy fához.
#
# A telkek helye nem mérés kérdése: a térképgenerátor írja ki. Egy fürt akkor
# ház, ha a KÖZEPE egy telekre esik.
_plots = json.load(open('raw/houses/plots.json')).get('plots', [])
_lots = [(p['centre'][0], -p['centre'][1], p['size'][0], p['size'][1]) for p in _plots]

def _plot_of(cx, cy):
    """Melyik TELEKRE esik ez a fürt közepe — vagy None."""
    wx = mn.x + (mx.x - mn.x) * (cx + 0.5) / N
    wy = mn.y + (mx.y - mn.y) * (cy + 0.5) / N
    for k, (px, py, sx, sy) in enumerate(_lots):
        if abs(wx - px) <= sx * 0.55 and abs(wy - py) <= sy * 0.55:
            return k
    return None

# EGY TELEK = EGY HÁZ. Enélkül a telek szélére benyúló fa külön házként
# jelent meg, és hatvannégy helyett hatvanhét lett.
_taken = set()

clusters.sort(key=len, reverse=True)
houses = []
# NINCS felső korlát. Itt egy beírt 16 állt — a négyszer négyes térkép
# telkeinek száma —, és amikor a város nyolcszor nyolcasra nőtt, a mérés
# némán eldobta a házak háromnegyedét: hatvannégy telek állt kint,
# tizenhatról tudott a játék. Pont az a fajta szám, ami túléli azt, amiért
# beírták.
for c in clusters:
    cx = sum(p[0] for p in c) / len(c)
    cy = sum(p[1] for p in c) / len(c)
    lot = _plot_of(cx, cy)
    if lot is None or lot in _taken:
        continue
    _taken.add(lot)
    peak = max(height[p[1]][p[0]] for p in c)
    # The kerb outside the front door: the closest cell the CAR can actually
    # stand on. Taking the nearest tarmac instead put one house's stop in a
    # back courtyard that the jeep cannot reach — a stop point you cannot drive
    # to is not a stop point, and the probe caught it.
    # A megállási pont az ÚTTESTEN van, nem csak ott, ahol a kocsi elfér.
    #
    # Amíg a telkeket sövény kerítette, a kettő ugyanaz volt: a füvre nem
    # lehetett behajtani. Az épített térképen a telekburkolat alacsony, tehát
    # járható — és a legközelebbi járható cella a ház előtti GYEP lett volna,
    # nem az utca. A narancsszínű parkolóhely oda került volna.
    best = min(on_road, key=lambda p: (p[0] - cx) ** 2 + (p[1] - cy) ** 2)
    houses.append({
        "centre": [mn.x + (mx.x - mn.x) * (cx + 0.5) / N, mn.y + (mx.y - mn.y) * (cy + 0.5) / N],
        "stop":   [mn.x + (mx.x - mn.x) * (best[0] + 0.5) / N, mn.y + (mx.y - mn.y) * (best[1] + 0.5) / N],
        "footprint": len(c) * cell * cell,
        "peak": peak,
    })

# The widest circle that can travel the INNER streets — the number the car has
# to be sized against. The outer apron is open ground and would report a
# meaningless 0.46.
inner = [clear[j][i] for j in range(N) for i in range(N)
         if net[j][i] and N * 0.16 < i < N * 0.84 and N * 0.16 < j < N * 0.84]
widest = max(inner)
inner.sort()
median = inner[len(inner) // 2]
json.dump({
    "min": [mn.x, mn.y, mn.z], "max": [mx.x, mx.y, mx.z],
    "cellX": cell_x, "cellZ": cell_z,
    "n": N, "cell": cell,
    "groundY": (ROAD_LO + ROAD_HI) / 2,
    "widestHalfWidth": widest * cell,
    "medianHalfWidth": median * cell,
        "road":     ["".join("1" if road[j][i] else "0" for i in range(N)) for j in range(N)],
    "reachable":["".join("1" if net[j][i] else "0" for i in range(N)) for j in range(N)],
    "solid": ["".join("1" if solid[j][i] else "0" for i in range(N)) for j in range(N)],
    "height": [[None if h is None else round(h, 4) for h in row] for row in height],
    "start":  [mn.x + (mx.x - mn.x) * (seed[0] + 0.5) / N, mn.y + (mx.y - mn.y) * (seed[1] + 0.5) / N],
    # A lámpás kereszteződések a TÉRKÉPGENERÁTORTÓL jönnek, nem mérésből: a
    # kereszteződés nem megfigyelt jelenség, hanem tervezői döntés. Itt csak
    # átutaznak, hogy a játéknak egyetlen falu-adatfájlja legyen.
    "lights": _built.get('lights', []),
    # A KÖRPÁLYA helye, ahogy a térképgenerátor megadta. A szörnyecskék a
    # város utcáin kelnek át; egy autópályán gyalogoló szörny nem nehezítés,
    # hanem hiba.
    "ring": _built.get('ring'),
    "houses": houses,
}, open(out, "w"))

print("ELERHETO cellak:", sum(sum(r) for r in net), "| uttest cellak:", sum(sum(r) for r in road))
print("BELSO felszelesseg: median", round(median * cell, 5), "max", round(widest * cell, 5), "unit")
print("HAZAK:", len(houses), "| autoval jarhato cellak:", sum(sum(r) for r in drivable))
