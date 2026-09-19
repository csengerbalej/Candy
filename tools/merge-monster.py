"""
EGY SZÖRNY ÖT FÁJLBÓL — a Meshy animációnként külön GLB-t ad.

A letöltés öt fájl: Walking, Running, Run_03, Casual_Walk, Alert. Mind az
ötben ugyanaz a test és ugyanaz a csontváz, csak más a mozgás. A játéknak
viszont EGY modell kell, amiben mind az öt klip benne van — különben
ötször töltenénk le ugyanazt a hálót.

Ez a script az elsőt veszi alapnak, a többiből pedig átemeli az ACTION-t
(a Blender így hívja a klipet) ugyanarra a csontvázra, aztán a fölösleges
másolatokat kidobja.

  blender -b -P tools/merge-monster.py -- konyvtar ki.glb
"""
import bpy, sys, os, glob
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
konyvtar, ki = argv[0], argv[1]

fajlok = sorted(glob.glob(os.path.join(konyvtar, '*.glb')))
assert fajlok, f'nincs GLB itt: {konyvtar}'

bpy.ops.wm.read_factory_settings(use_empty=True)

# AZ ELSŐ FÁJL AZ ALAP: ebből marad a test, a csontváz és a textúra.
bpy.ops.import_scene.gltf(filepath=fajlok[0])
alap_armature = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
akciok = []
if alap_armature.animation_data and alap_armature.animation_data.action:
    akciok.append(alap_armature.animation_data.action)

# A TÖBBIBŐL CSAK A MOZGÁS KELL. Importáljuk, elvesszük az akciót, és a
# behozott objektumokat töröljük — a csontváz ugyanaz, az akció ráül.
for f in fajlok[1:]:
    elotte = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=f)
    ujak = [o for o in bpy.data.objects if o not in elotte]
    for o in ujak:
        if o.type == 'ARMATURE' and o.animation_data and o.animation_data.action:
            a = o.animation_data.action
            a.use_fake_user = True
            akciok.append(a)
    for o in ujak:
        bpy.data.objects.remove(o, do_unlink=True)

print('AKCIOK:', [a.name for a in akciok])

# Minden akciót NLA-sávba teszünk az alap csontvázon: az exportáló így
# mindet külön animációként írja ki.
if not alap_armature.animation_data:
    alap_armature.animation_data_create()
alap_armature.animation_data.action = None
for a in akciok:
    sav = alap_armature.animation_data.nla_tracks.new()
    sav.name = a.name
    sav.strips.new(a.name, 0, a)

# A RIG MÉRTÉKEGYSÉGÉT ITT TESSZÜK RENDBE.
#
# A letöltött rigek csontjai CENTIMÉTERBEN állnak: mérve a csípő csontja
# 126 méteren volt, a fej 182-n. A háló ettől még jónak látszik (a kötési
# mátrixok kiegyenlítik), a JÁTÉK viszont a csontok világbeli helyére
# épít — a testszélességre, a fej magasságára, a méretezésre —, és ott már
# százszoros hibát kapunk: háznyi szörnyet.
#
# Ezért a teljes hierarchiát átskálázzuk úgy, hogy a háló pontosan két
# méter magas legyen, és BEÉGETJÜK a transzformációt. Innentől minden —
# csont, háló, animáció — méterben van.
meshek = [o for o in bpy.data.objects if o.type == 'MESH']
lo = min((o.matrix_world @ Vector(c)).z for o in meshek for c in o.bound_box)
hi = max((o.matrix_world @ Vector(c)).z for o in meshek for c in o.bound_box)
magas = max(1e-6, hi - lo)
arany = 2.0 / magas
print(f'MERET {magas:.3f} -> 2.000 (szorzo {arany:.5f})')

bpy.ops.object.select_all(action='DESELECT')
alap_armature.select_set(True)
bpy.context.view_layer.objects.active = alap_armature
alap_armature.scale = (alap_armature.scale[0] * arany,) * 3
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
for o in meshek:
    o.select_set(True)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

bpy.ops.export_scene.gltf(
    filepath=ki,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_skins=True,
)
print('KESZ:', ki)
