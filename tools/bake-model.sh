#!/bin/bash
# Meshy exports are sculpting output, not game assets: millions of triangles and
# 4K textures. This bakes one down to something a 60fps scene can afford.
#
#   ./tools/bake-model.sh raw/car.glb public/models/car.glb 70000 2048
#
# Budget by how much of the screen the thing occupies, not by instinct. The car
# is on screen constantly and close to camera: 14k triangles and a 1K texture
# turned it to mush and the concept art was unrecognisable. At 70k/2K it reads,
# and the scene still runs at 60fps — one hero object can afford it. Reserve the
# small budgets for things there are dozens of.
set -euo pipefail
IN="$1"; OUT="$2"; TRIS="${3:-10000}"; TEX="${4:-1024}"
TMP="$(mktemp -d)"

npx gltf-transform weld     "$IN"          "$TMP/a.glb" >/dev/null
npx gltf-transform join     "$TMP/a.glb"   "$TMP/b.glb" >/dev/null

# meshopt simplification needs a triangle RATIO, so derive it from the target.
CUR=$(node tools/count-tris.mjs "$TMP/b.glb")
RATIO=$(node -e "console.log(Math.min(1, $TRIS / $CUR).toFixed(5))")
echo "  $CUR háromszög → cél $TRIS  (arány $RATIO)"

npx gltf-transform simplify "$TMP/b.glb"   "$TMP/c.glb" --ratio "$RATIO" --error 0.004 >/dev/null
npx gltf-transform resize   "$TMP/c.glb"   "$TMP/d.glb" --width "$TEX" --height "$TEX" >/dev/null
npx gltf-transform webp     "$TMP/d.glb"   "$TMP/e.glb" --quality 88 >/dev/null
npx gltf-transform dedup    "$TMP/e.glb"   "$TMP/f.glb" >/dev/null
npx gltf-transform prune    "$TMP/f.glb"   "$OUT"       >/dev/null

rm -rf "$TMP"
