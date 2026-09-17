# A falu térképe, építve — nem generálva.
#
#   blender -b --python tools/make-map.py -- <ki.glb>
#
# Miért nem AI-modell: ez az egyetlen eszköz a projektben, ami nem művészet,
# hanem geometria — egy úthálózat és tizenhat téglalap. Három generálási kör
# után egyik sem adott 4x4-et: blokkonként kettő-négy telek jött, szabálytalan
# formákkal, peremes tálcákként. Építve viszont PONTOS, és ami fontosabb:
#
#   · a sáv szélességét az AUTÓHOZ méretezem, nem utólag megmérem és
#     reménykedem, hogy elfér;
#   · a telkek helye ISMERT, nem keresni kell — a szkript kiírja;
#   · nincs egyetlen fölösleges elem sem, tehát nincs mibe beleszorulni;
#   · a textúra CSEMPÉZETT, tehát a texel-sűrűség nem függ a falu méretétől.
#     A letöltött térkép 7 cm/texelt adott (ezért látszott festménynek);
#     ez 0,8 cm/texelt ad, ötven kilobájtból.
#
# Minden méterben van, és a végén osztódik VILLAGE_SCALE-lel — a játék úgy
# számol, ahogy eddig.
import bpy, bmesh, sys, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
out_path = argv[0]

# --- méretek, méterben -------------------------------------------------------
VILLAGE_SCALE = 75.0

# HÁNY TELEK egy sorban. Ez az EGYETLEN szám, ami a város méretét adja —
# minden más (a korong sugara, a záróvonalak, a telkek helye) ebből számol.
# Korábban a négyes több helyen be volt írva kézzel (1.5 * PITCH, range(4),
# range(5), k - 2), és egy ilyen szám mindig ott marad, ahol elfelejtik.
GRID = 8

PLOT_X, PLOT_Z = 24.0, 20.0
PAVEMENT = 2.5          # járda a telek körül
STREET = 11.0           # úttest szélessége
#
# Az AUTÓHOZ méretezve: a kocsi három 1,02 méteres körrel ütközik, tehát 2,04
# méter széles. Tizenegy méteres úttesten a sáv félszélessége 5,5 méter — a
# régi, jól vezethető térképen 5,95 volt, a rosszul vezethetőn 3,35.
# A JÁRDASZEGÉLY MAGASSÁGA — és ez nem esztétikai szám.
#
# Tizenöt centi volt, ami valósághű, de MÉRHETETLEN: a navigáció úttest-tűrése
# harminc centi (annyi hullámzást enged meg az aszfaltnak, hogy még aszfalt
# legyen), tehát a járda beleesett a tűrésbe, és a rács ÚTTESTNEK sorolta.
# Következmény: a járdára hajtás nem járt semmivel — se rázás, se lassulás —,
# és a jelzőlámpák oszlopai is „az úttesten" álltak a mérés szerint.
#
# Harmincöt centi magas szegély a valóságban sok, de a kettő közül ez a
# kisebb hazugság: a küszöb alatt marad, amit az autó még átbukdácsol (90 cm),
# és a rács végre meg tudja különböztetni a járdát az úttól.
KERB_H = 0.35
PLOT_H = 0.45
DRIVE_W = 6.0
MARGIN = 3.0
TILE = 4.0              # ennyi méterenként ismétlődik a textúra

PITCH_X = PLOT_X + 2 * PAVEMENT + STREET
PITCH_Z = PLOT_Z + 2 * PAVEMENT + STREET
HALF_X = (GRID - 1) / 2 * PITCH_X + PLOT_X / 2 + PAVEMENT + STREET + MARGIN
HALF_Z = (GRID - 1) / 2 * PITCH_Z + PLOT_Z / 2 + PAVEMENT + STREET + MARGIN

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- anyagok -----------------------------------------------------------------
def material(name, image):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.95
    bsdf.inputs['Metallic'].default_value = 0.0
    if image:
        tex = mat.node_tree.nodes.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(image)
        tex.extension = 'REPEAT'
        mat.node_tree.links.new(bsdf.inputs['Base Color'], tex.outputs['Color'])
    return mat

MATS = {
    'asphalt': material('asphalt', 'raw/tiles/asphalt.webp'),
    'pavement': material('pavement', 'raw/tiles/pavement.webp'),
    'plot': material('plot', 'raw/tiles/plot.webp'),
    'kerb': material('kerb', 'raw/tiles/kerb.webp'),
}
def flat(name, rgb, emit=0.0):
    mat = material(name, None)
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*rgb, 1)
    if emit:
        bsdf.inputs['Emission Color'].default_value = (*rgb, 1)
        bsdf.inputs['Emission Strength'].default_value = emit
    return mat

