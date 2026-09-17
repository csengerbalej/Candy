# A falu összeszerelése: négy ház a tizenhat üres telekre, latin négyzetben.
#
#   blender -b --python tools/village-assemble.py -- <falu.glb> <plots.json> <házmappa> <ki.glb>
#
# KIVÁGÁS NINCS, és ez a lényeg. Az előző térképen a házak bele voltak sütve a
# terepbe, tehát előbb ki kellett őket vágni — dobozzal, aztán darabonként —, és
# a maradványok (fél tetőgerincek, lebegő tornácoszlopok) többször is
# visszajöttek. Egy üres telkes térképen ez az egész probléma megszűnik a
# gyökerénél: nincs mit eltávolítani.
#
# Miért egy fájlba, és nem futásidejű példányosítással: mert az ütközésrács a
# KIRAJZOLT geometriából mérődik (tools/village-nav.py), és ha a két dolog
# külön él, azonnal szét is csúszik. Egy fájl, egy mérés, egy igazság.
#
# Tengelyek: a glTF importer (x, y, z) -> Blender (x, -z, y). A telekfájl a
# JÁTÉK terében mér, ahol tehát a játék Z = -Blender Y.
import bpy, sys, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
village_path, plots_path, house_dir, out_path = argv[:4]

data = json.load(open(plots_path))
plots = data['plots']
GROUND_Y = data['groundY']

# Az átlókban sem ismétlődik — négy házzal ez is megoldható, és a minta így
# ránézésre nem ismerhető fel.
SQUARE = [
    [0, 1, 2, 3],
    [2, 3, 0, 1],
    [3, 2, 1, 0],
    [1, 0, 3, 2],
]

# Az egyes modellek „eleje" más-más irányba néz; ezt renderen kell eldönteni.
YAW_OFFSET = [0.0, 0.0, 0.0, 0.0]

# Mekkora hányadát töltse ki a ház a telek rövidebbik oldalának. Nem 1:
# marad hely az előkertnek, a kapubejárónak és a későbbi díszeknek.
PLOT_FILL = 0.82
# A legmagasabb ház sem lehet aránytalan a szomszédaihoz képest.
MAX_HEIGHT = 0.26

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=village_path)
print("TEREP betoltve: %d objektum" % len([o for o in bpy.data.objects if o.type == 'MESH']))

# --- a négy ház --------------------------------------------------------------
plot_short = min(min(p['size']) for p in plots)
sources = []
for n in range(1, 5):
    existing = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath="%s/h%d.painted.glb" % (house_dir, n))
    parts = [o for o in bpy.data.objects if o not in existing and o.type == 'MESH']
    for o in bpy.data.objects: o.select_set(False)
    for o in parts: o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    if len(parts) > 1: bpy.ops.object.join()
    src = bpy.context.view_layer.objects.active
    src.name = 'house_src_%d' % n

    # Origó a TALPÁRA és vízszintesen a közepére: a lerakás így egyetlen
    # koordináta, nem egy koordináta plusz egy fejben tartott eltolás.
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    bb = [src.matrix_world @ Vector(c) for c in src.bound_box]
    lo = Vector((min(v.x for v in bb), min(v.y for v in bb), min(v.z for v in bb)))
    hi = Vector((max(v.x for v in bb), max(v.y for v in bb), max(v.z for v in bb)))
    size = hi - lo
    offset = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z))
    for v in src.data.vertices:
        v.co -= offset

    scale = (plot_short * PLOT_FILL) / max(size.x, size.y)
    if size.z * scale > MAX_HEIGHT:
        scale = MAX_HEIGHT / size.z
    sources.append((src, scale))
    print("  h%d  %.2f × %.2f × %.2f  ->  %.3f × %.3f × %.3f"
          % (n, size.x, size.y, size.z,
             size.x * scale, size.y * scale, size.z * scale))

# --- lerakás -----------------------------------------------------------------
for p in plots:
    src, scale = sources[SQUARE[p['row'] % 4][p['col'] % 4]]
    copy = src.copy()
    # A mesh-adat MEGOSZTOTT, nem másolt: a glTF négy geometriát ír ki és
    # tizenhat csomópontot, ami rájuk hivatkozik. Másolva ugyanaz a kép
    # négyszer annyi adatból állna — lemérve 17,8 MB, a kiadási korlát 16.
    bpy.context.collection.objects.link(copy)

    copy.location = (p['centre'][0], -p['centre'][1], GROUND_Y)
    copy.scale = (scale, scale, scale)

    # A ház a KAPUBEJÁRÓ felé néz. Az irány mért: a telek közepétől a mért
    # megállási pont felé — ugyanaz a pont, ahol a narancsszínű parkolóhely
    # lesz, tehát a bejárat és a parkoló egymásra néz.
    dx = p['stop'][0] - p['centre'][0]
    dz = p['stop'][1] - p['centre'][1]
    which = SQUARE[p['row'] % 4][p['col'] % 4]
    copy.rotation_euler = (0, 0, math.atan2(dx, dz) + YAW_OFFSET[which])

# A forrásmodelleket TÖRÖLNI kell, nem elrejteni: a glTF exportáló alapból
# mindent kivisz, a rejtetteket is. Első nekifutásra négy teljes méretű ház
# került az origóba, és a falu magassága 0,22 helyett 2,01 lett.
for src, _ in sources:
    bpy.data.objects.remove(src, do_unlink=True)

grid = [['.'] * 4 for _ in range(4)]
for p in plots:
    grid[p['row'] % 4][p['col'] % 4] = 'ABCD'[SQUARE[p['row'] % 4][p['col'] % 4]]
print("LATIN NEGYZET:")
for row in grid: print("   " + ' '.join(row))

bpy.ops.export_scene.gltf(filepath=out_path, export_format='GLB')
print("KESZ")
