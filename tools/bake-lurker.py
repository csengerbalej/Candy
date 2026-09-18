"""
EGY SZÖRNY BEÉPÍTÉSE — fogyasztás és HORRORFESTÉS.

Két dolgot old meg, és mindkettő olyan, amit a generátor nem ad meg:

1. A NYERS MODELL 248 EZER HÁROMSZÖG. Három ilyen a házban háromnegyed
   millió — annyi, mint az egész város volt, mielőtt kimértük és levágtuk.
   A Blender Decimate viszi le nyolcezerre, és a csontsúlyokat megtartja,
   tehát a mozgás átmegy rajta.

2. NINCS RAJTA TEXTÚRA. Se kép, se UV — csak nyers háló. Textúrát nem is
   lehet ráfeszíteni UV nélkül, viszont CSÚCSSZÍNT igen, és egy sötétben
   álló szörnynél az pont elég: a részletet úgysem a felület adja, hanem a
   sziluett és az, ahogy a lámpád fénye végigsöpör rajta.

   A festés szándékosan NEM halloweeni: nincs narancs, nincs lila, nincs
   vidám kontraszt. Hullaszürke és kékesfekete, a mélyedésekben sötétebb,
   foltokban piszkos — az a fajta szín, ami nem díszít, hanem betegnek
   néz ki.

  blender -b -P tools/bake-lurker.py -- be.glb ki.glb [háromszög] [árnyalat]
"""
import bpy, sys, math, random
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
target = int(argv[2]) if len(argv) > 2 else 8000
# Az árnyalat: 0 = hullaszürke, 1 = kékes-fekete, 2 = zöldes-fekete.
tone = int(argv[3]) if len(argv) > 3 else 0

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)

meshes = [o for o in bpy.data.objects if o.type == 'MESH']
before = sum(len(o.data.polygons) for o in meshes)
ratio = min(1.0, target / max(1, before))

for ob in meshes:
    bpy.context.view_layer.objects.active = ob
    mod = ob.modifiers.new('fogyas', 'DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = ratio
    # A csontsúlyok a csúcsokkal együtt vonódnak össze — ezért marad a
    # mozgás. Ha ezt kikapcsolnánk, a modell fogyna, a rigg maradna, és a
    # kettő elcsúszása némán tönkretenné az animációt.
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)

PALETTE = [
    ((0.42, 0.40, 0.38), (0.10, 0.09, 0.09)),   # hullaszürke
    ((0.26, 0.29, 0.36), (0.05, 0.06, 0.09)),   # kékes-fekete
    ((0.25, 0.30, 0.25), (0.05, 0.07, 0.05)),   # zöldes-fekete
]
top, bottom = PALETTE[tone % len(PALETTE)]

random.seed(7)
for ob in meshes:
    me = ob.data
    if not me.vertex_colors:
        me.vertex_colors.new(name='szin')
    layer = me.vertex_colors.active

    lo = min((ob.matrix_world @ v.co).z for v in me.vertices)
    hi = max((ob.matrix_world @ v.co).z for v in me.vertices)
    span = max(1e-6, hi - lo)

    # Foltok: néhány tucat véletlen gömb, amiken belül sötétebb a szín. Egy
    # egyenletesen festett test gumibabának látszik; a folt piszoknak.
    blobs = [(Vector((random.uniform(-1, 1), random.uniform(-1, 1), random.uniform(lo, hi))),
              random.uniform(0.08, 0.3)) for _ in range(28)]

    for poly in me.polygons:
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index
            co = ob.matrix_world @ me.vertices[vi].co
            t = (co.z - lo) / span
            # LENT SÖTÉTEBB: a láb és a földhöz közeli rész elnyeli a fényt.
            # Ez a legolcsóbb árnyékolás, ami mégis testet ad a formának.
            k = 0.25 + 0.75 * t
            c = [bottom[i] + (top[i] - bottom[i]) * k for i in range(3)]
            for centre, r in blobs:
                d = (co - centre).length
                if d < r:
                    f = 1 - (d / r)
                    c = [ch * (1 - 0.55 * f) for ch in c]
            # A NORMÁL is számít: a lefelé néző lapok sötétebbek. Egy
            # szörny, aminek az álla alja ugyanolyan világos, mint a
            # homloka, lapos marad a sötétben.
            n = me.vertices[vi].normal
            c = [ch * (0.62 + 0.38 * max(0.0, n.z * 0.5 + 0.5)) for ch in c]
            layer.data[li].color = (c[0], c[1], c[2], 1.0)

    mat = bpy.data.materials.new('szorny')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.96
    bsdf.inputs['Metallic'].default_value = 0.0
    attr = mat.node_tree.nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'szin'
    mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    ob.data.materials.clear()
    ob.data.materials.append(mat)

bpy.ops.export_scene.gltf(
    filepath=dst,
    export_format='GLB',
    export_animations=True,
    export_skins=True,

)
after = sum(len(o.data.polygons) for o in meshes)
print(f'SZORNY {before} -> {after}')
