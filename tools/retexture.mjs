/**
 * Újratextúrázás a GEOMETRIA ÉRINTÉSE NÉLKÜL.
 *
 *   node tools/retexture.mjs <lebaked.glb|.json> <eredeti.glb> <ki.json> <méret> <minőség>
 *
 * Miért nem egyszerűen újra kell bake-elni? Mert a ház és a falu navigációs
 * rácsa (house1-nav.json, village-nav.json) a MOSTANI háromszögekhez lett
 * mérve. Egy új simplify futás más csúcsokat ad, és a rács csendben elcsúszik a
 * faltól. A textúra viszont az UV-kon ül, amiket a simplify megtartott — így az
 * alapszín-lapot ki lehet cserélni úgy, hogy egyetlen csúcs sem mozdul.
 *
 * A lap MINDIG az eredeti Meshy-letöltésből készül újra, nem a már egyszer
 * lebaked webp-ből: kétszeres veszteséges újrakódolás rosszabb, mint egy.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';

const [, , bakedPath, sourcePath, outPath, sizeArg, qualityArg] = process.argv;
const size = Number(sizeArg ?? 4096);
const quality = Number(qualityArg ?? 92);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

/** A kiadott modellek base64-ben, .json-ban utaznak; mindkét bemenetet elfogadjuk. */
async function read(path) {
  if (!path.endsWith('.json')) return io.read(path);
  return io.readBinary(Buffer.from(JSON.parse(readFileSync(path, 'utf8')).glb, 'base64'));
}

const baked = await read(bakedPath);
const source = await read(sourcePath);

// Az eredeti alapszín-lap — az anyagon át keressük meg, nem index szerint,
// mert a képek sorrendje exportonként változik.
const sourceMaterial = source.getRoot().listMaterials()[0];
const sourceTexture = sourceMaterial?.getBaseColorTexture();
if (!sourceTexture) throw new Error(`${sourcePath}: nincs alapszín-textúra`);

const encoded = await sharp(Buffer.from(sourceTexture.getImage()))
  .resize(size, size, { fit: 'fill', kernel: 'lanczos3' })
  .webp({ quality, effort: 6 })
  .toBuffer();

let touched = 0;
for (const material of baked.getRoot().listMaterials()) {
  const texture = material.getBaseColorTexture();
  if (!texture) continue;
  texture.setImage(encoded).setMimeType('image/webp');
  // Ugyanaz a hiba, amit a strip-maps.mjs javít: faktor nélkül a glTF 1.0-t ért,
  // vagyis tökéletes fémet. Aki ezt az eszközt egy régi bake-en futtatja, az
  // ugyanitt kapja meg a javítást.
  material.setMetallicFactor(0);
  material.setRoughnessFactor(0.9);
  touched++;
}
if (!touched) throw new Error(`${bakedPath}: nincs alapszín-textúra, amit cserélni lehetne`);

const glb = Buffer.from(await io.writeBinary(baked));
if (outPath.endsWith('.json')) writeFileSync(outPath, JSON.stringify({ glb: glb.toString('base64') }));
else writeFileSync(outPath, glb);

const bytes = outPath.endsWith('.json') ? readFileSync(outPath).length : glb.length;
console.log(
  `${outPath.split('/').pop()}  lap ${size}×${size} webp q${quality} ` +
    `(${(encoded.length / 1e6).toFixed(2)} MB)  →  fájl ${(bytes / 1e6).toFixed(2)} MB`
);
