/**
 * Meshy ships one full copy of the mesh per animation. Downloading five 12 MB
 * files to get five clips off the same skeleton is absurd, so this splits them:
 *
 *   werewolf.json        mesh + skeleton + one clip
 *   werewolf.clips.json  every other clip, mesh stripped out
 *
 * The clips still address bones by node name, so three.js can play them on the
 * base skeleton without retargeting.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup,
  prune,
  textureCompress,
  resample,
  mergeDocuments,
  unpartition,
} from '@gltf-transform/functions';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';

// Ki melyik szereplő: a mappanév prefixe és a klipek listája együtt jár. A
// LAKÓ ugyanarra a mixamorig csontvázra készült, mint a szörnyek — a klipjei
// viszont mások, mert más a dolga: nem ugrik és nem cipel, hanem járőrözik,
// lopakodik és üldöz.
const CASTS = {
  hugger: {
    prefix: 'Meshy_AI_Fuzzy_Little_Hugger_biped_Animation_',
    base: 'Walking',
    // A csomag legyen TELJES, ne „amit az alapfájl nem tartalmaz": a
    // csontvázat kölcsönvevő karakterek saját klip nélkül érkeznek, tehát egy
    // itt hiányzó járásciklus a kötési pózban hagyja őket.
    pack: ['Walking', 'Running', 'run_fast_7_inplace', 'Regular_Jump', 'Female_Run_Forward_Pick_Up_Right'],
  },
  harold: {
    prefix: 'Meshy_AI_Halloween_Harold_biped_Animation_',
    base: 'Walking',
    // Az `Idle_5` VALÓDI álldogálás; korábban a `walking_2_inplace` állt az
    // `idle` helyén, ami azt mutatta, hogy a lakó sosem áll meg igazán. A
    // `Kick_a_Soccer_Ball` pedig az elkapás mozdulata — egyszeri, nem ciklus.
    pack: [
      'Walking',
      'Running',
      'Cautious_Crouch_Walk_Forward',
      'Idle_5',
      'Kick_a_Soccer_Ball',
    ],
  },
};

const [dir, outBase, outClips, castName = 'hugger'] = process.argv.slice(2);
const cast = CASTS[castName];
if (!cast) throw new Error(`ismeretlen szereplő: ${castName} (${Object.keys(CASTS).join(', ')})`);

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

const file = (name) => `${dir}/${cast.prefix}${name}_withSkin.glb`;

const BASE_CLIP = cast.base;
const CLIP_PACK = cast.pack;

/**
 * Meshy kétszer teszi bele minden klipet, és a másodikat `.001`-re nevezi.
 *
 * A név szerinti kiszűrés önmagában ezért nem elég — lemérve: öt klip után
 * tízet találtam a kész fájlban. A `.001` végződés az egyetlen jel, ami
 * megkülönbözteti őket, és mivel a játék klipeket NÉV szerint keres, a
 * duplikátum nem is hibázik, csak hízlalja a csomagot.
 */
function dropDuplicateClips(doc) {
  const seen = new Set();
  for (const anim of doc.getRoot().listAnimations()) {
    const name = anim.getName();
    if (seen.has(name) || /\.\d{3}$/.test(name)) anim.dispose();
    else seen.add(name);
  }
}

// --- base: mesh + skeleton + the walk cycle -------------------------------
const base = await io.read(file(BASE_CLIP));
dropDuplicateClips(base);
await base.transform(
  resample(),
  dedup(),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 92, resize: [2048, 2048] }),
  prune()
);
writeFileSync(outBase, JSON.stringify({ glb: Buffer.from(await io.writeBinary(base)).toString('base64') }));

// --- clips: skeleton + animation only, no geometry ------------------------
const clips = await io.read(file(CLIP_PACK[0]));
dropDuplicateClips(clips);
for (const name of CLIP_PACK.slice(1)) {
  const other = await io.read(file(name));
  dropDuplicateClips(other);
  if (!other.getRoot().listAnimations().some((a) => a.getName() === name)) {
    throw new Error(`missing clip ${name}`);
  }
  // mergeDocuments brings the whole document across; the geometry is stripped
  // afterwards, leaving the channels pointing at the bones they came with.
  mergeDocuments(clips, other);
}
for (const mesh of clips.getRoot().listMeshes()) mesh.dispose();
for (const skin of clips.getRoot().listSkins()) skin.dispose();
for (const material of clips.getRoot().listMaterials()) material.dispose();
for (const texture of clips.getRoot().listTextures()) texture.dispose();
// Each merged document arrives with its own buffer; GLB allows one.
await clips.transform(resample(), dedup(), prune(), unpartition());
writeFileSync(outClips, JSON.stringify({ glb: Buffer.from(await io.writeBinary(clips)).toString('base64') }));

console.log(`alap:  ${outBase}`);
console.log(`klipek: ${clips.getRoot().listAnimations().map((a) => a.getName()).join(', ')}`);
