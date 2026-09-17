/**
 * Headless probe for the one claim Slice 0 makes:
 * the shared→split transition never produces a visible cut.
 *
 * Run: npx vite-node tools/probe-camera.ts   (or via `npm run probe`)
 */
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { resetStage, rotateStage, setStageLens, stage } from '../src/camera/Stage';
import { SplitScreenDirector, type RoomFraming } from '../src/camera/SplitScreenDirector';
import { CAMERA, MOVE, SPLIT } from '../src/core/config';
import { VillageHouse, WALL_DRAW_HEIGHT } from '../src/world/VillageHouse';

const W = 1920;
const H = 1080;

// Minimal stand-ins: the director only reads `.position`.
// The director reads velocity as well as position now — it leads the shot
// where the pair is going — so a stand-in player has to carry one.
const fake = (x: number, z: number) =>
  ({ position: new THREE.Vector3(x, 0, z), velocity: new THREE.Vector3() }) as never;

function run(separations: number[]) {
  const dir = new SplitScreenDirector(2);
  const rows: string[] = [];
  let worstSeam = 0;
  let worstGap = 0;

  for (const sep of separations) {
    const players = [fake(0, 0), fake(sep, 0)];
    // Settle: the director eases, so step it until it converges.
    for (let i = 0; i < 400; i++) dir.update(1 / 60, players, W, H);

    const [v0, v1] = dir.viewports;
    const covered = v0.h + v1.h;
    worstGap = Math.max(worstGap, Math.abs(covered - H));

    // Seam continuity: how far apart are the two cameras at this split amount?
    // At t=0 this MUST be 0 — that is what makes the single image single.
    const seam = dir.cameras[0].position.distanceTo(dir.cameras[1].position);
    if (dir.splitAmount < 0.02) worstSeam = Math.max(worstSeam, seam);

    rows.push(
      `sep ${String(sep).padStart(5)}m  ` +
        `t=${dir.splitAmount.toFixed(3)}  ` +
        `${dir.state.padEnd(10)}  ` +
        `P1 ${String(v0.h).padStart(4)}px / P2 ${String(v1.h).padStart(4)}px  ` +
        `kamerák ${seam.toFixed(2)}m`
    );
  }

  console.log(rows.join('\n'));
  console.log('');
  console.log(`viewport-lefedettség hibája (max): ${worstGap}px  ${worstGap === 0 ? 'OK' : 'HIBA'}`);
  console.log(
    `kamera-eltérés shared állapotban (max): ${worstSeam.toFixed(4)}m  ` +
      `${worstSeam < 1e-6 ? 'OK — a varrat láthatatlan' : 'HIBA — látható vágás'}`
  );
}

console.log(`merge ${SPLIT.mergeDistance}m → split ${SPLIT.splitDistance}m\n`);
run([0, 5, 10, 14, 16, 18, 20, 22, 24, 26, 30, 45, 70]);

// --- Turning the camera must not turn the controls inside out ---------------
{
  // The stage used to face one direction for the whole game, which made half
  // of a real flat unplayable: walk south and you walk INTO the camera, with
  // whatever you are about to hit hidden behind your own back. Q now turns the
  // view a quarter at a time.
  //
  // The thing that has to hold, at every one of those quarters, is that the
  // controls stay true to the SCREEN: pressing forward always moves away from
  // the camera. That is the whole reason it is safe to turn the view at all.
  let worst = 0;
  for (let q = 0; q < 8; q++) {
    resetStage();
    rotateStage(q);

    const player = new PlayerController(0, 0xffffff, new THREE.Vector3(0, 0, 0));
    for (let f = 0; f < 30; f++) {
      player.update(1 / 60, { moveX: 0, moveY: 1, jump: false, interact: false, sprint: false, interactHeld: false } as never, [], 0);
    }

    const went = new THREE.Vector2(player.position.x, player.position.z).normalize();
    // Where the camera sits, relative to the players, on the ground plane.
    const toCamera = new THREE.Vector2(Math.sin(stage.yaw), Math.cos(stage.yaw));
    // Forward is directly away from it.
    const want = toCamera.clone().multiplyScalar(-1);
    worst = Math.max(worst, went.distanceTo(want));
  }
  resetStage();

  const pass = worst < 0.02;
  console.log(
    `az "előre" a kamera fordítása után is előre visz (max eltérés ${worst.toFixed(4)}): ` +
      (pass ? 'OK' : 'HIBA')
  );
  if (!pass) process.exit(1);
}

