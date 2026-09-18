import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { repairTextures } from '../assets/textureRepair';
import type { CandySpot, HouseWorld, PrankSpot } from './HouseWorld';
import { MOVE, HOMEOWNER } from '../core/config';
import { models } from '../assets/ModelLoader';

/**
 * The first house, for real (spec §13–§14).
 *
 * Until now every house in the night was the same greybox kitchen: fifteen
 * coloured boxes standing in for a room. This is an actual flat — hall,
 * living room, kitchen, bedroom, bathroom, WC — measured out of a Meshy model
 * by tools/house-nav.py and painted by tools/house-colour.py.
 *
 * Nothing about the layout is authored here. The rooms, the front door, where
 * the candy sits, where the homeowner walks: all of it is measured offline and
 * read out of house1-nav.json, for the same reason the village is — a model
 * that gets re-baked must not need the code changed with it.
 */

/**
 * Model units → game units.
 *
 * Chosen from what the CAMERA can show, which turned out to be the constraint
 * that matters. The first pass picked 62 from the ceiling height — a 2.5 m
 * ceiling over something fifteen centimetres tall — and it was unplayable:
 * a room came out 31 units across, the shared camera never pulls further back
 * than 22, and at that distance it sees about 20 units. You could never see a
 * whole room, so you could never tell where you were. Two tiny monsters stood
 * in a white canyon.
 *
 * At 36 a room is 18 units and fits the frame, the flat is 67 units across —
 * about what the old greybox kitchen was — and the ceiling is still nine and a
 * half monster-heights, which is all the "giant" the joke needs.
 */
export const HOUSE1_SCALE = 36;

/**
 * A falak ütközőjének legkisebb magassága, egységben.
 *
 * A dupla ugrás teteje 12,6 (19,1 és 17,0 kezdősebesség, 26-os gravitáció).
 * Ennél a falnak MINDIG magasabbnak kell lennie, különben a szobák megszűnnek
 * szobák lenni. A ház1 fala magától 17, a ház3-é viszont csak 8.
 */
export const WALL_COLLIDER_MIN = 16;

interface HouseNav {
  /** The scale the grid was measured for. Must match HOUSE1_SCALE. */
  scale?: number;
  min: [number, number, number];
  max: [number, number, number];
  n: number;
  cell: number;
  floorZ: number;
  wallTop: number;
  floor: string[];
  solid: string[];
  rooms: string[];
  roomInfo: Array<{
    id: number;
    cells: number;
    area: number;
    centre: [number, number];
    min: [number, number];
    max: [number, number];
  }>;
  height: Array<Array<number | null>>;
  porch: [number, number];
  door: [number, number] | null;
  spawn: [number, number] | null;
  entryRoom: number;
  candy: Array<{ at: [number, number]; room: number; reward: number }>;
  pranks: Array<{ at: [number, number]; room: number }>;
  patrol: Array<[number, number]>;
  homeowner: [number, number];
}

/**
 * How much of a wall is drawn, in game units.
 *
 * The flat's walls stand sixteen units tall, and a camera lower than that has
 * them between it and the players — which is why the indoor shot had to look
 * down so steeply, and why it then felt like a map rather than a room you were
 * standing in. Cutting the tops off lets the camera come down to nearly the
 * outdoor angle and look ALONG the flat instead of onto it.
 *
 * It is a drawing height only: the colliders keep their full height, so a wall
 * you can see over is still a wall you cannot walk through. This is the
 * doll's-house view every isometric game with interiors uses, for the same
 * reason.
 *
 * The number is set by the CAMERA, not by taste — and it is not really a
 * constant at all: `wallHeightFor()` derives it from the camera's angle, and
 * this is only the starting value. That is deliberate. Twice now the angle and
 * the wall height have been tuned separately and fought each other: a low
 * camera needs low walls, and low walls look like kerbs. Making one follow the
 * other means they cannot drift apart again.
 */
export const WALL_DRAW_HEIGHT = 10;

/**
 * How tall a sweet bucket stands, in game units.
 *
 * Nearly twice a monster's height. At this scale a trick-or-treat bucket IS
 * enormous, which is the joke, and it also makes the thing you crossed the
 * flat for visible from the other side of a room.
 */
export const CANDY_HEIGHT = 3.2;

/**
 * A CUKORKA MÉRETE EMBERMÉRTÉKBEN.
 *
 * A 3,2 egységes tök a szörnyecskék világához való: ott te 1,7 magas vagy,
 * tehát a tök derékig ér — és ez a poén. A kúriában viszont EMBER vagy, és
 * egy derékig érő tököt nem zsebre tesz az ember, hanem targoncával visz
 * el. Harmincöt centi: kézbe való.
 */
export const CANDY_HEIGHT_HUMAN = 0.35;

/** Above this, in model units, something is a wall rather than furniture. */
const WALL_RISE = 0.20;
/** Below this, the floor. */
const FLOOR_RISE = 0.005;

export class VillageHouse implements HouseWorld {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  /** Nothing in this house is ghost-passable yet; kept for the shared API. */
  readonly gateColliders: THREE.Box3[] = [];
  /**
   * Deliberately empty: line of sight is answered by `sightBlocked` against the
   * grid instead. The flat is ONE 200k-triangle mesh, and three.js raycasts it
   * triangle by triangle — asking it "can he see them" twice a frame would cost
   * more than everything else in the scene put together.
   */
  readonly occluders: THREE.Mesh[] = [];
  readonly spawns: THREE.Vector3[] = [];
  readonly patrolWaypoints: THREE.Vector3[] = [];
  readonly homeownerSpawn = new THREE.Vector3();
  readonly candySpots: CandySpot[] = [];
  readonly prankSpots: PrankSpot[] = [];
  /** Back out of the front door, together. */
  readonly exitZone = new THREE.Vector3();
  exitRadius = 9;

