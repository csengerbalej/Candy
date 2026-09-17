/**
 * Motorhang-előnézet WAV-ba.
 *
 * Miért kell: a hangot fejetlen próbával nem lehet megítélni, a böngészőmet
 * pedig nem tudom meghallgatni. Ez a szkript UGYANAZT a jelfeldolgozást
 * futtatja le, mint a játék (lökéssorozat → torzító → fix rezonanciák →
 * hangszínszűrő), csak Web Audio helyett kézzel — így a hang meghallgatható,
 * MIELŐTT kiadom.
 *
 * A számok a src/audio/Sound.ts-ből valók. Ha ott változnak, itt is kell.
 *
 *   node tools/engine-preview.mjs [ki.wav]
 */
import { writeFileSync } from 'node:fs';

const RATE = 44100;
const OUT = process.argv[2] ?? 'raw/audio/engine-preview.wav';

// Keresztsíkú V8 (Corvette Z06). A `PATTERN` a gyújtásrend EGY fordulaton
// belül: nem egyenletes, mert a 90 fokos forgattyú miatt a lüktetés
// 180-180-270-90 fokos osztásban érkezik. Ez maga a dörmögés.
const IDLE = 680;
const REDLINE = 6500;
const BASE_REV = 20;
const PATTERN = [
  [0.0, 1.15],
  [0.25, 0.82],
  [0.5, 1.0],
  [0.875, 0.9],
];
/** Alapjárati gyújtáskép: nagyobb szórás, hosszabb lecsengés — ettől lötyög. */
const IDLE_PATTERN = [
  [0.0, 1.35],
  [0.25, 0.62],
  [0.5, 1.12],
  [0.875, 0.68],
];
const IDLE_THUMP_DECAY = 13;
const STATE_LOW = 1150;
const STATE_HIGH = 2400;
const FORMANTS = [
  [48, 10, 1.6],
  [112, 8, 1.1],
  [330, 1.6, 0.6],   // széles középső sáv: ez a reszelősség
  [760, 4, 0.1],
];
const PIPE_MS = 16;
const THUMP_HZ = 41;
const THUMP_DECAY = 21;

// --- a lökéssorozat (ugyanaz, mint a játékban) ------------------------------
function pulseTrain(idle) {
  const data = new Float32Array(RATE);
  const rev = RATE / BASE_REV;
  let seed = 12345;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let r = 0; r < BASE_REV; r++) {
    const pattern = idle ? IDLE_PATTERN : PATTERN;
    const decay = idle ? IDLE_THUMP_DECAY : THUMP_DECAY;
    for (const [at, weight] of pattern) {
      const jitter = (rnd() - 0.5) * rev * 0.012;
      const strength = (0.88 + rnd() * 0.2) * weight;
      const start = Math.floor((r + at) * rev + jitter);
      const length = Math.floor(rev * 0.5);
      for (let i = 0; i < length; i++) {
        const index = (start + i) % RATE;
        const t = i / RATE;
        const crack = (rnd() * 2 - 1) * Math.exp(-t * 260);
        const thump = Math.sin(t * Math.PI * 2 * THUMP_HZ) * Math.exp(-t * decay);
        data[index] += (crack * (idle ? 0.35 : 0.85) + thump * 0.9) * strength;
      }
    }
  }
  let peak = 0;
  for (const v of data) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < RATE; i++) data[i] /= peak;
  return data;
}

/** Egyszerű kétpólusú sávszűrő, ugyanaz a képlet, amit a BiquadFilter használ. */
function biquadBand(freq, q) {
  const w = (2 * Math.PI * freq) / RATE;
  const alpha = Math.sin(w) / (2 * q);
  const b0 = alpha, b1 = 0, b2 = -alpha;
  const a0 = 1 + alpha, a1 = -2 * Math.cos(w), a2 = 1 - alpha;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return (x) => {
    const y = (b0 / a0) * x + (b1 / a0) * x1 + (b2 / a0) * x2 - (a1 / a0) * y1 - (a2 / a0) * y2;
    x2 = x1; x1 = x; y2 = y1; y1 = y;
    return y;
  };
}

function onePoleLow() {
  let y = 0;
  return (x, cutoff) => {
    const a = Math.exp((-2 * Math.PI * cutoff) / RATE);
    y = x * (1 - a) + y * a;
    return y;
  };
}

const train = pulseTrain(false);
const idleTrain = pulseTrain(true);
/** Kipufogópukkanás: rövid zajlöket, a rezonanciákon keresztül. */
let popEnv = 0;
let popLeft = 0;
let lastThrottle = 0;
let shiftCut = 0;
let lastGear = 0;
let turboPhase = 0;
let limiterPhase = 0;
let spool = 0;
let blowEnv = 0;
const SHIFTS = [0.36, 0.68];
const SHIFT_GAIN = [1, 1.18, 1.38];
let lastSpeed = 0;
let launchY = 0;
const launchBand = biquadBand(72, 1.1);
const bands = FORMANTS.map(([f, q]) => biquadBand(f, q));
const levels = FORMANTS.map(([, , l]) => l);
const lowpass = onePoleLow();

