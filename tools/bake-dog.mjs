import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, textureCompress, resample, weld, simplify } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { writeFileSync } from 'node:fs';
import sharp from 'sharp';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read('raw/dog.glb');
const tris = (d) => d.getRoot().listMeshes().flatMap(m=>m.listPrimitives()).reduce((s,p)=>s+(p.getIndices()?.getCount()??p.getAttribute('POSITION').getCount())/3,0);
console.log('előtte', tris(doc));
await doc.transform(
  resample(), dedup(), weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.22, error: 0.0012, lockBorder: true }),
  textureCompress({ encoder: sharp, targetFormat: 'webp', quality: 90, resize: [1024, 1024] }),
  prune()
);
console.log('utána', tris(doc));
const glb = Buffer.from(await io.writeBinary(doc));
writeFileSync('public/models/dog.json', JSON.stringify({ glb: glb.toString('base64') }));
console.log((glb.length/1048576).toFixed(2),'MB');
