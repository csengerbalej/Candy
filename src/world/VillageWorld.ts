import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { repairTextures } from '../assets/textureRepair';
import type { HouseLot, RoadTile } from './TownWorld';
import type { DriveWorld } from './DriveWorld';

/**
 * The Meshy village, made drivable.
 *
 * This is one baked 220k-triangle mesh, not a kit of named parts, so none of
 * the old town's tricks apply: there are no asset names to tag colliders with,
 * no road tiles to test against, and no instancing to do. What there IS, is
 * geometry — and `tools/village-nav.py` measures it offline into a grid:
 *
 *   solid[]  what stands proud of the ground and must stop a car
 *   road[]   the carriageway, one kerb below the pavement
 *   height[] the ground under every cell
 *
 * Deriving collision from measurement rather than from names is a straight
 * upgrade. The old pipeline had to guess that `SM_Candy_Nature_Tree` meant
 * "shrink this box to a trunk"; here a tree is solid exactly where its trunk
 * occupies a cell, because that is where the mesh is.
 */

/** Village units → metres. */
export const VILLAGE_SCALE = 75;

interface NavData {
  min: [number, number, number];
  max: [number, number, number];
  n: number;
  cell: number;
  cellX?: number;
  cellZ?: number;
  groundY: number;
  widestHalfWidth: number;
  medianHalfWidth: number;
  road: string[];
  reachable: string[];
  solid: string[];
  height: Array<Array<number | null>>;
  start: [number, number];
  houses: Array<{ centre: [number, number]; stop: [number, number]; footprint: number; peak: number }>;
  /** A jelzőlámpás kereszteződések, a térképgenerátortól. */
  lights?: Array<{ centre: [number, number]; half: number; stop: number }>;
  /** A körpálya sugarai — ami közé esik, az autópálya, nem városi utca. */
  ring?: { inner: number; outer: number };
  /** Az utcarács, hogy az NPC forgalom sávokban tudjon menni. */
  grid?: { pitchX: number; pitchZ: number; count: number; street: number; builtX: number; builtZ: number };
}

const HOUSE_NAMES = [
  'SAROKHÁZ', 'KUTYÁS HÁZ', 'FUKAR HÁZ', 'KÍSÉRTETHÁZ',
  'CUKRÁSZ HÁZ', 'TÖKFARM', 'ÖREG MALOM', 'NÉMA HÁZ',
  'BOSZORKÁNYLAK', 'RÉZTETŐS HÁZ', 'KERTES HÁZ', 'ZSÚFOLT HÁZ',
  'HÁTSÓ HÁZ', 'SAROKHÁZ', 'NAGY HÁZ', 'UTOLSÓ HÁZ',
];

export class VillageWorld implements DriveWorld {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  /**
   * Deliberately empty. The old town shipped one asset name per collider so
   * the car could guess a tree from a house; these boxes are measured from the
   * mesh and are already the right shape, and the guesses would only make them
   * wrong. See `Car.colliderMode`.
   */
  readonly colliderAssets: string[] = [];
  readonly colliderMode = 'exact' as const;

  /**
   * Amin a kocsi ÁTHAJT: sövény, bokor, szegély.
   *
   * Külön listán, nem eldobva: a szörnyeknek és bárminek, ami később fedezéket
   * keres, ezek továbbra is tárgyak. Csak a kocsi hajt át rajtuk.
   */
  readonly soft: THREE.Box3[] = [];

  /** Efölött fal, alatta sövény. A mért szakadék 3,5 és 5 méter közt van. */
  private static readonly SOFT_TOP = 4;
  readonly gateColliders: THREE.Box3[] = [];
  readonly houses: HouseLot[] = [];

  /**
   * AUTÓPÁLYA-E ez a pont.
   *
   * A körpálya ugyanúgy „úttest", mint a városi utcák — a rács nem tud
   * különbséget tenni. A JÁTÉKNAK viszont tudnia kell: a szörnyecskék a
   * város utcáin kelnek át, és egy autópályán gyalogoló szörny nem
   * nehezítés, hanem hiba.
   *
   * A pálya helye nem mérés kérdése, hanem tervezői döntés — a
   * térképgenerátor írja ki, ez csak továbbadja.
   */
  onMotorway(x: number, z: number): boolean {
    const ring = this.nav.ring;
    if (!ring) return false;
    const r = Math.hypot(x, z) / VILLAGE_SCALE;
    return r > ring.inner - 0.02 && r < ring.outer + 0.02;
  }

