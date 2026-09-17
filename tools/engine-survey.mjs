/**
 * Végigméri egy motorfelvétel fordulatgörbéjét.
 *
 * Amit keresünk, az nem „szép hang", hanem HASZNÁLHATÓ SZAKASZ: olyan
 * félmásodperces ablakok, ahol a gyújtásfrekvencia EGYENLETESEN emelkedik és
 * a hangerő stabil. Ezekből lehet fordulatsávokat vágni; egy montázsból,
 * ahol a frekvencia ide-oda ugrál, nem lehet.
 *
 *   node tools/engine-survey.mjs raw/audio/m6.wav
 */
import { readFileSync } from 'node:fs';

const path = process.argv[2];
const b = readFileSync(path);
const rate = b.readUInt32LE(24);
let off = 12;
while (off < b.length - 8) {
  const id = b.toString('ascii', off, off + 4);
  const size = b.readUInt32LE(off + 4);
  if (id === 'data') break;
  off += 8 + size + (size % 2);
}
const start = off + 8;
const n = Math.floor((b.length - start) / 2);
const x = new Float32Array(n);
for (let i = 0; i < n; i++) x[i] = b.readInt16LE(start + i * 2) / 32768;

function firing(from, len) {
  let best = 0, bestP = 0;
  for (let f = 20; f <= 260; f += 0.5) {
    const w = (2 * Math.PI * f) / rate;
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < len; i++) { const s = x[from + i] + c * s1 - s2; s2 = s1; s1 = s; }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2;
    if (p > bestP) { bestP = p; best = f; }
  }
  return best;
}

const step = 0.25;
const win = Math.round(rate * 0.3);
const pts = [];
for (let t = 0.1; t < n / rate - 0.35; t += step) {
  const from = Math.round(t * rate);
  let rms = 0;
  for (let i = 0; i < win; i++) rms += x[from + i] ** 2;
  pts.push({ t, hz: firing(from, win), rms: Math.sqrt(rms / win) });
}

// Egyenletesen emelkedő futamok: legalább négy egymást követő ablak, ahol a
// frekvencia nő és nem ugrik nagyot.
const runs = [];
let run = [pts[0]];
for (let i = 1; i < pts.length; i++) {
  const d = pts[i].hz - pts[i - 1].hz;
  const ok = d > -2 && d < 30 && pts[i].rms > 0.02;
  if (ok) run.push(pts[i]);
  else { if (run.length >= 4) runs.push(run); run = [pts[i]]; }
}
if (run.length >= 4) runs.push(run);
runs.sort((a, b2) => (b2[b2.length - 1].hz - b2[0].hz) - (a[a.length - 1].hz - a[0].hz));

console.log(`${path}  ${(n / rate).toFixed(1)} mp`);
for (const r of runs.slice(0, 4)) {
  const lo = r[0], hi = r[r.length - 1];
  console.log(
    `  futam ${lo.t.toFixed(2)}–${hi.t.toFixed(2)} mp  ` +
    `${lo.hz.toFixed(0)} → ${hi.hz.toFixed(0)} Hz  (${(hi.hz / lo.hz).toFixed(2)}×)  ${r.length} ablak`
  );
}

// A STABIL ablakok frekvencia-eloszlása: ebből derül ki, milyen széles
// fordulattartományból lehet egyáltalán sávokat vágni.
const stable = pts.filter((p, i) => i > 0 && p.rms > 0.03 && Math.abs(p.hz - pts[i - 1].hz) < 12);
const hzs = stable.map((p) => p.hz).sort((a, b2) => a - b2);
if (hzs.length) {
  console.log(
    `  stabil ablakok: ${hzs.length} db, ${hzs[0].toFixed(0)}–${hzs[hzs.length - 1].toFixed(0)} Hz ` +
    `(${(hzs[hzs.length - 1] / hzs[0]).toFixed(2)}× tartomány)`
  );
}
