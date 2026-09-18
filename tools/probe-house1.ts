import { planFor, planToWorld } from '../src/world/HousePlan';
import { readFileSync } from 'node:fs';
import { baseColorTextureIndex, imageBytes, readGlb } from '../src/assets/textureRepair';
import * as THREE from 'three';
import { CANDY_HEIGHT, VillageHouse, HOUSE1_SCALE } from '../src/world/VillageHouse';
import { PITCH_STEPS } from '../src/camera/Stage';
import { CAMERA, HOUSE, MOVE, NOISE, HOMEOWNER, DOG, CAPTURE } from '../src/core/config';
import { Dog } from '../src/ai/Dog';
import { addOutlines } from '../src/render/Toon';
import { Echo } from '../src/world/Echo';
import { arrowRotation } from '../src/ui/NavigatorMap';
import { HouseGame } from '../src/game/HouseGame';
import { Homeowner } from '../src/ai/Homeowner';
import { NoiseSystem } from '../src/systems/NoiseSystem';
import { PlayerController } from '../src/player/PlayerController';

/**
 * Is the first house playable?
 *
 * The flat is measured out of a model rather than built, so every fact about it
 * is a claim that can be wrong: that you can get in, that you can reach the
 * sweets, that the owner's round goes anywhere, that the players fit through
 * the doors. None of that is visible in a render.
 *
 * Run: npm run probe:house1
 */
/**
 * MELYIK házat mérjük?
 *
 * Három van, és mindegyiknek ugyanazt kell tudnia: van bejárata, minden
 * szobája elérhető, elfér benne a lakó, van hova elbújni. Egy próba, ami
 * csak az elsőt nézi, a másik kettőről semmit nem mond — és pont azok az
 * újak, tehát pont azokban van a hiba.
 *
 *   npm run probe:house1            → mindhárom
 *   npm run probe:house1 -- house2  → csak az egyik
 *
 * A NEVE nem `HOUSE`, mert az már foglalt: a config `HOUSE` objektuma tartja
 * a szakasz szabályait (cukorkakvóta, elkapási sugár). Elsőre elfedtem, és a
 * próba „undefined cukorka kell"-t írt ki — a hiba nem a házban volt, hanem
 * abban, hogy két különböző dolgot hívtam ugyanúgy.
 */
const HOUSE_NAME = process.argv[2] ?? 'house1';
const nav = JSON.parse(readFileSync(`public/models/${HOUSE_NAME}-nav.json`, 'utf8'));
console.log(`— ${HOUSE_NAME} —`);
const house = VillageHouse.fromNav(nav);
const N = house.gridSize;
const CELL = house.cell;

