"""
Paint the apartment.

The download is one material, no textures, no UVs and no vertex colours — a
white plastic shape. Unwrapping 200k triangles to paint them is not the job;
VERTEX COLOURS are, because the mesh already has more than enough vertices to
carry the detail a cel-shaded night scene will show, and they cost no texture,
no UV set and no extra file.

Nothing here is hand-placed. Every face is classified from things that can be
measured — which way it faces, how high it is above the floor, which room it
stands in, and whether it belongs to the building's shell or to a loose object
sitting in it — and the palette is applied to those classes. The room map comes
from house-nav.py.

    floor      up-facing, at floor level          per-room: boards or tiles
    skirting   side-facing, just above the floor  dark trim everywhere
    wall       a face over a cell that reaches ceiling height
    furniture  a face over a cell that stands proud of the floor but stops
               well short of the ceiling
    outside    a face whose normal points out of the building

The floor/furniture/wall split is not a guess. Dropping a ray on every cell and
histogramming what it hits gives two clean bands with an empty gap between
them: 0.00-0.15 above the floor is furniture, 0.27-0.47 is walls, and nothing
at all lands in between. The thresholds below sit in that gap.

Islands were the first attempt — colour each loose object separately — and they
do not survive the pipeline: welding the Meshy export (which it needs, its
vertices come unmerged) fuses every sofa to the floor it rests on, leaving two
islands for the whole apartment.
"""
import bpy, bmesh, sys, json, math, random, mathutils
from collections import deque

src, navpath, out = sys.argv[-3], sys.argv[-2], sys.argv[-1]
nav = json.load(open(navpath))

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=src)
obj = [o for o in bpy.data.objects if o.type == 'MESH'][0]
bpy.context.view_layer.objects.active = obj
me = obj.data

# Weld first: the Meshy export leaves coincident vertices unmerged, which
# breaks both the island search below and any smooth shading.
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.remove_doubles(threshold=0.00012)
bpy.ops.object.mode_set(mode='OBJECT')
print("HEGESZTVE csucs", len(me.vertices), "lap", len(me.polygons))

N = nav['n']
MINX, MINY = nav['min'][0], nav['min'][1]
SPANX = nav['max'][0] - nav['min'][0]
SPANY = nav['max'][1] - nav['min'][1]
FLOOR = nav['floorZ']
TOP = nav['wallTop']

# --- rooms: what each one is ------------------------------------------------
# Read off the plan once, by where each room sits and what is in it. This is
# authored data about one authored asset — the honest way to say "the top-left
# room is the kitchen" — not a heuristic pretending to be a discovery.
ROOMS = {
    2:  'nappali',
    8:  'konyha',
    9:  'halo',
    6:  'eloszoba',
    5:  'furdo',
    3:  'wc',
    4:  'furdo',
    10: 'kamra',
}

def srgb(h):
    r = ((h >> 16) & 255) / 255.0
    g = ((h >> 8) & 255) / 255.0
    b = (h & 255) / 255.0
    # Blender colour attributes are linear; the game reads them back as sRGB.
    f = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    return (f(r), f(g), f(b), 1.0)

PALETTE = {
    'nappali':  {'floor': 0x7a4a2c, 'wall': 0xb9a68a, 'trim': 0x3a2617},
    'konyha':   {'floor': 0xb9b2a4, 'wall': 0x9fb7a8, 'trim': 0x3a3a34},
    'halo':     {'floor': 0x8a5734, 'wall': 0x9a8fb4, 'trim': 0x3a2a1c},
    'eloszoba': {'floor': 0x6d4628, 'wall': 0xa8968c, 'trim': 0x332216},
    'furdo':    {'floor': 0x9fb4c4, 'wall': 0x8fb0c2, 'trim': 0x35414a},
    'wc':       {'floor': 0xa8b6a2, 'wall': 0x93ab96, 'trim': 0x36413a},
    'kamra':    {'floor': 0x8a7c66, 'wall': 0x9a8e78, 'trim': 0x332a20},
    None:       {'floor': 0x8a8378, 'wall': 0xada396, 'trim': 0x332f28},
}
OUTSIDE_WALL = 0xc9c0b0
CEILING = 0xd8d2c6

# --- what stands where ------------------------------------------------------
HEIGHT = nav['height']
FURNITURE_MIN = 0.005      # above this, something is standing on the floor
FURNITURE_MAX = 0.20       # above this, it is a wall (the gap runs 0.15-0.27)

def cell_of(x, y):
    i = int((x - MINX) / SPANX * N)
    j = int((y - MINY) / SPANY * N)
    if not (0 <= i < N and 0 <= j < N):
        return None
    return i, j

def rise_at(x, y):
    """How far the geometry at this spot stands above the floor, or None."""
    c = cell_of(x, y)
    if c is None:
        return None
    h = HEIGHT[c[1]][c[0]]
    return None if h is None else h - FLOOR

# --- rooms everywhere, not just on the floor --------------------------------
# The room map labels floor cells only, so a wall or a wardrobe sits on cell 0
# and came out "outside" — two thirds of the mesh was painted as the building's
# exterior render. A wall belongs to the room it bounds, so the labels are
# grown outwards from the floor into every cell that has geometry at all.
room_grid = [[int(nav['rooms'][j][i]) for i in range(N)] for j in range(N)]
frontier = deque((i, j) for j in range(N) for i in range(N) if room_grid[j][i])
while frontier:
    i, j = frontier.popleft()
    for di, dj in ((1, 0), (-1, 0), (0, 1), (0, -1)):
        a, b = i + di, j + dj
        if 0 <= a < N and 0 <= b < N and room_grid[b][a] == 0 and HEIGHT[b][a] is not None:
            room_grid[b][a] = room_grid[j][i]
            frontier.append((a, b))

