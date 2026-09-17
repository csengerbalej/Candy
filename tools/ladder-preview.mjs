/**
 * Egy fordulatlétra meghallgatható előnézete.
 *
 * Ugyanazt az átúsztatást futtatja le, mint a játék — minden réteg annál
 * hangosabb, minél közelebb van a saját fordulata a mostanihoz, és a
 * lejátszási sebesség a saját fordulatához arányosít —, csak Web Audio
 * helyett kézzel, fájlba. Így a hangot MEG LEHET HALLGATNI, mielőtt kiadom,
 * és össze lehet hasonlítani több forrást egymással.
 *
 *   node tools/ladder-preview.mjs public/audio/eng /tmp/elonezet.wav
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [prefix, out = '/tmp/ladder.wav'] = process.argv.slice(2);
const RATE = 44100;
const IDLE = 680;
const REDLINE = 6500;
const SECONDS = 14;

function readWav(path) {
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
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = b.readInt16LE(start + i * 2) / 32768;
  return { data, rate };
}

function writeWav(path, s) {
  const n = s.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(RATE, 24); b.writeUInt32LE(RATE * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(s[i] * 32767))), 44 + i * 2);
  writeFileSync(path, b);
}

const manifest = JSON.parse(readFileSync(`${prefix}.json`, 'utf8'));
const layers = manifest.map((m) => ({ ...m, ...readWav(`${prefix}-${m.name}.wav`), phase: 0, subPhase: 0 }));

const n = RATE * SECONDS;
const mix = new Float32Array(n);

// Kétpólusú aluláteresztő a mély ágnak, 340 Hz körül.
const LOW_K = 1 - Math.exp((-2 * Math.PI * 340) / RATE);
let lowA = 0;
let lowB = 0;

let rpm = IDLE;
let limiter = 0;
for (let i = 0; i < n; i++) {
  const t = i / RATE;
  // Ugyanaz a menetrend, mint a játékban: két másodperc alapjárat, tíz
  // másodperc gyorsulás nullától a végsebességig, aztán kitartás a maxon —
  // ott kell hallani a limiter kalapálását.
  const speed = t < 2 ? 0 : Math.min(1, (t - 2) / 8);
  const target = speed > 0.004
    ? IDLE + (REDLINE - IDLE) * Math.pow(Math.min(1, speed / 0.94), 0.78)
    : IDLE;
  rpm += (target - rpm) * (1 - Math.exp(-(target > rpm ? 7 : 3.2) / RATE));

  let limit = 1;
  if (rpm > REDLINE * 0.975 && speed > 0.3) {
    limiter += 84 / RATE;
    limit = Math.sin(limiter) > 0.15 ? 1 : 0.1;
    if (limit < 1) rpm = Math.max(REDLINE * 0.955, rpm - 350 / RATE);
  }

  let total = 0;
  const w = layers.map((l) => {
    const oct = Math.abs(Math.log2(rpm / l.rpm));
    const v = Math.exp(-Math.pow(oct / 0.22, 2));
    total += v;
    return v;
  });

  const tap = (l, phase) => {
    const p = Math.floor(phase);
    const f = phase - p;
    const a = l.data[p] ?? 0;
    const b = l.data[(p + 1) % l.data.length] ?? 0;
    return a + (b - a) * f;
  };

  let acc = 0;
  let deep = 0;
  for (let k = 0; k < layers.length; k++) {
    const l = layers[k];
    const ratio = rpm / l.rpm;
    const weight = w[k] / Math.max(1e-6, total);

    l.phase += ratio;
    if (l.phase >= l.data.length) l.phase -= l.data.length;
    acc += tap(l, l.phase) * weight;

    // AZ OKTÁVVAL MÉLYEBB MÁSOLAT: ugyanaz a hurok, fél sebességgel.
    l.subPhase += ratio * 0.5;
    if (l.subPhase >= l.data.length) l.subPhase -= l.data.length;
    const depth = 0.62 - Math.min(0.42, (rpm / REDLINE) * 0.42);
    deep += tap(l, l.subPhase) * weight * depth;
  }

  // A mély ág aluláteresztőn megy: csak a dörmögés kell belőle.
  lowA += (deep - lowA) * LOW_K;
  lowB += (lowA - lowB) * LOW_K;

  const load = Math.min(1, 0.3 + speed * 0.8);
  mix[i] = (acc + lowB * 1.5) * (0.18 + load * 0.3) * limit * 0.9;
}

let peak = 0;
for (const v of mix) peak = Math.max(peak, Math.abs(v));
if (peak > 0) for (let i = 0; i < n; i++) mix[i] = (mix[i] / peak) * 0.92;
writeWav(out, mix);
console.log(`${out}  ${SECONDS}s  ${layers.length} fok  (${manifest[0].rpm}–${manifest[manifest.length - 1].rpm} f/p)`);