  /** The cut that takes the tops off the walls; see WALL_DRAW_HEIGHT. */
  private readonly lid = new THREE.Plane(new THREE.Vector3(0, -1, 0), WALL_DRAW_HEIGHT);
  private wallHeight = WALL_DRAW_HEIGHT;
  private readonly nav: HouseNav;
  private readonly n: number;
  /**
   * Metres per grid cell — separately per axis.
   *
   * The grid is N x N cells over a bounding box that is NOT square: this flat
   * is 1.884 wide and 1.840 deep. Using one cell size for both put every
   * lookup up to a cell out along Z, which was enough to place the players'
   * spawn inside the front wall and leave the whole flat unreachable.
   */
  private readonly cellX: number;
  private readonly cellZ: number;
  private readonly originX: number;
  private readonly originZ: number;

  private constructor(scene: THREE.Object3D | null, nav: HouseNav) {
    // What can be walked under depends on how tall a player is, so the grid is
    // measured FOR a scale. Silently using it at another one is how you get a
    // flat whose doorways are the wrong size by exactly the ratio between them.
    if (nav.scale !== undefined && Math.abs(nav.scale - HOUSE1_SCALE) > 0.01) {
      throw new Error(
        `a ház rácsa ${nav.scale}-es léptékre készült, a játék ${HOUSE1_SCALE}-öt használ — futtasd újra a tools/house-nav.py-t`
      );
    }
    this.nav = nav;
    this.n = nav.n;
    this.cellX = ((nav.max[0] - nav.min[0]) / nav.n) * HOUSE1_SCALE;
    this.cellZ = ((nav.max[1] - nav.min[1]) / nav.n) * HOUSE1_SCALE;
    this.originX = nav.min[0] * HOUSE1_SCALE;
    this.originZ = nav.min[1] * HOUSE1_SCALE;

    if (scene) {
      // Slice the wall tops off — see WALL_DRAW_HEIGHT. The plane is in world
      // space, so it is applied after the scaling below.
      const lid = this.lid;
      scene.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = mesh.material as THREE.Material;
        material.clippingPlanes = [lid];
        // The walls are hollow shells. Cut one and you are looking at its
        // inside, which renders as a hole unless both faces are drawn.
        material.side = THREE.DoubleSide;
        material.needsUpdate = true;
      });
      scene.scale.setScalar(HOUSE1_SCALE);
      // Put the floor at y = 0, where every other system in the game expects
      // the ground to be.
      scene.position.y = -nav.floorZ * HOUSE1_SCALE;
      this.group.add(scene);
    }

    this.buildColliders();
    this.placeGameplay();
  }

  /**
   * A házak, amiket a falu kínál.
   *
   * Három, és mindegyik MÁS JÁTÉKOT ad — nem díszletváltás:
   *
   *   1 — a lakás: hét szoba folyosóval összekötve. Kiegyensúlyozott: mindig
   *       van kerülőút, a lakó mindig megkerülhető.
   *   2 — a folyosós ház: egyetlen hosszú, egyenes látóvonal, öt szobával
   *       kétoldalt. Itt a RÁLÁTÁS a veszély — és ez lesz a sötét pálya.
   *   3 — a gyűrűs ház: kilenc szoba körben, egy középsővel. Körbe lehet
   *       futni, ezért bír el KÉT üldözőt anélkül, hogy igazságtalan lenne.
   */
  static readonly HOUSES = ['house1', 'house2', 'house3'] as const;

  /**
   * Melyik ház jön SORRENDBEN — a hányadik házba lépsz be, nem melyik telekre.
   *
   * Eddig a telek sorszáma döntött (`telek % 3`), a telket viszont a `Session`
   * a maradékból sorsolja: a gyakorlatban tehát véletlen volt, melyik belsőt
   * kapod, és a második estéd kezdődhetett a gyűrűs házzal. A három belső nem
   * három díszlet, hanem három NEHÉZSÉG — a lakás tanít, a folyosós ház a
   * rálátásra kérdez rá, a gyűrűs bír el két üldözőt —, és egy tanmenetnek
   * sorrendje van.
   *
   * A negyedik háztól elölről indul. Nem visszalépés: addigra a lakást már a
   * saját tempódban járod, és a ház ugyanaz, a cukorkakvóta nem.
   */
  static pickInOrder(housesDone: number): string {
    return VillageHouse.HOUSES[housesDone % VillageHouse.HOUSES.length];
  }

  static async load(url = 'models/house1.json', navUrl = 'models/house1-nav.json'): Promise<VillageHouse> {
    const [scene, nav] = await Promise.all([loadMesh(url), fetchNav(navUrl)]);
    return new VillageHouse(scene, nav);
  }

  /** The playable flat without its art, for headless tests. */
  static fromNav(nav: unknown): VillageHouse {
    return new VillageHouse(null, nav as HouseNav);
  }

  // --- grid ----------------------------------------------------------------
  //
  // Same convention as the village: the grid was measured in Blender, where Y
  // is the axis glTF calls -Z, so a row index runs the opposite way to world Z.

  col(x: number): number {
    return Math.floor((x - this.originX) / this.cellX);
  }

  row(z: number): number {
    return Math.floor((-z - this.originZ) / this.cellZ);
  }

  worldX(i: number): number {
    return this.originX + (i + 0.5) * this.cellX;
  }

  worldZ(j: number): number {
    return -(this.originZ + (j + 0.5) * this.cellZ);
  }

  private inside(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.n && j < this.n;
  }

  get gridSize(): number {
    return this.n;
  }

  /** The smaller of the two cell sizes, for anything that wants one number. */
  get cell(): number {
    return Math.min(this.cellX, this.cellZ);
  }

  /** How far the geometry here stands above the floor, in MODEL units. */
  private rise(i: number, j: number): number | null {
    if (!this.inside(i, j)) return null;
    const h = this.nav.height[j][i];
    return h === null ? null : h - this.nav.floorZ;
  }

  solidAt(i: number, j: number): boolean {
    return !this.inside(i, j) || this.nav.solid[j][i] === '1';
  }

  /**
   * Which room, by the segmenter's numbering. 0 is "not a room".
   *
   * Ids are base-36 characters in the grid, so a flat may have up to
   * thirty-five rooms without the file growing a second character per cell.
   */
  roomAt(x: number, z: number): number {
    const i = this.col(x);
    const j = this.row(z);
    if (!this.inside(i, j)) return 0;
    return parseInt(this.nav.rooms[j][i], 36) || 0;
  }

  /**
   * The room a point belongs to, looking a little way around if the point
   * itself is in a wall or a doorway.
   *
   * A player standing in a doorway is in neither room by the grid's reckoning,
   * and a camera that reads 0 there cuts to nothing for the two steps it takes
   * to walk through. Falling back to the nearest labelled cell keeps the view
   * on whichever room the player is mostly inside.
   */
  roomNear(x: number, z: number): number {
    const direct = this.roomAt(x, z);
    if (direct) return direct;
    const i = this.col(x);
    const j = this.row(z);
    for (let r = 1; r <= 12; r++) {
      for (let b = -r; b <= r; b++) {
        for (let a = -r; a <= r; a++) {
          if (Math.max(Math.abs(a), Math.abs(b)) !== r) continue;
          if (!this.inside(i + a, j + b)) continue;
          const id = parseInt(this.nav.rooms[j + b][i + a], 36) || 0;
          if (id) return id;
        }
      }
    }
    return 0;
  }

  /**
   * The room's extent in world space, padded out to take in its walls.
   *
   * The segmenter labels FLOOR, so a room's cells stop at the skirting; the
   * walls that make it a room are just outside. Framing the bare floor would
   * cut the walls off at the edge of the screen and the room would read as a
   * carpet.
   */
  /**
   * A HÁZ BEFOGLALÓJA a világban.
   *
   * A megrajzolt alaprajz (`HousePlan`) 0 és 1 közötti arányokban beszél —
   * ez fordítja le világkoordinátára. A nav fájl határaiból jön, nem a
   * meshek befoglalójából: a tető és az eresz túlnyúlik a padlón, és egy
   * eresz alá tett cukorka a falon kívül volna.
   */
  get bounds(): { minX: number; maxX: number; minZ: number; maxZ: number } {
    return {
      minX: this.nav.min[0] * HOUSE1_SCALE,
      maxX: this.nav.max[0] * HOUSE1_SCALE,
      // A Z tengely a rácsé ellen fut, tehát a két szélső érték helyet cserél.
      minZ: -this.nav.max[1] * HOUSE1_SCALE,
      maxZ: -this.nav.min[1] * HOUSE1_SCALE,
    };
  }

  roomBounds(id: number): THREE.Box3 | null {
    const info = this.nav.roomInfo.find((r) => r.id === id);
    if (!info) return null;
    const pad = this.cell * 8;
    // The Z axis runs opposite to the grid's, so the min and max swap.
    return new THREE.Box3(
      new THREE.Vector3(
        info.min[0] * HOUSE1_SCALE - pad,
        0,
        -info.max[1] * HOUSE1_SCALE - pad
      ),
      new THREE.Vector3(
        info.max[0] * HOUSE1_SCALE + pad,
        this.wallHeight,
        -info.min[1] * HOUSE1_SCALE + pad
      )
    );
  }

  /**
   * Clipping planes that hide everything outside one room.
   *
   * Négy oldal és egy fedél — de a négy oldal NEM egyforma.
   *
   * A kamerához közeli oldalon beljebb vágunk, a fal belsejénél: így az a fal,
   * ami közted és a szoba között állna, eltűnik, ahogy a Simsben. A túloldali
   * falak a helyükön maradnak, különben a szoba nem szobának, hanem lebegő
   * padlódarabnak látszana.
   *
   * Világkoordinátás síkok, panelenként alkalmazva: ha ketten két szobában
   * vagytok, a képernyő két felének más síkok kellenek — és mivel a kamera
   * iránya is számít, a `Q` gombbal forgatva a bontott fal is átvált a másik
   * oldalra.
   */
  roomClipPlanes(id: number, toCamera?: THREE.Vector3): THREE.Plane[] {
    const box = this.roomBounds(id);
    if (!box) return [this.lid];

    // A befoglaló a falakkal EGYÜTT jön (`roomBounds` kipárnázza), tehát a
    // külső él a fal külseje, a belső él (külső ± pad) a fal belseje.
    const planes: THREE.Plane[] = [this.lid];
    const pad = this.cell * 8;
    const dx = toCamera ? toCamera.x : 0;
    const dz = toCamera ? toCamera.z : 0;
    const SIDE = 0.15; // ennél laposabb komponensnél nincs "közeli" oldal

    // Melyik oldalon ÜL a kamera — az azon az oldalon lévő fal áll közted és a
    // szoba között, tehát azt bontjuk le. A többi marad, különben a szoba nem
    // szoba, hanem lebegő padlódarab.
    const cameraOnPlusX = dx > SIDE;
    const cameraOnMinusX = dx < -SIDE;
    const cameraOnPlusZ = dz > SIDE;
    const cameraOnMinusZ = dz < -SIDE;

    // A vágósík azt az oldalt tartja meg, amerre a normálisa MUTAT:
    // normális·p + konstans > 0 marad látható.
    //   (1,0,0) normális, konstans -C  ->  x > C marad
    //  (-1,0,0) normális, konstans  C  ->  x < C marad
    const keepAbove = (axis: 'x' | 'z', value: number) =>
      new THREE.Plane(axis === 'x' ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1), -value);
    const keepBelow = (axis: 'x' | 'z', value: number) =>
      new THREE.Plane(axis === 'x' ? new THREE.Vector3(-1, 0, 0) : new THREE.Vector3(0, 0, -1), value);

    planes.push(keepAbove('x', cameraOnMinusX ? box.min.x + pad : box.min.x));
    planes.push(keepBelow('x', cameraOnPlusX ? box.max.x - pad : box.max.x));
    planes.push(keepAbove('z', cameraOnMinusZ ? box.min.z + pad : box.min.z));
    planes.push(keepBelow('z', cameraOnPlusZ ? box.max.z - pad : box.max.z));
    return planes;
  }

  /**
   * How tall the walls may be DRAWN, given where the camera sits.
   *
   * A kamera `távolság * sin(szög)` magasan van a padló fölött. Bármi, amit
   * ennél magasabbra rajzolunk, közte és a játékosok közt áll, tehát a falnak
   * alatta kell megállnia — ráhagyással, mert egy pont szemmagasságban lévő
   * fal is elveszi a kép alját. A valódi falmagasságnál megállítva: nincs
   * értelme több falat rajzolni, mint amennyi van.
   */
  /**
   * A fal TELJES magassága, vágás nélkül.
   *
   * Belső nézetben ez kell: a levágott falkorona fölött a szomszéd szobába
   * látni, és a lopakodásból nem marad semmi. A szám ugyanaz, amit a
   * `wallHeightFor` felső korlátként használ — egy helyen él, hogy ne tudjon
   * elcsúszni tőle.
   */
  static get fullWallHeight(): number {
    return 0.45 * HOUSE1_SCALE;
  }

  static wallHeightFor(pitch: number, distance: number): number {
    const real = 0.45 * HOUSE1_SCALE;
    // Az osztó 1,3 volt, és az csak arra volt elég, hogy a fal ne álljon
    // pontosan szemmagasságban. Lemérve viszont egy 14 egység magas fal még
    // 4,5 egységgel a játékos MÖGÖTT is árnyékot vetett rá — a Sims-féle
    // bontás a közeli falat elviszi, a túloldalit nem. 1,7-tel a falkorona
    // ugyanezen a szögön 9,9 egység, és az árnyék 3 egységre esik vissza.
    return Math.min(real, (distance * Math.sin(pitch)) / 1.7);
  }

  /** Elmozdítja a vágást. A szoba oldalsíkjai ugyanezt a síkot használják. */
  setWallHeight(height: number): void {
    this.wallHeight = height;
    this.lid.constant = height;
  }

  /** Every room's id, biggest first. */
  get roomIds(): number[] {
    return [...this.nav.roomInfo].sort((a, b) => b.cells - a.cells).map((r) => r.id);
  }

  /**
   * Can he see from here to there?
   *
   * A straight walk over the grid, stopping at the first solid cell. At this
   * scale everything solid blocks sight — the players are small enough that the
   * back of a sofa is a wall — which is exactly the hiding the house section is
   * built on, and it comes out of the same grid the collision does, so what
   * looks like cover IS cover.
   */
  sightBlocked(from: THREE.Vector3, to: THREE.Vector3): boolean {
    let i = this.col(from.x);
    let j = this.row(from.z);
    const ti = this.col(to.x);
    const tj = this.row(to.z);

    const di = Math.abs(ti - i);
    const dj = Math.abs(tj - j);
    const si = i < ti ? 1 : -1;
    const sj = j < tj ? 1 : -1;
    let err = di - dj;

    // Bounded: a ray across the whole flat is 320 cells, and a runaway loop in
    // an AI's sight test is a frozen frame, not a wrong answer.
    for (let guard = 0; guard < this.n * 2; guard++) {
      if (i === ti && j === tj) return false;
      const e2 = 2 * err;
      if (e2 > -dj) { err -= dj; i += si; }
      if (e2 < di) { err += di; j += sj; }
      if (i === ti && j === tj) return false;
      if (this.solidAt(i, j)) return true;
    }
    return false;
  }

  // --- collision -----------------------------------------------------------

  /**
   * Merge the solid cells into as few boxes as possible — but merge furniture
   * and walls SEPARATELY.
   *
   * One pass over everything solid would run a sofa and the wall behind it into
   * a single slab and take the wall's height, turning a piece of cover you can
   * see over into a partition. Two passes keep a worktop a worktop.
   *
   * WHAT IS SOLID comes from the navigation grid, not from the height map, and
   * the difference is the whole ballgame. Every doorway in this flat has a
   * header over it, so from above a doorway is as tall as the wall around it —
   * build the boxes from height and you brick up every door in the place.
   * That is exactly what happened: 3359 cells the grid called walkable were
   * inside a collider, and the players could not leave the room they started
   * in. The height map is still used, but only to decide how TALL each box is.
   */
  private buildColliders(): void {
    for (const tall of [false, true]) {
      this.mergeBand(tall);
    }
  }

  private mergeBand(tall: boolean): void {
    const n = this.n;
    const inBand = (i: number, j: number): boolean => {
      if (!this.solidAt(i, j)) return false;
      const r = this.rise(i, j);
      if (r === null) return tall; // a hole in the mesh is treated as wall
      if (r <= FLOOR_RISE) return tall; // solid but flat: a threshold, treat as wall
      return tall ? r >= WALL_RISE : r < WALL_RISE;
    };

    const used = new Uint8Array(n * n);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (used[j * n + i] || !inBand(i, j)) continue;

        let w = 1;
        while (i + w < n && inBand(i + w, j) && !used[j * n + i + w]) w++;

        let h = 1;
        grow: while (j + h < n) {
          for (let k = 0; k < w; k++) {
            if (!inBand(i + k, j + h) || used[(j + h) * n + i + k]) break grow;
          }
          h++;
        }

        const wallH = this.nav.wallTop - this.nav.floorZ;
        let peak = 0;
        for (let b = 0; b < h; b++) {
          for (let a = 0; a < w; a++) {
            used[(j + b) * n + i + a] = 1;
            peak = Math.max(peak, this.rise(i + a, j + b) ?? wallH);
          }
        }

        // A harmadik ház „kivágott" modell: a falai csak 8 egységre érnek fel,
        // a dupla ugrás viszont 12,6 — ott ki lehetne ugrani a szobából. Ami
        // falmagasságig ér, annak az ÜTKÖZŐJÉT felhúzzuk WALL_COLLIDER_MIN-ig.
        // Csak az ütközőt: a rajz marad, a ház ugyanúgy néz ki. A bútorokat
        // nem érinti, különben nem lehetne rájuk állni.
        let top = peak * HOUSE1_SCALE;
        if (peak >= wallH * 0.95) top = Math.max(top, WALL_COLLIDER_MIN);

        const x0 = this.originX + i * this.cellX;
        const z1 = -(this.originZ + j * this.cellZ);
        const z0 = z1 - h * this.cellZ;
        this.colliders.push(
          new THREE.Box3(
            new THREE.Vector3(x0, 0, z0),
            new THREE.Vector3(x0 + w * this.cellX, top, z1)
          )
        );
      }
    }
  }

  // --- content -------------------------------------------------------------

  private at(p: [number, number], y = 0): THREE.Vector3 {
    return new THREE.Vector3(p[0] * HOUSE1_SCALE, y, -p[1] * HOUSE1_SCALE);
  }

  /**
   * Járható-e ez a világpont, a megadott sugarú testtel?
   *
   * A LAKÓNAK kell, és eddig hiányzott: a járőrözés egyenesen a
   * célpont felé lépkedett, ütközés nélkül. A falakon ATTÓL ment át, hogy
   * senki nem kérdezte meg tőle, van-e ott fal — a játékos a saját
   * ütközésvizsgálatát kapta, a lakó semmit.
   */
  /**
   * Véletlen pont, ahol a test ELFÉR.
   *
   * A fegyverek és a cukorka eddig néhány rögzített helyre kerültek (a
   * járőrpontokra és a tálakhoz), tehát minden kör ugyanott kezdődött: a
   * játékos két menet után fejből tudta, hova kell futni. Véletlen helyekkel
   * a keresés is része a játéknak.
   *
   * @param avoid Pontok, amiktől távol kell maradni — a gyűjtősarkok. Egy
   * sarokban termő fegyver azt jelentené, hogy aki hazaér, ingyen kap
   * egyet; a sarokban termő cukorka pedig már eleve be volna hordva.
   */
  randomStanding(
    random: () => number,
    radius: number,
    avoid: readonly THREE.Vector3[] = [],
    avoidRadius = 8
  ): THREE.Vector3 | null {
    for (let tries = 0; tries < 60; tries++) {
      const i = Math.floor(random() * this.nav.n);
      const j = Math.floor(random() * this.nav.n);
      if (!this.inside(i, j) || !this.clearFor(i, j, radius)) continue;
      const at = new THREE.Vector3(this.worldX(i), 0, this.worldZ(j));
      if (avoid.some((a) => a.distanceTo(at) < avoidRadius)) continue;
      return at;
    }
    return null;
  }

  walkable(x: number, z: number, radius: number): boolean {
    const i = this.col(x);
    const j = this.row(z);
    if (!this.inside(i, j)) return false;
    return this.clearFor(i, j, radius);
  }

  /**
   * ÚTVONAL két pont között, egy adott testmérettel.
   *
   * Eddig nem volt útkeresés: az üldözők egyenesen nekiindultak a célnak, és
   * ha fal volt közben, a fal mentén csúsztak. Egy szobákra osztott lakásban
   * ez nem elég — mérve a lakó hatvan másodperc alatt huszonegy egységet tett
   * meg egy hatvannyolc egység széles házban, mert minden ajtófélfa megállította.
   *
   * Szélességi kereséssel megy, egy RITKÍTOTT rácson: a 384×384-es hálóból
   * minden negyedik cella, vagyis 96×96 = 9216 csomópont. Ez azért elég, mert
   * a ritkított cella (0,85 egység) nagyjából akkora, mint az üldöző maga —
   * finomabb felbontással a keresés nem lenne pontosabb, csak drágább.
   *
   * A járhatóságot testméretenként CACHE-eljük: a lakó és a kutya két külön
   * térkép, és mindkettő egyszer épül fel.
   */
  route(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3[] {
    const step = 4;
    const w = Math.ceil(this.n / step);
    const pass = this.passable(radius, step, w);

    const cell = (p: THREE.Vector3): number => {
      const i = Math.min(w - 1, Math.max(0, Math.floor(this.col(p.x) / step)));
      const j = Math.min(w - 1, Math.max(0, Math.floor(this.row(p.z) / step)));
      return j * w + i;
    };
    const start = cell(from);
    let goal = cell(to);
    if (!pass[start]) return [];
    // A cél lehet a falban (egy zaj a szomszéd szobából): ilyenkor a
    // legközelebbi járható csomópont a cél. Enélkül a keresés hiába fut le.
    if (!pass[goal]) {
      let best = -1;
      let bestD = Infinity;
      const gx = goal % w;
      const gy = (goal / w) | 0;
      for (let k = 0; k < pass.length; k++) {
        if (!pass[k]) continue;
        const d = (k % w - gx) ** 2 + (((k / w) | 0) - gy) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best < 0) return [];
      goal = best;
    }
    if (start === goal) return [];

    const prev = new Int32Array(pass.length).fill(-1);
    const queue = new Int32Array(pass.length);
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    prev[start] = start;
    let found = false;
    while (head < tail) {
      const at = queue[head++];
      if (at === goal) { found = true; break; }
      const x = at % w;
      const y = (at / w) | 0;
      for (let b = -1; b <= 1; b++) {
        for (let a = -1; a <= 1; a++) {
          if (a === 0 && b === 0) continue;
          const nx = x + a;
          const ny = y + b;
          if (nx < 0 || ny < 0 || nx >= w || ny >= w) continue;
          const to2 = ny * w + nx;
          if (prev[to2] !== -1 || !pass[to2]) continue;
          // Átlósan csak akkor, ha a sarok mindkét oldala nyitva: enélkül az
          // út átvágna egy ajtófélfa sarkán, ahol a test nem fér el.
          if (a !== 0 && b !== 0 && (!pass[y * w + nx] || !pass[ny * w + x])) continue;
          prev[to2] = at;
          queue[tail++] = to2;
        }
      }
    }
    if (!found) return [];

    const path: THREE.Vector3[] = [];
    for (let at = goal; at !== start; at = prev[at]) {
      const x = at % w;
      const y = (at / w) | 0;
      path.push(new THREE.Vector3(this.worldX(x * step + step / 2), 0, this.worldZ(y * step + step / 2)));
      if (path.length > 4096) break;
    }
    path.reverse();
    return path;
  }

  private readonly passableCache = new Map<string, Uint8Array>();

  private passable(radius: number, step: number, w: number): Uint8Array {
    const key = `${radius.toFixed(2)}:${step}`;
    const cached = this.passableCache.get(key);
    if (cached) return cached;
    const map = new Uint8Array(w * w);
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        const ci = i * step + (step >> 1);
        const cj = j * step + (step >> 1);
        map[j * w + i] = this.inside(ci, cj) && this.clearFor(ci, cj, radius) ? 1 : 0;
      }
    }
    this.passableCache.set(key, map);
    return map;
  }

  /** Is there `metres` of clear floor all round this cell? */
  private clearFor(i: number, j: number, metres: number): boolean {
    const reach = Math.ceil(metres / Math.min(this.cellX, this.cellZ));
    for (let b = -reach; b <= reach; b++) {
      for (let a = -reach; a <= reach; a++) if (this.solidAt(i + a, j + b)) return false;
    }
    return true;
  }

  /** Does a player's whole body fit on this cell, with a little to spare? */
  private bodyFits(i: number, j: number): boolean {
    return this.clearFor(i, j, MOVE.radius * 1.3);
  }

  /**
   * Walk inwards from the doorway until both players actually fit.
   *
   * The measured door position is a point ON the threshold, one cell off the
   * front wall — fine as a landmark, useless as a spawn, because a player has a
   * body and it does not fit there. Deciding this here rather than in the
   * exporter is deliberate: only the game knows how big a player is, and the
   * two drifting apart is what put the players inside the wall the first time.
   */
  private findSpawns(door: THREE.Vector3): THREE.Vector3[] {
    const centre = new THREE.Vector3(
      ((this.nav.min[0] + this.nav.max[0]) / 2) * HOUSE1_SCALE,
      0,
      -((this.nav.min[1] + this.nav.max[1]) / 2) * HOUSE1_SCALE
    );
    const inward = new THREE.Vector3().subVectors(centre, door).setY(0).normalize();
    const sideways = new THREE.Vector3(-inward.z, 0, inward.x);
    void centre;

    // Far enough in to be standing in a ROOM.
    //
    // "The first spot the bodies fit" put both players in the door frame, in a
    // slot a metre and a half wide: the shared camera jams to its closest
    // framing, both monsters fill the screen, and the only thing behind them is
    // a slab of white wall. You cannot tell where you are, and it does not look
    // like a house.
    //
    // Walking a straight line inwards does not fix it either — this flat's
    // door opens onto the end of a hall, so the line hugs the wall the whole
    // way. So: search the floor for the CLOSEST cell to the door with real
    // elbow room around it, wherever that turns out to be.
    const ROOMY = 3.5;
    const di = this.col(door.x);
    const dj = this.row(door.z);
    let bestCell: [number, number] | null = null;
    let bestDistance = Infinity;
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const d = (i - di) ** 2 + (j - dj) ** 2;
        if (d >= bestDistance) continue;
        if (!this.clearFor(i, j, ROOMY)) continue;
        bestDistance = d;
        bestCell = [i, j];
      }
    }

    if (bestCell) {
      const at = new THREE.Vector3(this.worldX(bestCell[0]), 0, this.worldZ(bestCell[1]));
      // Side by side, across the line back to the door, so the camera opens on
      // the pair with the room behind them.
      const back = new THREE.Vector3().subVectors(door, at).setY(0).normalize();
      const across = new THREE.Vector3(-back.z, 0, back.x);
      // Spread them apart, but only onto ground that is itself open. Checking
      // that the two bodies merely FIT put one player half a metre from a wall
      // with the camera jammed against it; what the camera needs is that the
      // pair, and the space around them, is clear.
      for (const spread of [3.5, 2.5, 1.5]) {
        const a = at.clone().addScaledVector(across, -spread);
        const b = at.clone().addScaledVector(across, spread);
        if (
          this.clearFor(this.col(a.x), this.row(a.z), ROOMY * 0.6) &&
          this.clearFor(this.col(b.x), this.row(b.z), ROOMY * 0.6)
        ) {
          return [a, b];
        }
      }
      // One behind the other down the middle of whatever this is, which is at
      // least somewhere with room around it.
      return [
        at.clone().addScaledVector(back, -1.2),
        at.clone().addScaledVector(back, 1.2),
      ];
    }

    // Nowhere in this house is that open; fall back to the old rule.
    for (let step = 0; step < 90; step++) {
      const along = door.clone().addScaledVector(inward, step * this.cell);
      // Side by side if there is room, single file if the hall is narrow — a
      // wide spawn opens the shared camera at its furthest framing, but not at
      // the cost of standing someone in a wall.
      for (const spread of [3.5, 2.5, 1.5]) {
        const a = along.clone().addScaledVector(sideways, -spread);
        const b = along.clone().addScaledVector(sideways, spread);
        if (this.bodyFits(this.col(a.x), this.row(a.z)) && this.bodyFits(this.col(b.x), this.row(b.z))) {
          return [a, b];
        }
      }
      // A narrow hall: stand one behind the other rather than both on the same
      // spot, which is what the first version did and which spawns two players
      // inside each other.
      const behind = along.clone().addScaledVector(inward, -2.5);
      if (this.bodyFits(this.col(along.x), this.row(along.z)) &&
          this.bodyFits(this.col(behind.x), this.row(behind.z))) {
        return [along, behind];
      }
    }
    return [door.clone(), door.clone()];
  }

  /**
   * A legközelebbi pont, ahol egy szörny elfér.
   *
   * Spirálban keres kifelé, de a `toward` irányt előnyben részesíti — így egy
   * küszöbnél a HÁZ FELÉ lép be, nem a fal túloldalára.
   */
  /**
   * A legközelebbi pont, ahol egy test ELFÉR.
   *
   * Nyilvános, mert nem csak a kijárat kijelölésének kell: egy sarokba
   * szorult üldözőt is ezzel lehet kiszabadítani.
   */
  nearestStanding(
    from: THREE.Vector3,
    toward: THREE.Vector3,
    /**
     * KINEK keresünk helyet.
     *
     * Ez hiányzott, és emiatt állt a lakó: a keresés mindig a JÁTÉKOS
     * méretével nézte, elfér-e valahol, a lakó viszont több mint kétszer
     * olyan széles. Kapott egy pontot, ahol egy szörny elfér, ő nem — és
     * mivel a kezdőpontja is ilyen volt, el sem indult.
     */
    radius = MOVE.radius * 1.3
  ): THREE.Vector3 {
    if (this.clearFor(this.col(from.x), this.row(from.z), radius)) return from.clone();

    const inward = toward.clone().sub(from).setY(0);
    if (inward.lengthSq() > 1e-6) inward.normalize();

    for (let step = 1; step <= 40; step++) {
      const reach = step * Math.min(this.cellX, this.cellZ);
      // Előbb befelé, aztán körbe: a küszöb belső oldala a helyes válasz.
      const biased = from.clone().addScaledVector(inward, reach);
      if (this.clearFor(this.col(biased.x), this.row(biased.z), radius)) return biased;

      for (let k = 0; k < 12; k++) {
        const angle = (k / 12) * Math.PI * 2;
        const at = new THREE.Vector3(
          from.x + Math.sin(angle) * reach,
          0,
          from.z + Math.cos(angle) * reach
        );
        if (this.clearFor(this.col(at.x), this.row(at.z), radius)) return at;
      }
    }
    return from.clone();
  }

  private placeGameplay(): void {
    // A KIJÁRAT az ajtó, a RAJT a ház belseje — két külön pont.
    //
    // A kód mindkettőre a `spawn` cellát használta, és a saját kommentje
    // mondta ki, hogy ez rossz: „a DOOR-on mész ki, nem ott, ahol a pár
    // véletlenül elindult". Az első lakásnál ez nem tűnt fel, mert a tornác
    // miatt a rajt amúgy is kilenc méterre esett. A két új háznál viszont
    // a kettő négy méterre került egymástól — a kijárat sugara nyolc, tehát
    // a szakasz abban a pillanatban véget ért volna, ahogy elkezdődik.
    const entrance = this.at(this.nav.door ?? this.nav.porch);
    const inside = this.at(this.nav.spawn ?? this.nav.door ?? this.nav.porch);
    this.spawns.push(...this.findSpawns(inside));

    // A kijáratban MEG IS KELL TUDNI ÁLLNI.
    //
    // Az első lakásnál az ajtó egy nyílás volt, tehát a cellája járható. A
    // két új háznál viszont csukott ajtólap van a modellen — az ajtó cellája
    // FAL. A kijárat így olyan pontra került, ahova nem lehet odaállni, és a
    // szakaszt nem lehetett volna befejezni.
    //
    // A javítás nem az ajtó elmozdítása, hanem a legközelebbi hely, ahol egy
    // szörny elfér: a küszöb belső oldala. A kijárat marad a bejáratnál,
    // csak épp ott, ahol létezik padló.
    this.exitZone.copy(this.nearestStanding(entrance, inside));
    this.exitRadius = 8;

    // A LAKÓ PONTJAIT az Ő testére igazítjuk, nem a játékoséra.
    //
    // A nav fájl pontjai a rácsból jönnek, ahol a méret nem számít. A lakó
    // 2,2 egység széles — a játékos 0,9 —, tehát egy tökéletesen jó
    // járőrpont az ő számára lehet a kanapé és a fal közti rés. Mérve: 60
    // másodperc alatt NULLA egységet tett meg mind a három házban, mert már a
    // kezdőpontján sem fért el, és onnan nem volt hova lépnie.
    const centre = new THREE.Vector3(
      ((this.nav.min[0] + this.nav.max[0]) / 2) * HOUSE1_SCALE,
      0,
      -((this.nav.min[1] + this.nav.max[1]) / 2) * HOUSE1_SCALE
    );
    const forBody = (p: THREE.Vector3): THREE.Vector3 =>
      this.nearestStanding(p, centre, HOMEOWNER.width * 0.5);

    this.homeownerSpawn.copy(forBody(this.at(this.nav.homeowner)));
    for (const p of this.nav.patrol) this.patrolWaypoints.push(forBody(this.at(p)));

    for (const c of this.nav.candy) {
      const position = this.at(c.at, this.candyHeight * 0.5);
      // A placeholder that the real bucket replaces once it loads. It is not
      // wasted: the house can start before a 0.9 MB model has arrived, and a
      // sweet that is not there yet is a sweet the players walk past.
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(this.candyHeight * 0.4, 0),
        new THREE.MeshStandardMaterial({
          color: 0xffc24a,
          emissive: 0xff8a1f,
          emissiveIntensity: 0.75,
          roughness: 0.35,
        })
      );
      mesh.position.copy(position);
      mesh.castShadow = true;
      this.group.add(mesh);
      this.candySpots.push({ position: position.clone(), mesh, taken: false, value: c.reward });
    }
    void this.dressCandy();

    const labels = ['HŰTŐMÁGNES-LAVINA', 'EDÉNYTORONY', 'KÖNYVLAVINA'];
    this.nav.pranks.forEach((p, index) => {
      const position = this.at(p.at, 2.6);
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(2.4, 0.7, 8, 18),
        new THREE.MeshStandardMaterial({
          color: 0x6ef0c0,
          emissive: 0x2fd39a,
          emissiveIntensity: 0.8,
          roughness: 0.4,
        })
      );
      mesh.position.copy(position);
      this.group.add(mesh);
      this.prankSpots.push({
        position: position.clone(),
        mesh,
        label: labels[index % labels.length],
        cooldown: 0,
      });
    });
  }

  /**
   * Swap the placeholder sweets for the real pumpkin buckets.
   *
   * Loaded once and cloned, and deliberately NOT cel-shaded: the bucket is a
   * sculpt with painted sweets in it, and flattening it to three bands of one
   * colour throws away the only thing that makes it read as a prize rather
   * than as a lump.
   */
  /**
   * A CUKORKÁK ÁTHELYEZÉSE a megrajzolt alaprajz szerint.
   *
   * A ház nav fájlja öt cukorkahelyet hoz magával, és azok a KOOPERATÍV
   * körhöz valók: ahol a tál a lakásban állna. A fogó viszont más játék —
   * ott az számít, melyik szobában terem, mert a szoba a térfél. A rajz
   * nyolc helyet ad, tehát a meglévőket áthelyezzük, és amennyi hiányzik,
   * annyit klónozunk.
   *
   * A klón az ELSŐ cukorka másolata, nem új modell: így ha a tök már
   * megérkezett, a friss helyek is tököt kapnak, ha még nem, akkor mind a
   * nyolc a helykitöltőt — de sosem lesz belőlük vegyes.
   */
  /** A cukorka mérete ebben a házban. A kúria embermértékű. */
  candyHeight: number = CANDY_HEIGHT;

  placeCandy(positions: readonly THREE.Vector3[]): void {
    if (!positions.length) return;
    const sample = this.candySpots[0];
    while (this.candySpots.length > positions.length) {
      const extra = this.candySpots.pop();
      extra?.mesh.removeFromParent();
    }
    while (this.candySpots.length < positions.length && sample) {
      const mesh = sample.mesh.clone(true);
      this.group.add(mesh);
      this.candySpots.push({ position: new THREE.Vector3(), mesh, taken: false, value: sample.value });
    }
    this.candySpots.forEach((spot, i) => {
      const at = positions[i].clone();
      at.y = this.candyHeight * 0.5;
      spot.position.copy(at);
      spot.mesh.position.copy(at);
      spot.taken = false;
      spot.mesh.visible = true;
    });
  }

  private async dressCandy(): Promise<void> {
    try {
      for (const candy of this.candySpots) {
        const art = await models.instance('models/candy.json', { height: this.candyHeight });
        art.traverse((object) => {
          const mesh = object as THREE.Mesh;
          if (!mesh.isMesh) return;
          mesh.userData.cpKeepPBR = true;
          const material = mesh.material as THREE.MeshStandardMaterial;
          // A little glow of its own. The flat is lit by one torch; without
          // this the prize is a dark shape in a dark room.
          material.emissive = new THREE.Color(0xff7a1f);
          material.emissiveIntensity = 0.35;
          material.needsUpdate = true;
        });
        art.position.copy(candy.mesh.position);
        this.group.remove(candy.mesh);
        (candy.mesh.material as THREE.Material).dispose();
        candy.mesh.geometry.dispose();
        // The spot keeps a "mesh" because the game hides it on pickup; the
        // group standing in for it answers to the same three properties.
        candy.mesh = art as unknown as THREE.Mesh;
        this.group.add(art);
      }
    } catch (error) {
      // A missing bucket is not worth ending the night over: the placeholders
      // are still there and still pickable. Fejetlen próbában nincs `fetch`,
      // ezért ott ez a normális út — a teljes hibaobjektum kiírása csak zaj.
      const why = error instanceof Error ? error.message : String(error);
      console.warn(`a cukorka modell nem töltődött be: ${why}`);
    }
  }

  /** Spin the pickups so they read as interactive at a glance. */
  update(dt: number, elapsed: number): void {
    for (const c of this.candySpots) {
      if (c.taken) continue;
      c.mesh.rotation.y += dt * 1.4;
      c.mesh.position.y = c.position.y + Math.sin(elapsed * 2 + c.position.x) * 0.5;
    }
    for (const p of this.prankSpots) {
      p.cooldown = Math.max(0, p.cooldown - dt);
      p.mesh.rotation.z += dt * 2.2;
      (p.mesh.material as THREE.MeshStandardMaterial).emissiveIntensity = p.cooldown <= 0 ? 0.8 : 0.12;
    }
  }
}

async function fetchNav(url: string): Promise<HouseNav> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`a ház rácsa nem tölthető: ${url}`);
  return (await response.json()) as HouseNav;
}

async function loadMesh(url: string): Promise<THREE.Object3D> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`a ház nem tölthető: ${url}`);
  const wrapper = (await response.json()) as { glb: string };
  const binary = Uint8Array.from(atob(wrapper.glb), (c) => c.charCodeAt(0));
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.parseAsync(binary.buffer, '');
  await repairTextures(binary.buffer, gltf.scene);
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return gltf.scene;
}