MATS['line'] = flat('line', (0.82, 0.80, 0.74))
MATS['pumpkin'] = flat('pumpkin', (0.86, 0.36, 0.08))
MATS['stalk'] = flat('stalk', (0.22, 0.30, 0.14))
MATS['stone'] = flat('stone', (0.40, 0.39, 0.44))
# A mécses IZZIK: a falu egyetlen meleg pontja a telken, és a `glow` anyagot a
# játék oldalán a fényfüzér is ebből ismeri fel.
MATS['glow'] = flat('glow', (1.0, 0.62, 0.18), emit=3.0)
MATS['grass'] = flat('grass', (0.14, 0.19, 0.13))
MATS['bark'] = flat('bark', (0.20, 0.15, 0.12))
MATS['leaf'] = flat('leaf', (0.13, 0.22, 0.15))
MATS['fence'] = flat('fence', (0.26, 0.22, 0.20))

ORDER = list(MATS.keys())

mesh = bpy.data.meshes.new('village')
obj = bpy.data.objects.new('village', mesh)
bpy.context.collection.objects.link(obj)
for key in ORDER:
    obj.data.materials.append(MATS[key])

bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new()

def box(x0, x1, y0, y1, z0, z1, mat):
    """Doboz, világlépték szerinti UV-vel.

    Az UV a VILÁGKOORDINÁTÁBÓL jön, nem a doboz méretéből: így minden felület
    ugyanakkora szemcsét kap, függetlenül attól, mekkora darab. Egy dobozonként
    0..1-re feszített UV pont ezt rontaná el — a nagy úttesten elmosódna, a
    kis szegélyen összesűrűsödne.
    """
    index = ORDER.index(mat)
    corners = [
        ((x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)),   # alja
        ((x0, y1, z0), (x0, y1, z1), (x1, y1, z1), (x1, y1, z0)),   # teteje
        ((x0, y0, z0), (x0, y1, z0), (x1, y1, z0), (x1, y0, z0)),
        ((x1, y0, z1), (x1, y1, z1), (x0, y1, z1), (x0, y0, z1)),
        ((x0, y0, z1), (x0, y1, z1), (x0, y1, z0), (x0, y0, z0)),
        ((x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)),
    ]
    for quad in corners:
        # (x, magasság, terv-z) -> Blender (x, terv-z, magasság).
        #
        # Blenderben a Z a függőleges, nem az Y. Elsőre az Y-t használtam
        # magasságnak, és a térkép az oldalára épült: a render az alaplemez
        # aljára nézett, mert a „fent" vízszintessé vált. A glTF export
        # ráadásul tovább forgat, tehát a hiba a játékban is megmaradt volna.
        verts = [bm.verts.new((p[0], p[2], p[1])) for p in quad]
        face = bm.faces.new(verts)
        face.material_index = index
        face.normal_update()
        n = face.normal
        # A két legkisebb normálkomponensű tengely adja az UV-t.
        if abs(n.z) >= abs(n.x) and abs(n.z) >= abs(n.y):
            pick = lambda v: (v.co.x, v.co.y)     # vízszintes lap
        elif abs(n.x) >= abs(n.y):
            pick = lambda v: (v.co.y, v.co.z)
        else:
            pick = lambda v: (v.co.x, v.co.z)
        for loop in face.loops:
            u, v = pick(loop.vert)
            loop[uv_layer].uv = (u / TILE, v / TILE)

# --- alap: KÖR, nem téglalap -------------------------------------------------
#
# Az üvegbura kör alakú, az alap viszont téglalap volt — és a kettő sehogy sem
# fér össze. Lemérve: a téglalap rövidebb oldalába írt kör az UTAK 34
# százalékát vágta volna le (a körgyűrű nagy részét), a körülírt kör pedig
# huszonegy méterrel a burkolat szélén kívülre került, és a kocsi a semmibe
# hajtott — a felhasználó pontosan ezt látta: fekete üresség, fölötte az üveg
# rézpereme.
#
# Ha az alap maga kör, a kérdés megszűnik: az üveg a TALPÁN áll, a pálya széle
# és az üveg ugyanaz a vonal, és nincs se levágott út, se üres semmi.
# A KÖRPÁLYA HELYE.
#
# A korong eddig épp a beépített terület köré ért: a sarok 223-nál, az üveg
# 224-nél. Oda körpálya nem fért — egy kör a téglalap sarkába szalad.
#
# Ezért az üveg KIJJEBB kerül. Nem „nagyobb térkép" — a város ugyanakkora
# marad; ami nő, az pont az a gyűrű, ahova a pálya kerül. Előtte ugyanez a
# terület üres aszfalt volt, aztán erdő; most autópálya.
RING_SPACE = 52.0
RADIUS = math.hypot(HALF_X, HALF_Z) - MARGIN + RING_SPACE