  /** Az utcarács, ahogy a térkép megadta. `null`, ha régi falutérkép. */
  get streetGrid(): { pitchX: number; pitchZ: number; count: number; street: number; builtX: number; builtZ: number } | null {
    return this.nav.grid ?? null;
  }

  /** A lámpás kereszteződések, ahogy a térkép megadta őket. */
  get lightSpots(): Array<{ centre: [number, number]; half: number; stop: number }> {
    return this.nav.lights ?? [];
  }
  /**
   * The carriageway as coarse tiles, for the navigator's map and the critters.
   *
   * Neither of those wants a 384 x 384 grid — the map draws rectangles and the
   * critters pick somewhere to cross — so the grid is resampled into tiles a
   * few metres across. It is a VIEW of the road mask, never the thing the car
   * is tested against; `onRoad` always reads the full-resolution grid.
   */
  readonly roads: RoadTile[] = [];
  /** Side of one of those coarse tiles, in metres. */
  readonly tileSize: number;
  readonly spawns: THREE.Vector3[] = [];
  readonly carSpawn = new THREE.Vector3();
  carHeading = 0;
  lightHalos: THREE.InstancedMesh | null = null;
  haloAnchors: THREE.Vector3[] = [];
  readonly bounds: THREE.Box2;

  /** Half-width of the narrowest street the car has to fit down, in metres. */
  readonly laneHalfWidth: number;

  private readonly nav: NavData;
  private readonly n: number;
  /**
   * Méter per rácscella, TENGELYENKÉNT.
   *
   * Egyetlen szám addig volt helyes, amíg a falu négyzet alakú: akkor a két
   * tengely cellája ugyanakkora. Egy téglalap térképen viszont nem az, és egy
   * közös cellamérettel a rács Z irányban megnyúlik — a kocsi olyan falaknak
   * ütközik, amik nem ott vannak, ahol látszanak. A lakásnál ugyanez a hiba
   * már megtörtént (a rács ott sem négyzet), és ugyanígy oldottuk meg.
   */
  private readonly cellX: number;
  private readonly cellZ: number;
  private readonly originX: number;
  private readonly originZ: number;

  /**
   * `scene` is null in headless tests, which build the world from the nav grid
   * alone. Everything that decides how the village PLAYS — the colliders, the
   * road, the house stops — is derived from that grid and not from the mesh,
   * so a test without the 13 MB model still tests the real thing.
   */
  private constructor(scene: THREE.Object3D | null, nav: NavData) {
    this.nav = nav;
    this.n = nav.n;
    // A régebbi nav-fájlokban csak `cell` van; ott a két tengely egyenlő.
    this.cellX = (nav.cellX ?? nav.cell) * VILLAGE_SCALE;
    this.cellZ = (nav.cellZ ?? nav.cell) * VILLAGE_SCALE;

    // The grid was measured in Blender, the mesh is drawn in glTF, and the two
    // do not agree about Z.
    //
    // Blender's glTF importer maps glTF (x, y, z) to Blender (x, -z, y), so a
    // Blender Y of +0.5 is a game Z of -0.5. Mapping them straight across —
    // which is the obvious thing to write, and what this did at first — puts
    // the collision grid on the MIRROR IMAGE of the village: the car stops at
    // houses that are not there and drives through the ones that are.
    //
    // Nothing in the probes could catch it, because every one of them measures
    // the grid against itself. What caught it was comparing the glTF position
    // bounds with the grid's: z spanned [-0.9525, 0.9506] and Blender Y spanned
    // [-0.9506, 0.9525] — the same numbers, negated.
    //
    // So: game X is Blender X, and game Z is MINUS Blender Y. Every conversion
    // goes through `gridX`/`gridZ` and `worldX`/`worldZ` below, and nothing
    // else in this file is allowed to do the arithmetic itself.
    this.originX = nav.min[0] * VILLAGE_SCALE;
    this.originZ = nav.min[1] * VILLAGE_SCALE;

    if (scene) {
      scene.scale.setScalar(VILLAGE_SCALE);
      // Drop the carriageway to y = 0, so everything else in the game — spawn
      // heights, blob shadows, the camera's ground plane — keeps working
      // unchanged against a road at zero.
      scene.position.y = -nav.groundY * VILLAGE_SCALE;
      this.group.add(scene);
    }

    this.bounds = new THREE.Box2(
      new THREE.Vector2(nav.min[0] * VILLAGE_SCALE, -nav.max[1] * VILLAGE_SCALE),
      new THREE.Vector2(nav.max[0] * VILLAGE_SCALE, -nav.min[1] * VILLAGE_SCALE)
    );

    this.laneHalfWidth = nav.medianHalfWidth * VILLAGE_SCALE;

    this.tileSize = VillageWorld.TILE_CELLS * this.cell;
    this.buildColliders();
    this.buildRoadTiles();
    this.placeHouses();
    this.placeSpawn();
  }

