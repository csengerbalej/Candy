import type * as THREE from 'three';
import type { CandySpot, PrankSpot } from './HouseInterior';

/**
 * What the house section needs from a house, and nothing more.
 *
 * The same trick as DriveWorld: the greybox kitchen and the real flat are very
 * different objects, but the stealth, the scoring and the escape only ever
 * cared about where you can stand, what blocks you, where the sweets are and
 * where the owner walks. Naming that contract is what let the first real house
 * drop in without touching a line of gameplay code.
 */
export interface HouseWorld {
  readonly group: THREE.Group;
  readonly colliders: THREE.Box3[];
  readonly gateColliders: THREE.Box3[];
  readonly occluders: THREE.Mesh[];
  readonly spawns: THREE.Vector3[];
  readonly patrolWaypoints: THREE.Vector3[];
  readonly homeownerSpawn: THREE.Vector3;
  readonly candySpots: CandySpot[];
  readonly prankSpots: PrankSpot[];
  readonly exitZone: THREE.Vector3;
  readonly exitRadius: number;
  update(dt: number, elapsed: number): void;
}

export type { CandySpot, PrankSpot };
