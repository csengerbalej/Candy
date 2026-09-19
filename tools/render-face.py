"""
EGY SZÖRNY ARCA AZ IJESZTÉSHEZ.

Amikor elkapnak, egy teljes képernyős arc villan fel — csakhogy eddig a
JÁTSZHATÓ karakterek portréi voltak ezek: a Vak ijesztésénél egy mosolygó
plüss vérfarkas ugrott az arcodba. A házban járkáló lényeknek egyszerűen
nem volt képük.

Ez a script a modellből készít egyet: a fejre közelít, alulról világít
egyetlen kemény fénnyel (ez a zseblámpa szöge — az, amivel épp ráfogtál),
és fekete háttérre renderel. A kép nem szép portré akar lenni, hanem az,
amit egy fél méterről, egy elemlámpa fényében látnál.

  blender -b -P tools/render-face.py -- modell.glb ki.png
"""
import bpy, sys, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
# Hányad résznél van a FEJ a sziluett tetejétől, és mekkora a fény. Nem
# minden szörny sziluettjének a teteje a feje: az agancsos skin-walkernél a
# csúcs az agancs, a fej jóval alatta van. A fényerőt pedig a bőr színe
# dönti el — egy világos testet ugyanaz a lámpa kiéget.
fej_arany = float(argv[2]) if len(argv) > 2 else 0.14
fenyero = float(argv[3]) if len(argv) > 3 else 260.0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshek = [o for o in bpy.data.objects if o.type == 'MESH']
lo = Vector((1e9, 1e9, 1e9))
hi = Vector((-1e9, -1e9, -1e9))
for ob in meshek:
    for sarok in ob.bound_box:
        p = ob.matrix_world @ Vector(sarok)
        lo = Vector((min(lo[i], p[i]) for i in range(3)))
        hi = Vector((max(hi[i], p[i]) for i in range(3)))

magas = hi.z - lo.z
# A FEJ a test felső nyolcadában van. Nem keressük csontból: a sziluett
# felső része akkor is a fej, ha a modellnek nincs rendes csontváza.
# A FEJ KÖZEPE, nem a teteje: a koponya teteje a sziluett csúcsa, az arc
# egy kicsivel alatta van. A tizennégy százalék méréssel jött ki: feljebb a
# kamera a fejtetőt nézi, lejjebb a nyakat.
fej = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, hi.z - magas * fej_arany))
# TÁVOLABBRÓL. Az első keret olyan közel volt, hogy egy fül töltötte ki a
# képet — egy ijesztéshez a FEJ kell, nem egy felület.
tav = magas * 0.85

kamera_adat = bpy.data.cameras.new('kamera')
kamera_adat.lens = 52
kamera = bpy.data.objects.new('kamera', kamera_adat)
bpy.context.scene.collection.objects.link(kamera)
# Szemből és EGY KICSIT ALULRÓL: ez az a szög, ahonnan valami fölötted áll.
kamera.location = fej + Vector((0, -tav, -magas * 0.035))
irany = (fej - kamera.location).normalized()
kamera.rotation_euler = irany.to_track_quat('-Z', 'Y').to_euler()
bpy.context.scene.camera = kamera

# EGYETLEN KEMÉNY FÉNY, ALULRÓL. Ez a zseblámpa: a szemgödör és az állkapocs
# árnyéka fölfelé esik, és ettől lesz egy arcból maszk.
feny_adat = bpy.data.lights.new('lampa', type='SPOT')
feny_adat.energy = fenyero
feny_adat.spot_size = math.radians(70)
feny_adat.spot_blend = 0.45
feny_adat.shadow_soft_size = 0.08
feny = bpy.data.objects.new('lampa', feny_adat)
bpy.context.scene.collection.objects.link(feny)
feny.location = fej + Vector((tav * 0.35, -tav * 0.8, -magas * 0.12))
feny.rotation_euler = (fej - feny.location).normalized().to_track_quat('-Z', 'Y').to_euler()

# Halvány hideg tölteléks fény hátulról, hogy a sziluett elváljon a feketétől.
toltelek_adat = bpy.data.lights.new('toltelek', type='AREA')
toltelek_adat.energy = 30
toltelek_adat.color = (0.45, 0.5, 0.75)
toltelek = bpy.data.objects.new('toltelek', toltelek_adat)
bpy.context.scene.collection.objects.link(toltelek)
toltelek.location = fej + Vector((-tav * 0.9, tav * 0.5, magas * 0.1))
toltelek.rotation_euler = (fej - toltelek.location).normalized().to_track_quat('-Z', 'Y').to_euler()

jelenet = bpy.context.scene
jelenet.render.engine = 'BLENDER_EEVEE'
jelenet.render.resolution_x = 640
jelenet.render.resolution_y = 640
jelenet.render.film_transparent = False
jelenet.world = bpy.data.worlds.new('vilag')
jelenet.world.use_nodes = True
jelenet.world.node_tree.nodes['Background'].inputs[0].default_value = (0, 0, 0, 1)
jelenet.render.filepath = dst
jelenet.render.image_settings.file_format = 'PNG'
bpy.ops.render.render(write_still=True)
print('ARC:', dst)