def disc(radius, y0, y1, mat, segments=96):
    index = ORDER.index(mat)
    ring = [(math.cos(2 * math.pi * k / segments) * radius,
             math.sin(2 * math.pi * k / segments) * radius) for k in range(segments)]
    top = [bm.verts.new((x, z, y1)) for (x, z) in ring]
    bottom = [bm.verts.new((x, z, y0)) for (x, z) in ring]
    for verts, flip in ((top, False), (bottom, True)):
        face = bm.faces.new(verts[::-1] if flip else verts)
        face.material_index = index
        for loop in face.loops:
            loop[uv_layer].uv = (loop.vert.co.x / TILE, loop.vert.co.y / TILE)
    for k in range(segments):
        n = (k + 1) % segments
        face = bm.faces.new([bottom[k], bottom[n], top[n], top[k]])
        face.material_index = index
        for loop in face.loops:
            loop[uv_layer].uv = (
                math.hypot(loop.vert.co.x, loop.vert.co.y) * 0 + (k / segments) * radius * 2 / TILE,
                loop.vert.co.z / TILE,
            )

disc(RADIUS, -1.0, 0.0, 'asphalt')

plots = []
for row in range(GRID):
    for col in range(GRID):
        cx = (col - (GRID - 1) / 2) * PITCH_X
        cz = (row - (GRID - 1) / 2) * PITCH_Z
        px0, px1 = cx - PLOT_X / 2, cx + PLOT_X / 2
        pz0, pz1 = cz - PLOT_Z / 2, cz + PLOT_Z / 2

        # járda a telek körül
        box(px0 - PAVEMENT, px1 + PAVEMENT, 0.0, KERB_H, pz0 - PAVEMENT, pz1 + PAVEMENT, 'kerb')
        box(px0 - PAVEMENT + 0.12, px1 + PAVEMENT - 0.12, 0.0, KERB_H + 0.005,
            pz0 - PAVEMENT + 0.12, pz1 + PAVEMENT - 0.12, 'pavement')

        # a telek maga: sík lap, perem nélkül
        box(px0, px1, 0.0, PLOT_H, pz0, pz1, 'plot')

        # kapubejáró: a páros sorok az egyik utcára néznek, a páratlanok a
        # másikra. Nem díszítés — így nem mind a tizenhat ház néz ugyanarra.
        front = -1 if row % 2 == 0 else 1
        dz0 = (pz0 - PAVEMENT) if front < 0 else pz1
        dz1 = pz0 if front < 0 else (pz1 + PAVEMENT)
        box(cx - DRIVE_W / 2, cx + DRIVE_W / 2, 0.0, KERB_H * 0.6, dz0, dz1, 'pavement')

        stop_z = (pz0 - PAVEMENT - STREET / 2) if front < 0 else (pz1 + PAVEMENT + STREET / 2)
        plots.append({
            'row': row, 'col': col,
            'centre': [cx / VILLAGE_SCALE, -cz / VILLAGE_SCALE],
            'size': [PLOT_X / VILLAGE_SCALE, PLOT_Z / VILLAGE_SCALE],
            'stop': [cx / VILLAGE_SCALE, -stop_z / VILLAGE_SCALE],
        })

# --- díszítés ----------------------------------------------------------------
#
# Minden dísz a TELKEN vagy a JÁRDÁN áll, soha nem az úttesten. Ezt nem
# utólag ellenőrzöm: a telek és a járda határait ez a szkript maga rajzolta,
# tehát a helyük levezetett, nem mért. Ami az úttestre kerülhetne, azt meg sem
# születik.
#
# A méretek szándékosan kicsik: minden dísz a kocsi tetejénél (2,4 m) jóval
# alacsonyabb, tehát a `soft` listába kerül és át lehet hajtani rajta. Egy
# tök, ami megállít egy szörnyekkel teli terepjárót, nem hangulat, hanem
# bosszúság.

def pumpkin(cx, cz, y, r):
    """Tök: egy lapított doboz-torony. Nem gömb, mert a falu alacsony
    poligonszámú, és egy sima hasáb-rakás ugyanazt a sziluettet adja
    tizedannyi lapból."""
    box(cx - r, cx + r, y, y + r * 1.15, cz - r * 0.82, cz + r * 0.82, 'pumpkin')
    box(cx - r * 0.82, cx + r * 0.82, y, y + r * 1.25, cz - r, cz + r, 'pumpkin')
    box(cx - r * 0.12, cx + r * 0.12, y + r * 1.2, y + r * 1.75, cz - r * 0.12, cz + r * 0.12, 'stalk')

