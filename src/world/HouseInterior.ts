import * as THREE from 'three';
import { brushedMetal, cabinet, fitToBox, linoFloor, textured, wallpaper, worktop } from '../render/Textures';

/**
 * A greybox kitchen at monster scale (spec §14). Nothing here is art — every
 * shape exists to answer one of three questions: can he see me, can I hide,
 * and is the candy somewhere I cannot reach alone?
 *
 * Layout, roughly:
 *
 *      FRIDGE          [prank: magnets]
 *   ┌──────────────────────────────────────┐
 *   │  counter        ISLAND        counter│
 *   │                                      │
 *   │   · candy          · candy           │   <- both bowls sit in his patrol
 *   │                                      │
 *   └──────────  DOOR (needs both)  ───────┘
 */
export interface CandySpot {
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  taken: boolean;
  value: number;
}

export interface PrankSpot {
  position: THREE.Vector3;
  mesh: THREE.Mesh;
  label: string;
  cooldown: number;
}

/**
 * How much the authored layout is shrunk.
 *
 * The interior was blocked out at a scale where the kitchen was 120 × 150
 * units for 1.7-unit monsters — the equivalent of a 70 × 88 metre room for a
 * person. Everything was therefore always far away: the shared camera pulled
 * back 44 units to frame both players, and a character rendered ten pixels
 * tall reads as a smear rather than a werewolf. Giant is the joke; warehouse
 * is not.
 */
export const HOUSE_SCALE = 0.5;

/** What a block is made of. Drives its materials, nothing else. */
type Surface = 'wall' | 'counter' | 'fridge' | 'prop';

export class HouseInterior {
  readonly group = new THREE.Group();
  readonly colliders: THREE.Box3[] = [];
  /** Meshes whose collision boxes are computed after the world is scaled. */
  private readonly solidMeshes: THREE.Mesh[] = [];
  private readonly gateMeshes: THREE.Mesh[] = [];
  /**
   * Solid for everyone except the ghost (spec §5C). Kept apart from
   * `colliders` so the trait is a level-design fact rather than a special case
   * buried in the movement code.
   */
  readonly gateColliders: THREE.Box3[] = [];
  /** Meshes the homeowner's line of sight is blocked by. */
  readonly occluders: THREE.Mesh[] = [];

  // Close together: they come through the front door side by side, and a wide
  // spawn makes the shared camera open at its furthest framing.
  readonly spawns = [new THREE.Vector3(-8, 0, 44), new THREE.Vector3(8, 0, 44)];
  readonly patrolWaypoints: THREE.Vector3[] = [
    new THREE.Vector3(-34, 0, 10),
    new THREE.Vector3(-34, 0, -30),
    new THREE.Vector3(34, 0, -30),
    new THREE.Vector3(34, 0, 10),
    new THREE.Vector3(0, 0, -6),
  ];
  readonly homeownerSpawn = new THREE.Vector3(0, 0, -20);

  readonly candySpots: CandySpot[] = [];
  readonly prankSpots: PrankSpot[] = [];
  /** Stand here, both of you, to shove the door open. */
  readonly exitZone = new THREE.Vector3(0, 0, 62);
  exitRadius = 9;