// --- The shot leads where the players are going -----------------------------
{
  // Centring exactly on the pair spends half the screen on the room they have
  // already crossed, which is why you kept walking into things: the thing you
  // were walking at was the one part of the shot that was off it.
  // Measured through the INDOOR lens, because that is the one this director
  // actually drives — outdoors the drive section has its own camera. Through
  // the tight outdoor lens the numbers here mean nothing.
  resetStage();
  setStageLens({
    pitch: CAMERA.housePitch,
    fov: CAMERA.houseFov,
    minDistance: CAMERA.houseMinDistance,
    maxDistance: CAMERA.houseMaxDistance,
    followDistance: CAMERA.houseFollowDistance,
  });
  const director = new SplitScreenDirector(2);
  const left = new PlayerController(0, 0xffffff, new THREE.Vector3(-2, 0, 0));
  const right = new PlayerController(1, 0xffffff, new THREE.Vector3(2, 0, 0));
  const forward = { moveX: 0, moveY: 1, jump: false, interact: false, sprint: false, interactHeld: false } as never;
  const still = { moveX: 0, moveY: 0, jump: false, interact: false, sprint: false, interactHeld: false } as never;

  // Standing still, the camera sits on them.
  for (let f = 0; f < 120; f++) {
    left.update(1 / 60, still, [], 0);
    right.update(1 / 60, still, [], 0);
    director.update(1 / 60, [left, right], 1600, 900);
  }
  const midStill = left.position.clone().add(right.position).multiplyScalar(0.5);
  const restLead = director.cameras[0].position.clone().sub(midStill);
  restLead.y = 0;

  // Running, it should be looking ahead of them.
  for (let f = 0; f < 180; f++) {
    left.update(1 / 60, forward, [], 0);
    right.update(1 / 60, forward, [], 0);
    director.update(1 / 60, [left, right], 1600, 900);
  }
  const midRun = left.position.clone().add(right.position).multiplyScalar(0.5);
  const runLead = director.cameras[0].position.clone().sub(midRun);
  runLead.y = 0;

  // Forward is -Z, so leading means the camera's offset has moved that way.
  //
  // A küszöb a LENCSÉHEZ mérve van, nem fix egységben. Régen fix 8 egység volt,
  // ami csak a régi 68°/22-es lencsén jelentett valamit: ugyanaz a nyolc egység
  // egy szűkebb lencsén a fél kép, egy szélesen egy nyolcada. Az „előrenézés"
  // definíció szerint a látható képmagasság hányada (CAMERA.leadShare), tehát a
  // próbának is annak kell mérnie.
  const gained = restLead.z - runLead.z;
  const visible = 2 * CAMERA.houseMinDistance * Math.tan((CAMERA.houseFov * Math.PI) / 360);
  const share = gained / visible;
  const leads = share > 0.25;
  console.log(
    `a kamera ${gained.toFixed(1)} egységgel néz előre futás közben — a képmagasság ` +
      `(${visible.toFixed(0)} egység) ${(share * 100).toFixed(0)} százaléka: ` +
      (leads ? 'OK' : 'HIBA')
  );
  if (!leads) process.exit(1);
}

