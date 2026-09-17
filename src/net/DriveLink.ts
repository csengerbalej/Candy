import * as THREE from 'three';
import type { RoomTransport } from './Room';
import { TOPICS } from './NetSession';
import type { Car } from '../vehicle/Car';

/**
 * A vezetés két eszköz között.
 *
 * A szereposztás itt magától adódik, és nem is lehetne másképp: az AUTÓT az
 * szimulálja, aki vezeti. Egy autót nem lehet két gépen egyszerre számolni —
 * a két eredmény azonnal elcsúszna, és semmi nem mondaná meg, melyiknek van
 * igaza. A navigátor gépe nem szimulál semmit: megkapja, hol az autó, és a
 * térképét abból rajzolja.
 *
 * Ami merre megy:
 *
 *   sofőr  → presence   az autó helye, iránya, sebessége + a pontszám.
 *                       Abszolút állapot, másodpercenként ~30-szor. Ha egy
 *                       csomag elveszik, a következő úgyis felülírja.
 *
 *   navigátor → emit    a három igéje (célpont, irányjelzés, radar) és a
 *                       kiszállás. Ezek PILLANATOK, nem állapotok — és mivel
 *                       az esemény elveszhet, egyik sem számlál semmit: a
 *                       sofőr gépe vezeti a pontszámot, és azt teszi ki
 *                       presence-be.
 */

/** Amit a sofőr gépe kitesz magáról. Rövid kulcsok: 4 KiB a keret. */
interface DrivePresence {
  /** x, z, irány, sebesség */
  c?: [number, number, number, number];
  /** magasság a talaj fölött, és az oldalcsúszás — az ugrás és a drift */
  j?: [number, number];
  /** a célpont háza */
  t?: number;
  /** pontszám */
  s?: number;
  /** megérkeztek-e */
  a?: boolean;
  /** a radar hátralévő ideje, hogy a navigátor térképe is villogjon */
  r?: number;
}

export type DriveVerb = 'target' | 'ping' | 'radar';

export class DriveLink {
  /** A sofőrtől kapott legutolsó állapot; a navigátor gépe ebből rajzol. */
  readonly remote: DrivePresence = {};
  /** Ki szállt ki a kocsiból — mindkét gép számon tartja. */
  readonly outOfCar: [boolean, boolean] = [false, false];

  private readonly stops: Array<() => void> = [];
  private lastSent = 0;

  constructor(
    private readonly room: RoomTransport | null,
    private readonly amDriver: boolean,
    private readonly onVerb: (verb: DriveVerb) => void
  ) {
    if (!room) return;

    this.stops.push(
      room.on(TOPICS.verb, (msg) => {
        // A saját visszhangunkat eldobjuk: a helyi gomb már hatott.
        if (msg.isMe || !this.amDriver) return;
        const verb = (msg.data as { v?: string } | undefined)?.v;
        if (verb === 'target' || verb === 'ping' || verb === 'radar') this.onVerb(verb);
      })
    );

    this.stops.push(
      room.on(TOPICS.act, (msg) => {
        const data = msg.data as { a?: string; i?: number } | undefined;
        if (data?.a !== 'out') return;
        const index = data.i === 1 ? 1 : 0;
        this.outOfCar[index] = true;
      })
    );
  }

  dispose(): void {
    for (const stop of this.stops) stop();
    this.stops.length = 0;
  }

  /**
   * MINDKÉT gép kiteszi a SAJÁT autóját. Másodpercenként ~30-szor bőven elég.
   *
   * Eddig csak a sofőré tette ki, mert egy autó volt. Két autónál a szabály
   * ugyanaz marad — egy autót egy gép számol —, csak most mindkettőnek van
   * mit kitennie. Ez nem bonyolítás: pontosan attól működik, hogy senki nem
   * számolja a másikét.
   */
  publish(car: Car, targetId: number, score: number, arrived: boolean, radarLeft: number): void {
    if (!this.room) return;
    const now = Date.now();
    if (now - this.lastSent < 33) return;
    this.lastSent = now;
    this.room.presence({
      c: [
        Math.round(car.position.x * 100) / 100,
        Math.round(car.position.z * 100) / 100,
        Math.round(car.heading * 1000) / 1000,
        Math.round(car.speed * 100) / 100,
      ],
      j: [Math.round(car.height * 100) / 100, Math.round(car.lateral * 100) / 100],
      t: targetId,
      s: Math.round(score),
      a: arrived,
      r: Math.round(radarLeft * 10) / 10,
    } satisfies DrivePresence as unknown as Record<string, unknown>);
  }

  /**
   * A TÁRS autóját rajzoljuk a kapott állapotból.
   *
   * A sajátunkat sosem — azt mi számoljuk. Ha mindkét gép átvenné a másikét,
   * a két kocsi egymást rángatná, és egyiknek sem lenne igaza.
   */
  apply(car: Car, peers: readonly { isMe: boolean; presence: Readonly<Record<string, unknown>> }[]): void {
    const from = peers.find((p) => !p.isMe && Array.isArray((p.presence as DrivePresence).c));
    if (!from) return;
    const state = from.presence as DrivePresence;
    const c = state.c;
    if (!c) return;
    // Simítva, nem ugrasztva: a csomagok 30-szor jönnek másodpercenként, a
    // kép 60-szor rajzolódik, tehát minden második képkockára jutna ugrás.
    car.position.lerp(new THREE.Vector3(c[0], 0, c[1]), 0.35);
    car.heading = lerpAngle(car.heading, c[2], 0.35);
    car.speed = c[3];
    // Az ugrás és a drift a társ gépén is látszódjon: enélkül a navigátor
    // képernyőjén a kocsi végig a földön csúszna, és a vezető trükkjeiből
    // semmit nem látna — pedig ketten ülnek ugyanabban a kocsiban.
    if (state.j) {
      car.height = state.j[0];
      car.lateral = state.j[1];
    }
    Object.assign(this.remote, state);
  }

  /** A navigátor gépe küldi az igét; a sofőré hajtja végre. */
  sendVerb(verb: DriveVerb): void {
    this.room?.emit(TOPICS.verb, { v: verb });
  }

  /** Bárki küldi, ha kiszállt; a sofőr gépe számolja össze. */
  sendOut(index: 0 | 1): void {
    this.outOfCar[index] = true;
    this.room?.emit(TOPICS.act, { a: 'out', i: index });
  }
}

function lerpAngle(from: number, to: number, t: number): number {
  let d = ((to - from + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return from + d * t;
}
