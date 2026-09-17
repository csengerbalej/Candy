import { readFileSync } from 'node:fs';

/**
 * Is the town actually drivable?
 *
 * A layout can look like a town in a render and still be unplayable: a road
 * that does not join up, a junction with scenery parked in it, a house whose
 * driveway is inside a fence. None of that is visible from above, and all of
 * it ends a co-op run.
 *
 * Run: npm run probe:town
 */
const path = process.argv[2] ?? `${process.env.HOME}/Desktop/candypocalypse-city/export/drive_town_layout.json`;
const layout = JSON.parse(readFileSync(path, 'utf8')) as {
  tile_size_cm: number;
  instances: Array<{ asset: string; loc_cm: [number, number, number] }>;
  drive?: {
    start_cm: [number, number, number];
    houses: Array<{ asset: string; stop_cm: [number, number, number] }>;
    road_half_width_m: number;
  };
};

const tile = layout.tile_size_cm;
const cell = (x: number, y: number) => `${Math.round(x / tile)},${Math.round(y / tile)}`;

/**
 * What counts as road.
 *
 * NOT "anything named SM_Candy_Street_": the asset pack's naming lies.
 * `Street_Sidewalk` is a pavement and `Street_House_Plot` is a lawn, so a
 * prefix test turned every front garden into carriageway — and then reported
 * the house standing on its own lawn as an obstruction in the road. This set
 * mirrors CARRIAGEWAY in src/world/TownWorld.ts; the two must agree or the
 * probe validates a different town than the one the game builds.
 */
const CARRIAGEWAY = new Set([
  'SM_Candy_Street_Straight',
  'SM_Candy_Street_Straight_Long',
  'SM_Candy_Street_Corner',
  'SM_Candy_Street_Crossroad',
  'SM_Candy_Street_TJunction',
  'SM_Candy_Street_DeadEnd',
  'SM_Candy_Street_Driveway',
]);

const roads = layout.instances.filter((i) => CARRIAGEWAY.has(i.asset));
const roadCells = new Set(roads.map((r) => cell(r.loc_cm[0], r.loc_cm[1])));

