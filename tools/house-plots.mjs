/**
 * Hol vannak az ÜRES TELKEK a térképen?
 *
 * A régi térképen ez a kérdés nem létezett: ott állt egy ház, és azt kellett
 * megtalálni (magasságtérképen terjedve a ház közepéből). Az üres telkes
 * térképen viszont nincs mit megtalálni — a telek attól telek, hogy SEMMI
 * nincs rajta.
 *
 * Amit fogódzónak használunk, az nem a magasság, hanem a ZÁRTSÁG. Minden
 * telket szegély és sövény kerít körbe, tehát a telek belseje:
 *
 *     nem úttest  ÉS  nem tömör  ÉS  a kocsi nem éri el
 *
 * Ez a három együtt pontosan a bekerített üres felületet írja le. A rács
 * mindhármat méri, tehát egyetlen összefüggő-terjedés megadja mind a
 * tizenhatot.
 *
 * Két dolgot kell kezelni:
 *   · a legnagyobb ilyen terület a térképen KÍVÜLI sáv — azt ki kell dobni;
 *   · egy telket a rajta átvágó sövény két darabra oszthat, tehát a darabokat
 *     a 4×4-es rácsban egyesíteni kell, nem külön telekként számolni.
 *
 *   node tools/house-plots.mjs public/models/village-nav.json
 */
import { readFileSync, writeFileSync } from 'node:fs';

const nav = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const N = nav.n;
const cellX = nav.cellX ?? nav.cell;
const cellZ = nav.cellZ ?? nav.cell;
const worldX = (i) => nav.min[0] + (nav.max[0] - nav.min[0]) * ((i + 0.5) / N);
const worldZ = (j) => nav.min[1] + (nav.max[1] - nav.min[1]) * ((j + 0.5) / N);
const bit = (mask, i, j) => mask[j][i] === '1';
const open = (i, j) =>
  !bit(nav.solid, i, j) && !bit(nav.road, i, j) && !bit(nav.reachable, i, j);

// --- zárt területek ---------------------------------------------------------
const seen = new Uint8Array(N * N);
const regions = [];
for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    if (seen[j * N + i] || !open(i, j)) continue;
    const stack = [[i, j]];
    seen[j * N + i] = 1;
    const cells = [];
    while (stack.length) {
      const [a, b] = stack.pop();
      cells.push([a, b]);
      for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const p = a + da, r = b + db;
        if (p < 0 || r < 0 || p >= N || r >= N || seen[r * N + p] || !open(p, r)) continue;
        seen[r * N + p] = 1;
        stack.push([p, r]);
      }
    }
    if (cells.length > 150) regions.push(cells);
  }
}
regions.sort((a, b) => b.length - a.length);

// A legnagyobb a térképen kívüli sáv: a befoglalója majdnem a teljes térkép.
const span = Math.max(nav.max[0] - nav.min[0], nav.max[1] - nav.min[1]);
const inner = regions.filter((cells) => {
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  const w = (Math.max(...xs) - Math.min(...xs)) * cellX;
  const d = (Math.max(...zs) - Math.min(...zs)) * cellZ;
  return w < span * 0.6 && d < span * 0.6;
});

// --- 4×4 rács ---------------------------------------------------------------
function bands(values, tolerance) {
  const out = [];
  for (const v of [...values].sort((a, b) => a - b)) {
    if (!out.length || v - out[out.length - 1][out[out.length - 1].length - 1] > tolerance)
      out.push([v]);
    else out[out.length - 1].push(v);
  }
  return out.map((g) => g.reduce((a, b) => a + b, 0) / g.length);
}

const centres = inner.map((cells) => {
  const xs = cells.map((c) => c[0]), zs = cells.map((c) => c[1]);
  return [
    worldX((Math.min(...xs) + Math.max(...xs)) / 2),
    worldZ((Math.min(...zs) + Math.max(...zs)) / 2),
  ];
});
const TOL = span * 0.09;
const xs = bands(centres.map((c) => c[0]), TOL);
const zs = bands(centres.map((c) => c[1]), TOL);
if (xs.length !== 4 || zs.length !== 4) {
  console.error(`FIGYELEM: ${xs.length} oszlop × ${zs.length} sor, nem 4×4`);
}
const nearest = (v, list) =>
  list.reduce((best, _, k) => (Math.abs(list[k] - v) < Math.abs(list[best] - v) ? k : best), 0);

// Egy telek DARABJAI egy rácscellába esnek — ott egyesítjük őket.
const buckets = new Map();
inner.forEach((cells, k) => {
  const c = nearest(centres[k][0], xs);
  const r = nearest(centres[k][1], zs);
  const key = `${r},${c}`;
  if (!buckets.has(key)) buckets.set(key, []);
  buckets.get(key).push(...cells);
});

// --- a kapubejáró: a legközelebbi cella, ahol a KOCSI elfér ----------------
const drivable = [];
for (let j = 0; j < N; j++)
  for (let i = 0; i < N; i++) if (bit(nav.reachable, i, j)) drivable.push([i, j]);

const plots = [];
for (const [key, cells] of [...buckets.entries()].sort()) {
  const [r, c] = key.split(',').map(Number);
  const xsC = cells.map((p) => p[0]), zsC = cells.map((p) => p[1]);
  const ci = (Math.min(...xsC) + Math.max(...xsC)) / 2;
  const cj = (Math.min(...zsC) + Math.max(...zsC)) / 2;
  const stop = drivable.reduce((best, p) =>
    (p[0] - ci) ** 2 + (p[1] - cj) ** 2 < (best[0] - ci) ** 2 + (best[1] - cj) ** 2 ? p : best
  );
  plots.push({
    row: r,
    col: c,
    centre: [worldX(ci), worldZ(cj)],
    size: [(Math.max(...xsC) - Math.min(...xsC)) * cellX, (Math.max(...zsC) - Math.min(...zsC)) * cellZ],
    stop: [worldX(stop[0]), worldZ(stop[1])],
    cells: cells.length,
  });
}

const grid = Array.from({ length: 4 }, () => Array(4).fill('.'));
for (const p of plots) if (p.row < 4 && p.col < 4) grid[p.row][p.col] = '#';
console.log(`telkek: ${plots.length}`);
for (const row of grid) console.log('   ' + row.join(' '));
const avg = (f) => plots.reduce((a, p) => a + f(p), 0) / plots.length;
console.log(`átlagos telekméret: ${avg((p) => p.size[0]).toFixed(3)} × ${avg((p) => p.size[1]).toFixed(3)}`);

writeFileSync(
  'raw/houses/plots.json',
  JSON.stringify({ groundY: nav.groundY, plots }, null, 1)
);
