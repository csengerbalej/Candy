import { readFileSync } from 'node:fs';
const buf = readFileSync(process.argv[2]);
let offset = 12, json = null;
while (offset < buf.length) {
  const len = buf.readUInt32LE(offset), type = buf.readUInt32LE(offset + 4), start = offset + 8;
  if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
  offset = start + len;
}
let tris = 0;
for (const m of json.meshes ?? [])
  for (const p of m.primitives ?? []) {
    const a = json.accessors[p.indices] ?? json.accessors[p.attributes.POSITION];
    tris += a.count / 3;
  }
console.log(Math.round(tris));
