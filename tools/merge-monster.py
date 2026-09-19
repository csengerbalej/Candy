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

bpy.ops.export_scene.gltf(
    filepath=ki,
    export_format='GLB',
    export_animations=True,
    export_animation_mode='NLA_TRACKS',
    export_skins=True,
)
print('KESZ:', ki)