  static async load(url = 'models/village.json', navUrl = 'models/village-nav.json'): Promise<VillageWorld> {
    const [scene, nav] = await Promise.all([loadMesh(url), fetchNav(navUrl)]);
    return new VillageWorld(scene, nav);
  }

  /** The playable village without its art, for headless tests. */
  static fromNav(nav: unknown): VillageWorld {
    return new VillageWorld(null, nav as NavData);
  }

  // --- grid ----------------------------------------------------------------

  /** Grid column for a world X. */
  col(x: number): number {
    return Math.floor((x - this.originX) / this.cellX);
  }

  /** Grid row for a world Z. Note the flip: rows run the other way. */
  row(z: number): number {
    return Math.floor((-z - this.originZ) / this.cellZ);
  }

  /** World X at the centre of a grid column. */
  worldX(i: number): number {
    return this.originX + (i + 0.5) * this.cellX;
  }

  /** World Z at the centre of a grid row. */
  worldZ(j: number): number {
    return -(this.originZ + (j + 0.5) * this.cellZ);
  }

  /** Grid size, for anything that wants to walk it. */
  get gridSize(): number {
    return this.n;
  }

  /** Is this grid cell carriageway? */
  roadAt(i: number, j: number): boolean {
    return this.inside(i, j) && this.nav.road[j][i] === '1';
  }

  /** Is this grid cell blocked? Off the grid counts as blocked. */
  solidAt(i: number, j: number): boolean {
    return !this.inside(i, j) || this.nav.solid[j][i] === '1';
  }

  /**
   * Méter egy rácscellán át.
   *
   * Ahol EGY szám kell (rajzoláshoz, sugárhoz), ott a kisebbik a biztonságos:
   * abból lesz több cella, tehát a lefedés nem marad hiányos.
   */
  get cell(): number {
    return Math.min(this.cellX, this.cellZ);
  }

  /** Cellaméret tengelyenként, annak, ami dobozt épít belőle. */
  get cellWidth(): number {
    return this.cellX;
  }
  get cellDepth(): number {
    return this.cellZ;
  }

  private inside(i: number, j: number): boolean {
    return i >= 0 && j >= 0 && i < this.n && j < this.n;
  }

  /**
   * Is this point on the carriageway?
   *
   * A direct grid lookup, which is the whole reason the grid exists. The old
   * town answered this by testing a square around each road tile's centre, and
   * got it wrong by construction: the squares were narrower than the tile
   * spacing, so a car driving straight down a street fell off the road every
   * twelve metres.
   */
  /**
   * ÚTVONAL AZ UTCÁKON két pont között.
   *
   * A nyíl irányt mutat, és az a vezetés dolga marad — de a NAVIGÁTOR
   * térképe útvonalat mutat, mert az a szerepe: megmondani, merre menj.
   * Légvonalban kijelölt cél egy rácsos városban rendszeresen falnak vezet.
   *
   * Szélességi keresés a RITKÍTOTT úthálón: a 384×384-es rácsból minden
   * hatodik cella, vagyis 64×64 = 4096 csomópont. Ennél finomabb felbontás
   * nem pontosabb útvonalat ad, csak drágábbat — egy ritkított cella (7
   * egység) amúgy is keskenyebb, mint az úttest.
   *
   * Csak ÚTON megy: a járda és a telkek járhatók ugyan, de egy útvonal, ami
   * átvág valakinek a kertjén, nem útvonal, hanem tipp.
   */
  route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    const step = 6;