def gravestone(cx, cz, y, w, h):
    box(cx - w, cx + w, y, y + h, cz - w * 0.28, cz + w * 0.28, 'stone')
    box(cx - w * 1.25, cx + w * 1.25, y, y + h * 0.12, cz - w * 0.5, cz + w * 0.5, 'stone')

def lantern(cx, cz, y, h):
    """Kerti mécses: vékony oszlop, tetején izzó doboz."""
    box(cx - 0.09, cx + 0.09, y, y + h, cz - 0.09, cz + 0.09, 'stone')
    box(cx - 0.26, cx + 0.26, y + h, y + h + 0.5, cz - 0.26, cz + 0.26, 'glow')

for k, p in enumerate(plots):
    cx = p['centre'][0] * VILLAGE_SCALE
    cz = -p['centre'][1] * VILLAGE_SCALE
    px0, px1 = cx - PLOT_X / 2, cx + PLOT_X / 2
    pz0, pz1 = cz - PLOT_Z / 2, cz + PLOT_Z / 2
    front = -1 if p['row'] % 2 == 0 else 1
    edge = pz0 if front < 0 else pz1
    inward = 1 if front < 0 else -1

    # Tökök a kapubejáró két oldalán, a telek szélén — ahol egy igazi házon is
    # állnának, és ahol a kocsi útjából a legtávolabb vannak.
    for side in (-1, 1):
        for n in range(3):
            tx = cx + side * (DRIVE_W / 2 + 0.9 + n * 1.5)
            if abs(tx - cx) > PLOT_X / 2 - 0.8:
                continue
            r = 0.55 + ((k * 7 + n * 3 + side) % 5) * 0.09
            pumpkin(tx, edge + inward * (0.9 + (n % 2) * 0.5), PLOT_H, r)

    # Sírkövek a telek hátsó felében. Csak minden második telken, hogy ne
    # legyen mind a tizenhat ház temető.
    if k % 2 == 0:
        back = pz1 if front < 0 else pz0
        for n in range(3):
            gx = cx + (n - 1) * 3.4
            gravestone(gx, back - inward * (2.2 + (n % 2) * 1.4), PLOT_H, 0.7, 1.7 + (n % 3) * 0.35)

    # Két mécses a bejárónál. Ezek adják az egyetlen meleg fényt a telken.
    for side in (-1, 1):
        lantern(cx + side * (DRIVE_W / 2 + 0.45), edge + inward * 0.35, PLOT_H, 1.1)

# --- szaggatott középvonal ---------------------------------------------------
DASH, GAP, W = 2.4, 2.4, 0.22
def dashes(along_x, fixed, lo, hi):
    t = lo
    while t < hi - DASH:
        if along_x:
            box(t, t + DASH, 0.0, 0.012, fixed - W / 2, fixed + W / 2, 'line')
        else:
            box(fixed - W / 2, fixed + W / 2, 0.0, 0.012, t, t + DASH, 'line')
        t += DASH + GAP

for k in range(GRID + 1):
    line_x = (k - GRID / 2) * PITCH_X
    line_z = (k - GRID / 2) * PITCH_Z
    dashes(False, line_x, -HALF_Z + MARGIN, HALF_Z - MARGIN)
    dashes(True, line_z, -HALF_X + MARGIN, HALF_X - MARGIN)

# --- jelzőlámpás kereszteződések és zebrák -----------------------------------
#
# NEM MINDEN kereszteződés kap lámpát. Kilenc sávból kilenc sáv nyolcvanegy
# találkozást ad, és nyolcvanegy lámpa nem szabály, hanem adó — minden
# második saroknál állnál. Minden harmadik vonal kap lámpát: kilenc
# kereszteződés a városban, elég ahhoz, hogy számítson, kevés ahhoz, hogy
# megöljön egy menetet.
#
# A zebra ugyanoda kerül, és ez szándékos: a fehér csíkok MESSZIRŐL
# elárulják, hogy lámpa jön. Így a szabály nem csapda — látod, mielőtt
# odaérnél.
# MINDEN MÁSODIK belső vonal kap lámpát.
#
# Először minden harmadik volt — kilenc lámpa, egymástól százhúsz egységre egy
# négyszázötven egység széles városban —, és a köztük lévő egész belső rész
# üresen maradt. Most tizenhat kereszteződés, nyolcvan egységenként: elég
# sűrű ahhoz, hogy egy menet közben többször is számítson, elég ritka ahhoz,
# hogy ne minden sarkon állj meg.
MAIN = [k for k in range(GRID + 1) if k % 2 == 1]
HALF = STREET / 2                 # a kereszteződés doboza
ZEBRA_IN, ZEBRA_OUT = HALF + 0.6, HALF + 3.6
STRIPE, STRIPE_GAP = 0.62, 0.62

