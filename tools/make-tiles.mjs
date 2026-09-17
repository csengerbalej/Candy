/**
 * Csempézhető felülettextúrák az épített térképhez.
 *
 * Miért nem egy nagy atlasz: a letöltött térképek EGYETLEN atlasszal jöttek,
 * ami a teljes falura oszlott szét — lemérve 2048 texel 143 méterre, vagyis
 * 7 centiméter texelenként. Közelről ettől néz ki festménynek, és ezen nem
 * segít a feldolgozás, mert a forrásban sincs több adat.
 *
 * Egy CSEMPÉZETT textúránál ez a kérdés meg sem jelenik: 512 képpont négy
 * méterre ismétlődve 0,8 centiméter texelenként — kilencszer finomabb, és
 * ötven kilobájt az egész. A textúra mérete és a falu mérete itt nem függ
 * össze, tehát a falu akármekkora lehet.
 *
 *   node tools/make-tiles.mjs
 */
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const SIZE = 512;
mkdirSync('raw/tiles', { recursive: true });

/**
 * Periodikus értékzaj.
 *
 * A periodicitás nem díszítés: egy sima véletlenzaj a csempe szélén elvágódik,
 * és a felületen látható rács keletkezik belőle. A rácspontokat modulo vesszük,
 * tehát a jobb szél ugyanaz, mint a bal.
 */
function noise(period, seed) {
  const grid = new Float32Array(period * period);
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let i = 0; i < grid.length; i++) grid[i] = rnd();

  const smooth = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x * period, fy = y * period;
    const x0 = Math.floor(fx) % period, y0 = Math.floor(fy) % period;
    const x1 = (x0 + 1) % period, y1 = (y0 + 1) % period;
    const tx = smooth(fx - Math.floor(fx)), ty = smooth(fy - Math.floor(fy));
    const a = grid[y0 * period + x0], b = grid[y0 * period + x1];
    const c = grid[y1 * period + x0], d = grid[y1 * period + x1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  };
}

function fbm(seed) {
  const octaves = [noise(8, seed), noise(16, seed * 7 + 1), noise(32, seed * 13 + 3), noise(64, seed * 31 + 5)];
  return (x, y) =>
    octaves[0](x, y) * 0.5 + octaves[1](x, y) * 0.26 + octaves[2](x, y) * 0.15 + octaves[3](x, y) * 0.09;
}

async function make(name, base, contrast, seed, grit) {
  const f = fbm(seed);
  const speck = noise(128, seed * 97 + 11);
  const buf = Buffer.alloc(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const u = x / SIZE, v = y / SIZE;
      // Két léptékű szemcse: a nagy a foltosság, a kicsi a kavics.
      const n = (f(u, v) - 0.5) * contrast + (speck(u, v) - 0.5) * grit;
      const i = (y * SIZE + x) * 3;
      for (let c = 0; c < 3; c++) {
        buf[i + c] = Math.max(0, Math.min(255, Math.round((base[c] + n) * 255)));
      }
    }
  }
  await sharp(buf, { raw: { width: SIZE, height: SIZE, channels: 3 } })
    .webp({ quality: 92 })
    .toFile(`raw/tiles/${name}.webp`);
  console.log(`  raw/tiles/${name}.webp`);
}

console.log('csempék (512², 4 méteres ismétlődésre = 0,8 cm/texel):');
// A világosságok MÉRT célhoz igazodnak: a jól vezethető régi térképen az
// úttest 35 százalékos világosságon állt, és az volt az a szint, ahol
// éjszaka még olvasható. Az első nekifutásom 20 százalék volt — az a játék
// holdfényében már majdnem fekete.
// A színek nem díszítés: egy végig azonos árnyalatú falu éjszaka olvashatatlan,
// mert semmi nem különbözteti meg a burkolatot a járdától. A halloween-paletta
// itt HALKAN jelenik meg — hideg lila aszfalt, meleg csontszínű járda, hűvös
// zöldesszürke telek —, és a hangsúlyt a házakra meg az ablakfényekre hagyja.
await make('asphalt', [0.25, 0.24, 0.37], 0.10, 1234, 0.09);
await make('pavement', [0.62, 0.58, 0.54], 0.07, 5678, 0.05);
await make('plot', [0.42, 0.47, 0.44], 0.09, 9012, 0.06);
await make('kerb', [0.50, 0.46, 0.55], 0.04, 3456, 0.03);
