import * as THREE from 'three';
import { HAUNT } from '../core/config';

/**
 * A KÍSÉRTETHÁZ SZABÁLYAI.
 *
 * Csak a könyvelés van itt: ki áll a lábán, kinél a lámpa, mennyi maradt az
 * elemben, és mikor van vége. A szörnyek, a fény és az ijesztés a jelenet
 * dolga — ez a fájl az, ami MÉRHETŐ marad nélkülük is.
 *
 * A mód tétje egyetlen mondatban: ha mindketten a földön vagytok, a körnek
 * vége, és a cukorka is oda, amit addig gyűjtöttetek. Ezért kell egymásra
 * figyelnetek, és ezért nem elég gyorsnak lenni.
 */
export type HauntState = 'jatek' | 'vege';

export interface Downed {
  /** Áll-e még a lábán. */
  down: boolean;
  /** Mennyi ideje maradt, amíg felszedhető. */
  left: number;
  /** Hol ment le — ide kell menni érte. */
  at: THREE.Vector3;
  /** Hol tart a felszedése (0…HAUNT.revive). */
  lifting: number;
}

export class Haunt {
  state: HauntState = 'jatek';
  /** A lámpa telepe másodpercben. KÖZÖS: egy lámpa van kettőtökre. */
  torch: number = HAUNT.torch;
  /** Kinél van a lámpa. */
  torchHolder: 0 | 1 = 0;
  /** Világít-e éppen. Kikapcsolva nem fogy — a spórolás is döntés. */
  torchOn = true;
  /** Hányszor ijesztettek meg — a végi kiírásnak. */
  scares = 0;

  readonly down: [Downed, Downed] = [
    { down: false, left: 0, at: new THREE.Vector3(), lifting: 0 },
    { down: false, left: 0, at: new THREE.Vector3(), lifting: 0 },
  ];

  /** Az összegyűjtött cukorka. Elbukva mind elvész. */
  candy = 0;

  /**
   * BENT VAGY-E A SZEKRÉNYBEN.
   *
   * Nem állapotgép: egyetlen logikai érték, mert egyetlen dolgot jelent —
   * a szörnyek nem látnak, te sem látsz, és a lámpád nem ég. Minden más
   * ebből következik.
   */
  hidden = false;
  /** A szekrény helye, ahol bent vagy. */
  hideAt: THREE.Vector3 | null = null;

  /**
   * ELKAPTAK.
   *
   * Nem azonnali halál: összecsuklasz. A különbség nem kegyelem, hanem a
   * mód lényege — egy azonnali halál egyszemélyes játékká tenné, ahol a
   * társad legfeljebb nézi, hogy jársz.
   *
   * @returns igaz, ha ez az ütés most vitte le.
   */
  caught(who: 0 | 1, at: THREE.Vector3): boolean {
    const me = this.down[who];
    if (me.down || this.state === 'vege') return false;
    me.down = true;
    me.left = HAUNT.bleed;
    me.lifting = 0;
    me.at.copy(at);
    this.scares++;
    // MINDKETTEN A FÖLDÖN: nincs, aki felszedjen — vége.
    if (this.down[0].down && this.down[1].down) this.fail();
    return true;
  }

  /**
   * A TÁRSAD FÖLÖTT GUGGOLSZ.
   *
   * Hívni kell, amíg tart: a felszedés IDŐ, nem érintés. Aki menteni megy,
   * annak ott kell maradnia — és amíg ott van, ő is célpont.
   *
   * @param dt Ennyi idővel halad.
   * @returns igaz, ha ezzel talpra állt.
   */
  lift(who: 0 | 1, dt: number): boolean {
    const me = this.down[who];
    if (!me.down) return false;
    me.lifting += dt;
    if (me.lifting < HAUNT.revive) return false;
    me.down = false;
    me.lifting = 0;
    me.left = 0;
    return true;
  }

  /** Elengedted: a felszedés VISSZAESIK. Félig felhúzni nem ér semmit. */
  letGo(who: 0 | 1): void {
    this.down[who].lifting = 0;
  }

  /**
   * @param burning Fogy-e a telep ebben a lépésben (ég a lámpa és van kinél).
   */
  update(dt: number, burning = this.torchOn): void {
    if (this.state === 'vege') return;

    if (burning && this.torchOn) {
      this.torch = Math.max(0, this.torch - dt);
      // Kifogyott: nem hiba, hanem a sötét. A lámpa attól lámpa, hogy el is
      // fogyhat.
      if (this.torch === 0) this.torchOn = false;
    }

    for (const me of this.down) {
      if (!me.down) continue;
      me.left -= dt;
      if (me.left <= 0) this.fail();
    }
  }

  /** Elemcsomagot vettél fel. */
  charge(): void {
    this.torch = Math.min(HAUNT.torch, this.torch + HAUNT.battery);
    if (this.torch > 0) this.torchOn = true;
  }

  /** Átadod a lámpát. Egy van, tehát ez mindig csere. */
  passTorch(): void {
    this.torchHolder = this.torchHolder === 0 ? 1 : 0;
  }

  /**
   * KIJUTOTTATOK.
   *
   * Nem ugyanaz, mint a győzelem: kimenni bármikor ki lehet, akár üres
   * kézzel is. A `quota` csak azt mondja meg, sikerült-e — a kijárat nem
   * kérdezi meg. Ez a különbség az, amiből a kapzsiság-döntés lesz.
   */
  escape(): void {
    if (this.state === 'vege') return;
    this.state = 'vege';
    this.escaped = true;
  }

  /** Kijutottatok-e, vagy odabent ért véget. */
  escaped = false;

  private fail(): void {
    this.state = 'vege';
    // A ZSÁKMÁNY IS ODA. Enélkül az elbukás csak egy újrakezdés volna, és
    // semmi nem forogna kockán — pedig pont a tét az, amitől félni lehet.
    this.candy = 0;
  }

  /** Talpon van-e még valaki. A jelenet ebből tudja, kell-e ijeszteni. */
  get anyoneUp(): boolean {
    return this.down.some((d) => !d.down);
  }
}
