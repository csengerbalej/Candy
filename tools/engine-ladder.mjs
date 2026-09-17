/**
 * FORDULATLÉTRA egy motorfelvételből.
 *
 * Ez az, ahogy az autós játékok csinálják: a motort sok, ÁLLANDÓ fordulaton
 * veszik fel, mindegyikből tökéletes hurkot vágnak, és futásidőben a
 * fordulat szerint úsztatnak át a szomszédos kettő között. Egy hurkot csak
 * pár félhanggal nyújtanak — ennél többtől mókusos lesz.
 *
 * Nálunk eddig HÁROM hurok volt, ráadásul egy vágott montázsból, ami nem is
 * folyamatos felpörgés: a gyújtásfrekvencia ugrált benne (115 → 220 → 163 →
 * 44 Hz). Három ponttal a teljes tartományt lefedni azt jelenti, hogy minden
 * hurkot háromszorosára kell nyújtani — innen jött a műanyag hangzás.
 *
 * Ez a vágó viszont NEM kézzel megadott időpontokból dolgozik. Végigméri a
 * felvételt, megkeresi a STABIL ablakokat (ahol a frekvencia nem ugrik és a
 * hangerő elég), és minden célfrekvenciához a hozzá legközelebbi stabil
 * helyet választja. Így a létra fokai ott vannak, ahol a felvételben tényleg
 * van anyag — nem ott, ahol én tippeltem.
 *
 *   node tools/engine-ladder.mjs raw/audio/renault.wav public/audio/eng <sávok> <hengerek>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [input, prefix, bandsArg = '8', cylArg = '4'] = process.argv.slice(2);
const BANDS = Number(bandsArg);
const CYLINDERS = Number(cylArg);

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

function writeWav(path, samples, rate) {
  const n = samples.length;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8);
  b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22); b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  writeFileSync(path, b);
}

/** Goertzel-csúcs: a gyújtás alapfrekvenciája ebben az ablakban. */
function firingHz(data, from, len, rate) {
  let best = 0, bestP = 0;
  for (let f = 20; f <= 260; f += 0.25) {
    const w = (2 * Math.PI * f) / rate;
    const c = 2 * Math.cos(w);
    let s1 = 0, s2 = 0;
    for (let i = 0; i < len; i++) { const s = data[from + i] + c * s1 - s2; s2 = s1; s1 = s; }
    const p = s1 * s1 + s2 * s2 - c * s1 * s2;
    if (p > bestP) { bestP = p; best = f; }
  }
  return best;
}

const { data, rate } = readWav(input);

// --- 1. a felvétel feltérképezése -------------------------------------------
const probe = Math.round(rate * 0.3);
const marks = [];
for (let t = 0.1; t < data.length / rate - 0.5; t += 0.12) {
  const from = Math.round(t * rate);
  let rms = 0;
  for (let i = 0; i < probe; i++) rms += data[from + i] ** 2;
  marks.push({ from, t, hz: firingHz(data, from, probe, rate), rms: Math.sqrt(rms / probe) });
}

// STABIL az az ablak, ahol a frekvencia a szomszédokhoz képest alig mozdul.
// Egy felpörgés közepéről vágott hurok „csúszna" — a hangmagassága a hurkon
// belül változna, és az a fülnek elhangolódás.
const stable = marks.filter((m, i) => {
  if (i === 0 || i === marks.length - 1 || m.rms < 0.03) return false;
  const drift = Math.max(Math.abs(m.hz - marks[i - 1].hz), Math.abs(m.hz - marks[i + 1].hz));
  return drift < m.hz * 0.06;
});
if (stable.length < BANDS) {
  console.error(`csak ${stable.length} stabil ablak van, ${BANDS} sáv kellene`);
  process.exit(1);
}

const lo = Math.min(...stable.map((m) => m.hz));
const hi = Math.max(...stable.map((m) => m.hz));
console.log(`${input}: ${stable.length} stabil ablak, ${lo.toFixed(0)}–${hi.toFixed(0)} Hz (${(hi / lo).toFixed(2)}×)`);

