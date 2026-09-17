import * as THREE from 'three';

/**
 * Visszateszi a textúrákat, ha a betöltő nem tudta.
 *
 * A jelenség: a kiadott oldalon a geometria tökéletes, a textúra viszont
 * sehol — minden fehér. Helyben, fejlesztői szerverről ugyanaz a fájl hibátlan.
 * A különbség nem a fájlban van, hanem abban, HOGYAN jut el a kép a GPU-ig.
 *
 * A three.js a GLB-be ágyazott képeket úgy tölti be, hogy csinál rájuk egy
 * `blob:` URL-t, és azt LEKÉRI. A kiadott oldal biztonsági házirendje viszont
 * szűri, hova lehet lekérést indítani, és a blob is beleesik — a kérés elhal,
 * az anyag textúra nélkül marad. A geometria azért marad meg, mert az sosem
 * megy URL-en keresztül: a GLB bináris darabjából olvassuk ki egyenesen.
 *
 * Ez a mentőöv ugyanazokat a bájtokat dekódolja `createImageBitmap`-pel egy
 * Blobból KÖZVETLENÜL, URL nélkül — így nincs mit letiltani. Csak akkor fut le,
 * ha tényleg hiányzik valamelyik textúra, tehát ott, ahol a betöltő működik,
 * nem kerül semmibe.
 */

interface GltfJson {
  materials?: Array<{
    name?: string;
    pbrMetallicRoughness?: { baseColorTexture?: { index: number } };
  }>;
  textures?: Array<{ source?: number; extensions?: { EXT_texture_webp?: { source: number } } }>;
  images?: Array<{ bufferView?: number; mimeType?: string }>;
  bufferViews?: Array<{ byteOffset?: number; byteLength: number }>;
}

/** A GLB JSON-darabja és a bináris darab kezdete. Kiexportálva, hogy mérhető legyen. */
export function readGlb(binary: ArrayBuffer): { json: GltfJson; bin: Uint8Array } | null {
  const view = new DataView(binary);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) return null;
  const jsonLength = view.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(binary, 20, jsonLength))) as GltfJson;
  // A JSON-darab után egy 8 bájtos fejléc jön, majd a bináris darab.
  return { json, bin: new Uint8Array(binary, 20 + jsonLength + 8) };
}

/** Egy kép bájtjai a GLB-ből, a `textures[index]` felől nézve. Kiexportálva, hogy mérhető legyen. */
export function imageBytes(json: GltfJson, textureIndex: number, bin: Uint8Array): Uint8Array | null {
  const texture = json.textures?.[textureIndex];
  if (!texture) return null;
  // A webp-kiterjesztés a saját forrását adja meg; e nélkül a sima `source`.
  const source = texture.extensions?.EXT_texture_webp?.source ?? texture.source;
  if (source === undefined) return null;
  const image = json.images?.[source];
  if (!image || image.bufferView === undefined) return null;
  const view = json.bufferViews?.[image.bufferView];
  if (!view) return null;
  return bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
}

/**
 * Ha a betöltött modellben hiányzik alapszín-textúra, dekódolja és felteszi.
 *
 * A három.js anyagai NÉV szerint párosíthatók a glTF anyagaival, mert a
 * betöltő átveszi a nevet. Ahol nincs név, ott a sorrend dönt — a
 * modelljeinknek egy anyaguk van, de a párosítás így akkor is helyes marad,
 * ha egyszer több lesz.
 */
/** Az alapszín-textúra indexe egy anyaghoz, sorrend szerint. Méréshez. */
export function baseColorTextureIndex(json: unknown, materialIndex = 0): number | null {
  const materials = (json as GltfJson).materials;
  const index = materials?.[materialIndex]?.pbrMetallicRoughness?.baseColorTexture?.index;
  return index ?? null;
}

export async function repairTextures(binary: ArrayBuffer, root: THREE.Object3D): Promise<number> {
  const missing: THREE.MeshStandardMaterial[] = [];
  root.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
      const std = material as THREE.MeshStandardMaterial;
      if (!std.map) missing.push(std);
    }
  });
  if (missing.length === 0) return 0;

  const parsed = readGlb(binary);
  if (!parsed || typeof createImageBitmap !== 'function') return 0;
  const { json, bin } = parsed;

  const byName = new Map<string, number>();
  const order: number[] = [];
  json.materials?.forEach((material, index) => {
    const textureIndex = material.pbrMetallicRoughness?.baseColorTexture?.index;
    if (textureIndex === undefined) return;
    order.push(textureIndex);
    if (material.name) byName.set(material.name, textureIndex);
    void index;
  });
  if (order.length === 0) return 0;

  const decoded = new Map<number, THREE.Texture>();
  const textureFor = async (textureIndex: number): Promise<THREE.Texture | null> => {
    const already = decoded.get(textureIndex);
    if (already) return already;
    const bytes = imageBytes(json, textureIndex, bin);
    if (!bytes) return null;
    // Blobból közvetlenül, URL nélkül: ezt nem szűri semmilyen házirend.
    const bitmap = await createImageBitmap(
      new Blob([bytes.slice()], { type: json.images?.[0]?.mimeType ?? 'image/webp' })
    );
    const texture = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.flipY = false; // glTF konvenció
    texture.needsUpdate = true;
    decoded.set(textureIndex, texture);
    return texture;
  };

  let repaired = 0;
  for (let i = 0; i < missing.length; i++) {
    const material = missing[i];
    const index = byName.get(material.name) ?? order[Math.min(i, order.length - 1)];
    const texture = await textureFor(index);
    if (!texture) continue;
    material.map = texture;
    material.needsUpdate = true;
    repaired++;
  }
  if (repaired > 0) {
    console.warn(`textúra-mentőöv: ${repaired} anyag kapott vissza textúrát`);
  }
  return repaired;
}
