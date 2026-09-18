"""
A fegyver ÚGY, ahogy a KÉZBEN látszik.

Miért kell külön eszköz: a modell tájolását oldalnézetből eldönteni nem
lehet. Négyszer próbáltam meg — kétszer a rossz fegyvert fordítottam meg,
és a sörétes duplacsöve a „csővég a vékonyabb vég" szabályt is megbuktatta.
Ez a nézet UGYANAZT a transzformációt használja, amit a játék (180 fokos
fordítás, 0,42-es méret, jobbra-előre-lejjebb tolás), tehát amit itt látsz,
azt látja a játékos is.

  blender -b -P tools/preview-inhand.py -- <modell.glb> <kep.png>
"""
import bpy, sys, math
argv = sys.argv[sys.argv.index('--')+1:]
src, out = argv[0], argv[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.data.objects if o.type=='MESH')
# A jatek: group.quaternion = kamera, a modell +180 fok Y korul, 0.42 meret.
# Blenderben a kamera -Z fele nez, a glTF import utan a jatek +Z = Blender -Y.
obj.rotation_euler = (0, 0, math.pi)      # a jatek Y-forgatasa
obj.scale = (0.42, 0.42, 0.42)
obj.location = (0.17, 0.34, -0.16)        # HOLD: jobbra, elore, lejjebb
bpy.ops.object.camera_add(location=(0,0,0), rotation=(math.pi/2, 0, 0))
cam = bpy.context.object; bpy.context.scene.camera = cam
cam.data.lens = 24
bpy.ops.object.light_add(type='SUN', location=(2,-4,4)); bpy.context.object.data.energy=4
sc = bpy.context.scene
sc.render.engine='BLENDER_WORKBENCH'
sc.display.shading.color_type='TEXTURE'
sc.render.resolution_x=520; sc.render.resolution_y=400
sc.render.filepath=out
bpy.ops.render.render(write_still=True)
print('RENDER', out)
