import * as THREE from 'three';
import { PALETTE } from '../core/config';

/** Low enough that the near wall never occludes the players. */
const WALL_HEIGHT = 2.2;

/**
 * A deliberately ugly test arena. Its only job is to give the camera
 * something to occlude, and the players a reason to walk away from each other:
 * two "rooms" joined by a corridor, far enough apart to force a full split.
 */
export class Greybox {
  readonly group = new THREE.Group();
  /** World-space AABBs the players collide against. */
  readonly colliders: THREE.Box3[] = [];
  readonly gateColliders: THREE.Box3[] = [];
  readonly spawns: THREE.Vector3[] = [
    new THREE.Vector3(-4, 0, 6),
    new THREE.Vector3(4, 0, 6),
  ];

  constructor() {
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: PALETTE.ground, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    this.group.add(ground);

    const grid = new THREE.GridHelper(200, 100, PALETTE.grid, PALETTE.grid);
    (grid.material as THREE.Material).opacity = 0.25;
    (grid.material as THREE.Material).transparent = true;
    grid.position.y = 0.01;
    this.group.add(grid);

    // Room A (spawn), corridor, Room B (the "somewhere else" that forces a split).
    this.addRoom(0, 0, 22, 22);
    this.addCorridor(0, -26, 6, 32);
    this.addRoom(0, -52, 22, 22);

    // Clutter to read parallax and depth against.
    const clutter: Array<[number, number, number, number, number]> = [
      [-6, 4, 2, 2.4, 2],
      [6.5, -2, 3, 1.2, 3],
      [0, -8, 1.4, 3.2, 1.4],
      [-5, -50, 2.5, 1.6, 2.5],
      [5, -55, 2, 3.6, 2],
      [0, -46, 4, 0.8, 4],
    ];
    for (const [x, z, w, h, d] of clutter) this.addBox(x, z, w, h, d);
  }

  private addRoom(cx: number, cz: number, w: number, d: number): void {
    const t = 1;
    // Waist-high walls: the stage camera looks over them from +Z, so a
    // full-height near wall would simply erase the players from the frame.
    const h = WALL_HEIGHT;
    // Walls with a gap where the corridor meets the room (front/back of each room).
    const halfW = w / 2;
    const halfD = d / 2;
    const gap = 4;
    this.addBox(cx - halfW, cz, t, h, d); // left
    this.addBox(cx + halfW, cz, t, h, d); // right
    // Split front/back walls around the corridor opening.
    const seg = (halfW * 2 - gap) / 2;
    const off = gap / 2 + seg / 2;
    this.addBox(cx - off, cz - halfD, seg, h, t);
    this.addBox(cx + off, cz - halfD, seg, h, t);
    this.addBox(cx - off, cz + halfD, seg, h, t);
    this.addBox(cx + off, cz + halfD, seg, h, t);
  }

  private addCorridor(cx: number, cz: number, w: number, len: number): void {
    const t = 1;
    const h = WALL_HEIGHT;
    this.addBox(cx - w / 2, cz, t, h, len);
    this.addBox(cx + w / 2, cz, t, h, len);
  }

  private addBox(x: number, z: number, w: number, h: number, d: number): void {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshStandardMaterial({ color: PALETTE.obstacle, roughness: 0.85 })
    );
    mesh.position.set(x, h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.colliders.push(new THREE.Box3().setFromObject(mesh));
  }
}
