"""
FELÜLNÉZETI ALAPRAJZ ISMERT MÉRETARÁNNYAL.

A kézzel megrajzolt pálya (hol teremhet cukorka, hol fegyver, hol a sarok)
csak akkor fordítható le a játék világába, ha a KÉPPONT és a VILÁGKOORDINÁTA
között ismerjük az összefüggést. Egy ferde nézeten ez vetítés — itt viszont
merőleges (ortografikus) felülnézet, ahol a kapcsolat egyszerű szorzás.

A kiírt sor adja a kulcsot: a kép bal felső sarka a világ (minX, minZ)
pontja, a jobb alsó a (maxX, maxZ).

  blender -b --python tools/house-plan.py -- be.glb ki.png [méret]
"""
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
size = int(argv[2]) if len(argv) > 2 else 1200

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])

centre = (lo + hi) / 2
span = max(hi.x - lo.x, hi.y - lo.y)

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam_data.ortho_scale = span
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
# EGYENESEN LEFELÉ. A tető nincs az úton: a modell tető nélküli metszet.
cam.location = centre + Vector((0, 0, hi.z + 5))
cam.rotation_euler = (0, 0, 0)
bpy.context.scene.camera = cam

sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
sun.data.energy = 4
bpy.context.collection.objects.link(sun)
sun.location = centre + Vector((0, 0, hi.z + 10))

scene = bpy.context.scene
scene.render.engine = 'BLENDER_EEVEE'
scene.render.resolution_x = size
scene.render.resolution_y = size
scene.render.filepath = out
scene.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)

# A glTF importja forgat: a játék Z tengelye a Blender −Y-ja. A kiírt
# tartományt már a JÁTÉK tengelyeiben adjuk meg, hogy ne kelljen fejben
# forgatni.
half = span / 2
print(f'TERKEP x {centre.x - half:.3f} {centre.x + half:.3f} '
      f'z {-(centre.y + half):.3f} {-(centre.y - half):.3f} kep {size}')
