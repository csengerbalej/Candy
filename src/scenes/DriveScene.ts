import * as THREE from 'three';
import { CAR, PALETTE, STREET } from '../core/config';
// The drive happens in the Meshy village now, not the kit-built town. Both
// satisfy DriveWorld, so nothing downstream of here — the navigator's map, the
// critters, the scoring — had to change.
import { VillageWorld, VILLAGE_SCALE } from '../world/VillageWorld';
import { DriveLink } from '../net/DriveLink';
import { net, netRoom } from '../main';
import { Car } from '../vehicle/Car';
import { CritterTraffic } from '../ai/CritterTraffic';
import { StreetCandy } from '../world/StreetCandy';
import { TrafficLights } from '../world/TrafficLights';
import { Checkpoints } from '../world/Checkpoints';
import { SkidMarks } from '../vehicle/SkidMarks';
import { Base } from '../world/Base';
import { FogoHud } from '../ui/FogoHud';
import { Delivery } from '../game/Delivery';
import { CarTraffic } from '../ai/CarTraffic';
import { Challenge } from '../game/Challenge';
import { Anger } from '../game/Anger';
import { DriveGame } from '../game/DriveGame';
import { ParkingSpot } from '../world/ParkingSpot';
import { Dome } from '../world/Dome';
import { ShelfSpider } from '../world/ShelfSpider';
import { Shelf } from '../world/Shelf';
import { sound, type Engine } from '../audio/Sound';
import { DriveStage } from '../game/DriveStage';
import { DriveHud } from '../ui/DriveHud';
import { NavigatorMap } from '../ui/NavigatorMap';
import { models } from '../assets/ModelLoader';
import { toonify, addOutlines, pruneOutlines } from '../render/Toon';
import { nightSky, kitchenSurround } from '../render/Environment';
import type { InputManager } from '../input/InputManager';
import type { Session } from '../game/Session';
import type { GameScene } from './GameScene';
import type { PauseActions } from '../ui/PauseMenu';

/**
 * The night, as numbers.
 *
 * These live here rather than in config.ts because they are all one decision:
 * the sky, the fog and the tint have to agree on what colour the dark is, or
 * the town stops sitting in the air it is supposed to be sitting in.
 */
const SKY_ZENITH = 0x080615;
const SKY_HORIZON = 0x1d1940;
/** Cool and dark on the walls; the emissive maps keep their own warmth. */
/**
 * Mennyire kékíti a futásidő a falut.
 *
 * Volt 0x4a4d7e — ami egy 0,29/0,30/0,49-es SZORZÓ, tehát a falu színének
 * több mint kétharmadát itt vette el, és ez akkor volt helyes, amikor a
 * modell nappali szürkésbézs volt: az éjszakát valakinek elő kellett
 * állítania, és ez a valaki a futásidő volt.
 *
 * Most a textúra maga éjszakai (lásd tools/village-paint.mjs): az árnyalatok
 * lilák, a mélyek hidegek, a burkolat aszfalt. Ha a régi szorzó itt maradna,
 * ugyanaz a sötétítés kétszer futna le, és a frissen kiszínezett falu
 * fekete-kék masszává állna össze. A tint ezért már csak egy hajszálnyi
 * hidegséget ad hozzá — a színt az eszköz hozza.
 */
const TINT_TOWN = 0xa9a5c4;
/** Tarmac and pavement, well below the buildings so the street has a floor. */
const TINT_GROUND = 0x262a4c;
/** Where the moon is. The sky dome, the key light and the shadows all use it. */
const MOON_DIR = new THREE.Vector3(0.45, 0.62, 0.38).normalize();
const MOON_DISTANCE = 120;
/**
 * How much town the shadow box covers, in metres. The chase camera sees about
 * sixty metres of road; seventy is that plus the margin the box needs while it
 * snaps to texels.
 */
const SHADOW_SPAN = 70;
/** Below this, a moon shadow is noise rather than a shadow. */
const SHADOW_CASTER_MIN_HEIGHT = 2.2;
const UP = new THREE.Vector3(0, 1, 0);
/**
 * A szörnyecske magassága, a helyettesítő tokéból örökölve.
 *
 * A tok egy 0,42 sugarú, 0,5 hosszú kapszula volt, tehát 1,34 magas — és
 * minden, ami rájuk épül (az elütés sugara, a kacsázás amplitúdója, a
 * majdnem-elütés távolsága) ehhez a mérethez van hangolva. A modell ezt
 * átveszi, nem felülírja.
 */
const CRITTER_HEIGHT = 0.42 * 2 + 0.5;

/**
 * Az utcán heverő cukorka mérete.
 *
 * A szörnyecskéből származtatva, nem külön beírva: ez a két dolog fekszik egy
 * utcán egymás mellett, és ha a méretük külön számokból jön, előbb-utóbb
 * szétcsúsznak. Először tényleg szétcsúsztak — a cukorka 4,94 egység magas
 * volt egy 1,34-es szörny mellett, vagyis inkább hordó, mint cukorka.
 *
 * Kicsivel kisebb a szörnynél: egy cukorka nem lehet akkora, mint egy élőlény.
 */
const STREET_CANDY_HEIGHT = CRITTER_HEIGHT * 0.78;

const HALO_SCALE = new THREE.Vector3(4.2, 4.2, 4.2);

/** The drive between two houses (spec §7–§11). */
export class DriveScene implements GameScene {
  readonly scene = new THREE.Scene();
  finished = false;
  private disposed = false;

