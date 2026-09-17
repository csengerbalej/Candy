/**
 * Mit ér egy letöltött hurok? Mérés, nem hallgatás.
 *
 * Három kérdés, és mindhárom eldönthető szám nélkül is halálos:
 *   · milyen hosszú és hány mintás;
 *   · HURKOLHATÓ-e — vagyis a vége illeszkedik-e az elejéhez. Ha nem, minden
 *     körben kattan, és ezt hangolással nem lehet elfedni;
 *   · mi az ALAPFREKVENCIÁJA — ebből derül ki, milyen fordulatot ábrázol, és
 *     hogy két hurok tényleg más tartomány-e, vagy csak ugyanaz felhangolva.
 */
import { readFileSync } from 'node:fs';

function readWav(path) {
  const buf = readFileSync(path);
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const count = Math.floor(size / (bits / 8) / channels);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        out[i] = buf.readInt16LE(offset + 8 + i * channels * 2) / 32768;
      }
      return { data: out, rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('nincs data chunk: ' + path);
}

/** Alapfrekvencia autokorrelációval. */
function pitch(data, rate) {
  const from = Math.floor(rate / 400);
  const to = Math.floor(rate / 40);
  let best = 0;
  let bestScore = -Infinity;
  for (let lag = from; lag < to; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < data.length; i += 3) sum += data[i] * data[i + lag];
    if (sum > bestScore) {
      bestScore = sum;
      best = lag;
    }
  }
  return rate / best;
}

/** Mennyire ugrik a hurok varrata? 0 = tökéletes. */
function seam(data) {
  const n = Math.min(512, Math.floor(data.length / 8));
  let head = 0;
  let tail = 0;
  for (let i = 0; i < n; i++) {
    head += data[i] * data[i];
    tail += data[data.length - 1 - i] * data[data.length - 1 - i];
  }
  const jump = Math.abs(data[0] - data[data.length - 1]);
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  return { jump: jump / (peak || 1), head: Math.sqrt(head / n), tail: Math.sqrt(tail / n) };
}

for (const path of process.argv.slice(2)) {
  const { data, rate } = readWav(path);
  const f = pitch(data, rate);
  const s = seam(data);
  console.log(
    `${path.split('/').pop().padEnd(14)} ${(data.length / rate).toFixed(2)}s  ` +
      `alap ${f.toFixed(1)} Hz  (~${((f / 3) * 60).toFixed(0)} f/p sorhatosként)  ` +
      `varrat-ugrás ${(s.jump * 100).toFixed(1)}%`
  );
}