function line(label: string, pass: boolean, detail: string): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(44)} ${detail}`);
  return pass;
}

let ok = true;

// --- 1. One connected network --------------------------------------------
{
  const seen = new Set<string>();
  const queue = [[...roadCells][0]];
  while (queue.length) {
    const current = queue.pop()!;
    if (seen.has(current)) continue;
    seen.add(current);
    const [cx, cy] = current.split(',').map(Number);
    for (const [dx, dy] of [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ]) {
      const next = `${cx + dx},${cy + dy}`;
      if (roadCells.has(next) && !seen.has(next)) queue.push(next);
    }
  }
  ok =
    line('az úthálózat egyben van', seen.size === roadCells.size,
      `${seen.size}/${roadCells.size} elem érhető el a rajttól`) && ok;
}

// --- 2. No dead ends ------------------------------------------------------
{
  const deadEnds: string[] = [];
  for (const key of roadCells) {
    const [cx, cy] = key.split(',').map(Number);
    const links = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ].filter(([dx, dy]) => roadCells.has(`${cx + dx},${cy + dy}`)).length;
    if (links <= 1) deadEnds.push(key);
  }
  // A dead end forces reversing, and reversing in a panicking two-player chase
  // is punishment rather than challenge.
  ok = line('nincs zsákutca', deadEnds.length === 0, `${deadEnds.length} találat`) && ok;
}

// --- 3. Nothing parked in the road ---------------------------------------
{
  const half = (layout.drive?.road_half_width_m ?? 4) * 100;
  const blockers = layout.instances.filter((i) => {
    if (CARRIAGEWAY.has(i.asset)) return false;
    // Pavements, lawns and drives are flat ground the car may cross.
    if (i.asset.startsWith('SM_Candy_Street_')) return false;
    if (i.asset.startsWith('SM_Candy_Nature_GrassPatch')) return false;
    if (i.asset.startsWith('SM_Candy_Prop_Manhole')) return false;
    const [x, y] = i.loc_cm;
    if (!roadCells.has(cell(x, y))) return false;
    // Distance from the centre of its tile: anything inside the carriageway
    // is something the car will hit at speed.
    const cx = Math.round(x / tile) * tile;
    const cy = Math.round(y / tile) * tile;
    return Math.abs(x - cx) < half && Math.abs(y - cy) < half;
  });
  ok = line('az úttest szabad', blockers.length === 0,
    blockers.length ? blockers.slice(0, 3).map((b) => b.asset).join(', ') : 'nincs akadály') && ok;
}

// --- 4. Every house can be driven to --------------------------------------
{
  const houses = layout.drive?.houses ?? [];
  const unreachable = houses.filter((h) => !roadCells.has(cell(h.stop_cm[0], h.stop_cm[1])));
  ok = line('minden házhoz oda lehet állni', houses.length > 0 && unreachable.length === 0,
    `${houses.length - unreachable.length}/${houses.length} ház`) && ok;
}

// --- 5. The start is on the road ------------------------------------------
{
  const start = layout.drive?.start_cm;
  ok = line('a rajtpozíció az úton van', !!start && roadCells.has(cell(start[0], start[1])),
    start ? `${(start[0] / 100).toFixed(0)}, ${(start[1] / 100).toFixed(0)} m` : 'nincs megadva') && ok;
}

// --- 6. Enough junctions to navigate by -----------------------------------
{
  let junctions = 0;
  for (const key of roadCells) {
    const [cx, cy] = key.split(',').map(Number);
    const links = [
      [0, 1],
      [0, -1],
      [1, 0],
      [-1, 0],
    ].filter(([dx, dy]) => roadCells.has(`${cx + dx},${cy + dy}`)).length;
    if (links >= 3) junctions++;
  }
  // Fewer than eight and the navigator has nothing to say; the drive becomes a
  // corridor with a destination at the end.
  ok = line('van miről navigálni', junctions >= 8, `${junctions} kereszteződés`) && ok;
}

// --- 7. Is the carriageway continuous along its own centre line? ----------
{
  // The game decides "am I on the road" per tile. If that test leaves gaps
  // between tiles, a car driving straight down a street leaves the road every
  // twelve metres — which capped it to the off-road speed limit and shook the
  // screen with kerb rumble the whole way. The rule below mirrors
  // TownWorld.onRoad; the two must agree.
  const half = tile * 0.34;
  const open = (gx: number, gy: number, dx: number, dy: number) =>
    roadCells.has(`${gx + dx},${gy + dy}`);

  const onRoad = (x: number, y: number): boolean => {
    const gx = Math.round(x / tile);
    const gy = Math.round(y / tile);
    if (!roadCells.has(`${gx},${gy}`)) return false;
    const dx = x - gx * tile;
    const dy = y - gy * tile;
    if (dx > half && !open(gx, gy, 1, 0)) return false;
    if (dx < -half && !open(gx, gy, -1, 0)) return false;
    if (dy > half && !open(gx, gy, 0, 1)) return false;
    if (dy < -half && !open(gx, gy, 0, -1)) return false;
    return true;
  };

  let gaps = 0;
  let firstGap = '';
  for (const key of roadCells) {
    const [gx, gy] = key.split(',').map(Number);
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
    ]) {
      if (!open(gx, gy, dx, dy)) continue;
      // Walk from this centre to the neighbour's, in 1 m steps.
      for (let t = 0; t <= 1.0001; t += 1 / tile) {
        const x = (gx + dx * t) * tile;
        const y = (gy + dy * t) * tile;
        if (!onRoad(x, y)) {
          gaps++;
          if (!firstGap) firstGap = `${(x / 100).toFixed(0)}, ${(y / 100).toFixed(0)} m`;
          break;
        }
      }
    }
  }

  ok = line('az úttest folytonos a tengelye mentén', gaps === 0,
    gaps ? `${gaps} szakadás, első: ${firstGap}` : 'nincs szakadás') && ok;
}

console.log('');
console.log(ok ? 'MIND OK — a pálya vezethető' : 'VAN BUKÓ TESZT');
if (!ok) process.exitCode = 1;
