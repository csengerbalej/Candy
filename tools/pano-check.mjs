/**
 * Egy 360°-os panoráma VARRATÁNAK mérése.
 *
 * Az égboltra feszített kép bal és jobb széle ugyanaz a függőleges vonal a
 * világban. Ha a kettő eltér, ott egy éles csík fut végig a horizonton —
 * és pont ott, ahol a játékos körbenéz.
 *
 * A mérés: a két szélső oszlop átlagos eltérése, a kép átlagos
 * kontrasztjához viszonyítva. Egy fotón a szomszédos oszlopok is eltérnek
 * valamennyit; a varrat akkor baj, ha ENNÉL sokkal nagyobb.
 */
import sharp from 'sharp';

const [input] = process.argv.slice(2);
const img = sharp(input);
const { width, height } = await img.metadata();
const raw = await img.raw().toBuffer();
const channels = raw.length / (width * height);

const px = (x, y, c) => raw[(y * width + x) * channels + c];
const diff = (ax, bx) => {
  let sum = 0;
  for (let y = 0; y < height; y++) {
    for (let c = 0; c < 3; c++) sum += Math.abs(px(ax, y, c) - px(bx, y, c));
  }
  return sum / (height * 3);
};

const seam = diff(0, width - 1);
// Viszonyítás: két EGYMÁS MELLETTI oszlop a kép közepén.
let neighbour = 0;
for (let k = 0; k < 8; k++) neighbour += diff(width / 2 + k, width / 2 + k + 1);
neighbour /= 8;

console.log(`${input}  ${width} × ${height}  (arány ${(width / height).toFixed(2)})`);
console.log(`a varrat eltérése:        ${seam.toFixed(1)} / 255`);
console.log(`szomszédos oszlopoké:     ${neighbour.toFixed(1)} / 255`);
console.log(
  seam < neighbour * 2.5
    ? 'A VARRAT NEM LÁTSZIK — a kép magától körbeér.'
    : `A VARRAT LÁTSZIK (${(seam / neighbour).toFixed(1)}× a normál eltérés) — át kell tűntetni.`
);