lights = []
for a in MAIN:
    for b in MAIN:
        ix = (a - GRID / 2) * PITCH_X
        iz = (b - GRID / 2) * PITCH_Z
        # A város szélén álló lámpa fél kereszteződést őrizne: csak ott, ahol
        # mind a négy ág létezik.
        if abs(ix) > HALF_X - PITCH_X or abs(iz) > HALF_Z - PITCH_Z:
            continue
        lights.append({
            'centre': [ix / VILLAGE_SCALE, -iz / VILLAGE_SCALE],
            'half': HALF / VILLAGE_SCALE,
            'stop': ZEBRA_OUT / VILLAGE_SCALE,
        })

        # Négy zebra, egy-egy ágra. A csíkok a HALADÁS IRÁNYÁVAL
        # párhuzamosak — ahogy a valóságban is —, és a teljes úttestet
        # átérik, mert egy fél zebra nem átkelőhely.
        for side in (-1, 1):
            # Az X irányú ágakon: a csík hosszú X-ben, keskeny Z-ben.
            lo, hi = ix + side * ZEBRA_IN, ix + side * ZEBRA_OUT
            t = iz - HALF
            while t < iz + HALF - STRIPE:
                box(min(lo, hi), max(lo, hi), 0.0, 0.014, t, t + STRIPE, 'line')
                t += STRIPE + STRIPE_GAP
            # A Z irányú ágakon fordítva.
            lo, hi = iz + side * ZEBRA_IN, iz + side * ZEBRA_OUT
            t = ix - HALF
            while t < ix + HALF - STRIPE:
                box(t, t + STRIPE, 0.0, 0.014, min(lo, hi), max(lo, hi), 'line')
                t += STRIPE + STRIPE_GAP

# --- A VÁROS PEREME ---------------------------------------------------------
#
# A korong sugara 224, az utolsó telek széle 152 — vagyis a térkép
# ÖTVENNÉGY SZÁZALÉKA egy hetvenkét egység széles, teljesen üres aszfaltgyűrű
# volt. Nem margó: több, mint amennyi a városra jut.
#
# Ami ide kerül, az nem város, hanem AMI A VÁROSON KÍVÜL VAN: gaz, korhadt
# fák, egy elhanyagolt temető, és a legszélén kerítés. Nem díszlet a
# díszletért — a pereme innentől HELY lesz, nem a pálya vége.
#
# Az utak érintetlenek maradnak: minden ide szórt dolog az utolsó körút
# KÜLSŐ oldalán van, és a rácson kívülre esik.
import random as _rnd
_rnd.seed(20261017)

# A GYEP MAGASSÁGA — és ez nem esztétika.
#
# Egy centire tettem az aszfalt fölé, és a navigáció úttestnek sorolta (a
# tűrése harminc centi). Onnantól a rászórt fák „az úton álltak", és a mérés
# jogosan bukott: négy és fél százaléknyi úttest-cellába került geometria.
#
# Ugyanaz a szám, mint a járdaszegélynél: a tűrés fölött, de a küszöb alatt,
# amit az autó még átbukdácsol.
GRASS_Y = 0.35

# A BEÉPÍTETT TERÜLET: eddig tart a város, és ezen KÍVÜL van a peremvidék.
#
# Külön X és Z, mert a telekosztás sem négyzetes (40 × 36). Először egyetlen
# körgyűrűt raktam ide, a város viszont TÉGLALAP: a körív a sarkokban
# ötvennégy egységgel BELESZALADT a telkekbe, és a fák a házakra lógtak.
#
# A peremvidék tehát nem gyűrű, hanem KORONG MÍNUSZ TÉGLALAP.
BUILT_X = (GRID - 1) / 2 * PITCH_X + PLOT_X / 2 + PAVEMENT + STREET
BUILT_Z = (GRID - 1) / 2 * PITCH_Z + PLOT_Z / 2 + PAVEMENT + STREET
EDGE_OUT = RADIUS - 4.0
# A beépített terület LEGTÁVOLABBI pontja: a sarok. A körpálya ezen kívül fut,
# különben ugyanabba a hibába esnénk, mint az erdővel — a kör a téglalap
# sarkaiba szaladt.
BUILT_MAX = math.hypot(BUILT_X, BUILT_Z)

