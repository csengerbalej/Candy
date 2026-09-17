import * as THREE from 'three';
import { asphalt, textured } from '../render/Textures';
import { models } from '../assets/ModelLoader';

export interface HouseLot {
  id: number;
  name: string;
  position: THREE.Vector3;
  /** Where the car has to stop. */
  driveway: THREE.Vector3;
  /** A tetőgerinc magassága. Az ablakfény ez alá kerül. Nem kötelező. */
  peak?: number;
}

export interface RoadTile {
  centre: THREE.Vector3;
  rotY: number;
  kind: string;
}

interface LayoutInstance {
  asset: string;
  loc_cm: [number, number, number];
  rot_z_deg: number;
  scale: number;
}

interface LayoutLight {
  loc_cm: [number, number, number];
  type: string;
  color: [number, number, number];
}

interface DriveMeta {
  start_cm: [number, number, number];
  start_heading_deg: number;
  houses: Array<{ asset: string; loc_cm: number[]; stop_cm: number[]; facing: string }>;
  landmarks: Array<{ asset: string; loc_cm: number[] }>;
  road_half_width_m: number;
}

interface Layout {
  tile_size_cm: number;
  instances: LayoutInstance[];
  lights: LayoutLight[];
  /** Authored by the town generator: where to stop, where to start, what to
   *  navigate by. Derived guesses were wrong often enough to be worth it. */
  drive?: DriveMeta;
}

/** Human-readable names for the map, keyed by the asset the town was built from. */
const HOUSE_NAMES: Record<string, string> = {
  SM_Candy_House_Party: 'PARTIHÁZ',
  SM_Candy_House_Haunted: 'KÍSÉRTETHÁZ',
  SM_Candy_House_Rich: 'A GAZDAGOK',
  SM_Candy_House_Bungalow: 'BUNGALÓ',
  SM_Candy_House_Old_Victorian: 'ÓDON VILLA',
  SM_Candy_House_Family_A: 'CSALÁDI HÁZ',
  SM_Candy_House_Family_B: 'KÉKAJTÓS HÁZ',
  SM_Candy_House_Small_A: 'A KIS SÁRGA',
  SM_Candy_House_Small_B: 'A KIS ZÖLD',
  SM_Candy_House_Corner_Shop: 'SAROKBOLT',
  SM_Candy_House_Modern: 'ÜVEGHÁZ',
  SM_Candy_House_Weird: 'A FURCSA HÁZ',
};

/** Anything shorter than this is scenery you drive over, not into. */
const COLLIDER_MIN_HEIGHT = 0.9;

/**
 * Every flat piece of the town is authored at exactly y = 0 — road, kerb,
 * driveway, grass, manhole, all 79 of them. Coplanar surfaces cannot be
 * ordered by a depth buffer, so the level flickered as soon as the camera
 * moved. A deterministic millimetre of separation per layer fixes it for good;
 * at this scale it is invisible and it never depends on depth precision.
 */
/**
 * The carriageway: the tiles a car actually drives on. Everything else in the
 * pack's `SM_Candy_Street_` namespace is kerbside dressing.
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

/** Flat street-level surfaces: lit and shadowed as ground, not as buildings. */
const GROUND_SURFACES = new Set([
  'SM_Candy_Street_Sidewalk',
  'SM_Candy_Street_ParkingSpot',
  'SM_Candy_Street_House_Plot',
  'SM_Candy_Prop_Manhole',
]);

const GROUND_LAYER: Array<[string, number]> = [
  ['SM_Candy_Street_Driveway', 0.004],
  ['SM_Candy_Street_Sidewalk', 0.002],
  ['SM_Candy_Nature_GrassPatch', 0.008],
  ['SM_Candy_Prop_Manhole', 0.012],
];

/** Glow decals sit above every biased ground layer, and blend additively. */
const GLOW_HEIGHT = 0.03;

let glowCache: THREE.Texture | null = null;

/**
 * A light pool with a real falloff.
 *
 * The old decal was a flat-opacity `CircleGeometry`, which is a shape, not a
 * light: it had a hard rim and a uniform middle, so 69 of them read as 69
 * stickers. This is a squared-inverse-ish ramp with a hot core, which is what
 * a lamp on tarmac actually looks like.
 */
