# Gyors, felülről nézett render a térképről — hogy látni lehessen, mi készül.
#   blender -b --python tools/render-map.py -- <in.glb> <out.png> [méret] [dőlés]
import bpy, sys, math
from mathutils import Vector
argv = sys.argv[sys.argv.index('--') + 1:]
src, out = argv[0], argv[1]
size = int(argv[2]) if len(argv) > 2 else 950
tilt = float(argv[3]) if len(argv) > 3 else 52.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
for o in bpy.data.objects:
    if o.type != 'MESH': continue
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        for i in range(3):
            lo[i] = min(lo[i], w[i]); hi[i] = max(hi[i], w[i])
centre = (lo + hi) / 2
span = max(hi.x - lo.x, hi.y - lo.y)

cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 45
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam)
r = math.radians(tilt)
dist = span * 1.5
cam.location = centre + Vector((0, -math.cos(r) * dist, math.sin(r) * dist))
cam.rotation_euler = (math.radians(90) - r, 0, 0)
bpy.context.scene.camera = cam

sun_data = bpy.data.lights.new('sun', 'SUN'); sun_data.energy = 2.6
sun = bpy.data.objects.new('sun', sun_data)
bpy.context.collection.objects.link(sun)
sun.rotation_euler = (math.radians(48), 0, math.radians(35))

world = bpy.data.worlds.new('w'); bpy.context.scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.05, 0.05, 0.07, 1)

sc = bpy.context.scene
# A motort megpróbáljuk beállítani, de nem ez a lényeg: ami nem megy, azt a
# Blender alapértelmezése pótolja.
for engine in ('BLENDER_EEVEE_NEXT', 'BLENDER_EEVEE', 'CYCLES'):
    try:
        sc.render.engine = engine
        break
    except TypeError:
        continue
if sc.render.engine == 'CYCLES':
    sc.cycles.samples = 24
sc.render.resolution_x = size; sc.render.resolution_y = size
sc.render.filepath = out
bpy.ops.render.render(write_still=True)
print("RENDER", out)
