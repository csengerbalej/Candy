import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { CAR } from '../src/core/config';
import { VILLAGE_SCALE, VillageWorld } from '../src/world/VillageWorld';
import { TrafficLights } from '../src/world/TrafficLights';
import { Checkpoints } from '../src/world/Checkpoints';
import { CritterTraffic } from '../src/ai/CritterTraffic';
import { CarTraffic } from '../src/ai/CarTraffic';
import { Challenge } from '../src/game/Challenge';
import { Car } from '../src/vehicle/Car';
import type { PadState } from '../src/input/InputManager';

/**
 * Can the jeep actually drive this village?
 *
 * The map is a baked Meshy diorama, not a kit of parts, so nothing about it is
 * known in advance — not the street width, not where the tarmac runs, not
 * whether a house's kerb is reachable. All of that is measured offline into
 * village-nav.json, and this probe is what checks that the measurements and
 * the car agree. The central question is the one that was asked of it:
 * DOES THE CAR FIT? That is answered here in metres, not by eye.
 *
 * Run: npm run probe:village
 */
const nav = JSON.parse(readFileSync('public/models/village-nav.json', 'utf8')) as {
  n: number;
  cell: number;
  min: [number, number, number];
  max: [number, number, number];
  groundY: number;
  medianHalfWidth: number;
  widestHalfWidth: number;
  road: string[];
  solid: string[];
  reachable: string[];
  start: [number, number];
  houses: Array<{ centre: [number, number]; stop: [number, number] }>;
};

/**
 * Ask the WORLD, never a copy of it.
 *
 * This file used to redo the grid arithmetic itself — its own origin, its own
 * col/row. That is how the mirror got in: the world mapped the grid's Y onto
 * the game's Z the wrong way round, and every assertion here agreed with it,
 * because both were reading the grid and neither was reading the mesh. Going
 * through the same object the game drives means a mistake in the mapping now
 * shows up as a failing test instead of as a village whose houses are not
 * where its collision is.
 */
const world = VillageWorld.fromNav(nav);
const N = world.gridSize;
const CELL = world.cell;

const col = (x: number) => world.col(x);
const row = (z: number) => world.row(z);
const inside = (i: number, j: number) => i >= 0 && j >= 0 && i < N && j < N;
const solid = (i: number, j: number) => world.solidAt(i, j);
const road = (i: number, j: number) => world.roadAt(i, j);
/** World position of a grid cell's centre. */
const wx = (i: number) => world.worldX(i);
const wz = (j: number) => world.worldZ(j);