function glowTexture(): THREE.Texture {
  if (glowCache) return glowCache;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const r = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - r, 2.2) * (1 + 1.6 * Math.pow(1 - r, 8));
      const i = (y * size + x) * 4;
      image.data[i] = image.data[i + 1] = image.data[i + 2] = 255;
      image.data[i + 3] = Math.round(Math.min(1, a) * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  glowCache = new THREE.CanvasTexture(canvas);
  glowCache.colorSpace = THREE.SRGBColorSpace;
  return glowCache;
}

function groundBias(asset: string): number {
  for (const [prefix, bias] of GROUND_LAYER) if (asset === prefix) return bias;
  return 0;
}

/**
 * The authored town (Blender → glTF), placed from its own layout file.
 *
 * Two conversions happen here and nowhere else:
 *
 *   · centimetres → metres, because the layout targets UE5 and the game does not;
 *   · Blender's Z-up → three's Y-up, as (x, y, z) → (x, z, −y). A rotation about
 *     Blender's Z maps to the same angle about three's Y, which is why the
 *     placement code can pass `rot_z_deg` straight through.
 *
 * Everything downstream — the navigator's map, the critters, the driveways —
 * reads the parsed result rather than the file, so the town can be rebuilt in
 * Blender without touching gameplay code.
 */
export class TownWorld {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  /**
   * The asset each collider came from, index-aligned with `colliders`.
   *
   * The car used to infer "is this a tree" from the box's proportions, which
   * works until a small square shed gets shrunk to a trunk and a low wide wall
   * gets driven through. A name turns that guess into a lookup.
   */
  readonly colliderAssets: string[] = [];
  readonly gateColliders: THREE.Box3[] = [];
  readonly houses: HouseLot[] = [];
  readonly roads: RoadTile[] = [];
  readonly spawns: THREE.Vector3[] = [];
  readonly carSpawn = new THREE.Vector3();
  carHeading = 0;
  readonly tileSize: number;
  /** Upright lamp halos; the scene turns them to face the camera each frame. */
  lightHalos: THREE.InstancedMesh | null = null;
  /** Where each halo hangs, so the scene can re-aim it without re-deriving it. */
  haloAnchors: THREE.Vector3[] = [];

  /** Half-extent of the town, for framing the navigator's map. */
  readonly bounds = new THREE.Box2(
    new THREE.Vector2(Infinity, Infinity),
    new THREE.Vector2(-Infinity, -Infinity)
  );

  private constructor(
    private readonly layout: Layout,
    library: THREE.Object3D
  ) {
    this.tileSize = layout.tile_size_cm / 100;

    const assets = new Map<string, THREE.Object3D>();
    for (const child of library.children) assets.set(child.name, child);

    this.build(layout, assets);
    this.indexRoadCells();
    this.addGround();
    this.addLightGlows();
    this.applyDriveMeta(layout.drive);
  }

  /**
   * Place 1177 instances as INSTANCED meshes, one draw call per distinct
   * geometry rather than per placement.
   *
   * Cloning each placement cost 3042 draw calls and 32fps; the triangles were
   * never the problem (1.2M is nothing) — it was asking the GPU 3000 separate
   * times to draw a fence post. Every placement of an asset shares geometry and
   * material by construction, which is exactly what instancing is for.
   */
  private build(layout: Layout, assets: Map<string, THREE.Object3D>): void {
    // Group placements by asset, so each asset is batched once.
    const byAsset = new Map<string, LayoutInstance[]>();
    for (const inst of layout.instances) {
      const list = byAsset.get(inst.asset);
      if (list) list.push(inst);
      else byAsset.set(inst.asset, [inst]);
    }

    const placement = new THREE.Matrix4();
    const combined = new THREE.Matrix4();
    const box = new THREE.Box3();

    for (const [asset, instances] of byAsset) {
      const source = assets.get(asset);
      if (!source) continue;

      // CARRIAGEWAY, not "anything named Street_". The pack's naming lies:
      // `SM_Candy_Street_Sidewalk` is a pavement and `SM_Candy_Street_House_Plot`
      // is a lawn, and both used to register as tarmac here. That put the
      // critters on the pavement and drew the verges as road on the
      // navigator's map, because `onRoad()` measures from a tile's CENTRE and
      // a pavement tile is centred five metres off the road.
      const isRoad = CARRIAGEWAY.has(asset);
      // For the look, though, every flat piece of the street belongs together:
      // the pavement takes the same dark ground tint as the tarmac and casts
      // no shadow, or the kerb line lights up brighter than the houses.
      const isGround = isRoad || GROUND_SURFACES.has(asset);
      const isHouse = asset.startsWith('SM_Candy_House_');

      // The asset's own meshes, with their transform inside the asset baked in.
      source.updateMatrixWorld(true);
      const parts: Array<{ geometry: THREE.BufferGeometry; material: THREE.Material; local: THREE.Matrix4 }> = [];
      source.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const local = new THREE.Matrix4().copy(mesh.matrixWorld);
        // Relative to the asset root, not to the library scene.
        local.premultiply(new THREE.Matrix4().copy(source.matrixWorld).invert());
        parts.push({
          geometry: mesh.geometry,
          material: Array.isArray(mesh.material) ? mesh.material[0] : mesh.material,
          local,
        });
      });
      if (parts.length === 0) continue;