  private readonly stage = new DriveStage();
  private link!: DriveLink;
  private amDriver = true;
  /**
   * Melyik szörny a MIÉNK ezen a gépen.
   *
   * Kétfős módban a szoba dönti el (0 vagy 1); egyedül mindig a nulladik.
   * A bemenet, a pontszám és a kocsi is ehhez tartozik.
   */
  private localIndex: 0 | 1 = 0;
  /** A társ kocsija. `null`, ha egyedül játszol. */
  private readonly partner: Car | null;
  private readonly parking: ParkingSpot;
  private readonly dome: Dome;
  private readonly spider: ShelfSpider;
  private readonly shelf: Shelf;
  private readonly engine: Engine | null;
  /** A bázis, fogó módban: ide kell hazavinni a rakományt. */
  private base: Base | null = null;
  /** A rakomány kijelzője. Ugyanaz a doboz, mint a házban — más számokkal. */
  private fogoHud: FogoHud | null = null;

  /** A talajon maradó gumicsík. Egyetlen háló, gyűrűpufferrel. */
  private readonly skids = new SkidMarks();
  /** Kötött hivatkozás, hogy ne szülessen új függvény képkockánként. */
  private readonly groundAt = (x: number, z: number): number => this.world.groundAt(x, z);
  private readonly windowGlow: Array<{ light: THREE.PointLight; phase: number; base: number }> = [];
  private parkingFor = -1;
  private glowClock = 0;
  private readonly hud: DriveHud;
  private readonly map: NavigatorMap;
  readonly game: DriveGame;
  private readonly traffic: CritterTraffic;
  private readonly streetCandy: StreetCandy;
  private readonly lights: TrafficLights;
  private sky: THREE.Object3D | null = null;
  private readonly challenge: Challenge;
  private readonly cars: CarTraffic | null;
  private readonly checkpoints: Checkpoints | null;
  private readonly lastCarAt = new THREE.Vector3();
  /**
   * A város haragja. Egy szám, amit egész este töltesz — és ami majd a
   * célháznál várakozó falka méretét adja.
   */
  private readonly anger = new Anger();
  private lastCrittersHit = 0;
  readonly car: Car;