// ---------------------------------------------------------------------------
// SZOBÁNKÉNTI KAMERA — a VALÓDI lakáson
// ---------------------------------------------------------------------------
//
// A beltéri szabály megfordult: nem „minél többet lássunk", hanem PONTOSAN azt
// a szobát lássuk, amelyikben állunk — a fürdőt ne a nappaliból. Amit ez
// mérhetővé tesz, és amit egy render sosem mutatna meg:
//
//   1. a kamera a rajzolt falkorona FÖLÖTT van-e (alatta falat nézünk, nem szobát),
//   2. a játékos a képen van-e MINDENHOL a szobán belül (nem csak a közepén),
//   3. mekkora a játékos a képen (4% alatt felismerhetetlen folt),
//   4. mennyi látszik a szobából, és mennyi szivárog ki belőle,
//   5. ajtón átlépve átúszik-e a kép, vagy csap egyet,
//   6. két külön szobában tényleg szétválik-e, és panelenként vág-e.
{
  const nav = JSON.parse(readFileSync('public/models/house1-nav.json', 'utf8'));
  const house = VillageHouse.fromNav(nav);

  // A HouseScene ezt a horgot köti majd be; a próba ugyanazt használja.
  const framing: RoomFraming = {
    roomFor: (p) => house.roomBounds(house.roomNear(p.x, p.z)),
    clipFor: (p) => house.roomClipPlanes(house.roomNear(p.x, p.z)),
  };

  const houseLens = () => {
    resetStage();
    setStageLens({
      pitch: CAMERA.housePitch,
      fov: CAMERA.houseFov,
      minDistance: CAMERA.houseMinDistance,
      maxDistance: CAMERA.houseMaxDistance,
      followDistance: CAMERA.houseFollowDistance,
    });
  };

  /** Minden állóhely, szobánként csoportosítva. */
  const N = house.gridSize;
  const R = Math.ceil(MOVE.radius / house.cell);
  const standable = new Map<number, THREE.Vector3[]>();
  for (let j = R; j < N - R; j += 2) {
    for (let i = R; i < N - R; i += 2) {
      let free = true;
      for (let b = -R; b <= R && free; b++) {
        for (let a2 = -R; a2 <= R; a2++) if (house.solidAt(i + a2, j + b)) { free = false; break; }
      }
      if (!free) continue;
      const x = house.worldX(i);
      const z = house.worldZ(j);
      const id = house.roomNear(x, z);
      if (id <= 0) continue;
      const list = standable.get(id) ?? [];
      list.push(new THREE.Vector3(x, 0, z));
      standable.set(id, list);
    }
  }

  /**
   * Mekkora a figura a képernyőn, a képmagasság százalékában.
   *
   * NEM a lábfej és a fejtető közti függőleges szakaszt méri, ahogy az első
   * változat: felülnézetből egy álló alak magassága majdnem nullára rövidül a
   * képen, és a mérce 0,05%-ot mondott olyan képre, amin a szörny tisztán
   * látszik. A kérdés nem az, hogy milyen magas, hanem hogy mekkora HELYET
   * foglal — ezt a köré írt gömb vetülete adja meg, és az nem függ attól,
   * honnan nézzük.
   */
  const playerPct = (cam: THREE.PerspectiveCamera, p: THREE.Vector3) => {
    const centre = p.clone().setY(MOVE.height * 0.5);
    const radius = MOVE.height * 0.5;
    const distance = cam.position.distanceTo(centre);
    if (distance <= radius) return 100;
    // A gömb látószöge, a kamera függőleges látószögének arányában.
    const angular = 2 * Math.asin(radius / distance);
    const fov = THREE.MathUtils.degToRad(cam.fov);
    return (angular / fov) * 100;
  };
  const onScreen = (cam: THREE.PerspectiveCamera, p: THREE.Vector3) => {
    const q = p.clone().setY(MOVE.height * 0.5).project(cam);
    // Kis ráhagyás: a keret legszélén álló figura fele már levágva lenne.
    return Math.abs(q.x) <= 0.94 && Math.abs(q.y) <= 0.94 && q.z < 1;
  };
  const settle = (d: SplitScreenDirector, ps: PlayerController[], w: number, h: number) => {
    for (let f = 0; f < 1200; f++) d.update(1 / 60, ps, w, h);
  };
  const pair = (a: THREE.Vector3, b: THREE.Vector3) => [
    new PlayerController(0, 0xffffff, a.clone()),
    new PlayerController(1, 0xffffff, b.clone()),
  ];

  console.log('\n--- szobánkénti keretezés (valódi lakás) ----------------------------');
  console.log(
    `szög ${(CAMERA.housePitch * 180 / Math.PI).toFixed(1)}°, látószög ${CAMERA.houseFov}°, ` +
      `falkorona ${WALL_DRAW_HEIGHT}, szobák ${house.roomIds.length}`
  );
  let ok = true;

  // 0. A falkorona-kényszer: magasság = távolság × sin(szög) ≥ 1,15 × falkorona.
  {
    const need = (1.15 * WALL_DRAW_HEIGHT) / Math.sin(CAMERA.housePitch);
    const worst = Math.min(CAMERA.houseMinDistance, CAMERA.houseFollowDistance);
    const pass = worst >= need;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'OK  ' : 'HIBA'} a legkisebb kameratávolság ${worst} ≥ ${need.toFixed(1)} ` +
        `(a falkorona fölött maradáshoz)`
    );
  }

  // 1–4. Szobánként, minden nézetállásban, mindkét osztásirányban.
  const LAYOUTS: Array<['horizontal' | 'vertical', boolean, string]> = [
    ['horizontal', false, 'közös 1920×1080    '],
    ['horizontal', true, 'vízszintes osztás  '],
    ['vertical', true, 'függőleges osztás  '],
  ];
  for (const [orientation, split, name] of LAYOUTS) {
    SPLIT.orientation = orientation;
    let worstPct = 100;
    let offScreen = 0;
    let samples = 0;
    let minDist = 1e9;
    let maxDist = 0;
    for (const id of house.roomIds) {
      const cells = standable.get(id);
      if (!cells || cells.length === 0) continue;
      // A szoba közepe és a négy legszélső állóhelye — a sarkok a kritikusak.
      const box = house.roomBounds(id)!;
      const probes = [
        cells.reduce((best, c) => (c.distanceTo(box.getCenter(new THREE.Vector3())) < c.distanceTo(best) ? c : best), cells[0]),
        cells.reduce((m, c) => (c.x < m.x ? c : m), cells[0]),
        cells.reduce((m, c) => (c.x > m.x ? c : m), cells[0]),
        cells.reduce((m, c) => (c.z < m.z ? c : m), cells[0]),
        cells.reduce((m, c) => (c.z > m.z ? c : m), cells[0]),
      ];
      // A másik játékos: osztott képhez egy MÁSIK szoba, közöshöz ugyanitt.
      const other = house.roomIds.find((r) => r !== id && standable.get(r)?.length) ?? id;
      for (let q0 = 0; q0 < 4; q0++) {
        const q = q0;
        for (const at of probes) {
          houseLens();
          rotateStage(q);
          const mate = split ? standable.get(other)![0] : at.clone().add(new THREE.Vector3(1.2, 0, 0));
          const d = new SplitScreenDirector(2);
          d.framing = framing;
          const ps = pair(at, mate);
          settle(d, ps, 1920, 1080);
          const cam = d.cameras[0];
          samples++;
          if (!onScreen(cam, at)) {
            offScreen++;
            if (process.env.CAMDEBUG) {
              const q = at.clone().setY(MOVE.height * 0.5).project(cam);
              const bb = house.roomBounds(id)!;
              console.log(`    kilóg: szoba ${id} q${q0} ndc ${q.x.toFixed(2)},${q.y.toFixed(2)} játékos ${at.x.toFixed(1)},${at.z.toFixed(1)} doboz ${bb.min.x.toFixed(1)}..${bb.max.x.toFixed(1)} / ${bb.min.z.toFixed(1)}..${bb.max.z.toFixed(1)} táv ${cam.position.distanceTo(at).toFixed(1)}`);
            }
          }
          worstPct = Math.min(worstPct, playerPct(cam, at));
          const dist = cam.position.distanceTo(d['targets'][0] as THREE.Vector3);
          minDist = Math.min(minDist, dist);
          maxDist = Math.max(maxDist, dist);
          if (cam.position.y <= WALL_DRAW_HEIGHT) ok = false;
        }
      }
    }
    // 3,5% egy 1080 soros képen 38 pixel magas figura. Egy szobánkénti,
    // felülnézetes kamera mellett a karakterek szükségszerűen kicsik; a régi
    // 4%-os küszöb egy laposabb, játékos-középpontú kamerához készült.
    const pass = offScreen === 0 && worstPct >= 3.5;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'OK  ' : 'HIBA'} ${name} ${samples} minta: képen kívül ${offScreen}, ` +
        `legkisebb játékosméret ${worstPct.toFixed(2)}%, táv ${minDist.toFixed(0)}–${maxDist.toFixed(0)}`
    );
  }
  SPLIT.orientation = 'horizontal';

  // 5. Ajtón átlépve a kamera ÚSZIK, nem csap. A pozíció második deriváltja egy
  //    kemény vágásnál tüskeként jelenik meg.
  {
    const from = house.roomBounds(house.roomIds[0])!.getCenter(new THREE.Vector3());
    const to = house.roomBounds(house.roomIds[1])!.getCenter(new THREE.Vector3());
    houseLens();
    const d = new SplitScreenDirector(2);
    d.framing = framing;
    const ps = pair(new THREE.Vector3(from.x, 0, from.z), new THREE.Vector3(from.x + 1.2, 0, from.z));
    settle(d, ps, 1920, 1080);

    const track: THREE.Vector3[] = [];
    const step = new THREE.Vector3(to.x - from.x, 0, to.z - from.z).normalize().multiplyScalar(MOVE.walkSpeed / 60);
    let stoppedAt = -1;
    for (let f = 0; f < 600; f++) {
      let moved = false;
      for (const pl of ps) {
        if (pl.position.distanceTo(new THREE.Vector3(to.x, 0, to.z)) > 1) {
          pl.position.add(step);
          moved = true;
        }
      }
      if (!moved && stoppedAt < 0) stoppedAt = f;
      d.update(1 / 60, ps, 1920, 1080);
      track.push(d.cameras[0].position.clone());
    }
    let peak = 0;
    let peakAt = 0;
    for (let f = 2; f < track.length; f++) {
      const acc = track[f].clone().sub(track[f - 1].clone().multiplyScalar(2)).add(track[f - 2]);
      const m = acc.length() * 60 * 60;
      if (m > peak) { peak = m; peakAt = f; }
    }
    const smooth = peak < 120;
    if (!smooth) ok = false;
    console.log(
      `${smooth ? 'OK  ' : 'HIBA'} szobák között a kamera csúcsgyorsulása ${peak.toFixed(0)} e/s² ` +
        `(a cél-keretezés simítása nélkül ez 2196 volt — az a képernyőn csapás)`
    );
  }

  // 6. Két külön szobában muszáj szétválni: egy közös kép mindkettőt mutatná.
  {
    houseLens();
    const d = new SplitScreenDirector(2);
    d.framing = framing;
    const a = house.roomBounds(house.roomIds[0])!.getCenter(new THREE.Vector3());
    const b = house.roomBounds(house.roomIds[1])!.getCenter(new THREE.Vector3());
    const ps = pair(new THREE.Vector3(a.x, 0, a.z), new THREE.Vector3(b.x, 0, b.z));
    settle(d, ps, 1920, 1080);
    const clips = (d as unknown as { clips: THREE.Plane[][] }).clips;
    const pass = d.splitAmount > 0.99 && clips[0].length > 0 && clips[1].length > 0;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'OK  ' : 'HIBA'} két külön szobában szétválik (t=${d.splitAmount.toFixed(2)}) ` +
        `és panelenként vág (${clips[0].length} / ${clips[1].length} sík)`
    );
  }

  // 7. Egy szobában állva IS vágunk, és mindkét panel UGYANAZT kapja.
  //
  //    Ez a teszt korábban az ellenkezőjét kérte számon — hogy közös képen ne
  //    legyen vágás —, és azzal a hibát őrizte: az idő nagy részében a pár
  //    együtt van, tehát közös a kép, tehát semmi nem volt levágva. A kamera
  //    beállt egy ajtó mögé, és a képernyőt egy ajtólap töltötte ki.
  //
  //    A varrattól nem kell félni: ha egy szobában állnak, ugyanazt a szobát
  //    kapják, tehát a két panel síkjai azonosak.
  {
    houseLens();
    const d = new SplitScreenDirector(2);
    d.framing = framing;
    const c = house.roomBounds(house.roomIds[house.roomIds.length - 1])!.getCenter(new THREE.Vector3());
    const ps = pair(new THREE.Vector3(c.x, 0, c.z), new THREE.Vector3(c.x + 1.2, 0, c.z));
    settle(d, ps, 1920, 1080);
    const clips = (d as unknown as { clips: THREE.Plane[][] }).clips;
    const same =
      clips[0].length === clips[1].length &&
      clips[0].every((plane, k) =>
        plane.normal.equals(clips[1][k].normal) && Math.abs(plane.constant - clips[1][k].constant) < 1e-6
      );
    const pass = d.splitAmount === 0 && clips[0].length > 0 && same;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'OK  ' : 'HIBA'} közös képen is vág, varrat nélkül ` +
        `(t=${d.splitAmount.toFixed(2)}, síkok ${clips[0].length}, a két panel ${same ? 'azonos' : 'ELTÉR'})`
    );
  }

  // 8. Takarás: ilyen lapos szögnél a SAJÁT szobánk közelebbi fala is eltakarhat.
  //    Ez nem a kamera hibája és nem is itt javítható — a rajzolt falkorona
  //    magassága dönti el —, de meg kell mondani, mennyi.
  {
    const shadow = (WALL_DRAW_HEIGHT - MOVE.height) / Math.tan(CAMERA.housePitch);
    const lidFor = (want: number) => MOVE.height + want * Math.tan(CAMERA.housePitch);
    console.log(
      `      falárnyék: egy ${WALL_DRAW_HEIGHT} egység magas fal ${shadow.toFixed(1)} egységgel a játékos ` +
        `MÖGÖTT is eltakarja (${(CAMERA.housePitch * 180 / Math.PI).toFixed(1)}°-on). ` +
        `3 egységre csökkentéshez a falkoronának ${lidFor(3).toFixed(1)}-nek kellene lennie.`
    );
  }

  resetStage();
  if (!ok) process.exit(1);

  // --- Az osztást a SZOBA dönti el, nem a távolság ----------------------------
  {
    // A távolság-küszöb (7 / 14 egység) a nyílt városi szakaszból maradt itt, és
    // a szobakamerával szemben dolgozott. Lemérve: a legnagyobb szoba 39 egység,
    // tehát a két végében állva szétvált a kép, pedig EGY szobában voltak; a
    // legkisebb 18 egység, ott meg soha nem vált szét. Pont fordítva működött.
    houseLens();
    const big = house.roomBounds(house.roomIds[0])!;
    const centre = big.getCenter(new THREE.Vector3());
    const size = big.getSize(new THREE.Vector3());

    // Ugyanabban a szobában, a két átellenes sarokban — messze egymástól.
    const d1 = new SplitScreenDirector(2);
    d1.framing = framing;
    const far = pair(
      new THREE.Vector3(centre.x - size.x * 0.3, 0, centre.z - size.z * 0.3),
      new THREE.Vector3(centre.x + size.x * 0.3, 0, centre.z + size.z * 0.3)
    );
    const separation = far[0].position.distanceTo(far[1].position);
    settle(d1, far, 1920, 1080);
    const sameRoomShared = d1.splitAmount < 0.01;

    // Két külön szobában, közel egymáshoz — ajtón innen és túl.
    const other = house.roomBounds(house.roomIds[1])!.getCenter(new THREE.Vector3());
    const d2 = new SplitScreenDirector(2);
    d2.framing = framing;
    const apart = pair(
      new THREE.Vector3(centre.x, 0, centre.z),
      new THREE.Vector3(other.x, 0, other.z)
    );
    settle(d2, apart, 1920, 1080);
    const twoRoomsSplit = d2.splitAmount > 0.99;

    const pass = sameRoomShared && twoRoomsSplit;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'OK  ' : 'HIBA'} egy szobában közös (${separation.toFixed(0)} egység távolság ellenére is), ` +
        `két szobában osztott`
    );
  }

  // --- A válaszvonal a geometriát követi --------------------------------------
  {
    // A paneled azon az oldalon legyen, amerre a szobád valóban van — így a kép
    // maga a térkép. Beállításból ez nem jöhet: a régi fix irány a bal oldali
    // szobában álló játékos panelét a képernyő jobb felére tette.
    houseLens();
    resetStage();

    // Két szoba, amik a képen VÍZSZINTESEN állnak egymás mellett.
    let best: [number, number] | null = null;
    let bestSideways = 0;
    const right = new THREE.Vector3().crossVectors(
      new THREE.Vector3(0, 1, 0),
      new THREE.Vector3(Math.sin(stage.yaw), 0, Math.cos(stage.yaw))
    ).normalize();
    for (const a of house.roomIds) {
      for (const b of house.roomIds) {
        if (a === b) continue;
        const ca = house.roomBounds(a)!.getCenter(new THREE.Vector3());
        const cb = house.roomBounds(b)!.getCenter(new THREE.Vector3());
        const sideways = new THREE.Vector3().subVectors(cb, ca).setY(0).dot(right);
        if (Math.abs(sideways) > bestSideways) {
          bestSideways = Math.abs(sideways);
          best = [a, b];
        }
      }
    }

    const ca = house.roomBounds(best![0])!.getCenter(new THREE.Vector3());
    const cb = house.roomBounds(best![1])!.getCenter(new THREE.Vector3());
    const d = new SplitScreenDirector(2);
    d.framing = framing;
    const ps = pair(new THREE.Vector3(ca.x, 0, ca.z), new THREE.Vector3(cb.x, 0, cb.z));
    settle(d, ps, 1920, 1080);

    // A 2. játékos szobája jobbra van (pozitív oldalirány), tehát az ő panelje
    // a képernyő jobb felére kell essen.
    const sideways = new THREE.Vector3().subVectors(cb, ca).setY(0).dot(right);
    const vp = (d as unknown as { viewports: Array<{ x: number }> }).viewports;
    const secondIsOnTheRight = vp[1].x > vp[0].x;
    const pass = d.splitLayout.vertical && secondIsOnTheRight === sideways > 0;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'OK  ' : 'HIBA'} a válaszvonal a geometriát követi ` +
        `(függőleges: ${d.splitLayout.vertical}, a 2. szoba ${sideways > 0 ? 'jobbra' : 'balra'}, ` +
        `a panelje ${secondIsOnTheRight ? 'jobbra' : 'balra'})`
    );
  }


  // --- Egyedül nincs osztott kép ------------------------------------------
  {
    // Egy ember nézi a képernyőt: nincs kit külön követni, és a fél képet
    // elvenni egy második nézetnek csak annyit jelentene, hogy mindkettőből
    // kevesebbet lát. A kamera azt a szörnyet keretezi, amelyiket épp
    // mozgatja — akkor is, ha a másikat a lakás túlfelén hagyta.
    houseLens();
    const here = house.roomBounds(house.roomIds[0])!.getCenter(new THREE.Vector3());
    const faraway = house.roomBounds(house.roomIds[house.roomIds.length - 1])!
      .getCenter(new THREE.Vector3());

    const d = new SplitScreenDirector(2);
    d.framing = framing;
    d.soloActive = 0;
    const ps = pair(new THREE.Vector3(here.x, 0, here.z), new THREE.Vector3(faraway.x, 0, faraway.z));
    settle(d, ps, 1920, 1080);

    const noSplit = d.splitAmount === 0;
    // A kamera a 0. szörnyre néz, nem a kettő közepére.
    const looksAtActive =
      d.cameras[0].position.distanceTo(ps[0].position) <
      d.cameras[0].position.distanceTo(ps[1].position);

    // És ha a Tab átvált, a kamera átmegy a másikhoz.
    d.soloActive = 1;
    settle(d, ps, 1920, 1080);
    const followsSwap =
      d.cameras[0].position.distanceTo(ps[1].position) <
      d.cameras[0].position.distanceTo(ps[0].position);

    const pass = noSplit && looksAtActive && followsSwap;
    if (!pass) ok = false;
    console.log(
      `${pass ? 'OK  ' : 'HIBA'} egyedül nincs osztás (t=${d.splitAmount.toFixed(2)}), ` +
        `a kamera a sajat szornyunket koveti, es a szerep valtasaval atvalt`
    );
  }

}
