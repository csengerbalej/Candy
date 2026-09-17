import * as THREE from 'three';
import { RIVAL, CAPTURE, MOVE, HOUSE } from '../core/config';
import type { Capture } from '../game/Capture';
import type { Weapon, Target } from '../game/Weapon';

/**
 * AZ AI ELLENFÉL a házban.
 *
 * Egyedül játszva is van kivel versenyezni: egy másik tolvaj, aki ugyanazt
 * akarja, amit te. Ugyanaz a sebessége, ugyanannyi fér a kezébe, a lakó őt is
 * kergeti, és neki is a SAJÁT sarkába kell bevinnie a cukorkát.
 *
 * NEM CSAL — ez a legfontosabb döntés benne. Egy AI, ami gyorsabb vagy
 * mindent lát, nem ellenfél, hanem büntetés. Amiben más, az a reakcióideje és
 * a bátorsága; ezen lehet állítani úgy, hogy a játékos ne érezze
 * igazságtalannak.
 *
 * Öt állapota van, és mind a öt egy kérdésre felel:
 *
 *   GYŰJT     — hol a legközelebbi cukorka?
 *   HAZAVISZ  — elég van a kezemben, be a sarokba
 *   MENEKÜL   — a lakó túl közel van; a cukorka nem ér annyit
 *   LŐ        — van fegyverem és van kire
 *   VÁR       — bénult vagyok, vagy épp repülök
 */

export type RivalState = 'GYUJT' | 'HAZAVISZ' | 'MENEKUL' | 'LO' | 'VAR';

export interface RivalWorld {
  /** Ahol cukorka VAN, felszedhető állapotban. */
  bowls(): THREE.Vector3[];
  /** Járható-e ez a pont. */
  walkable(x: number, z: number, radius: number): boolean;
  /** Út A-ból B-be, ha van. Üres tömb, ha nincs. */
  route(from: THREE.Vector3, to: THREE.Vector3, radius: number): THREE.Vector3[];
  /**
   * Megpróbál kivenni egy cukorkát a lábánál lévő TÁLBÓL.
   *
   * A tálak a jelenet tárgyai (modell, fedél, animáció), az AI nem ismeri
   * őket — csak megkérdezi, sikerült-e. Enélkül az AI kizárólag a földön
   * fekvő darabokat szedte fel, és a tálak mellett állva tétlenül várt: nem
   * hibázott, csak nem volt mivel játszania.
   */
  takeBowl(at: THREE.Vector3): boolean;
  /** Hol van a lakó (és a kutya), hogy félni tudjon tőlük. */
  dangers(): THREE.Vector3[];
  /** Látja-e A pont B-t. */
  sightBlocked(a: THREE.Vector3, b: THREE.Vector3): boolean;
}

export class Rival {
  readonly position = new THREE.Vector3();
  state: RivalState = 'GYUJT';
  /** A fegyvere, ha talált egyet. */
  weapon: Weapon | null = null;

  private path: THREE.Vector3[] = [];
  private think = 0;
  private shootWait = 0;
  /** Amíg fut, a tálból emel — ugyanannyi ideig, mint a játékos. */
  private grabbing = 0;
  /**
   * Célpontok, amikhez hozzáért, de nem jött össze.
   *
   * Enélkül az AI ráállt a tálra, nem tudta kivenni, és a következő
   * döntésnél megint ugyanazt választotta — örökké. Nem beragadás volt,
   * hanem VÉGTELEN JÓ DÖNTÉS ugyanarra a rossz célpontra.
   */
  private readonly skip: Array<{ at: THREE.Vector3; left: number }> = [];

  constructor(
    spawn: THREE.Vector3,
    private readonly world: RivalWorld,
    /** Melyik játékos ő a `Capture`-ben: 0 vagy 1. */
    readonly index: 0 | 1 = 1,
    private readonly random: () => number = Math.random
  ) {
    this.position.copy(spawn);
  }

