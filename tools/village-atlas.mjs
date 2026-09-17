/**
 * Mi van a falu egyetlen textúráján?
 *
 * A falu EGY mesh, EGY anyaggal és EGY 4K atlasszal — tehát anyagonként nem
 * lehet kiszínezni. Ami marad: magát az atlaszt átfesteni. Ehhez viszont
 * tudni kell, mi van rajta, és ezt megmérni kell, nem ránézésre eldönteni.
 *
 *   node tools/village-atlas.mjs <in.glb>
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import sharp from 'sharp';

const [input] = process.argv.slice(2);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(input);

const textures = doc.getRoot().listTextures();
console.log(`textúrák: ${textures.length}`);
for (const t of textures) {
  const img = sharp(Buffer.from(t.getImage()));
  const meta = await img.metadata();
  console.log(`  ${t.getName() || '(névtelen)'}  ${meta.width}×${meta.height} ${meta.format}`);
}

// A legnagyobb textúra a baseColor atlasz.
const atlas = textures.reduce((a, b) => (b.getImage().length > a.getImage().length ? b : a));
const { data, info } = await sharp(Buffer.from(atlas.getImage()))
  .resize(256, 256, { fit: 'fill' })
  .raw()
  .toBuffer({ resolveWithObject: true });

// k-átlag a mintán. Nyolc fürt: elég ahhoz, hogy a tető, a fal, az ablak és az
// úttest szétváljon, és kevés ahhoz, hogy mindegyikhez kézzel lehessen színt
// rendelni.
const K = 8;
const px = [];
for (let i = 0; i < data.length; i += info.channels) {
  px.push([data[i], data[i + 1], data[i + 2]]);
}

let centres = Array.from({ length: K }, (_, i) => px[Math.floor((i + 0.5) * px.length / K)].slice());
const label = new Int32Array(px.length);
for (let iter = 0; iter < 24; iter++) {
  for (let i = 0; i < px.length; i++) {
    let best = 0, bestD = Infinity;
    for (let k = 0; k < K; k++) {
      const d =
        (px[i][0] - centres[k][0]) ** 2 +
        (px[i][1] - centres[k][1]) ** 2 +
        (px[i][2] - centres[k][2]) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    label[i] = best;
  }
  const sum = Array.from({ length: K }, () => [0, 0, 0, 0]);
  for (let i = 0; i < px.length; i++) {
    const s = sum[label[i]];
    s[0] += px[i][0]; s[1] += px[i][1]; s[2] += px[i][2]; s[3]++;
  }
  centres = sum.map((s, k) => (s[3] ? [s[0] / s[3], s[1] / s[3], s[2] / s[3]] : centres[k]));
}

const counts = Array.from({ length: K }, () => 0);
for (const l of label) counts[l]++;

const hex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const hsl = ([r, g, b]) => {
  const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (mx === r / 255) h = ((g - b) / 255 / d) % 6;
    else if (mx === g / 255) h = (b - r) / 255 / d + 2;
    else h = (r - g) / 255 / d + 4;
  }
  return [Math.round(((h * 60) + 360) % 360), Math.round(s * 100), Math.round(l * 100)];
};

console.log('\nfürtök (arány szerint):');
centres
  .map((c, k) => ({ c, k, share: counts[k] / px.length }))
  .sort((a, b) => b.share - a.share)
  .forEach(({ c, k, share }) => {
    const [h, s, l] = hsl(c);
    console.log(
      `  #${k}  ${(share * 100).toFixed(1).padStart(5)}%  ${hex(c)}  ` +
      `árnyalat ${String(h).padStart(3)}°  telítettség ${String(s).padStart(3)}%  világosság ${String(l).padStart(3)}%`
    );
  });
