/**
 * A NAVIGÁCIÓS RÁCS KÉPE.
 *
 * Nem látvány, hanem MÉRÉS: pontosan azt rajzolja ki, amit a játék járhatónak
 * hisz. Egy szép render megtévesztő — ott a fal látszik, de nem derül ki, hogy
 * a rács is falnak tartja-e. Ez a kép a rács maga.
 *
 *   node tools/nav-kep.mjs public/models/mansion-nav.json /tmp/mansion.ppm
 */
import { readFileSync, writeFileSync } from 'node:fs';

const [src, dst] = process.argv.slice(2);
const nav = JSON.parse(readFileSync(src, 'utf8'));
const n = nav.n;
const px = [];
for (let j = 0; j < n; j++) {
  for (let i = 0; i < n; i++) {
    const fal = nav.solid[j][i] === '1';
    const id = parseInt(nav.rooms[j][i], 36) || 0;
    if (fal) px.push(18, 14, 24);
    else if (id === 1) px.push(120, 96, 150); // folyosó
    else {
      // Szobánként más árnyalat, hogy a szerkezet látszódjon.
      const h = (id * 47) % 360;
      const c = (k) => Math.round(150 + 60 * Math.sin(((h + k) * Math.PI) / 180));
      px.push(c(0), c(120), c(240));
    }
  }
}
writeFileSync(dst, Buffer.concat([Buffer.from(`P6\n${n} ${n}\n255\n`), Buffer.from(px)]));
console.log(`${dst} — ${n}×${n}`);
