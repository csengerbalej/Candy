/**
 * GLB inspector: reads the JSON chunk straight out of the container.
 * No loader, no DOM, no guessing — just what the file actually declares.
 */
import { readFileSync } from 'node:fs';

function inspect(path) {
  const buf = readFileSync(path);
  const magic = buf.readUInt32LE(0);
  if (magic !== 0x46546c67) throw new Error('not a GLB');

  let offset = 12;
  let json = null;
  let binBytes = 0;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    else binBytes += len;
    offset = start + len;
  }

  const g = json;
  const acc = g.accessors ?? [];
  const pos = [];
  let triangles = 0;
  for (const m of g.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      const a = acc[p.attributes?.POSITION];
      if (a?.min && a?.max) pos.push([a.min, a.max]);
      const idx = acc[p.indices];
      if (idx) triangles += idx.count / 3;
      else if (a) triangles += a.count / 3;
    }
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const [lo, hi] of pos)
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i], lo[i]);
      max[i] = Math.max(max[i], hi[i]);
    }

  const skins = g.skins ?? [];
  const jointCount = skins.reduce((n, s) => n + (s.joints?.length ?? 0), 0);
  const boneNames = skins.flatMap((s) => (s.joints ?? []).map((j) => g.nodes[j]?.name ?? '?'));
  const mixamo = boneNames.filter((n) => /mixamorig/i.test(n)).length;

  const images = g.images ?? [];
  const texKinds = new Set();
  for (const m of g.materials ?? []) {
    const p = m.pbrMetallicRoughness ?? {};
    if (p.baseColorTexture) texKinds.add('baseColor');
    if (p.metallicRoughnessTexture) texKinds.add('metallicRoughness');
    if (m.normalTexture) texKinds.add('normal');
    if (m.emissiveTexture) texKinds.add('emissive');
    if (m.occlusionTexture) texKinds.add('occlusion');
  }

  console.log(`\n=== ${path.split('/').pop()}`);
  console.log(`  méret          ${(buf.length / 1e6).toFixed(2)} MB  (bin ${(binBytes / 1e6).toFixed(2)} MB)`);
  console.log(`  generátor      ${g.asset?.generator ?? '?'}`);
  console.log(`  node / mesh    ${(g.nodes ?? []).length} / ${(g.meshes ?? []).length}`);
  console.log(`  háromszög      ${Math.round(triangles).toLocaleString('hu')}`);
  console.log(`  anyag          ${(g.materials ?? []).length}, textúrák: ${[...texKinds].join(', ') || 'nincs'}`);
  console.log(`  kép            ${images.length} (${images.map((i) => i.mimeType ?? '?').join(', ')})`);
  console.log(`  RIG            ${skins.length ? `${skins.length} skin, ${jointCount} csont` : 'NINCS — statikus mesh'}`);
  if (jointCount) console.log(`  mixamo nevek   ${mixamo}/${jointCount}`);
  console.log(`  animáció       ${(g.animations ?? []).length}`);
  console.log(`  befoglaló      X ${min[0].toFixed(2)}…${max[0].toFixed(2)}  Y ${min[1].toFixed(2)}…${max[1].toFixed(2)}  Z ${min[2].toFixed(2)}…${max[2].toFixed(2)}`);
  console.log(`  méretek        ${(max[0] - min[0]).toFixed(2)} × ${(max[1] - min[1]).toFixed(2)} × ${(max[2] - min[2]).toFixed(2)}`);
  if (jointCount) console.log(`  csontok        ${boneNames.slice(0, 14).join(', ')}${boneNames.length > 14 ? ` … (+${boneNames.length - 14})` : ''}`);
}

for (const p of process.argv.slice(2)) inspect(p);