// --- 2. a létra fokai -------------------------------------------------------
// MÉRTANI osztás, nem számtani: a fül a hangmagasságot arányban hallja, tehát
// a szomszédos fokok közti NYÚJTÁS legyen egyenlő, ne a különbségük.
const manifest = [];
const used = new Set();
for (let k = 0; k < BANDS; k++) {
  const target = lo * Math.pow(hi / lo, k / (BANDS - 1));
  let pick = null;
  let bestScore = Infinity;
  for (const m of stable) {
    if (used.has(m.from)) continue;
    // A közelség számít, de a hangerő is: két egyformán jó hely közül a
    // hangosabbikban több a felharmonikus, tehát gazdagabb a hurok.
    const score = Math.abs(Math.log(m.hz / target)) - m.rms * 0.35;
    if (score < bestScore) { bestScore = score; pick = m; }
  }
  if (!pick) continue;
  used.add(pick.from);

  // A hurok EGÉSZ SZÁMÚ FORDULAT legyen, nem egész számú gyújtás: a hengerek
  // nem egyformán szólnak, tehát a hullám csak fordulatonként ismétlődik.
  const hz = firingHz(data, pick.from, Math.round(rate * 0.35), rate);
  const revHz = hz / (CYLINDERS / 2);
  const revSamples = Math.round(rate / revHz);
  // RÖVIDEBB hurok: hat fordulat, nem huszonöt.
  //
  // Negyvenkét század másodperc hosszú hurkokat vágtam először, és azokon
  // BELÜL hullámzott a hangerő — lemérve a legrosszabbon 2,1-szeresen. Egy
  // ilyen hurok másodpercenként kétszer felerősödik és visszahalkul, és a fül
  // ezt LÜKTETÉSNEK hallja. Rövidebb hurokban egyszerűen kevesebb hely van a
  // sodródásnak.
  const cycles = Math.max(4, Math.min(8, Math.round((rate * 0.16) / revSamples)));
  const nominal = cycles * revSamples;
  if (pick.from + nominal * 3 > data.length) continue;

  // A HUROK HOSSZA KORRELÁCIÓVAL, nem a frekvenciabecslésből.
  //
  // A becslés fél hertz pontos; egy fél hertz tévedés a hurok végén már
  // néhány minta csúszás, és a varraton ugrik a jel. Lemérve: a legrosszabb
  // varrat 14,6%-os ugrás volt, ami minden körben KATTAN. Ezért a névleges
  // hossz körül megkeressük azt, amelyiknél a hurok vége tényleg úgy néz ki,
  // mint az eleje.
  const span = Math.round(revSamples * 0.25);
  let length = nominal;
  let bestMatch = -Infinity;
  const probeLen = Math.min(revSamples, 2000);
  for (let cand = nominal - span; cand <= nominal + span; cand++) {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < probeLen; i++) {
      const a = data[pick.from + i];
      const b = data[pick.from + cand + i];
      dot += a * b; na += a * a; nb += b * b;
    }
    const score = dot / Math.sqrt(Math.max(1e-9, na * nb));
    if (score > bestMatch) { bestMatch = score; length = cand; }
  }

  const slice = new Float32Array(length);
  for (let i = 0; i < length; i++) slice[i] = data[pick.from + i];

  // Egyenlő teljesítményű keresztáttűnés a varraton, a MEGTALÁLT hosszal.
  //
  // ELŐBB a varrat, UTÁNA a lapítás. Fordítva csináltam először, és két
  // foknál emiatt maradt tíz százalékos ugrás: a már kilapított hurok elejét
  // kevertem a NYERS folytatással, tehát a két jel más szinten volt. Így
  // viszont a lapítás a kész, varratos hurkot simítja végig — a varrat
  // környékét is.
  const fade = Math.min(Math.floor(revSamples / 3), 600);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    const a = Math.cos((1 - t) * Math.PI * 0.5);
    const b = Math.cos(t * Math.PI * 0.5);
    slice[i] = slice[i] * a + data[pick.from + length + i] * b;
  }

  // A BURKOLÓ KILAPÍTÁSA — KÖRKÖRÖSEN.
  //
  // Amit a játék futásidőben csinál a hangerővel, az a hurokba SÜTVE nem
  // kívánatos: ott csak a hangszín kell, állandó szinten.
  //
  // A „körkörösen" nem részletkérdés. Először egyenes ablakkal simítottam, és
  // a varrat-ugrás 9%-ról 20%-ra ROMLOTT: a hurok elejére és végére más
  // erősítés jutott, tehát a lapítás maga csinált új törést pont ott, ahol a
  // hurok összeér. Körkörös ablakkal az erősítés is periodikus — a hurok
  // vége és eleje ugyanazt a kezelést kapja.
  const win = Math.max(64, Math.round(revSamples / 2));
  const env = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let acc = 0;
    for (let k = -win >> 1; k < win >> 1; k++) {
      const v = slice[(i + k + length * 2) % length];
      acc += v * v;
    }
    env[i] = Math.sqrt(acc / win);
  }
  let mean = 0;
  for (const v of env) mean += v;
  mean /= length;
  for (let i = 0; i < length; i++) {
    // Nem teljesen: a lüktetés egy része a motor sajátja. Hetven százalékban
    // simítunk — ennyi tünteti el a pumpálást anélkül, hogy gépivé tenné.
    const g = mean / Math.max(mean * 0.35, env[i]);
    slice[i] *= 1 + (g - 1) * 0.7;
  }

  let peak = 0;
  for (const v of slice) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < length; i++) slice[i] = (slice[i] / peak) * 0.88;

  const name = `b${k}`;
  writeWav(`${prefix}-${name}.wav`, slice, rate);
  manifest.push({
    name,
    rpm: Math.round((rate / (length / cycles) ) * 60),
    seconds: +(length / rate).toFixed(4),
    revolutions: cycles,
    at: +pick.t.toFixed(2),
  });
}

manifest.sort((a, b) => a.rpm - b.rpm);
writeFileSync(`${prefix}.json`, JSON.stringify(manifest, null, 1));
for (const m of manifest) {
  console.log(`  ${m.name}  ${String(m.rpm).padStart(5)} f/p  ${m.seconds.toFixed(3)}s  ${m.revolutions} fordulat  (${m.at}s-nál)`);
}
const stretch = manifest.length > 1
  ? Math.max(...manifest.slice(1).map((m, i) => m.rpm / manifest[i].rpm))
  : 0;
console.log(`legnagyobb nyújtás két szomszédos fok közt: ${stretch.toFixed(2)}× (${(Math.log2(stretch) * 12).toFixed(1)} félhang)`);
