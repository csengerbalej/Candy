/**
 * Egy 360°-os panoráma varratának eltüntetése, majd játékméretre hozása.
 *
 * A VARRAT azért van, mert a kép bal és jobb széle a világban UGYANAZ a
 * függőleges vonal, a generátor viszont nem tudta pontosan összezárni.
 * Lemérve: a két szél eltérése hússzorosa volt annak, amennyit két
 * szomszédos oszlop természetesen eltér — ez egy éles csík a horizonton,
 * pont ott, ahol a játékos körbenéz.
 *
 * A JAVÍTÁS nem vágás és nem tükrözés (mindkettő tartalmat dobna el), hanem
 * egy elhaló korrekció: a két szélt a KÖZÉPARÁNYOSUKHOZ toljuk, és a
 * tolást néhány száz oszlop alatt nullára csökkentjük. A kép közepe érintetlen
 * marad, a szélein pedig a szín folytonossá válik.
 *
 *   node tools/pano-fix.mjs raw/kitchen-pano.jpg public/art/kitchen.webp 2048
 */
import sharp from 'sharp';

const [input, output, widthArg = '2048'] = process.argv.slice(2);
const target = Number(widthArg);

const src = sharp(input);
const meta = await src.metadata();
const { width, height } = meta;
const raw = await src.raw().toBuffer();
const ch = raw.length / (width * height);

// Meddig tart a korrekció. A kép szélességének öt százaléka: elég hosszú
// ahhoz, hogy a szem ne vegye észre a lejtőt, elég rövid ahhoz, hogy a
// tartalom ne mosódjon.
const band = Math.round(width * 0.05);

for (let y = 0; y < height; y++) {
  for (let c = 0; c < 3; c++) {
    const left = raw[(y * width + 0) * ch + c];
    const right = raw[(y * width + (width - 1)) * ch + c];
    const half = (left - right) / 2;
    for (let i = 0; i < band; i++) {
      const taper = 1 - i / band;
      const rx = (y * width + (width - 1 - i)) * ch + c;
      const lx = (y * width + i) * ch + c;
      raw[rx] = Math.max(0, Math.min(255, Math.round(raw[rx] + half * taper)));
      raw[lx] = Math.max(0, Math.min(255, Math.round(raw[lx] - half * taper)));
    }
  }
}

await sharp(raw, { raw: { width, height, channels: ch } })
  // Pontosan 2:1-re: az equirectangular leképezés ezt feltételezi, és a
  // 2,02-es arány már fél fokot csúsztatna a horizonton.
  .resize(target, target / 2, { fit: 'fill' })
  .webp({ quality: 88 })
  .toFile(output);

console.log(`${output} kész — ${target} × ${target / 2}, a korrekció ${band} oszlopon fut ki`);
