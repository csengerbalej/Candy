import * as THREE from 'three';
import { readFileSync, existsSync } from 'node:fs';
import { Car } from '../src/vehicle/Car';
import { CritterTraffic } from '../src/ai/CritterTraffic';
import { ParkingSpot } from '../src/world/ParkingSpot';
import { Dome } from '../src/world/Dome';
import { ShelfSpider } from '../src/world/ShelfSpider';
import { DriveStage } from '../src/game/DriveStage';
import { DriveGame } from '../src/game/DriveGame';
import { SIM, CAR, STREET, NITRO } from '../src/core/config';
import type { PlayerInput } from '../src/input/InputManager';
import { stepBudget } from '../src/core/Loop';
import { Engine } from '../src/audio/Sound';
import { Anger } from '../src/game/Anger';
import { StreetCandy } from '../src/world/StreetCandy';
import { SkidMarks } from '../src/vehicle/SkidMarks';

/**
 * Headless probe for the driving feel constants. Run: npm run probe:drive
 *
 * These are the assertions that stop a "small tuning tweak" from quietly
 * turning the car into a milk float or a spinning top.
 */
const input = (moveX: number, moveY: number): PlayerInput => ({
  moveX,
  moveY,
  jump: false,
  jumpHeld: false,
  sprint: false,
  interact: false,
  interactHeld: false,
  usingGamepad: false,
  nitro: false,
});

function run(seconds: number, inp: PlayerInput, car: Car): void {
  for (let i = 0; i < Math.round(seconds / SIM.step); i++) car.update(SIM.step, inp, []);
}

