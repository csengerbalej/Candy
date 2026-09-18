import * as THREE from 'three';
import { STREET } from '../core/config';
import type { Car } from '../vehicle/Car';
import type { DriveWorld } from '../world/DriveWorld';

interface Critter {
  mesh: THREE.Object3D;
  position: THREE.Vector3;
  direction: THREE.Vector3;
  /** The tile they belong to, so they cross their street instead of wandering off. */
  home: THREE.Vector3;
  alongX: boolean;
  launched: number;
  velocity: THREE.Vector3;
  nearMissed: boolean;
  /** Mit csinál épp: ácsorog, kelni készül, vagy átfut. */
  mood: 'wander' | 'wait' | 'dash';
  moodLeft: number;
  /** Mennyivel gyorsabb ez a példány az alapnál. */
  pace: number;
  /**
   * Saját véletlenszám-forrás, példányonként.
   *
   * A globális `Math.random` futás közbeni hívása azt jelentené, hogy a
   * forgalom viselkedése attól függ, mi MÁS hívott véletlent ugyanabban a
   * képkockában — például mikor töltött be egy modell. Lemérve: a
   * testcsere-próba 5,5 egységnyi eltérést mutatott két egyébként azonos
   * futás között, pusztán ettől. Egy játék, aminek a nehézsége a hálózat
   * sebességétől függ, nem hangolható.
   */
  seed: number;
}

/**
 * Ennyivel a talaj fölött már elfér alattunk egy szörnyecske.
 *
 * A tok 1,34 magas, a közepén origózva — a teteje tehát 0,67-nél van. Egy
 * hajszállal fölötte: aki pont súrolja, az még elüti.
 */
const CRITTER_CLEARANCE = 0.72;

/** Az út két keresztirányú tengelye. Egy-egy példány, mert képkockánként kell. */
const ACROSS_Z = new THREE.Vector3(0, 0, 1);
const ACROSS_X = new THREE.Vector3(1, 0, 0);

/**
 * The little monsters (spec §9). They are not obstacles — they are the moral
 * centre of the driving section. Hitting one must be funny and costly, never
 * gory, and the near miss has to feel like a near miss.
 */
export class CritterTraffic {
  readonly group = new THREE.Group();
  readonly critters: Critter[] = [];

  /** Events for the scoring layer, drained each frame. */
  hits = 0;
  nearMisses = 0;

  constructor(private readonly world: DriveWorld) {
    for (let i = 0; i < STREET.critterCount; i++) this.spawn();
  }

  private spawn(): void {
    // Each critter is assigned one road tile and crosses it back and forth.
    // A VÁROS utcái, az autópálya NÉLKÜL.
    //
    // A körpálya ugyanúgy úttest, mint bármelyik utca, tehát a véletlen
    // választás oda is szórt szörnyecskéket. Egy autópályán gyalogoló szörny
    // viszont nem nehezítés, hanem hiba: ott nem kelni át kell, hanem
    // száguldani.
    // EGY CSEMPÉNYI RÁHAGYÁSSAL. A csempe tizenkét egység széles, a
    // szörnyecske pedig a csempéjén ÁTKEL — tehát a szomszédos csempéről is
    // rálép a pályára. Ezért nem a csempe közepét nézzük, hanem a szélét is.
    const margin = this.world.tileSize;
    const tiles = this.world.roads.filter((t) => {
      for (const [dx, dz] of [[0, 0], [margin, 0], [-margin, 0], [0, margin], [0, -margin]]) {
        if (this.world.onMotorway(t.centre.x + dx, t.centre.z + dz)) return false;
      }
      return true;
    });
    const tile = tiles[Math.floor(Math.random() * tiles.length)];
    const home = tile ? tile.centre.clone() : new THREE.Vector3();
    const alongX = Math.random() < 0.5;
    const offset = (Math.random() * 2 - 1) * this.world.tileSize * 0.3;

    const position = alongX
      ? new THREE.Vector3(home.x + offset, 0, home.z - this.world.tileSize * 0.35)
      : new THREE.Vector3(home.x - this.world.tileSize * 0.35, 0, home.z + offset);
    const direction = alongX ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);