def outside_town(cx, cz, pad=0.0):
    """A városon kívül van-e — és elég messze a szélétől."""
    if abs(cx) < BUILT_X + pad and abs(cz) < BUILT_Z + pad:
        return False
    return math.hypot(cx, cz) < EDGE_OUT - pad

def tree(cx, cz, y, h):
    """Korhadt fa: törzs és két elforgatott lombdoboz. Alacsony poligonszámú,
    mint minden más ezen a térképen — a sziluett számít, nem a levelek."""
    box(cx - 0.4, cx + 0.4, y, y + h, cz - 0.4, cz + 0.4, 'bark')
    box(cx - 2.2, cx + 2.2, y + h * 0.62, y + h * 0.95, cz - 1.5, cz + 1.5, 'leaf')
    box(cx - 1.5, cx + 1.5, y + h * 0.78, y + h * 1.12, cz - 2.2, cz + 2.2, 'leaf')

# BEKÖTŐUTAK: a városból ki a körpályára.
#
# Egy körpálya, amire nem lehet ráhajtani, csak egy kör a horizonton. A
# bekötők a VÁROS MEGLÉVŐ UTCÁIT viszik tovább — nem új nyomvonal, hanem
# ugyanannak a rácsnak a folytatása, tehát a rajta érkező már a helyes
# sávban van, amikor kiér.
#
# Minden második utcavonal kap egyet, ugyanaz a készlet, mint a lámpáké:
# négy kelet-nyugati és négy észak-déli irányban, oda-vissza.
SPOKE_W = STREET

def _spoke_lines():
    """A kifutó utcák tengelyei: (X mentén futók, Z mentén futók)."""
    xs = [(k - GRID / 2) * PITCH_X for k in range(GRID + 1) if k % 2 == 1]
    zs = [(k - GRID / 2) * PITCH_Z for k in range(GRID + 1) if k % 2 == 1]
    return xs, zs

def on_spoke(cx, cz):
    """Bekötőútra esik-e ez a pont."""
    xs, zs = _spoke_lines()
    for x in xs:
        if abs(cx - x) <= SPOKE_W / 2 + 0.5 and abs(cz) > BUILT_Z - 1:
            return True
    for z in zs:
        if abs(cz - z) <= SPOKE_W / 2 + 0.5 and abs(cx) > BUILT_X - 1:
            return True
    return False

# A KÖRPÁLYA: autópálya a város körül.
#
# Itt előbb temető és erdő volt, és az rossz döntés volt: a peremvidék
# ötvennégy százaléka a térképnek, tehát nem díszletet kellett bele tenni,
# hanem HASZNÁLATOT. Egy fákkal teleszórt gyűrűben az autó megáll; egy
# körpályán száguld.
#
# Széles, szabad aszfalt, terelővonalakkal — az egyetlen hely a térképen,
# ahol a százhúsz km/h-t tényleg ki lehet hajtani.
LANES = 3
RING_W = LANES * 7.5                       # három sáv, egyenként 7,5 méter
RING_MID = (BUILT_MAX + EDGE_OUT) / 2      # a beépített terület és az üveg közt
RING_IN = RING_MID - RING_W / 2
RING_OUT = RING_MID + RING_W / 2

_seg = 200
for k in range(_seg):
    a0 = k / _seg * math.tau
    a1 = (k + 1) / _seg * math.tau
    for r0, r1, mat, y in ((RING_IN, RING_OUT, 'asphalt', 0.02),):
        v = [bm.verts.new(p) for p in (
            (math.cos(a0) * r0, math.sin(a0) * r0, y),
            (math.cos(a1) * r0, math.sin(a1) * r0, y),
            (math.cos(a1) * r1, math.sin(a1) * r1, y),
            (math.cos(a0) * r1, math.sin(a0) * r1, y),
        )]
        f = bm.faces.new(v)
        f.material_index = ORDER.index(mat)
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co.x / TILE, loop.vert.co.y / TILE)

# Sávelválasztó szaggatott vonalak, és tömör vonal a két szélén.
for lane in range(LANES + 1):
    r = RING_IN + lane * (RING_W / LANES)
    solid = lane in (0, LANES)
    steps = 360 if solid else 180
    for k in range(steps):
        if not solid and k % 2 == 1:
            continue                              # szaggatott
        a0 = k / steps * math.tau
        a1 = (k + 1) / steps * math.tau
        v = [bm.verts.new(p) for p in (
            (math.cos(a0) * (r - 0.11), math.sin(a0) * (r - 0.11), 0.032),
            (math.cos(a1) * (r - 0.11), math.sin(a1) * (r - 0.11), 0.032),
            (math.cos(a1) * (r + 0.11), math.sin(a1) * (r + 0.11), 0.032),
            (math.cos(a0) * (r + 0.11), math.sin(a0) * (r + 0.11), 0.032),
        )]
        f = bm.faces.new(v)
        f.material_index = ORDER.index('line')
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co.x / TILE, loop.vert.co.y / TILE)

