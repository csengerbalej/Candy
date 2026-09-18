/**
 * EGY MODELL LEFOGYASZTÁSA.
 *
 * Mérve: a városban képkockánként kétmillió háromszög rajzolódik, és ennek a
 * fele NYOLC szörnyeteg. A Meshy-ből jövő modellek szoborfelbontásúak — egy
 * negyven pixel magas járókelőn ez a részletesség egyetlen képpontban sem
 * látszik, a gépnek viszont mindet ki kell számolnia. Ettől akadozik.
 *
 * A háló egyszerűsítése (meshoptimizer) a SZILUETTET tartja meg, és azt dobja
 * el, ami úgysem látszik. A skin (csontsúlyok) átmegy rajta, tehát a
 * mozgatott figurák is fogyaszthatók.
 *
 * Használat:  node tools/slim-model.mjs <modell> <arány>
 *   pl.       node tools/slim-model.mjs critter 0.2
 *
 * A modell a public/models alatti .json (base64 glb) vagy .glb. A .json a
 * kiadás formátuma, mert a szolgáltató a model/gltf-binary típust nem adja ki.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

const [name, ratioText] = process.argv.slice(2);
if (!name) {
  console.error('node tools/slim-model.mjs <modell> [arány]');
  process.exit(1);
}
const ratio = Number(ratioText ?? 0.25);
const dir = 'public/models';
const json = `${dir}/${name}.json`;
const glb = `${dir}/${name}.glb`;
const tmp = `/tmp/slim-${name}`;

// A .json a base64-be csomagolt glb. Kicsomagoljuk, hogy az eszköz lássa.
if (existsSync(json) && !existsSync(glb)) {
  writeFileSync(`${tmp}.glb`, Buffer.from(JSON.parse(readFileSync(json, 'utf8')).glb, 'base64'));
} else {
  writeFileSync(`${tmp}.glb`, readFileSync(glb));
}

const tris = (file) => {
  const out = execSync(`npx --yes @gltf-transform/cli inspect ${file}`, { encoding: 'utf8' });
  let sum = 0;
  for (const m of out.matchAll(/│\s*([\d,]+)\s*│\s*[\d,]+\s*│\s*(?:\d|,)/g)) sum += Number(m[1].replace(/,/g, ''));
  return out;
};

const before = readFileSync(`${tmp}.glb`).length;
// WELD: a simplify csak összehegesztett hálón tud dolgozni — a glTF-ben a
// csúcsok UV-varratok mentén szét vannak vágva, és a varratokon átnyúló élek
// nélkül az egyszerűsítés alig talál mit elhagyni.
execSync(
  `npx --yes @gltf-transform/cli weld ${tmp}.glb ${tmp}-w.glb && ` +
    `npx --yes @gltf-transform/cli simplify ${tmp}-w.glb ${tmp}-s.glb --ratio ${ratio} --error 0.002`,
  { stdio: 'inherit' }
);
const after = readFileSync(`${tmp}-s.glb`).length;

writeFileSync(json, JSON.stringify({ glb: readFileSync(`${tmp}-s.glb`).toString('base64') }));
if (existsSync(glb)) writeFileSync(glb, readFileSync(`${tmp}-s.glb`));
console.log(`${name}: ${(before / 1e6).toFixed(2)} MB → ${(after / 1e6).toFixed(2)} MB (arány ${ratio})`);