    const hue = 0.25 + Math.random() * 0.5;
    const mesh: THREE.Object3D = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.42, 0.5, 4, 10),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(hue, 0.75, 0.6),
        emissive: new THREE.Color().setHSL(hue, 0.8, 0.22),
        roughness: 0.55,
      })
    );
    mesh.castShadow = true;
    this.group.add(mesh);

    this.critters.push({
      mesh,
      position,
      direction,
      home,
      alongX,
      launched: 0,
      velocity: new THREE.Vector3(),
      nearMissed: false,
      mood: 'wander',
      moodLeft: 1 + Math.random() * 3,
      pace: 0.75 + Math.random() * 0.7,
      seed: Math.floor(Math.random() * 0x7fffffff),
    });
  }

  /**
   * Swap every placeholder for the authored critter. Called once the model
   * resolves; the traffic simulation is already running by then, so each
   * replacement inherits the transform of the capsule it replaces.
   */
  setArt(make: () => THREE.Object3D): void {
    for (const c of this.critters) {
      const art = make();
      art.position.copy(c.mesh.position);
      art.rotation.copy(c.mesh.rotation);
      this.group.remove(c.mesh);
      (c.mesh as THREE.Mesh).geometry?.dispose?.();
      this.group.add(art);
      c.mesh = art;
    }
  }

  /**
   * Dudaszó: aki hallja, iszkol.
   *
   * Ez teszi a dudát eszközzé és nem díszletté. A hatótáv KORLÁTOS, és ez a
   * lényeges döntés: ha az egész utca szétugrana egy nyomásra, a
   * szörnyecskék veszélye megszűnne, és a szakaszból kimaradna az egyetlen
   * dolog, ami vezetés közben döntést kér.
   */
  scatter(from: THREE.Vector3, range: number): void {
    for (const c of this.critters) {
      if (c.launched > 0) continue;
      const away = new THREE.Vector3().subVectors(c.position, from).setY(0);
      const distance = away.length();
      if (distance > range || distance < 1e-3) continue;
      // Az út SZÉLE felé, nem csak „el" — különben az autó elől az autó elé
      // is menekülhetne.
      c.direction.copy(c.alongX ? ACROSS_Z : ACROSS_X);
      const offset = c.alongX ? c.position.z - c.home.z : c.position.x - c.home.x;
      if (offset < 0) c.direction.multiplyScalar(-1);
      c.mood = 'dash';
      c.moodLeft = STREET.critterDashTime;
    }
  }

  update(dt: number, car: Car, elapsed: number): void {
    const carPos = car.position;
    const drawRange2 = STREET.critterDrawRange * STREET.critterDrawRange;

    for (const c of this.critters) {
      // TÁVOLI SZÖRNYECSKE NEM RAJZOLÓDIK. A szimulációja fut tovább (az
      // néhány szorzás), a kirajzolása viszont húszezer háromszög — és a
      // felük olyan messze ácsorog, hogy egy képpontot ha kitesz.
      c.mesh.visible = c.position.distanceToSquared(carPos) < drawRange2;
      if (c.launched > 0) {
        // Comic arc, no gore: they bounce, they land, they scurry off.
        c.launched -= dt;
        c.velocity.y -= 18 * dt;
        c.position.addScaledVector(c.velocity, dt);
        if (c.position.y < 0) {
          c.position.y = 0;
          c.velocity.multiplyScalar(0.4);
          c.velocity.y = Math.abs(c.velocity.y) * 0.45;
        }
        c.mesh.rotation.x += dt * 11;
        c.mesh.position.copy(c.position);
        c.mesh.position.y = c.position.y + 1.8;
        continue;
      }

      // --- MIT CSINÁL ÉPP ---------------------------------------------------
      //
      // Eddig mind a tizenhat szörnyecske ugyanazt csinálta: állandó
      // sebességgel ingázott a saját utcájában. Ettől a forgalom KISZÁMÍTHATÓ
      // volt — egy idő után a játékos ránézésre tudta, hol lesznek, és a
      // szakasz legveszélyesebb eleme díszletté vált.
      //
      // Három állapot, és a középső a lényeg: a VÁRAKOZÓ szörnyecske a járda
      // szélén ácsorog, amíg az autó közel nem ér, és akkor ugrik ki. Ez az
      // egyetlen minta, ami valódi döntést kér a vezetőtől — mert a
      // kikerülést nem lehet előre megtervezni, csak reagálni rá.
      const roll = () => {
        c.seed = (c.seed * 1103515245 + 12345) & 0x7fffffff;
        return c.seed / 0x7fffffff;
      };
      c.moodLeft -= dt;
      const carDistance = c.position.distanceTo(carPos);

      if (c.mood === 'wait') {
        // Kivárás a járdán. A kiugrás akkor jön, amikor az autó BELÉP a
        // döntési távolságba — nem előbb, mert akkor van ideje kikerülni, és
        // nem később, mert az elkerülhetetlen ütközés nem kihívás, hanem
        // igazságtalanság.
        if (carDistance < STREET.critterDashRange && Math.abs(car.speed) > 4) {
          c.mood = 'dash';
          c.moodLeft = STREET.critterDashTime;
          // A kiugrás MINDIG az út felé történik, különben nem történik semmi.
          c.direction.copy(c.alongX ? ACROSS_Z : ACROSS_X);
          if ((c.alongX ? carPos.z - c.position.z : carPos.x - c.position.x) < 0) {
            c.direction.multiplyScalar(-1);
          }
        } else if (c.moodLeft <= 0) {
          c.mood = 'wander';
          c.moodLeft = 2 + roll() * 4;
        }
      } else if (c.moodLeft <= 0) {
        // Az ácsorgás és a futás váltakozik. Az arány szándékosan a
        // várakozás felé billen: egy utca, ahol mind a tizenhat rohan,
        // ugyanolyan egyhangú, mint az, ahol mind ingázik.
        c.mood = c.mood === 'dash' ? 'wander' : roll() < 0.55 ? 'wait' : 'wander';
        c.moodLeft = c.mood === 'wait' ? 2 + roll() * 5 : 2 + roll() * 4;
      }

      const pace =
        c.mood === 'dash' ? STREET.critterDashSpeed : c.mood === 'wait' ? 0 : STREET.critterSpeed;
      c.position.addScaledVector(c.direction, pace * c.pace * dt);
      // Waddle: sells "small creature" for the cost of one sine.
      c.mesh.position.copy(c.position);
      // A kacsázás üteme a TEMPÓVAL nő: az ácsorgó szörnyecske alig
      // mozdul, a kiugró pörög. Enélkül a három állapot ugyanúgy nézne ki, és
      // a játékos nem tudná előre, melyik fog elé ugrani.
      const wobble = c.mood === 'wait' ? 2.5 : c.mood === 'dash' ? 16 : 9;
      const swing = c.mood === 'wait' ? 0.05 : 0.16;
      c.mesh.position.y = 0.55 + Math.abs(Math.sin(elapsed * wobble + c.position.x)) * 0.14;
      c.mesh.rotation.z = Math.sin(elapsed * wobble + c.position.x) * swing;
      c.mesh.rotation.y = Math.atan2(c.direction.x, c.direction.z);

      // Turn back at the kerb. Critters cross their street; they do not emigrate.
      const away = c.alongX ? c.position.z - c.home.z : c.position.x - c.home.x;
      if (Math.abs(away) > this.world.tileSize * 0.42) c.direction.multiplyScalar(-1);

      // Clearance from the car's BODY, not from its centre. The old test was a
      // 2.36 m circle on a car 0.98 m wide: monsters were run over while
      // passing a metre clear of the flank, and the near miss fired at 6.45 m
      // — a distance at which nothing whatsoever feels near.
      const gap = car.clearanceTo(c.position);
      const speedish = Math.abs(car.speed) > 6;

      // Átugrani fölöttük ÉR: ez az ugrás egyik jutalma, és pont az a fajta,
      // amit a játékos magától talál meg. A küszöb a szörnyecske magassága —
      // ha a kerék ennél lejjebb van, az elütés.
      const cleared = car.airborne && car.height > CRITTER_CLEARANCE;

      if (gap < STREET.critterRadius && !cleared) {
        const away = new THREE.Vector3().subVectors(c.position, carPos).setY(0);
        if (away.lengthSq() < 1e-6) away.set(Math.cos(car.heading), 0, -Math.sin(car.heading));
        away.normalize();
        // Launched along the car's travel as much as away from it, so they go
        // over the bonnet rather than politely sideways.
        away.addScaledVector(car.forward, Math.sign(car.speed) * 0.8).normalize();
        c.velocity.copy(away.multiplyScalar(Math.abs(car.speed) * 0.75 + 4.5));
        c.velocity.y = 7 + Math.abs(car.speed) * 0.25;
        c.launched = 2.4;
        c.nearMissed = false;
        this.hits++;
      } else if (gap < STREET.nearMissGap && speedish && !c.nearMissed) {
        c.nearMissed = true;
        this.nearMisses++;
      } else if (gap > STREET.nearMissReset) {
        c.nearMissed = false;
      }
    }
  }
}
