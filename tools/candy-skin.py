"""
Cukorka-bőr a letöltött fegyvermodellekre.

A letöltött három fegyver fotórealista fém. A játék viszont lila-narancs
halloween, cel-shadinggel: egy szürke acélcső ott IDEGEN TÁRGY, akármilyen
jól van modellezve. Ez a szkript kicseréli az alapszín-textúrát egy magunk
festett, ferde cukorkacsíkosra — az UV-k maradnak, tehát a csík követi a
forma tagolását, és a fegyver „becsomagolt édesség" lesz, nem fegyver.

Készít hozzá saját fém-érdesség beállítást is: a játék toon-rámpája a
csillogó fémből fehér foltot csinál, a matt felületből viszont tiszta,
olvasható színt.

  blender -b -P tools/candy-skin.py -- be.glb ki.glb <fo> <mellek> <izzo>
"""
import bpy, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:]
src, dst = argv[0], argv[1]
# A SÁV SZÉLESSÉGE képpontban. Nem díszítés: a szűk sáv az UV-szigetekre
# darabolt modellen (mesterlövész, rakétavető) terepmintává esik szét, mert
# minden sziget máshol vágja el a csíkot. A széles sáv nagy, sima foltokat ad,
# és azokból lesz olvasható tárgy.
BAND = int(argv[5]) if len(argv) > 5 else 26
MAIN = argv[2] if len(argv) > 2 else '6A3AB8'     # lila
ACCENT = argv[3] if len(argv) > 3 else 'FF7A29'   # tök-narancs
GLOW = argv[4] if len(argv) > 4 else '6EF0C0'     # méregzöld

def rgb(hexa):
    return tuple(int(hexa[i:i + 2], 16) / 255 for i in (0, 2, 4))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = next(o for o in bpy.data.objects if o.type == 'MESH')

# A CSÍKOS KÉP. Ferde sávok, mert a vízszintes gyűrű csőnek látszik, a ferde
# viszont becsomagolt cukorkának — ez a különbség teszi a fegyvert a játék
# tárgyává.
SIZE = 512
img = bpy.data.images.new('candy', SIZE, SIZE)
main, accent, glow = rgb(MAIN), rgb(ACCENT), rgb(GLOW)
px = [0.0] * (SIZE * SIZE * 4)
for y in range(SIZE):
    for x in range(SIZE):
        band = ((x + y) // BAND) % 8
        # NYOLC sávból EGY az ékszín és EGY a kiemelés: a maradék hat a
        # főszín. Autónál ez a helyes arány — egy nagy, egyszínű karosszéria
        # néhány csíkkal. Öt sávból kettő ékszín (a korábbi arány) a
        # széttöredezett UV-n terepmintát adott, nem járművet.
        if band == 0:
            c = accent
        elif band == 4:
            c = glow
        else:
            c = main
        # Halvány szemcse, hogy a sík szín ne legyen műanyag.
        n = 0.94 + ((x * 7 + y * 13) % 11) / 100
        i = (y * SIZE + x) * 4
        px[i] = c[0] * n
        px[i + 1] = c[1] * n
        px[i + 2] = c[2] * n
        px[i + 3] = 1.0
img.pixels = px
img.pack()

mat = bpy.data.materials.new('CandyWeapon')
mat.use_nodes = True
nodes = mat.node_tree.nodes
links = mat.node_tree.links
nodes.clear()
out = nodes.new('ShaderNodeOutputMaterial')
bsdf = nodes.new('ShaderNodeBsdfPrincipled')
tex = nodes.new('ShaderNodeTexImage')
tex.image = img
links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
# Matt és nem fémes: a toon-rámpa a csillogásból fehér foltot csinálna.
bsdf.inputs['Roughness'].default_value = 0.72
bsdf.inputs['Metallic'].default_value = 0.0
links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])

obj.data.materials.clear()
obj.data.materials.append(mat)

bpy.ops.export_scene.gltf(filepath=dst, export_format='GLB', export_yup=True,
                          export_image_format='WEBP')
print('BOR KESZ', dst)
