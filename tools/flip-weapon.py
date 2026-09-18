"""
EGY FEGYVER MEGFORDÍTÁSA A MODELLBEN.

A kézbe fogás szabálya EGY szám a kódban (180 fok Y körül), és minden
fegyverre ugyanaz. Ha egy modell fordítva jött a generátorból, akkor nem a
szabályt kell fegyverenként kivételezni — mert onnantól minden új fegyvernél
újra ki kell találni, melyik kivétel érvényes rá —, hanem a MODELLT kell a
többihez igazítani. Utána a szabály megint egy szám.

  blender -b -P tools/flip-weapon.py -- be.glb ki.glb
"""
import bpy, sys, math
argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

for ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    bpy.context.view_layer.objects.active = ob
    ob.select_set(True)
    # A glTF import után a Blender FÖLFELÉ mutató tengelye a Z, és a játék
    # Y tengelye ennek felel meg: a 180 fokos fordulás tehát Z körül megy.
    ob.rotation_euler[2] += math.pi
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    ob.select_set(False)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
print('FORDITVA', dst)