  constructor() {
    this.addFloor();
    this.addWalls();

    // Counters down both long walls — the classic "run the edge" cover.
    this.addBlock(-46, -10, 14, 6, 70, 0x2b2246, 'counter');
    this.addBlock(46, -10, 14, 6, 70, 0x2b2246, 'counter');

    // Island in the middle: the only cover that lets you break line of sight
    // without leaving the room.
    this.addBlock(0, -4, 30, 5, 16, 0x30274f, 'counter');

    // Fridge: tall, and the prank hangs off it.
    this.addBlock(-30, -56, 20, 26, 12, 0x3a2f5e, 'fridge');

    // A few chairs / boxes to break up sightlines.
    this.addBlock(18, 26, 8, 5, 8, 0x2b2246, 'prop');
    this.addBlock(-16, 30, 8, 5, 8, 0x2b2246, 'prop');
    this.addBlock(34, -14, 7, 6, 7, 0x2b2246, 'prop');

    // Candy sits on the FLOOR, out in the open, squarely on his patrol route.
    // At monster scale a countertop is unreachable, and more importantly: candy
    // that is easy to reach but hard to stand next to is what forces the
    // distraction. The difficulty is his attention, not the platforming.
    this.addCandy(new THREE.Vector3(-28, 2.2, -16), 5);
    this.addCandy(new THREE.Vector3(28, 2.2, -24), 5);
    this.addCandy(new THREE.Vector3(2, 2.2, -40), 8);

    // Pranks are floor-level too: you kick the thing, the thing falls over.
    this.addPrank(new THREE.Vector3(-30, 2.6, -46), 'HŰTŐMÁGNES-LAVINA');
    this.addPrank(new THREE.Vector3(36, 2.6, 6), 'EDÉNYTORONY');

    // A low baby gate across the room, with one gap in the middle. Everyone
    // else detours through the gap; the ghost goes straight through the bars,
    // which is worth exactly as much as the chase is dangerous.
    this.addGate(-28, 18, 36);
    this.addGate(28, 18, 36);

    this.addExitMarker();
    this.applyScale(HOUSE_SCALE);
  }

  /**
   * Shrink the whole interior, then derive everything that depends on it.
   *
   * Collision boxes are computed AFTER the scale is applied rather than
   * multiplied afterwards, so there is no second place where the two can drift
   * apart.
   */
  private applyScale(scale: number): void {
    if (scale === 1) return;
    this.group.scale.setScalar(scale);
    this.group.updateMatrixWorld(true);

    for (const mesh of this.solidMeshes) {
      this.colliders.push(new THREE.Box3().setFromObject(mesh));
    }
    for (const mesh of this.gateMeshes) {
      this.gateColliders.push(new THREE.Box3().setFromObject(mesh));
    }

    for (const v of [...this.spawns, ...this.patrolWaypoints, this.homeownerSpawn, this.exitZone]) {
      v.multiplyScalar(scale);
    }
    for (const candy of this.candySpots) candy.position.multiplyScalar(scale);
    for (const prank of this.prankSpots) prank.position.multiplyScalar(scale);
    this.exitRadius *= scale;
  }

  private addFloor(): void {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(120, 150),
      // One lino tile is 24 units across — about seven monster-heights, which
      // is the whole point: you can count how small you are by how many tiles
      // it takes to cross the room.
      textured(linoFloor(), { color: 0xffffff, roughness: 1 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -5;
    floor.receiveShadow = true;
    this.group.add(floor);
  }

  private addWalls(): void {
    const h = 34;
    this.addBlock(0, -70, 120, h, 4, 0x221a40, 'wall'); // far wall
    this.addBlock(-58, -5, 4, h, 150, 0x221a40, 'wall'); // left
    this.addBlock(58, -5, 4, h, 150, 0x221a40, 'wall'); // right
    // Near wall stays waist-high: the stage camera sits behind the players on
    // +Z, so a full-height wall here would render the room unplayable. Same
    // rule as the greybox — camera direction is a level-design constraint.
    this.addBlock(-38, 68, 44, 5, 4, 0x221a40, 'wall');
    this.addBlock(38, 68, 44, 5, 4, 0x221a40, 'wall');
  }

  private addBlock(
    x: number,
    z: number,
    w: number,
    h: number,
    d: number,
    color: number,
    kind: Surface = 'prop'
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), this.surface(kind, color, w, h, d));
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.solidMeshes.push(mesh);
    this.occluders.push(mesh);
    return mesh;
  }

