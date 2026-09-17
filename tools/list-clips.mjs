import { readFileSync } from 'node:fs';
for (const path of process.argv.slice(2)) {
  const buf = readFileSync(path);
  let offset = 12, json = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset), type = buf.readUInt32LE(offset + 4), start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    offset = start + len;
  }
  const names = (json.animations ?? []).map((a, i) => a.name ?? `#${i}`);
  const roots = (json.skins ?? []).map((s) => json.nodes[s.skeleton ?? s.joints[0]]?.name);
  console.log(`${path.split('/').pop().replace('Meshy_AI_Fuzzy_Little_Hugger_biped_Animation_', '').replace('_withSkin.glb', '')}`);
  console.log(`   klipek: ${names.join(' | ')}`);
  console.log(`   gyökér: ${roots.join(', ')}`);
  console.log(`   csontok: ${(json.skins?.[0]?.joints ?? []).slice(0, 8).map((j) => json.nodes[j].name).join(', ')}`);
}
