/**
 * Merge the town's 57 separate GLBs into one bundle, and copy the layout.
 *
 * Fifty-seven HTTP requests and fifty-seven glTF parses to draw one street is
 * absurd when the whole library is 4 MB. Merged, it is a single fetch and a
 * single parse, and every placement is a clone of a node already in memory.
 *
 *   node tools/bundle-town.mjs <city-dir> <out-dir>
 */
import { NodeIO, Document } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, unpartition, textureCompress } from '@gltf-transform/functions';
import sharp from 'sharp';
import { mergeDocuments } from '@gltf-transform/functions';
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';

const [cityDir, outDir, layoutName = 'drive_town_layout.json'] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
mkdirSync(outDir, { recursive: true });

const layoutPath = join(cityDir, 'export', layoutName);
const layoutJson = JSON.parse(readFileSync(layoutPath, 'utf8'));
// Only what this town actually places. The library holds every asset the
// authoring project has ever produced; shipping the unused ones is pure weight.
const used = new Set(layoutJson.instances.map((i) => i.asset));

const glbDir = join(cityDir, 'export', 'glb');
const files = readdirSync(glbDir)
  .filter((f) => f.endsWith('.glb') && used.has(basename(f, '.glb')))
  .sort();

const bundle = new Document();
const bundleScene = bundle.createScene('town');

for (const file of files) {
  const name = basename(file, '.glb');
  const doc = await io.read(join(glbDir, file));

  const map = mergeDocuments(bundle, doc);
  // Every asset becomes one named node under the bundle's scene, so the
  // runtime can look a placement up by the exact name the layout uses.
  const holder = bundle.createNode(name);
  for (const scene of doc.getRoot().listScenes()) {
    const merged = map.get(scene);
    for (const child of merged.listChildren()) holder.addChild(child);
  }
  bundleScene.addChild(holder);
}

// Drop the source scenes that came along with each merge.
for (const scene of bundle.getRoot().listScenes()) {
  if (scene !== bundleScene) scene.dispose();
}
bundle.getRoot().setDefaultScene(bundleScene);

/**
 * The town is cel-shaded at runtime, and a toon material samples exactly two
 * textures: base colour and emissive. Normal, roughness and occlusion maps are
 * downloaded, decoded and uploaded to the GPU purely to be ignored — so they
 * are dropped here rather than shipped.
 *
 * Emissive is kept deliberately: it is what lights the jack-o'-lanterns, the
 * windows and the string lights, and none of that survives being replaced by a
 * flat fill.
 */
for (const material of bundle.getRoot().listMaterials()) {
  material.setNormalTexture(null);
  material.setMetallicRoughnessTexture(null);
  material.setOcclusionTexture(null);
}

/**
 * The authored pack ships 4K maps per asset — 73 MB of texture for a town seen
 * at night from ten metres away. Scenery gets 512px; the geometry is already
 * cheap (100k triangles for the whole library), so texture is the whole budget.
 */
await bundle.transform(
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 80, resize: [512, 512] }),
  prune(),
  unpartition()
);

const glb = Buffer.from(await io.writeBinary(bundle));
writeFileSync(join(outDir, 'town.json'), JSON.stringify({ glb: glb.toString('base64') }));

const layout = layoutJson;
writeFileSync(join(outDir, 'town-layout.json'), JSON.stringify(layout));

console.log(`${files.length} asset → town.json  ${(glb.length / 1e6).toFixed(2)} MB`);
console.log(`layout: ${layoutName} — ${layout.instances.length} instance, ${layout.lights.length} fény, ${layout.drive?.houses?.length ?? 0} ház`);
