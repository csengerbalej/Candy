import * as THREE from 'three';
import { Homeowner } from '../src/ai/Homeowner';
import { NoiseSystem } from '../src/systems/NoiseSystem';
import { HOMEOWNER, NOISE } from '../src/core/config';
import { readFileSync } from 'node:fs';
import { HOMEOWNER_CLIPS } from '../src/render/CharacterRig';

/**
 * Headless probe for the claim Slice 1 makes: a prank actually MOVES him, and
 * standing in his flashlight actually gets you caught. If either is false the
 * co-op loop is decorative.
 *
 * Run: npm run probe:ai
 */
const DT = 1 / 60;
const fakePlayer = (x: number, z: number, index = 0) =>
  ({ position: new THREE.Vector3(x, 0, z), index }) as never;

// Matched to HOUSE_SCALE: the interior was halved, so a probe built on the old
// coordinates tests distances that no longer exist in the game.
const waypoints = [
  new THREE.Vector3(-17, 0, 5),
  new THREE.Vector3(-17, 0, -15),
  new THREE.Vector3(17, 0, -15),
  new THREE.Vector3(17, 0, 5),
];

function step(h: Homeowner, noise: NoiseSystem, players: never[], seconds: number, onTick?: (t: number) => void) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) {
    h.update(DT, players, noise);
    noise.update(DT);
    onTick?.(i * DT);
  }
}

