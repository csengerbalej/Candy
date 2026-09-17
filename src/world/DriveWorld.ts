import type * as THREE from 'three';
import type { HouseLot, RoadTile } from './TownWorld';

/**
 * What the driving section needs from a world, and nothing more.
 *
 * The greybox grid and the authored town are very different things; the
 * navigator's map, the traffic and the scoring only ever needed "where are the
 * roads, where are the houses, how big is this place". Naming that contract
 * meant swapping one for the other touched no gameplay code.
 */
export interface DriveWorld {
  readonly group: THREE.Group;
  readonly colliders: THREE.Box3[];
  /** Index-aligned asset names, when the world knows them. */
  readonly colliderAssets?: string[];
  /**
   * 'exact' when the colliders were measured off the world's own geometry and
   * need no reshaping. A kit-of-parts world leaves this alone and lets the car
   * recover each box's real shape from its name.
   */
  readonly colliderMode?: 'derive' | 'exact';
  readonly houses: HouseLot[];
  readonly roads: RoadTile[];
  readonly carSpawn: THREE.Vector3;
  readonly tileSize: number;
  readonly bounds: THREE.Box2;
  onRoad(x: number, z: number): boolean;
  /**
   * Útvonal az utcákon két pont között.
   *
   * A navigátor térképe rajzolja. Üres tömb, ha nincs út — a térkép ilyenkor
   * légvonalat húz, ami rosszabb, de nem semmi.
   */
  route(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[];
  /** Autópálya-e ez a pont — oda nem való minden, ami a városba igen. */
  onMotorway(x: number, z: number): boolean;
}

export type { HouseLot, RoadTile };
