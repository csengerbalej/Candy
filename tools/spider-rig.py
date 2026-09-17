# Melyik csont melyik láb?
#
#   blender -b --python tools/spider-rig.py -- <spider.glb> [ki.json]
#
# A Meshy automatikus rigje általános neveket ad (Bone_000...), tehát a lábakat
# nem lehet névről felismerni — MEGMÉRNI kell. Amit keresünk: a testtől kifelé
# tartó, több ízből álló ágak. A test közepe a gyökér, a láb vége az, ami a
# legmesszebb van tőle vízszintesen.
#
# Az eredmény egy kis JSON, ami a modell mellé kerül: nyolc lánc, mindegyik a
# csontok nevével, plusz hogy a láb merre néz (elöl/hátul, bal/jobb). A
# futásidő ezt olvassa — nem talál ki semmit, és nem is tud félremenni.
import bpy, sys, json, math
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src = argv[0]
out = argv[1] if len(argv) > 1 else 'public/models/spider-rig.json'

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
bpy.context.view_layer.update()

bones = {b.name: b for b in arm.data.bones}
head = {n: (arm.matrix_world @ b.head_local) for n, b in bones.items()}
tail = {n: (arm.matrix_world @ b.tail_local) for n, b in bones.items()}

root = next(b for b in bones.values() if b.parent is None)
centre = head[root.name]
print("gyökér:", root.name, "| csontok:", len(bones))

# A test középpontja vízszintesen: az összes csont súlypontja. Ehhez mérjük,
# mi számít „kifelé".
mid = Vector((0, 0, 0))
for v in head.values():
    mid += v
mid /= len(head)

def chain_from(bone):
    """Egy ág a végéig, mindig a leghosszabb gyereket követve."""
    out = [bone]
    while bone.children:
        bone = max(bone.children, key=lambda c: (tail[c.name] - head[c.name]).length)
        out.append(bone)
    return out

# A LÁB ott kezdődik, ahol a csont elszakad a test hossztengelyétől.
#
# Az első próbálkozásom „a legmesszebbre kinyúló láncokat" kereste, és a
# GERINCET is lábnak vette — a gerinc lánca a leghosszabb lábon át fut ki,
# tehát a kinyúlása a legnagyobb. A mért fa viszont egyértelmű: a test minden
# csontja x ≈ 0,01-en ül, a nyolc láb töve |x| = 0,20 és 0,27 között. A
# küszöb ezért nem méret, hanem OLDALIRÁNYÚ ELTÉRÉS, és az arányban van a
# pók félszélességével — így egy másik modellre is működne.
span = max(abs(v.x - mid.x) for v in tail.values())
SIDEWAYS = span * 0.08

legs = []
for b in bones.values():
    if b.parent is None:
        continue
    if abs(head[b.name].x - mid.x) <= SIDEWAYS:
        continue
    # Csak a LEGFELSŐ ilyen csont: ha a szülő is oldalra ült, akkor ez már a
    # láb közepe, nem a töve.
    if abs(head[b.parent.name].x - mid.x) > SIDEWAYS:
        continue
    chain = chain_from(b)
    if len(chain) < 3:
        continue
    tip = tail[chain[-1].name]
    legs.append({
        'bones': [x.name for x in chain],
        'side': 'left' if (head[b.name].x - mid.x) < 0 else 'right',
        # Elöl vagy hátul: a test hossztengelye a Y. Ez adja a járás
        # sorrendjét — egy pók nem mind a nyolc lábát emeli egyszerre.
        'front': head[b.name].y - mid.y,
        'reach': math.hypot(tip.x - mid.x, tip.y - mid.y),
        'tip': [tip.x, tip.y, tip.z],
    })

legs.sort(key=lambda l: (l['side'], -l['front']))
print("lábak:", len(legs))
for i, l in enumerate(legs):
    print("  %d  %-6s elöl %+.2f  kinyúlás %.2f  ízek %d  (%s)"
          % (i, l['side'], l['front'], l['reach'], len(l['bones']), l['bones'][0]))

used = {n for l in legs for n in l['bones']}
body = [b.name for b in bones.values() if b.name not in used]
print("test-csontok:", len(body))

# MERRE NÉZ a pók?
#
# Elsőre a lábak tövéből próbáltam megállapítani, és félrement: a felhasználó
# szerint a pók továbbra is „hátrafelé megy". A lábak elrendezése nem árulja
# el egyértelműen, melyik vég az eleje — egy pók lábai nagyjából szimmetrikusan
# ülnek, és amit „elsőnek" néztem, az lehet a hátsó pár is.
#
# Ami viszont EGYÉRTELMŰ: a POTROH a hátsó vég, és az a nagyobb. Egy pók
# tömegének a java hátul van. Tehát a mesh tömegeloszlása megmondja az
# irányt — nem a csontváz, hanem a test.
# A LEGTÖBB CSÚCSÚ mesh, nem az első.
#
# A Meshy rigelője egy 42 csúcsú `Icosphere`-t is belerak a fájlba, és az
# importáláskor előbb jön, mint a pók. Az elsőt választva a tömegeloszlást
# egy gömbön mértem — ami definíció szerint szimmetrikus, tehát a válasz
# gyakorlatilag véletlen volt.
mesh_obj = max(
    (o for o in bpy.data.objects if o.type == 'MESH'),
    key=lambda o: len(o.data.vertices),
)
print("mesh:", mesh_obj.name, len(mesh_obj.data.vertices), "csúcs")
coords = [mesh_obj.matrix_world @ v.co for v in mesh_obj.data.vertices]
mid_y = sum(c.y for c in coords) / len(coords)
front_mass = sum(1 for c in coords if c.y > mid_y)
rear_mass = len(coords) - front_mass

# A nehezebb vég a potroh, tehát az ELEJE az ellenkező irány.
heavier_is_plus_y = front_mass > rear_mass
# Blender (x, y, z) -> glTF (x, z, -y): a Blender +Y a glTF -Z felé mutat.
forward_gltf = [0.0, 0.0, 1.0 if heavier_is_plus_y else -1.0]
print("csúcsok +Y felől: %d, -Y felől: %d  → a potroh a %s oldalon"
      % (front_mass, rear_mass, '+Y' if heavier_is_plus_y else '-Y'))
print("előre (glTF):", forward_gltf)

json.dump({'legs': legs, 'body': body, 'root': root.name, 'forward': forward_gltf},
          open(out, 'w'), indent=1)
print("KIIRVA", out)
