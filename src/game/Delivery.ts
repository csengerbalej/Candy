import * as THREE from 'three';
import { DELIVERY } from '../core/config';

/**
 * A SZÁLLÍTÁS: saroktól a bázisig.
 *
 * A cukorkának három állomása van, és mindegyiken MÁST jelent:
 *
 *   a kézben   — bármikor elveszíthető: egy lövés, és a földön van
 *   a sarokban — a házban biztonságban, de még nem a tiéd
 *   a bázison  — ez az egyetlen, ami pontot ér
 *
 * A bázis MINDENKINEK UGYANAZ a hely. Ez nem kényelmi döntés: két külön
 * bázissal a hazaút két magánügy lenne, és a játék a ház ajtajában véget
 * érne. Egy közös lerakóhelyhez viszont mindketten ugyanoda tartotok — és
 * aki előbb ér oda, az előbb van biztonságban.
 *
 * A lerakás IDŐBE telik. Egy érintésre működő bázis azt jelentené, hogy a
 * hazaérkezés pillanata nem történés, csak egy koordináta.
 */

export interface Load {
  /** A házban, a saját sarokban álló készlet. */
  inCorner: number;
  /** Ami már a kocsiban van, hazafelé. */
  inCar: number;
  /** Ami leadva — EZ a pontszám. */
  delivered: number;
  /** Mennyi ideje áll a bázison. */
  dropping: number;
}

export class Delivery {
  readonly loads: [Load, Load] = [
    { inCorner: 0, inCar: 0, delivered: 0, dropping: 0 },
    { inCorner: 0, inCar: 0, delivered: 0, dropping: 0 },
  ];

  constructor(readonly base: THREE.Vector3) {}

  /** A házban a sarokba vitt mennyiség — a ház ezt jelenti be. */
  setCorner(player: 0 | 1, amount: number): void {
    this.loads[player].inCorner = amount;
  }

  /** Teljesítve van-e a ház: elég cukorka áll a sarokban. */
  houseDone(player: 0 | 1): boolean {
    return this.loads[player].inCorner >= DELIVERY.quota;
  }

  /**
   * Kijutottál a házból: ami a sarokban állt, most a kocsiban van.
   *
   * Innentől MOZOG, tehát kockázatos: a hazaút nem formalitás.
   */
  escaped(player: 0 | 1): number {
    const load = this.loads[player];
    const moved = load.inCorner;
    load.inCar += moved;
    load.inCorner = 0;
    return moved;
  }

  /**
   * @param at Hol áll a játékos kocsija.
   * @returns Hány cukorkát adott le ebben a pillanatban (0, ha semmit).
   */
  update(dt: number, player: 0 | 1, at: THREE.Vector3): number {
    const load = this.loads[player];
    if (load.inCar <= 0) {
      load.dropping = 0;
      return 0;
    }
    if (at.distanceTo(this.base) > DELIVERY.radius) {
      // Elhajtottál: a félbehagyott lerakás nem folytatódik ott, ahol
      // abbamaradt. Különben a bázis körül köröket róva, szakaszosan is le
      // lehetne adni — és akkor a lerakás ideje nem ár, csak késleltetés.
      load.dropping = 0;
      return 0;
    }
    load.dropping += dt;
    if (load.dropping < DELIVERY.dropTime) return 0;
    load.dropping = 0;
    const put = load.inCar;
    load.delivered += put;
    load.inCar = 0;
    return put;
  }

  /** Ki áll jobban. `null`, ha döntetlen. */
  get leader(): 0 | 1 | null {
    const [a, b] = this.loads;
    if (a.delivered === b.delivered) return null;
    return a.delivered > b.delivered ? 0 : 1;
  }
}