  private moon: THREE.DirectionalLight | null = null;
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private readonly shadowFocus = new THREE.Vector3();
  private readonly haloSpin = new THREE.Quaternion();
  private readonly haloMatrix = new THREE.Matrix4();

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly input: InputManager,
    private readonly session: Session,
    private readonly world: VillageWorld,
    parent: HTMLElement
  ) {
    // No flat background colour: the sky dome IS the background, and it is
    // what the rooflines get to be dark against.
    // A számolt éjszakai ég MARAD, de csak addig, amíg a konyha be nem tölt:
    // egy üres képernyő rosszabb, mint egy ideiglenes ég.
    this.sky = nightSky({ zenith: SKY_ZENITH, horizon: SKY_HORIZON, moon: MOON_DIR });
    this.scene.add(this.sky);
    void this.loadKitchen();
    this.scene.add(world.group);
    this.addLighting();
    this.addWindowGlow();

    this.car = new Car(world.carSpawn, world.carHeading);
    this.scene.add(this.car.mesh);

    // A TÁRS KOCSIJA — kétfős módban KÉT autó van.
    //
    // Eddig egy kocsi volt, sofőrrel és navigátorral: a navigátor gépe nem
    // szimulált semmit, csak rajzolta, amit kapott. Ez működött, de a
    // második játékos NÉZŐ volt a saját estéjén.
    //
    // Most mindkettőnek saját kocsija van. A szabály ugyanaz marad, ami egy
    // autót egyáltalán szimulálhatóvá tesz: EGY AUTÓT EGY GÉP SZÁMOL. A
    // sajátodat te, a társadét ő — és a két gép a HELYZETET cseréli, nem a
    // gombnyomásokat. Így nincs két, egymástól elcsúszó valóság.
    //
    // Kicsit odébb indul: két autó nem születhet ugyanarra a pontra.
    this.partner = net.current.paired
      ? new Car(
          world.carSpawn.clone().add(new THREE.Vector3(Math.cos(world.carHeading) * 7, 0, -Math.sin(world.carHeading) * 7)),
          world.carHeading
        )
      : null;
    if (this.partner) this.scene.add(this.partner.mesh);

    this.traffic = new CritterTraffic(world);
    this.scene.add(this.traffic.group);

    // A KIHÍVÁS: a ház ára.
    //
    // A parkoló zárva marad, amíg ez nincs kész — a város így nem folyosó
    // lesz, hanem feladat. Házanként MÁS, és a sorszámból jön, tehát ugyanaz
    // a ház ugyanazt kéri minden éjszaka: egy játék, amiben a tudás számít,
    // jobb annál, amiben minden ajtó mögött lottó van.
    const gatePoints = Checkpoints.order(
      Checkpoints.pick((x, z) => world.onRoad(x, z), world.bounds, 3),
      this.car.position
    );
    this.challenge = new Challenge(session.visited.size, gatePoints);
    this.checkpoints =
      this.challenge.kind === 'IDOFUTAM' ? new Checkpoints(gatePoints, Challenge.GATE_REACH) : null;
    if (this.checkpoints) this.scene.add(this.checkpoints.group);

    // NPC FORGALOM. A lámpák eddig üresben váltottak: nem állt meg előttük
    // senki. Egy sor álló autó a pirosnál adja a városnak azt a jelentést,
    // hogy ITT SZABÁLYOK VANNAK — amit aztán te megszeghetsz.
    const grid = world.streetGrid;
    this.cars = grid ? new CarTraffic(grid, STREET.npcCarCount, world.lightSpots) : null;
    if (this.cars) this.scene.add(this.cars.group);

    // A jelzőlámpák. Nem csak szabály: ez a kilenc váltakozó fény az első
    // dolog a városban, ami MAGÁTÓL mozog.
    this.lights = new TrafficLights(world.lightSpots, VILLAGE_SCALE);
    this.scene.add(this.lights.group);

    // Az utcán heverő cukorka. Az első dolog kint, ami a zsákba kerül.
    this.streetCandy = new StreetCandy(world);
    this.scene.add(this.streetCandy.group);

    // The authored town is a daylight palette — light walls, grey tarmac. The
    // tint is what turns it into a night: cool and dark on the surfaces, while
    // the windows, lamps and jack-o'-lanterns keep their own warm emissive.
    //
    // Two passes, and the ORDER is the point. Tarmac and pavement under a
    // single town-wide tint came out the same value as the houses, which is
    // why the whole frame read as one sheet of lavender with nothing behind
    // anything else. Ground goes first with a much darker, less saturated
    // tint; the general pass afterwards leaves it alone, because `toonify`
    // only converts standard materials and these are already toon.
    for (const object of world.group.children) {
      if (object.userData.cpRoad) toonify(object, { floor: 0.1, fill: 0.02, steps: 4, tint: TINT_GROUND });
    }
    toonify(world.group, { floor: 0.15, fill: 0.04, steps: 4, tint: TINT_TOWN });
    toonify(this.car.mesh, { floor: 0.42 });
    if (this.partner) toonify(this.partner.mesh, { floor: 0.42, tint: PALETTE.p2 });

    void models
      .instance('models/car.json', { length: CAR.length, yaw: Math.PI / 2 })
      .then((m) => {
        // The first drive loads the model cold; a fast player can be inside a
        // house before it resolves, and attaching art to a dead scene keeps
        // that whole scene alive.
        if (this.disposed) return;
        toonify(m, { floor: 0.5, steps: 5, fill: 0.12 });
        addOutlines(m, 0.55, 0x0a0616, 0.22);
        this.car.setArt(m);
      })
      .catch((e) => console.warn('car model failed', e));

    // A TÁRS KOCSIJA ugyanazt a modellt kapja, más színnel.
    //
    // Külön példány, mert egy mesh nem lehet két helyen. A színe viszont
    // MÁS — lila, a második játékos színe —, különben menet közben nem
    // tudnád megmondani, melyik a tiéd, és a parkolónál a kettő
    // összekeverhető lenne.
    if (this.partner) {
      void models
        .instance('models/car.json', { length: CAR.length, yaw: Math.PI / 2 })
        .then((m) => {
          if (this.disposed || !this.partner) return;
          toonify(m, { floor: 0.5, steps: 5, fill: 0.12, tint: PALETTE.p2 });
          addOutlines(m, 0.55, 0x0a0616, 0.22);
          this.partner.setArt(m);
        })
        .catch((e) => console.warn('a társ kocsijának modellje nem töltött be', e));
    }

    // Az NPC autók modellje. EGY betöltés, sok példány — a `clone` a
    // geometriát és a textúrákat megosztja, tehát tizenkét autó nem kerül
    // tizenkétszer annyiba.
    if (this.cars) {
      void models
        .instance('models/npc-car.json', { length: CAR.length * 0.95, yaw: Math.PI / 2 })
        .then((m) => {
          if (this.disposed || !this.cars) return;
          toonify(m, { floor: 0.45, steps: 4, fill: 0.1, tint: TINT_TOWN });
          addOutlines(m, 0.5, 0x0a0616, 0.22);
          this.cars.setArt(() => m.clone(true));
        })
        .catch((e) => console.warn('az NPC autó modellje nem töltött be', e));
    }

    // A választott szörnyek NEM ülnek a kocsiban.
    //
    // Megcsináltam, és rossz volt: a karaktermodellek a ház léptékéhez
    // vannak méretezve (ott a szörnyek egerek egy óriási lakásban), a kocsi
    // viszont a falu léptékében van. Egymás mellé téve a vámpír akkora lett,
    // mint a jármű, és félig belelógott. Két különböző lépték egy képen nem
    // hangolási kérdés — vagy a karaktereknek lenne külön „ülő" méretük, vagy
    // marad az üres kocsi. Egyelőre marad.

    // A szörnyecskék.
    //
    // A MOZGÁSUK nem változik egy sorral sem: ugyanaz a kacsázás, ugyanaz a
    // visszafordulás a járdánál, ugyanaz a komikus ív elütéskor. Csak a test
    // cserélődik a tok alatt — és ezért kell `onGround: false`: a tok a
    // KÖZEPÉN volt origózva, a betöltött modell alapból a talpán állna, és a
    // meglévő magasságszámítás fél métert emelne rajtuk.
    void models
      .instance('models/critter.json', { height: CRITTER_HEIGHT, onGround: false })
      .then((prototype) => {
        if (this.disposed) return;
        toonify(prototype, { floor: 0.45, steps: 4, fill: 0.1 });
        addOutlines(prototype, 0.06, 0x120818, 0.3);
        this.traffic.setArt(() => {
          const copy = prototype.clone(true);
          // Tizenhat egyforma szörnyecske egy utcán sablonnak látszik. Egy
          // csipetnyi méretszórás elég, hogy egyedeknek nézzenek ki — a
          // mozgáshoz nem nyúl.
          copy.scale.multiplyScalar(0.86 + Math.random() * 0.3);
          return copy;
        });
      })
      .catch((e) => console.warn('critter model failed', e));

    this.game = new DriveGame(world, this.car, this.traffic, session.stats, this.challenge, this.partner);
    this.game.driverIndex = session.driverIndex;
    this.game.targetId = session.chooseTarget(world.houses.map((h) => h.id));
    this.game.names = session.selection.names;
    // Egy eszköz, egy kép. Az osztott kép azért volt, hogy két ember egy
    // monitoron elférjen; két eszközön mindenkinek sajátja van, egyedül meg
    // nincs kit elválasztani. A térkép így a sarokba kerül, a vezetés kapja
    // az egész képernyőt — mindkét módban.
    this.stage.solo = true;
    // Kiszállni csak az tud, aki tényleg itt van.
    this.game.cast = net.current.paired ? [0, 1] : [session.driverIndex];

    // Két eszközről játszva az AUTÓT az szimulálja, aki vezeti — egy autót
    // nem lehet két gépen egyszerre számolni. A másik gép megkapja, hol van,
    // és a térképét abból rajzolja.
    const amDriver = !net.current.paired || net.current.playerIndex === session.driverIndex;
    this.link = new DriveLink(netRoom, amDriver, (verb) => {
      if (verb === 'target') this.game.cycleTarget();
      else if (verb === 'ping') this.game.sendPing();
      else this.game.pulseRadar();
    });
    this.amDriver = amDriver;
    this.localIndex = net.current.paired ? net.current.playerIndex : 0;

    // A parkolóhely a CÉLNÁL van, nem minden háznál: tizenhat narancsszínű
    // folt egy faluban nem jelölés, hanem díszlet.
    // A BEFŐTTESÜVEG. A sugár a falu befoglalójából jön, nem beírt szám: a
    // térkép mérete változhat, az üveg kövesse.
    const size = world.bounds.getSize(new THREE.Vector2());
    // A BEÍRT kör sugara, nem a körülírté.
    //
    // Elsőre a leghosszabb oldalból számoltam (×0,62), és az üveg 21 méterrel
    // a térkép széle KÍVÜLRE került: a kocsi lehajtott az aszfaltról, és a
    // pálya pereme és az üveg között a semmibe nézett. A képen ez fekete
    // üresség volt, fölötte az üveg rézperemével.
    //
    // A rövidebb oldal fele az a legnagyobb kör, ami még biztosan a burkolaton
    // belül van — a térkép sarkai kimaradnak, de azok amúgy is csak margó.
    const reach = Math.min(size.x, size.y) * 0.5;
    this.dome = new Dome(reach, reach * 0.55);
    this.scene.add(this.dome.group);
    this.car.boundary = (p) => this.dome.clamp(p, CAR.length);

    // A pók az üvegen KÍVÜL mászik, tehát egy hajszállal nagyobb sugáron. A
    // mérete a falu léptékében abszurd — és pontosan ez a poén: egy
    // befőttesüveghez képest egy pók óriási, magához képest hétköznapi.
    // A polc és a szoba az üvegen KÍVÜL. Enélkül a bura lehetne erőtér vagy
    // égbolt is — attól lesz befőtt, hogy valamin áll, és azon túl szoba van.
    this.shelf = new Shelf(reach, reach * 0.55);
    this.scene.add(this.shelf.group);

    this.spider = new ShelfSpider(reach, reach * 0.55, reach * 0.34);
    this.scene.add(this.spider.group);

    void Promise.all([
      // `onGround` MARAD alapértelmezett, tehát a modell origója a pók
      // talpán van, nem a közepén. Középre origózva a test fele az üveg alá
      // lógna — a felhasználó szava: „a pók belóg a pályára". Így viszont a
      // has ül az üvegen, és minden más kifelé nő.
      models.instance('models/spider.json', { length: reach * 0.9 }),
      fetch('models/spider-rig.json').then((r) => r.json()),
    ])
      .then(([art, rig]) => {
        if (this.disposed) return;
        // A pók nem cel-shadelt és nem is világított: SZILUETT az üvegen
        // túlról. Épp ezért nem kell rá se körvonal, se környezeti fény — a
        // formája mondja meg, mi az, nem a felülete.
        this.spider.setArt(art, rig);
      })
      .catch((e) => console.warn('spider model failed', e));

    // Az utcai cukorka modellje. A HELYEK nem várnak rá: azok az első
    // képkockán megvannak, csak a test érkezik később.
    void models
      .instance('models/street-candy.json', { height: STREET_CANDY_HEIGHT })
      .then((art) => {
        if (this.disposed) return;
        this.streetCandy.setArt(art);
      })
      .catch((e) => console.warn('az utcai cukorka modellje nem töltött be', e));

    this.parking = new ParkingSpot();
    this.parking.moveTo(this.game.target.driveway);
    this.scene.add(this.parking.group);

    // A motor. A vezetés alatt végig szól — ez az egyetlen folyamatos hang a
    // szakaszban, és pont ezért nincs alatta zene: a kettő egymást fedné.
    this.engine = sound.startEngine();
    this.scene.add(this.skids.mesh);

    // A BÁZIS a kocsi indulóhelyén áll: ez az egyetlen pont a városban, amit
    // minden játékos ismer, mert onnan indult. Egy külön kijelölt hely
    // ugyanilyen jó volna, de ezt nem kell megtanulni.
    if (session.fogo) {
      if (!session.delivery) session.delivery = new Delivery(world.carSpawn.clone());
      this.base = new Base(session.delivery.base);
      this.scene.add(this.base.group);
      this.fogoHud = new FogoHud(document.body, 'varos');
    }

    this.hud = new DriveHud(parent);
    this.map = new NavigatorMap(parent);
  }

  static async create(
    renderer: THREE.WebGLRenderer,
    input: InputManager,
    session: Session,
    parent: HTMLElement
  ): Promise<DriveScene> {
    const world = await VillageWorld.load();
    return new DriveScene(renderer, input, session, world, parent);
  }

  /**
   * Meleg fény a házakban.
   *
   * A kérés része volt az „üveg", és azt egyetlen atlaszon nem lehet
   * anyagként megcsinálni — de ami az üvegből ÉJSZAKA számít, az nem a
   * tükröződés, hanem hogy valaki otthon van. Egy meleg fény a tető alatt
   * pont ezt mondja el, és a hideg-lila utcaképben ez adja a halloween
   * kontrasztot.
   *
   * Két megkötés, mindkettő szándékos:
   *   · a fény a HÁZ KÖZEPÉBE kerül, nem a kapubejáróba — az úttestre és
   *     köré nem kerül semmi, ahogy kérted;
   *   · rövid hatótáv, hogy a saját falát mossa meg, ne a fél utcát. Egy
   *     tizenhat darabos, széles hatótávú fényfüzér egyszerűen kivilágítaná
   *     az éjszakát, amit az imént festettünk rá.
   */
  private addWindowGlow(): void {
    // Nem minden ház: a sötét ablakok adják a ritmust. Minden harmadik kimarad.
    this.world.houses.forEach((house, index) => {
      if (index % 3 === 2) return;
      // A meleg és a savanyú zöld váltakozása az, amitől halloween lesz, és
      // nem karácsony.
      const warm = index % 5 === 3 ? 0x8cff6a : 0xffa63c;
      const light = new THREE.PointLight(warm, 26, 26, 2);
      const peak = house.peak ?? 6;
      light.position.set(house.position.x, Math.min(peak * 0.55, 5.5), house.position.z);
      this.scene.add(light);
      this.windowGlow.push({ light, phase: index * 1.7, base: 26 });
    });
  }

  private addLighting(): void {
    // The town's materials are flat cartoon colours with no baked shading, so
    // the lighting does all the work of making it night. Ambient stays low and
    // cold; the warmth comes from lamp glows and the car's own headlights.
    const span = this.world.bounds.getSize(new THREE.Vector2()).length();
    // Tighter than before, and the same hue as the bottom of the sky dome, so
    // a street genuinely recedes into the horizon instead of into a different
    // colour thirty metres further on.
    this.scene.fog = new THREE.Fog(SKY_HORIZON, span * 0.09, span * 0.52);
    this.scene.add(new THREE.HemisphereLight(0x243063, 0x090714, 0.30));

    const moon = new THREE.DirectionalLight(0x9fb4ff, 0.8);
    moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);

    // THE FLICKER.
    //
    // The shadow camera used to cover the whole town: a 192 m box on a 2048
    // map is 9.4 cm per shadow texel, and 9.4 cm of depth quantisation on a
    // surface lit at a glancing angle is textbook shadow acne. It shimmered
    // across every road and roof as the camera moved, which is exactly what
    // the player described.
    //
    // The fix is that the player never sees the town — they see about sixty
    // metres of it. So the box follows the car and covers only that, at
    // SHADOW_SPAN / 2048 ≈ 3.3 cm per texel, roughly a third of the error.
    // A real `normalBias` covers the rest: it offsets the lookup along the
    // surface normal, which is precisely the direction the quantisation error
    // points.
    const half = SHADOW_SPAN / 2;
    moon.shadow.camera.left = -half;
    moon.shadow.camera.right = half;
    moon.shadow.camera.top = half;
    moon.shadow.camera.bottom = -half;
    moon.shadow.camera.near = 1;
    moon.shadow.camera.far = MOON_DISTANCE * 2;
    moon.shadow.bias = -0.0002;
    moon.shadow.normalBias = 0.08;
    this.scene.add(moon, moon.target);
    this.moon = moon;

    // A moving shadow camera trades acne for CRAWL unless it is quantised:
    // slide the box by a fraction of a texel and every shadow edge in the
    // frame re-samples and wobbles. Snapping the box origin to whole texels in
    // the light's own basis is what makes a following shadow camera hold
    // still. This is that basis, and it never changes because the moon does
    // not move.
    this.lightUp.set(0, 1, 0).cross(MOON_DIR).normalize();
    this.lightRight.copy(MOON_DIR).cross(this.lightUp).normalize();

    this.setShadowCasters();
  }

  /**
   * Only things tall enough to throw a shadow worth seeing cast one.
   *
   * Two reasons, and the first is the flicker again: the road, the pavement
   * and the driveways are FLAT, and a flat surface casting onto itself is a
   * pure acne generator with nothing to show for it. The second is craft —
   * a mailbox's moon shadow at this texel density is four grey pixels of
   * noise, not a shadow.
   */
  private setShadowCasters(): void {
    for (const object of this.world.group.children) {
      const mesh = object as THREE.Mesh;
      if (!mesh.isMesh) continue;
      // Untagged children are the horizon plane and the glow decals, and
      // neither is a thing that casts: defaulting to 0 opts them out.
      const height = (mesh.userData.cpHeight as number | undefined) ?? 0;
      mesh.castShadow = !mesh.userData.cpRoad && height >= SHADOW_CASTER_MIN_HEIGHT;
    }
  }

  /**
   * Re-centre the shadow box on the road ahead, snapped to whole shadow texels.
   */
  private followShadow(): void {
    const moon = this.moon;
    if (!moon) return;

    // Ahead of the car rather than on it: the player is looking down the
    // street, and shadows behind the bumper are not in frame.
    this.shadowFocus
      .copy(this.car.position)
      .addScaledVector(this.car.forward, SHADOW_SPAN * 0.22)
      .setY(0);

    const texel = SHADOW_SPAN / 2048;
    const u = Math.round(this.shadowFocus.dot(this.lightRight) / texel) * texel;
    const v = Math.round(this.shadowFocus.dot(this.lightUp) / texel) * texel;
    const w = this.shadowFocus.dot(MOON_DIR);
    this.shadowFocus
      .copy(this.lightRight)
      .multiplyScalar(u)
      .addScaledVector(this.lightUp, v)
      .addScaledVector(MOON_DIR, w);

    moon.target.position.copy(this.shadowFocus);
    moon.position.copy(this.shadowFocus).addScaledVector(MOON_DIR, MOON_DISTANCE);
    moon.target.updateMatrixWorld();
  }

  /** Lamp halos are flat quads; turn them edge-on to the camera each frame. */
  private faceHalos(camera: THREE.Camera): void {
    const halos = this.world.lightHalos;
    if (!halos) return;
    const yaw = Math.atan2(
      camera.position.x - this.car.position.x,
      camera.position.z - this.car.position.z
    );
    this.haloSpin.setFromAxisAngle(UP, yaw);
    this.world.haloAnchors.forEach((anchor, index) => {
      this.haloMatrix.compose(anchor, this.haloSpin, HALO_SCALE);
      halos.setMatrixAt(index, this.haloMatrix);
    });
    halos.instanceMatrix.needsUpdate = true;
  }

  /**
   * A konyha panorámája az égbolt helyére.
   *
   * Háttérnek ÉS környezeti fénynek egyszerre: a `environment` az, amitől a
   * kocsi lakkja és a házak ablakai visszaverik a lámpa narancsát.
   */
  private async loadKitchen(): Promise<void> {
    const env = await kitchenSurround(this.renderer);
    if (!env || this.disposed) return;
    this.scene.environment = env;
    this.scene.background = env;
    // A KÖRNYEZETI FÉNY VISSZAVÉVE.
    //
    // Teljes erővel a panoráma NAPPALLÁ teszi az estét: a környezeti
    // megvilágítás minden felületre rákerül, és egy éjszakai játékban ez pont
    // azt a sötétet viszi el, amiért a lopakodás működik.
    //
    // Harmincöt százalék: a lámpa narancsa és az ablak kékje ott van az autó
    // lakkján és a házak ablakain, de a város marad éjszakai.
    this.scene.environmentIntensity = 0.35;
    // A háttér maga viszont HALVÁNYABB, mint a fény, amit ad: az üvegen át
    // nézve a konyha derengés, nem tapéta.
    this.scene.backgroundIntensity = 0.55;
    // A számolt ég leváltva: két égbolt egymáson az elsőt sem hagyná látszani.
    if (this.sky) {
      this.scene.remove(this.sky);
      this.sky = null;
    }
  }


  /**
   * Az autó ütközőteste, tengelyhez igazított dobozként.
   *
   * A doboz nem forog, a kocsi igen — ezért a félméretek a szögből nőnek:
   * keresztben álló autó szélesebb dobozt kap. Ez kicsit nagyvonalúbb a
   * valódi karosszériánál átlós állásban, de a hibája a JÓ irányba esik:
   * inkább koccan egy centivel előbb, mint hogy átcsússzon a másikon.
   */
  private static box(
    into: THREE.Box3,
    position: THREE.Vector3,
    heading: number
  ): THREE.Box3 {
    const halfLong = CAR.spineSpread + CAR.bodyRadius;
    const halfWide = CAR.bodyRadius;
    const sin = Math.abs(Math.sin(heading));
    const cos = Math.abs(Math.cos(heading));
    const ex = halfLong * sin + halfWide * cos;
    const ez = halfLong * cos + halfWide * sin;
    return into.set(
      new THREE.Vector3(position.x - ex, position.y, position.z - ez),
      new THREE.Vector3(position.x + ex, position.y + 2.2, position.z + ez)
    );
  }

  /** Újrahasznált dobozok: képkockánként új Box3 nem kell a szemétgyűjtőnek. */
  private readonly obstacleBoxes: THREE.Box3[] = [];

  private refreshObstacles(): void {
    const list = this.car.obstacles;
    list.length = 0;
    let n = 0;
    const take = (): THREE.Box3 => {
      if (!this.obstacleBoxes[n]) this.obstacleBoxes[n] = new THREE.Box3();
      return this.obstacleBoxes[n++];
    };
    if (this.partner) DriveScene.box(take(), this.partner.position, this.partner.heading);
    if (this.cars) {
      for (const npc of this.cars.cars) {
        // Csak a KÖZELIEK: tizenkét NPC autóból egyszerre egy-kettő van
        // olyan közel, hogy számítson.
        const p = npc.mesh.position;
        if (Math.abs(p.x - this.car.position.x) > 24 || Math.abs(p.z - this.car.position.z) > 24) continue;
        DriveScene.box(take(), p, npc.mesh.rotation.y);
      }
    }
    for (let i = 0; i < n; i++) list.push(this.obstacleBoxes[i]);
  }

  /** Hol vannak a JÁTÉKOSOK kocsijai — az NPC-knek, hogy ne hajtsanak át rajtunk. */
  private readonly playerSpots: THREE.Vector3[] = [];
  private carPositions(): readonly THREE.Vector3[] {
    this.playerSpots.length = 0;
    this.playerSpots.push(this.car.position);
    if (this.partner) this.playerSpots.push(this.partner.position);
    return this.playerSpots;
  }

  update(step: number, elapsed: number): void {
    const networked = net.current.paired;

    if (!this.game.stats.arrived) {
      // AZ ÚTON ÁLLÓ TÖBBI AUTÓ. A falak listája állandó; ezek képkockánként
      // mozognak, ezért külön mennek — és a szimuláció ELŐTT frissülnek,
      // hogy azzal a helyzettel ütközzünk, amit a képernyőn is látunk.
      this.refreshObstacles();
      // A SAJÁT kocsidat MINDIG te szimulálod — kétfős módban is. Ez a
      // legfontosabb szabály az egészben: egy autót egy gép számol.
      this.car.update(step, this.input.get(this.localIndex), this.world.colliders);
      this.session.stats.secondsDriving[this.localIndex] += step;

      // A TÁRSÉT viszont sosem: azt a kapott állapotból rajzoljuk. Ha
      // mindkét gép átvenné a másikét, a két kocsi egymást rángatná, és
      // egyiknek sem lenne igaza.
      if (this.partner && netRoom) {
        this.link.apply(this.partner, netRoom.peers());
        this.partner.syncMesh(step);
      }
    }
    // A jelzőlámpák a KOCSITÓL FÜGGETLENÜL járnak: a piros akkor is vált, ha
    // állsz. A kocsi helye és iránya csak a szabályszegés eldöntéséhez kell.
    // A kihívás a KOCSI VALÓDI HALADÁSÁBÓL számol, nem a sebességből: egy
    // falnak nyomott gáz nem megtett út.
    const moved = this.car.position.distanceTo(this.lastCarAt);
    this.lastCarAt.copy(this.car.position);
    const wasDone = this.challenge.done;
    this.challenge.update(step, moved, this.car.position);
    this.checkpoints?.update(step, this.challenge.gateIndex);
    if (this.challenge.done && !wasDone) {
      this.game.say(this.challenge.cleared);
      sound.pickup();
    }

    // LERAKÁS a bázison: állni kell rajta, nem elhajtani mellette.
    if (this.session.delivery) {
      const put = this.session.delivery.update(step, this.localIndex as 0 | 1, this.car.position);
      if (put > 0) {
        this.game.say(`LERAKVA ${put} CUKORKA — összesen ${this.session.delivery.loads[this.localIndex as 0 | 1].delivered}`);
        sound.pickup();
      }
    }

    this.lights.update(step, this.car.position, this.car.heading);
    this.cars?.update(step, this.lights, this.carPositions());
    if (this.lights.justRan) {
      this.game.say('PIROSON MENTÉL ÁT');
      this.anger.ranRedLight();
    }

    // A HARAG. A vétségek forrása szétszórva él (a lámpa a kereszteződésben,
    // az elütés a szabályokban, a járda a pálya adataiban), de EGY számba
    // gyűlnek — mert a végén egy dolgot mondanak meg: mekkora falka vár a
    // háznál.
    const onPavement = !this.world.onRoad(this.car.position.x, this.car.position.z);
    this.anger.update(
      step,
      onPavement && Math.abs(this.car.speed) > 1,
      Math.abs(this.car.speed) / CAR.maxSpeed,
      this.input.get(this.localIndex).interact,
      this.car.boosting
    );
    if (this.game.stats.crittersHit > this.lastCrittersHit) {
      this.anger.hitCritter(this.game.stats.crittersHit - this.lastCrittersHit);
      this.lastCrittersHit = this.game.stats.crittersHit;
    }

    // Az utcán heverő cukorka: forog, lebeg, és felszedhető.
    const picked = this.streetCandy.update(step, elapsed, this.car.position);
    if (picked > 0) {
      this.session.stats.candy += picked;
      this.challenge.tookCandy(picked);
      this.game.say(picked > 1 ? `+${picked} cukorka az utcáról` : '+1 cukorka az utcáról');
      sound.pickup();
    }

    // A KOCCANÁS az eseményt követi, nem az állapotot: a `crashed` egyetlen
    // képkockára igaz, tehát a hang egyszer szól, nem hatvanszor másodpercenként.
    if (this.car.crashed) sound.thud(Math.min(1, this.car.impactSpeed / 14));
    // A gáz a SOFŐR pedálja, nem a kocsi sebessége: álló helyzetben tövig
    // nyomva is felbőg, ahogy egy igazi motor.
    //
    // Állva a KÉZIFÉK gombja is bőget. Nem új gomb, hanem egy üresen álló
    // régi: a kézifék csak egy méter/másodperc fölött kapcsol be (lásd
    // `Car.update`), tehát álló helyzetben úgysem csinál semmit. Aki egy
    // szörnyekkel teli terepjáróban ül és megáll, az rá fog nyomni.
    const driver = this.input.get(this.localIndex);
    const standing = Math.abs(this.car.speed) < 1;
    const revving = standing && driver.sprint ? 1 : 0;
    this.engine?.update(
      this.car.speed,
      CAR.maxSpeed,
      Math.max(0, driver.moveY, revving),
      step
    );
    // GUMI: a csikorgás és a nyom UGYANABBÓL a `slip` számból él, tehát nem
    // tudnak szétcsúszni — nem lehet hang nyom nélkül, se nyom hang nélkül.
    sound.skid(this.car.slip, Math.abs(this.car.speed) / CAR.maxSpeed);
    // A talajszintet a VILÁG mondja meg, pontonként: az út teteje nem a
    // kocsi magassága (lásd SkidMarks).
    this.base?.update(step);
    if (this.session.delivery && this.fogoHud) {
      const me = this.localIndex as 0 | 1;
      const them = (1 - me) as 0 | 1;
      const mine = this.session.delivery.loads[me];
      // Kint a „kézben" a KOCSIBAN lévő rakomány, a „sarokban" a leadott —
      // ugyanaz a két szerep, más helyen. Egy harmadik kijelzőt tanulni
      // kellene; ezt már ismered a házból.
      this.fogoHud.update(
        mine.inCar,
        mine.delivered,
        this.session.delivery.loads[them].delivered,
        null,
        0,
        0,
        false
      );
    }
    this.skids.update(step, this.car, this.groundAt);
    // A társ kocsija is nyomot hagy: a drift az ő teljesítménye, és kétfős
    // módban pont az a jó, ha látod, mit csinált.
    if (this.partner) this.skids.update(step, this.partner, this.groundAt);
    this.traffic.update(step, this.car, elapsed);
    this.game.driverIndex = this.session.driverIndex;

    if (networked && !this.amDriver) {
      // A navigátor gépén a saját gombjai nem helyben hatnak, hanem átmennek
      // a sofőr gépére — ott van a világ, amit mozgatnak.
      const nav = this.input.get(net.current.playerIndex);
      if (nav.interact && !this.game.parked) this.link.sendVerb('target');
      if (nav.jump) this.link.sendVerb('ping');
      if (nav.sprint) this.link.sendVerb('radar');
    }

    // A sofőr gépén a navigátor gombjai nem helyiek; a navigátor gépén
    // viszont a sofőr nem szimulál, tehát ott sem kell kétszer lefutniuk.
    this.game.localNavigator = !networked;
    this.game.update(step, this.input);

    if (this.amDriver) {
      this.link.publish(
        this.car,
        this.game.targetId,
        this.game.stats.score,
        this.game.stats.arrived,
        this.game.radarLeft
      );
    }

    if (this.game.stats.arrived && !this.finished) {
      this.session.currentHouseName = this.game.target.name;
      this.session.targetHouseId = this.game.target.id;
      this.finished = true;
    }
  }

  /** Kint a nyilak a kamerát forgatják az autó körül. */
  look(x: number, y: number, dt: number): void {
    this.stage.look(x, y, dt);
  }

  render(frameTime: number, width: number, height: number): void {
    // A jelölés a célt KÖVETI: a navigátor CÉL gombja menet közben is
    // átrakhatja, és egy ott felejtett narancsszínű folt a régi háznál pont
    // arra tanítana, hogy ne higgy neki.
    if (this.parkingFor !== this.game.targetId) {
      this.parkingFor = this.game.targetId;
      this.parking.moveTo(this.game.target.driveway);
    }
    this.parking.update(frameTime, this.game.parked);
    this.dome.update(frameTime);
    this.spider.update(frameTime);
    this.shelf.update(frameTime);

    // Gyertyaláng-lüktetés. Két eltérő frekvenciájú szinusz, mert egyetlen
    // szinusz szabályos pulzálás — ami gépnek látszik, nem lángnak.
    for (const w of this.windowGlow) {
      const t = this.glowClock + w.phase;
      w.light.intensity = w.base * (0.82 + Math.sin(t * 2.3) * 0.1 + Math.sin(t * 7.1) * 0.08);
    }
    this.glowClock += frameTime;

    const panes = this.stage.layout(width, height);
    this.stage.update(frameTime, this.car, panes.driver, this.world.colliders);
    this.followShadow();
    this.faceHalos(this.stage.camera);
    this.stage.render(this.renderer, this.scene, panes.driver);

    const rect = this.hud.mapRect(panes);
    this.map.place(rect.x, rect.top, rect.w, rect.h);
    this.map.draw(
      this.world,
      this.car,
      this.traffic,
      this.game.targetId,
      this.game.radarLeft,
      this.challenge.remainingGates,
      this.partner ? this.partner.position : null
    );
    this.hud.update(
      this.game,
      this.car,
      panes,
      width,
      [this.input.get(0).usingGamepad, this.input.get(1).usingGamepad],
      this.session.selection.names,
      this.stage.solo,
      this.session.stats,
      this.anger
    );
  }

  pauseActions(): Partial<PauseActions> {
    return { onSwapRoles: () => this.session.swapRoles() };
  }

  /** Fold this leg's driving into the run before the scene goes away. */
  commit(): void {
    const s = this.session.stats;
    s.crittersHit += this.game.stats.crittersHit;
    s.nearMisses += this.game.stats.nearMisses;
    s.crashes += this.game.stats.crashes;
    s.drivingScore += this.game.stats.score;
  }

  dispose(): void {
    this.link?.dispose();
    // A motor a szakasszal együtt áll le. Egy ottfelejtett oszcillátor a
    // házban is szólna — és mivel folyamatos, azonnal észrevehető lenne.
    this.engine?.stop();
    sound.skidOff();
    this.fogoHud?.dispose();
    this.skids.dispose();
    this.disposed = true;
    this.commit();
    this.hud.dispose();
    this.map.dispose();
    this.scene.clear();
    pruneOutlines();
  }
}
