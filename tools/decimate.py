"""
EGY HÁLÓ LEFOGYASZTÁSA BLENDERREL.

Miért nem a gltf-transform: a meshoptimizer az ÉLEK mentén egyszerűsít, és
egy Meshy-fából jövő lombkorona több millió KÜLÖNÁLLÓ levélkártya — köztük
nincs közös él, tehát nincs mit összevonni. A fa hatmillió háromszöge így
kétmilliónál megállt, és ott is maradt, bármilyen hibahatárt engedtem.

A Blender Decimate (collapse) nem kér összefüggő hálót: a csúcsokat vonja
össze, nem az éleket. Egy háttérben álló fánál ez pont elég — a sziluett
marad, a levelek egyenkénti pontossága úgysem látszik.

Használat:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P tools/decimate.py \
      -- be.glb ki.glb 0.0015
"""
import bpy, sys

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst, ratio = argv[0], argv[1], float(argv[2])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

before = 0
after = 0
for ob in [o for o in bpy.data.objects if o.type == 'MESH']:
    before += len(ob.data.polygons)
    bpy.context.view_layer.objects.active = ob
    mod = ob.modifiers.new('fogyas', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after += len(ob.data.polygons)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB')
print(f'FOGYAS {before} -> {after}')
