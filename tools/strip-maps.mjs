/**
 * Drop the normal and metallic-roughness maps from every material.
 *
 * The village ships a 4K normal map and a 4K metallic-roughness map — 13 MB of
 * the download. The scene is cel-shaded, and toonify discards normal maps
 * anyway (fine surface detail fights flat banding and reads as noise), while
 * MeshToonMaterial has no metalness or roughness at all. Keeping them would
 * cost a third of the budget to feed two inputs nothing reads.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';

const [, , input, output] = process.argv;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const document = await io.read(input);

let dropped = 0;
for (const material of document.getRoot().listMaterials()) {
  for (const setter of ['setNormalTexture', 'setMetallicRoughnessTexture', 'setOcclusionTexture', 'setEmissiveTexture']) {
    if (material[setter]) {
      material[setter](null);
      dropped++;
    }
  }
  // A fém-érdesség térkép eldobása NEM elég: a Meshy metallicFactor=1-et ír, és
  // a hiányzó faktor a glTF-ben szintén 1.0-ra defaultol. Faktor nélkül a
  // textúra volt az egyetlen, ami a felületet nem-fémre állította — kivéve azt,
  // és az egész falu tökéletes fémmé válik, aminek nincs diffúz színe, csak
  // tükröződése. Mérve: ettől a falu renderje 17,8 dB PSNR-en állt az
  // eredetihez képest; a faktor visszaírásával 27,1 dB (a látható eltérés
  // 75,5%-ról 21,5%-ra esett), egyetlen bájt többletköltség nélkül.
  //
  // A játékban a MeshToonMaterial amúgy sem olvas fémességet, tehát ez ma
  // lappangó hiba — de minden eszköz (Blender, model-viewer, bármely PBR
  // előnézet) és minden nem cel-shadelt felhasználás fémnek látja az asszetet.
  material.setMetallicFactor(0);
  material.setRoughnessFactor(0.9);
}
// Now unreferenced, the images themselves go with the next prune.
for (const texture of document.getRoot().listTextures()) {
  if (texture.listParents().length <= 1) texture.dispose();
}
await io.write(output, document);
console.log(`     ${dropped} textúra-slot ürítve, ${document.getRoot().listTextures().length} textúra maradt`);
