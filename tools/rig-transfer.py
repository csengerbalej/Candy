"""
Transfer the werewolf's skeleton onto another character mesh, in Blender.

Why this exists: two of the four characters arrived without a rig, and every
rigged character in this project sits on the same 28-bone skeleton. Copying that
skeleton onto a new mesh and letting Blender solve the weights gets a playable
character out of a static sculpt without going back to the authoring tool.

It is automatic weighting, so it is good, not perfect — a mesh whose
proportions differ sharply from the donor will show it at the shoulders and
hips. Check the result before shipping it.

  blender -b -P tools/rig-transfer.py -- <donor.glb> <target.glb> <out.glb>
"""
import sys
import bpy
from mathutils import Vector

argv = sys.argv[sys.argv.index("--") + 1:]
donor_path, target_path, out_path = argv[:3]
# Optional: restrict which bones may deform the mesh. A shape with no arms and
# no legs still gets arm and leg bones from the donor skeleton, and automatic
# weighting will happily stretch part of its body out along them — the ghost
# grew a two-metre tendril before this existed. Limiting it to the spine turns
# the same skeleton into a gentle sway.
spine_only = "--spine-only" in argv
# Some sculpts come out of the authoring tool lying down. Standing the mesh up
# before binding is the difference between a spine that runs head-to-toe and
# one that runs nose-to-tail.
stand_up = "--stand-up" in argv
SPINE_BONES = {
    "Hips", "Spine", "Spine01", "Spine02",
    "neck", "Head", "head_end", "headfront",
}


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_glb(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return [o for o in bpy.data.objects if o not in before]


def world_bounds(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector((min(lo[i], p[i]) for i in range(3)))
            hi = Vector((max(hi[i], p[i]) for i in range(3)))
    return lo, hi


reset()

# --- donor: keep the armature, discard its mesh ---------------------------
donor_objects = import_glb(donor_path)
armature = next(o for o in donor_objects if o.type == "ARMATURE")
donor_meshes = [o for o in donor_objects if o.type == "MESH"]
donor_lo, donor_hi = world_bounds(donor_meshes)
donor_height = donor_hi.z - donor_lo.z
# Kept alive as a weight donor: if heat weighting fails on the target, its
# solved weights can be transferred across by proximity instead.
donor_mesh = donor_meshes[0] if donor_meshes else None
for mesh in donor_meshes[1:]:
    bpy.data.objects.remove(mesh, do_unlink=True)

# Bake the armature's import transform away, so the target can be matched
# against plain world coordinates.
bpy.ops.object.select_all(action="DESELECT")
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
bpy.ops.object.transform_apply(location=False, rotation=True, scale=True)

# --- target: scale and seat it inside the donor's skeleton ----------------
target_objects = import_glb(target_path)
target_meshes = [o for o in target_objects if o.type == "MESH"]
if not target_meshes:
    raise SystemExit("no mesh in target")

bpy.ops.object.select_all(action="DESELECT")
for mesh in target_meshes:
    mesh.select_set(True)
bpy.context.view_layer.objects.active = target_meshes[0]
if len(target_meshes) > 1:
    bpy.ops.object.join()
target = bpy.context.view_layer.objects.active
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Heat weighting solves a system over the mesh surface and gives up on
# degenerate geometry — which is exactly what aggressive decimation produces.
# Cleaning first is the difference between a rigged character and a statue.
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.mesh.remove_doubles(threshold=0.0004)
bpy.ops.mesh.delete_loose()
bpy.ops.mesh.normals_make_consistent(inside=False)
bpy.ops.object.mode_set(mode="OBJECT")

if stand_up:
    target.rotation_euler = (1.5707963, 0.0, 0.0)
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)

lo, hi = world_bounds([target])
height = hi.z - lo.z
scale = donor_height / height if height > 1e-6 else 1.0
target.scale = (scale, scale, scale)
bpy.context.view_layer.update()

lo, hi = world_bounds([target])
centre = (lo + hi) * 0.5
# Match feet to feet and centre the torso: a mesh floating above the hip bone
# gets weighted as if it were a hat.
target.location = (
    target.location.x - centre.x + (donor_lo.x + donor_hi.x) * 0.5,
    target.location.y - centre.y + (donor_lo.y + donor_hi.y) * 0.5,
    target.location.z - lo.z + donor_lo.z,
)
bpy.ops.object.transform_apply(location=True, rotation=False, scale=True)

# --- bind ------------------------------------------------------------------
bpy.ops.object.select_all(action="DESELECT")
target.select_set(True)
armature.select_set(True)
bpy.context.view_layer.objects.active = armature
result = bpy.ops.object.parent_set(type="ARMATURE_AUTO")
print(f"parent_set: {result}")

# Bone-heat weighting fails on meshes it cannot solve (open shells, stray
# geometry) and Blender only warns. Without the modifier the export is a
# static mesh that looks correct and animates not at all, so check explicitly.
if not any(m.type == "ARMATURE" for m in target.modifiers):
    print("parent_set left no armature modifier; binding by envelope instead")
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    armature.select_set(True)
    bpy.context.view_layer.objects.active = armature
    bpy.ops.object.parent_set(type="ARMATURE_ENVELOPE")

def weighted_count():
    return sum(
        1 for v in target.data.vertices if any(g.weight > 0.0001 for g in v.groups)
    )


weighted = weighted_count()
print(f"súlyozott csúcs (hő): {weighted}/{len(target.data.vertices)}")

if weighted == 0 and donor_mesh is not None:
    # Fall back to copying the donor's already-solved weights by proximity.
    # Cruder than a real solve, but a character that deforms roughly right
    # beats a character that does not deform at all.
    print("hősúlyozás elhasalt — súlyátvitel a donorról")
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    transfer = target.modifiers.new(name="WeightTransfer", type="DATA_TRANSFER")
    transfer.object = donor_mesh
    transfer.use_vert_data = True
    transfer.data_types_verts = {"VGROUP_WEIGHTS"}
    transfer.vert_mapping = "POLYINTERP_NEAREST"
    bpy.ops.object.datalayout_transfer(modifier=transfer.name)
    bpy.ops.object.modifier_apply(modifier=transfer.name)
    weighted = weighted_count()
    print(f"súlyozott csúcs (átvitel): {weighted}/{len(target.data.vertices)}")

if weighted == 0:
    raise SystemExit("no vertex received any weight")

if spine_only:
    removed = [g.name for g in target.vertex_groups if g.name not in SPINE_BONES]
    for name in removed:
        target.vertex_groups.remove(target.vertex_groups[name])
    # Weights no longer sum to 1 after dropping groups; normalise so the mesh
    # follows the spine fully instead of collapsing toward the origin.
    bpy.ops.object.select_all(action="DESELECT")
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.vertex_group_normalize_all(lock_active=False)
    print(f"végtagcsontok eltávolítva: {len(removed)}")

if donor_mesh is not None:
    bpy.data.objects.remove(donor_mesh, do_unlink=True)

modifiers = [m.type for m in target.modifiers]
print(f"modifiers: {modifiers}")
if not any(m == "ARMATURE" for m in modifiers):
    raise SystemExit("binding failed: no armature modifier")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=out_path,
    export_format="GLB",
    export_animations=False,
    export_skins=True,
    export_apply=False,
)

groups = len(target.vertex_groups)
print(f"RIGGED {out_path}  csontcsoport: {groups}  magasság: {donor_height:.2f}")
