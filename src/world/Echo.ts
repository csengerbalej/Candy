import * as THREE from 'three';
import { NOISE } from '../core/config';
import type { NoiseEvent, NoiseSystem } from '../systems/NoiseSystem';

/**
 * A zaj, amitől LÁTSZIK a szoba.
 *
 * A sötét házban a hallás nem csak az üldözőké. Minden zajesemény — a te
 * futásod, egy érkezés, egy csíny, a kutya ugatása — fellobbant egy fénykört
 * a saját helyén, és az a kör LASSAN HALVÁNYUL EL, nem azonnal. Ettől a
 * hangnak formája lesz: egy csíny a szoba túlvégében nem csak elcsalja a
 * lakót, hanem meg is mutatja, mi van ott.
 *
 * És a csere tiszta: ami felfed, az el is árul. Ugyanaz a futás, ami látni
 * engedi a folyosót, hozza rád a kutyát. Ezért nem „ingyen lámpa" — ezért
 * döntés.
 *
 * Fényekkel megy, nem utófeldolgozással: a szoba anyagai amúgy is fényre
 * reagálnak, tehát ugyanaz a zaj ugyanúgy világítja meg a bútort, mint a
 * lakó zseblámpája. Egy előre lefoglalt készlet forog körbe, hogy egy zajos
 * pillanat ne foglaljon le tetszőleges sok fényt.
 */
export class Echo {
  readonly group = new THREE.Group();

  private readonly lights: THREE.PointLight[] = [];
  private readonly life: number[] = [];
  private readonly peak: number[] = [];
  private next = 0;
  private seen = 0;

  /** Meddig marad a visszhang. Nem villanás: ennyi ideje van megjegyezni. */
  private static readonly FADE = 3.4;

  constructor(private readonly count = 12) {
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xbcd0ff, 0, 1, 2);
      light.visible = false;
      this.group.add(light);
      this.lights.push(light);
      this.life.push(0);
      this.peak.push(0);
    }
  }

  /**
   * Új zajokat vesz fel, a régieket halványítja.
   *
   * A `NoiseSystem` eseményei rövid életűek (0,35 mp), tehát nem elég
   * végignézni őket — az ÚJAKAT kell elkapni, amíg élnek. Az `ttl`-ből
   * derül ki, melyik friss: a most kiadotté még teljes.
   */
  update(dt: number, noise: NoiseSystem): void {
    for (const e of noise.events) {
      if (e.ttl < NOISE.eventLifetime - 1e-6) continue;
      this.add(e);
    }

    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const t = Math.max(0, this.life[i] / Echo.FADE);
      // Négyzetesen halványul: az első pillanat erős és olvasható, a vége
      // hosszan elnyúló derengés. Lineárisan az egész fél idő alatt eltűnne.
      this.lights[i].intensity = this.peak[i] * t * t;
      if (this.life[i] <= 0) this.lights[i].visible = false;
    }
  }

  private add(e: NoiseEvent): void {
    const i = this.next;
    this.next = (this.next + 1) % this.count;
    this.seen++;

    const light = this.lights[i];
    light.position.copy(e.position).setY(4.5);
    // A fénykör akkora, mint maga a zaj: egy halk lépés egy karnyújtást
    // mutat meg, egy csíny fél szobát. A hangerő ÉS a látvány ugyanaz a szám.
    light.distance = e.radius * 1.35;
    // A nagy zaj nem csak messzebb ér, hanem erősebb is — de nem lineárisan,
    // különben a csíny kivilágítaná az egész lakást.
    this.peak[i] = 90 + Math.sqrt(e.radius) * 26;
    light.intensity = this.peak[i];
    light.visible = true;
    this.life[i] = Echo.FADE;
  }

  /** Hány zajt vett fel eddig — a mérésnek. */
  get taken(): number {
    return this.seen;
  }

  /** Épp hány visszhang világít. */
  get active(): number {
    return this.life.filter((l) => l > 0).length;
  }
}
