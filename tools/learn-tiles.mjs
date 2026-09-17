/**
 * Work out the road pieces' orientation convention from a town that already
 * works, instead of guessing it.
 *
 * Every tile in the authored layout sits on a 12m grid, so its neighbours are
 * knowable; pairing "which sides have road" with "what rotation was used"
 * gives the exact rule for each piece. Guessing this wrong builds a town whose
 * corners point into gardens.
 */
import { readFileSync } from 'node:fs';

const layout = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tile = layout.tile_size_cm;

const roads = layout.instances.filter((i) => i.asset.startsWith('SM_Candy_Street_'));
const key = (x, y) => `${Math.round(x / tile)},${Math.round(y / tile)}`;
const occupied = new Set(roads.map((r) => key(r.loc_cm[0], r.loc_cm[1])));

// Blender axes: +Y is north, +X is east.
const DIRS = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

const table = new Map();
for (const road of roads) {
  const gx = Math.round(road.loc_cm[0] / tile);
  const gy = Math.round(road.loc_cm[1] / tile);
  const sides = Object.entries(DIRS)
    .filter(([, [dx, dy]]) => occupied.has(`${gx + dx},${gy + dy}`))
    .map(([name]) => name)
    .join('');
  const kind = road.asset.replace('SM_Candy_Street_', '');
  const rot = ((road.rot_z_deg % 360) + 360) % 360;
  const k = `${kind} | ${sides || 'nincs'}`;
  const seen = table.get(k) ?? new Map();
  seen.set(rot, (seen.get(rot) ?? 0) + 1);
  table.set(k, seen);
}

console.log(`${roads.length} útelem, ${tile / 100} m-es rács\n`);
for (const [k, rots] of [...table].sort()) {
  const spread = [...rots].sort((a, b) => b[1] - a[1]).map(([r, n]) => `${r}°×${n}`);
  console.log(`  ${k.padEnd(26)} → ${spread.join('  ')}`);
}
