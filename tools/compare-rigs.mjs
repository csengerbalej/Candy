import { readFileSync } from 'node:fs';
const bones = (path) => {
  const buf = readFileSync(path);
  let o = 12, json = null;
  while (o < buf.length) {
    const len = buf.readUInt32LE(o), type = buf.readUInt32LE(o + 4), s = o + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(s, s + len).toString('utf8'));
    o = s + len;
  }
  return (json.skins?.[0]?.joints ?? []).map((j) => json.nodes[j].name);
};
const [a, b] = process.argv.slice(2).map(bones);
const same = a.length === b.length && a.every((n, i) => n === b[i]);
console.log(`A: ${a.length} csont · B: ${b.length} csont`);
console.log(same ? 'AZONOS CSONTVÁZ — a klipek átvihetők' : 'ELTÉR');
if (!same) {
  console.log('csak A-ban:', a.filter((n) => !b.includes(n)).join(', ') || '—');
  console.log('csak B-ban:', b.filter((n) => !a.includes(n)).join(', ') || '—');
  const order = a.filter((n) => b.includes(n)).some((n, i) => b.filter((m) => a.includes(m))[i] !== n);
  console.log('sorrendeltérés:', order ? 'igen' : 'nem');
}