/**
 * A CSŐ: késleltetés visszacsatolással, a visszacsatolt ág tompítva.
 * Ugyanaz, mint a játékban — csak ott a Web Audio DelayNode csinálja.
 */
const pipeLen = Math.floor((PIPE_MS / 1000) * RATE);
const pipeBuf = new Float32Array(pipeLen);
let pipeAt = 0;
const pipeDamp = onePoleLow();

// --- a menet: alapjárat → gázfröccs → gyorsulás → lassítás -------------------
// Hosszabb menet, hogy a két váltás és a plafon is hallatszódjon.
//
// A gyorsulás itt LASSABB, mint a játékban (ott 5,7 másodperc 0-ról 120-ra):
// ez bemutató, nem szimuláció, és a cél az, hogy a fülnek legyen ideje
// követni, mi történik. A váltások ugyanott vannak, ahol a játékban — a
// végsebesség 36 és 68 százalékánál.
const SECONDS = 28;
const out = new Float32Array(RATE * SECONDS);
let rpm = IDLE;
let phase = 0;
let noiseY = 0;

for (let i = 0; i < out.length; i++) {
  const t = i / RATE;
  // Mit csinál a vezető: áll, gázt ad állva, elindul, gyorsul, leveszi.
  let speed = 0;
  let throttle = 0;
  // 120 km/h = 33,4 m/s. A gyorsulás 5,7 másodperc (mért).
  const MAXV = 33.4;
  if (t < 3) { speed = 0; throttle = 0; }                   // ÁLLÓ: alapjárat
  // Három gázfröccs állva — így hallatszik a bőgetés önálló jelenetként:
  // felpörög, kipufog, visszaesik.
  else if (t < 3.6) { speed = 0; throttle = 1; }
  else if (t < 4.1) { speed = 0; throttle = 0; }
  else if (t < 4.7) { speed = 0; throttle = 1; }
  else if (t < 5.3) { speed = 0; throttle = 0; }
  else if (t < 6.1) { speed = 0; throttle = 1; }
  else if (t < 6.8) { speed = 0; throttle = 0; }
  else if (t < 19) {
    // Lassú, egyenletes gyorsulás 0-ról a végsebességig. A váltások a
    // sebesség 36 és 68 százalékánál esnek — vagyis kb. 8,5 és 14 mp-nél.
    speed = ((t - 6.8) / 14.2) * MAXV;
    throttle = 1;
  } else if (t < 24) { speed = MAXV; throttle = 1; }        // PLAFON: a korlátozón
  else { speed = Math.max(0, MAXV - (t - 24) * 10); throttle = 0; }

  const MAX = 33.4;
  const rolling = speed > 0.25;
  // A fordulat EGYENESEN a sebességet követi — a váltás nem veti vissza,
  // csak megcsuklik a nyomaték egy pillanatra.
  const ratio = Math.min(1, speed / MAX);
  let gear = 0;
  while (gear < SHIFTS.length && ratio > SHIFTS[gear]) gear++;
  if (gear !== lastGear) {
    if (gear > lastGear) { shiftCut = 0.11; blowEnv = 0.42; spool *= 0.45; }
    lastGear = gear;
  }
  shiftCut = Math.max(0, shiftCut - 1 / RATE);
  const target = rolling
    ? IDLE + (REDLINE - IDLE) * Math.pow(ratio, 0.78)
    : IDLE + throttle * 3400;
  const rate = target > rpm ? 7 : 3.2;
  rpm += (target - rpm) * (1 - Math.exp(-rate / RATE));

  // A lökéssorozat lejátszása változó sebességgel.
  phase += rpm / 60 / BASE_REV;
  if (phase >= RATE) phase -= RATE;
  // Átúszás az alapjárati és a meneti hangkép között.
  const blend = Math.min(1, Math.max(0, (rpm - STATE_LOW) / (STATE_HIGH - STATE_LOW)));
  const at = Math.floor(phase) % RATE;
  const a = train[at] * blend + idleTrain[at] * (1 - blend * 0.85);

  const load = Math.min(1, throttle * 0.75 + (speed / 33.4) * 0.45);
  const k = 1 + (0.3 + load * 0.75) * 28;

  // Gázelvétel: lefúvatás és pukkanás magas fordulatról.
  if (lastThrottle > 0.6 && throttle < 0.2 && rpm > 3200) {
    popEnv = 0.5;
    popLeft = 0.55;
    blowEnv = 0.55;
  }
  lastThrottle = throttle;
  if (popLeft > 0) {
    popLeft -= 1 / RATE;
    if (Math.random() < 9 / RATE) popEnv = 0.18 + Math.random() * 0.22;
  }
  popEnv *= Math.exp(-28 / RATE);
  const pop = (Math.random() * 2 - 1) * popEnv;

  const shaped = Math.tanh((a + pop) * k) / Math.tanh(k);

  let mixed = 0;
  for (let b = 0; b < bands.length; b++) mixed += bands[b](shaped) * levels[b];

  // Turbósíp: a fordulattal emelkedik, a terheléssel hangosodik.
  // Turbó: felpörgés gáz alatt, lefúvatás váltáskor és gázelvételkor.
  spool += ((throttle > 0.5 && rolling ? 1 : 0) - spool) * (1.6 / RATE);
  turboPhase += ((520 + rpm * 0.42) * 2 * Math.PI) / RATE;
  mixed += Math.sin(turboPhase) * spool * load * 0.055 * 6;

  blowEnv *= Math.exp(-3.4 / RATE);
  mixed += (Math.random() * 2 - 1) * blowEnv * 0.5;

  noiseY = noiseY * 0.96 + (Math.random() * 2 - 1) * 0.04;
  mixed += noiseY * (0.006 + load * 0.016) * 6;

  const cutoff = 380 + load * 3800 + rpm * 0.3;
  // Fordulatkorlátozó: a vörös tetején szaggat.
  let limit = 1;
  if (rpm > REDLINE * 0.985 && throttle > 0.5) {
    limiterPhase += 22 / RATE;
    limit = Math.sin(limiterPhase * 2 * Math.PI) > 0 ? 1 : 0.28;
  }
  // Motorfék: gázelvételkor vékonyodik is, nemcsak tompul.
  const coasting = throttle < 0.15 && rolling ? 0.62 : 1;

  // Az elindulás mélykiemelése: teljes gáz, alacsony fordulat, tényleges
  // gyorsulás. A harmadik feltétel nélkül a falnak nyomott gáz is így szólna.
  const accelerating = speed > lastSpeed + 1e-5;
  lastSpeed = speed;
  const pulling = throttle > 0.55 && accelerating && rpm < REDLINE * 0.55 ? 1 : 0;
  launchY += (pulling - launchY) * (6 / RATE);
  mixed += launchBand(mixed) * launchY * 1.8 * (1 - blend * 0.5);

  const dry = lowpass(mixed, cutoff);

  // Csőzengés.
  const echoed = pipeBuf[pipeAt];
  pipeBuf[pipeAt] = dry + pipeDamp(echoed, 900) * 0.52;
  pipeAt = (pipeAt + 1) % pipeLen;

  // Minden fokozat hangosabb az előzőnél — a valóságban fordítva van, de itt
  // a hang a SEBESSÉGRŐL szól, és a sebesség nő. A túlzás szándékos.
  const cut = shiftCut > 0 ? 0.3 : 1;
  const level =
    (dry + echoed * 0.55) *
    (0.14 + load * 0.2) *
    limit *
    coasting *
    cut *
    SHIFT_GAIN[Math.min(gear, SHIFT_GAIN.length - 1)];

  // LÁGY HATÁROLÓ.
  //
  // A lefúvatás és a pukkanás tranziensek: rövidek és hangosak. Ha az egész
  // keveréket lehalkítom miattuk, a motor duruzsolássá válik — le is mértem,
  // 0,56-os szorzóval még mindig vágott, miközben a test már halk volt. A
  // tanh csak a CSÚCSOKAT fogja vissza; ezt csinálja minden valódi
  // mesterbusz is.
  out[i] = Math.tanh(level * 1.5) * 0.9;
}

// --- WAV ---------------------------------------------------------------------
const pcm = Buffer.alloc(out.length * 2);
for (let i = 0; i < out.length; i++) {
  pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(out[i] * 32767))), i * 2);
}
const header = Buffer.alloc(44);
header.write('RIFF', 0);
header.writeUInt32LE(36 + pcm.length, 4);
header.write('WAVE', 8);
header.write('fmt ', 12);
header.writeUInt32LE(16, 16);
header.writeUInt16LE(1, 20);
header.writeUInt16LE(1, 22);
header.writeUInt32LE(RATE, 24);
header.writeUInt32LE(RATE * 2, 28);
header.writeUInt16LE(2, 32);
header.writeUInt16LE(16, 34);
header.write('data', 36);
header.writeUInt32LE(pcm.length, 40);
writeFileSync(OUT, Buffer.concat([header, pcm]));

let peak = 0;
for (const v of out) peak = Math.max(peak, Math.abs(v));
console.log(`${OUT}  ${SECONDS}s  csúcs ${peak.toFixed(2)}${peak > 1 ? '  (VÁG!)' : ''}`);
