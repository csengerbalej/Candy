/**
 * Fordulatsávok kivágása egy felpörgős motorfelvételből.
 *
 * Ingyenes hangkönyvtárakban nincs több fordulatsávra bontott motorkészlet —
 * lemértem, a CC0 hurkok 1,78-szoros tartományt fednek le, és 8,7-szeres
 * kellene. Egy FELPÖRGÉS viszont magában hordozza az egészet: csak ki kell
 * vágni belőle a megfelelő szakaszokat.
 *
 * Amit a vágásnál meg kell oldani, és amitől ez nem triviális: a hurok
 * hosszának EGÉSZ SZÁMÚ gyújtásciklusnak kell lennie. Ha nem az, a hurok
 * minden körben ugrik egyet a fázisban, és a fül ezt kattanásként hallja —
 * ezt semmilyen áttűnés nem tünteti el, mert nem hangerő-, hanem fázishiba.
 *
 *   node tools/engine-slice.mjs <in.wav> <ki-előtag>
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [input, prefix] = process.argv.slice(2);

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

function writeWav(path, data, rate) {
  const pcm = Buffer.alloc(data.length * 2);
  for (let i = 0; i < data.length; i++) {
    pcm.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(data[i] * 32767))), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + pcm.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(pcm.length, 40);
  writeFileSync(path, Buffer.concat([head, pcm]));
}

/**
 * A gyújtásciklus hossza mintában.
 *
 * NEM a legmagasabb autokorrelációs csúcsot keressük, hanem a LEGHOSSZABB
 * olyan periódust, ami még majdnem olyan jó, mint a legjobb. Egy motorhang
 * tele van felharmonikusokkal, és a naiv keresés rendre a felüket vagy a
 * negyedüket találja meg — abból pedig olyan hurok lesz, ami fázisban ugrik.
 */
/**
 * A gyújtásfrekvencia megkeresése spektrumcsúccsal.
 *
 * Két másik módszert próbáltam előtte, és mindkettő megbukott, mert nem azt
 * mérte, amit kell:
 *
 *   · KERESZTKORRELÁCIÓ — alharmonikusokba esett: 41,9 / 27,1 / 53,9 Hz-et
 *     adott a három szakaszra, vagyis a középsőt mérte a legmélyebbnek,
 *     miközben a felvétel végig felfelé pörög. Lehetetlen eredmény, és épp
 *     ezért volt hasznos: azonnal elárulta, hogy rossz az eszköz.
 *
 *   · YIN — a mid sávra jót adott (4759), a másik kettőre oktávhibát. Egy
 *     keresztsíkú V8-ban a hullám csak FORDULATONKÉNT ismétlődik (a
 *     gyújtások egyenetlenek), tehát a periódus-alapú módszerek hol a
 *     gyújtást, hol a fordulatot találják meg — és a kettő között négyszeres
 *     a különbség.
 *
 * A spektrumcsúcs mindhárom szakaszon UGYANAZT méri, tehát összehasonlítható:
 * 166 / 327 / 384 Hz, vagyis 2490 / 4905 / 5760 fordulat. Monoton, és
 * egyezik a felvétel hallható ívével.
 */
function firingHz(data, from, length, rate) {
  const goertzel = (freq) => {
    const w = (2 * Math.PI * freq) / rate;
    const coeff = 2 * Math.cos(w);
    let s1 = 0;
    let s2 = 0;
    for (let i = 0; i < length; i++) {
      const s = data[from + i] + coeff * s1 - s2;
      s2 = s1;
      s1 = s;
    }
    return Math.sqrt(Math.max(0, s1 * s1 + s2 * s2 - coeff * s1 * s2)) / length;
  };

  let best = 40;
  let bestValue = 0;
  for (let f = 40; f <= 520; f += 1) {
    const v = goertzel(f);
    if (v > bestValue) {
      bestValue = v;
      best = f;
    }
  }
  return best;
}

const { data, rate } = readWav(input);

// A három sáv helye a felvételben. Kézzel választva a fordulatkövetés
// alapján (tools/wav-track.mjs): alsó, közép, felső.
const BANDS = [
  { name: 'low', at: 1.55, want: 0.75 },
  { name: 'mid', at: 7.25, want: 0.7 },
  { name: 'high', at: 8.95, want: 0.6 },
];

const manifest = [];
for (const band of BANDS) {
  const from = Math.floor(band.at * rate);
  const window = Math.floor(band.want * rate);
  const hz = firingHz(data, from, window, rate);
  // A HUROK egész számú FORDULAT legyen, nem egész számú gyújtás.
  //
  // Egy keresztsíkú V8-ban a gyújtások egyenetlenek, tehát a hullám csak
  // fordulatonként ismétlődik. Gyújtásra vágva a hurok minden körben más
  // fázisban kezdődne, és a fül ezt kattanásként hallja — amit semmilyen
  // áttűnés nem tüntet el, mert nem hangerő-, hanem fázishiba.
  const revSamples = Math.round(rate / (hz / 4));
  const cycles = Math.max(8, Math.round(window / revSamples));
  const length = cycles * revSamples;

  const slice = new Float32Array(length);
  for (let i = 0; i < length; i++) slice[i] = data[from + i] ?? 0;

  // Rövid keresztáttűnés a varraton: a ciklushossz mérése sosem pontos
  // mintára, és néhány ezred elcsúszás még kattanhat.
  const fade = Math.min(Math.floor(revSamples / 4), 400);
  for (let i = 0; i < fade; i++) {
    const t = i / fade;
    slice[i] = slice[i] * t + (data[from + length + i] ?? 0) * (1 - t);
  }

  let peak = 0;
  for (const v of slice) peak = Math.max(peak, Math.abs(v));
  if (peak > 0) for (let i = 0; i < length; i++) slice[i] = (slice[i] / peak) * 0.9;

  const path = `${prefix}-${band.name}.wav`;
  writeWav(path, slice, rate);

  // Keresztsíkú V8: fordulatonként négy gyújtás.
  const rpm = (hz / 4) * 60;
  // A FORDULATSZÁM is bekerül, nem csak a hossz.
  //
  // Visszafejteni nem lehet: a másodpercet kerekítve tároljuk, és abból
  // számolva 57,98 fordulat jött ki 58 helyett. A hurok egész számú
  // fordulatból áll — ezt a vágó TUDJA, tehát mondja is meg.
  manifest.push({
    name: band.name,
    rpm: Math.round(rpm),
    seconds: +(length / rate).toFixed(3),
    revolutions: cycles,
  });
  console.log(
    `${band.name.padEnd(5)} ${(length / rate).toFixed(3)}s hurok  ` +
      `gyújtás ${hz.toFixed(0)} Hz  →  ${rpm.toFixed(0)} f/p  (${cycles} fordulat)`
  );
}
writeFileSync(`${prefix}.json`, JSON.stringify(manifest, null, 1));