function line(label: string, pass: boolean, detail: string) {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(42)} ${detail}`);
  return pass;
}

let allPass = true;

// --- 1. Does standing in the light get you caught? -------------------------
{
  const noise = new NoiseSystem();
  const h = new Homeowner(new THREE.Vector3(0, 0, 0), waypoints, []);
  // Park a player on the line he is already walking, i.e. squarely in the beam.
  const toward = waypoints[0].clone().normalize().multiplyScalar(10);
  const player = fakePlayer(toward.x, toward.z);
  let caughtAt = -1;
  step(h, noise, [player], 8, (t) => {
    if (caughtAt < 0 && h.state === 'CHASE') caughtAt = t;
  });
  allPass =
    line('lámpában állva elkapnak', caughtAt > 0 && caughtAt < 4, `CHASE ${caughtAt.toFixed(2)}s alatt`) && allPass;
}

// --- 2. Does cover actually hide you? --------------------------------------
{
  const noise = new NoiseSystem();
  const wall = new THREE.Mesh(new THREE.BoxGeometry(10, 10, 2), new THREE.MeshBasicMaterial());
  wall.position.set(0, 5, 5);
  wall.updateMatrixWorld(true);
  const h = new Homeowner(new THREE.Vector3(0, 0, 0), waypoints, [wall]);
  const player = fakePlayer(0, 10);
  step(h, noise, [player], 6);
  allPass =
    line('fal mögött nem lát meg', h.state !== 'CHASE', `állapot ${h.state}, gyanú ${h.suspicion.toFixed(2)}`) &&
    allPass;
}

// --- 3. The co-op currency: does a prank pull him off patrol? --------------
{
  const noise = new NoiseSystem();
  const h = new Homeowner(new THREE.Vector3(-17, 0, 5), waypoints, []);
  step(h, noise, [], 2);
  const before = h.position.clone();

  // P2 sets off the fridge magnets on the far side of the kitchen.
  const prankAt = new THREE.Vector3(20, 0, -10);
  noise.emit(prankAt, NOISE.prankRadius, 'P2 — HŰTŐMÁGNES-LAVINA');

  let sawInvestigate = false;
  let closest = Infinity;
  step(h, noise, [], 12, () => {
    if (h.state === 'INVESTIGATE' || h.state === 'SUSPICIOUS') sawInvestigate = true;
    closest = Math.min(closest, h.position.distanceTo(prankAt));
  });

  const moved = before.distanceTo(h.position);
  allPass = line('a csíny elhúzza a házigazdát', sawInvestigate, `állapotváltás megtörtént`) && allPass;
  allPass =
    line('el is megy a zaj helyére', closest < 14, `${closest.toFixed(1)}m-re ért, ${moved.toFixed(1)}m-t tett meg`) &&
    allPass;
}

// --- 4. How long is the window the distraction buys? -----------------------
{
  const noise = new NoiseSystem();
  const h = new Homeowner(new THREE.Vector3(0, 0, 0), waypoints, []);
  const candyAt = new THREE.Vector3(-14, 0, -8);
  noise.emit(new THREE.Vector3(20, 0, -10), NOISE.prankRadius, 'csíny');

  let awaySeconds = 0;
  step(h, noise, [], 14, () => {
    if (h.position.distanceTo(candyAt) > HOMEOWNER.viewRange) awaySeconds += DT;
  });
  allPass =
    line('a lopásra nyíló ablak', awaySeconds > 2.6, `${awaySeconds.toFixed(1)}s (kell: 2.6s az emeléshez)`) &&
    allPass;
}

// --- 5. A character must never be flung through what it bumps into --------
{
  const { PlayerController } = await import('../src/player/PlayerController');
  const { MOVE } = await import('../src/core/config');

  // A kitchen counter: long, and the thing a panicking player clips a corner of.
  const counter = new THREE.Box3(
    new THREE.Vector3(-18, 0, -4),
    new THREE.Vector3(18, 3, 4)
  );

  let worst = 0;
  for (const heading of [0.25, 0.75, -0.25, -0.75]) {
    const player = new PlayerController(0, 0xffffff, new THREE.Vector3(-15, 0, -10));
    const input = {
      moveX: Math.sin(heading * Math.PI),
      moveY: Math.cos(heading * Math.PI),
      jump: false,
      jumpHeld: false,
      sprint: true,
      interact: false,
      interactHeld: false,
      usingGamepad: false,
    };
    let previous = player.position.clone();
    for (let i = 0; i < 400; i++) {
      player.update(DT, input, [counter]);
      if (i > 2) worst = Math.max(worst, player.position.distanceTo(previous));
      previous = player.position.clone();
    }
  }

  const budget = (MOVE.sprintSpeed / 60) * 3;
  allPass =
    line('a karakter nem teleportál ütközéskor', worst < budget,
      `legnagyobb lépés ${worst.toFixed(2)} (határ ${budget.toFixed(2)})`) && allPass;
}

// --- 6. Can a character trapped inside geometry get out? ------------------
{
  const { PlayerController } = await import('../src/player/PlayerController');

  // The kitchen island, and a character somehow inside it.
  const island = new THREE.Box3(new THREE.Vector3(-7, 0, -4), new THREE.Vector3(7, 3, 4));
  const starts = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(5, 0, 2.5),
    new THREE.Vector3(-6, 0, -3),
  ];

  let escaped = 0;
  for (const start of starts) {
    const player = new PlayerController(0, 0xffffff, start.clone());
    for (let attempt = 0; attempt < 8; attempt++) {
      const angle = (attempt / 8) * Math.PI * 2;
      const input = {
        moveX: Math.sin(angle),
        moveY: Math.cos(angle),
        jump: false,
        jumpHeld: false,
        sprint: true,
        interact: false,
        interactHeld: false,
        usingGamepad: false,
      };
      for (let i = 0; i < 90; i++) player.update(DT, input, [island]);
      if (!island.containsPoint(player.position)) break;
    }
    if (!island.containsPoint(player.position)) escaped++;
  }

  allPass =
    line('beragadt karakter ki tud jönni', escaped === starts.length,
      `${escaped}/${starts.length} pozícióból szabadult`) && allPass;
}


// --- A lakó teste és mozgása -----------------------------------------------
{
  // Amit itt mérni érdemes, az nem az, hogy „szép-e" — hanem hogy a
  // klipnevek TÉNYLEG megvannak a megsütött fájlban. Ez a hiba néma: a rig
  // kihagyja a nem talált klipet, a lakó kötési pózban csúszik végig a
  // lakáson, és semmi nem panaszkodik. Egy átnevezés a sütőszkriptben elég
  // hozzá — pont az a fajta, amit hetekkel később vesz észre az ember.
  const names = (file: string): string[] => {
    const { glb } = JSON.parse(readFileSync(file, 'utf8')) as { glb: string };
    const buf = Buffer.from(glb, 'base64');
    let offset = 12;
    while (offset < buf.length) {
      const len = buf.readUInt32LE(offset);
      const type = buf.readUInt32LE(offset + 4);
      const start = offset + 8;
      if (type === 0x4e4f534a) {
        const json = JSON.parse(buf.subarray(start, start + len).toString('utf8'));
        return (json.animations ?? []).map((a: { name?: string }) => a.name ?? '');
      }
      offset = start + len;
    }
    return [];
  };

  const available = new Set([
    ...names('public/models/harold.json'),
    ...names('public/models/harold.clips.json'),
  ]);
  const wanted = Object.values(HOMEOWNER_CLIPS) as string[];
  const missing = wanted.filter((c) => !available.has(c));
  allPass = line('a lakó minden klipje megvan', missing.length === 0,
    missing.length ? `hiányzik: ${missing.join(', ')}` : wanted.join(', ')) && allPass;

  // A duplikátumok NE kerüljenek be: a Meshy minden klipet kétszer ad, és a
  // másodikat `.001`-re nevezi. Nem hibázik tőle semmi, csak hízik a csomag.
  const dupes = [...available].filter((n) => /\.\d{3}$/.test(n));
  allPass = line('nincs duplikált klip a csomagban', dupes.length === 0,
    dupes.length ? dupes.join(', ') : `${available.size} klip, mind egyedi`) && allPass;

  // És a leképezés legyen TELJES: minden állapothoz tartozzon mozgás, mert
  // egy lefedetlen állapotban a rig az előzőt tartaná meg — a lakó üldözés
  // közben sétálna.
  const states = [
    'IDLE', 'PATROL', 'SUSPICIOUS', 'INVESTIGATE',
    'ALERT', 'CHASE', 'SEARCH', 'RETURN',
  ] as const;
  const motion = (Homeowner as unknown as {
    motionFor(s: string): string;
  }).motionFor;
  const covered = states.every((st) => {
    const m = motion.call(Homeowner, st);
    return typeof m === 'string' && HOMEOWNER_CLIPS[m as keyof typeof HOMEOWNER_CLIPS];
  });
  allPass = line('minden állapothoz tartozik mozgás', covered,
    states.map((st) => `${st}→${motion.call(Homeowner, st)}`).join(' ')) && allPass;

  // Az elkapás mozdulata nem szakadhat félbe.
  //
  // Ez a legkönnyebben elromló darab: az `applyTransform` MINDEN képkockán
  // újraolvassa az állapotot, tehát egy állapotként kezelt elkapás a
  // következő képen már felül is íródna az üldözéssel — a mozdulat egyetlen
  // képkockányit villanna, és semmi nem panaszkodna.
  {
    const played: string[] = [];
    const fakeRig = {
      play: (state: string) => { if (played[played.length - 1] !== state) played.push(state); },
      setSpeedScale: () => {},
      update: () => {},
    };
    const owner = new Homeowner(new THREE.Vector3(0, 0, 0), waypoints, []);
    owner.setArt(new THREE.Object3D(), fakeRig as never);
    const noise2 = new NoiseSystem();
    // Néhány képkocka járőrözés, aztán elkapás.
    for (let i = 0; i < 10; i++) owner.update(DT, [fakePlayer(300, 300)], noise2);
    owner.playCatch();
    const heldFrames: string[] = [];
    for (let i = 0; i < 30; i++) {
      owner.update(DT, [fakePlayer(300, 300)], noise2);
      heldFrames.push(played[played.length - 1]);
    }
    const stayedGrab = heldFrames.every((m) => m === 'grab');
    // ...és utána visszaveszi a járőrözést, nem ragad bele.
    for (let i = 0; i < 90; i++) owner.update(DT, [fakePlayer(300, 300)], noise2);
    const recovered = played[played.length - 1] !== 'grab';
    allPass = line('az elkapás mozdulata végigfut, aztán elenged',
      stayedGrab && recovered,
      `fél másodpercig ${heldFrames[0]}, végül ${played[played.length - 1]}`) && allPass;
  }

  // A gyanakvás LÁTSZIK is, ne csak a lámpából: a settenkedés más klip, mint
  // a járőrözés. Enélkül a testtartás nem mond semmit, amit a lámpa ne
  // mondana el — és akkor fölösleges.
  allPass = line('a gyanakvás más testtartás, mint a járőrözés',
    motion.call(Homeowner, 'SEARCH') !== motion.call(Homeowner, 'PATROL') &&
    motion.call(Homeowner, 'CHASE') !== motion.call(Homeowner, 'PATROL'),
    `járőr ${motion.call(Homeowner, 'PATROL')}, keres ${motion.call(Homeowner, 'SEARCH')}, üldöz ${motion.call(Homeowner, 'CHASE')}`) && allPass;
}


// --- A lakó nem megy át a falon ---------------------------------------------
{
  // A járőrözés egyenesen a célpont felé lépkedett, ütközésvizsgálat nélkül.
  // A JÁTÉKOSNAK volt ütközése, a lakónak nem — és ez pont a szakasz
  // ígéretét vonta vissza: hiába kerülöd meg a falat, ha ő nem kerüli meg.
  //
  // A teszt egy fallal kettéosztott teret ad neki, és a túloldalra küldi.
  // Át NEM juthat; a fal mentén viszont el KELL tudnia csúszni, különben
  // csak a beszorulást cseréltük az átsétálásra.
  const WALL_X = 0;
  const owner = new Homeowner(new THREE.Vector3(-20, 0, 0), [new THREE.Vector3(20, 0, 0)], []);
  owner.walkable = (x, _z, radius) => Math.abs(x - WALL_X) > radius;

  const noise2 = new NoiseSystem();
  let crossed = false;
  let travelled = 0;
  let previous = owner.position.clone();
  for (let f = 0; f < 60 * 40; f++) {
    owner.update(DT, [fakePlayer(500, 500)], noise2);
    if (owner.position.x > WALL_X) crossed = true;
    travelled += owner.position.distanceTo(previous);
    previous = owner.position.clone();
  }

  allPass = line('a lakó nem megy át a falon', !crossed,
    crossed ? 'átsétált' : `${travelled.toFixed(0)} egységet tett meg, de a falon innen`) && allPass;

  // És a fal MENTÉN mozog, nem fagy le. Egy odaszorult lakó ugyanolyan hiba,
  // csak a másik irányba: a járőrözés megszűnne.
  const owner2 = new Homeowner(
    new THREE.Vector3(-20, 0, -10),
    [new THREE.Vector3(20, 0, 30), new THREE.Vector3(-20, 0, -10)],
    []
  );
  owner2.walkable = (x, _z, radius) => Math.abs(x - WALL_X) > radius;
  let slid = 0;
  let before = owner2.position.clone();
  for (let f = 0; f < 60 * 20; f++) {
    owner2.update(DT, [fakePlayer(500, 500)], noise2);
    slid += Math.abs(owner2.position.z - before.z);
    before = owner2.position.clone();
  }
  allPass = line('a falnak feszülve is elcsúszik mellette', slid > 5,
    `${slid.toFixed(0)} egységnyi elmozdulás a fal mentén`) && allPass;
}

console.log('');
console.log(allPass ? 'MIND OK — a kooperációs hurok működik' : 'VAN BUKÓ TESZT');
if (!allPass) process.exitCode = 1;