      // How tall this asset is, measured once from its own geometry. The
      // scene uses it to decide what is worth casting a shadow: see
      // `SHADOW_CASTER_MIN_HEIGHT` in DriveScene.
      let assetHeight = 0;
      for (const part of parts) {
        if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
        const local = part.geometry.boundingBox!.clone().applyMatrix4(part.local);
        assetHeight = Math.max(assetHeight, local.max.y);
      }

      const batches = parts.map((part) => {
        const batch = new THREE.InstancedMesh(part.geometry, part.material, instances.length);
        batch.castShadow = true;
        batch.receiveShadow = true;
        batch.name = asset;
        batch.userData.cpAsset = asset;
        batch.userData.cpHeight = assetHeight;
        batch.userData.cpRoad = isGround;
        this.group.add(batch);
        return batch;
      });

      instances.forEach((inst, index) => {
        const position = new THREE.Vector3(
          inst.loc_cm[0] / 100,
          inst.loc_cm[2] / 100 + groundBias(inst.asset),
          -inst.loc_cm[1] / 100
        );
        placement.compose(
          position,
          new THREE.Quaternion().setFromAxisAngle(
            new THREE.Vector3(0, 1, 0),
            THREE.MathUtils.degToRad(inst.rot_z_deg)
          ),
          new THREE.Vector3(inst.scale, inst.scale, inst.scale)
        );

        parts.forEach((part, partIndex) => {
          combined.multiplyMatrices(placement, part.local);
          batches[partIndex].setMatrixAt(index, combined);

          if (!part.geometry.boundingBox) part.geometry.computeBoundingBox();
          box.copy(part.geometry.boundingBox!).applyMatrix4(combined);
          this.bounds.expandByPoint(new THREE.Vector2(box.min.x, box.min.z));
          this.bounds.expandByPoint(new THREE.Vector2(box.max.x, box.max.z));

          // Roads are driven on, never into; scenery below knee height is
          // driven over, because a pumpkin that stops a car dead is a bug
          // report rather than a joke.
          if (!isRoad && box.max.y - box.min.y >= COLLIDER_MIN_HEIGHT) {
            this.colliders.push(box.clone());
            this.colliderAssets.push(asset);
          }
        });

        if (isRoad) {
          this.roads.push({
            centre: position.clone(),
            rotY: THREE.MathUtils.degToRad(inst.rot_z_deg),
            kind: asset.replace('SM_Candy_Street_', ''),
          });
        }

        if (isHouse) {
          this.houses.push({
            id: this.houses.length,
            name: HOUSE_NAMES[asset] ?? asset.replace('SM_Candy_House_', ''),
            position: position.clone(),
            driveway: position.clone(),
          });
        }
      });