# GYEP MINDENHOL, ahol nincs se város, se pálya.
#
# Egyetlen körgyűrűt raktam ide először, a városon kívüli terület viszont nem
# gyűrű: a város TÉGLALAP, a korong meg KÖR, tehát a sarkoknál hatalmas
# üres mezők maradtak — a képernyőn egy nagy, lila, semmis síkság. Ezért
# cellánként döntünk: ami se a városé, se a pályáé, az gyep.
CELL = 7.0
_n = int(EDGE_OUT / CELL) + 1
for gz in range(-_n, _n):
    for gx in range(-_n, _n):
        x0, x1 = gx * CELL, (gx + 1) * CELL
        z0, z1 = gz * CELL, (gz + 1) * CELL
        # MIND A NÉGY SARKOT nézzük, nem csak a közepét.
        #
        # Először csak a cella közepe döntött, és egy hét egység széles
        # négyzet fele így átlóghatott az aszfaltra: a gyep fogazott széllel
        # ráfeküdt a körpályára. Ami a cella BÁRMELYIK sarkával belóg, az
        # kimarad — a maradék hézagot pedig a kört pontosan követő szalagok
        # töltik ki lentebb.
        corners = ((x0, z0), (x1, z0), (x1, z1), (x0, z1), ((x0 + x1) / 2, (z0 + z1) / 2))
        if any(not outside_town(a, b) for a, b in corners):
            continue
        if any(RING_IN - 1 < math.hypot(a, b) < RING_OUT + 1 for a, b in corners):
            continue
        if any(on_spoke(a, b) for a, b in corners):
            continue
        v = [bm.verts.new((a, b, GRASS_Y)) for a, b in ((x0, z0), (x1, z0), (x1, z1), (x0, z1))]
        f = bm.faces.new(v)
        f.material_index = ORDER.index('grass')
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co.x / TILE, loop.vert.co.y / TILE)

# A PÁLYA SZÉLÉT KÖVETŐ GYEPSZALAGOK.
#
# A négyzetháló szükségszerűen hézagot hagy a kör mentén — a cellák nem
# tudják követni az ívet. Ez a két szalag pontosan a pálya széléhez simul,
# kétszáz szegmensből, tehát a zöld és az aszfalt között nincs se rés, se
# átfedés.
for inner, outer in ((RING_IN - 9, RING_IN), (RING_OUT, RING_OUT + 9)):
    for k in range(240):
        a0 = k / 240 * math.tau
        a1 = (k + 1) / 240 * math.tau
        mid_a = (a0 + a1) / 2
        mid_r = (inner + outer) / 2
        if not outside_town(math.cos(mid_a) * mid_r, math.sin(mid_a) * mid_r):
            continue
        if on_spoke(math.cos(mid_a) * mid_r, math.sin(mid_a) * mid_r):
            continue
        v = [bm.verts.new(p) for p in (
            (math.cos(a0) * inner, math.sin(a0) * inner, GRASS_Y),
            (math.cos(a1) * inner, math.sin(a1) * inner, GRASS_Y),
            (math.cos(a1) * outer, math.sin(a1) * outer, GRASS_Y),
            (math.cos(a0) * outer, math.sin(a0) * outer, GRASS_Y),
        )]
        f = bm.faces.new(v)
        f.material_index = ORDER.index('grass')
        for loop in f.loops:
            loop[uv_layer].uv = (loop.vert.co.x / TILE, loop.vert.co.y / TILE)

# A bekötőutak burkolata. A várostól a pálya külső széléig futnak, hogy a
# ráhajtás ne egy éles kereszteződés legyen, hanem átvezetés.
_xs, _zs = _spoke_lines()
for x in _xs:
    reach = math.sqrt(max(0.0, (RING_OUT + 2) ** 2 - x ** 2))
    if reach <= BUILT_Z:
        continue
    for sign in (-1, 1):
        z0, z1 = sign * BUILT_Z, sign * reach
        box(x - SPOKE_W / 2, x + SPOKE_W / 2, 0.0, 0.02, min(z0, z1), max(z0, z1), 'asphalt')
for z in _zs:
    reach = math.sqrt(max(0.0, (RING_OUT + 2) ** 2 - z ** 2))
    if reach <= BUILT_X:
        continue
    for sign in (-1, 1):
        x0, x1 = sign * BUILT_X, sign * reach
        box(min(x0, x1), max(x0, x1), 0.0, 0.02, z - SPOKE_W / 2, z + SPOKE_W / 2, 'asphalt')

