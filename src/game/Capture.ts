import * as THREE from 'three';
import { CAPTURE } from '../core/config';

/**
 * CUKORKA-RABLÁS: a kétfős mód szabályai a házban.
 *
 * A menet a következő, és minden szava szabály:
 *
 *   felszedsz egy cukorkát → a KEZEDBEN van, még nem pont
 *   beviszed a SAJÁT sarkodba (piros vagy kék) → most már pont
 *   ha közben lelőnek → ellök, és MINDEN, ami a kezedben volt, a földre esik
 *   a földön fekvőt bárki felszedheti — beleértve azt, aki lelőtt
 *
 * Ez a szerkezet adja a játék egyetlen igazi döntését: viszed-e még egyet,
 * vagy beadod, amid van. Egy cukorka, ami a felvétel pillanatában pontot ér,
 * nem kockázat, csak sietés.
 *
 * Egy dolgot külön kellett kezelni, és ez volt a legkevésbé kézenfekvő: aki
 * elejtette, az egy pillanatig NE szedhesse fel újra. Enélkül a lövés
 * eredménye annyi lenne, hogy a célpont egy fél másodpercig hajol, aztán
 * minden megy tovább — a támadónak nem lenne ideje odaérni, tehát a lövésnek
 * nem lenne értelme.
 */

export interface Loose {
  position: THREE.Vector3;
  /** Ki ejtette el. Ő egy pillanatig nem szedheti fel. Lásd `CAPTURE.graceOwn`. */
  droppedBy: number | null;
  /** Mióta fekszik itt. */
  age: number;
}

export interface Corner {
  /** Melyik játékosé: 0 = piros, 1 = kék. */
  player: 0 | 1;
  position: THREE.Vector3;
}

export class Capture {
  /** Ami a kezükben van, játékosonként. */
  readonly carried: [number, number] = [0, 0];
  /** Ami már a sarokban van — ez a pontszám. */
  readonly banked: [number, number] = [0, 0];
  /** A földön fekvő cukorkák. */
  readonly loose: Loose[] = [];
  /** Amíg fut, a játékos repül és nem irányítja magát. */
  readonly knocked: [number, number] = [0, 0];

  constructor(readonly corners: readonly [Corner, Corner]) {}

  /** Nyert-e valaki, és ki. */
  get winner(): 0 | 1 | null {
    if (this.banked[0] >= CAPTURE.win) return 0;
    if (this.banked[1] >= CAPTURE.win) return 1;
    return null;
  }

  update(dt: number): void {
    for (const i of [0, 1] as const) {
      this.knocked[i] = Math.max(0, this.knocked[i] - dt);
    }
    // A FÖLDÖN FEKVŐ CUKORKA ELFOGY. A kiszórt zsákmány így nem raktár,
    // hanem lehetőség: aki közelebb van, oda tud érni, de futnia kell.
    for (let i = this.loose.length - 1; i >= 0; i--) {
      this.loose[i].age += dt;
      if (this.loose[i].age > CAPTURE.looseLife) this.loose.splice(i, 1);
    }
  }

  /** A tálból felszedett cukorka a KÉZBE kerül, nem a pontszámba. */
  takeFromBowl(player: 0 | 1): boolean {
    if (this.carried[player] >= CAPTURE.carry) return false;
    this.carried[player]++;
    return true;
  }

  /**
   * Felszedi a lábánál fekvő cukorkát, ha van olyan, amit felszedhet.
   * @returns hány darabot szedett fel (0 vagy 1).
   */
  pickUpLoose(player: 0 | 1, at: THREE.Vector3, reach = 1.5): number {
    if (this.carried[player] >= CAPTURE.carry) return 0;
    const index = this.loose.findIndex(
      (p) =>
        p.position.distanceTo(at) <= reach &&
        // Aki elejtette, egy pillanatig nem kapja vissza.
        !(p.droppedBy === player && p.age < CAPTURE.graceOwn)
    );
    if (index < 0) return 0;
    this.loose.splice(index, 1);
    this.carried[player]++;
    return 1;
  }

  /** A saját sarokban letéve lesz pont. A MÁSIK sarka nem jó. */
  bank(player: 0 | 1, at: THREE.Vector3): number {
    if (this.carried[player] === 0) return 0;
    const corner = this.corners.find((c) => c.player === player);
    if (!corner || corner.position.distanceTo(at) > CAPTURE.bankRadius) return 0;
    const put = this.carried[player];
    this.banked[player] += put;
    this.carried[player] = 0;
    return put;
  }

  /**
   * Eltalálták: ellökés és MINDEN kézben lévő cukorka a földre.
   *
   * @param from A lövés kiindulópontja — ebbe az irányba repül a célpont.
   * @returns Az ellökés sebességvektora, amit a jelenet a testre ad, és hogy
   * hány cukorka esett ki. A `Capture` nem mozgat testet: nem ismeri a
   * falakat, a ház dolga kiszámolni, meddig repül.
   */
  /**
   * @param strength 0..1 — mennyire volt erős a találat. A sörétes a
   * hatótávja szélén már csak EGY cukorkát ver ki, és alig lök; közelről
   * mindent. Egy fegyver, ami a hatótáv végéig ugyanolyan halálos, nem
   * sörétes, hanem lézer.
   */
  hit(
    player: 0 | 1,
    at: THREE.Vector3,
    from: THREE.Vector3,
    strength = 1
  ): { push: THREE.Vector3; dropped: number } {
    const dir = at.clone().sub(from);
    dir.y = 0;
    if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize();

    // Gyenge találatra csak egy darab esik ki — de legalább egy, különben a
    // lövésnek a hatótáv szélén semmi következménye nem lenne.
    const dropped =
      strength >= 0.99
        ? this.carried[player]
        : Math.min(this.carried[player], Math.max(1, Math.round(this.carried[player] * strength)));
    const kept = this.carried[player] - dropped;
    for (let i = 0; i < dropped; i++) {
      // Szétszóródnak, nem egy kupacba: egy kupacot egy mozdulattal
      // visszaszedne az, aki elejtette.
      const angle = (i / Math.max(1, dropped)) * Math.PI * 2 + Math.random() * 0.6;
      const r = CAPTURE.spread * (0.55 + Math.random() * 0.45);
      this.loose.push({
        position: new THREE.Vector3(at.x + Math.cos(angle) * r, at.y, at.z + Math.sin(angle) * r),
        droppedBy: player,
        age: 0,
      });
    }
    this.carried[player] = kept;
    this.knocked[player] = CAPTURE.knockTime * Math.max(0.35, strength);

    return { push: dir.multiplyScalar(CAPTURE.knockback * Math.max(0.3, strength)), dropped };
  }

  /** Irányítható-e most a játékos. Repülés közben nem. */
  canMove(player: 0 | 1): boolean {
    return this.knocked[player] === 0;
  }
}
