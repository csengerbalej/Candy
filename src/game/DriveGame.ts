import type * as THREE from 'three';
import type { SessionStats } from './Session';
import type { Challenge } from './Challenge';
import { SCORE, STREET } from '../core/config';
import { sound } from '../audio/Sound';
import type { DriveWorld, HouseLot } from '../world/DriveWorld';
import type { Car } from '../vehicle/Car';
import type { CritterTraffic } from '../ai/CritterTraffic';
import type { InputSource } from '../input/InputManager';
import { relativeBearing } from '../ui/NavigatorMap';

export type Role = 'driver' | 'navigator';

export interface DriveStats {
  score: number;
  crittersHit: number;
  nearMisses: number;
  crashes: number;
  arrived: boolean;
  time: number;
}

/**
 * The drive (spec §7–§11). One player steers, one player knows where to go,
 * and neither can do the other's job — which is the whole design.
 *
 * The navigator's three verbs are chosen so that none of them can replace
 * talking:
 *   · CÉL    — picks the destination. The driver never sees which one.
 *   · IRÁNY  — throws a bearing arrow on the driver's screen for 2.6s.
 *              A direction, never a road: "arra" is not "balra a második".
 *   · RADAR  — reveals the critters, on the navigator's map only.
 */
export class DriveGame {
  readonly stats: DriveStats = {
    score: 0,
    crittersHit: 0,
    nearMisses: 0,
    crashes: 0,
    arrived: false,
    time: 0,
  };

  /** Index of the player currently driving; the other one navigates. */
  driverIndex = 0;
  /** Itt ül-e a navigátor. Külön eszközről játszva a sofőr gépén nem. */
  localNavigator = true;
  targetId = 0;

  pingLeft = 0;
  radarLeft = 0;
  banner = '';

  /**
   * Parked at the target house, engine off, waiting for the pair to get out.
   *
   * Arriving used to END the drive on the spot: roll within nine metres of the
   * kerb below six metres a second and the screen cut to the interior, with
   * nobody having decided anything. Getting out of the car is the handshake
   * between the two halves of the game and it should be a thing the players
   * DO — and do together, like everything else the pair does.
   */
  parked = false;
  /** Who has climbed out. Both, and only both, ends the drive. */
  readonly outOfCar: [boolean, boolean] = [false, false];

  /** Ki száll ki tényleg. Egyedül csak te — lásd HouseGame.cast. */
  cast: number[] = [0, 1];

  /** The players' own names, for the prompts. */
  names: [string, string] = ['P1', 'P2'];

  private bannerTimer = 0;
  private lastHits = 0;
  private lastNearMisses = 0;

  constructor(
    private readonly world: DriveWorld,
    private readonly car: Car,
    private readonly traffic: CritterTraffic,
    /**
     * A FUTÓ ESTE mérlege.
     *
     * A vezetésnek eddig saját pontszáma volt, az összegyűjtött cukorka meg az
     * estéé — a kettő sosem ért össze. Ezért nem látszott kint, mennyi
     * cukorkád van, és ezért nem került semmibe elütni egy szörnyet: a
     * ponthoz hozzáírtuk, a zsákhoz nem. Ugyanaz a zsák a házban és az úton.
     */
    private readonly run: SessionStats | null = null,
    /**
     * A ház ÁRA: amíg ez nincs kész, a parkoló zárva.
     *
     * A kihívás nem a DriveGame-ben lakik, mert nem a vezetésről szól, hanem
     * arról, mit kérünk cserébe a házért — és ez a kettő külön romolhat el.
     */
    readonly challenge: Challenge | null = null
  ) {
    this.targetId = Math.floor(Math.random() * world.houses.length);
    // The car owns the kerb penalty but must not own a dependency on the town.
    // Wiring the surface test here keeps DriveScene out of it.
    this.car.surface = (x, z) => world.onRoad(x, z);
    // Names turn the car's shape heuristic into a lookup: a tree is a tree
    // because it is called one, not because its box happens to be tall.
    this.car.colliderAssets = world.colliderAssets ?? null;
    this.car.colliderMode = world.colliderMode ?? 'derive';
  }

  get target(): HouseLot {
    return this.world.houses[this.targetId];
  }

  get navigatorIndex(): number {
    return this.driverIndex === 0 ? 1 : 0;
  }

  /** Bearing to the destination, for the driver's ping arrow. */
  /**
   * HOVA MUTAT az irányjelző.
   *
   * Amíg a kihívás tart, a KÖVETKEZŐ KAPURA, utána a célházra. A ház úgysem
   * nyílik ki addig; egy nyíl, ami arra mutat, ahova még nem mehetsz, nem
   * segítség, hanem félrevezetés.
   */
  private get waypoint(): THREE.Vector3 {
    const gate = this.challenge?.nextGate;
    return gate ?? this.target.driveway;
  }

