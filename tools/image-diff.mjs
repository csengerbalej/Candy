/**
 * Két render per-pixel eltérése. Ez dönti el, hogy a bake vesztesége LÁTSZIK-e,
 * vagy csak a számokban van meg.
 *
 *   node tools/image-diff.mjs a.png b.png
 *
 * A „változott pixelek" küszöbe 8/255 csatornánként: ez nagyjából az a határ,
 * ami alatt egy monitoron már nem lehet észrevenni.
 */
import sharp from 'sharp';

const [, , a, b] = process.argv;
const load = (p) => sharp(p).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const [A, B] = await Promise.all([load(a), load(b)]);
if (A.data.length !== B.data.length) throw new Error('eltérő felbontás');

let sum = 0, sq = 0, max = 0, changed = 0;
for (let i = 0; i < A.data.length; i++) {
  const d = Math.abs(A.data[i] - B.data[i]);
  sum += d; sq += d * d; if (d > max) max = d; if (d > 8) changed++;
}
const n = A.data.length;
const rmse = Math.sqrt(sq / n);
// PSNR: 40 dB fölött gyakorlatilag megkülönböztethetetlen, 30 alatt szemmel látható.
const psnr = rmse === 0 ? Infinity : 20 * Math.log10(255 / rmse);
console.log(
  `${a.split('/').pop()} vs ${b.split('/').pop()}: ` +
    `átlag ${(sum / n).toFixed(2)}  RMSE ${rmse.toFixed(2)}  csúcs ${max}  ` +
    `PSNR ${psnr.toFixed(1)} dB  látható eltérés ${(100 * changed / n).toFixed(1)}%`
);
