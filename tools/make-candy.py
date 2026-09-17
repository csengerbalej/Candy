"""
Egy becsomagolt cukorka, geometriából.

Szaloncukor-forma: gömbölyded test, két végén CSAVART papír. A csavarás a
lényeg — ettől olvasható egy pillanat alatt, még tíz méterről, egy sötét
utcán is, és ez fontosabb, mint bármilyen felületi részlet: ez a tárgy egy
mozgó autóból, félmásodpercre látszik.

Nem véletlenszerű: minden példány ugyanaz a forma, csak a papír színe más.
Négy szín, mert négy szörny van, és így a csomagolás maga is a játék nyelvén
beszél.

    blender -b -P tools/make-candy.py -- raw/candy-wrapped.glb
"""
import bpy, bmesh, math, sys
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'raw/candy-wrapped.glb'

bpy.ops.wm.read_factory_settings(use_empty=True)

# --- A test -----------------------------------------------------------------
# Nem gömb és nem henger: egy henger, aminek a közepe kidudorodik. A gömb
# bonbon, a henger tabletta; ez szaloncukor.
BODY_R = 0.42
BODY_L = 1.08
# Tíz redő: páros szám kell, hogy a be-ki váltakozás körbeérjen, és tíznél
# kevesebb már nem papír, hanem sokszög.
SEG = 20

mesh = bpy.data.meshes.new('candy')
bm = bmesh.new()

rings = []
STEPS = 14
for k in range(STEPS + 1):
    t = k / STEPS                      # 0..1 a test hossza mentén
    z = (t - 0.5) * BODY_L
    # A profil: koszinusz-dudor, a végein 62%-ra szűkülve. A papír ott fogja.
    r = BODY_R * (0.74 + 0.26 * math.cos((t - 0.5) * math.pi))
    ring = [bm.verts.new((math.cos(a / SEG * math.tau) * r,
                          math.sin(a / SEG * math.tau) * r, z)) for a in range(SEG)]
    rings.append(ring)

body_faces = []
for k in range(STEPS):
    a, b = rings[k], rings[k + 1]
    for i in range(SEG):
        j = (i + 1) % SEG
        body_faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))

# --- A csavart papír a két végén --------------------------------------------
# Kúp, amit menet közben MEGCSAVARUNK. A csavarás szöge a hossz mentén nő,
# ettől lesz a papírnak sodrása ahelyett, hogy sima tölcsér lenne.
TWIST = math.radians(280)
TAIL = 0.72
TAIL_STEPS = 14


def tail_radius(t: float) -> float:
    """A papír profilja a test végétől a csücsökig.

    Három szakasz, és a középső a lényeg: BEFŰZÉS, majd újra KISZÉLESEDÉS.
    Enélkül a forma citrom marad — a test simán elkeskenyedik, és semmi nem
    mondja meg, hogy ez egy becsomagolt tárgy. A szűk nyak az, amitől
    „összefogták", a mögötte kibomló papír pedig az, amitől „csomagolás".
    """
    if t < 0.16:                      # a nyak: gyorsan összefogva
        return 0.74 - (0.74 - 0.20) * (t / 0.16)
    if t < 0.42:                      # a papír újra kibomlik
        return 0.20 + (0.52 - 0.20) * ((t - 0.16) / 0.26)
    k = min(1.0, (t - 0.42) / 0.58)   # és elfogy a csücsökig
    return 0.52 * (1 - k) ** 0.75 + 0.03