def room_at(x, y):
    c = cell_of(x, y)
    return 0 if c is None else room_grid[c[1]][c[0]]

def outside(x, y):
    """No geometry here at all: this spot is not part of the building."""
    c = cell_of(x, y)
    return c is None or HEIGHT[c[1]][c[0]] is None

# --- one colour per OBJECT --------------------------------------------------
# Furniture is coloured per piece, and a piece is a connected blob of cells that
# stand proud of the floor. Seeding the colour from a face's own position
# instead — the first attempt — quantised the sofa into wedges and painted it
# like a beach umbrella: a single object came out in four colours because its
# faces sat either side of the seed's rounding.
SOFT = {
    'nappali': 0x9d4b3c,   # rust sofa
    'halo': 0x42708f,      # blue bedding
    'konyha': 0x6b8f4e,
    'eloszoba': 0x7a4f86,
}

is_furniture_cell = [
    [HEIGHT[j][i] is not None and FURNITURE_MIN < HEIGHT[j][i] - FLOOR < FURNITURE_MAX
     for i in range(N)]
    for j in range(N)
]
blob = [[0] * N for _ in range(N)]
blob_colour = {0: 0x8e8577}
next_blob = 0
for j in range(N):
    for i in range(N):
        if not is_furniture_cell[j][i] or blob[j][i]:
            continue
        next_blob += 1
        q = deque([(i, j)]); blob[j][i] = next_blob; cells = []
        while q:
            a, b = q.popleft(); cells.append((a, b))
            for da, db in ((1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)):
                p, r = a + da, b + db
                if 0 <= p < N and 0 <= r < N and is_furniture_cell[r][p] and not blob[r][p]:
                    blob[r][p] = next_blob; q.append((p, r))
        peak = max(HEIGHT[b][a] - FLOOR for a, b in cells)
        cx = sum(a for a, _ in cells) / len(cells)
        cy = sum(b for _, b in cells) / len(cells)
        room = ROOMS.get(room_grid[int(cy)][int(cx)])
        area = len(cells) * nav['cell'] * nav['cell']
        if room in ('furdo', 'wc'):
            blob_colour[next_blob] = 0xdfe6ea          # sanitary ware is white
        elif peak < 0.10 and area > 0.008:
            # Low and broad: a bed, a sofa, an armchair. The soft furnishings
            # are the only things in a room that are allowed a strong colour,
            # and giving each room its own keeps a bedroom from looking like a
            # showroom of unrelated sofas.
            blob_colour[next_blob] = SOFT.get(room, 0xa8763a)
        elif area > 0.004:
            blob_colour[next_blob] = 0x7d6448          # cabinetry: wood, not grey
        else:
            blob_colour[next_blob] = 0x8e8577          # clutter
print("BUTORDARABOK", next_blob)

def furniture_colour(x, y):
    c = cell_of(x, y)
    return blob_colour.get(0 if c is None else blob[c[1]][c[0]], 0x8e8577)

# --- paint ------------------------------------------------------------------
if me.color_attributes:
    for a in list(me.color_attributes):
        me.color_attributes.remove(a)
layer = me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='CORNER')

SKIRTING = 0.012

counts = {}
for poly in me.polygons:
    c = poly.center
    n = poly.normal
    above = c.z - FLOOR
    rise = rise_at(c.x, c.y)
    room = ROOMS.get(room_at(c.x, c.y))
    pal = PALETTE.get(room, PALETTE[None])

    # Does this face look out of the building? Step a little way along its own
    # normal and see whether there is any building left there.
    faces_out = abs(n.z) < 0.6 and outside(c.x + n.x * 0.02, c.y + n.y * 0.02)

    if faces_out:
        kind = 'kulso'; col = OUTSIDE_WALL
    elif above < SKIRTING * 0.5 and n.z > 0.7:
        kind = 'padlo'; col = pal['floor']
    elif above < SKIRTING and abs(n.z) < 0.7:
        kind = 'lablec'; col = pal['trim']
    elif rise is not None and FURNITURE_MIN < rise < FURNITURE_MAX and above <= rise + 0.004:
        # At or below the top of whatever is standing here. Without the second
        # half of that test the wall BEHIND a sofa is over the sofa's cell too,
        # and gets painted in the sofa's colour — which is where the coloured
        # wedges climbing the walls came from.
        kind = 'butor'; col = furniture_colour(c.x, c.y)
    elif n.z < -0.7 and above > 0.30:
        kind = 'mennyezet'; col = CEILING
    else:
        kind = 'fal'; col = pal['wall']

    counts[kind] = counts.get(kind, 0) + 1
    rgba = srgb(col)
    for li in poly.loop_indices:
        layer.data[li].color = rgba

print("LAPOK", json.dumps(counts, ensure_ascii=False))

# The material has to actually read the colours, or the export carries them and
# nothing shows them.
mat = me.materials[0] if me.materials else bpy.data.materials.new('house')
mat.use_nodes = True
nt = mat.node_tree
bsdf = next(n for n in nt.nodes if n.type == 'BSDF_PRINCIPLED')
attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'Col'
nt.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
bsdf.inputs['Roughness'].default_value = 0.85
if not me.materials:
    me.materials.append(mat)

bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB',
    use_selection=False, export_apply=True,
    export_vertex_color='ACTIVE', export_normals=True,
    export_materials='EXPORT',
)
print("OK", out)
