import * as THREE from 'three';
import { STREET } from '../core/config';

/**
 * A SZTRÁDA FORGALMA: autók a városon kívüli körpályán.
 *
 * A városban a forgalom rácson jár és lámpánál áll. Itt egyik sincs: egyetlen
 * kör van, és rajta nagy sebességgel haladó autók. Ettől lesz a két szakasz
 * érezhetően más — a város szabályos és lassú, a sztráda gyors és kérlelhetetlen.
 *
 * A mozgás SZÖGBEN történik, nem koordinátákban: a kör mentén mindenki egy
 * szöggel halad, és a szög sugárral szorozva adja a helyet. Ettől az ívek
 * pontosak maradnak akkor is, ha valaki nagyon gyorsan megy — koordinátánként
 * léptetve a gyors autó fokozatosan kifelé spirálozna.
 *
 * Két sáv van, két iránnyal. A belső sáv az óramutatóval, a külső ellene —
 * ahogy egy valódi körpályán.
 */

interface Racer {
  mesh: THREE.Object3D;
  /** Hol tart a körön, radiánban. */
  angle: number;
  /** Melyik sávban: −1 belső, +1 külső. */
  lane: -1 | 1;
  /** Egység/másodperc. */
  speed: number;
  /** Melyik modellt kapta. A gyorsat és a lassút szemre meg kell tudni különböztetni. */
  fast: boolean;
}

export class MotorwayTraffic {
  readonly group = new THREE.Group();
  private readonly racers: Racer[] = [];
  private readonly middle: number;

  /** A két sáv középvonala a körpálya közepétől. */
  private static readonly LANE_GAP = 4.2;

  constructor(
    motorway: { inner: number; outer: number; middle: number },
    count: number,
    private readonly random: () => number = Math.random
  ) {
    this.middle = motorway.middle;
    for (let i = 0; i < count; i++) {
      // Minden HARMADIK a gyors: a BMW ritka, és pont ettől esemény, amikor
      // elhúz melletted. Ha mind a tíz kétszázzal menne, egyik sem lenne
      // gyors — csak a sztráda volna zajos.
      const fast = i % 3 === 0;
      const box = new THREE.Mesh(
        new THREE.BoxGeometry(1.9, 1.3, 4.3),
        new THREE.MeshStandardMaterial({ color: fast ? 0x1e1730 : 0x4a2110 })
      );
      box.position.y = 0.7;
      const holder = new THREE.Group();
      holder.add(box);
      this.group.add(holder);
      this.racers.push({
        mesh: holder,
        angle: (i / count) * Math.PI * 2 + this.random() * 0.4,
        lane: i % 2 === 0 ? -1 : 1,
        speed: fast ? STREET.motorwayFast : STREET.motorwaySlow,
        fast,
      });
    }
    this.place();
  }

  /** A letöltött modellek beültetése a dobozok helyére. */
  setArt(make: (fast: boolean) => THREE.Object3D): void {
    for (const r of this.racers) {
      r.mesh.clear();
      const art = make(r.fast);
      r.mesh.add(art);
    }
  }

  update(dt: number): void {
    for (const r of this.racers) {
      const radius = this.middle + r.lane * MotorwayTraffic.LANE_GAP;
      // SZÖGSEBESSÉG: az ívhosszból, hogy minden autó a saját sebességével
      // menjen, függetlenül attól, melyik sávban van. Ugyanaz a szögsebesség
      // a külső sávban gyorsabb autót jelentene — és a két sáv sosem
      // maradna szinkronban.
      r.angle += ((r.speed * dt) / radius) * (r.lane === -1 ? 1 : -1);
    }
    this.place();
  }

  private place(): void {
    for (const r of this.racers) {
      const radius = this.middle + r.lane * MotorwayTraffic.LANE_GAP;
      const x = Math.sin(r.angle) * radius;
      const z = Math.cos(r.angle) * radius;
      r.mesh.position.set(x, 0, z);
      // Az orr az ÉRINTŐ irányába néz — a kör mentén, nem a középpont felé.
      r.mesh.rotation.y = r.angle + (r.lane === -1 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  /** A mérésnek: hol vannak és milyen gyorsak. */
  get cars(): readonly { position: THREE.Vector3; speed: number; fast: boolean }[] {
    return this.racers.map((r) => ({ position: r.mesh.position, speed: r.speed, fast: r.fast }));
  }
}