    // GYORSÍTÓTÁR. A térkép képkockánként rajzol, a keresés viszont
    // négyezer csomópontot jár be — és az útvonal nem változik attól, hogy
    // a kocsi előrébb gurult fél métert. A ritkított rács CELLÁJÁRA
    // kerekítve tároljuk: amíg ugyanabban a cellában vagy, a korábbi
    // választ adjuk vissza.
    const key = `${Math.round(this.col(from.x) / step)},${Math.round(this.row(from.z) / step)}` +
      `>${Math.round(this.col(to.x) / step)},${Math.round(this.row(to.z) / step)}`;
    if (this.routeCache?.key === key) return this.routeCache.path;

    const w = Math.ceil(this.nav.n / step);
    const pass = this.roadMesh(step, w);

    const cell = (p: THREE.Vector3): number => {
      const i = Math.min(w - 1, Math.max(0, Math.floor(this.col(p.x) / step)));
      const j = Math.min(w - 1, Math.max(0, Math.floor(this.row(p.z) / step)));
      return j * w + i;
    };
    // A végpontok gyakran NEM úton vannak (a ház kapubejárója, a kocsi a
    // járdán): ilyenkor a legközelebbi úti csomópont a cél.
    const snap = (at: number): number => {
      if (pass[at]) return at;
      const ax = at % w;
      const ay = (at / w) | 0;
      let best = -1;
      let bestD = Infinity;
      for (let k = 0; k < pass.length; k++) {
        if (!pass[k]) continue;
        const d = (k % w - ax) ** 2 + (((k / w) | 0) - ay) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      return best;
    };

    const start = snap(cell(from));
    const goal = snap(cell(to));
    if (start < 0 || goal < 0 || start === goal) {
      this.routeCache = { key, path: [] };
      return [];
    }

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
          const next = ny * w + nx;
          if (prev[next] !== -1 || !pass[next]) continue;
          // Átlósan csak nyitott sarkon: különben az útvonal levágja a
          // kereszteződés sarkát, ahol nincs úttest.
          if (a !== 0 && b !== 0 && (!pass[y * w + nx] || !pass[ny * w + x])) continue;
          prev[next] = at;
          queue[tail++] = next;
        }
      }
    }
    if (!found) {
      this.routeCache = { key, path: [] };
      return [];
    }

    const path: THREE.Vector3[] = [];
    for (let at = goal; at !== start; at = prev[at]) {
      const x = at % w;
      const y = (at / w) | 0;
      path.push(
        new THREE.Vector3(this.worldX(x * step + step / 2), 0, this.worldZ(y * step + step / 2))
      );
      if (path.length > 4096) break;
    }
    path.reverse();
    this.routeCache = { key, path };
    return path;
  }

  private routeCache: { key: string; path: THREE.Vector3[] } | null = null;

  private roadCache: { key: string; map: Uint8Array } | null = null;

  private roadMesh(step: number, w: number): Uint8Array {
    const key = `${step}`;
    if (this.roadCache?.key === key) return this.roadCache.map;
    const map = new Uint8Array(w * w);
    for (let j = 0; j < w; j++) {
      for (let i = 0; i < w; i++) {
        const ci = i * step + (step >> 1);
        const cj = j * step + (step >> 1);
        map[j * w + i] = this.roadAt(ci, cj) ? 1 : 0;
      }
    }
    this.roadCache = { key, map };
    return map;
  }

  onRoad(x: number, z: number): boolean {
    return this.roadAt(this.col(x), this.row(z));
  }

  /** Can the car stand here at all? False inside a house, a fence or a tree. */
  isSolid(x: number, z: number): boolean {
    return this.solidAt(this.col(x), this.row(z));
  }

  /** Ground height in metres, for putting things down on it. */
  groundAt(x: number, z: number): number {
    const i = this.col(x);
    const j = this.row(z);
    if (!this.inside(i, j)) return 0;
    const h = this.nav.height[j][i];
    return h === null ? 0 : (h - this.nav.groundY) * VILLAGE_SCALE;
  }

  // --- collision -----------------------------------------------------------

  /**
   * Turn the solid grid into as few boxes as possible.
   *
   * One box per cell would be 40 000 of them. Greedy rectangle merging — grow
   * right while the row is solid, then grow down while the whole span stays
   * solid — collapses a house into a handful of slabs and the whole village
   * into low thousands, without ever covering a cell that was not solid.
   */
  private buildColliders(): void {
    const n = this.n;
    const used: boolean[] = new Array(n * n).fill(false);
    const solid = (i: number, j: number) => this.nav.solid[j][i] === '1';

    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        if (used[j * n + i] || !solid(i, j)) continue;

        let w = 1;
        while (i + w < n && solid(i + w, j) && !used[j * n + i + w]) w++;

        let h = 1;
        grow: while (j + h < n) {
          for (let k = 0; k < w; k++) {
            if (!solid(i + k, j + h) || used[(j + h) * n + i + k]) break grow;
          }
          h++;
        }

        for (let b = 0; b < h; b++) {
          for (let a = 0; a < w; a++) used[(j + b) * n + i + a] = true;
        }

        // The tallest cell in the span decides the box height, so a low fence
        // does not become a wall the camera has to see over.
        let peak = -Infinity;
        for (let b = 0; b < h; b++) {
          for (let a = 0; a < w; a++) {
            const v = this.nav.height[j + b][i + a];
            if (v !== null && v > peak) peak = v;
          }
        }
        // Ahol SEMMI nincs, ott nem alacsony akadály van, hanem a világ vége.
        //
        // A falu alapja kör, a rács viszont négyzet: a sarkokban a sugár nem
        // talál semmit, és a cella „tömör" lesz magasság nélkül. Két méteres
        // dobozként ezek az ÁTHAJTHATÓ listába kerültek volna — vagyis a kocsi
        // kihajthatna a semmibe. Az üvegbura ugyan előbb megállítja, de egy
        // biztosíték, ami két független dologra támaszkodik, jobb, mint egy,
        // ami egyre.
        const top = peak === -Infinity ? 12 : (peak - this.nav.groundY) * VILLAGE_SCALE;

        // Az ütköződoboz a KÉT tengely saját cellaméretével épül. Egy közös
        // számmal egy téglalap térképen a dobozok Z irányban elcsúsznának a
        // geometriától — pontosan az a hiba, amit a rács már egyszer
        // elkövetett tükrözve.
        const x0 = this.originX + i * this.cellX;
        // Rows run the other way in Z, so the span that starts at row j ends
        // at the SMALLER world Z.
        const z1 = -(this.originZ + j * this.cellZ);
        const z0 = z1 - h * this.cellZ;
        const box = new THREE.Box3(
          new THREE.Vector3(x0, 0, z0),
          new THREE.Vector3(x0 + w * this.cellX, Math.max(top, 0.6), z1)
        );
        // SÖVÉNY VAGY FAL?
        //
        // A magasságok két tiszta csoportba esnek, és ezt lemértem: 0,5 és 2,5
        // méter között 13 899 cella — sövény, bokor, szegély —, 5 méter fölött
        // 797 — ház és fa. Köztük SEMMI. Ez nem ízlés kérdése, hanem a térkép
        // szerkezete.
        //
        // Ami ebből következik: a kocsi beszorulásait szinte mind a sövények
        // okozzák, nem a falak. Egy szörnyekkel teli halloween-terepjáró
        // viszont áthajt egy bokron — ez nem engedmény, hanem az a
        // viselkedés, amit a játékos elvár tőle. A házaknak és a fáknak
        // továbbra is nekimegy.
        if (Math.max(top, 0.6) < VillageWorld.SOFT_TOP) this.soft.push(box);
        else this.colliders.push(box);
      }
    }
  }

  /** How many grid cells make one coarse road tile. */
  private static readonly TILE_CELLS = 8;

  private buildRoadTiles(): void {
    const step = VillageWorld.TILE_CELLS;
    const isRoad = (i: number, j: number) => this.inside(i, j) && this.nav.road[j][i] === '1';

    for (let j = 0; j + step <= this.n; j += step) {
      for (let i = 0; i + step <= this.n; i += step) {
        // A tile counts as road only if most of it is: a tile that is one
        // corner of tarmac draws a block of road across somebody's garden on
        // the navigator's map, and that is a map that lies.
        let count = 0;
        for (let b = 0; b < step; b++) {
          for (let a = 0; a < step; a++) if (isRoad(i + a, j + b)) count++;
        }
        if (count < step * step * 0.6) continue;

        // Which way the street runs, measured rather than assumed: walk the
        // tarmac from the tile's centre along both axes and take the longer.
        const ci = i + step / 2;
        const cj = j + step / 2;
        let alongX = 0;
        while (alongX < 40 && (isRoad(ci + alongX, cj) || isRoad(ci - alongX, cj))) alongX++;
        let alongZ = 0;
        while (alongZ < 40 && (isRoad(ci, cj + alongZ) || isRoad(ci, cj - alongZ))) alongZ++;

        this.roads.push({
          centre: new THREE.Vector3(
            this.originX + (i + step / 2) * this.cellX,
            0,
            -(this.originZ + (j + step / 2) * this.cellZ)
          ),
          rotY: alongX >= alongZ ? Math.PI / 2 : 0,
          // A junction is a tile that runs a long way BOTH ways. Nothing reads
          // this yet beyond the map's styling, but it is free here and
          // guessing it later from geometry would not be.
          kind: alongX > 6 && alongZ > 6 ? 'crossroad' : 'straight',
        });
      }
    }
  }

  // --- content -------------------------------------------------------------

  private placeHouses(): void {
    // Nearest the jeep's starting kerb first, so house 0 — the one with the
    // real interior — is the one you can see from where the night begins.
    const start = this.nav.start;
    const ordered = [...this.nav.houses].sort(
      (a, b) =>
        (a.stop[0] - start[0]) ** 2 + (a.stop[1] - start[1]) ** 2 -
        ((b.stop[0] - start[0]) ** 2 + (b.stop[1] - start[1]) ** 2)
    );
    ordered.forEach((h, index) => {
      this.houses.push({
        id: index,
        name: HOUSE_NAMES[index % HOUSE_NAMES.length],
        position: new THREE.Vector3(h.centre[0] * VILLAGE_SCALE, 0, -h.centre[1] * VILLAGE_SCALE),
        driveway: new THREE.Vector3(h.stop[0] * VILLAGE_SCALE, 0, -h.stop[1] * VILLAGE_SCALE),
        // A ház magassága MÉRT (a magasságtérkép csúcsa a telken belül), nem
        // becsült: az ablakfénynek a tető alatt kell lennie, és a tizenhat
        // ház nem egyforma magas.
        peak: Math.max(3, (h.peak - this.nav.groundY) * VILLAGE_SCALE),
      });
    });
  }

  /**
   * Start on the road, pointing along it.
   *
   * The heading is measured rather than authored: walk the carriageway from
   * the spawn in each of the four directions and face the way that stays on
   * tarmac longest. Authoring it by hand is how the old town ended up with a
   * jeep that began every night nosed into a hedge.
   */
  private placeSpawn(): void {
    const sx = this.nav.start[0] * VILLAGE_SCALE;
    const sz = -this.nav.start[1] * VILLAGE_SCALE;
    this.carSpawn.set(sx, 0, sz);
    this.spawns.push(this.carSpawn.clone());

    let best = 0;
    let bestRun = -1;
    for (let k = 0; k < 4; k++) {
      const angle = (k * Math.PI) / 2;
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      let run = 0;
      while (run < 200 && this.onRoad(sx + dx * run * 2, sz + dz * run * 2)) run++;
      if (run > bestRun) {
        bestRun = run;
        best = angle;
      }
    }
    this.carHeading = best;
  }
}

