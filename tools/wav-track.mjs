/**
 * Hogyan alakul egy felvételben a fordulat?
 *
 * Ha egy motorfelvétel felpörgést tartalmaz, akkor benne VAN az a több
 * fordulatsáv, amit külön-külön ingyen nem lehet letölteni — csak ki kell
 * vágni a megfelelő szakaszokat. Ez a szkript megkeresi, hol milyen az
 * alaphang, és megmutatja, hol elég egyenletes ahhoz, hogy hurkot lehessen
 * belőle vágni.
 *
 *   node tools/wav-track.mjs <in.wav>
 */
import { readFileSync } from 'node:fs';

function readWav(path) {
  const buf = readFileSync(path);
  const channels = buf.readUInt16LE(22);
  const rate = buf.readUInt32LE(24);
  let offset = 12;
  while (offset < buf.length - 8) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'data') {
      const count = Math.floor(size / 2 / channels);
      const out = new Float32Array(count);
      for (let i = 0; i < count; i++) out[i] = buf.readInt16LE(offset + 8 + i * channels * 2) / 32768;
      return { data: out, rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('nincs data chunk');
}

/** Alaphang autokorrelációval, egy ablakban. */
function pitch(data, from, length, rate) {
  const lo = Math.floor(rate / 400);
  const hi = Math.floor(rate / 25);
  let best = lo;
  let bestScore = -Infinity;
  for (let lag = lo; lag < hi; lag++) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i + lag < length; i += 4) {
      sum += data[from + i] * data[from + i + lag];
      n++;
    }
    const score = sum / Math.max(1, n);
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  return rate / best;
}

const { data, rate } = readWav(process.argv[2]);
const window = Math.floor(rate * 0.25);
const rows = [];
for (let at = 0; at + window < data.length; at += window) {
  let rms = 0;
  for (let i = 0; i < window; i++) rms += data[at + i] * data[at + i];
  rms = Math.sqrt(rms / window);
  rows.push({ t: at / rate, hz: pitch(data, at, window, rate), rms });
}

console.log('idő    alaphang   V8-fordulat   hangerő');
rows.forEach((r, i) => {
  const prev = rows[i - 1];
  const change = prev ? Math.abs(r.hz - prev.hz) / prev.hz : 1;
  const steady = change < 0.04 ? '  ← egyenletes' : '';
  console.log(
    `${r.t.toFixed(2)}s  ${r.hz.toFixed(1).padStart(6)} Hz  ` +
      `${((r.hz / 4) * 60).toFixed(0).padStart(6)} f/p  ` +
      `${'█'.repeat(Math.round(r.rms * 60))}${steady}`
  );
});