      for (const batch of batches) batch.instanceMatrix.needsUpdate = true;
    }
  }

  static async load(): Promise<TownWorld> {
    const [{ scene }, layout] = await Promise.all([
      models.load('models/town.json'),
      fetch('models/town-layout.json').then((r) => r.json() as Promise<Layout>),
    ]);
    return new TownWorld(layout, scene);
  }

  /** Road cells by grid key, with the directions the carriageway continues in. */
  private readonly roadCells = new Map<string, { openX: [boolean, boolean]; openZ: [boolean, boolean] }>();

  /**
   * True when a point is on tarmac.
   *
   * This used to test an 8.16 m SQUARE around each tile centre — but the tiles
   * are 12 m apart, so there was a 3.8 m gap between every pair of squares.
   * Driving down the middle of a straight street, the car left the road every
   * twelve metres and came back: the kerb rumble switched on and off at
   * walking pace and the screen shook the whole way down the street.
   *
   * The carriageway is 8 m wide but a tile is 12 m long, so the rule is not a
   * square: you may run to the cell edge in the directions the road CONTINUES,
   * and only to the kerb where it does not.
   */
  onRoad(x: number, z: number): boolean {
    const size = this.tileSize;
    const gx = Math.round(x / size);
    const gz = Math.round(z / size);
    const cell = this.roadCells.get(`${gx},${gz}`);
    if (!cell) return false;

    const half = size * 0.34; // 8 m of asphalt in a 12 m tile
    const dx = x - gx * size;
    const dz = z - gz * size;

    if (dx > half && !cell.openX[1]) return false;
    if (dx < -half && !cell.openX[0]) return false;
    if (dz > half && !cell.openZ[1]) return false;
    if (dz < -half && !cell.openZ[0]) return false;
    return true;
  }

  /** Called once the road list is complete. */
  private indexRoadCells(): void {
    const size = this.tileSize;
    const key = (gx: number, gz: number) => `${gx},${gz}`;
    const occupied = new Set(
      this.roads.map((t) => key(Math.round(t.centre.x / size), Math.round(t.centre.z / size)))
    );
    for (const k of occupied) {
      const [gx, gz] = k.split(',').map(Number);
      this.roadCells.set(k, {
        openX: [occupied.has(key(gx - 1, gz)), occupied.has(key(gx + 1, gz))],
        openZ: [occupied.has(key(gx, gz - 1)), occupied.has(key(gx, gz + 1))],
      });
    }
  }

  private addGround(): void {
    const size = Math.max(this.bounds.max.x - this.bounds.min.x, this.bounds.max.y - this.bounds.min.y) * 2;
    const centre = this.bounds.getCenter(new THREE.Vector2());
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      textured(asphalt(), { color: 0xffffff, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    // Well clear of the town's own surfaces; it only fills the horizon.
    ground.position.set(centre.x, -0.35, centre.y);
    ground.receiveShadow = true;
    this.group.add(ground);
  }

  /**
   * The layout's lights, as glow decals rather than lights.
   *
   * Twenty-five real point lights cost 19fps in a forward renderer, so these
   * stay fake. What changed is that they used to be 69 separate flat discs —
   * 69 draw calls, each a hard-edged circle of constant opacity that read as a
   * sticker on the tarmac. Now they are two InstancedMeshes (one draw call
   * each) with a real falloff texture and additive blending, so the pool
   * brightens the road instead of painting over it, and overlapping pools
   * actually add up the way light does.
   *
   * Street lamps additionally get an upright billboard halo: a light you can
   * see the glow of from down the street is what gives a long street depth.
   */
  private addLightGlows(): void {
    const pools = this.layout.lights;
    if (pools.length === 0) return;

    const falloff = glowTexture();
    const disc = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const billboard = new THREE.PlaneGeometry(1, 1);

    const makeBatch = (geometry: THREE.BufferGeometry, count: number, opacity: number) => {
      const mesh = new THREE.InstancedMesh(
        geometry,
        new THREE.MeshBasicMaterial({
          map: falloff,
          transparent: true,
          opacity,
          depthWrite: false,
          blending: THREE.AdditiveBlending,
          toneMapped: false,
        }),
        count
      );
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(count * 3), 3);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      return mesh;
    };

    const street = pools.filter((l) => l.type === 'street');
    const small = pools.filter((l) => l.type !== 'street');

    const groundBatch = makeBatch(disc, pools.length, 0.85);
    const haloBatch = makeBatch(billboard, street.length, 0.5);
    this.lightHalos = haloBatch;
    this.haloAnchors = street.map(
      (l) => new THREE.Vector3(l.loc_cm[0] / 100, l.loc_cm[2] / 100, -l.loc_cm[1] / 100)
    );

    const matrix = new THREE.Matrix4();
    const scale = new THREE.Vector3();
    const noRotation = new THREE.Quaternion();
    const position = new THREE.Vector3();

    const write = (
      batch: THREE.InstancedMesh,
      index: number,
      light: LayoutLight,
      x: number,
      y: number,
      z: number,
      radius: number,
      gain: number
    ) => {
      position.set(x, y, z);
      scale.set(radius, radius, radius);
      matrix.compose(position, noRotation, scale);
      batch.setMatrixAt(index, matrix);
      batch.setColorAt(
        index,
        new THREE.Color(light.color[0], light.color[1], light.color[2]).multiplyScalar(gain)
      );
    };

    pools.forEach((light, index) => {
      // A pool is wider than it is bright: a 5m lamp throws light across most
      // of a 12m tile, a jack-o'-lantern barely past its own shoulders.
      const radius = light.type === 'street' ? 9.5 : 2.4;
      const gain = light.type === 'street' ? 0.55 : 0.85;
      write(
        groundBatch,
        index,
        light,
        light.loc_cm[0] / 100,
        // Above every biased ground layer, and additive, so it cannot z-fight.
        GLOW_HEIGHT,
        -light.loc_cm[1] / 100,
        radius,
        gain
      );
    });

    street.forEach((light, index) => {
      write(
        haloBatch,
        index,
        light,
        light.loc_cm[0] / 100,
        light.loc_cm[2] / 100,
        -light.loc_cm[1] / 100,
        4.2,
        0.7
      );
    });

    for (const batch of [groundBatch, haloBatch]) {
      if (batch.count === 0) continue;
      batch.instanceMatrix.needsUpdate = true;
      if (batch.instanceColor) batch.instanceColor.needsUpdate = true;
      this.group.add(batch);
    }
    void small;
  }

  /**
   * Take the stop points and the start from the layout when the generator
   * provided them; fall back to deriving them only for older towns.
   */
  private applyDriveMeta(drive?: DriveMeta): void {
    if (!drive) {
      this.deriveDriveways();
      this.chooseCarSpawn();
      return;
    }

    const toWorld = (cm: number[]) =>
      new THREE.Vector3(cm[0] / 100, cm[2] / 100, -cm[1] / 100);

    // Rebuild the house list from the authored data, so the name, the building
    // and the place the car stops always belong to each other.
    this.houses.length = 0;
    drive.houses.forEach((house, index) => {
      this.houses.push({
        id: index,
        name: HOUSE_NAMES[house.asset] ?? house.asset.replace('SM_Candy_House_', ''),
        position: toWorld(house.loc_cm),
        driveway: toWorld(house.stop_cm),
      });
    });

    this.carSpawn.copy(toWorld(drive.start_cm));
    this.carHeading = THREE.MathUtils.degToRad(drive.start_heading_deg ?? 0);
    this.spawns.push(this.carSpawn.clone(), this.carSpawn.clone());
  }

  /** Each house is entered from the nearest piece of road. */
  private deriveDriveways(): void {
    for (const house of this.houses) {
      let best: RoadTile | null = null;
      let bestDistance = Infinity;
      for (const tile of this.roads) {
        const d = tile.centre.distanceToSquared(house.position);
        if (d < bestDistance) {
          bestDistance = d;
          best = tile;
        }
      }
      if (!best) continue;
      // Stop on the tile, on the side the house is on.
      const toHouse = new THREE.Vector3().subVectors(house.position, best.centre).setY(0);
      const inset = Math.min(toHouse.length(), this.tileSize * 0.25);
      house.driveway = best.centre.clone().addScaledVector(toHouse.normalize(), inset);
    }
  }

  private chooseCarSpawn(): void {
    // Start on the longest straight, facing along it.
    const straight = this.roads.find((t) => t.kind === 'Straight_Long') ?? this.roads[0];
    this.carSpawn.copy(straight?.centre ?? new THREE.Vector3());
    this.spawns.push(this.carSpawn.clone(), this.carSpawn.clone());
  }
}