function line(label: string, pass: boolean, detail: string): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(46)} ${detail}`);
  return pass;
}

let ok = true;
const span = (nav.max[0] - nav.min[0]) * HOUSE1_SCALE;
console.log(`lakás: ${span.toFixed(0)} m széles, rácscella ${CELL.toFixed(2)}, skála ${HOUSE1_SCALE}`);
console.log(`szobák: ${nav.roomInfo.length}, cukorka: ${nav.candy.length}, csíny: ${nav.pranks.length}`);
console.log('');

/** Does a player's whole body fit on this cell? */
const RADIUS = Math.ceil(MOVE.radius / CELL);
const free = (i: number, j: number): boolean => {
  for (let b = -RADIUS; b <= RADIUS; b++) {
    for (let a = -RADIUS; a <= RADIUS; a++) if (house.solidAt(i + a, j + b)) return false;
  }
  return true;
};

/** Everywhere a player can get to from the front door. */
const reachable = (() => {
  const seen = new Uint8Array(N * N);
  const start: Array<[number, number]> = [];
  for (const s of house.spawns) start.push([house.col(s.x), house.row(s.z)]);
  const queue = start.filter(([i, j]) => free(i, j));
  for (const [i, j] of queue) seen[j * N + i] = 1;
  while (queue.length) {
    const [i, j] = queue.pop()!;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
      const a = i + di;
      const b = j + dj;
      if (a >= 0 && b >= 0 && a < N && b < N && !seen[b * N + a] && free(a, b)) {
        seen[b * N + a] = 1;
        queue.push([a, b]);
      }
    }
  }
  return seen;
})();

const canStand = (p: THREE.Vector3, slack = 2): boolean => {
  const i = house.col(p.x);
  const j = house.row(p.z);
  for (let b = -slack; b <= slack; b++) {
    for (let a = -slack; a <= slack; a++) {
      if (a + i >= 0 && b + j >= 0 && a + i < N && b + j < N && reachable[(j + b) * N + i + a]) return true;
    }
  }
  return false;
};

// --- 1. You can stand where you come in ------------------------------------
{
  const bad = house.spawns.filter((s) => !free(house.col(s.x), house.row(s.z)));
  ok = line('mindkét játékos elfér a bejáratnál', bad.length === 0,
    house.spawns.map((s) => `${s.x.toFixed(0)},${s.z.toFixed(0)}`).join(' · ')) && ok;
}

// --- 2. The flat is one place, not several ---------------------------------
{
  const total = reachable.reduce((a: number, b: number) => a + b, 0);
  let standable = 0;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (free(i, j) && nav.rooms[j][i] !== '0') standable++;
  const share = standable ? total / standable : 0;
  ok = line('a lakás bejárható egy darabban', share > 0.85,
    `${total} cella elérhető a ${standable} állható cellából (${(share * 100).toFixed(0)}%)`) && ok;
}

// --- 3. Every sweet can be picked up ---------------------------------------
{
  const stuck = house.candySpots.filter((c) => !canStand(c.position));
  ok = line('minden cukorka elérhető', stuck.length === 0,
    `${house.candySpots.length - stuck.length}/${house.candySpots.length}`) && ok;
}

// --- 4. Every prank can be reached -----------------------------------------
{
  const stuck = house.prankSpots.filter((p) => !canStand(p.position));
  ok = line('minden csíny elérhető', stuck.length === 0,
    `${house.prankSpots.length - stuck.length}/${house.prankSpots.length}`) && ok;
}

// --- 5. The homeowner's round works ----------------------------------------
{
  const stuck = house.patrolWaypoints.filter((w) => !canStand(w, 3));
  const start = canStand(house.homeownerSpawn, 3);
  ok = line('a házigazda járőrútja bejárható', stuck.length === 0 && start,
    `${house.patrolWaypoints.length - stuck.length}/${house.patrolWaypoints.length} pont${start ? '' : ', a kezdőpontja beragadt'}`) && ok;
}

// --- 6. The sweets are spread out ------------------------------------------
{
  // Sweets clustered in one corner make a house you cross once. The point of a
  // flat is that you have to go into rooms the owner is also in — so measure
  // how far apart they actually are, in metres, rather than counting rooms
  // (this model's doors are open, so it is one navigable space and "rooms" is
  // not a question the geometry answers).
  let closest = Infinity;
  for (let a = 0; a < house.candySpots.length; a++) {
    for (let b = a + 1; b < house.candySpots.length; b++) {
      closest = Math.min(closest, house.candySpots[a].position.distanceTo(house.candySpots[b].position));
    }
  }
  const flat = (nav.max[0] - nav.min[0]) * HOUSE1_SCALE;
  ok = line('a cukorka szét van szórva a lakásban', closest > flat * 0.15,
    `a két legközelebbi ${closest.toFixed(0)} m-re, a lakás ${flat.toFixed(0)} m széles`) && ok;
}

// --- 7. There is cover to hide behind --------------------------------------
{
  // The stealth only works if standing somewhere breaks his line of sight.
  // Sampling pairs of reachable cells and asking how often the view is blocked
  // measures exactly that, and a flat with no interior walls would fail it.
  let blocked = 0;
  let tried = 0;
  const cells: Array<[number, number]> = [];
  for (let j = 0; j < N; j += 4) for (let i = 0; i < N; i += 4) if (reachable[j * N + i]) cells.push([i, j]);
  for (let k = 0; k < cells.length && tried < 4000; k += 3) {
    const a = cells[k];
    const b = cells[(k * 7 + 13) % cells.length];
    tried++;
    if (house.sightBlocked(
      new THREE.Vector3(house.worldX(a[0]), 0, house.worldZ(a[1])),
      new THREE.Vector3(house.worldX(b[0]), 0, house.worldZ(b[1]))
    )) blocked++;
  }
  const share = tried ? blocked / tried : 0;
  ok = line('van mögé bújni való', share > 0.35 && share < 0.98,
    `${(share * 100).toFixed(0)}% a takart rálátás ${tried} mintából`) && ok;
}

// --- 8. The way out is the way you came in ---------------------------------
{
  const exit = house.exitZone;
  ok = line('a kijárat a bejáratnál van és elérhető',
    canStand(exit) && exit.distanceTo(house.spawns[0]) < 20,
    `kijárat ${exit.x.toFixed(0)},${exit.z.toFixed(0)} — ${exit.distanceTo(house.spawns[0]).toFixed(1)} m a rajttól`) && ok;
}


// --- 9. The map arrow points where the car is going -------------------------
{
  // The navigator's map read backwards: the arrow was rotated by MINUS the
  // heading, which is wrong by exactly 180 degrees at every heading, so
  // pressing forward pointed the arrow at where the car had come from.
  //
  // The test is the two conventions meeting. Forward in the world is
  // (sin h, cos h) in x/z; the map puts +z DOWN the canvas. So the drawn arrow
  // tip, after rotation, has to land on the same direction as the movement.
  let worst = 0;
  for (let k = 0; k < 16; k++) {
    const heading = (k / 16) * Math.PI * 2;
    const r = arrowRotation(heading);
    // The arrow is drawn with its tip at (0, -1) before rotation.
    const tipX = Math.sin(r);
    const tipY = -Math.cos(r);
    // Where the car actually goes, in map pixels: x right, z down.
    const goX = Math.sin(heading);
    const goY = Math.cos(heading);
    worst = Math.max(worst, Math.hypot(tipX - goX, tipY - goY));
  }
  ok = line('a térkép nyila arra mutat, amerre a kocsi megy', worst < 1e-6,
    `legnagyobb eltérés ${worst.toExponential(1)}`) && ok;
}

// --- 10. The house has a job in it -----------------------------------------
{
  // Walking in used to end the house on the spot: the way out was the spot you
  // spawned on, so both players were inside the exit zone from the first frame
  // and "KIJUTOTTATOK" fired before anyone had moved. Two things fix that and
  // both are checked here — there is an errand to do, and the door is not
  // where you are standing when you arrive.
  const quotaFits = HOUSE.candyQuota > 0 && HOUSE.candyQuota <= house.candySpots.length;
  const startsAway = house.spawns.every((s) => s.distanceTo(house.exitZone) > house.exitRadius);
  ok = line(
    'a ház nem ér véget, mielőtt elkezdődne',
    quotaFits && startsAway,
    `${HOUSE.candyQuota} cukorka kell a ${house.candySpots.length}-ből, a rajt ${house.spawns[0].distanceTo(house.exitZone).toFixed(0)} m-re a kijárattól (sugara ${house.exitRadius})`
  ) && ok;
}

// --- 11. The door opens only when the errand is done ------------------------
{
  // The bug as reported: walk in and the game immediately says you escaped and
  // cuts back to the street. Config alone cannot prove that is fixed — only
  // running the section can. So: stand both players IN the doorway with no
  // sweets and hold them well past the exit hold time, then give them the
  // quota and check the same spot now lets them out.
  const homeowner = new Homeowner(house.homeownerSpawn, house.patrolWaypoints, []);
  homeowner.sightBlocked = (from, to) => house.sightBlocked(from, to);
  const game = new HouseGame(house, homeowner, new NoiseSystem());
  const atDoor = [0, 1].map((i) => new PlayerController(i, 0xffffff, house.exitZone.clone()));
  const idle = {
    get: () => ({ moveX: 0, moveY: 0, jump: false, interact: false, sprint: false, interactHeld: false }),
  } as never;

  for (let f = 0; f < 60 * 6; f++) game.update(1 / 60, atDoor, idle);
  const heldBack = !game.stats.escaped;

  for (const c of house.candySpots.slice(0, HOUSE.candyQuota)) c.taken = true;
  for (let f = 0; f < 60 * 6; f++) game.update(1 / 60, atDoor, idle);
  const letOut = game.stats.escaped;

  ok = line(
    'az ajtó csak a küldetés után nyílik',
    heldBack && letOut,
    `cukorka nélkül ${heldBack ? 'nem enged ki' : 'KIDOB'}, a kvóta után ${letOut ? 'kienged' : 'NEM ENGED KI'}`
  ) && ok;
}

// --- 12. You can see where you are ------------------------------------------
{
  // The complaint that started this: dropped into a slot a metre and a half
  // wide, both monsters filling the frame, nothing behind them but white wall
  // — and then, once that was fixed, still only ever one room on screen.
  //
  // Being small is the joke; not being able to see what you are small NEXT to
  // is not. So this checks the LENS against the flat's own rooms, at both ends
  // of the shared camera's travel. The closest framing matters as much as the
  // furthest: the camera comes right in when the players stand together, and
  // that is exactly when the flat used to vanish behind them.
  const sees = (distance: number) =>
    2 * distance * Math.tan((CAMERA.houseFov * Math.PI) / 360);

  const flat = (nav.max[0] - nav.min[0]) * HOUSE1_SCALE;
  const room = flat / 4; // this flat is about four rooms across

  const closest = sees(CAMERA.houseMinDistance);
  const furthest = sees(CAMERA.houseMaxDistance);
  const split = sees(CAMERA.houseFollowDistance);

  ok = line(
    'a szoba a legszűkebb kameraállásban is látszik',
    closest >= room && split >= room * 0.9,
    `szoba ~${room.toFixed(0)} m; közelről ${closest.toFixed(0)} m, osztott nézetben ${split.toFixed(0)} m`
  ) && ok;

  // NOT "and the widest framing fits several rooms" — that was the requirement
  // before the camera became room-based, and it is now the opposite of what is
  // wanted: seeing several rooms at once is the thing being prevented. What the
  // widest framing has to do instead is stay comfortable, which test 20 checks.
}

// --- 13. There is room to stand where the pair lands ------------------------
{
  // A cramped spawn jams the shared camera to its closest framing whatever the
  // lens is, so this is checked separately from the lens itself.
  const clearanceAt = (p: THREE.Vector3) => {
    const i = house.col(p.x);
    const j = house.row(p.z);
    let free = 0;
    outer: for (let r = 1; r < 60; r++) {
      for (let b = -r; b <= r; b++) {
        for (let a = -r; a <= r; a++) if (house.solidAt(i + a, j + b)) break outer;
      }
      free = r;
    }
    return free * house.cell;
  };
  const worst = Math.min(...house.spawns.map(clearanceAt));
  ok = line('van hely ott, ahová a páros érkezik', worst > 1.5,
    `a szűkebbik rajtpont körül ${worst.toFixed(1)} m szabad`) && ok;
}

// --- 14. The collision agrees with the navigation ---------------------------
{
  // This class of bug has now bitten twice, and both times the symptom was a
  // flat you could not walk around. The navigation grid and the collider boxes
  // are built from different things — one from what a ray at head height can
  // pass through, one from the height map — and when they disagree, the game
  // says "you may walk here" and the physics says "no".
  //
  // The rule is simple and absolute: walkable means no box, solid means a box.
  let walkableInsideBox = 0;
  let solidOutsideBox = 0;
  let checked = 0;

  // A cheap lookup: which boxes cover which grid column.
  const boxesNear = (x: number, z: number) =>
    house.colliders.some((b) => x >= b.min.x && x <= b.max.x && z >= b.min.z && z <= b.max.z);

  for (let j = 1; j < N - 1; j += 2) {
    for (let i = 1; i < N - 1; i += 2) {
      const x = house.worldX(i);
      const z = house.worldZ(j);
      checked++;
      const inBox = boxesNear(x, z);
      if (house.solidAt(i, j)) {
        if (!inBox) solidOutsideBox++;
      } else if (inBox) {
        walkableInsideBox++;
      }
    }
  }

  ok = line(
    'az ütközés ugyanazt mondja, mint a navigáció',
    walkableInsideBox === 0 && solidOutsideBox < checked * 0.02,
    `${walkableInsideBox} járható cella van dobozban, ${solidOutsideBox} fal van doboz nélkül (${checked} mintából)`
  ) && ok;
}

// --- 15. You can actually walk into the other rooms -------------------------
{
  // The reported bug, run rather than reasoned about: take the real player and
  // the real colliders, and walk from the spawn to each sweet. If the doorways
  // are bricked up — which they were, by 3359 cells' worth of collider — the
  // player stops at the first wall and never arrives.
  //
  // The route comes from the grid, because this is a test of the COLLISION,
  // not of my ability to write a pathfinder: walking at the target and hoping
  // gets stuck on the first corner of any real floor plan and proves nothing.
  const path = (from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] | null => {
    const start = [house.col(from.x), house.row(from.z)] as [number, number];
    const goal = [house.col(to.x), house.row(to.z)] as [number, number];
    const came = new Int32Array(N * N).fill(-1);
    const seen = new Uint8Array(N * N);
    const queue: Array<[number, number]> = [start];
    seen[start[1] * N + start[0]] = 1;

    while (queue.length) {
      const [i, j] = queue.shift()!;
      if (Math.abs(i - goal[0]) <= 3 && Math.abs(j - goal[1]) <= 3) {
        const out: THREE.Vector3[] = [];
        let at = j * N + i;
        while (at >= 0) {
          out.push(new THREE.Vector3(house.worldX(at % N), 0, house.worldZ(Math.floor(at / N))));
          at = came[at];
        }
        return out.reverse();
      }
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as Array<[number, number]>) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N || seen[b * N + a] || !free(a, b)) continue;
        seen[b * N + a] = 1;
        came[b * N + a] = j * N + i;
        queue.push([a, b]);
      }
    }
    return null;
  };

  let walked = 0;
  let worstStuck = '';
  for (const candy of house.candySpots) {
    const route = path(house.spawns[0], candy.position);
    if (!route) {
      worstStuck = worstStuck || 'nincs útvonal a rácson';
      continue;
    }

    const player = new PlayerController(0, 0xffffff, house.spawns[0].clone());
    let node = 0;
    let arrived = false;
    for (let f = 0; f < 60 * 60 && !arrived; f++) {
      // Aim at a waypoint a little way ahead, so the player cuts corners
      // instead of pirouetting on each cell.
      while (node < route.length - 1 && player.position.distanceTo(route[node]) < 2.5) node++;
      const to = route[node].clone().sub(player.position).setY(0);
      if (node >= route.length - 1 && to.length() < 3) arrived = true;
      // Forward on the stick is -Z, so heading towards a point means feeding
      // the NEGATED z component. Getting that sign wrong walks the player
      // backwards out of the flat, which is what the first version of this
      // test did before deciding the doorways were shut.
      const len = Math.max(1e-4, to.length());
      player.update(
        1 / 60,
        { moveX: to.x / len, moveY: -to.z / len, jump: false, interact: false, sprint: true, interactHeld: false } as never,
        house.colliders,
        0
      );
    }
    if (arrived) walked++;
    else worstStuck = worstStuck || `${player.position.x.toFixed(0)}, ${player.position.z.toFixed(0)} m`;
  }

  ok = line(
    'a cukorkákhoz oda is lehet gyalogolni',
    walked === house.candySpots.length,
    `${walked}/${house.candySpots.length} cukorka${walked < house.candySpots.length ? `, elakadt: ${worstStuck}` : ''}`
  ) && ok;
}

// --- 16. A kameraszög és a falmagasság összhangban van ----------------------
{
  // Ez a kettő EGY döntés, és háromszor csúszott szét. Ezért a falmagasság
  // most már a szögből SZÁRMAZIK (`VillageHouse.wallHeightFor`), és itt az
  // származtatást ellenőrzöm, nem egy beírt számot:
  //
  //   · a kamera magasabban legyen, mint amilyen magasra a falat rajzoljuk,
  //     különben a fal eszi a kép alját;
  //   · a fal ÜTKÖZÉSE maradjon teljes, mert amit a kamera átlát, azon a
  //     játékos nem mehet át.
  //
  // Minden választható szögre, mert a T gomb bármelyikre válthat.
  let worst = '';
  let allFit = true;
  for (const pitch of PITCH_STEPS) {
    const camera = CAMERA.houseMinDistance * Math.sin(pitch);
    const wall = VillageHouse.wallHeightFor(pitch, CAMERA.houseMinDistance);
    const fits = camera > wall * 1.15;
    if (!fits) {
      allFit = false;
      if (!worst) worst = `${Math.round((pitch * 180) / Math.PI)}°: kamera ${camera.toFixed(1)}, fal ${wall.toFixed(1)}`;
    }
  }

  // A falmagasság HÁZANKÉNT MÁS. Korábban itt a ház1 falának beírt magassága
  // (0.45 * lépték) állt, ezért a másik két ház megbukott, pedig a faluk ép
  // volt. Most a nav fájl saját mért falmagasságát nézzük.
  const realWall = (nav.wallTop - nav.floorZ) * HOUSE1_SCALE;
  const tallestCollider = Math.max(...house.colliders.map((b) => b.max.y));
  const solid = tallestCollider > realWall * 0.9;

  ok = line(
    'a kameraszög és a falmagasság összhangban van',
    allFit && solid,
    allFit
      ? `${PITCH_STEPS.length} szög mind jó; a fal ütközése ${tallestCollider.toFixed(0)} egység (valódi ${realWall.toFixed(0)})`
      : worst
  ) && ok;
}

// --- 16b. A falon nem lehet átugrani ----------------------------------------
{
  // A ház3 falai csak 8 egységre érnek fel, a dupla ugrás teteje 12,6. Fal
  // az, aminek a teteje eléri a ház saját falmagasságát — abból egy sem
  // maradhat az ugrás alatt, különben a szobák megszűnnek szobák lenni.
  const g = -MOVE.gravity;
  const apex = (MOVE.jumpSpeed ** 2 + MOVE.doubleJumpSpeed ** 2) / (2 * g);
  const wallY = (nav.wallTop - nav.floorZ) * HOUSE1_SCALE;
  const low = house.colliders.filter((b) => b.max.y >= wallY * 0.95 && b.max.y <= apex);

  ok = line(
    'a falon nem lehet átugrani',
    low.length === 0,
    low.length === 0
      ? `ugrás teteje ${apex.toFixed(1)}, a legalacsonyabb fal ${Math.min(...house.colliders.filter((b) => b.max.y >= wallY * 0.95).map((b) => b.max.y)).toFixed(0)}`
      : `${low.length} falszakasz teteje az ugrás (${apex.toFixed(1)}) alatt van`
  ) && ok;
}

// --- 17. The sweets are a thing you can see ---------------------------------
{
  // The bucket ships as its own model and is swapped in over a placeholder, so
  // two things can go wrong quietly: the file can be missing (the placeholders
  // stay and nobody notices until someone looks), or it can be so heavy that
  // five of them cost more than the flat they sit in.
  const file = 'public/models/candy.json';
  let megabytes = 0;
  try {
    megabytes = readFileSync(file).length / 1e6;
  } catch {
    megabytes = 0;
  }

  // And it has to be worth crossing a room for: big enough to spot from the
  // far side, small enough to be a thing you pick up rather than a building.
  const player = 1.7;
  const ratio = CANDY_HEIGHT / player;

  ok = line(
    'a cukorka modell megvan és jó méretű',
    megabytes > 0.1 && megabytes < 2 && ratio > 1.2 && ratio < 3,
    `${megabytes.toFixed(2)} MB, ${CANDY_HEIGHT} egység magas — ${ratio.toFixed(1)}× a játékos`
  ) && ok;
}

// --- 18. The flat is cut into rooms, and they are rooms ---------------------
{
  // The camera shows the room you are in and nothing else, so a mistake in the
  // segmentation is a wall of black across the middle of a room, or a clear
  // view into the bathroom. Two things have to hold: there are about as many
  // rooms as a flat this size has, and every place a player can stand belongs
  // to one of them.
  const ids = house.roomIds;
  const sensible = ids.length >= 4 && ids.length <= 12;

  let labelled = 0;
  let orphan = 0;
  let worstOrphan = '';
  for (let j = 2; j < N - 2; j += 2) {
    for (let i = 2; i < N - 2; i += 2) {
      if (house.solidAt(i, j) || !reachable[j * N + i]) continue;
      labelled++;
      if (house.roomNear(house.worldX(i), house.worldZ(j)) === 0) {
        orphan++;
        if (!worstOrphan) worstOrphan = `${house.worldX(i).toFixed(0)}, ${house.worldZ(j).toFixed(0)} m`;
      }
    }
  }

  ok = line(
    'a lakás szobákra van bontva',
    sensible && orphan === 0,
    `${ids.length} szoba, ${labelled - orphan}/${labelled} állóhely tartozik valamelyikhez` +
      (orphan ? `, első árva: ${worstOrphan}` : '')
  ) && ok;
}

// --- 19. Standing in one room, you cannot see another -----------------------
{
  // The requirement, in the user's words: "wherever I am, only the room I am
  // in — I should not see the bathroom".
  //
  // Note what that does NOT say: it does not say the whole room has to fit on
  // screen at once. An earlier version of this test demanded exactly that, and
  // it is a requirement in direct conflict with being able to SEE yourself —
  // the largest room here is 43 units across, and a camera far enough back to
  // frame it shrinks a monster to four per cent of the frame. The clipping is
  // what enforces "only this room"; the framing only has to be comfortable.
  //
  // So: for every room, check that its clip box contains the room and excludes
  // every other room's middle.
  let leaks = 0;
  let worstLeak = '';
  const inside = (box: THREE.Box3, p: THREE.Vector3) =>
    p.x >= box.min.x && p.x <= box.max.x && p.z >= box.min.z && p.z <= box.max.z;

  for (const id of house.roomIds) {
    const box = house.roomBounds(id);
    if (!box) continue;
    for (const other of house.roomIds) {
      if (other === id) continue;
      const centre = house.roomBounds(other)?.getCenter(new THREE.Vector3());
      if (centre && inside(box, centre)) {
        leaks++;
        if (!worstLeak) worstLeak = `a ${id}. szobából látszana a ${other}.`;
      }
    }
  }

  // And the planes must be the box: five of them, one lid and four walls.
  const planes = house.roomClipPlanes(house.roomIds[0]);

  ok = line(
    'egy szobából nem látszik a másik',
    leaks === 0 && planes.length === 5,
    leaks ? worstLeak : `${house.roomIds.length} szoba, ${planes.length} vágósík mindegyikhez`
  ) && ok;
}

// --- 20. …and you can still see yourself ------------------------------------
{
  // A másik fele ugyanannak az alkunak. Egy szobát keretező kamera az, amelyik
  // a benne állókat nem tudja megmutatni.
  //
  // A mérce a figura KÉPERNYŐN ELFOGLALT MÉRETE, nem a magassága: felülnézetből
  // egy álló alak magassága majdnem nullára rövidül, és a régi mérce 0,05%-ot
  // mondott olyan képre, amin a szörny tisztán látszik. A köré írt gömb
  // látószöge nem függ attól, honnan nézzük.
  //
  // A küszöb 3,5%, és ez pixelben indokolható: egy 1080 soros képen ez 38
  // pixel magas figura. Egy szobánkénti, felülnézetes kamera mellett a
  // karakterek szükségszerűen kicsik — ez a nézet ára, nem hiba.
  const radius = 1.7 * 0.5;
  const angular = 2 * Math.asin(radius / CAMERA.houseMaxDistance);
  const share = angular / ((CAMERA.houseFov * Math.PI) / 180);
  ok = line(
    'a játékos felismerhető marad a képen',
    share > 0.035,
    `a képmagasság ${(share * 100).toFixed(1)}%-a — 1080 soros képen ${Math.round(share * 1080)} pixel`
  ) && ok;
}

// --- 21. A kiadott modellt a betöltő tényleg fel tudja dolgozni -------------
{
  // Ez a teszt egy valós hibából született: a lakás modelljét lecserélte valaki
  // egy kisebbre, ami `EXT_meshopt_compression` és `KHR_mesh_quantization`
  // kiterjesztést KÖVETEL, és közben saját csomópont-transzformot (0.9556-os
  // skálát) kapott. A textúra eltűnt a játékból, és a mesh ráadásul 4,4%-kal
  // elcsúszott volna az ütközésrácshoz képest — amit semmilyen rácsalapú
  // mérés nem vesz észre, mert az mind a rácsot méri, nem a fájlt.
  //
  // Két dolgot kér számon:
  //   · a fájl csak olyan kiterjesztést követeljen, amit a betöltő regisztrál,
  //   · a gyökér csomópontnak ne legyen saját transzformja, mert a VillageHouse
  //     a sajátját teszi rá, és a kettő összeszorzódik.
  const glb = Buffer.from(JSON.parse(readFileSync(`public/models/${HOUSE_NAME}.json`, 'utf8')).glb, 'base64');
  const jsonLength = glb.readUInt32LE(12);
  const gltf = JSON.parse(glb.subarray(20, 20 + jsonLength).toString()) as {
    extensionsRequired?: string[];
    nodes?: Array<{ scale?: number[]; translation?: number[]; rotation?: number[] }>;
  };

  // Amit a VillageHouse betöltője ismer.
  const SUPPORTED = new Set(['EXT_texture_webp', 'EXT_meshopt_compression', 'KHR_mesh_quantization']);
  const unsupported = (gltf.extensionsRequired ?? []).filter((e) => !SUPPORTED.has(e));

  const root = gltf.nodes?.[0] ?? {};
  const moved = Boolean(root.scale || root.translation || root.rotation);

  ok = line(
    'a ház modellje betölthető és nincs saját transzformja',
    unsupported.length === 0 && !moved,
    `${(glb.length / 1e6).toFixed(1)} MB, kiterjesztés: ${(gltf.extensionsRequired ?? []).join(', ') || 'nincs'}` +
      (moved ? ' — SAJÁT TRANSZFORM a gyökéren' : '')
  ) && ok;
}

// --- 22. A textúra-mentőöv meg is találja a képet ---------------------------
{
  // A kiadott oldalon a geometria hibátlan volt, a textúra viszont sehol: a
  // three.js a beágyazott képekre `blob:` URL-t csinál és azt LEKÉRI, amit a
  // kiadott oldal házirendje elnyel — a geometria azért marad meg, mert az
  // sosem megy URL-en keresztül. A mentőöv ugyanazokat a bájtokat dekódolja
  // közvetlenül, URL nélkül.
  //
  // A dekódoláshoz DOM kell, itt nincs; de a kockázatos rész nem a dekódolás,
  // hanem az eltolás-számítás a GLB-ben. Ez itt mérhető: a kinyert bájtoknak
  // valódi WebP-fejléccel kell kezdődniük.
  const bytes = readFileSync(`public/models/${HOUSE_NAME}.json`);
  const glb = Buffer.from(JSON.parse(bytes.toString()).glb, 'base64');
  const copy = new ArrayBuffer(glb.byteLength);
  new Uint8Array(copy).set(glb);

  const parsed = readGlb(copy);
  const textureIndex = parsed ? baseColorTextureIndex(parsed.json, 0) : null;
  const image = parsed && textureIndex !== null ? imageBytes(parsed.json, textureIndex, parsed.bin) : null;

  // "RIFF" ... "WEBP"
  const isWebp =
    image !== null &&
    image.length > 12 &&
    String.fromCharCode(image[0], image[1], image[2], image[3]) === 'RIFF' &&
    String.fromCharCode(image[8], image[9], image[10], image[11]) === 'WEBP';

  ok = line(
    'a textúra-mentőöv megtalálja a beágyazott képet',
    isWebp,
    isWebp ? `${(image!.length / 1e6).toFixed(2)} MB WebP a ${textureIndex}. textúrán` : 'nem talált érvényes képet'
  ) && ok;
}

// --- 23. A kamera felőli falat lebontjuk, a túloldalit nem ------------------
{
  // A Sims-féle falbontás: a szoba nyitva van feléd, és zárva marad mögötted.
  // Ezt a vágósíkok oldalanként eltérő állása adja, és pont ezért érdemes
  // mérni — egy elírt előjel itt vagy az egész szobát levágja, vagy egyetlen
  // falat sem bont le, és mindkettő úgy néz ki, mintha "csak rossz lenne".
  const id = house.roomIds[0];
  const box = house.roomBounds(id)!;
  const pad = house.cell * 8;

  // Kamera a +X felől: a +X oldali falnak el kell tűnnie, a -X oldalinak nem.
  const planes = house.roomClipPlanes(id, new THREE.Vector3(1, 0, 0));
  const keeps = (p: THREE.Vector3) =>
    planes.every((plane) => plane.normal.dot(p) + plane.constant > 0);

  const magas = box.max.y * 0.5;
  // Egy pont a +X oldali fal belsejében (a kamera felőli), és ugyanaz a -X-en.
  const kozeli = new THREE.Vector3(box.max.x - pad * 0.5, magas, box.getCenter(new THREE.Vector3()).z);
  const tavoli = new THREE.Vector3(box.min.x + pad * 0.5, magas, box.getCenter(new THREE.Vector3()).z);
  // És a szoba közepe, aminek MINDIG látszania kell.
  const kozep = box.getCenter(new THREE.Vector3()).setY(magas);

  ok = line(
    'a kamera felőli fal lebomlik, a túloldali marad',
    !keeps(kozeli) && keeps(tavoli) && keeps(kozep),
    `közeli fal ${keeps(kozeli) ? 'MARAD' : 'lebomlik'}, túloldali ${keeps(tavoli) ? 'marad' : 'ELTŰNIK'}, ` +
      `a szoba közepe ${keeps(kozep) ? 'látszik' : 'ELTŰNIK'}`
  ) && ok;
}


// --- A három ház SORRENDBEN jön ---------------------------------------------
{
  // A telek sorszáma nem szólhat bele: a Session a maradékból sorsolja a
  // telket, tehát ha a ház a telekhez tartozna, a második estéd kezdődhetne a
  // gyűrűs házzal — a legnehezebbel, két üldözővel.
  const order = [0, 1, 2, 3, 4].map((done) => VillageHouse.pickInOrder(done));
  const right =
    order[0] === 'house1' && order[1] === 'house2' && order[2] === 'house3' && order[3] === 'house1';
  ok = line('a házak sorrendben jönnek, nem telek szerint', right, order.join(' → ')) && ok;
}

// --- Az üldözők TÉNYLEG mennek ---------------------------------------------
{
  // Ez volt a legrosszabb hiba az estében: a lakó hatvan másodperc alatt
  // NULLA egységet tett meg mind a három házban. Két oka volt, és egyik sem
  // látszott a képernyőn kívülről:
  //
  //   1. A kezdőpontja és a járőrpontjai a JÁTÉKOS méretére készültek. A lakó
  //      2,2 egység széles, a szörny 0,9 — egy tökéletes járőrpont neki a
  //      kanapé és a fal közti rés, ahol el sem fér.
  //   2. Nem volt útkeresés. Egyenesen nekiindult a célnak, és minden
  //      ajtófélfa megállította.
  //
  // A szám a beszédes: a séta 4,4 egység/mp, hatvan másodperc alatt tehát
  // legfeljebb 264. A fele már azt jelenti, hogy tényleg járőrözik.
  const homeowner = new Homeowner(house.homeownerSpawn, house.patrolWaypoints, []);
  homeowner.walkable = (x, z, r) => house.walkable(x, z, r);
  homeowner.rescue = (f, t, r) => house.nearestStanding(f, t, r);
  homeowner.findRoute = (f, t, r) => house.route(f, t, r);
  const quiet = new NoiseSystem();
  let travelled = 0;
  let prev = homeowner.position.clone();
  for (let i = 0; i < 60 * 60; i++) {
    quiet.update(1 / 60);
    homeowner.update(1 / 60, [], quiet);
    travelled += homeowner.position.distanceTo(prev);
    prev.copy(homeowner.position);
  }
  ok = line(
    'a lakó tényleg járőrözik, nem áll egy helyben',
    travelled > 132,
    `60 mp alatt ${travelled.toFixed(0)} egység (a séta elvi maximuma 264)`
  ) && ok;
}

// --- A zaj visszhangja (sötét ház) -----------------------------------------
{
  // A zaj nem csak az üldözőket hívja: meg is MUTATJA a szobát. Ez teszi a
  // sötét pályát döntéssé — ugyanaz a futás, ami látni engedi a folyosót,
  // hozza rád a kutyát.
  const echo = new Echo();
  const noise = new NoiseSystem();
  noise.emit(new THREE.Vector3(10, 0, 10), NOISE.sprintRadius, 'teszt');
  echo.update(1 / 60, noise);
  const caught = echo.taken === 1 && echo.active === 1;

  // A visszhang HALVÁNYUL, nem villan: legyen ideje megjegyezni, de ne
  // maradjon örökre bekapcsolt lámpa.
  for (let t = 0; t < 2; t += 1 / 60) { noise.update(1 / 60); echo.update(1 / 60, noise); }
  const stillOn = echo.active === 1;
  for (let t = 0; t < 2.2; t += 1 / 60) { noise.update(1 / 60); echo.update(1 / 60, noise); }
  const gone = echo.active === 0;

  ok = line(
    'a zaj felfedi a szobát, aztán elhalványul',
    caught && stillOn && gone,
    caught ? `2 mp-nél még ég: ${stillOn}, 4 mp-nél már nem: ${gone}` : 'a friss zajt nem vette fel'
  ) && ok;

  // Egy zajos pillanat nem foglalhat le tetszőleges sok fényt.
  const flood = new Echo();
  const loud = new NoiseSystem();
  for (let i = 0; i < 40; i++) loud.emit(new THREE.Vector3(i, 0, 0), 12, 'teszt');
  flood.update(1 / 60, loud);
  ok = line('a visszhangok száma korlátos', flood.active <= 12,
    `40 egyidejű zajból ${flood.active} fény ég`) && ok;
}

// --- A minitérkép -----------------------------------------------------------
{
  // A térkép az ALAPRAJZOT mutatja, az ÜLDÖZŐKET viszont csak akkor, ha
  // tudsz róluk. Egy térkép, amin a lakó mindig ott van egy pöttyként,
  // megszüntetné a lopakodást: onnantól nem figyelni kellene, hanem a sarkot
  // nézni.
  //
  // A szabály ugyanaz, mint a jelenetben: 22 egységen belül a falon át is
  // megérzed, azon túl csak ha ellátsz odáig.
  const knows = (a: THREE.Vector3, b: THREE.Vector3): boolean => {
    const d = a.distanceTo(b);
    if (d < 22) return true;
    return !house.sightBlocked(a, b);
  };

  const me = house.spawns[0];
  // Egy pont a lakás túlvégén: onnan nem láthatsz oda.
  const far = house.patrolWaypoints.reduce((x, y) =>
    y.distanceTo(me) > x.distanceTo(me) ? y : x
  );
  const near = me.clone().add(new THREE.Vector3(6, 0, 0));

  ok = line(
    'a minitérkép nem árulja el a lakót a lakás túlvégéről',
    !knows(me, far),
    `a legtávolabbi járőrpont ${me.distanceTo(far).toFixed(0)} egységre: ${knows(me, far) ? 'látszik' : 'nem látszik'}`
  ) && ok;

  ok = line(
    'de a közvetlen közelében igen',
    knows(me, near),
    `${me.distanceTo(near).toFixed(0)} egységre: ${knows(me, near) ? 'látszik' : 'nem látszik'}`
  ) && ok;
}

// --- A helyettesítő testek mérete -------------------------------------------
{
  // A modellek hálózatról jönnek, tehát az első másodpercekben a TOK látszik
  // — és ha a lakó modellje nem tölt be, egész végig. Ezért a toknak
  // ugyanakkorának kell lennie, mint annak, amit helyettesít.
  //
  // Ez konkrétan elromlott: a kapszula hossza `magasság − 6,8` volt, egy
  // régebbi, magasabb lakóhoz írva. A mostani 6,4-gyel a hossz −0,4 lett,
  // vagyis a tok egy 6,8 egység átmérőjű gömb lett egy 6,4 magas, 2,2 széles
  // ember helyett. Közelről ez betölti az egész képernyőt.
  // CSAK A TESTET mérjük, nem az egész csoportot: a lakóhoz hozzá van
  // akasztva a tizennégy egység hosszú zseblámpakúp is, és azzal a befoglaló
  // 15×15 lenne. (Ez a teszt első változatában tévedés volt, nem hiba.)
  const bodyOf = (o: THREE.Object3D): THREE.Vector3 =>
    new THREE.Box3().setFromObject(o.children[0]).getSize(new THREE.Vector3());

  const owner = new Homeowner(new THREE.Vector3(), [], []);
  const ownerSize = bodyOf(owner.group);

  const dog = new Dog(new THREE.Vector3());
  const dogSize = bodyOf(dog.group);

  // A MAGASSÁG és a SZÉLESSÉG számít, a hossz nem: egy négylábú
  // szükségszerűen hosszabb, mint amilyen széles, és a `max(x, z)` ezt
  // szélességnek olvasta. (A teszt hibája volt, nem a toké.)
  const fits = (size: THREE.Vector3, h: number, w: number): boolean =>
    Math.abs(size.y - h) < h * 0.2 && Math.abs(size.x - w) < w * 0.3;

  ok = line(
    'a lakó tokja akkora, mint a lakó',
    fits(ownerSize, HOMEOWNER.height, HOMEOWNER.width),
    `tok ${ownerSize.x.toFixed(1)} × ${ownerSize.y.toFixed(1)} × ${ownerSize.z.toFixed(1)}, a lakó ${HOMEOWNER.width} × ${HOMEOWNER.height}`
  ) && ok;

  ok = line(
    'a kutya tokja négylábú arányú',
    dogSize.z > dogSize.x * 1.8,
    `${dogSize.z.toFixed(1)} hosszú, ${dogSize.x.toFixed(1)} széles`
  ) && ok;

  ok = line(
    'a kutya tokja akkora, mint a kutya',
    fits(dogSize, DOG.height, DOG.width),
    `tok ${dogSize.x.toFixed(1)} × ${dogSize.y.toFixed(1)} × ${dogSize.z.toFixed(1)}, a kutya ${DOG.width.toFixed(1)} × ${DOG.height.toFixed(1)}`
  ) && ok;
}

// --- A fénykúpnak nincs körvonala -------------------------------------------
{
  // A körvonal egy KIFORDÍTOTT, TÖMÖR héj a test köré. A lakó zseblámpakúpja
  // viszont nem test, hanem fény: húsz egység széles, áttetsző, összeadó
  // keveréssel rajzolt mesh. Körvonalat kapva egy szobánál is nagyobb
  // SÁPADT TÖMB lett belőle — ez volt a játékban a „nagy fehér", és
  // hetekig nem derült ki, mert a méretét semmi nem nézte.
  const owner = new Homeowner(new THREE.Vector3(), [], []);
  addOutlines(owner.group, 0.9);

  let biggestOutline = 0;
  let outlined = 0;
  owner.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.userData['cp-outline']) return;
    outlined++;
    const size = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
    biggestOutline = Math.max(biggestOutline, Math.max(size.x, size.y, size.z));
  });

  ok = line(
    'a körvonal nem nagyobb magánál a lakónál',
    biggestOutline < HOMEOWNER.height * 1.6,
    `${outlined} körvonalazott darab, a legnagyobb ${biggestOutline.toFixed(1)} egység (a lakó ${HOMEOWNER.height})`
  ) && ok;
}

// --- A falhoz szorítás feloldása --------------------------------------------
{
  // Ez a legrosszabb fajta hiba: nem nehéz helyzet, hanem BEFAGYOTT JÁTÉK.
  // Falhoz szorítva a lökés visszatol a falba, az üldöző egy lépésre van, és
  // a következő pillanatban újra elkap — a játékos nem tud mit tenni.
  //
  // Az elkapás ÁRA már megvolt (a cukorka); a folytatásnak esélyt kell adnia.
  // Ezért az üldöző az elkapás után ELHÁTRÁL.
  const owner = new Homeowner(house.homeownerSpawn.clone(), house.patrolWaypoints, []);
  owner.walkable = (x, z, r) => house.walkable(x, z, r);
  const victim = { position: owner.position.clone(), index: 0 } as unknown as never;
  const quiet = new NoiseSystem();

  owner.playCatch();
  // A TÁVOLSÁG nem elég garancia: sarokban a hátrálás nem tud elmozdulni,
  // épp abban a helyzetben, amiért kitaláltuk. Amit garantálni kell, az az,
  // hogy ezalatt NE KAPJON EL újra — akkor sem, ha egymáson állnak.
  let stillHolding = false;
  for (let t = 0; t < 2; t += 1 / 60) {
    owner.update(1 / 60, [victim], quiet);
    if (t > 0.1 && owner.recovering === false) stillHolding = true;
  }
  ok = line(
    'elkapás után a lakó nem kap el azonnal újra',
    !stillHolding,
    `a lábadozás ${stillHolding ? 'túl korán ért véget' : 'végig kitartott két másodpercen át'}`
  ) && ok;

  const dog = new Dog(new THREE.Vector3(0, 0, 0));
  const prey = new THREE.Vector3(0, 0, 0);
  dog.found(new NoiseSystem());
  for (let t = 0; t < 2; t += 1 / 60) dog.update(1 / 60, new NoiseSystem(), [prey]);
  ok = line(
    'megtalálás után a kutya is elhátrál',
    dog.position.distanceTo(prey) > 3,
    `${dog.position.distanceTo(prey).toFixed(1)} egységre hátrált`
  ) && ok;
}

// --- A MEGRAJZOLT ALAPRAJZ ---------------------------------------------------
//
// A rajz képpontokból jön, a ház viszont modellből — a kettő egyeztetése az,
// ami elromolhat, és némán: egy fél méterrel odébb tett cukorka a fal MÁSIK
// oldalán terem, és a játékos csak annyit lát, hogy „ott van, de nem tudom
// felvenni". Ezért nem azt nézzük, hogy a rajz szép-e, hanem hogy minden
// pontja ODAÉR, ahova szántuk.
{
  const plan = planFor(HOUSE_NAME);
  if (!plan) {
    console.log(`(${HOUSE_NAME}: nincs megrajzolt alaprajz — sorsolás dönt)`);
  } else {
    const b = house.bounds;
    const hova = (pt: { u: number; v: number }): THREE.Vector3 => {
      const raw = planToWorld(pt, b);
      return house.nearestStanding(raw, raw, MOVE.radius);
    };

    // 1. MINDEN PONT ÁLLHATÓ HELYRE KERÜL, és nem ugrik messzire.
    //
    // A „nem ugrik messzire" a lényeg: a pont MINDIG találni fog valami
    // járható helyet, akár a ház túlsó végében is. Ha tíz méterrel odébb
    // került, akkor a rajz azon a helyen rossz — a próba zöld lenne, a
    // cukorka meg a szomszéd szobában.
    const minden = [...plan.corners, ...plan.candy, ...plan.weapons];
    const ugras = minden.map((pt) => hova(pt).distanceTo(planToWorld(pt, b)));
    const legnagyobb = Math.max(...ugras);
    ok = line('a rajz minden pontja a padlóra esik', legnagyobb < 4,
      `a legnagyobb igazítás ${legnagyobb.toFixed(1)} egység`) && ok;

    // 2. A KÉT SAROK TÁVOL van egymástól. Két egymás melletti sarokkal az
    // egész cipelés elvész: felveszed, két lépés, letetted.
    const [narancs, lila] = plan.corners.map(hova);
    const tav = narancs.distanceTo(lila);
    ok = line('a két gyűjtősarok átlósan áll', tav > span * 0.5,
      `${tav.toFixed(0)} egység (a lakás ${span.toFixed(0)})`) && ok;

    // 3. CUKORKA NEM TEREM A SARKOKBAN. Egy sarokban termő cukorka ingyen
    // pont annak, aki épp hazaért.
    const sarokban = plan.candy
      .map(hova)
      .filter((c) => c.distanceTo(narancs) < CAPTURE.bankRadius * 2 || c.distanceTo(lila) < CAPTURE.bankRadius * 2);
    ok = line('cukorka nem terem a gyűjtősarokban', sarokban.length === 0,
      `${sarokban.length} ilyen`) && ok;

    // 4. FEGYVER SEM.
    const fegyverSarokban = plan.weapons
      .map(hova)
      .filter((w) => w.distanceTo(narancs) < CAPTURE.bankRadius * 2 || w.distanceTo(lila) < CAPTURE.bankRadius * 2);
    ok = line('fegyver sem terem a sarokban', fegyverSarokban.length === 0,
      `${fegyverSarokban.length} ilyen`) && ok;

    // 5. MINDKÉT TÉRFÉLEN VAN CUKORKA. A szabály szerint a MÁSIK oldaláról
    // kell hozni: ha az egyik felén nincs, az egyik játékosnak nincs mit
    // gyűjtenie, és a kör eldőlt, mielőtt elkezdődött.
    const narancsE = plan.candy.filter((c) => c.owner === 0).length;
    const lilaE = plan.candy.filter((c) => c.owner === 1).length;
    ok = line('mindkét játékosnak van mit gyűjtenie', narancsE > 0 && lilaE > 0,
      `${narancsE} narancssárga, ${lilaE} lila cukorka`) && ok;
    // ...és NAGYJÁBÓL ugyanannyi. Ha az egyik ötöt gyűjt, a másik hármat,
    // a kör azelőtt eldőlt, hogy elkezdődött volna.
    ok = line('...és nagyjából ugyanannyi', Math.abs(narancsE - lilaE) <= 1,
      `${narancsE} — ${lilaE}`) && ok;
    // A CUKORKA A MÁSIK TÉRFELÉN van: ezért kell átmenni, és ezért
    // találkoztok. Ha a sajátod a saját sarkod mellett teremne, sosem
    // látnátok egymást.
    const sajatOldalon = plan.candy.filter((c) => {
      const pos = hova(c);
      const kozelebbiSarok = pos.distanceTo(narancs) <= pos.distanceTo(lila) ? 0 : 1;
      return c.owner === kozelebbiSarok;
    }).length;
    ok = line('a cukorkádért a MÁSIK oldalra kell menned', sajatOldalon === 0,
      `${sajatOldalon} terem a saját sarkod oldalán`) && ok;

    // 6. A LAKÓ NEM INDUL A SARKOKBÓL. A járőrpontok közül a legtávolabbira
    // kerül — de ha MINDEGYIK közel volna valamelyik sarokhoz, az itt derül
    // ki, nem a játékban.
    const jaror = house.patrolWaypoints;
    const legjobb = Math.max(
      ...jaror.map((p) => Math.min(p.distanceTo(narancs), p.distanceTo(lila)))
    );
    ok = line('a lakó indulhat a sarkoktól távol', legjobb > CAPTURE.bankRadius * 4,
      `a legjobb járőrpont ${legjobb.toFixed(0)} egységre a közelebbi saroktól`) && ok;

    // 7. A FEGYVEREK SZÉTSZÓRVA. Két fegyver egy kupacban fél felvétel.
    let legkozelebb = Infinity;
    const fegyverek = plan.weapons.map(hova);
    for (let i = 0; i < fegyverek.length; i++) {
      for (let j = i + 1; j < fegyverek.length; j++) {
        legkozelebb = Math.min(legkozelebb, fegyverek[i].distanceTo(fegyverek[j]));
      }
    }
    ok = line('a fegyverek nem egy kupacban vannak', legkozelebb > 6,
      `a két legközelebbi ${legkozelebb.toFixed(0)} egységre`) && ok;
  }
}

console.log('');
console.log(ok ? 'MIND OK — az első ház játszható' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
