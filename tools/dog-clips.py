# Hol végződik egy mozgás és hol kezdődik a következő?
#
#   blender -b --python tools/dog-clips.py -- <dog.glb>
#
# A Meshy „All Animations" exportja EGYETLEN klipbe ragasztja az összes
# mozgást. Nevek nincsenek, határok nincsenek — csak egy hosszú idővonal.
#
# Amiből a határ kiolvasható: a mozgás ENERGIÁJA. Két animáció között a
# csontok egy pillanatra megállnak vagy visszatérnek egy semleges pózba, és
# ilyenkor a szögsebesség beszakad. Ezeket a völgyeket keressük.
import bpy, sys, math
from mathutils import Quaternion

argv = sys.argv[sys.argv.index('--') + 1:]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=argv[0])

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
action = arm.animation_data.action
start, end = [int(v) for v in action.frame_range]
print("klip:", action.name, "| képkocka", start, "-", end,
      "(%.1f mp 24 fps-en)" % ((end - start) / 24))
print("csontok:", len(arm.pose.bones))

scene = bpy.context.scene
bones = list(arm.pose.bones)

# Képkockánkénti mozgásenergia: mennyit fordulnak összesen a csontok.
prev = None
energy = []
for f in range(start, end + 1):
    scene.frame_set(f)
    pose = [b.matrix_basis.to_quaternion() for b in bones]
    if prev is not None:
        total = 0.0
        for a, b in zip(prev, pose):
            d = a.rotation_difference(b).angle
            total += abs(d)
        energy.append((f, total))
    prev = pose

if not energy:
    raise SystemExit("nincs mozgás")

peak = max(e for _, e in energy)
print("csúcsenergia: %.3f" % peak)

# Völgyek: ahol az energia a csúcs töredéke alá esik, és legalább néhány
# képkockán át ott is marad.
QUIET = peak * 0.08
runs = []
run_start = None
for f, e in energy:
    if e < QUIET:
        if run_start is None:
            run_start = f
    else:
        if run_start is not None and f - run_start >= 3:
            runs.append((run_start, f))
        run_start = None
if run_start is not None:
    runs.append((run_start, energy[-1][0]))

print("csendes szakaszok (%d):" % len(runs))
for a, b in runs:
    print("   %4d - %4d  (%.2f - %.2f mp)" % (a, b, a / 24, b / 24))

# Szakaszok a völgyek között.
cuts = [start] + [int((a + b) / 2) for a, b in runs] + [end]
print("javasolt vágások:")
for i in range(len(cuts) - 1):
    a, b = cuts[i], cuts[i + 1]
    if b - a < 8:
        continue
    print("   %2d.  %4d - %4d  (%.2f mp)" % (i, a, b, (b - a) / 24))