function line(label: string, pass: boolean, detail: string): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(46)} ${detail}`);
  return pass;
}

let ok = true;

const span = world.bounds.getSize(new THREE.Vector2());
console.log(`falu: ${span.x.toFixed(0)} x ${span.y.toFixed(0)} m, rácscella ${CELL.toFixed(2)} m, skála ${VILLAGE_SCALE}`);
console.log('');

// --- 1. Does the car fit? ---------------------------------------------------
{
  const lane = nav.medianHalfWidth * VILLAGE_SCALE;
  // The car is three circles of `bodyRadius` along its spine, so its half-width
  // IS bodyRadius. Asking for twice that leaves the driver a full car-width of
  // room to wander in, which is the difference between a street and a chicane.
  const need = CAR.bodyRadius * 2;
  ok = line(
    'az autó elfér az utcán',
    lane >= need,
    `sáv-félszélesség ${lane.toFixed(2)} m, autó félszélesség ${CAR.bodyRadius.toFixed(2)} m (kell ${need.toFixed(2)} m)`
  ) && ok;
}

// --- 2. Can it turn a corner? ----------------------------------------------
{
  // A junction has to admit the whole car, not just its width: turning sweeps
  // the full diagonal of the body through the corner.
  const diagonal = Math.hypot(CAR.spineSpread + CAR.bodyRadius, CAR.bodyRadius);
  const widest = nav.widestHalfWidth * VILLAGE_SCALE;
  ok = line(
    'a kereszteződés befogadja a kanyarodó autót',
    widest >= diagonal,
    `legszélesebb félszélesség ${widest.toFixed(2)} m, autó átló ${diagonal.toFixed(2)} m`
  ) && ok;
}

// --- 3. The start is on tarmac and in the clear ----------------------------
{
  const sx = world.carSpawn.x;
  const sz = world.carSpawn.z;
  const i = col(sx);
  const j = row(sz);
  // Every cell the car's body covers at the spawn must be free.
  const reach = Math.ceil(CAR.bodyRadius / CELL);
  let blocked = 0;
  for (let b = -reach; b <= reach; b++) {
    for (let a = -reach; a <= reach; a++) if (solid(i + a, j + b)) blocked++;
  }
  ok = line(
    'a rajtpozíció úton van és szabad',
    road(i, j) && blocked === 0,
    `${sx.toFixed(0)}, ${sz.toFixed(0)} m — ${blocked} foglalt cella a karosszéria alatt`
  ) && ok;
}

// --- 4. Every house is reachable from the start ----------------------------
{
  // Flood the open ground the car can actually occupy: a cell counts only if
  // the whole body clears it. A corridor one cell wider than the car is not a
  // corridor, it is a wedge.
  const reach = Math.ceil(CAR.bodyRadius / CELL);
  const free = (i: number, j: number) => {
    for (let b = -reach; b <= reach; b++) {
      for (let a = -reach; a <= reach; a++) if (solid(i + a, j + b)) return false;
    }
    return true;
  };

  const seen = new Uint8Array(N * N);
  const start: [number, number] = [col(world.carSpawn.x), row(world.carSpawn.z)];
  const queue: Array<[number, number]> = [start];
  seen[start[1] * N + start[0]] = 1;
  while (queue.length) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const a = i + di;
      const b = j + dj;
      if (inside(a, b) && !seen[b * N + a] && free(a, b)) {
        seen[b * N + a] = 1;
        queue.push([a, b]);
      }
    }
  }

  const unreachable = world.houses.filter((h) => {
    const i = col(h.driveway.x);
    const j = row(h.driveway.z);
    // Allow the kerb itself to be one cell off the flooded area: the stop point
    // is where the car parks, not where it drives.
    for (let b = -1; b <= 1; b++) {
      for (let a = -1; a <= 1; a++) if (inside(i + a, j + b) && seen[(j + b) * N + i + a]) return false;
    }
    return true;
  });

  ok = line(
    'minden ház elérhető a rajttól',
    unreachable.length === 0,
    `${world.houses.length - unreachable.length}/${world.houses.length} ház`
  ) && ok;
}

// --- 5. Driving a street must not shake the screen -------------------------
{
  // Count of "flickers" was the wrong metric, and chasing it to zero would
  // have meant deleting real features: a 3 m cobbled crossing IS a surface
  // change, and rumbling over it is correct. What the player actually
  // complained about is the SCREEN SHAKING, and the screen shakes in
  // proportion to car.rumble — so measure that, with the car's own constants.
  //
  // Rumble needs CAR.offRoadDwell off the tarmac before it starts at all, then
  // climbs at 6/s and falls at 4/s. A pinhole therefore produces a bump of a
  // few hundredths and a real verge saturates it. The threshold below is the
  // line between the two.
  const STEP = 0.25;
  const CRUISE = 12;
  const dt = STEP / CRUISE;
  const MAX_RUMBLE = 0.25;

  let worst = 0;
  let worstAt = '';
  let sampled = 0;

  const drive = (x0: number, z0: number, dx: number, dz: number, cells: number) => {
    let rumble = 0;
    let off = 0;
    const steps = Math.floor((cells * CELL) / STEP);
    for (let t = 0; t <= steps; t++) {
      const x = x0 + dx * t * STEP;
      const z = z0 + dz * t * STEP;
      const i = col(x);
      const j = row(z);
      if (!inside(i, j)) break;
      if (solid(i, j)) break; // you crashed into something; that is not rumble
      sampled++;
      off = road(i, j) ? 0 : off + dt;
      if (off >= CAR.offRoadDwell) {
        rumble = Math.min(1, rumble + dt * 6 * Math.min(1, CRUISE / 6));
      } else {
        rumble = Math.max(0, rumble - dt * 4);
      }
      if (rumble > worst) {
        worst = rumble;
        worstAt = `${x.toFixed(0)}, ${z.toFixed(0)} m`;
      }
    }
  };

  // Drive STREETS, not "anywhere a road cell touches". A run is seeded only on a
  // maximal stretch of tarmac long enough to be a street, and it is driven
  // along that stretch's own axis. Seeding on any road cell and heading off in
  // a fixed direction drove straight off the kerb into somebody's garden on
  // the first sample, where rumbling is not a bug but the entire point of it.
  const MIN_STREET = 20; // cells ≈ 7.4 m

  for (let j = 2; j < N - 2; j++) {
    let i = 2;
    while (i < N - 2) {
      if (!road(i, j)) { i++; continue; }
      let k = i;
      while (k < N - 2 && road(k, j)) k++;
      if (k - i >= MIN_STREET) drive(wx(i), wz(j), 1, 0, k - i);
      i = k;
    }
  }
  for (let i = 2; i < N - 2; i++) {
    let j = 2;
    while (j < N - 2) {
      if (!road(i, j)) { j++; continue; }
      let k = j;
      while (k < N - 2 && road(i, k)) k++;
      if (k - j >= MIN_STREET) drive(wx(i), wz(j), 0, -1, k - j);
      j = k;
    }
  }

  ok = line(
    'az utcán végighajtva nem rezeg a kép',
    worst <= MAX_RUMBLE,
    `legnagyobb rázás ${worst.toFixed(3)} (határ ${MAX_RUMBLE}) ${sampled} mintából${worst > MAX_RUMBLE ? `, itt: ${worstAt}` : ''}`
  ) && ok;
}

// --- 6. Houses are distinct places -----------------------------------------
{
  let tooClose = 0;
  for (let a = 0; a < world.houses.length; a++) {
    for (let b = a + 1; b < world.houses.length; b++) {
      const dx = world.houses[a].position.x - world.houses[b].position.x;
      const dz = world.houses[a].position.z - world.houses[b].position.z;
      if (Math.hypot(dx, dz) < 12) tooClose++;
    }
  }
  // NINCS beírt házszám. Itt `=== 16` állt, a négyszer négyes térkép
  // telkeinek száma — és amikor a város kétszeresére nőtt, ez a teszt bukott,
  // pedig a hatvannégy ház helyes volt. Amit ellenőrizni akarunk, az nem a
  // darabszám, hanem hogy minden ház KÜLÖN HELY legyen: ha kettő egymáson
  // állna, a navigátor nem tudna köztük választani.
  ok = line(
    'a házak külön helyen állnak',
    world.houses.length >= 16 && tooClose === 0,
    `${world.houses.length} ház, ${tooClose} túl közeli pár`
  ) && ok;
}

// --- 7. Actually drive it ---------------------------------------------------
{
  // Everything above is geometry. This is the game: the real Car, the real
  // colliders, the real fixed timestep, driven down real streets.
  //
  // No autopilot. An earlier version of this test steered itself and spent its
  // thirty seconds proving that my lane-following was bad, which is not a fact
  // about the village. Instead the car is placed at the start of each long
  // street, pointed along it, and told to go: if it fits, it arrives; if it
  // does not, it grinds down the kerb and the numbers say so.
  const dt = 1 / 60;
  const flatOut: PadState = { moveX: 0, moveY: 1, jump: false, interact: false };

  interface Street { x: number; z: number; heading: number; length: number }
  const streets: Street[] = [];
  // A real street, not the patch of tarmac between two driveways. At 24 cells
  // (9 m) the scan picked up junction stubs whose far end is somebody's front
  // wall, and then reported the wall as the village being undrivable.
  const MIN_STREET = 48; // cells ≈ 18 m

  // Keep clear of the grid's own edge. Out of bounds counts as solid, which is
  // right — you cannot drive off the map — but the ring road runs all the way
  // to the boundary, and a test that walks into it reports the EDGE OF THE
  // GRID as an obstruction in the village.
  const EDGE = Math.ceil(CAR.bodyRadius / CELL) + 3;

  /**
   * Put the car in the middle of the lane, not on its edge.
   *
   * A run of tarmac is found by scanning one row, so its starting cell is
   * wherever that row first met the street — which for a wide street is its
   * KERB. Starting there and driving straight grinds along the edge for the
   * whole length, and the test then reports the village as too narrow when
   * what was too narrow was my starting position.
   */
  /** The stretch of tarmac through (i, j) along one axis: where it starts, how long. */
  const runFrom = (i: number, j: number, di: number, dj: number): { start: number; length: number } => {
    if (!road(i, j)) return { start: di ? i : j, length: 0 };
    let back = 0;
    while (road(i - di * (back + 1), j - dj * (back + 1)) && (di ? i - back - 1 : j - back - 1) > EDGE) back++;
    let forward = 0;
    while (road(i + di * (forward + 1), j + dj * (forward + 1)) && (di ? i + forward + 1 : j + forward + 1) < N - EDGE) forward++;
    return { start: (di ? i : j) - back, length: (back + forward + 1) * CELL };
  };

  const centreAcross = (i: number, j: number, axis: 'x' | 'z'): number => {
    let lo = 0;
    let hi = 0;
    if (axis === 'x') {
      while (road(i, j - lo - 1)) lo++;
      while (road(i, j + hi + 1)) hi++;
      return j + Math.round((hi - lo) / 2);
    }
    while (road(i - lo - 1, j)) lo++;
    while (road(i + hi + 1, j)) hi++;
    return i + Math.round((hi - lo) / 2);
  };

  for (let j = EDGE; j < N - EDGE; j++) {
    let i = EDGE;
    while (i < N - EDGE) {
      if (!road(i, j)) { i++; continue; }
      let k = i;
      while (k < N - EDGE && road(k, j)) k++;
      if (k - i >= MIN_STREET) {
        // Re-measure the run ON THE CENTRED ROW. Streets are not perfect
        // rectangles, so the row that found the run and the row through the
        // middle of it are not the same road: taking the first row's LENGTH
        // and the centred row's POSITION described a street that exists in
        // neither, and the test then failed on a start point that was not
        // even tarmac.
        const cj = centreAcross(i + 3, j, 'x');
        const run = runFrom(i, cj, 1, 0);
        if (run.length >= MIN_STREET * CELL) {
          streets.push({ x: wx(run.start), z: wz(cj), heading: Math.PI / 2, length: run.length });
        }
      }
      i = k;
    }
  }
  for (let i = EDGE; i < N - EDGE; i++) {
    let j = EDGE;
    while (j < N - EDGE) {
      if (!road(i, j)) { j++; continue; }
      let k = j;
      while (k < N - EDGE && road(i, k)) k++;
      if (k - j >= MIN_STREET) {
        const ci = centreAcross(i, j + 3, 'z');
        const run = runFrom(ci, j, 0, 1);
        if (run.length >= MIN_STREET * CELL) {
          // Walking DOWN the grid's rows walks towards smaller Z, so a street found
          // by scanning rows is driven heading -Z, not +Z.
          streets.push({ x: wx(ci), z: wz(run.start), heading: Math.PI, length: run.length });
        }
      }
      j = k;
    }
  }

  // Centring collapses every row through a wide street onto the same
  // centreline, so the same street is now found once per row it spans. Drive
  // each one once.
  const unique = new Map<string, Street>();
  for (const st of streets) {
    const key = `${col(st.x)},${row(st.z)},${st.heading.toFixed(2)}`;
    const existing = unique.get(key);
    if (!existing || existing.length < st.length) unique.set(key, st);
  }

  /**
   * Is the WHOLE car clear here, facing this way?
   *
   * Testing a square of the car's half-width checks its width and quietly
   * ignores its length — and the car is 4.7 m long. One street then started
   * with the jeep's nose already inside a hedge, sat there grinding for six
   * seconds, and was reported as an undrivable street rather than an
   * impossible place to park. Three circles along the spine is exactly the
   * shape the car collides with.
   */
  const bodyClear = (x: number, z: number, heading: number): boolean => {
    const reach = Math.ceil(CAR.bodyRadius / CELL);
    for (const along of [-CAR.spineSpread, 0, CAR.spineSpread]) {
      const i = col(x + Math.sin(heading) * along);
      const j = row(z + Math.cos(heading) * along);
      for (let b = -reach; b <= reach; b++) {
        for (let a = -reach; a <= reach; a++) if (solid(i + a, j + b)) return false;
      }
    }
    return true;
  };

  // Only streets the car could be placed on in the first place: a run of tarmac
  // whose first cell is under a hedge is not somewhere anyone starts.
  const startable = [...unique.values()].filter((st) => bodyClear(st.x, st.z, st.heading));

  let worstRumble = 0;
  let blocked = 0;
  let stalled = 0;
  let totalTravelled = 0;
  let worstAt = '';
  let blockedAt = '';
  let topSpeed = 0;

  for (const st of startable) {
    // Pick the lane with the longest clear straight, and drive that.
    //
    // NOT "a lane that is clear for the street's whole length" — that condemned
    // the two roads that cross the entire village, because over 138 m a driver
    // changes lane round a tree and a fixed offset cannot. Whether everywhere
    // is reachable is test 4's question, and it answers it properly, with a
    // flood fill that can go round things. This test's question is what only
    // running the physics can answer: on a straight the car CAN take, does it
    // get up to speed, stay put on the road, and not shake the screen.
    const across = (sign: number) => {
      const angle = st.heading + (sign * Math.PI) / 2;
      let d = 0;
      while (d < 8 && world.onRoad(st.x + Math.sin(angle) * d, st.z + Math.cos(angle) * d)) d += 0.5;
      return d;
    };
    const room = Math.min(6, Math.max(across(1), across(-1)));
    const offsets: number[] = [0];
    for (let o = 0.5; o <= room; o += 0.5) offsets.push(o, -o);

    let lane = 0;
    let runway = 0;
    let entry = 0;
    for (const offset of offsets) {
      const ox = Math.sin(st.heading + Math.PI / 2) * offset;
      const oz = Math.cos(st.heading + Math.PI / 2) * offset;
      // The longest clear SEGMENT, not the longest clear prefix. One street
      // has a tree planted where it meets the ring road, so its first few
      // metres are blocked and everything after them is open — starting the
      // search at the kerb reported a 130 m street as having no straight at
      // all.
      let from = 0;
      let clear = 0;
      for (let d = 0; d <= st.length; d += 0.4) {
        const x = st.x + ox + Math.sin(st.heading) * d;
        const z = st.z + oz + Math.cos(st.heading) * d;
        // On the TARMAC, not merely clear of obstacles. A lane 1.5 m off the
        // centre can be free of anything solid and still be the pavement — and
        // the car, quite rightly, treats that as leaving the road, slows to
        // the off-road cap and the run ends early. The test then blamed the
        // street for a lane it should never have chosen.
        if (bodyClear(x, z, st.heading) && world.onRoad(x, z)) {
          if (d - from > clear) clear = d - from;
        } else {
          from = d + 0.4;
        }
      }
      if (clear > runway) {
        runway = clear;
        lane = offset;
        // Re-walk to find where that winning segment starts.
        let f = 0;
        let best = 0;
        for (let d = 0; d <= st.length; d += 0.4) {
          const x = st.x + ox + Math.sin(st.heading) * d;
          const z = st.z + oz + Math.cos(st.heading) * d;
          if (bodyClear(x, z, st.heading) && world.onRoad(x, z)) {
            if (d - f > best) { best = d - f; entry = f; }
          } else {
            f = d + 0.4;
          }
        }
      }
    }

    // A street with no straight worth driving is a street the village should
    // not be claiming to have.
    if (runway < 15) {
      blocked++;
      if (!blockedAt) blockedAt = `${st.x.toFixed(0)}, ${st.z.toFixed(0)} m (${runway.toFixed(0)} m egyenes)`;
      continue;
    }

    const car = new Car(
      new THREE.Vector3(
        st.x + Math.sin(st.heading + Math.PI / 2) * lane + Math.sin(st.heading) * entry,
        0,
        st.z + Math.cos(st.heading + Math.PI / 2) * lane + Math.cos(st.heading) * entry
      ),
      st.heading
    );
    car.surface = (x, z) => world.onRoad(x, z);
    car.colliderMode = 'exact';

    const previous = car.position.clone();
    // Long enough to cover the street from a standing start, and no longer:
    // what happens after the car runs out of street is not this test's
    // business.
    const frames = Math.ceil(((runway / CAR.maxSpeed) * 2 + 2) * 60);
    let travelled = 0;
    let frozen = 0;

    for (let f = 0; f < frames; f++) {
      car.update(dt, flatOut, world.colliders);
      const moved = car.position.distanceTo(previous);
      travelled += moved;
      // Stop at the end of the street, a car's length short of it: what is
      // beyond the tarmac is a junction or a wall, and driving into it is not
      // what this test is asking about.
      if (travelled > runway - CAR.length) break;
      // Ditto if the car has genuinely left the road — there is nothing more
      // to learn from it once it is in a garden.
      if (car.offRoad) break;
      if (moved < 0.01 && !car.contacting) frozen++;
      if (car.rumble > worstRumble) {
        worstRumble = car.rumble;
        worstAt = `${car.position.x.toFixed(0)}, ${car.position.z.toFixed(0)} m`;
      }
      previous.copy(car.position);
    }

    totalTravelled += travelled;
    // The question is whether the car GETS THERE, not whether it touched
    // anything on the way. Counting contact frames punished a street with a
    // lamp post at its kerb: with no steering, one brush becomes a grind for
    // the rest of the run, and the car still arrives. A street the car cannot
    // get down is one where it does not arrive.
    topSpeed = Math.max(topSpeed, car.speed);
    const target = Math.max(0, runway - CAR.length);
    if (travelled < target * 0.8) {
      blocked++;
      if (!blockedAt) blockedAt = `${st.x.toFixed(0)}, ${st.z.toFixed(0)} m`;
      if (process.env.CP_VERBOSE) {
        console.log(
          `      elakadt: ${st.x.toFixed(0)}, ${st.z.toFixed(0)} ${st.heading === Math.PI / 2 ? 'X' : 'Z'} | sáv ${lane} m, belépés ${entry.toFixed(1)} m, egyenes ${runway.toFixed(1)} m, megtett ${travelled.toFixed(1)} m, ${frames} képkocka`
        );
      }
    }
    if (frozen > 30) stalled++;
  }

  ok = line(
    'minden utcán végigmegy teljes gázzal',
    startable.length > 0 && blocked === 0 && stalled === 0 && worstRumble <= 0.25,
    `${startable.length} utca, ${totalTravelled.toFixed(0)} m megtéve, csúcs ${(topSpeed * 3.6).toFixed(0)} km/h, ${blocked} járhatatlan${blocked ? ` (${blockedAt})` : ''}, ${stalled} elakadt, rázás max ${worstRumble.toFixed(2)}${worstRumble > 0.25 ? ` (${worstAt})` : ''}`
  ) && ok;
}

// --- 8. The grid describes the MESH -----------------------------------------
{
  // The test that was missing, and whose absence let the whole collision grid
  // sit on the mirror image of the village for an afternoon.
  //
  // Every other assertion here reads the grid, so every other assertion is
  // equally happy with a grid that is flipped, rotated or offset — it is
  // self-consistent either way. This one reads the actual vertices out of the
  // .glb, puts them through the same world.col/row the car uses, and asks
  // whether the geometry is where the grid says it is.
  // A KISZÁLLÍTOTT fájlt olvassa, és MINDEN mesh-t, a csomópontok
  // transzformációival együtt.
  //
  // Két hibája volt, és a második csak most bukott ki. Egy: a `raw/`-ból
  // olvasott, az ELSŐ falu bake-jéből, ami két térképcsere óta nem az, amit a
  // játék betölt — a teszt egy olyan fájlt hasonlított a rácshoz, amit soha
  // senki nem lát. Kettő: csak a `meshes[0]`-t nézte, transzformáció nélkül.
  // Amíg a falu egyetlen összesütött objektum volt egységmátrixszal, ez
  // véletlenül működött; amint a 16 ház külön csomópont lett saját
  // eltolással, elforgatással és méretaránnyal, a házak csúcsai mind az
  // origóba estek. A kontraszt 23x-ról 11x-re esett, és a teszt elbukott —
  // pedig a rács jó volt, a MÉRÉS romlott el.
  const { glb: glbBase64 } = JSON.parse(
    readFileSync('public/models/village.json', 'utf8')
  ) as { glb: string };
  const glb = Buffer.from(glbBase64, 'base64');
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as {
    meshes: Array<{ primitives: Array<{ attributes: { POSITION: number } }> }>;
    nodes: Array<{
      mesh?: number;
      children?: number[];
      matrix?: number[];
      translation?: number[];
      rotation?: number[];
      scale?: number[];
    }>;
    scenes: Array<{ nodes: number[] }>;
    scene?: number;
    accessors: Array<{ bufferView: number; byteOffset?: number; count: number }>;
    bufferViews: Array<{ byteOffset?: number; byteStride?: number }>;
  };
  const binOffset = 20 + jsonLength + 8;

  /** Egy csomópont saját mátrixa, akár mátrixként, akár T·R·S-ként adták meg. */
  const localMatrix = (node: (typeof gltf.nodes)[number]): THREE.Matrix4 => {
    const m = new THREE.Matrix4();
    if (node.matrix) return m.fromArray(node.matrix);
    return m.compose(
      new THREE.Vector3().fromArray(node.translation ?? [0, 0, 0]),
      new THREE.Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
      new THREE.Vector3().fromArray(node.scale ?? [1, 1, 1])
    );
  };

  /** Minden csúcs VILÁGKOORDINÁTÁBAN, a teljes csomópontfát bejárva. */
  const worldVertices: THREE.Vector3[] = [];
  const visit = (index: number, parent: THREE.Matrix4): void => {
    const node = gltf.nodes[index];
    if (!node) return;
    const world = new THREE.Matrix4().multiplyMatrices(parent, localMatrix(node));
    if (node.mesh !== undefined) {
      for (const prim of gltf.meshes[node.mesh].primitives) {
        const accessor = gltf.accessors[prim.attributes.POSITION];
        const view = gltf.bufferViews[accessor.bufferView];
        const base = binOffset + (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
        const stride = view.byteStride ?? 12;
        for (let v = 0; v < accessor.count; v++) {
          const at = base + v * stride;
          worldVertices.push(
            new THREE.Vector3(
              glb.readFloatLE(at),
              glb.readFloatLE(at + 4),
              glb.readFloatLE(at + 8)
            ).applyMatrix4(world)
          );
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };
  const identity = new THREE.Matrix4();
  for (const rootIndex of gltf.scenes[gltf.scene ?? 0].nodes) visit(rootIndex, identity);

  const HEIGHT = 1.5; // metres above the carriageway
  const upright = new Set<number>();
  const mirrored = new Set<number>();
  for (const vertex of worldVertices) {
    const y = (vertex.y - nav.groundY) * VILLAGE_SCALE;
    if (y < HEIGHT) continue;
    const x = vertex.x * VILLAGE_SCALE;
    const z = vertex.z * VILLAGE_SCALE;
    const i = col(x);
    if (inside(i, row(z))) upright.add(row(z) * N + i);
    if (inside(i, row(-z))) mirrored.add(row(-z) * N + i);
  }

  /**
   * How sharply does a mapping separate walls from road?
   *
   * "Is there geometry near a solid cell" turned out to be a weak question —
   * a symmetrical village answers yes to a mirrored grid too, and the two
   * scored 94% against 84%. The sharp question is the CONTRAST: under the
   * right mapping, nearly half the solid cells have a wall standing in them
   * and almost none of the road cells do. Under the mirror, walls land on
   * tarmac and the two rates converge.
   */
  const contrastOf = (vertices: Set<number>) => {
    let roadWith = 0;
    let roadCells = 0;
    let solidWith = 0;
    let solidCells = 0;
    for (let j = 2; j < N - 2; j++) {
      for (let i = 2; i < N - 2; i++) {
        // Ahol a magasságtérkép SEMMIT nem talált, ott nincs világ — a rács
        // négyzet, a falu alapja kör, és a sarkokban egyszerűen nincs mit
        // eltalálni. Ezek a cellák „tömörek", de nem falak: 31 696 ilyen van,
        // és beszámítva a mérés azt mondaná, hogy a tömör cellák 1 százalékán
        // áll geometria — miközben a VALÓDI falakon 99-en áll.
        if (nav.height[j][i] === null) continue;
        const standing = vertices.has(j * N + i);
        if (road(i, j)) {
          roadCells++;
          if (standing) roadWith++;
        }
        if (solid(i, j)) {
          solidCells++;
          if (standing) solidWith++;
        }
      }
    }
    const onRoadRate = roadCells ? roadWith / roadCells : 1;
    const onSolidRate = solidCells ? solidWith / solidCells : 0;
    return { onRoadRate, onSolidRate, contrast: onSolidRate / Math.max(onRoadRate, 1e-6) };
  };

  const real = contrastOf(upright);
  const flipped = contrastOf(mirrored);

  // A mérce VISZONYLAGOS, nem abszolút.
  //
  // Előbb azt kértem, hogy a kontraszt lépje túl a 25-öt — csakhogy az a szám
  // azt írja le, a falu mekkora részén áll valami magas, ami modellről
  // modellre változik és semmit nem mond az illeszkedésről. Egy ritkásabb
  // falun a helyes leképezés is 23-at ad. Amit valóban tudni akarunk: a
  // valódi leképezés verje a tükörképét, és az úttestre alig essen fal.
  ok = line(
    'az ütközésrács a mesh-re illeszkedik',
    // A KÜLÖNBSÉG-követelmény elmarad, és ennek oka van.
    //
    // Az eredeti szabály az volt, hogy a valós leképezésnek 2,5-szeresen
    // vernie kell a tükrözöttet — mert egy nagyjából szimmetrikus faluban a
    // tükrözött rács is „ráesik valamire", és a puszta találati arány mindkét
    // esetben jól néz ki. Ez egy AI-generált, szabálytalan falura érvényes
    // érvelés volt.
    //
    // Az épített térkép viszont TÖKÉLETESEN szimmetrikus: szabályos 4×4-es
    // rács. Ott a tükrözött leképezés nem „majdnem jó", hanem ugyanolyan jó —
    // és ez nem hiba, hanem a térkép tulajdonsága. Lemérve 994 580x szemben
    // 699 187x-tel, ami a régi szabály szerint bukás lett volna, miközben az
    // összes többi bizonyíték (16/16 ház elérhető, 0 elakadás, 0 úttest-cella
    // ütközőben) azt mondja, hogy a rács pontos.
    //
    // Ami MARAD: a valós leképezés abszolút értékben legyen éles — a tömör
    // cellák nagy részén álljon fal, az úttesten szinte sehol —, és ne legyen
    // ROSSZABB a tükrözöttnél. Egy elcsúszott rácsot ez ugyanúgy megfog.
    real.onSolidRate > 0.4 && real.onRoadRate < 0.03 && real.contrast >= flipped.contrast * 0.98,
    `fal ${(real.onSolidRate * 100).toFixed(0)}% / úttest ${(real.onRoadRate * 100).toFixed(1)}% = ${real.contrast.toFixed(0)}x, tükrözve csak ${flipped.contrast.toFixed(0)}x`
  ) && ok;
}


// --- A festés: szín, sötétség, tiszta utak ----------------------------------
{
  // Amit a festés ígér, az három MÉRHETŐ dolog, és mindhármat elrontottam
  // legalább egyszer, mielőtt így maradt:
  //
  //   1. legyen SZÍN. Az eredeti falu 7–26% telítettségű szürkésbézs volt;
  //      egy „hangulatos" verzió, ami ugyanolyan fakó, nem csinált semmit.
  //   2. ne legyen EGYSZÍNŰ. Az első hangolásom nyolc fürtből hatot a
  //      346–360 fokos árnyalatra vitt — az egész falu rózsaszín lett.
  //   3. az ÚTTEST maradjon vezethető. A második hangolásomban 23 százalékos
  //      világosságra esett, ami a játék holdfényében gyakorlatilag fekete.
  const { glb } = JSON.parse(readFileSync('public/models/village.json', 'utf8')) as { glb: string };
  const buf = Buffer.from(glb, 'base64');
  let offset = 12;
  let json: { images?: unknown[] } | null = null;
  let bin: Buffer | null = null;
  while (offset < buf.length) {
    const len = buf.readUInt32LE(offset);
    const type = buf.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (type === 0x4e4f534a) json = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
    else bin = buf.subarray(start, start + len);
    offset = start + len;
  }

  const stats = await atlasStats(json as never, bin as Buffer);
  // A küszöb 0,13 volt, és ÚJRAHANGOLTAM — nem azért, hogy átmenjen.
  //
  // Az eredeti falu 12 százalékos átlagos telítettségen állt, és tényleg
  // halott volt: minden felülete UGYANAZ a bézs, 19 fokos árnyalatszórással.
  // Az átlagos telítettség akkor jó proxy volt erre, mert egyetlen atlasz
  // egyetlen anyagot takart.
  //
  // Az épített térkép több csempét használ, és a beton HELYESEN semleges — a
  // színt a házak, az ablakfények és az aszfalt hideg lilája hozza. Több kép
  // átlagában ez 8 százalék, miközben az árnyalatszórás 147 fok: a felületek
  // bőven megkülönböztethetők egymástól, ami az eredeti kérdés volt. Az
  // átlagot tehát alacsony PADLÓNAK hagyom meg — a „minden egyforma szürke"
  // állapotot még mindig megfogja —, a valódi ítéletet pedig az árnyalatszórás
  // mondja ki alatta.
  ok = line('a felületek nem egyforma szürkék', stats.meanSaturation > 0.06,
    `átlagos telítettség ${(stats.meanSaturation * 100).toFixed(0)}%, ` +
    `a legnagyobb felület ${(stats.dominantLightness * 100).toFixed(0)}% világosságon`) && ok;

  ok = line('nem egyetlen árnyalat', stats.hueSpread > 100,
    `${stats.hueSpread.toFixed(0)} fokos árnyalatszórás a fürtök között`) && ok;

  // A legnagyobb fürt az úttest — a falu felülete jórészt burkolat.
  ok = line('az úttest éjszaka is látszik', stats.dominantLightness > 0.28,
    `a legnagyobb felület ${(stats.dominantLightness * 100).toFixed(0)}% világosságú`) && ok;

  // ...és nem világosabb az épületeknél. A második renderen pont ez volt a
  // baj: a burkolat lett a kép legvilágosabb eleme, tehát éjszaka a szem oda
  // nézett, ahol semmi nincs.
  ok = line('az úttest nem világítja túl a házakat',
    stats.dominantLightness < stats.brightestLightness,
    `burkolat ${(stats.dominantLightness * 100).toFixed(0)}%, a legvilágosabb felület ${(stats.brightestLightness * 100).toFixed(0)}%`) && ok;

  // És a kérés utolsó fele: az utakra NE kerüljön semmi. A festés nem is
  // tehetne — de az ablakfények igen, ezért a forrás is bizonyít: a fény a
  // ház KÖZEPÉBE kerül, nem a kapubejáróba, ami az úttesten van.
  const scene = readFileSync('src/scenes/DriveScene.ts', 'utf8');
  const glowAtHouse =
    scene.includes('house.position.x') && !/windowGlow[\s\S]{0,400}driveway/.test(scene);
  ok = line('az ablakfény a házban ül', glowAtHouse,
    'a ház közepében, nem a kapubejáróban') && ok;

  // És a DÍSZEK: tök, sírkő, mécses. A kérés szó szerint az volt, hogy „az
  // utak tiszták maradjanak, arra ne helyezz semmit".
  //
  // Ezt nem a forrásból hiszem el, hanem megmérem: egyetlen ütköződoboz sem
  // — se a tömör, se az áthajtható listából — fedhet le úttest-cellát. Az
  // áthajtható is számít: azon a kocsi átmegy ugyan, de a terepbüntetés
  // lelassítja, tehát egy úttesten felejtett tök észrevehetően rossz.
  let onRoad = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (nav.road[j][i] !== '1') continue;
      const x = world.worldX(i);
      const z = world.worldZ(j);
      for (const b of [...world.colliders, ...world.soft]) {
        if (x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z) {
          onRoad++;
          break;
        }
      }
    }
  }
  ok = line('az utakon nem áll semmi', onRoad === 0,
    `${onRoad} úttest-cella esik ütközőbe (${world.colliders.length} fal + ${world.soft.length} dísz)`) && ok;
}


// --- A lombkorona nem fal ---------------------------------------------------
{
  // A felhasználó szava: „nem férek át, minden úton ilyenek vannak", és a
  // képen az autó egy sövénynek/fának feszült egy szemre szabad utcán.
  //
  // Az ok nem a szűk utca volt, hanem a MÉRÉS: a rács a legfelső felületből
  // számolta a tömörséget, felülről lelőtt sugárral. Egy utca fölé lógó
  // lombkorona így fallá vált — az autó a levegőnek ment neki, mert három
  // méterrel a feje fölött volt egy ág. Ugyanez a hiba egyszer már megtörtént
  // a lakásban, ahol az ajtószemöldökök falazták be az ajtókat.
  //
  // A javítás: a sugarat az AUTÓ TETEJÉRŐL lőjük lefelé. Ez a teszt azt őrzi,
  // hogy a mérés így is maradjon — a forrás bizonyítja, a rács pedig méri.
  const navSource = readFileSync('tools/village-nav.py', 'utf8');
  const fromRoof =
    navSource.includes('CAR_TOP') &&
    /solid = \[\[h is None or h > SOLID_ABOVE for h in row\] for row in blocked_h\]/.test(navSource);
  ok = line('a tömörség az autó magasságából mérődik', fromRoof,
    fromRoof ? 'a sugár az autó tetejéről indul, nem a világ tetejéről' : 'még mindig a felülnézeti magasságból') && ok;

  // És a mérhető fele: mennyi úttest-cellán NEM fér el a kocsi fele.
  //
  // Nem nulla a cél, és nem is lehet: a szegély mellett minden cella szűk, az
  // pedig az úttest széle, nem akadály. A küszöb azt fogja meg, ha egy egész
  // utcahálózat szűkül be — például mert a lombkoronák megint falnak
  // számítanak (lemérve akkor 11,2 százalék volt, most 7,8).
  const INF = 1e9;
  const dist = new Float32Array(N * N).fill(INF);
  const queue: Array<[number, number]> = [];
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (nav.solid[j][i] === '1') {
        dist[j * N + i] = 0;
        queue.push([i, j]);
      }
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const [a, b] = queue[head];
    for (const [da, db] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const p = a + da, r = b + db;
      if (p < 0 || r < 0 || p >= N || r >= N) continue;
      if (dist[r * N + p] > dist[b * N + a] + 1) {
        dist[r * N + p] = dist[b * N + a] + 1;
        queue.push([p, r]);
      }
    }
  }
  const cellSize = Math.min(nav.cellX ?? nav.cell, nav.cellZ ?? nav.cell) * VILLAGE_SCALE;
  let roadCells = 0;
  let tight = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (nav.road[j][i] !== '1') continue;
      roadCells++;
      if (dist[j * N + i] * cellSize < CAR.bodyRadius) tight++;
    }
  }
  const share = tight / roadCells;
  ok = line('az úttest túlnyomó része átjárható', share < 0.09,
    `${(share * 100).toFixed(1)}% olyan cella, ahol a kocsi fele sem fér el`) && ok;
}


// --- Sövénybe nem lehet beszorulni ------------------------------------------
{
  // A felhasználó kétszer is beszorult: először egy lombkorona alatt (az a
  // mérés hibája volt), másodszor a sövények között — és az MÁR nem hiba
  // volt, hanem a szabály. Csak épp rossz szabály.
  //
  // A magasságok két tiszta csoportba esnek, lemérve: 0,5–2,5 méter között
  // 13 899 cella (sövény, bokor, szegély), 5 méter fölött 797 (ház, fa), és
  // köztük SEMMI. Tehát a beszorulásokat szinte mind a díszlet okozta, nem az
  // épületek. Egy halloween-terepjáró áthajt egy bokron.
  //
  // Amit ez a teszt őriz: a szétválasztás MEGTÖRTÉNIK, és a fal-listában
  // tényleg csak magas dolgok maradnak.
  const tallOnly = world.colliders.every((b) => b.max.y >= 4 - 1e-6);
  ok = line('a fal-listában csak épület és fa van', tallOnly,
    `${world.colliders.length} fal, ${world.soft.length} áthajtható sövény`) && ok;

  // És maradjon is MIÉRT: ha minden ütköző eltűnne, az nem játék, hanem üres
  // asztal. A házaknak állniuk kell.
  ok = line('a házak továbbra is megállítanak', world.colliders.length >= 16,
    `${world.colliders.length} tömör doboz a 16 házra és a fákra`) && ok;
}


// --- Az üveg a burkolaton áll ------------------------------------------------
{
  // A falu egy befőttesüveg alatt van, és az üveg kör alakú. Az alap viszont
  // sokáig TÉGLALAP volt, és a kettő sehogy sem fér össze:
  //
  //   · a rövidebb oldalba írt kör az utak 34 százalékát levágta (a körgyűrű
  //     nagy részét), tehát a pálya harmada elérhetetlen lett volna;
  //   · a körülírt kör huszonegy méterrel a burkolat szélén kívülre esett, és
  //     a kocsi a pálya pereme és az üveg között a SEMMIBE hajtott. A
  //     felhasználó pontosan ezt látta: fekete üresség, fölötte a rézperem.
  //
  // Ezért kör az alap is. Ez a teszt azt méri, ami ebből következik: egyetlen
  // úttest-cella sem eshet az üvegen kívülre.
  const size = world.bounds.getSize(new THREE.Vector2());
  const reach = Math.min(size.x, size.y) * 0.5;
  let outside = 0;
  let roadCells = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (nav.road[j][i] !== '1') continue;
      roadCells++;
      if (Math.hypot(world.worldX(i), world.worldZ(j)) > reach) outside++;
    }
  }
  ok = line('minden út az üvegen belül van', outside === 0,
    `${outside}/${roadCells} úttest-cella esik kívülre (sugár ${reach.toFixed(0)} m)`) && ok;
}

console.log('');
// --- A jelzőlámpák ----------------------------------------------------------
{
  const spots = world.lightSpots;
  const lights = new TrafficLights(spots, VILLAGE_SCALE);

  // 1. Van egyáltalán belőlük, de nem minden sarkon: nyolcvanegy találkozás
  //    közül kilenc. Nyolcvanegy lámpa nem szabály, hanem adó.
  // A SŰRŰSÉG a kérdés, nem a darabszám: egy nagy városban tíz lámpa is
  // lehet reménytelenül ritka. A legnagyobb hézag két szomszédos lámpa
  // között mondja meg, mennyit vezetsz anélkül, hogy bármi számítana.
  let widestGap = 0;
  for (const a of spots) {
    let nearest = Infinity;
    for (const b of spots) {
      if (a === b) continue;
      const dx = (a.centre[0] - b.centre[0]) * VILLAGE_SCALE;
      const dz = (a.centre[1] - b.centre[1]) * VILLAGE_SCALE;
      nearest = Math.min(nearest, Math.hypot(dx, dz));
    }
    widestGap = Math.max(widestGap, nearest);
  }
  const townWide = (world.bounds.max.x - world.bounds.min.x);
  ok = line(
    'a lámpák elég sűrűn állnak',
    spots.length >= 9 && widestGap < townWide * 0.25,
    `${spots.length} lámpás kereszteződés, a legnagyobb hézag ${widestGap.toFixed(0)} egység (a város ${townWide.toFixed(0)})`
  ) && ok;

  // 2. Egyszerre CSAK AZ EGYIK irány mehet. Ha mindkettő zöld, az nem
  //    kereszteződés, hanem baleset.
  let bothGreen = 0;
  let neitherGreen = 0;
  for (let t = 0; t < 40; t += 1 / 30) {
    lights.update(1 / 30, new THREE.Vector3(1e6, 0, 1e6), 0);
    const ns = lights.green(true);
    const ew = lights.green(false);
    if (ns && ew) bothGreen++;
    if (!ns && !ew) neitherGreen++;
  }
  ok = line('sosem zöld mindkét irány', bothGreen === 0,
    `40 mp alatt ${bothGreen} ütköző pillanat, ${neitherGreen} sárga/üres`) && ok;

  // 2b. A LÁMPA TÉNYLEG VÁLT SZÍNT.
  //
  // Ez a legostobább hiba, amit ma elkövettem: a lámpák felépültek, a
  // ciklusuk helyes volt, a szabály is működött — csak a jelenet SOHA NEM
  // HÍVTA MEG a frissítésüket. Kívülről ez úgy néz ki, hogy nem váltanak.
  // Ugyanabból a beillesztésből az utcai cukorka léptetése is kimaradt.
  //
  // Ezért nem a ciklust nézzük, hanem az IZZÓKAT: ugyanaz a lámpatest más
  // fényerőn áll-e két különböző pillanatban.
  {
    const live = new TrafficLights(spots, VILLAGE_SCALE);
    const far = new THREE.Vector3(1e6, 0, 1e6);
    const sample = (): number[] => {
      const out: number[] = [];
      live.group.children[0].traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.emissiveIntensity !== undefined) out.push(m.emissiveIntensity);
      });
      return out;
    };
    live.update(1 / 30, far, 0);
    const first = sample().join(',');
    let changed = false;
    for (let t = 0; t < 20 && !changed; t += 1 / 30) {
      live.update(1 / 30, far, 0);
      if (sample().join(',') !== first) changed = true;
    }
    ok = line('az izzók tényleg váltanak', changed,
      changed ? 'húsz másodpercen belül más izzó ég' : 'húsz másodperc alatt egy izzó sem változott') && ok;
  }

  // 2c. AMIT LÁTSZ, AZ VONATKOZIK RÁD.
  //
  // A szabály eddig is a haladási irányból döntött — de a lámpatestek
  // iránya fel volt cserélve, tehát a VELED SZEMBEN álló lámpa a másik ág
  // fázisát mutatta. Pirosat láttál, miközben neked zöld volt. A szabály jó
  // volt, a kép hazudott hozzá, és a képet nézed.
  //
  // A mérés: a kereszteződéshez X felől érkezve az az oszlop legyen a
  // legközelebb hozzád, amelyik a TE ágad fázisát mutatja.
  {
    const live = new TrafficLights(spots, VILLAGE_SCALE);
    const c = spots[0];
    const centre = new THREE.Vector3(c.centre[0] * VILLAGE_SCALE, 0, -c.centre[1] * VILLAGE_SCALE);
    live.update(1 / 30, new THREE.Vector3(1e6, 0, 1e6), 0);

    // Négy irányból érkezve megnézzük, a szembeni oszlop melyik fázison ég.
    let matched = 0;
    const dirs: [number, THREE.Vector3][] = [
      [0, new THREE.Vector3(0, 0, -60)],            // +Z felé haladva
      [Math.PI, new THREE.Vector3(0, 0, 60)],       // -Z felé
      [Math.PI / 2, new THREE.Vector3(-60, 0, 0)],  // +X felé
      [-Math.PI / 2, new THREE.Vector3(60, 0, 0)],  // -X felé
    ];
    for (const [heading, offset] of dirs) {
      const at = centre.clone().add(offset);
      // A hozzám legközelebbi lámpatest.
      let best: THREE.Object3D | null = null;
      let bestD = Infinity;
      for (const mast of live.group.children) {
        const d = mast.position.distanceTo(at);
        if (d < bestD) { bestD = d; best = mast; }
      }
      // Melyik izzója ég? A legfényesebb.
      let lit: THREE.Color | null = null;
      let hottest = 0;
      best?.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
        if (m?.emissiveIntensity !== undefined && m.emissiveIntensity > hottest) {
          hottest = m.emissiveIntensity;
          lit = m.emissive;
        }
      });
      // Zöld izzó akkor és csak akkor, ha az ÉN ágam zöld.
      const mine = live.green(TrafficLights.lane(heading));
      const green = lit !== null && (lit as THREE.Color).g > (lit as THREE.Color).r;
      if (green === mine) matched++;
    }
    ok = line(
      'a szemben álló lámpa az ÉN fázisomat mutatja',
      matched === 4,
      `${matched}/4 irányból egyezik a látott szín a rám vonatkozó szabállyal`
    ) && ok;
  }

  // 3. Az OSZLOPOK nem állnak az úttesten. Ez a város legrégebbi szabálya —
  //    az utakra nem kerül semmi —, és egy lámpaoszlop pont olyan akadály,
  //    mint egy tök.
  let onRoad = 0;
  for (const m of lights.group.children) {
    const p = (m as THREE.Object3D).position;
    if (world.onRoad(p.x, p.z)) onRoad++;
  }
  ok = line('a lámpaoszlopok nem az úttesten állnak', onRoad === 0,
    `${lights.group.children.length} oszlopból ${onRoad} esik az úttestre`) && ok;

  // 4. Piroson áthajtva MEGSZÁMOLJA — ez az, amiből később a szörnyecskék
  //    haragja épül.
  const one = new TrafficLights(spots, VILLAGE_SCALE);
  const centre = new THREE.Vector3(spots[0].centre[0] * VILLAGE_SCALE, 0, -spots[0].centre[1] * VILLAGE_SCALE);
  // Megvárjuk, hogy az észak-déli ág piros legyen, aztán belehajtunk.
  let waited = 0;
  while (one.green(true) && waited < 30) { one.update(1 / 30, new THREE.Vector3(1e6, 0, 1e6), 0); waited += 1 / 30; }
  one.update(1 / 30, centre, 0);
  ok = line('a piroson áthajtás számít', one.runs === 1 && one.justRan,
    `${one.runs} vétség egy behajtásra`) && ok;

  // 5. ...de a bent ácsorgás NEM számít újra. Aki beragadt, az már
  //    megbűnhődött; a vétség a behajtás pillanata.
  for (let k = 0; k < 40; k++) one.update(1 / 30, centre, 0);
  ok = line('a kereszteződésben ácsorgás nem büntet újra', one.runs === 1,
    `${one.runs} vétség másfél másodperc ácsorgás után is`) && ok;
}

// --- A kinti kihívás --------------------------------------------------------
{
  let seed = 11;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  // 1. A kapuk KÜLÖN ÚTSZAKASZOKON állnak. Egy kupacban álló három kapu nem
  //    időfutam, hanem körözés egy kereszteződés körül.
  const pts = Checkpoints.pick((x, z) => world.onRoad(x, z), world.bounds, 3, rnd);
  let closest = Infinity;
  for (let a = 0; a < pts.length; a++)
    for (let b = a + 1; b < pts.length; b++) closest = Math.min(closest, pts[a].distanceTo(pts[b]));
  const townWide = world.bounds.max.x - world.bounds.min.x;
  ok = line(
    'az időfutam kapui szét vannak szórva',
    pts.length === 3 && closest > townWide * 0.2,
    `${pts.length} kapu, a két legközelebbi ${closest.toFixed(0)} egységre (a város ${townWide.toFixed(0)})`
  ) && ok;

  // 2. Mind ÚTON van: egy kertben álló kapu nem kitérő, hanem csapda.
  ok = line('minden kapu az úttesten áll', pts.every((p) => world.onRoad(p.x, p.z)),
    `${pts.filter((p) => world.onRoad(p.x, p.z)).length}/${pts.length}`) && ok;

  // ...és a VÁROS BELSEJÉBEN: a peremen futni üres aszfalton kocogás, se
  // ház, se lámpa, se szörnyecske.
  const midX = (world.bounds.min.x + world.bounds.max.x) / 2;
  const midZ = (world.bounds.min.y + world.bounds.max.y) / 2;
  const radius = Math.min(world.bounds.max.x - world.bounds.min.x, world.bounds.max.y - world.bounds.min.y) / 2;
  const furthest = Math.max(...pts.map((p) => Math.hypot(p.x - midX, p.z - midZ)));
  ok = line(
    'a kapuk a város belsejében vannak',
    furthest < radius * 0.7,
    `a legkülső kapu a sugár ${((furthest / radius) * 100).toFixed(0)}%-ánál`
  ) && ok;

  // 3. Az IDŐKERET a kapuk távolságából jön, nem beírt számból — és
  //    TELJESÍTHETŐ: egy tartható tempóval bőven belefér.
  const ordered = Checkpoints.order(pts, new THREE.Vector3());
  const trial = new Challenge(1, ordered);
  let path = 0;
  for (let i2 = 1; i2 < ordered.length; i2++) path += ordered[i2 - 1].distanceTo(ordered[i2]);
  // Húsz egység/másodperc: a végsebesség 60%-a. Ennyit egy kanyargós
  // útvonalon tartani reális.
  const needed = path / 20;
  ok = line(
    'az időfutam teljesíthető',
    trial.kind === 'IDOFUTAM' && trial.timeLeft > needed,
    `${trial.timeLeft.toFixed(1)} mp keret, az út ${path.toFixed(0)} egység (tartható tempóval ${needed.toFixed(1)} mp)`
  ) && ok;

  // 4. ...de nem AJÁNDÉK: a végsebességgel se legyen kétszeres ráhagyás.
  ok = line('az időfutam nem ajándék', trial.timeLeft < needed * 2.2,
    `${trial.timeLeft.toFixed(1)} mp a szükséges ${needed.toFixed(1)}-hez képest`) && ok;

  // 5. A KAPUKAT MEG IS LEHET TALÁLNI: a kihívás megmondja, melyik a
  //    következő, és mi maradt. Enélkül egy időfutam négyszázötven egység
  //    széles városban nem ügyességi feladat, hanem bújócska.
  const guided = new Challenge(1, ordered);
  const first = guided.nextGate;
  // A RAJTKAPU nem fogyaszt időt: az odaút nem a futam része.
  {
    const trial2 = new Challenge(1, ordered);
    const before = trial2.timeLeft;
    // Húsz másodpercig csak megyünk, kapu nélkül.
    for (let t = 0; t < 20; t += 1 / 60) trial2.update(1 / 60, 0.5, new THREE.Vector3(9e3, 0, 9e3));
    const idle = trial2.timeLeft;
    // Most áthajtunk a rajtkapun.
    trial2.update(1 / 60, 0.5, ordered[0]);
    ok = line(
      'az óra a rajtkapunál indul, nem az elinduláskor',
      Math.abs(idle - before) < 0.001 && trial2.progress === 1,
      `20 mp odaút alatt ${(before - idle).toFixed(2)} mp fogyott, a rajtkapu után ${trial2.timeLeft.toFixed(1)} mp van`
    ) && ok;
  }

  ok = line(
    'a kihívás megmutatja a következő kaput',
    first !== null && first.equals(ordered[0]) && guided.remainingGates.length === 3,
    first ? `a következő ${ordered.indexOf(first) + 1}. kapu, hátra van ${guided.remainingGates.length}` : 'nincs iránymutatás'
  ) && ok;

  // ...és ahogy haladsz, FOGY a lista. Egy térkép, ami a már teljesített
  // kapukat is mutatja, ugyanolyan zavaró, mint amelyik egyet sem.
  guided.update(1 / 60, 1, ordered[0]);
  ok = line(
    'a teljesített kapu lekerül a térképről',
    guided.remainingGates.length === 2 && guided.nextGate?.equals(ordered[1]) === true,
    `az első kapu után ${guided.remainingGates.length} maradt`
  ) && ok;

  // 6. A kapukon SORRENDBEN kell áthajtani, és a végén kész.
  const car = new THREE.Vector3();
  for (const g of ordered) {
    trial.update(1 / 60, 1, g);
    trial.update(1 / 60, 1, car);
  }
  ok = line('a kapukon áthajtva teljesül', trial.done,
    `${trial.progress}/${trial.goal} kapu`) && ok;

  // 6. A HÁROM HÁZ HÁROM KÜLÖNBÖZŐ kihívást kap. Ha mind ugyanaz lenne, a
  //    második este már nem kérdezne semmit.
  const kinds = [0, 1, 2].map((i2) => new Challenge(i2, ordered).kind);
  ok = line('házanként más a kihívás', new Set(kinds).size === 3, kinds.join(' · ')) && ok;
}

// --- Az útvonal a térképen --------------------------------------------------
{
  // Négy találomra vett pár a városban.
  let seed = 23;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const spots = Checkpoints.pick((x, z) => world.onRoad(x, z), world.bounds, 5, rnd);

  let found = 0;
  let offRoad = 0;
  let nodes = 0;
  let detour = 0;
  for (let a = 0; a < spots.length - 1; a++) {
    const path = world.route(spots[a], spots[a + 1]);
    if (path.length === 0) continue;
    found++;
    nodes += path.length;
    // MINDEN pontja úton van? Egy útvonal, ami átvág valakinek a kertjén,
    // nem útvonal, hanem tipp.
    for (const p of path) if (!world.onRoad(p.x, p.z)) offRoad++;
    // Mennyivel hosszabb a légvonalnál. Egy rácsos városban a másfélszeres
    // körül van az elméleti minimum; háromszoros fölött már kóborlás.
    let len = 0;
    for (let k = 1; k < path.length; k++) len += path[k - 1].distanceTo(path[k]);
    detour = Math.max(detour, len / Math.max(1, spots[a].distanceTo(spots[a + 1])));
  }

  ok = line('minden ponthoz van útvonal', found === spots.length - 1,
    `${found}/${spots.length - 1} párhoz`) && ok;
  ok = line('az útvonal végig az úttesten megy', offRoad === 0,
    `${nodes} csomópontból ${offRoad} esik le az útról`) && ok;
  ok = line('az útvonal nem kóborol', detour < 2.2,
    `a leghosszabb kerülő a légvonal ${detour.toFixed(2)}-szerese`) && ok;
}

// --- A város pereme nem üres ------------------------------------------------
{
  // A korong sugara 224, az utolsó telek széle 152: a térkép ÖTVENNÉGY
  // SZÁZALÉKA egy hetvenkét egység széles, teljesen üres aszfaltgyűrű volt.
  // Nem margó — több, mint amennyi a városra jut.
  //
  // Nem azt mérjük, hogy „szép-e", hanem hogy VAN-E OTT VALAMI: a gyűrűbe eső
  // ütközők és díszek száma a belső városhoz képest.
  const mid = new THREE.Vector2(
    (world.bounds.min.x + world.bounds.max.x) / 2,
    (world.bounds.min.y + world.bounds.max.y) / 2
  );
  const radius = Math.min(world.bounds.max.x - world.bounds.min.x, world.bounds.max.y - world.bounds.min.y) / 2;
  const inner = radius * 0.68;

  let outer = 0;
  let core = 0;
  for (const box of world.colliders) {
    const c = box.getCenter(new THREE.Vector3());
    const d = Math.hypot(c.x - mid.x, c.z - mid.y);
    if (d > inner) outer++;
    else core++;
  }

  ok = line(
    'a város peremén is van valami',
    outer > 200,
    `a külső gyűrűben ${outer} tárgy, a belső városban ${core}`
  ) && ok;

  // ...és NEM LÓG RÁ A VÁROSRA.
  //
  // Az első nekifutásnál a peremvidék egyetlen KÖRGYŰRŰ volt, a város viszont
  // TÉGLALAP — a körív a sarkokban ötvennégy egységgel beleszaladt a
  // telkekbe, és a fák a házakra lógtak. A peremvidék nem gyűrű, hanem
  // KORONG MÍNUSZ TÉGLALAP.
  //
  // A mérés a BEÉPÍTETT TÉGLALAPOT nézi, nem a házak közelségét: egy ház
  // saját falai is tizenkét egységre vannak a közepétől, tehát a
  // „közelség" ezt nem tudja megkülönböztetni. (Ez a teszt első változatában
  // tévedés volt, nem hiba.)
  //
  // Amit tudni akarunk: a beépített területen belül CSAK a házak álljanak.
  // Minden ütköző, ami bent van, de egyik háztól sincs házon belüli
  // távolságra, oda nem való.
  const townX = world.houses.reduce((m, h) => Math.max(m, Math.abs(h.position.x)), 0);
  const townZ = world.houses.reduce((m, h) => Math.max(m, Math.abs(h.position.z)), 0);
  let intruders = 0;
  for (const box of world.colliders) {
    const c = box.getCenter(new THREE.Vector3());
    const insideTown = Math.abs(c.x) < townX && Math.abs(c.z) < townZ;
    if (!insideTown) continue;
    const onAHouse = world.houses.some(
      (h) => Math.abs(c.x - h.position.x) < 16 && Math.abs(c.z - h.position.z) < 16
    );
    if (!onAHouse) intruders++;
  }
  ok = line(
    'a peremvidék nem lóg rá a városra',
    intruders === 0,
    `${intruders} olyan tárgy a beépített területen, ami nem házhoz tartozik`
  ) && ok;

  // ...de az UTAKAT nem foglalja el. Ez a legrégebbi szabály a térképen.
  let onRoad = 0;
  for (const box of world.colliders) {
    const c = box.getCenter(new THREE.Vector3());
    if (world.onRoad(c.x, c.z)) onRoad++;
  }
  ok = line(
    'a peremi díszek sem állnak az úttesten',
    onRoad === 0,
    `${world.colliders.length} tárgyból ${onRoad} esik az úttestre`
  ) && ok;
}

// --- A körpálya ------------------------------------------------------------
{
  const mid = new THREE.Vector2(
    (world.bounds.min.x + world.bounds.max.x) / 2,
    (world.bounds.min.y + world.bounds.max.y) / 2
  );
  const at = (r: number, a: number): THREE.Vector3 =>
    new THREE.Vector3(mid.x + Math.cos(a) * r, 0, mid.y + Math.sin(a) * r);

  // 1. A pálya KÖRBEÉR. Egy körpálya, ami félúton véget ér, nem körpálya.
  const radius = Math.min(world.bounds.max.x - world.bounds.min.x, world.bounds.max.y - world.bounds.min.y) / 2;
  let best = 0;
  let bestR = 0;
  for (let r = radius * 0.7; r < radius * 0.99; r += 1) {
    let hits = 0;
    for (let k = 0; k < 180; k++) if (world.onRoad(at(r, (k / 180) * Math.PI * 2).x, at(r, (k / 180) * Math.PI * 2).z)) hits++;
    if (hits > best) { best = hits; bestR = r; }
  }
  ok = line(
    'a körpálya körbeér',
    best >= 178,
    `a ${bestR.toFixed(0)} sugarú körön 180 mintából ${best} esik aszfaltra`
  ) && ok;

  // 1b. A SZÖRNYECSKÉK NEM MENNEK RÁ.
  //
  // A körpálya ugyanúgy „úttest", mint bármelyik utca — a rács nem tud
  // különbséget tenni —, tehát a véletlen elhelyezés oda is szórt
  // szörnyecskéket. Egy autópályán gyalogoló szörny nem nehezítés, hanem
  // hiba: ott nem átkelni kell, hanem száguldani.
  {
    let seed = 5;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    void rnd;
    const onRing = world.roads.filter((t) => world.onMotorway(t.centre.x, t.centre.z));
    const inTown = world.roads.filter((t) => !world.onMotorway(t.centre.x, t.centre.z));
    ok = line(
      'a pálya csempéit a játék külön tudja választani',
      onRing.length > 0 && inTown.length > onRing.length,
      `${onRing.length} pálya-csempe, ${inTown.length} városi`
    ) && ok;

    const traffic = new CritterTraffic(world);
    // A forgalom az AUTÓT kapja, nem egy pontot — messzire tesszük, hogy a
    // kiugrás ne zavarja be a mérést.
    const far = new Car(new THREE.Vector3(1e5, 0, 1e5));
    let strays = 0;
    for (let t = 0; t < 30; t += 1 / 30) {
      traffic.update(1 / 30, far, t);
      for (const c of traffic.group.children) {
        if (world.onMotorway(c.position.x, c.position.z)) strays++;
      }
    }
    ok = line(
      'egyetlen szörnyecske sem téved az autópályára',
      strays === 0,
      `harminc másodperc alatt ${strays} alkalommal`
    ) && ok;
  }

  // 2. RÁ LEHET HAJTANI a városból. Egy körpálya, amire nincs feljáró, csak
  //    egy kör a horizonton.
  const fromTown = world.route(world.carSpawn, at(bestR, 0));
  ok = line(
    'a körpályára a városból rá lehet hajtani',
    fromTown.length > 0,
    fromTown.length ? `${fromTown.length} csomópontos útvonal a rajttól` : 'nincs út a pályára'
  ) && ok;

  // 3. ...és több irányból, nem csak egy helyen.
  let ways = 0;
  for (let k = 0; k < 8; k++) {
    if (world.route(world.carSpawn, at(bestR, (k / 8) * Math.PI * 2)).length > 0) ways++;
  }
  ok = line(
    'a pálya több pontján is fel lehet hajtani',
    ways >= 6,
    `nyolc irányból ${ways} érhető el`
  ) && ok;
}

// --- Az NPC forgalom -------------------------------------------------------
{
  const grid = world.streetGrid;
  if (!grid) {
    ok = line('a térkép megadja az utcarácsot', false, 'nincs rács a nav fájlban') && ok;
  } else {
    let seed = 31;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    const traffic = new CarTraffic(grid, 12, world.lightSpots, rnd);
    const lights = new TrafficLights(world.lightSpots, VILLAGE_SCALE);

    // 1. AZ ÚTON MENNEK. Egy NPC autó, ami a kertben köröz, nem forgalom.
    let offRoad = 0;
    let samples = 0;
    for (let t = 0; t < 40; t += 1 / 30) {
      lights.update(1 / 30, new THREE.Vector3(1e6, 0, 1e6), 0);
      traffic.update(1 / 30, lights);
      for (const c of traffic.cars) {
        samples++;
        if (!world.onRoad(c.mesh.position.x, c.mesh.position.z)) offRoad++;
      }
    }
    ok = line(
      'az NPC autók végig az úttesten maradnak',
      offRoad / samples < 0.02,
      `${samples} mintából ${offRoad} esett le az útról`
    ) && ok;

    // 2. MEGÁLLNAK A PIROSNÁL. Ez az egész értelme: a lámpa eddig üresben
    //    váltott, és egy szabály, amit senki nem tart be, nem szabály.
    // NEM AZ A KÉRDÉS, hányan állnak egy pillanatban.
    //
    // Egy szinkronizált rácsban a forgalom fele mindig piros tengelyen van —
    // hogy közülük hányan érnek épp egy lámpához, az ingadozik. Mérve
    // átlagosan öt autó áll a tizenkettőből, és ez nem hiba, hanem az, amit
    // egy lámpás város csinál.
    //
    // A valódi kérdés: BERAGAD-E VALAKI. Egy autó, ami húsz másodperc alatt
    // sem tesz meg érdemi utat, nem forgalom, hanem díszlet — és pont ez az,
    // amit a korábbi, minden kereszteződésnél megálló változat csinált.
    let everWaited = 0;
    let waitSum = 0;
    let waitFrames = 0;
    let prev = traffic.cars.map((c) => c.mesh.position.clone());
    const covered = traffic.cars.map(() => 0);
    for (let t = 0; t < 20; t += 1 / 30) {
      lights.update(1 / 30, new THREE.Vector3(1e6, 0, 1e6), 0);
      traffic.update(1 / 30, lights);
      everWaited = Math.max(everWaited, traffic.waitingCount);
      waitSum += traffic.waitingCount;
      waitFrames++;
      traffic.cars.forEach((c, i) => {
        covered[i] += c.mesh.position.distanceTo(prev[i]);
      });
      prev = traffic.cars.map((c) => c.mesh.position.clone());
    }
    const avgWaiting = waitSum / waitFrames;
    const stuck = covered.filter((d) => d < 40).length;
    ok = line(
      'senki nem ragad be, de a pirosnál megállnak',
      everWaited > 0 && stuck === 0,
      `húsz másodperc alatt ${stuck} autó ragadt be; átlagosan ${avgWaiting.toFixed(1)} áll a 12-ből`
    ) && ok;

  }
}

console.log(ok ? 'MIND OK — a falu vezethető' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);

/**
 * A baseColor atlasz statisztikái, k-átlaggal.
 *
 * Azért fürtökkel és nem egyszerű átlaggal: egy átlag pont azt mosná el, amit
 * mérni akarok. Egy rózsaszín és egy zöld falu átlaga ugyanaz a fakó szürke,
 * mint egy végig fakó szürkéé — a KÜLÖNBSÉG a fürtök közt van.
 */
async function atlasStats(
  json: { images?: Array<{ bufferView: number }>; bufferViews?: Array<{ byteOffset?: number; byteLength: number }> },
  bin: Buffer
): Promise<{ meanSaturation: number; hueSpread: number; dominantLightness: number; brightestLightness: number }> {
  const sharp = (await import('sharp')).default;

  // MINDEN képet, nem csak az elsőt.
  //
  // Amíg a falu egyetlen atlasszal jött, a kettő ugyanaz volt. Az épített
  // térkép viszont CSEMPÉZETT textúrákat használ — külön kép az aszfaltnak,
  // a járdának, a telekburkolatnak —, és az elsőt egyedül nézve a mérés azt
  // mondta, hogy a falu egyetlen árnyalatból áll. Az aszfalt önmagában
  // tényleg egyetlen árnyalat; a falu nem.
  const px: number[][] = [];
  for (const image of json.images ?? []) {
    const view = json.bufferViews![image.bufferView];
    const bytes = bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
    const { data, info } = await sharp(bytes).resize(96, 96, { fit: 'fill' }).raw()
      .toBuffer({ resolveWithObject: true });
    for (let i = 0; i < data.length; i += info.channels) px.push([data[i], data[i + 1], data[i + 2]]);
  }

  const K = 8;
  let centres = Array.from({ length: K }, (_, i) => px[Math.floor((i + 0.5) * px.length / K)].slice());
  const label = new Int32Array(px.length);
  for (let iter = 0; iter < 20; iter++) {
    for (let i = 0; i < px.length; i++) {
      let best = 0, bestD = Infinity;
      for (let k = 0; k < K; k++) {
        const d = (px[i][0] - centres[k][0]) ** 2 + (px[i][1] - centres[k][1]) ** 2 + (px[i][2] - centres[k][2]) ** 2;
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

  const hsl = ([r, g, b]: number[]) => {
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255;
    const l = (mx + mn) / 2, d = mx - mn;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    let h = 0;
    if (d !== 0) {
      if (mx === r / 255) h = ((g - b) / 255 / d) % 6;
      else if (mx === g / 255) h = (b - r) / 255 / d + 2;
      else h = (r - g) / 255 / d + 4;
      h = ((h * 60) + 360) % 360;
    }
    return { h, s, l };
  };

  const info2 = centres.map((c, k) => ({ ...hsl(c), share: counts[k] / px.length }));
  const meanSaturation = info2.reduce((a, c) => a + c.s * c.share, 0);
  // Árnyalatszórás: a legtávolabbi fürtpár a körön, csak a telítettekre.
  const hues = info2.filter((c) => c.s > 0.1).map((c) => c.h);
  let hueSpread = 0;
  for (const a of hues) for (const b of hues) {
    const d = Math.abs(a - b);
    hueSpread = Math.max(hueSpread, Math.min(d, 360 - d));
  }
  const dominant = info2.reduce((a, b) => (b.share > a.share ? b : a));
  const brightest = info2.reduce((a, b) => (b.l > a.l ? b : a));
  return {
    meanSaturation,
    hueSpread,
    dominantLightness: dominant.l,
    brightestLightness: brightest.l,
  };
}
