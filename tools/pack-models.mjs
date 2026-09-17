/**
 * Wrap each baked .glb as base64 inside a .json.
 *
 * The published host only serves standard web media types, and model/gltf-binary
 * is not one of them. JSON is. The cost is ~33% over the wire; the benefit is a
 * single asset path that works in dev and published alike, with no branching in
 * the loader.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const dir = 'public/models';
for (const file of readdirSync(dir)) {
  if (!file.endsWith('.glb')) continue;
  // Rigged characters are produced by bake-rigged / bake-character, which write
  // the .json directly. Re-packing a leftover .glb here would silently replace
  // a skinned character with its static export.
  const target = join(dir, file.replace(/\.glb$/, '.json'));
  if (existsSync(target) && readFileSync(target, 'utf8').length > readFileSync(join(dir, file)).length * 1.4) {
    console.log(`${file} → kihagyva (riggelt .json már létezik)`);
    continue;
  }
  const bytes = readFileSync(join(dir, file));
  const out = join(dir, file.replace(/\.glb$/, '.json'));
  writeFileSync(out, JSON.stringify({ glb: bytes.toString('base64') }));
  console.log(`${file} → ${out.split('/').pop()}  (${(bytes.length / 1e6).toFixed(2)} MB → ${(bytes.length * 1.34 / 1e6).toFixed(2)} MB)`);
}
