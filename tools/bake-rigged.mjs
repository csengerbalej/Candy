/**
 * Bake one rigged character: keep the mesh, skeleton and whatever clips it
 * shipped with; drop Meshy's duplicate clips and shrink the textures.
 *
 *   node tools/bake-rigged.mjs <in.glb> <out.json>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, resample } from '@gltf-transform/functions';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

const [input, output] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

const seen = new Set();
for (const anim of doc.getRoot().listAnimations()) {
  if (seen.has(anim.getName())) anim.dispose();
  else seen.add(anim.getName());
}

await doc.transform(
  resample(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, resize: [2048, 2048] }),
  prune()
);

const glb = Buffer.from(await io.writeBinary(doc));
writeFileSync(output, JSON.stringify({ glb: glb.toString('base64') }));
console.log(`${output.split('/').pop()}  ${(glb.length / 1e6).toFixed(2)} MB  klipek: ${[...seen].join(', ')}`);
