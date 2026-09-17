"""
A szörnyecske karjait lehajtja — mert csont nincs benne.

Mérve: a városban 48 szörnyecske áll és fut az utcákon, és MIND ugyanabban a
széttárt karú alappózban — a modellben nulla csont van, tehát animálni sem
lehet őket. Ez az, ami „T-póznak" látszik mindenhol.

Csont híján a hajlítás a CSÚCSOKON történik, egyszer, sütéskor: a vállon túli
csúcsok elfordulnak a váll körül, annál jobban, minél messzebb vannak tőle.
Így a kar ível, nem törik — és a futásidőnek nem kerül semmibe.

Blender Z a felfelé. Futtatás:
  blender -b -P tools/critter-arms.py -- <be.glb> <ki.glb> [szog_fok]
"""
import bpy, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
DROP = math.radians(float(argv[2]) if len(argv) > 2 else 72.0)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

obj = next(o for o in bpy.data.objects if o.type == 'MESH')
me = obj.data
vs = [v.co.copy() for v in me.vertices]
xs = [v.x for v in vs]; ys = [v.y for v in vs]; zs = [v.z for v in vs]
print(f'MERET x {min(xs):.3f}..{max(xs):.3f} | y {min(ys):.3f}..{max(ys):.3f} | z {min(zs):.3f}..{max(zs):.3f}')

half = max(abs(min(xs)), abs(max(xs)))
top, bottom = max(zs), min(zs)
height = top - bottom

# A VÁLL: ahol a törzs véget ér. A törzs szélessége a test magasságából jól
# becsülhető (a zömök figuráknál a törzs a teljes fesztáv harmada), de nem
# tippelünk: megkeressük azt az x-et, ahol a keresztmetszet magassága
# hirtelen leesik — a kar vékony, a törzs vastag.
STEP = half / 40.0
prev = None
shoulder = half * 0.34
for i in range(40, 0, -1):
    x0 = (i - 1) * STEP
    band = [v.z for v in vs if x0 <= abs(v.x) < x0 + STEP]
    if len(band) < 8:
        continue
    tall = max(band) - min(band)
    if prev is not None and tall > prev * 1.9:
        shoulder = x0 + STEP
        break
    prev = tall if prev is None else max(prev, tall)

# A váll magassága: a vállnál lévő csúcsok átlaga.
near = [v for v in vs if shoulder * 0.9 <= abs(v.x) <= shoulder * 1.25]
sz = sum(v.z for v in near) / len(near) if near else bottom + height * 0.62
sy = sum(v.y for v in near) / len(near) if near else 0.0
print(f'VALL x={shoulder:.3f} (fesztav fele {half:.3f}) | magassag z={sz:.3f}')

reach = half - shoulder
if reach <= 1e-4:
    print('NINCS KINYUJTOTT KAR — nincs mit hajlitani')
else:
    for i, v in enumerate(vs):
        over = abs(v.x) - shoulder
        if over <= 0:
            continue
        t = min(1.0, over / reach)
        # Simított átmenet: a vállnál nulla elfordulás, ezért a váll nem törik el.
        ang = DROP * (t * t * (3 - 2 * t))
        side = 1.0 if v.x >= 0 else -1.0
        # Forgatás a váll körül, az Y tengely mentén: a kar LEFELÉ fordul.
        p = Vector((abs(v.x) - shoulder, v.y - sy, v.z - sz))
        c, s = math.cos(ang), math.sin(ang)
        nx = p.x * c + p.z * s
        nz = -p.x * s + p.z * c
        me.vertices[i].co = Vector((side * (shoulder + nx), p.y + sy, nz + sz))
    me.update()

vs2 = [v.co for v in me.vertices]
xs2 = [v.x for v in vs2]; zs2 = [v.z for v in vs2]
print(f'UTANA x {min(xs2):.3f}..{max(xs2):.3f} | z {min(zs2):.3f}..{max(zs2):.3f}')
print(f'FESZTAV {2*half:.3f} -> {max(xs2)-min(xs2):.3f}')

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True)
print('KESZ', dst)
