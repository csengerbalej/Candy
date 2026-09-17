# Két GLB-t rendereli UGYANARRÓL a nézetről, hogy a bake veszteségét
# látni lehessen, ne csak sejteni.
#
#   blender -b --python tools/render-compare.py -- <a.glb> <b.glb> <kimenet-előtag> [nézet] [méret]
#
# A nézet a modell befoglaló dobozához igazodik, nem abszolút koordinátákhoz,
# így ugyanaz a szkript működik a 1,9 egységes karakteren és a falun is.
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
files = [argv[0], argv[1]]
prefix = argv[2]
view = argv[3] if len(argv) > 3 else 'three-quarter'
size = int(argv[4]) if len(argv) > 4 else 900


def clear():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def bounds():
    lo = Vector((1e9, 1e9, 1e9)); hi = Vector((-1e9, -1e9, -1e9))
    for ob in bpy.context.scene.objects:
        if ob.type != 'MESH':
            continue
        for corner in ob.bound_box:
            w = ob.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], w[i]) for i in range(3)))
            hi = Vector((max(hi[i], w[i]) for i in range(3)))
    return lo, hi


# A kamerát a modell saját méretéhez kötjük: a „közeli" nézet a befoglaló doboz
# tizedére néz rá, mert a textúra-veszteség csak közelről derül ki.
VIEWS = {
    'three-quarter': (1.0, (1.0, -1.4, 0.8)),
    'close':         (0.18, (1.0, -1.4, 0.55)),
    'top':           (1.0, (0.01, -0.01, 2.2)),
}


def render(path, out):
    clear()
    bpy.ops.import_scene.gltf(filepath=path)
    lo, hi = bounds()
    centre = (lo + hi) / 2
    span = max((hi - lo)[i] for i in range(3))

    frac, direction = VIEWS[view]
    # A közeli nézet a modell elülső-felső negyedére céloz, nem a közepére:
    # ott van az arc / a homlokzat, ahol a részletvesztés számít.
    if frac < 1.0:
        centre = Vector((centre.x, lo.y + (hi.y - lo.y) * 0.3, lo.z + (hi.z - lo.z) * 0.72))
    dist = span * frac * 1.5

    cam_data = bpy.data.cameras.new('cam')
    cam_data.lens = 60
    cam = bpy.data.objects.new('cam', cam_data)
    bpy.context.scene.collection.objects.link(cam)
    d = Vector(direction).normalized()
    cam.location = centre + d * dist
    cam.rotation_mode = 'QUATERNION'
    cam.rotation_quaternion = (-d).to_track_quat('-Z', 'Y')
    bpy.context.scene.camera = cam

    # Világos, irányított fény + halvány kitöltés: a normáltérkép hatása csak
    # súroló fényben látszik, a lapos environment elrejtené.
    sun_data = bpy.data.lights.new('sun', 'SUN')
    sun_data.energy = 4.0
    sun = bpy.data.objects.new('sun', sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(58), 0, math.radians(35))
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[1].default_value = 0.35
    bpy.context.scene.world = world

    scene = bpy.context.scene
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x = size
    scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)


for i, f in enumerate(files):
    render(f, f'{prefix}_{"a" if i == 0 else "b"}.png')
print('KÉSZ')