  /**
   * @param game A közös szabálytábla — a cukorka, a sarok és az ellökés
   * mind ott él. Az AI nem a saját könyvelését vezeti: ugyanazokat a
   * hívásokat használja, amiket a játékos gombjai.
   * @param enemy A JÁTÉKOS helye — erre lő, ha van mivel.
   * @returns A lövés, ha lőtt: a jelenet ebből csinál zajt és találatot.
   */
  update(
    dt: number,
    game: Capture,
    enemy: Target | null
  ): { shot: ReturnType<Weapon['fire']> } | null {
    this.weapon?.update(dt, this.state !== 'LO');
    this.shootWait = Math.max(0, this.shootWait - dt);

    // Repülés közben nincs döntés — ez ugyanaz a szabály, ami rád is
    // vonatkozik, amikor lelőnek.
    if (!game.canMove(this.index)) {
      this.state = 'VAR';
      return null;
    }

    for (let i = this.skip.length - 1; i >= 0; i--) {
      this.skip[i].left -= dt;
      if (this.skip[i].left <= 0) this.skip.splice(i, 1);
    }

    // EMELÉS a tálból: ugyanannyi ideig tart, mint a játékosnak.
    if (this.grabbing > 0) {
      this.grabbing -= dt;
      if (this.grabbing <= 0 && game.carried[this.index] < CAPTURE.carry) {
        if (this.world.takeBowl(this.position)) game.takeFromBowl(this.index);
        else this.skip.push({ at: this.position.clone(), left: 6 });
        this.think = 0;
      }
      return null;
    }

    this.think -= dt;
    if (this.think <= 0) {
      this.think = RIVAL.reaction;
      this.decide(game, enemy);
    }

    // LŐ: megáll és tüzel. Azért áll meg, mert te sem tudsz futás közben
    // célozni — és mert egy mozgó, lövő AI ellen nincs mit tenni.
    if (this.state === 'LO' && enemy && this.weapon) {
      if (this.shootWait === 0 && this.weapon.ready) {
        this.shootWait = RIVAL.shootEvery;
        const aim = Math.atan2(
          enemy.position.x - this.position.x,
          enemy.position.z - this.position.z
        ) + (this.random() - 0.5) * (RIVAL.aimError / 8);
        const shot = this.weapon.fire(this.position, aim, [enemy], (a, b) =>
          this.world.sightBlocked(a, b)
        );
        return { shot };
      }
      return null;
    }

    this.walk(dt, game);
    return null;
  }

  /** Mi legyen most. Egy döntés a reakcióidőnként, nem képkockánként. */
  private decide(game: Capture, enemy: Target | null): void {
    const danger = this.nearestDanger();
    // MENEKÜL: a lakó közelebb van, mint a félelmi sugár. A cukorka nem ér
    // annyit — ahogy neked sem éri meg belefutni.
    if (danger && danger.distanceTo(this.position) < RIVAL.fearRadius) {
      this.state = 'MENEKUL';
      const away = this.position.clone().sub(danger).setLength(14).add(this.position);
      this.path = this.world.route(this.position, away, MOVE.radius);
      return;
    }

    // LŐ: van fegyver, van lőszer, van célpont, és LÁTJA is. A takarásban
    // álló játékosra nem lő — különben falon át vadászna.
    if (
      this.weapon &&
      this.weapon.ammo > 0 &&
      enemy &&
      enemy.position.distanceTo(this.position) < RIVAL.shootFrom &&
      !this.world.sightBlocked(this.position, enemy.position)
    ) {
      this.state = 'LO';
      return;
    }

    // HAZAVISZ: elég van a kezében. A kapzsiság határa konfigban él, nem
    // beégetve — ettől lehet az AI óvatos vagy vakmerő.
    const corner = game.corners.find((c) => c.player === this.index);
    if (corner && game.carried[this.index] >= Math.min(RIVAL.greed, CAPTURE.carry)) {
      this.state = 'HAZAVISZ';
      this.path = this.world.route(this.position, corner.position, MOVE.radius);
      return;
    }

    // GYŰJT: a legközelebbi cukorka. A FÖLDÖN fekvő előbbre való, mint a
    // tálban lévő — az már ki van csomagolva, és bármelyik pillanatban
    // felszedheti más.
    const loose = game.loose.map((l) => l.position);
    const wanted = [...loose, ...this.world.bowls()].filter(
      (w) => !this.skip.some((s) => s.at.distanceTo(w) < 2)
    );
    if (!wanted.length) {
      this.state = 'HAZAVISZ';
      if (corner) this.path = this.world.route(this.position, corner.position, MOVE.radius);
      return;
    }
    const target = wanted.reduce((a, b) =>
      a.distanceTo(this.position) <= b.distanceTo(this.position) ? a : b
    );
    this.state = 'GYUJT';
    this.path = this.world.route(this.position, target, MOVE.radius);
  }

  /** Az útvonal következő pontja felé lép. */
  private walk(dt: number, game: Capture): void {
    if (!this.path.length) {
      // MEGÉRKEZETT, és nincs hova tovább. Gyűjtés közben ez azt jelenti,
      // hogy a célpont ott van a lába előtt: emelni kezd. Ha a tál nem adja
      // (elfogyott, vagy sosem volt ott), a következő döntés máshová küldi.
      if (this.state === 'GYUJT' && this.grabbing <= 0) {
        if (game.pickUpLoose(this.index, this.position) === 0) {
          this.grabbing = HOUSE.grabTime;
        }
      }
      return;
    }
    const next = this.path[0];
    const step = MOVE.walkSpeed * dt;
    const to = next.clone().sub(this.position);
    to.y = 0;
    const distance = to.length();
    if (distance <= step) {
      this.position.copy(next);
      this.path.shift();
    } else {
      this.position.addScaledVector(to.normalize(), step);
    }

    // Menet közben felszed és lerak — ugyanazokkal a hívásokkal, amikkel te.
    game.pickUpLoose(this.index, this.position);
    game.bank(this.index, this.position);
  }

  private nearestDanger(): THREE.Vector3 | null {
    const list = this.world.dangers();
    if (!list.length) return null;
    return list.reduce((a, b) =>
      a.distanceTo(this.position) <= b.distanceTo(this.position) ? a : b
    );
  }
}
