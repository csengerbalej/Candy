import * as THREE from 'three';
import { PICKUP, GUNS, type GunId } from '../core/config';
import { Weapon } from './Weapon';

/**
 * A PÁLYÁN HEVERŐ FEGYVEREK.
 *
 * Négy darab van kint egyszerre, véletlen helyeken. Mindegyik elpárolog egy
 * idő után, és máshol bukkan fel újra — egy örökké ott heverő fegyver egy idő
 * után csak egy gomb a pályán, egy elfogyó viszont döntés: most mész érte,
 * vagy lemondasz róla.
 *
 * A felvételnek két esete van, és a kettő NEM ugyanaz:
 *
 *   ugyanolyat veszel fel, mint ami a kezedben van → LŐSZERT kapsz
 *   másikat veszel fel                            → CSERE: az új lesz nálad,
 *                                                    a régi a lábad elé esik
 *
 * A régi leejtése szándékos. Eldobni egyszerűbb lenne, de akkor a csere
 * ingyen van; így viszont amit letettél, azt a MÁSIK JÁTÉKOS felveheti — a
 * fegyverváltás is ad valamit az ellenfélnek, mint minden más ebben a módban.
 */

export interface Dropped {
  kind: GunId;
  position: THREE.Vector3;
  /** Mennyi ideje van hátra, mielőtt elpárolog. */
  left: number;
  /** Ennyi lőszer van benne. Egy leejtett fegyver a saját tartalékát viszi. */
  ammo: number;
}

export interface PickResult {
  kind: GunId;
  /** Csere történt-e (más fegyver volt a kézben). */
  swapped: boolean;
  /** Mennyi lőszert kaptunk. */
  ammo: number;
  /** A leejtett régi fegyver, ha volt csere. */
  dropped: Dropped | null;
}

export class Armoury {
  readonly items: Dropped[] = [];
  /** Amikor egy hely megüresedett: mennyi idő múlva jön az új. */
  private pending: number[] = [];

  /**
   * @param spots Ahová fegyver kerülhet. A jelenet adja — a fegyver nem tudja,
   * mi a járható a házban, és nem is kell tudnia.
   */
  constructor(
    private readonly spots: readonly THREE.Vector3[],
    private readonly random: () => number = Math.random
  ) {
    for (let i = 0; i < PICKUP.live; i++) this.spawn();
  }

  /** Súlyozott sorsolás: a rakétavető a legritkább. */
  private pickKind(): GunId {
    const kinds = Object.keys(GUNS) as GunId[];
    const total = kinds.reduce((n, k) => n + PICKUP.weights[k], 0);
    let roll = this.random() * total;
    for (const k of kinds) {
      roll -= PICKUP.weights[k];
      if (roll <= 0) return k;
    }
    return kinds[0];
  }

  private spawn(): void {
    if (!this.spots.length) return;
    // Ne ugyanoda, ahol már fekszik egy: két fegyver egy kupacban fél
    // felvétel, és a pálya felét üresen hagyja.
    let spot: THREE.Vector3 | null = null;
    for (let tries = 0; tries < 12; tries++) {
      const candidate = this.spots[Math.floor(this.random() * this.spots.length)];
      if (this.items.every((i) => i.position.distanceTo(candidate) > 6)) {
        spot = candidate;
        break;
      }
    }
    if (!spot) return;
    const kind = this.pickKind();
    this.items.push({
      kind,
      position: spot.clone(),
      left: PICKUP.life * (0.7 + this.random() * 0.6),
      ammo: PICKUP.packs[kind],
    });
  }

  update(dt: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      this.items[i].left -= dt;
      if (this.items[i].left <= 0) {
        this.items.splice(i, 1);
        this.queue();
      }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      this.pending[i] -= dt;
      if (this.pending[i] <= 0) {
        this.pending.splice(i, 1);
        this.spawn();
      }
    }
  }

  /** Egy hely megüresedett: időzítjük az újat. */
  private queue(): void {
    const wait = PICKUP.respawnMin + this.random() * (PICKUP.respawnMax - PICKUP.respawnMin);
    this.pending.push(wait);
  }

  /** Egy leejtett fegyver visszakerül a pályára — a csere maradéka. */
  drop(kind: GunId, position: THREE.Vector3, ammo: number): Dropped {
    const item: Dropped = { kind, position: position.clone(), left: PICKUP.life, ammo };
    this.items.push(item);
    return item;
  }

  /**
   * Megpróbálja felvenni a lábunknál fekvő fegyvert.
   *
   * @param held Ami most a kézben van, vagy `null`.
   * @returns `null`, ha nincs mit felvenni.
   */
  tryPickUp(at: THREE.Vector3, held: Weapon | null): PickResult | null {
    const index = this.items.findIndex((i) => i.position.distanceTo(at) <= PICKUP.reach);
    if (index < 0) return null;
    const item = this.items[index];

    // UGYANAZ A FEGYVER: nem cserélünk, hanem töltünk. Ha viszont tele van a
    // tartalék, a darab MARAD a földön — különben egy telt tárral ráállva
    // eltüntetnéd azt, amire a másiknak szüksége van.
    if (held && held.kind === item.kind) {
      const cap = PICKUP.maxReserve[item.kind];
      if (held.reserve >= cap) return null;
      const take = Math.min(item.ammo, cap - held.reserve);
      held.reserve += take;
      this.items.splice(index, 1);
      this.queue();
      return { kind: item.kind, swapped: false, ammo: take, dropped: null };
    }

    // MÁSIK FEGYVER: csere. A régi a lábunk elé esik, a benne maradt
    // lőszerrel együtt.
    this.items.splice(index, 1);
    this.queue();
    let dropped: Dropped | null = null;
    if (held) {
      dropped = this.drop(held.kind, at, held.ammo + held.reserve);
    }
    return { kind: item.kind, swapped: !!held, ammo: item.ammo, dropped };
  }

  /** Új fegyver a felvett fajtából, feltöltve. A jelenet ezt adja a kézbe. */
  static make(kind: GunId, ammo: number): Weapon {
    const w = new Weapon(kind);
    w.reserve = Math.min(PICKUP.maxReserve[kind], ammo);
    return w;
  }
}