  /**
   * Six materials per box, one per face.
   *
   * A single material on a box stretches one pattern over faces of completely
   * different proportions — the 70-unit counter front and its 14-unit end
   * would show the same two cupboard doors, one of them squashed to a sliver.
   * Worse, a worktop is not made of the same stuff as the cupboards under it,
   * and a kitchen where it is reads as a painted crate. Faces are in three.js
   * box order: +X, -X, +Y, -Y, +Z, -Z.
   */
  private surface(kind: Surface, color: number, w: number, h: number, d: number): THREE.Material[] {
    const face = (
      texture: THREE.Texture | null,
      fw: number,
      fh: number,
      unitsPerTile: number,
      params: THREE.MeshStandardMaterialParameters
    ) => {
      const material = textured(texture, params);
      fitToBox(material, fw, fh, unitsPerTile);
      return material;
    };

    if (kind === 'wall') {
      const paper = () => wallpaper();
      return [
        face(paper(), d, h, 26, { color: 0xffffff, roughness: 0.95 }),
        face(paper(), d, h, 26, { color: 0xffffff, roughness: 0.95 }),
        face(null, 0, 0, 1, { color, roughness: 0.95 }),
        face(null, 0, 0, 1, { color, roughness: 0.95 }),
        face(paper(), w, h, 26, { color: 0xffffff, roughness: 0.95 }),
        face(paper(), w, h, 26, { color: 0xffffff, roughness: 0.95 }),
      ];
    }

    if (kind === 'fridge') {
      const metal = () => brushedMetal();
      // Cool, glossy and tinted brighter than the cabinets: the fridge is the
      // landmark you navigate the room by, and the prank hangs off it.
      const door = { color: 0xd8d2f0, roughness: 0.32, metalness: 0.55 };
      return [
        face(metal(), d, h, 30, door),
        face(metal(), d, h, 30, door),
        face(metal(), w, d, 30, door),
        face(metal(), w, d, 30, door),
        face(metal(), w, h, 30, door),
        face(metal(), w, h, 30, door),
      ];
    }

    // Counters and props: cupboard doors on the sides, stone on top.
    const doors = { color: 0xcfc4ee, roughness: 0.75 };
    const stone = { color: 0xcdc4e8, roughness: 0.42 };
    const top = kind === 'counter' ? worktop() : cabinet();
    return [
      face(cabinet(), d, h, 16, doors),
      face(cabinet(), d, h, 16, doors),
      face(top, w, d, kind === 'counter' ? 30 : 16, kind === 'counter' ? stone : doors),
      face(cabinet(), w, d, 16, doors),
      face(cabinet(), w, h, 16, doors),
      face(cabinet(), w, h, 16, doors),
    ];
  }

  private addGate(cx: number, cz: number, width: number): void {
    const height = 6;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(width, height, 1.6),
      new THREE.MeshStandardMaterial({
        color: 0x8fa6d8,
        emissive: 0x3d5aa0,
        emissiveIntensity: 0.35,
        transparent: true,
        opacity: 0.42,
        roughness: 0.4,
      })
    );
    mesh.position.set(cx, height / 2, cz);
    this.group.add(mesh);
    this.gateMeshes.push(mesh);
    // Not an occluder: you can see through a grille, and so can he.
  }

  private addCandy(position: THREE.Vector3, value: number): void {
    const mesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(2.1, 0),
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
    this.candySpots.push({ position: position.clone(), mesh, taken: false, value });
  }

  private addPrank(position: THREE.Vector3, label: string): void {
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
    this.prankSpots.push({ position: position.clone(), mesh, label, cooldown: 0 });
  }

  private addExitMarker(): void {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(this.exitRadius - 1.2, this.exitRadius, 40),
      new THREE.MeshBasicMaterial({ color: 0x7ad7ff, transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(this.exitZone.x, 0.06, this.exitZone.z);
    this.group.add(ring);
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
      const hot = p.cooldown <= 0;
      const mat = p.mesh.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = hot ? 0.8 : 0.12;
    }
  }
}
