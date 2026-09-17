"""
Karakterportrék a választóképernyőre — a Meshy előnézeti képek stílusában.

A felhasználó megmutatta, milyen képeket szeretne: a Meshy saját rendereit.
Azok nincsenek a gépen (a letöltött mappákban csak GLB van), de ugyanabból a
modellből elő lehet állítani ugyanazt a beállítást, és az jobb is, mintha
kézzel bemásolt képek lógnának a projektben: egy újrasütött modell portréja
magától frissül.

Amit a referencia adott, és amit itt beállítunk:
  · SZEMBŐL, nem háromnegyedből — a korábbi verzióm oldalról nézett, és a
    szellemnek levágta a fél karját;
  · világosszürke stúdióháttér, nem átlátszó;
  · lágy, bő fény, alig árnyékkal — a figura olvasható, nem drámai.
"""
import bpy, sys, math, mathutils

src, out = sys.argv[-2], sys.argv[-1]
RES_X, RES_Y = 420, 520

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

objs = [o for o in bpy.data.objects if o.type == 'MESH']
corners = []
for o in objs:
    for c in o.bound_box:
        corners.append(o.matrix_world @ mathutils.Vector(c))
mn = mathutils.Vector((min(c[i] for c in corners) for i in range(3)))
mx = mathutils.Vector((max(c[i] for c in corners) for i in range(3)))
ctr = (mn + mx) / 2
height = mx.z - mn.z

# --- kamera: szemből, alig a szemmagasság fölül ----------------------------
# A glTF-modellek eleje a +Z felé néz, amit a Blender importere -Y-ra képez —
# tehát a kamera -Y felől néz vissza a figurára.
cam_data = bpy.data.cameras.new("c")
cam_data.type = 'ORTHO'
cam = bpy.data.objects.new("c", cam_data)
bpy.context.collection.objects.link(cam)
d = height * 4
cam.location = (ctr.x, ctr.y - d, ctr.z + height * 0.10)
aim = mathutils.Vector((ctr.x, ctr.y, ctr.z + height * 0.06))
cam.rotation_euler = (aim - cam.location).normalized().to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = cam
# A mátrix csak a függőségi gráf frissítése után áll be — e nélkül a lenti
# keretszámítás egy elavult kameraállásból dolgozik, és a figura a kép közepén
# egy pöttyé zsugorodik.
bpy.context.view_layer.update()

# A keretet a VETÜLETBŐL számoljuk, nem a magasságból: a szellem a kinyújtott
# karjával szélesebb, mint amilyen magas, és a Blender ortho_scale-je mindig a
# render nagyobbik oldalára vonatkozik — álló képen a magasságra. Ami a
# képarányból adódó vízszintes résznél szélesebb, az egyszerűen kilógna.
aspect = RES_X / RES_Y
view = cam.matrix_world.inverted()
xs = [(view @ c).x for c in corners]
ys = [(view @ c).y for c in corners]
cam_data.ortho_scale = max(max(ys) - min(ys), (max(xs) - min(xs)) / aspect) * 1.22
cam.location = cam.matrix_world @ mathutils.Vector((
    (max(xs) + min(xs)) * 0.5, (max(ys) + min(ys)) * 0.5, 0.0
))
bpy.context.view_layer.update()

# --- háttér: világosszürke stúdió -------------------------------------------
world = bpy.data.worlds.new("w")
world.use_nodes = True
world.node_tree.nodes["Background"].inputs[0].default_value = (0.82, 0.82, 0.84, 1.0)
world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
bpy.context.scene.world = world

# Hátfal és padló, hogy a figurának legyen mibe beleállnia, és a lába alá
# kerüljön egy halvány árnyék — e nélkül lebeg.
# A hátfal messze hátul: a padlóval alkotott éle így a kép alá esik, és nem
# húz egy éles vízszintes vonalat a figura mögé.
bpy.ops.mesh.primitive_plane_add(size=height * 60, location=(ctr.x, ctr.y + height * 14, ctr.z))
backdrop = bpy.context.active_object
backdrop.rotation_euler = (math.radians(90), 0, 0)
bpy.ops.mesh.primitive_plane_add(size=height * 60, location=(ctr.x, ctr.y, mn.z - height * 0.002))
floor = bpy.context.active_object
paper = bpy.data.materials.new("papir")
paper.use_nodes = True
bsdf = paper.node_tree.nodes["Principled BSDF"]
bsdf.inputs["Base Color"].default_value = (0.86, 0.86, 0.88, 1.0)
bsdf.inputs["Roughness"].default_value = 1.0
for plane in (backdrop, floor):
    plane.data.materials.append(paper)

# --- fény: lágy és bő, alig árnyékkal ---------------------------------------
def softbox(name, energy, location, rotation, size):
    data = bpy.data.lights.new(name, type='AREA')
    data.energy = energy
    data.size = size
    obj = bpy.data.objects.new(name, data)
    obj.location = location
    obj.rotation_euler = rotation
    bpy.context.collection.objects.link(obj)

key = height * 22
softbox("kulcs", key, (ctr.x - height, ctr.y - height * 2.2, ctr.z + height * 1.6),
        (math.radians(52), 0, math.radians(-26)), height * 3)
softbox("kitolto", key * 0.45, (ctr.x + height * 1.6, ctr.y - height * 1.8, ctr.z + height * 0.6),
        (math.radians(78), 0, math.radians(42)), height * 3)
softbox("hatso", key * 0.3, (ctr.x, ctr.y + height * 1.4, ctr.z + height * 2),
        (math.radians(130), 0, 0), height * 3)

sc = bpy.context.scene
sc.render.resolution_x = RES_X
sc.render.resolution_y = RES_Y
sc.render.filepath = out
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'Standard'
bpy.ops.render.render(write_still=True)
print("KESZ", out)