  get pingBearing(): number {
    return relativeBearing(this.car, this.waypoint);
  }

  /** Mire mutat épp: a kapura vagy a házra. A HUD felirata ebből jön. */
  get pingLabel(): string {
    return this.challenge?.nextGate ? 'KAPU' : 'IRÁNY';
  }

  get distanceToTarget(): number {
    return this.car.position.distanceTo(this.target.driveway);
  }

  /** Milyen messze a következő pont, amerre menni kell. */
  get distanceToWaypoint(): number {
    return this.car.position.distanceTo(this.waypoint);
  }

  /** Egyszer, az éjszaka elején: miért vagyunk itt egyáltalán. */
  private opened = false;

  update(dt: number, input: InputSource): void {
    if (this.stats.arrived) return;
    if (!this.opened) {
      this.opened = true;
      // Az üvegbura nem díszlet: a pálya széle IS ez, és ha a játékos csak
      // akkor találkozik vele, amikor nekimegy, egy megmagyarázatlan falnak
      // fogja hinni. Egy mondat az elején abból, ami fölötte van, kihívássá
      // teszi a bezártságot ahelyett, hogy korlát maradna.
      this.say('ÜVEG ALATT VAGYUNK — ÉS ODAKINT VALAMI MÁSZIK. NYILAK: KÖRÜLNÉZÉS.');
    }
    this.stats.time += dt;
    this.pingLeft = Math.max(0, this.pingLeft - dt);
    this.radarLeft = Math.max(0, this.radarLeft - dt);
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner = '';

    // A DUDA: a sofőr HASZNÁLAT gombja, amíg nem parkol.
    //
    // Nem új gomb, hanem egy üresen álló régi. A sofőrnek eddig csak kormánya
    // és pedálja volt; a használat gombja parkoláskor a kiszállás, menet
    // közben viszont nem csinált semmit. Egy duda pont ide való: a
    // szörnyecskék elé érve az első ösztön rányomni, és eddig nem történt
    // semmi tőle.
    const driver = input.get(this.driverIndex);
    if (driver.interact && !this.parked && !this.stats.arrived) {
      sound.horn();
      // A kürt ELIJESZT: aki hallja, iszkol. Ez teszi a dudát eszközzé és
      // nem díszletté — de csak közelről, különben az egész utca szétugrana
      // egy nyomásra, és a szörnyecskék veszélye megszűnne.
      this.traffic.scatter(this.car.position, STREET.hornRange);
    }

    const nav = input.get(this.navigatorIndex);

    // A három ige. Kiemelve hívható műveletekké, mert külön eszközről
    // játszva ugyanezeket a navigátor GÉPE küldi üzenetben — és annak
    // pontosan ugyanazon az úton kell hatnia, mint a helyi gombnak.
    // Két külön ág két külön viselkedést jelentene, amit senki nem venne
    // észre, amíg valaki hálózaton nem játszik.
    // Külön eszközről játszva a navigátor NEM ezen a gépen ül: a gombjai a
    // saját gépén hatnak, és onnan érkeznek ide üzenetben. Ilyenkor a helyi
    // billentyűket figyelmen kívül kell hagyni, különben a sofőr gépén a
    // navigátor billentyűi is működnének — egy másik ember szerepét adva
    // annak, aki épp vezet.
    if (this.localNavigator) {
      if (nav.interact && !this.parked) this.cycleTarget();
      if (nav.jump) this.sendPing();
      if (nav.sprint) this.pulseRadar();
    }

    this.scoreTraffic();
    // Only head-on impacts are crashes. Scraping a hedge used to cost points
    // and bump the counter, which made the scoreboard read like a demolition
    // derby after an otherwise clean run.
    if (this.car.crashed) {
      this.stats.crashes++;
      this.stats.score += SCORE.crash;
      if (this.car.impactSpeed > 9) this.say('BUMM!');
    }

    this.updateParking(input);
  }

