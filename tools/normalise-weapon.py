"""
Egy letöltött fegyvermodellt a JÁTÉK koordinátáira igazít.

Miért kell, és miért nem a kódban: a három fegyver három különböző
tájolással érkezett (a rakétavető hossza az X tengelyen fekszik, a másik
kettőé a Z-n), és mindegyik két egység hosszúra normalizálva. Ha ezt a
játék kódja igazítaná, minden modellhez tartozna egy kézzel beírt forgatás
és méret — pontosan az a fajta szám, ami a következő modellcserénél némán
rossz lesz. A modellben viszont egyszer kell megcsinálni, és utána IGAZ.

Amit beállít:
  · a HOSSZ a +Z tengelyen fekszik (a csőtorkolat előre),
  · a modell a kért hosszúságú,
  · az origó a MARKOLATNÁL van, nem a tömegközépponton — a kéz oda fogja.

Blender Z a felfelé; a glTF importálás után a játék Z-je a Blender −Y-ja.

  blender -b -P tools/normalise-weapon.py -- be.glb ki.glb <hossz> [grip]
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
LENGTH = float(argv[2]) if len(argv) > 2 else 1.2
# Hol van a markolat a hossz mentén, hátulról mérve. 0,25 = a fegyver hátsó
# negyedében, ahol egy kéz tényleg fogja.
GRIP = float(argv[3]) if len(argv) > 3 else 0.25

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
for o in bpy.data.objects:
    o.select_set(o.type == 'MESH')
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1:
    bpy.ops.object.join()
obj = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

def size(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    lo = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
    hi = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
    return lo, hi, hi - lo

lo, hi, dim = size(obj)
print(f'ERKEZETT  {dim.x:.2f} x {dim.y:.2f} x {dim.z:.2f}')

# A leghosszabb tengely a fegyver hossza. Ezt forgatjuk a Blender −Y-ra,
# mert a glTF export után az lesz a játék +Z-je.
#
# CSÚCS-MATEMATIKÁVAL, nem operátorral: a `transform_apply` a KIJELÖLÉSRE
# hat, és a rakétavetőnél (ahol az importáló szülő csomópontot is csinált)
# csendben a másik objektumra ment. A hossz jó lett, a szélesség viszont
# 11,8 egység — egy fegyver, ami szélesebb egy autónál. A csúcsokat
# közvetlenül írva nincs mit félreérteni.
axis = max(range(3), key=lambda i: dim[i])
for v in obj.data.vertices:
    x, y, z = v.co
    if axis == 0:      # X a hossz -> Y-ba
        v.co = Vector((-y, x, z))
    elif axis == 2:    # Z a hossz -> Y-ba
        v.co = Vector((x, z, -y))
obj.data.update()

# Hossz a kértre.
lo, hi, dim = size(obj)
scale = LENGTH / dim.y if dim.y > 1e-6 else 1.0
for v in obj.data.vertices:
    v.co *= scale
obj.data.update()

# Az origó a MARKOLATHOZ: a hossz mentén hátulról GRIP arányban, a másik két
# tengelyen középre. Így a modell a kézbe kerül, nem a tömegközéppontjára.
lo, hi, dim = size(obj)
grip = Vector(((lo.x + hi.x) / 2, lo.y + dim.y * GRIP, (lo.z + hi.z) / 2))
for v in obj.data.vertices:
    v.co -= grip
obj.data.update()

lo, hi, dim = size(obj)
print(f'KESZ      {dim.x:.2f} x {dim.y:.2f} x {dim.z:.2f}  (hossz {dim.y:.2f})')
print(f'ORIGO     elore {hi.y:.2f}, hatra {lo.y:.2f}')

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True)
print('MENTVE', dst)
