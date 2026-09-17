/**
 * Már kiadott modell javítása ÚJRA-BAKE NÉLKÜL.
 *
 *   node tools/repair-baked.mjs <be.json> <ki.json> [--meshopt]
 *
 * Két dolgot csinál, és egyiktől sem mozdul egyetlen háromszög sem — ez fontos,
 * mert a ház és a falu navigációs rácsa (house1-nav.json, village-nav.json) a
 * MOSTANI csúcsokhoz lett mérve, és egy új simplify futás csendben elcsúsztatná.
 *
 * 1. Anyagfaktorok. A strip-maps.mjs kivette a fém-érdesség térképet, de a
 *    faktorokat nem írta vissza — és a glTF-ben a hiányzó metallicFactor 1.0-t
 *    jelent, vagyis tökéletes fémet, aminek nincs diffúz színe. Mérve: a falu
 *    renderje emiatt 17,8 dB PSNR-en állt az eredetihez képest, javítás után
 *    27,1 dB (a látható eltérés 75,5% → 21,5%). A játékban ez ma lappang, mert
 *    a MeshToonMaterial nem olvas fémességet — de minden PBR-nézet fémnek látja.
 *
 * 2. --meshopt: EXT_meshopt_compression a geometriára. A pozíciókat 14 biten
 *    kvantálja, ami a ház 67 méteres léptékén ~4 mm — nagyságrendekkel a
 *    rácscella alatt. CSAK ott szabad bekapcsolni, ahol a betöltő tud róla:
 *    a VillageHouse (house1) setMeshoptDecoder-rel indul, a VillageWorld és a
 *    ModelLoader NEM — ott a modell némán üres marad.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { reorder, quantize } from '@gltf-transform/functions';
import { MeshoptEncoder } from 'meshoptimizer';
import { readFileSync, writeFileSync } from 'node:fs';

const [, , inPath, outPath, ...flags] = process.argv;
const useMeshopt = flags.includes('--meshopt');

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.readBinary(Buffer.from(JSON.parse(readFileSync(inPath, 'utf8')).glb, 'base64'));

for (const material of doc.getRoot().listMaterials()) {
  // Csak ott írjuk vissza, ahol a térkép tényleg hiányzik: ha van fém-érdesség
  // lap (a karakterek, az autó), az a mérvadó, és nem szabad felülbírálni.
  if (material.getMetallicRoughnessTexture()) continue;
  material.setMetallicFactor(0);
  material.setRoughnessFactor(0.9);
}

if (useMeshopt) {
  await MeshoptEncoder.ready;
  await doc.transform(
    reorder({ encoder: MeshoptEncoder, target: 'performance' }),
    quantize(),
  );
  doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: 'quantize' });
}

const glb = Buffer.from(await io.writeBinary(doc));
writeFileSync(outPath, JSON.stringify({ glb: glb.toString('base64') }));
console.log(
  `${outPath.split('/').pop()}  glb ${(glb.length / 1e6).toFixed(2)} MB  ` +
    `→ json ${(readFileSync(outPath).length / 1e6).toFixed(2)} MB${useMeshopt ? '  (meshopt)' : ''}`
);