  /**
   * Pull up, stop, and both of you get out.
   *
   * Stopping is stricter than arriving used to be — walking pace rather than
   * six metres a second — because "we have arrived" and "we have parked" are
   * different claims, and the second one is the one that should open a door.
   */
  private updateParking(input: InputSource): void {
    const wasParked = this.parked;
    // ZÁRVA, amíg a kihívás nincs meg. Nem a kiszállást tiltjuk, hanem a
    // leparkolást: így a narancsszínű folt fölött állva is egyértelmű, hogy
    // nem a gombbal van baj, hanem hogy még tartozol valamivel.
    const open = !this.challenge || this.challenge.done;
    this.parked =
      open &&
      this.distanceToTarget < STREET.arriveRadius &&
      Math.abs(this.car.speed) < STREET.parkSpeed;

    if (!this.parked) {
      // Drive off and you are back in the car, both of you.
      this.outOfCar[0] = false;
      this.outOfCar[1] = false;
      return;
    }

    if (!wasParked) this.say(`LEPARKOLTATOK — ${this.target.name}`);

    for (const i of this.cast) {
      if (!this.outOfCar[i] && input.get(i).interact) {
        this.outOfCar[i] = true;
        this.say(`${this.names[i] ?? `P${i + 1}`} KISZÁLLT`);
      }
    }

    if (this.cast.every((i) => this.outOfCar[i])) {
      this.stats.arrived = true;
      this.stats.score += SCORE.arrive;
      this.say(`BE A HÁZBA — ${this.target.name}`);
    }
  }

  /** What to tell the players while the car is standing at the kerb. */
  get parkPrompt(): string {
    if (this.stats.arrived) return '';
    // A körön belül, de még gurulva: ez az a pillanat, amikor a játékos nem
    // érti, miért nem történik semmi. A narancsszínű folt ott van alatta —
    // csak azt nem mondta meg neki senki, hogy MEG IS KELL ÁLLNI rajta.
    if (this.challenge && !this.challenge.done) return this.challenge.label;
    if (!this.parked) {
      return this.distanceToTarget < STREET.arriveRadius
        ? 'ÁLLJ MEG A NARANCSSZÍNŰ HELYEN'
        : '';
    }
    const waiting = this.cast.find((i) => !this.outOfCar[i]);
    if (waiting === undefined) return '';
    if (this.cast.length === 1) return 'MEGÉRKEZTÉL — SZÁLLJ KI (E)';
    if (this.cast.some((i) => this.outOfCar[i])) {
      return `${this.names[waiting] ?? `P${waiting + 1}`} MÉG A KOCSIBAN — nyomd meg a HASZNÁLAT gombot`;
    }
    return 'MEGÉRKEZTETEK — SZÁLLJATOK KI MINDKETTEN (E / ENTER)';
  }

  /** CÉL — a következő ház. Parkolva tilos: ott ugyanaz a gomb a kiszállás. */
  cycleTarget(): void {
    if (this.parked) return;
    this.targetId = (this.targetId + 1) % this.world.houses.length;
    this.say(`ÚJ CÉL: ${this.target.name}`);
  }

  /** IRÁNY — egy irány, szándékosan nem útvonal. */
  sendPing(): void {
    this.pingLeft = STREET.pingTime;
    this.say('IRÁNYJELZÉS ELKÜLDVE');
  }

  /** RADAR — a szörnyek, csak a navigátor térképén. */
  pulseRadar(): void {
    if (this.radarLeft > 0) return;
    this.radarLeft = STREET.radarTime;
    this.say('SZÖRNYRADAR');
  }

  /** Swap who drives (spec §6: roles are swappable). */
  swapRoles(): void {
    this.driverIndex = this.navigatorIndex;
    this.say(`SZEREPCSERE — P${this.driverIndex + 1} vezet`);
  }

  private scoreTraffic(): void {
    const hits = this.traffic.hits - this.lastHits;
    if (hits > 0) {
      this.stats.crittersHit += hits;
      this.challenge?.hitCritter();
      this.stats.score += SCORE.critterHit * hits;
      // A zsák kiborul. Ez az, ami tényleg fáj — egy pontlevonás a képernyő
      // sarkában nem ugyanaz, mint elveszíteni a cukorkát, amiért bementél.
      const spilled = this.run ? Math.min(this.run.candy, SCORE.candyPerCritter * hits) : 0;
      if (this.run) this.run.candy -= spilled;
      this.say(
        spilled > 0
          ? `JAJ NE — elütöttél egy szörnyet! −${spilled} cukorka`
          : 'JAJ NE — elütöttél egy szörnyet!'
      );
      this.lastHits = this.traffic.hits;
    }
    const misses = this.traffic.nearMisses - this.lastNearMisses;
    if (misses > 0) {
      this.stats.nearMisses += misses;
      this.stats.score += SCORE.critterNearMiss * misses;
      this.lastNearMisses = this.traffic.nearMisses;
    }
  }

  /**
   * Egy sor a szalagcímbe.
   *
   * Nyilvános, mert nem csak a vezetés szabályai beszélnek: az utcai
   * cukorka és a jelzőlámpák a JELENETBEN élnek (a lámpa akkor is vált, ha
   * senki nem vezet), és ugyanazon a csatornán kell szólniuk. Két külön
   * üzenetsáv két külön helyen jelenne meg a képernyőn.
   */
  say(text: string): void {
    this.banner = text;
    this.bannerTimer = 2.4;
  }
}