function line(label: string, pass: boolean, detail: string): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(40)} ${detail}`);
  return pass;
}

let ok = true;

{
  // A sáv a VÉGSEBESSÉGHEZ igazodik, nem beírt km/h-hoz.
  //
  // Kétszer kellett átírni ezt a tesztet, mert kétszer volt fix szám benne:
  // először egy 28 méteres greybox utcához hangolt 0-77, aztán a szűk falu
  // 0-40-e. Most a végsebességhez képest mérünk — egy autó, ami egy
  // másodperc alatt a végsebessége negyedét-felét hozza, arcade tempójú;
  // ennél kevesebb tutaj, ennél több rakéta.
  const car = new Car(new THREE.Vector3());
  run(1, input(0, 1), car);
  const kmh = car.speed * 3.6;
  const share = car.speed / CAR.maxSpeed;
  ok = line('1 másodperc alatti gyorsulás', share > 0.25 && share < 0.55,
    `${kmh.toFixed(0)} km/h — a végsebesség ${(share * 100).toFixed(0)}%-a`) && ok;
}

{
  const car = new Car(new THREE.Vector3());
  run(12, input(0, 1), car);
  ok =
    line('végsebesség eléri a névlegeset', car.speed > CAR.maxSpeed * 0.75,
      `${(car.speed * 3.6).toFixed(0)} km/h (max ${(CAR.maxSpeed * 3.6).toFixed(0)})`) && ok;
}

{
  // A car that can rotate while parked reads as a turret, not a vehicle.
  const car = new Car(new THREE.Vector3());
  run(1.5, input(1, 0), car);
  ok = line('álló helyzetben nem pörög', Math.abs(car.heading) < 0.02, `elfordulás ${car.heading.toFixed(3)} rad`) && ok;
}

{
  // Braking must be measured up to the moment of stopping. Running a fixed
  // duration and asserting "speed is low" passes happily at -16 m/s, i.e. the
  // car in full reverse — a green test for the wrong reason.
  const car = new Car(new THREE.Vector3());
  run(2, input(0, 1), car);
  const fast = car.speed;
  const startZ = car.position.z;

  let t = 0;
  const brake = input(0, -1);
  while (car.speed > 0 && t < 4) {
    car.update(SIM.step, brake, []);
    t += SIM.step;
  }
  const distance = Math.abs(car.position.z - startZ);
  ok =
    line('fékút teljes gázból', t < 0.9 && distance < 8,
      `${fast.toFixed(1)} m/s → állj ${t.toFixed(2)}s / ${distance.toFixed(1)}m alatt`) && ok;
}

{
  // Frame rate must not change the outcome: same sim time, different step count.
  const a = new Car(new THREE.Vector3());
  for (let i = 0; i < 120; i++) a.update(SIM.step, input(0, 1), []);
  const b = new Car(new THREE.Vector3());
  for (let i = 0; i < 240; i++) b.update(SIM.step / 2, input(0, 1), []);
  ok = line('a lépéshossz nem változtat az eredményen', Math.abs(a.speed - b.speed) < 1.2,
    `${a.speed.toFixed(2)} vs ${b.speed.toFixed(2)} m/s`) && ok;
}

// --- collision resolution must never teleport ------------------------------
{
  // A house-sized box, like the ones the town is full of.
  const wall = new THREE.Box3(
    new THREE.Vector3(-9, 0, 4),
    new THREE.Vector3(9, 9, 22)
  );

  let worstStep = 0;
  let ended = new THREE.Vector3();

  // Straight on from both sides, then the diagonals — the corner approach is
  // the one that used to fling the car the full width of the building, because
  // one axis resolved correctly and the other guessed the far side.
  const approaches: Array<{ from: THREE.Vector3; heading: number }> = [
    { from: new THREE.Vector3(0, 0, -12), heading: 0 },
    { from: new THREE.Vector3(0, 0, 38), heading: Math.PI },
    { from: new THREE.Vector3(-20, 0, -10), heading: Math.PI * 0.25 },
    { from: new THREE.Vector3(20, 0, -10), heading: -Math.PI * 0.25 },
    { from: new THREE.Vector3(-20, 0, 36), heading: Math.PI * 0.75 },
    { from: new THREE.Vector3(20, 0, 36), heading: -Math.PI * 0.75 },
  ];

  for (const approach of approaches) {
    const car = new Car(approach.from.clone());
    car.heading = approach.heading;
    const previous = car.position.clone();
    for (let i = 0; i < 600; i++) {
      car.update(SIM.step, input(0, 1), [wall]);
      const step = car.position.distanceTo(previous);
      if (i > 2) worstStep = Math.max(worstStep, step);
      previous.copy(car.position);
    }
    ended = car.position.clone();
  }

  // One simulation step at top speed covers maxSpeed/60 ≈ 0.32m. Anything an
  // order of magnitude beyond that is the resolver inventing a position —
  // which is exactly how the jeep used to jump the width of a building.
  const budget = (CAR.maxSpeed / 60) * 3;
  ok =
    line('ütközés nem teleportál', worstStep < budget,
      `legnagyobb lépés ${worstStep.toFixed(2)}m (határ ${budget.toFixed(2)}m)`) && ok;

  const insideWall =
    ended.x > wall.min.x && ended.x < wall.max.x && ended.z > wall.min.z && ended.z < wall.max.z;
  ok = line('nem marad a falon belül', !insideWall, `végpont z=${ended.z.toFixed(1)}`) && ok;
}

// --- collision SHAPE -------------------------------------------------------
{
  // A wall 3 m to the car's left. Driving straight past it must not touch it:
  // the old circumscribed square was 1.81 m of half-extent for a car 0.98 m
  // wide, so the jeep "hit" things it visually cleared by a metre.
  const wall = new THREE.Box3(new THREE.Vector3(-20, 0, -50), new THREE.Vector3(-2.4, 6, 50));
  const car = new Car(new THREE.Vector3(0, 0, -30));
  let touched = false;
  for (let i = 0; i < 400; i++) {
    car.update(SIM.step, input(0, 1), [wall]);
    if (car.crashed || car.scraped) touched = true;
  }
  ok = line('nem kapaszkodik a levegőbe', !touched, `oldaltáv 2.4m, érintés: ${touched ? 'igen' : 'nincs'}`) && ok;
}

{
  // ...and steering into that same wall must still be felt. A shape that never
  // collides is not a fix. Note the sideways-only case is deliberately silent:
  // being pushed out of a wall you are not driving into is not an event.
  const wall = new THREE.Box3(new THREE.Vector3(-20, 0, -50), new THREE.Vector3(-1.4, 6, 50));
  const car = new Car(new THREE.Vector3(0, 0, -30));
  let touched = false;
  for (let i = 0; i < 200; i++) {
    car.update(SIM.step, input(1, 1), [wall]);
    if (car.crashed || car.scraped) touched = true;
  }
  ok = line('a közeli falat érzi', touched, `bekanyarodás a falba: ${touched ? 'érint' : 'átcsúszik'}`) && ok;
}

// --- glance vs impact ------------------------------------------------------
{
  // Scraping a long wall at a shallow angle. This must NOT reverse the car and
  // must NOT spin it: the complaint was ending up facing back down the street.
  const wall = new THREE.Box3(new THREE.Vector3(2, 0, -60), new THREE.Vector3(30, 6, 60));
  const car = new Car(new THREE.Vector3(0, 0, -30));
  run(2.5, input(0, 1), car);
  const before = car.speed;
  car.heading = 0.22; // ~13° into the wall

  let scrapes = 0;
  let minSpeed = Infinity;
  let worstHeading = 0;
  for (let i = 0; i < 240; i++) {
    car.update(SIM.step, input(0, 1), [wall]);
    if (car.scraped) scrapes++;
    if (car.crashed) worstHeading = 9; // a glance must never register as a crash
    minSpeed = Math.min(minSpeed, car.speed);
    worstHeading = Math.max(worstHeading, Math.abs(car.heading));
  }
  ok =
    line('súrolás csúszik, nem pattan', scrapes > 0 && minSpeed > 0 && worstHeading < 0.45,
      `${scrapes} súrolás, min ${minSpeed.toFixed(1)} m/s (előtte ${before.toFixed(1)}), max irány ${worstHeading.toFixed(2)} rad`) && ok;
}

{
  // Head-on into the same kind of wall. This one SHOULD stop the car — but the
  // rebound must stay small, and the heading must be the one the player chose.
  // Far enough back that the run-up happens in free space: accelerating THROUGH
  // the wall and then switching the collider on measures the embedded-spawn
  // path instead, which quietly reported a 0.00 rebound and passed.
  const wall = new THREE.Box3(new THREE.Vector3(-30, 0, 10), new THREE.Vector3(30, 6, 40));
  const car = new Car(new THREE.Vector3(0, 0, -60));
  run(3, input(0, 1), car);
  const before = car.speed;
  const heading = car.heading;

  let t = 0;
  let crashed = false;
  // Measure UP TO the crash, not for a fixed time: afterwards the car is
  // reversing away and any "speed is low" assertion passes for the wrong reason.
  while (!crashed && t < 4) {
    car.update(SIM.step, input(0, 1), [wall]);
    crashed = car.crashed;
    t += SIM.step;
  }
  const rebound = -car.speed;
  ok =
    line('frontális megállít, nem katapultál', crashed && rebound > 0.5 && rebound <= CAR.crashBounceMax + 0.1
      && Math.abs(car.heading - heading) < 0.01,
      `becsapódás ${before.toFixed(1)} m/s → visszalökés ${rebound.toFixed(2)} m/s`) && ok;
}

// --- collider filtering ----------------------------------------------------
{
  // A tree: a 6 m canopy box whose trunk is a fraction of it. Driving past the
  // canopy edge, a metre clear of the trunk, must be free.
  const tree = new THREE.Box3(new THREE.Vector3(-3, 0, -3), new THREE.Vector3(3, 7, 3));
  const past = new Car(new THREE.Vector3(2.2, 0, -30));
  let touched = false;
  for (let i = 0; i < 400; i++) {
    past.update(SIM.step, input(0, 1), [tree]);
    if (past.crashed || past.scraped) touched = true;
  }

  // ...and the trunk itself must still be solid.
  const into = new Car(new THREE.Vector3(0, 0, -30));
  let stopped = false;
  for (let i = 0; i < 400; i++) {
    into.update(SIM.step, input(0, 1), [tree]);
    if (into.crashed) stopped = true;
  }
  ok = line('a lombkorona nem fal, a törzs igen', !touched && stopped,
    `lomb mellett ${touched ? 'ütközik' : 'szabad'}, törzsnek ${stopped ? 'nekimegy' : 'átmegy'}`) && ok;
}

{
  // Knee-high props (bins, pumpkins) are driven over, not into.
  const pumpkin = new THREE.Box3(new THREE.Vector3(-0.6, 0, 0), new THREE.Vector3(0.6, 1.2, 1.2));
  const car = new Car(new THREE.Vector3(0, 0, -20));
  let touched = false;
  for (let i = 0; i < 300; i++) {
    car.update(SIM.step, input(0, 1), [pumpkin]);
    if (car.crashed || car.scraped) touched = true;
  }
  ok = line('tököt átgázol, nem ütközik', !touched && car.position.z > 4,
    `végpont z=${car.position.z.toFixed(1)}`) && ok;
}

// --- kerbs -----------------------------------------------------------------
{
  // Off the tarmac the car must slow down noticeably but stay driveable.
  const onRoad = new Car(new THREE.Vector3());
  run(12, input(0, 1), onRoad);

  const offRoad = new Car(new THREE.Vector3());
  offRoad.surface = () => false;
  run(12, input(0, 1), offRoad);

  ok =
    line('járdán lassabb', offRoad.speed < onRoad.speed * 0.72 && offRoad.speed > 3 && offRoad.rumble > 0.5,
      `${(onRoad.speed * 3.6).toFixed(0)} km/h úton vs ${(offRoad.speed * 3.6).toFixed(0)} km/h mellette`) && ok;
}

// --- critters --------------------------------------------------------------
{
  // The hit test is against the car's body. A monster passing 1.4 m to the
  // side of a 0.98 m-wide car is a near miss, not a fatality.
  const car = new Car(new THREE.Vector3());
  car.speed = 12;
  const beside = new THREE.Vector3(1.6, 0, 0);
  const infront = new THREE.Vector3(0, 0, 2.0);
  const behindLine = new THREE.Vector3(0, 0, 3.4); // past the nose, clear

  ok =
    line('találati sugár a karosszéria', car.clearanceTo(beside) > 0 && car.clearanceTo(infront) < STREET.critterRadius
      && car.clearanceTo(behindLine) > STREET.critterRadius,
      `oldalt ${car.clearanceTo(beside).toFixed(2)}m, orr előtt ${car.clearanceTo(infront).toFixed(2)}m, 3.4m-re ${car.clearanceTo(behindLine).toFixed(2)}m`) && ok;
}

{
  // Heading-aware: the same point that is clear of the flank is under the car
  // once it turns 90°. The old square could not tell the difference.
  const car = new Car(new THREE.Vector3());
  const point = new THREE.Vector3(2.0, 0, 0);
  const sideways = car.clearanceTo(point);
  car.heading = Math.PI / 2;
  const nose = car.clearanceTo(point);
  ok = line('az alak követi az irányt', sideways > 0.5 && nose < 0,
    `oldalt ${sideways.toFixed(2)}m → elfordulva ${nose.toFixed(2)}m`) && ok;
}

// --- can the car ever be stranded inside geometry? -------------------------
{
  // Both the car and the character refuse to resolve a contact they consider
  // "too deep" — the car undoes its step, the character skips the push-out.
  // That guard is what stops a teleport, but if anything ever puts an actor
  // deep inside a box it also means they never come out. A co-op night ends
  // there, so it is worth knowing whether the state is escapable.
  const wall = new THREE.Box3(new THREE.Vector3(-9, 0, -9), new THREE.Vector3(9, 9, 9));

  let escaped = 0;
  const starts: THREE.Vector3[] = [
    new THREE.Vector3(0, 0, 0), // dead centre, the worst case
    new THREE.Vector3(6, 0, 6),
    new THREE.Vector3(-7, 0, 2),
  ];

  for (const start of starts) {
    const car = new Car(start.clone());
    // Try every direction, as a stuck player would.
    for (let attempt = 0; attempt < 8 && wall.containsPoint(car.position); attempt++) {
      car.heading = (attempt / 8) * Math.PI * 2;
      for (let i = 0; i < 90; i++) car.update(SIM.step, input(0, attempt % 2 ? -1 : 1), [wall]);
    }
    if (!wall.containsPoint(car.position)) escaped++;
  }

  ok =
    line('beragadt autó ki tud jönni', escaped === starts.length,
      `${escaped}/${starts.length} pozícióból szabadult`) && ok;
}


// --- Getting out of the car takes both of you -------------------------------
{
  // The drive used to end the instant the jeep rolled near the kerb under six
  // metres a second — no decision, no handshake, just a cut to the interior.
  // Now it is something the pair DOES, and "both" has to mean both: one player
  // pressing the button twice must not open the door.
  const world = {
    group: new THREE.Group(),
    colliders: [] as THREE.Box3[],
    houses: [{ id: 0, name: 'TESZTHÁZ', position: new THREE.Vector3(), driveway: new THREE.Vector3() }],
    roads: [],
    carSpawn: new THREE.Vector3(),
    tileSize: 12,
    bounds: new THREE.Box2(new THREE.Vector2(-50, -50), new THREE.Vector2(50, 50)),
    onRoad: () => true,
  };

  const car = new Car(new THREE.Vector3(0, 0, 0), 0);
  const traffic = { hits: 0, nearMisses: 0, critters: [] };
  const game = new DriveGame(world as never, car, traffic as never);
  game.targetId = 0;
  game.names = ['BALINT', 'CSENGER'];

  /** An input where only the listed players are pressing USE. */
  const pressing = (...who: number[]) =>
    ({
      get: (i: number) => ({ moveX: 0, moveY: 0, jump: false, interact: who.includes(i), sprint: false }),
    }) as never;

  game.update(1 / 60, pressing());
  const parked = game.parked;
  const prompted = game.parkPrompt.length > 0;

  // Player one, alone, twice over.
  game.update(1 / 60, pressing(0));
  game.update(1 / 60, pressing(0));
  const oneNotEnough = !game.stats.arrived && game.outOfCar[0] && !game.outOfCar[1];

  // Now the other one.
  game.update(1 / 60, pressing(1));
  const bothOpensIt = game.stats.arrived;

  ok =
    line('a kiszálláshoz mindkét játékos kell', parked && prompted && oneNotEnough && bothOpensIt,
      `parkolt ${parked}, kiírja ${prompted}, egyedül nem elég ${oneNotEnough}, kettesben nyit ${bothOpensIt}`) && ok;
}


// --- A szörnyecskék: új test, RÉGI mozgás -----------------------------------
{
  // A kérés szó szerint: „ugyanaz legyen a mozgása mint ahogy most mennek".
  // Ez mérhető állítás, és pont az a fajta, ami csendben elromlik: a betöltött
  // modell máshol van origózva, mint a helyettesítő tok, és egy fél méter
  // emelés — vagy egy örökölt méretarány — észrevétlenül átírja a kacsázást,
  // a járdánál visszafordulást és az elütés ívét.
  //
  // Ezért kétszer futtatom UGYANAZT a forgalmat: egyszer tokokkal, egyszer
  // kicserélt testtel, és a két pályának cellára pontosan egyeznie kell.
  const world = {
    roads: [{ centre: new THREE.Vector3(0, 0, 0) }],
    tileSize: 20,
    // A szörnyecskék a sztrádára nem mehetnek; ebben a tokban nincs sztráda,
    // de a KÉRDÉST fel kell tudni tenni — enélkül a próba elszáll, és a
    // hibája nem a mérésről szól.
    onMotorway: () => false,
  };

  const path = (swap: boolean): number[] => {
    const traffic = new CritterTraffic(world as never);
    if (swap) {
      // Ugyanaz, amit a jelenet csinál: egy középen origózott csoport, saját
      // méretaránnyal — a modellbetöltő is ilyet ad vissza.
      traffic.setArt(() => {
        const g = new THREE.Group();
        g.scale.multiplyScalar(0.86 + 0.3);
        return g;
      });
    }
    const car = new Car(new THREE.Vector3(500, 0, 500));
    const out: number[] = [];
    for (let f = 0; f < 240; f++) {
      traffic.update(1 / 60, car, f / 60);
      for (const c of traffic.critters) {
        out.push(c.mesh.position.x, c.mesh.position.y, c.mesh.position.z, c.mesh.rotation.z);
      }
    }
    return out;
  };

  // A születés véletlen, ezért a két futásnak ugyanabból a magból kell
  // indulnia — különben nem a cserét mérném, hanem a szórást.
  const realRandom = Math.random;
  let seed = 12345;
  Math.random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  const before = path(false);
  seed = 12345;
  const after = path(true);
  Math.random = realRandom;

  const worst = before.reduce((m, v, i) => Math.max(m, Math.abs(v - after[i])), 0);
  ok = line('a test cseréje nem nyúl a mozgáshoz', worst < 1e-9,
    `${before.length} minta, legnagyobb eltérés ${worst.toExponential(1)}`) && ok;

  // És a magasság is maradjon: a tok közepe 1,34 magas volt, a modell ezt
  // örökli. Ha valaki talpra állítaná, a szörnyecskék a levegőben lebegnének.
  const source = readFileSync('src/scenes/DriveScene.ts', 'utf8');
  const centred = source.includes('onGround: false') && source.includes('CRITTER_HEIGHT');
  ok = line('a szörnyecske a tok origóját örökli', centred,
    centred ? 'onGround: false, magasság a kapszulából' : 'talpra állítva lebegne') && ok;
}


// --- A parkolóhely ott van, ahol a szabály ----------------------------------
{
  // Egy jelölés, ami nem ott van, ahol a szabály, ROSSZABB, mint a semmi:
  // megtanulod a helyét, és utána a játék cáfol. Ezért a kör sugara nem egy
  // „nagyjából ekkora" szám, hanem maga a `STREET.arriveRadius` — és ezt
  // itt le is mérem, mert két külön helyre írt konstans előbb-utóbb
  // szétcsúszik.
  const source = readFileSync('src/world/ParkingSpot.ts', 'utf8');
  const usesRule = /const r = STREET\.arriveRadius/.test(source) && !/CircleGeometry\(\s*\d/.test(source);
  ok = line('a kör sugara maga a megállási szabály', usesRule,
    usesRule ? `STREET.arriveRadius = ${STREET.arriveRadius}` : 'külön szám van a rajzban') && ok;

  // Semmi nem áll ki az úttestből. A kérés szó szerint: „az utak tiszták
  // maradjanak, arra ne helyezz semmit" — a jelölés a FÖLDÖN fekszik, nem
  // rajta áll.
  //
  // A forrásból olvasott `position.y` értékek EZT NEM MÉRIK: köztük van a
  // fényforrás magassága is, ami nem áll senkinek az útjában. A GEOMETRIA
  // burkolódoboza a helyes kérdés — azt kell megnézni, ami takar.
  const spot = new ParkingSpot();
  const box = new THREE.Box3();
  spot.group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) box.expandByObject(o);
  });
  const flat = box.max.y < 0.1;
  ok = line('a jelölés nem áll ki az úttestből', flat,
    `a geometria ${box.max.y.toFixed(2)} egység magas — a földre simul`) && ok;

  // És a jelölés SOHA nem ígér többet, mint a szabály: a téglalap legtávolabbi
  // pontja (a sarka) is a szabály sugarán belül van. Fordítva a sarkok
  // kilógnának, és megtanulnád a jelölést, amit aztán a játék cáfol.
  const corner = Math.hypot(box.max.x, box.max.z);
  ok = line(
    'a jelölés nem lóg ki a szabályból',
    corner <= STREET.arriveRadius + 0.01,
    `a téglalap sarka ${corner.toFixed(2)}, a szabály ${STREET.arriveRadius}`
  ) && ok;

  // ...és nem is sokkal kisebb: egy tenyérnyi folt egy nagy körben nem
  // jelölés, hanem célkereszt.
  const drawn = corner;
  ok = line('a rajzolt kör mérete a tűréssel egyezik',
    Math.abs(drawn - STREET.arriveRadius) < 0.01,
    `rajzolva ${drawn.toFixed(2)}, a szabály ${STREET.arriveRadius}`) && ok;

  // És a HUD is megmondja, mi a teendő, amíg a körön belül még gurulsz.
  // Enélkül ez az a pillanat, amikor a játékos nem érti, miért nem történik
  // semmi: a folt ott van alatta, de senki nem mondta, hogy meg is kell állni.
  const game = readFileSync('src/game/DriveGame.ts', 'utf8');
  const tellsToStop = game.includes('ÁLLJ MEG A NARANCSSZÍNŰ HELYEN');
  ok = line('szól, ha a körön belül még gurulsz', tellsToStop,
    tellsToStop ? 'a parkolási üzenet kimondja' : 'néma marad') && ok;
}


// --- Ugrás és drift ---------------------------------------------------------
{
  const drive = (car: Car, frames: number, inp: Partial<PlayerInput>): void => {
    const full: PlayerInput = {
      moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
      interact: false, interactHeld: false, pause: false, usingGamepad: false,
      ...inp,
    };
    for (let f = 0; f < frames; f++) {
      car.update(SIM.step, full, []);
      // Az ugrás FELFUTÓ ÉL: a szimuláció minden lépése után elfogy, különben
      // egy lenyomva tartott gomb lépésenként újra elsütné.
      full.jump = false;
    }
  };

  // --- Az ugrás tényleg felemel, és le is jön -------------------------------
  {
    const car = new Car(new THREE.Vector3());
    drive(car, 90, { moveY: 1 });
    const before = car.height;
    let peak = 0;
    const full: PlayerInput = {
      moveX: 0, moveY: 1, jump: true, jumpHeld: true, sprint: false,
      interact: false, interactHeld: false, pause: false, usingGamepad: false,
    };
    for (let f = 0; f < 120; f++) {
      car.update(SIM.step, full, []);
      full.jump = false;
      peak = Math.max(peak, car.height);
    }
    ok = line('az autó tud ugrani', before === 0 && peak > 1.0,
      `${peak.toFixed(2)} egység magasra`) && ok;
    ok = line('és vissza is ér a földre', car.height === 0,
      `${(120 / 60).toFixed(1)} másodperc múlva a talajon`) && ok;
  }

  // --- Egy gombnyomás EGY ugrás --------------------------------------------
  {
    // A zár nélkül a lenyomva tartott gomb a földetérés képkockáján azonnal
    // újra elsülne, és a kocsi pattogó labda lenne. A `jump` él, de a
    // szimuláció másodpercenként hatvanszor fut — ez a fajta hiba nem
    // látszik, csak érződik.
    const car = new Car(new THREE.Vector3());
    let launches = 0;
    let wasAir = false;
    const full: PlayerInput = {
      moveX: 0, moveY: 0, jump: true, jumpHeld: true, sprint: false,
      interact: false, interactHeld: false, pause: false, usingGamepad: false,
    };
    for (let f = 0; f < 240; f++) {
      full.jump = true; // minden lépésben megnyomva tartva
      car.update(SIM.step, full, []);
      if (car.airborne && !wasAir) launches++;
      wasAir = car.airborne;
    }
    ok = line('nyomva tartva sem pattog', launches <= 6,
      `${launches} ugrás 4 másodperc alatt, nem képkockánként`) && ok;
  }

  // --- Levegőben nincs terepbüntetés ---------------------------------------
  {
    // Egy kerítés fölött átugorva a kocsi a LEVEGŐBEN kapná meg a lassítást,
    // ha a felülettesztet nem kapcsolnánk ki — a fű, ami fölött épp repül,
    // nem tudja lefogni.
    const car = new Car(new THREE.Vector3());
    car.surface = () => false; // minden terep
    drive(car, 90, { moveY: 1 });
    const groundSpeed = car.speed;
    const flying = new Car(new THREE.Vector3());
    flying.surface = () => false;
    drive(flying, 90, { moveY: 1 });
    drive(flying, 1, { moveY: 1, jump: true });
    drive(flying, 20, { moveY: 1 });
    ok = line('levegőben nem lassít a terep', flying.speed >= groundSpeed - 0.01 || !flying.offRoad,
      `repülés közben terepen: offRoad=${flying.offRoad}`) && ok;
  }

  // --- A drift: kézifékkel oldalra csúszik, anélkül nem --------------------
  {
    const corner = (handbrake: boolean): { lateral: number; heading: number } => {
      const car = new Car(new THREE.Vector3());
      drive(car, 120, { moveY: 1 });            // felgyorsul egyenesen
      let worst = 0;
      const full: PlayerInput = {
        moveX: 1, moveY: 0.4, jump: false, jumpHeld: false, sprint: handbrake,
        interact: false, interactHeld: false, pause: false, usingGamepad: false,
      };
      for (let f = 0; f < 90; f++) {
        car.update(SIM.step, full, []);
        worst = Math.max(worst, Math.abs(car.lateral));
      }
      return { lateral: worst, heading: car.heading };
    };

    const normal = corner(false);
    const drift = corner(true);

    // 1. Kézifékkel SOKKAL nagyobb az oldalcsúszás. Ez maga a drift.
    ok = line('kézifékkel megcsúszik a farok', drift.lateral > normal.lateral * 2.5,
      `${drift.lateral.toFixed(1)} egység/s oldalra, kézifék nélkül ${normal.lateral.toFixed(1)}`) && ok;

    // 2. ...és át is fordul JOBBAN. Enélkül a kézifék csak lassítana, és a
    //    drift beindításához előbb neki kellene menni valaminek.
    ok = line('a drift élesebbre fordít', Math.abs(drift.heading) > Math.abs(normal.heading),
      `${((drift.heading * 180) / Math.PI).toFixed(0)}° vs ${((normal.heading * 180) / Math.PI).toFixed(0)}°`) && ok;

    // 3. Kézifék NÉLKÜL viszont a régi viselkedés marad: a kocsi arra megy,
    //    amerre néz. Ha ez elromlana, a sima vezetés lenne szappanos — és
    //    ezt a játékos nem „driftnek" hívná, hanem hibának.
    // A küszöb a KÉZIFÉKES értékhez képest van, nem abszolút.
    //
    // Egy gyorsabb autó kanyarban többet csúszik oldalra — ez fizika, nem
    // hiba. A 3,2-es abszolút küszöb a 68 km/h-s autóhoz volt hangolva, és a
    // 120-asnál pusztán a nagyobb sebességtől elbukott. Amit mérni akarunk,
    // az nem az, hogy „kevés az oldalcsúszás", hanem hogy a kézifékes SOKKAL
    // több: a kettő közti szakadék maga a drift.
    ok = line('kézifék nélkül nem szappanos', normal.lateral < drift.lateral * 0.5,
      `${normal.lateral.toFixed(2)} egység/s, kézifékkel ${drift.lateral.toFixed(2)}`) && ok;
  }

  // --- A drift nem gyorsítás ------------------------------------------------
  {
    // Ha a kézifékes kanyar GYORSABB lenne, mint a rendes, akkor mindenki
    // végig kézifékkel menne, és a kormány elveszítené az értelmét. A drift
    // legyen látványos, de fizessen érte.
    const run = (handbrake: boolean): number => {
      const car = new Car(new THREE.Vector3());
      drive(car, 120, { moveY: 1 });
      drive(car, 90, { moveX: 1, moveY: 1, sprint: handbrake });
      return car.position.length();
    };
    const straight = run(false);
    const slid = run(true);
    ok = line('a drift nem gyorsabb, mint a normál kanyar', slid <= straight + 0.5,
      `${slid.toFixed(1)} m vs ${straight.toFixed(1)} m ugyanannyi idő alatt`) && ok;
  }
}


// --- A befőttesüveg -----------------------------------------------------------
{
  // A falu egy üvegbura alatt van: ez akadályozza meg, hogy le lehessen esni
  // a pályáról, és egyben megmagyarázza, miért nem jut ki az édesség.
  //
  // Amit mérni kell, az két dolog, és a MÁSODIK a fontosabb:
  //   1. tényleg bent tart-e;
  //   2. lehet-e beleragadni. Egy fal, ami megállít, rosszabb, mint egy fal,
  //      ami mellett elcsúszol — a pálya szélén ragadt autó ugyanolyan
  //      elakadás, mint a sövény, amiből az imént jöttünk ki.
  const dome = new Dome(100, 55);
  const car = new Car(new THREE.Vector3());
  car.boundary = (p) => dome.clamp(p, CAR.length);

  const full: PlayerInput = {
    moveX: 0, moveY: 1, jump: false, jumpHeld: false, sprint: false,
    interact: false, interactHeld: false, pause: false, usingGamepad: false,
  };

  // Egyenesen nekihajtva: bent marad.
  let furthest = 0;
  for (let f = 0; f < 900; f++) {
    car.update(SIM.step, full, []);
    furthest = Math.max(furthest, Math.hypot(car.position.x, car.position.z));
  }
  ok = line('az üvegen nem lehet kimenni', furthest <= 100 - CAR.length + 0.01,
    `a legtávolabbi pont ${furthest.toFixed(1)} egység, a fal ${(100 - CAR.length).toFixed(1)}`) && ok;

  // ...és nem ragad oda: kormányozva elindul a fal mentén.
  const before = Math.atan2(car.position.z, car.position.x);
  const turning: PlayerInput = { ...full, moveX: 1 };
  for (let f = 0; f < 240; f++) car.update(SIM.step, turning, []);
  const after = Math.atan2(car.position.z, car.position.x);
  let swept = Math.abs(after - before);
  if (swept > Math.PI) swept = Math.PI * 2 - swept;
  ok = line('a fal mellett el lehet csúszni', swept > 0.15,
    `${((swept * 180) / Math.PI).toFixed(0)} fokot haladt a fal mentén`) && ok;

  // És a sugár a TÉRKÉPHEZ igazodik, nem beírt szám — különben egy másik
  // méretű falunál az üveg vagy elvágná a sarkokat, vagy a semmiben lógna.
  const scene = readFileSync('src/scenes/DriveScene.ts', 'utf8');
  const measured = scene.includes('world.bounds.getSize') && scene.includes('new Dome(reach');
  ok = line('az üveg mérete a faluból jön', measured,
    measured ? 'a befoglalóból számolva' : 'beírt sugár') && ok;

  // És a BEÍRT körből, nem a körülírtból.
  //
  // A leghosszabb oldalból számolva az üveg a térkép szélén kívülre kerül, és
  // a kocsi a pálya pereme és az üveg között a SEMMIBE hajt — a felhasználó
  // pontosan ezt látta: fekete üresség, fölötte az üveg rézpereme. A rövidebb
  // oldal fele az a legnagyobb kör, ami még biztosan a burkolaton belül van.
  const inscribed = /Math\.min\(size\.x, size\.y\) \* 0\.5/.test(scene);
  ok = line('az üveg a burkolaton belül van', inscribed,
    inscribed ? 'a rövidebb oldal feléből' : 'a hosszabb oldalból — kilóg a pályáról') && ok;
}


// --- A pók a polcon, és a kamera, amivel látni lehet -------------------------
{
  // A pók az üveg KÜLSŐ oldalán mászik. Két dolog számít, és mindkettő
  // mérhető:
  //
  //   1. soha ne lógjon BE a faluba. Ha egy egyenes vonal mentén menne a
  //      gömb egyik pontjából a másikba, átvágna az üvegen, és a trükk —
  //      „ez egy üveg egy polcon" — egy pillanat alatt szétesne.
  //   2. mozogjon. Egy díszletnek odarakott pók nem fenyegetés.
  const R = 100;
  const H = 55;
  const spider = new ShelfSpider(R, H, 34);

  let closest = Infinity;
  let travelled = 0;
  const start = spider.group.position.clone();
  let previous = start.clone();
  let lowest = Infinity;
  for (let f = 0; f < 60 * 120; f++) {
    spider.update(1 / 60);
    const p = spider.group.position;
    // Mennyire van az ellipszoid felületén kívül? 1-nél kisebb = belül.
    const ratio = Math.hypot(p.x / R, p.y / H, p.z / R);
    closest = Math.min(closest, ratio);
    lowest = Math.min(lowest, p.y);
    travelled += p.distanceTo(previous);
    previous = p.clone();
  }

  ok = line('a pók sosem lóg be az üveg alá', closest >= 1,
    `a legbelső pontja az üvegtől ${((closest - 1) * 100).toFixed(1)}%-nyira KÍVÜL volt`) && ok;
  ok = line('a pók mászkál, nem díszlet', travelled > R,
    `${travelled.toFixed(0)} egységet tett meg két perc alatt`) && ok;

  // ARRA NÉZ, AMERRE MEGY.
  //
  // Sokáig csak a felület normálisához igazítottam: a pók lapult az üveghez,
  // de tetszőleges irányba nézett. A felhasználó szava: „a pók háttal megy".
  // A modell eleje a -Z (ezt a rig mérése mondja meg), tehát a csoport
  // elforgatásával kiszámolható, merre néz — és ezt kell a valódi
  // elmozdulással összevetni.
  //
  // A LEGROSSZABB pillanatot mérni itt hibás lenne, és ezt is megmértem: a
  // pók irányt vált, és váltás közben egy-két másodpercig tényleg nem arra
  // néz, amerre indul — ez maga a kanyarodás. A hiba, amit fogni kell, a
  // TARTÓS félrenézés volt: 180 fok, minden mintán. Ezért a minták zömét
  // nézzük, nem a szélsőséget.
  const angles: number[] = [];
  let last = spider.group.position.clone();
  for (let f = 0; f < 60 * 40; f++) {
    spider.update(1 / 60);
    const now = spider.group.position;
    const moved = new THREE.Vector3().subVectors(now, last);
    last = now.clone();
    if (moved.lengthSq() < 1e-8) continue;
    if (f < 120) continue;
    const facing = new THREE.Vector3(0, 0, -1).applyQuaternion(spider.group.quaternion);
    angles.push(facing.angleTo(moved.normalize()));
  }
  angles.sort((a, b) => a - b);
  const median = angles[Math.floor(angles.length / 2)] ?? Math.PI;
  const good = angles.filter((a) => a < Math.PI / 4).length / Math.max(1, angles.length);
  ok = line('a pók arra néz, amerre megy', median < 0.35 && good > 0.8,
    `a minták ${(good * 100).toFixed(0)}%-a 45 fokon belül, közép ${((median * 180) / Math.PI).toFixed(0)} fok`) && ok;

  // És a modell a TALPÁN áll az üvegen, nem a közepével benne.
  const driveSource = readFileSync('src/scenes/DriveScene.ts', 'utf8');
  const onItsFeet = /models\.instance\('models\/spider\.json', \{ length: [^}]*\}\)/.test(driveSource) &&
    !/spider\.json[^)]*onGround: false/.test(driveSource);
  ok = line('a pók a talpán ül az üvegen', onItsFeet,
    onItsFeet ? 'az origó a lábánál van, a test kifelé nő' : 'középre origózva — fele belelóg') && ok;
  ok = line('a pók nem megy a polc alá', lowest > 0,
    `a legalacsonyabb pontja ${lowest.toFixed(1)} egység`) && ok;

  // A RIG: a nyolc lábat offline mértük meg (tools/spider-rig.py), mert a
  // Meshy automatikus rigje általános neveket ad, és névről nem lehet
  // felismerni őket. Ha a sütés átnevez vagy eldob egy csontot, a járás
  // csendben elmarad — a pók a kötési pózban csúszna a gömbön.
  const rig = JSON.parse(readFileSync('public/models/spider-rig.json', 'utf8')) as {
    legs: Array<{ bones: string[]; side: string }>;
  };
  const left = rig.legs.filter((l) => l.side === 'left').length;
  ok = line('a pók nyolc lába megvan, négy-négy oldalt',
    rig.legs.length === 8 && left === 4,
    `${rig.legs.length} láb, ebből ${left} bal, ízenként ${rig.legs[0]?.bones.length}`) && ok;

  // AZ ELEJE a mesh tömegeloszlásából jön, nem a csontokból.
  //
  // A lábak tövéből kétszer is félremértem, és a felhasználó kétszer mondta,
  // hogy a pók hátrafelé megy. A lábak nagyjából szimmetrikusan ülnek —
  // amit „elsőnek" néztem, az lehetett a hátsó pár is. A POTROH viszont
  // egyértelmű: az a nagyobb vég, és az hátul van.
  //
  // (A mérés maga is elromlott egyszer: a Meshy rigelője egy 42 csúcsú
  // Icosphere-t is belerak a fájlba, és azt mértem a 14 492 csúcsú pók
  // helyett. Egy gömb tömegeloszlása szimmetrikus, tehát a válasz véletlen
  // volt.)
  const rigSource = readFileSync('tools/spider-rig.py', 'utf8');
  const fromMass =
    /mesh_obj = max\(/.test(rigSource) && /front_mass > rear_mass/.test(rigSource);
  ok = line('a pók eleje a testből van mérve, nem a lábakból', fromMass,
    fromMass ? 'a legtöbb csúcsú mesh tömegeloszlásából' : 'csontokból — kétszer félrement') && ok;

  // ...és a megsütött modellben MIND megvan, ugyanazon a néven.
  const { glb } = JSON.parse(readFileSync('public/models/spider.json', 'utf8')) as { glb: string };
  const bytes = Buffer.from(glb, 'base64');
  const jsonLength = bytes.readUInt32LE(12);
  const model = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString()) as {
    nodes: Array<{ name?: string }>;
  };
  const names = new Set(model.nodes.map((n) => n.name));
  const missing = rig.legs.flatMap((l) => l.bones).filter((n) => !names.has(n));
  ok = line('a sütés nem vesztett el lábcsontot', missing.length === 0,
    missing.length ? `hiányzik: ${missing.join(', ')}` : '40 lábcsont mind a modellben') && ok;
}

// --- Vezetés közben körül lehet nézni ----------------------------------------
{
  // A pók azért van, hogy lássák. Egy merev, autó mögé szögezett kamera
  // mellett viszont csak akkor látszana, ha a játékos épp arra vezet — a
  // játék legfontosabb hangulati eleme attól függne, merre kanyarodik.
  const stage = new DriveStage();
  const car = new Car(new THREE.Vector3());
  const pane = { x: 0, y: 0, w: 1600, h: 900, cssTop: 0 };

  const settle = (frames: number) => {
    for (let f = 0; f < frames; f++) stage.update(1 / 60, car, pane as never, []);
  };
  settle(120);
  const behind = stage.camera.position.clone();

  // Állva körbe lehet fordulni, és OTT IS MARAD.
  for (let f = 0; f < 90; f++) {
    stage.look(1, 0, 1 / 60);
    stage.update(1 / 60, car, pane as never, []);
  }
  settle(120);
  const turned = stage.camera.position.clone();
  const swung = behind.distanceTo(turned);
  ok = line('állva körül lehet nézni és ott marad', swung > 8,
    `a kamera ${swung.toFixed(1)} egységet fordult, és nem állt vissza`) && ok;

  // Haladva viszont visszahúz az autó mögé: vezetés közben nem nézhetsz
  // hátra büntetlenül.
  const moving: PlayerInput = {
    moveX: 0, moveY: 1, jump: false, jumpHeld: false, sprint: false,
    interact: false, interactHeld: false, pause: false, usingGamepad: false,
  };
  for (let f = 0; f < 60 * 4; f++) {
    car.update(SIM.step, moving, []);
    stage.update(1 / 60, car, pane as never, []);
  }
  const wantBehind = car.position.clone().addScaledVector(car.forward, -11);
  const offset = Math.hypot(
    stage.camera.position.x - wantBehind.x,
    stage.camera.position.z - wantBehind.z
  );
  ok = line('haladva visszaáll az autó mögé', offset < 14,
    `${offset.toFixed(1)} egységre az autó mögötti helytől`) && ok;
}


// --- A szörnyecskék kiugranak ------------------------------------------------
{
  // Eddig mind a tizenhat ugyanazt csinálta: állandó sebességgel ingázott a
  // saját utcájában. Ettől a forgalom kiszámítható volt — pár perc után a
  // játékos ránézésre tudta, hol lesznek, és a szakasz legveszélyesebb eleme
  // díszletté vált.
  //
  // Amit mérni kell, az nem az, hogy „több mozgás van", hanem hogy a kiugrás
  // KÖVETKEZMÉNYE helyes: akkor jöjjön, amikor az autó közel van, és akkor
  // se legyen elkerülhetetlen.
  const world = { roads: [{ centre: new THREE.Vector3(0, 0, 0) }], tileSize: 20, onMotorway: () => false };
  const traffic = new CritterTraffic(world as never);
  const car = new Car(new THREE.Vector3(0, 0, -60));

  const forward: PlayerInput = {
    moveX: 0, moveY: 1, jump: false, jumpHeld: false, sprint: false,
    interact: false, interactHeld: false, pause: false, usingGamepad: false,
  };

  let dashes = 0;
  let dashedFar = 0;
  for (let f = 0; f < 60 * 30; f++) {
    car.update(SIM.step, forward, []);
    const before = traffic.critters.map((c) => (c as unknown as { mood: string }).mood);
    traffic.update(SIM.step, car, f / 60);
    traffic.critters.forEach((c, i) => {
      const mood = (c as unknown as { mood: string }).mood;
      if (mood !== 'dash' || before[i] === 'dash') return;
      dashes++;
      if (c.position.distanceTo(car.position) > STREET.critterDashRange + 1) dashedFar++;
    });
    if (car.position.z > 60) { car.position.z = -60; car.speed = CAR.maxSpeed * 0.7; }
  }

  ok = line('a szörnyecskék kiugranak az autó elé', dashes > 0,
    `${dashes} kiugrás fél perc alatt`) && ok;
  ok = line('csak közelről ugranak ki', dashedFar === 0,
    `${dashedFar} kiugrás a döntési távolságon (${STREET.critterDashRange} m) kívül`) && ok;

  // ...és a döntési távolság elég a FÉKÚTHOZ. Ez az, ami a kiugrást
  // kihívássá teszi és nem igazságtalansággá: teljes sebességről is meg
  // lehet állni, de csak ha azonnal lépsz.
  const braking = new Car(new THREE.Vector3());
  const gas: PlayerInput = { ...forward };
  for (let f = 0; f < 60 * 6; f++) braking.update(SIM.step, gas, []);
  const from = braking.position.z;
  const brake: PlayerInput = { ...forward, moveY: -1 };
  let stopped = 0;
  for (let f = 0; f < 60 * 6 && braking.speed > 0.2; f++) {
    braking.update(SIM.step, brake, []);
    stopped = braking.position.z - from;
  }
  ok = line('a fékút belefér a döntési távolságba', stopped < STREET.critterDashRange,
    `${stopped.toFixed(1)} m fékút, a kiugrás ${STREET.critterDashRange} m-ről jön`) && ok;
}


// --- A duda ------------------------------------------------------------------
{
  // A duda nem hangeffekt, hanem ESZKÖZ: aki hallja, iszkol. Ettől lesz a
  // gomb játékmenet és nem díszlet — de a hatótávnak korlátosnak kell
  // lennie, különben egy nyomásra az egész utca szétugrik, és a
  // szörnyecskék veszélye megszűnik. Épp az az egy dolog, ami vezetés közben
  // valódi döntést kér.
  const world = { roads: [{ centre: new THREE.Vector3(0, 0, 0) }], tileSize: 20, onMotorway: () => false };
  const traffic = new CritterTraffic(world as never);

  // Mindegyiket ismert távolságra tesszük a kürt helyétől.
  traffic.critters.forEach((c, i) => {
    c.position.set(0, 0, (i + 1) * 6);
    (c as unknown as { mood: string }).mood = 'wander';
  });

  traffic.scatter(new THREE.Vector3(), STREET.hornRange);

  const scared = traffic.critters.filter(
    (c) => (c as unknown as { mood: string }).mood === 'dash'
  );
  const far = traffic.critters.filter(
    (c) => c.position.length() > STREET.hornRange &&
      (c as unknown as { mood: string }).mood === 'dash'
  );

  ok = line('a dudától a közeliek iszkolnak', scared.length > 0,
    `${scared.length} szörnyecske ugrott szét ${STREET.hornRange} méteren belül`) && ok;
  ok = line('a távoliakat nem zavarja', far.length === 0,
    `${far.length} reagált a hatótávon kívülről`) && ok;

  // És a hatótáv NAGYOBB, mint a kiugrásé: a dudának megelőzőnek kell
  // lennie. Ha ugyanonnan hatna, ahonnan kiugranak, már késő lenne.
  ok = line('a duda messzebb hallatszik, mint a kiugrás',
    STREET.hornRange > STREET.critterDashRange,
    `${STREET.hornRange} m kürt, ${STREET.critterDashRange} m kiugrás`) && ok;
}


// --- A motorhang ------------------------------------------------------------
{
  // A hangot fejetlen próbában nem lehet meghallgatni — de az a KÉT szám,
  // amitől sorhatosnak szól, ellenőrizhető, és mindkettő olyan, amit egy
  // későbbi „hangolás" csendben elronthat.
  const source = readFileSync('src/audio/Sound.ts', 'utf8');

  // 1. A GYÚJTÁSREND adja a motorcsaládot, és a V8-nál a lényeg, hogy
  //    EGYENETLEN. Egy keresztsíkú amerikai V8-ban a 90 fokos forgattyú
  //    miatt a lüktetés 180-180-270-90 fokos osztásban érkezik — ettől
  //    dörmög. Ugyanez a motor egyenletes (síksíkú) osztással Ferrari-hangot
  //    adna. Ha valaki egyenletesre „javítaná", a karakter némán eltűnne.
  const block = source.slice(source.indexOf('CROSSPLANE_V8'));
  const patternText = block.slice(block.indexOf('pattern: ['), block.indexOf('formants:'));
  const offsets = [...patternText.matchAll(/\[([\d.]+),\s*[\d.]+\]/g)].map((m) => Number(m[1]));
  const gaps = offsets.map((v, i) =>
    i === 0 ? offsets[0] + 1 - offsets[offsets.length - 1] : v - offsets[i - 1]
  );
  const uneven = gaps.length === 4 && Math.max(...gaps) - Math.min(...gaps) > 0.05;
  ok = line('a V8 gyújtása egyenetlen', uneven,
    uneven
      ? `osztások: ${gaps.map((g) => (g * 720).toFixed(0)).join('-')} fok`
      : 'egyenletes osztás — ez már nem amerikai V8') && ok;

  // 2. A szűrő GÁZRA nyílik. Enélkül a motor mindig ugyanolyan hangos, csak
  //    magasabb — ez a különbség a „reccsen terhelés alatt" és a „zúg" közt.
  const opensUnderLoad = /tone\.frequency\.setTargetAtTime\([^)]*load/.test(source);
  ok = line('a motor terhelés alatt nyílik ki', opensUnderLoad,
    opensUnderLoad ? 'a szűrő a gázt követi' : 'a hangszín nem függ a gáztól') && ok;

  // 2b. LÖKÉSSOROZAT, nem kitartott hullám — ez a különbség a motor és a
  //     zúgó orgona között. Az első változatom oszcillátorokat rakott egymásra
  //     a gyújtásfrekvencia felharmonikusain, és a felhasználó szava rá:
  //     „nem túl élethű". Egy motor lökésekből áll.
  const impulses = /pulseTrain/.test(source) && /playbackRate\.setTargetAtTime/.test(source);
  ok = line('a motor lökésekből áll', impulses,
    impulses ? 'hurkolt lökéssorozat, a fordulat a lejátszási sebesség' : 'kitartott hullám') && ok;

  // 2c. A kipufogó rezonanciái FIXEK: a hangmagasság mozog, a formánsok nem —
  //     pont mint az emberi hangban. Ha a szűrők a forrás elé kerülnének, a
  //     lejátszási sebesség őket is magával vinné, és megint szintetizátor
  //     lenne belőle.
  // A forrás(ok) a torzítón át mennek a FIX sávszűrőkbe. Két réteg lett
  // belőle (álló + menet), tehát a kapcsolat a keverő erősítőkön keresztül
  // fut — de a lényeg ugyanaz: a szűrők a forrás UTÁN vannak, tehát a
  // lejátszási sebesség nem viszi magával őket.
  const fixedFormants =
    /formants: \[/.test(source) &&
    /driveGain\.connect\(this\.shaper\)/.test(source) &&
    /idleGain\.connect\(this\.shaper\)/.test(source);
  ok = line('a kipufogó rezonanciái nem mozognak a fordulattal', fixedFormants,
    fixedFormants ? 'fix sávszűrők a forrás után' : 'a formánsok a hanggal csúsznak') && ok;

  // 2d. A VÉGSEBESSÉGEN a motor a VÖRÖSBEN jár.
  //
  // A fokozathatárok korábban beírt méter/másodperc értékek voltak, és az
  // utolsó százig tartott — a végsebességnél, 33,4-nél a fordulat a sáv
  // kilenc százalékán állt, vagyis a motor 2450-en duruzsolt, miközben a
  // kocsi a maximumon ment. A hang soha nem érte el a vöröset, és ez pont az
  // a fajta hiba, ami némán marad: minden szól, csak rosszul.
  //
  // Arányos határokkal az utolsó fokozat pontosan a végsebességnél ér véget.
  // Ez a teszt a SZÁMOKAT nézi, mert a hangot nem tudja meghallgatni.
  // A FORDULAT folyamatosan emelkedik — a váltás nem veti vissza.
  //
  // Ez a végállapot három nekifutás után. Volt öt fokozat (négy váltás), majd
  // három (kettő) — a fordulat mindkettőnél VISSZAESETT váltáskor, és a
  // felhasználó mindkettőre azt mondta, hogy nem így emelkedik egy autó
  // hangja. Igaza volt: a visszaesés közben a sebesség tovább nő, tehát a
  // hang pont az ellenkezőjét mondja, mint ami történik.
  //
  // Ami MARADT a váltásból: egy pillanatnyi nyomatékkimaradás és egy
  // lefúvatás. Esemény, nem törés — és utána a motor hangosabban húz.
  const rpmFollowsSpeed =
    /rpmFor\(/.test(source) && !/rpm[\s\S]{0,80}within \* \(1 - base\)/.test(source);
  ok = line('a fordulatot a sebesség hajtja, nem a fokozat', rpmFollowsSpeed,
    rpmFollowsSpeed ? 'a váltás csak megcsuklik, nem vet vissza' : 'a váltás visszaveti a fordulatot') && ok;

  // Két váltás az egész gyorsulás alatt, nem több: ami másodpercenként
  // megtörténik, az nem esemény, hanem zaj.
  const shifts = /SHIFTS = \[([^\]]+)\]/.exec(source);
  const count = shifts ? shifts[1].split(',').length : 0;
  ok = line('legfeljebb két váltás van', count === 2,
    `${count} váltás a teljes gyorsulás alatt`) && ok;

  // És minden fokozat HANGOSABB az előzőnél. A valóságban fordítva van, de
  // itt a hang a sebességről szól, és a sebesség nő.
  const gains = /SHIFT_GAIN = \[([^\]]+)\]/.exec(source);
  const levels = gains ? gains[1].split(',').map((v) => Number(v.trim())) : [];
  const louder = levels.length === 3 && levels.every((v, i) => i === 0 || v > levels[i - 1]);
  ok = line('minden fokozat hangosabb az előzőnél', louder,
    levels.join(' → ')) && ok;

  // --- A VÖRÖS TARTOMÁNY TÉNYLEG ELÉRHETŐ ------------------------------------
  //
  // Ez korábban egy SZÖVEGKERESÉS volt a forrásban, és pont azt nem nézte meg,
  // ami számít: a fordulatleképezés pontosan a végsebességnél ért a vörösbe, a
  // kocsi viszont a légellenállás miatt csak aszimptotikusan közelíti a
  // végsebességet. Vagyis a limiter elméletben megszólalt, a gyakorlatban
  // soha — a hang a maxon egyszerűen beállt.
  //
  // Most a VALÓDI számokat mérjük: meddig gyorsul fel az autó, és ott hol jár
  // a fordulat.
  const rpmAt = (share: number): number =>
    (Engine as unknown as {
      rpmFor(v: number, maxSpeed: number, idle: number, redline: number): number;
    }).rpmFor(CAR.maxSpeed * share, CAR.maxSpeed, 800, 6500);

  const flatOut = new Car(new THREE.Vector3());
  run(25, input(0, 1), flatOut);
  const reached = flatOut.speed / CAR.maxSpeed;
  const rpmThere = rpmAt(reached);
  const inRed = rpmThere > 6500 * 0.975;

  ok = line(
    'a valóban elért sebességnél a motor a vörösben jár',
    inRed,
    `25 mp teljes gázzal: a végsebesség ${(reached * 100).toFixed(1)}%-a, ott ${rpmThere.toFixed(0)} fordulat (a vörös 6338 felett)`
  ) && ok;

  // ...és a vörös tartomány elég SZÉLES ahhoz, hogy ne csak egy pillanatra
  // villanjon meg: a legfelső pár százalék sebesség végig kalapál.
  let redFrom = 1;
  for (let t = 0.8; t <= 1.0001; t += 0.005) if (rpmAt(t) > 6500 * 0.975) { redFrom = t; break; }
  ok = line(
    'a vörös tartomány sávja érezhető',
    redFrom < 0.97,
    `a végsebesség ${(redFrom * 100).toFixed(0)}%-ától kalapál a limiter`
  ) && ok;

  // 2e. HÁROM ÁLLAPOT: álló, elindulás, menet — külön hangképpel.
  //
  // Nem hangerő kérdése. Alapjáraton a hengerek közti különbség ARÁNYOSAN
  // sokkal nagyobb (kevés az üzemanyag, a motor a tehetetlenségén él), és
  // ettől lötyög — ugyanazzal a gyújtásképpel halkítva csak egy halk
  // menethang lenne. Ezért van külön `idlePattern`, és ezért kell két
  // forrásnak szólnia egyszerre, átúszva.
  const twoLayers = /idleSource/.test(source) && /idlePattern/.test(source);
  const crossfades = /driveGain\.gain\.setTargetAtTime\(blend/.test(source);
  ok = line('az álló és a menethang külön gyújtáskép', twoLayers && crossfades,
    twoLayers && crossfades ? 'két forrás, közös kipufogó, átúszva' : 'egyetlen hangkép') && ok;

  // Az elindulás a harmadik: teljes gáz + alacsony fordulat + TÉNYLEGES
  // gyorsulás. A harmadik feltétel nélkül a falnak nyomott gáz is így
  // szólna, ami pont fordítva mondaná el, mi történik.
  const needsAcceleration = /accelerating &&/.test(source) && /launch\.gain/.test(source);
  ok = line('az elindulás csak valódi gyorsulásnál szól', needsAcceleration,
    needsAcceleration ? 'gáz + alacsony fordulat + gyorsulás' : 'a falnak nyomva is megszólalna') && ok;

  // 2f. BŐGETÉS ÁLLÓ HELYZETBEN.
  //
  // A kézifék gombja álló helyzetben üresen állt: a `Car.update` csak egy
  // méter/másodperc fölött kapcsolja be. Egy szörnyekkel teli terepjáróban
  // ülve az ember rá fog nyomni — és eddig nem történt semmi.
  const driveScene = readFileSync('src/scenes/DriveScene.ts', 'utf8');
  const canRev = /standing && driver\.sprint/.test(driveScene);
  ok = line('álló helyzetben a kézifék gombja bőget', canRev,
    canRev ? 'egy üresen álló gomb kapott munkát' : 'állva nem lehet bőgetni') && ok;

  // ...és a bőgetés elég magasra megy ahhoz, hogy CSATTANJON is.
  //
  // A pukkanások 3200 fordulat fölött indulnak. Amíg a gáz állva csak 1400-at
  // adott (680 + 1400 = 2080), egy gázfröccs sosem érte el a küszöböt — a
  // leglátványosabb hangja a motornak elérhetetlen volt, és ezt semmi nem
  // jelezte.
  const idleRange = /idle \+ throttle \* (\d+)/.exec(source);
  const reach = idleRange ? Number(idleRange[1]) : 0;
  ok = line('a bőgetés eléri a pukkanás küszöbét', reach > 2600,
    `${reach} fordulatnyi gáztartomány, a pukkanás 3200 fölött indul`) && ok;

  // 3. És leáll a szakasszal. Egy folyamatos oszcillátor, ami a házban is
  //    szól, azonnal észrevehető — és nem magától múlik el.
  const scene = readFileSync('src/scenes/DriveScene.ts', 'utf8');
  const stops = /dispose\(\)[\s\S]{0,400}engine\?\.stop\(\)/.test(scene);
  ok = line('a motor a szakasszal leáll', stops,
    stops ? 'a dispose leállítja' : 'ottmaradna a házban is') && ok;
}


// --- A minta-alapú motor ------------------------------------------------------
{
  // A felhasználó hozott egy valódi felvételt, és annak a textúráját
  // szintézissel nem lehet utolérni. Amit mérni kell, az nem a hang — azt a
  // fejetlen próba nem hallja —, hanem a HÁROM SZÁM, ami körül az egész
  // forog, és amit egy későbbi „rendrakás" csendben elronthat.
  const manifest = JSON.parse(readFileSync('raw/audio/v8.json', 'utf8')) as Array<{
    name: string;
    rpm: number;
    seconds: number;
    revolutions: number;
  }>;

  // 1. HÁROM sáv kell, nem egy. Egyetlen hurkot öt-hatszorosra felhangolva
  //    szúnyog lesz — pont ezért nem volt jó a letölthető CC0 készlet sem,
  //    ami 1,78-szoros tartományt fedett le a szükséges 8,7 helyett.
  const rising = manifest.every((m, i) => i === 0 || m.rpm > manifest[i - 1].rpm);
  ok = line('három fordulatsáv van, növekvő sorrendben',
    manifest.length === 3 && rising,
    manifest.map((m) => `${m.name}=${m.rpm}`).join(', ')) && ok;

  // 2. A sávok FEDJÉK a tartományt. Ha a legmagasabb hurok jóval a vörös
  //    alatt van, a végsebességnél megint hangolni kellene fölfelé.
  const top = manifest[manifest.length - 1].rpm;
  ok = line('a legfelső sáv a vörös közelében van', top > 5000,
    `${top} f/p, a vörös 6500`) && ok;

  // 3. Minden hurok EGÉSZ SZÁMÚ FORDULAT hosszú. Keresztsíkú V8-ban a
  //    gyújtások egyenetlenek, tehát a hullám csak fordulatonként ismétlődik:
  //    gyújtásra vágva a hurok minden körben más fázisban kezdődne, és a fül
  //    ezt kattanásként hallja. Áttűnéssel nem javítható, mert nem
  //    hangerő-, hanem fázishiba.
  //    A fordulatszámot a VÁGÓ írja ki, nem innen fejtjük vissza: a
  //    másodpercek kerekítve vannak, és abból számolva 57,98 jött ki 58
  //    helyett — a teszt egy jó hurokra bukott el.
  const whole = manifest.every((m) => Number.isInteger(m.revolutions) && m.revolutions >= 8);
  ok = line('a hurkok egész számú fordulatból állnak', whole,
    manifest.map((m) => `${m.name}=${m.revolutions}`).join(', ') + ' fordulat') && ok;

  // 4. És a szintetizált motor MEGMARAD tartaléknak: ha a hangfájlok nem
  //    töltenek be, a néma autó rosszabb, mint a szintetizált.
  const soundSource = readFileSync('src/audio/Sound.ts', 'utf8');
  const fallback =
    /export class Engine/.test(soundSource) && /export class SampledEngine/.test(soundSource);
  ok = line('a számolt motor megmarad tartaléknak', fallback,
    fallback ? 'mindkét motor a kódban' : 'a tartalék eltűnt') && ok;
}

console.log('');

// --- A nitró ----------------------------------------------------------------
{
  const boost = (nitro: boolean, seconds: number): number => {
    const car = new Car(new THREE.Vector3());
    const inp = { ...input(0, 1), nitro };
    run(seconds, inp, car);
    return car.speed;
  };

  // 1. Állóból TÉNYLEG gyorsabban indul. Ez a gomb egyetlen ígérete.
  const plain = boost(false, 1.2);
  const nitrod = boost(true, 1.2);
  ok = line('a nitró indulásból gyorsít', nitrod > plain * 1.5,
    `${(plain * 3.6).toFixed(0)} km/h helyett ${(nitrod * 3.6).toFixed(0)} km/h 1,2 mp alatt`) && ok;

  // 2. A végsebesség FÖLÉ visz — különben a maxon a gomb néma lenne.
  const car = new Car(new THREE.Vector3());
  run(14, { ...input(0, 1), nitro: false }, car);
  const flat = car.speed;
  run(1.2, { ...input(0, 1), nitro: true }, car);
  ok = line('a nitró a végsebesség fölé visz', car.speed > flat + 0.5,
    `${(flat * 3.6).toFixed(0)} → ${(car.speed * 3.6).toFixed(0)} km/h`) && ok;

  // 3. A tartály KIFOGY. Egy végtelen nitró nem gomb, hanem új végsebesség.
  const long = new Car(new THREE.Vector3());
  run(NITRO.duration + 1, { ...input(0, 1), nitro: true }, long);
  ok = line('a nitró tartálya kifogy', long.nitroCharge <= 0.001 && !long.boosting,
    `${NITRO.duration} mp után a tartály ${(long.nitroCharge * 100).toFixed(0)}%`) && ok;

  // 4. ...és magától visszatöltődik.
  run(NITRO.refill, input(0, 0), long);
  ok = line('a tartály magától visszatöltődik', long.nitroCharge > 0.95,
    `${NITRO.refill} mp csendben: ${(long.nitroCharge * 100).toFixed(0)}%`) && ok;

  // 5. Az orr csak INDULÁSKOR megy fel. Végsebességnél egy felágaskodó autó
  //    nem látvány, hanem hiba.
  const slow = new Car(new THREE.Vector3());
  run(0.8, { ...input(0, 1), nitro: true }, slow);
  const fast = new Car(new THREE.Vector3());
  run(14, input(0, 1), fast);
  run(0.8, { ...input(0, 1), nitro: true }, fast);
  ok = line('az orr indulásnál emelkedik, a maxon nem', slow.wheelie > fast.wheelie + 0.3,
    `állóból ${slow.wheelie.toFixed(2)}, végsebességnél ${fast.wheelie.toFixed(2)}`) && ok;
}

// --- A képkocka-hurok -------------------------------------------------------
{
  // Egy akadás után a szimuláció NEM maradhat tartósan az óra mögött. Ez volt
  // az, amitől egyetlen tüske után minden képkocka hatot lépett.
  // A normál, felülről vágott képkockát (0,25 mp) a hurok MARADÉKTALANUL
  // ledolgozza — a lépésszám pont ennyit fed le. Ha valaha ennél is több
  // érkezne (mert a vágás elromlik), a maradékot el kell engedni, különben a
  // szimuláció tartósan az óra mögé kerül.
  const normalWorst = stepBudget(0, 0.25);
  ok = line('a legrosszabb képkockát is ledolgozza',
    normalWorst.dropped === 0 && normalWorst.steps === SIM.maxSteps,
    `${normalWorst.steps} lépés, ${(normalWorst.dropped * 1000).toFixed(0)} ms veszett el`) && ok;

  const hitch = stepBudget(0, 0.5);
  ok = line('ennél is hosszabb akadás után nem marad idősadósság',
    hitch.rest === 0 && hitch.dropped > 0,
    `fél másodpercből ${hitch.steps} lépés, ${(hitch.dropped * 1000).toFixed(0)} ms elengedve`) && ok;

  // Normál képkockánál viszont MARAD a maradék — enélkül a fix lépésköz
  // elveszne, és a mozgás képkockasebesség-függő lenne.
  const normal = stepBudget(0, 0.02);
  ok = line('normál képkockánál a maradék megmarad', normal.dropped === 0 && normal.rest > 0,
    `${normal.steps} lépés, ${(normal.rest * 1000).toFixed(1)} ms átvíve`) && ok;
}

console.log('');
if (!ok) process.exitCode = 1;

// --- Az utcai cukorka -------------------------------------------------------
{
  // Egy szándékosan egyszerű város: minden aszfalt, kivéve egy sávot.
  const world: any = {
    bounds: new THREE.Box2(new THREE.Vector2(-200, -200), new THREE.Vector2(200, 200)),
    onRoad: (x: number) => Math.abs(x) < 120,
  };
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const candy = new StreetCandy(world, rnd);

  // 1. Mind ÚTON fekszik. Egy kertben heverő cukorka nem kitérő, hanem csapda.
  const homes = (candy as any).pieces.map((p: any) => p.home);
  ok = line('minden utcai cukorka aszfalton fekszik',
    homes.every((h: THREE.Vector3) => world.onRoad(h.x, h.z)),
    `${homes.length} darab, mind az úton`) && ok;

  // 2. Nincs két darab egy helyen: különben a hetedik elvész.
  let closest = Infinity;
  for (let a = 0; a < homes.length; a++)
    for (let b = a + 1; b < homes.length; b++)
      closest = Math.min(closest, homes[a].distanceTo(homes[b]));
  ok = line('nem fekszik két cukorka egymáson', closest > 19,
    `a két legközelebbi ${closest.toFixed(0)} egységre van`) && ok;

  // 3. RÁHAJTVA fel lehet szedni.
  const got = candy.update(1 / 60, 0, homes[0].clone());
  ok = line('ráhajtva felszedhető', got === 1, `${got} darab egy áthaladásra`) && ok;

  // 4. ...és nem lehet ugyanazt újra meg újra: a felszedett eltűnik, és
  //    MÁSHOL jön vissza. Enélkül egy sarkon körözve végtelen cukorka jár.
  const again = candy.update(1 / 60, 0, homes[0].clone());
  const before = homes[0].clone();
  for (let t = 0; t < 14; t += 1 / 60) candy.update(1 / 60, t, new THREE.Vector3(9999, 0, 9999));
  const moved = (candy as any).pieces[0].home.distanceTo(before);
  ok = line('a felszedett cukorka máshol bukkan fel',
    // A darabszám a kérésre nőtt 7-ről; a próba a KÖVETKEZMÉNYT méri (a
    // felszedett máshol jön vissza, és közben nem fogy el a készlet), nem a
    // konstans egy régi értékét.
    again === 0 && moved > 10 && candy.live === StreetCandy.LIVE,
    `azonnal újra: ${again} darab; új helye ${moved.toFixed(0)} egységre; kint ${candy.live}`) && ok;
}

// --- A fordulatlétra --------------------------------------------------------
{
  const manifest = JSON.parse(readFileSync('public/audio/eng.json', 'utf8')) as {
    name: string; rpm: number; seconds: number; revolutions: number;
  }[];

  // 1. Elég sok fok. Hárommal a tartomány szélein három-négyszeres nyújtás
  //    kell, és ott lesz a hang műanyag.
  ok = line('legalább hat fordulatfok van', manifest.length >= 6,
    `${manifest.length} hurok`) && ok;

  // 2. A NYÚJTÁS a lényeg, nem a darabszám: két szomszédos fok között
  //    legfeljebb néhány félhang lehet, különben a hurkot elhangoljuk.
  //    A szakmai határ négy félhang körül van.
  let worst = 1;
  for (let i = 1; i < manifest.length; i++) worst = Math.max(worst, manifest[i].rpm / manifest[i - 1].rpm);
  const semitones = Math.log2(worst) * 12;
  ok = line('a szomszédos fokok közel vannak', semitones < 4.5,
    `a legnagyobb ugrás ${worst.toFixed(2)}× = ${semitones.toFixed(1)} félhang`) && ok;

  // 3. A létra LEFEDI a motor tartományát: a legalsó fok ne legyen messze az
  //    alapjárattól, a legfelső a vörös közelében legyen.
  const lowest = manifest[0].rpm;
  const highest = manifest[manifest.length - 1].rpm;
  ok = line('a létra a vörösig ér', highest > 6200 && lowest < 2400,
    `${lowest} … ${highest} fordulat (a vörös 6500)`) && ok;

  // 4. MINDEN hurokfájl létezik, és a lejátszó PONT ezeket kéri.
  //
  // Ez a legfontosabb állítás a négy közül. A minta-alapú motor hónapokig
  // ott volt a kódban, de a játék a SZINTETIZÁLTAT indította — vagyis a
  // hangfájlokon végzett munka semmit nem változtatott azon, amit a játékos
  // hall. Egy ilyen szakadást csak úgy lehet elkapni, ha a teszt a KETTŐT
  // KÖTI ÖSSZE: a fájlokat és azt, ami tényleg megszólal.
  const sound = readFileSync('src/audio/Sound.ts', 'utf8');
  // A felhasználó a SZÁMOLT motort kérte vissza — a hang nem mérés kérdése.
  // A mintás motor és a nyolc hurok viszont MARAD: ha egyszer öblösebb forrás
  // kerül elő, egyetlen sor visszakapcsolni. Ezért itt már nem azt nézzük,
  // melyik szól, hanem azt, hogy a KÉSZLET ÉP: mindkét motor a kódban van, és
  // a hurokfájlok, amikre a mintás hivatkozik, megvannak a lemezen.
  const playsSamples =
    /export class SampledEngine/.test(sound) && /export class Engine/.test(sound);
  const urls = [...sound.matchAll(/url: '(audio\/eng-[^']+)'/g)].map((m) => m[1]);
  const allThere = urls.length === manifest.length &&
    urls.every((u) => existsSync(`public/${u}`));
  ok = line(
    'mindkét motor megvan, és a hurokfájlok is',
    playsSamples && allThere,
    playsSamples
      ? `mindkét motor a kódban, ${urls.length} hurok hivatkozva, ${urls.filter((u) => existsSync(`public/${u}`)).length} megvan a lemezen`
      : 'az egyik motor eltűnt a kódból'
  ) && ok;
}

// --- A város haragja --------------------------------------------------------
{
  const clean = () => new Anger();

  // 1. APAD. Ez a legfontosabb: ha csak nőne, akkor nem ügyesség, hanem
  //    visszaszámláló — elég hosszan vezetsz, és úgyis maximumon vagy.
  const a = clean();
  a.hitCritter();
  const afterHit = a.level;
  for (let t = 0; t < 30; t += 1 / 60) a.update(1 / 60, false, 0.3, false, false);
  ok = line('a harag lecsillapodik tiszta vezetéstől',
    afterHit > 0.15 && a.level < 0.02,
    `egy elütés ${(afterHit * 100).toFixed(0)}% → fél perc tiszta vezetés után ${(a.level * 100).toFixed(0)}%`) && ok;

  // 2. A 120 KM/H MARAD ESZKÖZ. Te kérted a végsebességet, és a kocsi arra
  //    van hangolva: ha a gyorshajtás keményen büntetne, azt vennénk vissza.
  //    Egy rövid száguldás legyen olcsó, az egész este maximumon drága.
  const sprintBurst = clean();
  for (let t = 0; t < 5; t += 1 / 60) sprintBurst.update(1 / 60, false, 1, false, false);
  const longRun = clean();
  for (let t = 0; t < 60; t += 1 / 60) longRun.update(1 / 60, false, 1, false, false);
  ok = line('a rövid száguldás olcsó, a hosszú drága',
    sprintBurst.level < 0.1 && longRun.level > 0.4,
    `5 mp padlógáz ${(sprintBurst.level * 100).toFixed(0)}%, egy perc ${(longRun.level * 100).toFixed(0)}%`) && ok;

  // 3. A JÁRDA számít. Ez volt a kérésed, és sokáig MÉRHETETLEN volt: a
  //    járdaszegély 15 cm-es volt, a rács úttest-tűrése 30 — a járda
  //    beleesett a tűrésbe. Most 35 cm, és a különbség látszik.
  const kerb = clean();
  for (let t = 0; t < 3; t += 1 / 60) kerb.update(1 / 60, true, 0.3, false, false);
  ok = line('a járdára hajtás bőszít', kerb.level > 0.2,
    `3 mp a járdán: ${(kerb.level * 100).toFixed(0)}%`) && ok;

  // 4. A DUDA szándékos eszköz: kicsi, de azonnali, és NEM lehet vele
  //    képkockánként tölteni — különben egy lenyomva tartott gomb kimaxolná.
  const honk = clean();
  for (let t = 0; t < 1; t += 1 / 60) honk.update(1 / 60, false, 0, true, false);
  ok = line('a duda tölt, de nem képkockánként', honk.level > 0.02 && honk.level < 0.15,
    `egy másodperc nyomva tartott duda: ${(honk.level * 100).toFixed(0)}%`) && ok;

  // 5. A FALKA SOSEM NULLA. A jó játék nem vehet el tartalmat: az ügyesség
  //    jutalma a könnyebb menet, nem a kimaradó.
  const calm = clean();
  const furious = clean();
  furious.hitCritter(6);
  for (let k = 0; k < 4; k++) furious.ranRedLight();
  ok = line('tiszta estén is jön falka, csúnyán sokkal nagyobb',
    calm.packSize >= 4 && furious.packSize > calm.packSize * 2.5,
    `nyugodt ${calm.packSize} fő, dühös ${furious.packSize} fő`) && ok;
}

// --- A pók JÁRÁSA -----------------------------------------------------------
{
  // A test mozgása mindig sima volt; ami „bugosnak" látszott, az a LÁB: fix
  // ütemben lengett, miközben a test állandó sebességgel haladt. A kettőnek
  // semmi köze nem volt egymáshoz, tehát a talpak folyamatosan CSÚSZTAK.
  //
  // A javítás után egy lépésciklus mindig UGYANAKKORA utat jelent, akármilyen
  // gyorsan megy — ezt lehet lemérni: a lépések száma arányos a megtett úttal.
  const reach = 224;
  const spider = new ShelfSpider(reach, reach * 0.55, reach * 0.34);

  const walk = (seconds: number): { path: number } => {
    const from = spider.group.position.clone();
    let path = 0;
    let prev = from.clone();
    for (let i = 0; i < seconds * 60; i++) {
      spider.update(1 / 60, i / 60);
      path += spider.group.position.distanceTo(prev);
      prev = spider.group.position.clone();
    }
    return { path };
  };

  const a = walk(20);
  ok = line('a pók teste egyenletesen halad', a.path > 10,
    `20 mp alatt ${a.path.toFixed(0)} egység`) && ok;

  // A JÁRÁS ÓRÁJA a megtett úthoz kötődik: ugyanannyi út ugyanannyi lépés,
  // akkor is, ha a képkockaidő más. Enélkül lassú gépen más ütemben lépne,
  // mint gyorson — és pont ez a csúszás.
  const gait = (spider as unknown as { gait: { clockValue?: number } }).gait;
  void gait;
  const source = readFileSync('src/render/SpiderGait.ts', 'utf8');
  const tiedToPath = /travelled \/ Math\.max\(0\.001, stride\)/.test(source);
  ok = line(
    'a lépés a megtett úthoz kötődik, nem az órához',
    tiedToPath,
    tiedToPath ? 'a lépésciklus a haladásból számol' : 'a lábak fix ütemben lengenek'
  ) && ok;
}

// --- Fel lehet nézni az üvegre ----------------------------------------------
{
  // Az egész történet — befőttesüvegbe zártak, mint egy cukorkát — FÖLÖTTED
  // van, és eddig fizikailag nem lehetett ránézni: a kamera mindig a talajra
  // nézett, a dőlés csak a kamera MAGASSÁGÁT mozgatta.
  const source = readFileSync('src/game/DriveStage.ts', 'utf8');
  const looksUp = /look\.y = 1\.4 \+ skyward/.test(source);
  ok = line(
    'a kamera nézéspontja felemelkedik, ha felfelé döntesz',
    looksUp,
    looksUp ? 'a nézéspont a dőlésből számol' : 'a nézéspont fix 1,4 magasságban van'
  ) && ok;

  // ...és az ÜVEGNEK van teteje, amit meg lehet nézni. Búra és befőtt között
  // egyetlen dolog dönt, és az nem az üveg: a FEDŐ.
  const dome = new Dome(224, 224 * 0.55);
  let highest = 0;
  const lidColours = new Set<string>();
  dome.group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const box = new THREE.Box3().setFromObject(m);
    if (box.max.y > highest) highest = box.max.y;
    const mat = m.material as THREE.MeshBasicMaterial;
    if (box.min.y > 224 * 0.55 * 0.8 && mat?.color) lidColours.add(mat.color.getHexString());
  });
  ok = line(
    'a befőttnek van teteje',
    lidColours.size >= 2 && highest > 224 * 0.55 * 0.95,
    `${lidColours.size} fedő-elem a bura tetején, a legmagasabb pont ${highest.toFixed(0)} egység`
  ) && ok;
}

// --- A szimuláció VALÓS IDŐBEN jár ------------------------------------------
{
  // Ez volt a „csak 43 km/h-ig jut" valódi oka, és nem a sebességnek volt
  // köze hozzá: a képkocka-hurok legfeljebb hat részlépést engedett behozni,
  // ami 0,1 másodperc. Minden képkocka, ami ennél tovább tartott, LASSÍTOTT
  // FELVÉTELBE tette a játékot — mérve az autó 40 km/h-t mutatott, miközben
  // hat másodperc alatt négy egységet haladt.
  //
  // A képkockaidő felülről 0,25 mp-re van vágva; ennyit kell lefedni.
  const worstFrame = 0.25;
  const covered = SIM.maxSteps * SIM.step;
  ok = line(
    'lassú gépen sem megy lassított felvételben',
    covered >= worstFrame - 1e-6,
    `a legrosszabb képkocka ${(worstFrame * 1000).toFixed(0)} ms, a hurok ${(covered * 1000).toFixed(0)} ms-ot fed le`
  ) && ok;

  // ...és a lépésszám nem is túl nagy: egy elakadás után nem szabad, hogy a
  // behozás maga fagyassza be a következő képkockát.
  ok = line(
    'a behozás nem fagyaszt be', SIM.maxSteps <= 20,
    `${SIM.maxSteps} lépés a felső határ`
  ) && ok;
}

/**
 * AUTÓ AUTÓNAK. Eddig a két kocsi — a társé és az NPC-ké — átment egymáson:
 * a világ falai ütköztek, a mozgó autók nem szerepeltek sehol. Ez nem
 * „hiányzó extra" volt, hanem látható hiba: a társad kocsija szellem.
 *
 * Amit mérünk, az nem a doboz mérete, hanem a KÖVETKEZMÉNY: aki nekimegy,
 * az megáll előtte, nem benne.
 */
{
  const solid = new Car(0);
  solid.position.set(0, 0, 0);
  // Egy álló autó tizennyolc egységgel előttünk, keresztben az úton.
  const parked = new THREE.Box3(
    new THREE.Vector3(-2.3, 0, 16),
    new THREE.Vector3(2.3, 2.2, 20.6)
  );

  const through = new Car(0);
  through.position.set(0, 0, 0);
  run(3, input(0, 1), through);
  const far = through.position.z;

  solid.obstacles = [parked];
  run(3, input(0, 1), solid);

  ok =
    line(
      'akadály nélkül elhajt mellette',
      far > 25,
      `${far.toFixed(1)} egység 3 mp alatt`
    ) && ok;
  ok =
    line(
      'a másik autó előtt megáll',
      solid.position.z < 16 && solid.position.z > 6,
      `${solid.position.z.toFixed(1)} egységnél (az autó 16-nál kezdődik)`
    ) && ok;
  ok =
    line(
      'nem hajt át rajta',
      solid.position.z < 16,
      `${solid.position.z.toFixed(1)} < 16`
    ) && ok;
  ok =
    line(
      'az ütközés le is lassít',
      Math.abs(solid.speed) < Math.abs(through.speed),
      `${Math.abs(solid.speed).toFixed(1)} vs ${Math.abs(through.speed).toFixed(1)} egység/mp`
    ) && ok;
}


/**
 * A KOCSI VISSZAJELZÉSE: fékfény, gumicsúszás, fékcsík.
 *
 * Mind a három ugyanabból a két állapotból él (`braking`, `slip`), és pont
 * ezért mérhető: nem a hangot és nem a pixeleket nézzük, hanem azt, hogy a
 * kocsi MIKOR mondja magáról, hogy fékez és csúszik. Ha ez jó, a lámpa, a
 * csikorgás és a nyom együtt mozog; ha nem, mind a három külön hazudik.
 */
{
  const c = new Car(0);

  // 1. Guruló lassulás NEM fékezés. A légellenállás is lassít, de attól még
  //    senki nem gyújt féklámpát — ez a hiba adná a legidegesítőbb villogást.
  run(1.5, input(0, 1), c);
  run(0.5, input(0, 0), c);
  ok = line('gurulva nem ég a fékfény', !c.braking, `sebesseg ${c.speed.toFixed(1)}`) && ok;

  // 2. Fékezve igen.
  c.update(SIM.step, input(0, -1), []);
  ok = line('fékre ég a fékfény', c.braking, `sebesseg ${c.speed.toFixed(1)}`) && ok;

  // 3. Tolatás nem fékezés — különben tolatás közben végig égne.
  const r = new Car(0);
  run(2, input(0, -1), r);
  ok = line('tolatva nem ég a fékfény', !r.braking && r.speed < 0,
    `sebesseg ${r.speed.toFixed(1)}`) && ok;

  // 4. Egyenesen gurulva nincs gumicsúszás...
  const s1 = new Car(0);
  run(2, input(0, 1), s1);
  ok = line('egyenesben nem csúszik a gumi', s1.slip < 0.15, `slip ${s1.slip.toFixed(2)}`) && ok;

  // 5. ...kézifékes kanyarban viszont van. Ez az, amiből a csikorgás és a
  //    fékcsík is lesz.
  const s2 = new Car(0);
  run(2, input(0, 1), s2);
  const drift: PlayerInput = { ...input(1, 1), sprint: true };
  run(0.8, drift, s2);
  ok = line('kézifékes kanyarban csúszik', s2.slip > 0.6, `slip ${s2.slip.toFixed(2)}`) && ok;

  // 6. Levegőben nincs csúszás: a kerék nem ér az aszfalthoz.
  const s3 = new Car(0);
  run(2, input(0, 1), s3);
  const jump: PlayerInput = { ...drift, jump: true, jumpHeld: true };
  s3.update(SIM.step, jump, []);
  run(0.2, { ...drift, jumpHeld: true }, s3);
  ok = line('levegőben nem csikorog', !s3.airborne || s3.slip < 0.4,
    `${s3.airborne ? 'levegoben' : 'foldon'}, slip ${s3.slip.toFixed(2)}`) && ok;

  // 7. A FÉKCSÍK csak csúszáskor kerül le, és a szalag elszakad, ha kiengedsz.
  //    Enélkül a következő drift egy hosszú egyenessel kötődne az előzőhöz.
  const marks = new SkidMarks();
  const still = { position: new THREE.Vector3(), heading: 0, slip: 0, airborne: false };
  for (let i = 0; i < 30; i++) {
    still.position.z += 0.3;
    marks.update(SIM.step, still);
  }
  const anyMark = (m: SkidMarks): number =>
    ((m as unknown as { ages: Float32Array }).ages as Float32Array)
      .reduce((n, a) => n + (Number.isFinite(a) ? 1 : 0), 0);
  ok = line('tapadva nem marad nyom', anyMark(marks) === 0, `${anyMark(marks)} lenyomat`) && ok;

  const sliding = { position: new THREE.Vector3(), heading: 0, slip: 0.8, airborne: false };
  // A TALAJSZINT nem a kocsi magassága. Mérve: a kocsi nullán áll, az aszfalt
  // teteje 0,353-nál van, a nyom pedig harminc centivel az út alatt készült —
  // létezett, öregedett, és soha senki nem láthatta. Ez a próba pont ezt köti
  // le: a nyomnak a MEGADOTT talaj fölött kell lennie.
  const ASZFALT = 0.353;
  for (let i = 0; i < 30; i++) {
    sliding.position.z += 0.3;
    marks.update(SIM.step, sliding, () => ASZFALT);
  }
  ok = line('csúszva marad nyom', anyMark(marks) > 10, `${anyMark(marks)} lenyomat`) && ok;

  const ys = (marks as unknown as { positions: Float32Array }).positions
    .filter((_, i) => i % 3 === 1);
  const above = [...ys].filter((y) => y > ASZFALT);
  ok = line('a nyom az aszfalt FÖLÖTT van',
    above.length > 0 && Math.min(...above) > ASZFALT,
    `legalacsonyabb ${Math.min(...above).toFixed(3)} (az út ${ASZFALT})`) && ok;

  // 8. A nyom ELHALVÁNYUL: egy örökre ottmaradó fekete csík tíz perc múlva
  //    az egész várost befestené.
  for (let t = 0; t < 12; t += SIM.step) marks.update(SIM.step, still);
  ok = line('a nyom elhalványul', anyMark(marks) === 0, `${anyMark(marks)} lenyomat 12 mp után`) && ok;
}

console.log(ok ? 'MIND OK — a vezetés hangolása stabil' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