async function fetchNav(url: string): Promise<NavData> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`a falu navigációs rácsa nem tölthető: ${url}`);
  return (await response.json()) as NavData;
}

/**
 * Models ship as base64 inside a .json because the artifact host refuses
 * `model/gltf-binary`. Same trick as the rest of the models.
 */
async function loadMesh(url: string): Promise<THREE.Object3D> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`a falu nem tölthető: ${url}`);
  const wrapper = (await response.json()) as { glb: string };
  const binary = Uint8Array.from(atob(wrapper.glb), (c) => c.charCodeAt(0));
  const gltf = await new GLTFLoader().parseAsync(binary.buffer, '');
  // `?notex` — a hiba szándékos előidézése, hogy a mentőöv mérhető legyen.
  // Enélkül csak ott derülne ki, hogy működik-e, ahol már baj van.
  if (import.meta.env.DEV && new URLSearchParams(location.search).has('notex')) {
    gltf.scene.traverse((object) => {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) return;
      for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        (material as THREE.MeshStandardMaterial).map = null;
      }
    });
  }
  // Ha a kiadott oldal házirendje elnyelte a beágyazott képeket, itt kapjuk
  // vissza őket; lásd `repairTextures`.
  await repairTextures(binary.buffer, gltf.scene);
  gltf.scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
  });
  return gltf.scene;
}
