#!/bin/bash
# Bake the Meshy village diorama into something a browser can load.
#
# The download is 96 MB: 1.44M triangles, an 8K base colour and a 4K normal and
# metallic-roughness pair. None of that survives contact with a web build, and
# most of it was never going to be seen — the town is cel-shaded, and toonify
# drops normal maps on purpose because fine surface detail fights flat banding.
#
# The baked .glb stays in raw/: what the game serves is village.json, the same
# base64 wrapper every other model uses, because the artifact host will not
# serve model/gltf-binary. Shipping both would publish the village twice.
#
#   ./tools/bake-village.sh raw/village.glb raw/village.baked.glb 220000 4096
#   node tools/pack-models.mjs   # or the one-liner in the README
set -euo pipefail
IN="$1"; OUT="$2"; TRIS="${3:-220000}"; TEX="${4:-4096}"
# Mennyit szabad TORZULNIA a formának. Fix 0,001 volt, és ez a szám állította
# meg az egyszerűsítést jóval a cél előtt: a négy házból nyolcezres célra
# 12000–32000 jött ki, sőt az egyik NŐTT. A hibakorlát a modell méretéhez
# arányos, tehát nem lehet minden modellre ugyanaz.
ERR="${5:-0.001}"
TMP="$(mktemp -d)"

echo "  1/6 weld"
npx gltf-transform weld "$IN" "$TMP/a.glb" >/dev/null

echo "  2/6 a nem használt textúrák eldobása"
node tools/strip-maps.mjs "$TMP/a.glb" "$TMP/b.glb"

CUR=$(node tools/count-tris.mjs "$TMP/b.glb")
RATIO=$(node -e "console.log(Math.min(1, $TRIS / $CUR).toFixed(5))")
echo "  3/6 simplify: $CUR háromszög → cél $TRIS (arány $RATIO)"
npx gltf-transform simplify "$TMP/b.glb" "$TMP/c.glb" --ratio "$RATIO" --error "$ERR" >/dev/null

echo "  4/6 resize $TEX"
npx gltf-transform resize "$TMP/c.glb" "$TMP/d.glb" --width "$TEX" --height "$TEX" >/dev/null

echo "  5/6 webp"
npx gltf-transform webp "$TMP/d.glb" "$TMP/e.glb" --quality 82 >/dev/null

echo "  6/6 prune"
npx gltf-transform dedup "$TMP/e.glb" "$TMP/f.glb" >/dev/null
npx gltf-transform prune "$TMP/f.glb" "$OUT" >/dev/null

ls -lh "$OUT"
node tools/inspect-glb.mjs "$OUT"
rm -rf "$TMP"