for side in (-1, 1):
    prev = rings[-1 if side > 0 else 0]
    base_z = side * BODY_L / 2
    for k in range(1, TAIL_STEPS + 1):
        t = k / TAIL_STEPS
        z = base_z + side * TAIL * t
        # A sugár gyorsan fogy, de nem nullára: a vége lapos, tépett papír.
        r = BODY_R * tail_radius(t)
        # Redőzés: minden második csúcs beljebb, ettől van bordázata.
        spin = TWIST * t ** 1.3 * side
        ring = []
        for a in range(SEG):
            ang = a / SEG * math.tau + spin
            # Mély redő: a papír bordái adják a csavarás olvashatóságát. A
            # sekély változat gyakorlatilag sima tölcsérnek látszott.
            # A redő a NYAK UTÁN mély, a nyakban sekély: ott a papír össze
            # van szorítva, nem áll el.
            # A redő a nyak után nyílik ki, a csücsök felé pedig ELFOGY:
            # a végén a papír egy pontba van csavarva, nem csillagba. A
            # csillag-vég tüskés dióféle látszatot adott, nem cukorkát.
            depth = 0.24 * min(1.0, max(0.0, (t - 0.16) / 0.2)) * (1 - t) ** 0.6
            rr = r * (1 + depth if a % 2 == 0 else 1 - depth)
            ring.append(bm.verts.new((math.cos(ang) * rr, math.sin(ang) * rr, z)))
        for i in range(SEG):
            j = (i + 1) % SEG
            if side > 0:
                bm.faces.new((prev[i], prev[j], ring[j], ring[i]))
            else:
                bm.faces.new((prev[j], prev[i], ring[i], ring[j]))
        prev = ring
    # A lezáró lap.
    bm.faces.new(prev if side > 0 else list(reversed(prev)))

# A papír külön anyagot kap. Nem díszítés: EGYSZÍNŰEN a sziluett olvashatatlan
# volt — egy narancs folt az utcán bármi lehet. A világos, csavart papír és a
# telt színű test kettőse az, amit fél másodperc alatt fel lehet ismerni.
body_set = set(body_faces)
for f in bm.faces:
    f.material_index = 0 if f in body_set else 1

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
bm.to_mesh(mesh)
bm.free()

obj = bpy.data.objects.new('candy', mesh)
bpy.context.collection.objects.link(obj)

# Sima árnyalás, de a papír élei maradjanak élesek: az „auto smooth" a
# csavarás redőit megtartja, a test dudorát pedig elsimítja.
for poly in mesh.polygons:
    poly.use_smooth = True
# Élszétválasztás szög szerint: a papír csavart redői élesek maradnak, a
# test dudora elsimul. Ez a modifier minden Blender-verzióban létezik.
split = obj.modifiers.new('elek', 'EDGE_SPLIT')
split.split_angle = math.radians(38)

# --- Anyag ------------------------------------------------------------------
# Világító: a cukorka SÖTÉTBEN is látszik, mert különben egy éjszakai játékban
# egy fél méteres tárgyat sosem találnál meg. Az emisszió nem díszítés, hanem
# a megtalálhatóság.
mat = bpy.data.materials.new('candy')
mat.use_nodes = True
bsdf = mat.node_tree.nodes['Principled BSDF']
bsdf.inputs['Base Color'].default_value = (0.95, 0.24, 0.05, 1)
bsdf.inputs['Roughness'].default_value = 0.34
bsdf.inputs['Emission Color'].default_value = (1.0, 0.36, 0.08, 1)
bsdf.inputs['Emission Strength'].default_value = 0.35
obj.data.materials.append(mat)

paper = bpy.data.materials.new('candy-paper')
paper.use_nodes = True
pb = paper.node_tree.nodes['Principled BSDF']
pb.inputs['Base Color'].default_value = (1.0, 0.88, 0.62, 1)
pb.inputs['Roughness'].default_value = 0.62
pb.inputs['Emission Color'].default_value = (1.0, 0.86, 0.60, 1)
pb.inputs['Emission Strength'].default_value = 0.22
obj.data.materials.append(paper)

# A talpára állítjuk: a játék Y-ban felfelé néz, és a cukorka az oldalán
# fekszik az utcán.
obj.rotation_euler = (math.radians(90), 0, 0)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True,
                          export_apply=True)
print('KESZ', OUT, len(mesh.polygons), 'lap')