# A BEKÖTŐK FELFESTÉSE.
#
# Egy felfestetlen aszfaltcsík nem út, hanem beton: nem mondja meg, hol a
# sáv, és menet közben nem lehet róla leolvasni, hogy ez ugyanaz a rendszer,
# mint a városi utcák. Ugyanaz a szaggatott középvonal kerül rájuk, amit a
# város utcái is kapnak, plusz tömör szélvonal.
for x in _xs:
    reach = math.sqrt(max(0.0, (RING_OUT + 2) ** 2 - x ** 2))
    if reach <= BUILT_Z:
        continue
    for sign in (-1, 1):
        dashes(False, x, min(sign * BUILT_Z, sign * reach), max(sign * BUILT_Z, sign * reach))
        for edge in (-SPOKE_W / 2 + 0.3, SPOKE_W / 2 - 0.3):
            box(x + edge - 0.11, x + edge + 0.11, 0.0, 0.03,
                min(sign * BUILT_Z, sign * reach), max(sign * BUILT_Z, sign * reach), 'line')
for z in _zs:
    reach = math.sqrt(max(0.0, (RING_OUT + 2) ** 2 - z ** 2))
    if reach <= BUILT_X:
        continue
    for sign in (-1, 1):
        dashes(True, z, min(sign * BUILT_X, sign * reach), max(sign * BUILT_X, sign * reach))
        for edge in (-SPOKE_W / 2 + 0.3, SPOKE_W / 2 - 0.3):
            box(min(sign * BUILT_X, sign * reach), max(sign * BUILT_X, sign * reach),
                0.0, 0.03, z + edge - 0.11, z + edge + 0.11, 'line')

# A gyepsávokra szórunk néhány fát és sírkövet — de CSAK oda, ahol nem
# zavarják a vezetést: a pálya szélétől négy méterre, és a városra sem érhet.
_placed = 0
_tries = 0
while _placed < 260 and _tries < 40000:
    _tries += 1
    a = _rnd.uniform(0, math.tau)
    if _rnd.random() < 0.5:
        r = _rnd.uniform(BUILT_MAX + 3, RING_IN - 4)
    else:
        r = _rnd.uniform(RING_OUT + 4, EDGE_OUT - 3)
    if r <= 0:
        continue
    cx, cz = math.cos(a) * r, math.sin(a) * r
    if not outside_town(cx, cz, 4.0):
        continue
    roll = _rnd.random()
    if roll < 0.45:
        gravestone(cx, cz, GRASS_Y, _rnd.uniform(0.5, 0.9), _rnd.uniform(1.2, 2.2))
    elif roll < 0.8:
        tree(cx, cz, GRASS_Y, _rnd.uniform(4.0, 7.0))
    else:
        lantern(cx, cz, GRASS_Y, _rnd.uniform(1.6, 2.4))
    _placed += 1

# A KERÍTÉS a legszélén: ez mondja meg, hogy a pálya itt véget ér — az üveg
# önmagában nem elég, mert azon át lehet látni.
for seg in range(180):
    a = seg / 180 * math.tau
    if seg % 6 == 5:
        continue                                   # kapunyílások, hogy ne legyen fal
    cx, cz = math.cos(a) * EDGE_OUT, math.sin(a) * EDGE_OUT
    box(cx - 0.22, cx + 0.22, GRASS_Y, GRASS_Y + 2.4, cz - 0.22, cz + 0.22, 'fence')

bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
bm.to_mesh(mesh)
bm.free()

# --- játékléptékre -----------------------------------------------------------
obj.scale = (1 / VILLAGE_SCALE, 1 / VILLAGE_SCALE, 1 / VILLAGE_SCALE)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
bpy.ops.object.transform_apply(scale=True)

json.dump({'groundY': 0.0, 'roadY': 0.0, 'plots': plots, 'lights': lights,
           # A KÖRPÁLYA helye. A játéknak tudnia kell, mert oda nem való
           # minden, ami a városba igen — például a gyalogos szörnyecskék.
           'ring': {'inner': RING_IN / VILLAGE_SCALE, 'outer': RING_OUT / VILLAGE_SCALE}},
          open('raw/houses/plots.json', 'w'), indent=1)

bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB')
print("TERKEP  %.0f × %.0f m  |  sav felszelesseg %.2f m  |  %d telek  |  %d lampa  |  %d lap"
      % (HALF_X * 2, HALF_Z * 2, STREET / 2, len(plots), len(lights), len(mesh.polygons)))
