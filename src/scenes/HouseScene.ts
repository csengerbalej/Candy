import * as THREE from 'three';
import { setStageLens, stage, tiltStage, turnStage } from '../camera/Stage';
import { FIRST_PERSON, CAMERA, PLAYER_COUNT, PALETTE, HOMEOWNER, DOG, GUNS, MOVE, CAPTURE, DELIVERY } from '../core/config';
// The first house is a real flat now, not the greybox kitchen. Both offer the
// same surface to this scene, so the swap is one import and one await.
import { VillageHouse, CANDY_HEIGHT_HUMAN } from '../world/VillageHouse';
import { PlayerController } from '../player/PlayerController';
import { SplitScreenDirector } from '../camera/SplitScreenDirector';
import { Armoury } from '../game/Armoury';
import { Capture } from '../game/Capture';
import { Corners } from '../world/Corners';
import { LooseCandy } from '../world/LooseCandy';
import { FogoHud } from '../ui/FogoHud';
import { Rival } from '../ai/Rival';
import { PickupsView } from '../world/PickupsView';
import { HeldWeapon } from '../render/HeldWeapon';
import { Tracer } from '../render/Tracer';
import { Impact } from '../render/Impact';
import { Weapon, type Target } from '../game/Weapon';

import { Homeowner } from '../ai/Homeowner';
import { Haunt } from '../game/Haunt';
import { Jumpscare } from '../ui/Jumpscare';
import { HauntHud } from '../ui/HauntHud';
import { HauntBrief } from '../ui/HauntBrief';
import { Torch } from '../world/Torch';
import { Batteries } from '../world/Batteries';
import { Glimpse } from '../world/Glimpse';
import { Mumus } from '../world/Mumus';
import { Masonry } from '../world/Masonry';
import { HAUNT, HOUSE, NOISE } from '../core/config';
import { makeRandom } from '../core/seed';
import { planFor, planToWorld } from '../world/HousePlan';
import { Dog } from '../ai/Dog';
import { kennelAt } from '../world/Kennel';
import { Echo } from '../world/Echo';
import { NoiseSystem } from '../systems/NoiseSystem';
import { HouseGame } from '../game/HouseGame';
import { Hud } from '../ui/Hud';
import { HouseMap } from '../ui/HouseMap';

/**
 * Ilyen közelről a falon át is MEGÉRZED, hogy ott van valaki.
 *
 * Ez az egyetlen, amit a minitérkép a látómezőn felül elárul — és pont ennyi
 * kell ahhoz, hogy a térkép ne csak a képernyő megismétlése legyen.
 */
const HEARD_WITHIN = 22;
import { models } from '../assets/ModelLoader';
import { toonify, addOutlines, pruneOutlines } from '../render/Toon';
import { studioEnvironment, applyEnvironment } from '../render/Environment';

/**
 * The players' key light, in candela.
 *
 * Calibrated against the rest of the room rather than by eye: fridge 180,
 * doorway 230, the homeowner's torch 900. Anything much below a hundred and
 * the players are dimmer than the furniture.
 */
const CHARACTER_KEY = 60;
import {
  CharacterRig,
  HOMEOWNER_CLIPS,
  KOVETO_CLIPS,
  LESO_CLIPS,
  VAK_CLIPS,
  type Rig,
} from '../render/CharacterRig';
import { ProceduralRig } from '../render/ProceduralRig';
import { CHARACTERS } from '../game/Characters';
import type { InputManager } from '../input/InputManager';
import type { Session } from '../game/Session';
import type { GameScene } from './GameScene';
import type { PauseActions } from '../ui/PauseMenu';
import { BlobShadow } from '../render/BlobShadow';
import { sound } from '../audio/Sound';
import { HouseLink } from '../net/HouseLink';
import { net, netRoom } from '../main';

/** One house: stealth, candy, pranks, escape (spec §13–§20). */
export class HouseScene implements GameScene {
  readonly scene = new THREE.Scene();
  finished = false;
  private disposed = false;


  readonly players: PlayerController[];
  private readonly collidersFor: THREE.Box3[][];
  private readonly director = new SplitScreenDirector(PLAYER_COUNT);

  /** A pályán heverő fegyverek — szabályok és kirajzolás. */
  private armoury: Armoury | null = null;
  private readonly pickups = new PickupsView();
  /** Ami a kezünkben van. Üres kézzel indulunk: a fegyvert meg kell találni. */
  private held: Weapon | null = null;
  private readonly heldView = new HeldWeapon();
  /** Az előző képkocka töltési állapota — ebből lesz a két kattanás. */
  private wasReloading = false;
  /** A FOGÓ mód: sarkok, szabálytábla, AI ellenfél. `null` kooperatívban. */
  private capture: Capture | null = null;
  private corners: Corners | null = null;
  private rival: Rival | null = null;

  // --- KÍSÉRTETHÁZ ---------------------------------------------------------
  /** A mód szabályai: ki áll a lábán, mennyi van a telepben, vége van-e. */
  private haunt: Haunt | null = null;
  /** A szörnyek. Ugyanaz az osztály, mint a lakó — más hangolással. */
  private readonly lurkers: Homeowner[] = [];
  /** Melyik szörny melyik arccal ijeszt. */
  private readonly lurkerFaces: string[] = [];
  /**
   * A SZÖRNYEK FAJTÁJA és a hozzá tartozó számlálók.
   *
   * Fegyver nincs: mindegyiket MÁSTÓL lehet elijeszteni, és ez a tudás a
   * fegyver. Az árnyékot a fény elégeti, a lesőt a fény ébreszti fel — a
   * lámpa tehát egyszerre a helyes és a végzetes válasz, attól függően,
   * hogy mi áll ott a sötétben.
   */
  private readonly lurkerKind: Array<'vak' | 'leso' | 'koveto'> = [];
  /** Mennyi ideje éri a fény (árnyék), vagy mióta nyugodt (leső). */
  private readonly lurkerTimer: number[] = [];
  /** Amíg fut, elijesztve van és nem jön vissza. */
  private readonly lurkerFled: number[] = [];
  /** Mióta nem lát a Követő — ennyi kell a lerázásához. */
  private readonly lurkerShake: number[] = [];
  /** A Követő előző távolsága — ebből derül ki, hogy TÁVOLODSZ-e tőle. */
  private readonly lurkerLast: number[] = [];
  /** A távolodás fél másodperces ablaka. */
  private readonly lurkerWindow: number[] = [];
  private jumpscare: Jumpscare | null = null;
  private torch: Torch | null = null;
  private batteries: Batteries | null = null;
  private glimpse: Glimpse | null = null;
  private mumus: Mumus | null = null;
  /** Mikor bukkanjon fel legközelebb. */
  private kovetkezoMumus: number = HAUNT.mumusFirst;
  private masonry: Masonry | null = null;
  /** Mikor szaladjon át a következő alak. */
  private kovetkezoAlak = 18;
  /** Hol tart a kifelé menetel. */
  private kijutas = 0;
  /** A szekrények világkoordinátában — ide lehet bebújni. */
  private readonly hideSpots: THREE.Vector3[] = [];
  private hauntHud: HauntHud | null = null;
  private hauntBrief: HauntBrief | null = null;
  /** A ház hangjának órája: a szívverés és a neszek ütemezéséhez. */
  private hangClock = 0;
  private szivUtolso = 0;
  /** Mikor hallatta magát utoljára az a szörny (fajtánként). */
  private readonly lurkerHang: number[] = [];
  private kovetkezoNesz = 6;
  /** Az AI teste. A második játékos helyén ül, ha nincs valódi társ. */
  private rivalBody: PlayerController | null = null;

  /** Álló bemenet az AI testéhez: a gombokat az esze adja, nem a billentyűzet. */
  private static readonly IDLE = {
    moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
    interact: false, interactHeld: false, pause: false, usingGamepad: false, nitro: false,
  } as const;

  /** A fogó mód kijelzője. Kooperatívban nem születik meg. */
  private fogoHud: FogoHud | null = null;

  /** A célkereszt. Csak belső nézetben és csak fegyverrel látszik. */
  private readonly crosshair = (() => {
    const el = document.createElement('div');
    el.className = 'crosshair';
    el.innerHTML = '<i></i><i></i><i></i><i></i>';
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  })();
  private readonly homeowner: Homeowner;
  /**
   * A kutya — CSAK a harmadik házban.
   *
   * Nem minden ház kap kettőt: a két fogó együtt más játék, és ha mindenhol
   * ott lenne, nem lenne mit megtanulni a harmadik telekről.
   */
  private readonly dog: Dog | null;
  /**
   * A zaj visszhangja — CSAK a sötét házban.
   *
   * Világos szobában értelmetlen lenne: ott amúgy is látsz. Sötétben viszont
   * ez az egyetlen módja, hogy a szoba távolabbi fele egyáltalán megmutassa
   * magát — és mivel a zaj az üldözőket is hívja, minden felfedés fizet.
   */
  private readonly echo: Echo | null;
  private readonly noise = new NoiseSystem();
  readonly game: HouseGame;
  private readonly hud: Hud;
  private readonly map: HouseMap;
  private exitGrace = 0;

  /** Melyik szörny az enyém ezen a gépen, és van-e egyáltalán társ. */
  private readonly localIndex: 0 | 1;
  private readonly partnered: boolean;
  /** A gazda futtatja a lakót és a szabályokat; a vendég a kapottat rajzolja. */
  private readonly amHost: boolean;
  private readonly link: HouseLink;

  static async create(
    renderer: THREE.WebGLRenderer,
    input: InputManager,
    session: Session,
    parent: HTMLElement
  ): Promise<HouseScene> {
    // MELYIK ház ez? A SORREND dönti el: az első házad a lakás, a második a
    // folyosós, a harmadik a gyűrűs. A telek sorszáma nem szól bele.
    // A `?haz=2` a fejlesztéshez: egy adott ház betöltése anélkül, hogy
    // végig kellene játszani odáig. Enélkül a második ház vaksötétjét (és az
    // éjjellátót) csak két teljes menet után lehetne megnézni — és amit
    // drága megnézni, azt előbb-utóbb nem nézi meg senki.
    const forced = new URLSearchParams(location.search).get('haz');
    // A KÍSÉRTETHÁZNAK SAJÁT HÁZA VAN.
    //
    // Nem a meglévők sötét változata: azok a szörnyecskék léptékében
    // épültek (a lakó 6,4 magas, ti 1,7), és egy horrorban pont az kell,
    // hogy a ház EMBERMÉRETŰ legyen. A kúria huszonöt szobás, folyosórácsa
    // körökből áll, és egy egység benne egy méter.
    const name = session.haunt
      ? 'mansion'
      : forced
        ? `house${forced}`
        : VillageHouse.pickInOrder(session.visited.size);
    const world = await VillageHouse.load(`models/${name}.json`, `models/${name}-nav.json`);
    const scene = new HouseScene(renderer, input, session, world, parent);
    scene.houseName = name;
    scene.applyHouseName();
    return scene;
  }

  private constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly input: InputManager,
    private readonly session: Session,
    private readonly world: VillageHouse,
    parent: HTMLElement
  ) {
    // Indoors the camera looks further down, wider, and from further back.
    setStageLens({
      pitch: CAMERA.housePitch,
      fov: CAMERA.houseFov,
      minDistance: CAMERA.houseMinDistance,
      maxDistance: CAMERA.houseMaxDistance,
      followDistance: CAMERA.houseFollowDistance,
    });
    this.scene.background = new THREE.Color(PALETTE.fog);
    this.scene.add(this.world.group);

    this.players = [0, 1].map((i) => {
      const def = CHARACTERS[session.selection.characters[i]];
      const player = new PlayerController(i, def.color, this.world.spawns[i]);
      player.traits = def.traits;
      this.scene.add(player.mesh);
      return player;
    });

    // The ghost's gates are simply absent from its collider list (spec §5C).
    this.collidersFor = this.players.map((p) =>
      p.traits.passesGates
        ? this.world.colliders
        : [...this.world.colliders, ...this.world.gateColliders]
    );

    this.homeowner = new Homeowner(
      this.world.homeownerSpawn,
      this.world.patrolWaypoints,
      this.world.occluders
    );
    // Sight against the grid, not against 200k triangles. See VillageHouse.
    this.homeowner.sightBlocked = (from, to) => this.world.sightBlocked(from, to);
    // ...és a falak MEGÁLLÍTJÁK. A játékosnak volt ütközése, a lakónak nem —
    // átsétált a falon, ami pont a szakasz ígéretét vonta vissza.
    // A LAKÓ NEM MEHET BE A GYŰJTŐSZOBÁKBA.
    //
    // A két sarok BIZTONSÁGOS: a felnőtt nem lép be. Enélkül a hazaút utolsó
    // két métere a legveszélyesebb pont a pályán — pont ott, ahol már nem
    // tudsz kitérni, mert a sarokban állsz. Egy menedék nélkül a mód
    // egyetlen tanulsága az volna, hogy sose vigyél haza semmit.
    //
    // A járhatóságba kötve, nem külön szabályként: így az útkeresése, a
    // járőrözése és a kergetése MIND tudja — egy helyen kimondva nem tud
    // kimaradni az egyikből.
    this.homeowner.walkable = (x, z, radius) =>
      this.world.walkable(x, z, radius) && !this.inSafeRoom(x, z);
    // ...és ha mégis sarokba szorul, a világ megmondja, hol fér el.
    this.homeowner.rescue = (from, toward, radius) => this.world.nearestStanding(from, toward, radius);
    // ...és megkerüli a falakat ahelyett, hogy nekifeszülne.
    this.homeowner.findRoute = (from, to, radius) => this.world.route(from, to, radius);

    // The camera shows the room you are standing in and nothing else. Both
    // halves of the answer live in the world — which room a point is in, and
    // the planes that cut everything else away — and the director asks for
    // them per pane, so two players in two rooms each get their own.
    //
    // `roomNear` rather than `roomAt`: someone standing in a doorway belongs to
    // no room by the grid's reckoning, and a camera that reads "no room" there
    // would cut to nothing for the two steps it takes to walk through.
    // A szereposztás a szobából jön, és a HÁZ egész idejére rögzül. Nem
    // képkockánként olvassuk: ha a társ félúton kilép, a lakó nem cserélhet
    // gazdát a szoba közepén — az a futó járőrözést dobná el. A ház végén
    // úgyis újraszámolódik.
    this.partnered = net.current.paired;
    this.localIndex = this.partnered ? net.current.playerIndex : 0;
    this.amHost = !this.partnered || net.current.role === 'host';
    this.link = new HouseLink(this.partnered ? netRoom : null, this.amHost, this.localIndex);

    this.syncWallHeight();
    // A FEGYVEREK a járőrpontokra és a cukorkák helyére kerülnek: ezek a
    // pontok már bizonyítottan járhatók és a szobák közepén vannak — egy
    // fegyver a fal tövében fele annyit ér, mert nem látszik.
    // A FELKÍNÁLT PONTOK. A járőrpontok építésből járhatók; a cukorkahelyek
    // viszont TÁLAKON állnak, tehát bútorban — egy oda tett sarokból a
    // fizika azonnal kilökte a játékost (mérve 15,6 egységgel arrébb került
    // az induláskor). A sarkokhoz ezért csak a járható pontok jöhetnek
    // szóba; a fegyverek maradhatnak a tálak mellett is, azokat nem kell
    // megállni rajtuk.
    // Csak az a pont lehet sarok, ahol a TEST IS ELFÉR.
    //
    // A rács járhatósága a padlóról szól, az ütközők a bútorokról — és a
    // kettő nem ugyanaz. Az első változatban a sarok egy asztal ütközőjében
    // állt: a rács szerint rendben volt, a fizika mégis 15,6 egységgel
    // arrébb lökte a játékost. Ezért a szűrés most azt kérdezi, amit a
    // játék is: ha ide állok, itt maradok-e.
    // A SARKOK CSAK JÁRŐRPONTOK LEHETNEK.
    //
    // A járőrpontokat a ház generátora a TESTHEZ igazítva adja ki — a lakó
    // végigsétál rajtuk, tehát bizonyítottan el lehet rajtuk állni. A
    // cukorkahelyek ellenben tálakon vannak, vagyis bútorban: az első
    // változatban egy ilyen lett sarok, és a fizika 15,6 egységgel arrébb
    // lökte a játékost az induláskor.
    // A SARKOK VÉLETLEN, SZABAD HELYEKRE kerülnek — és soha nem egy tálra.
    //
    // A járőrpontok nem jók erre: a térképgenerátor a cukorkát pont azok
    // MELLÉ teszi, tehát a hatból ötnél egy tál áll a sarokban (mérve
    // 1,6 egységre). A játékos képe ezt mutatta: a gyűjtősarokban ott volt a
    // tök. Ez nem csak zavaró — a tál elfoglalja a helyet, ahová le kell
    // tenni, és a cukorka, amiért mennél, már eleve otthon van.
    //
    // Hatvan sorsolt pontból választunk; a kettő közül a legtávolabbi párt a
    // `Corners` keresi ki. Így minden kör máshol van a két sarok is.
    // KÖZÖS SORSOLÁS. Kétfős fogóban a `Math.random` a két gépen mást ad, és
    // a pálya kettéhasadna: a te sarkod a konyhában, a társadé a fürdőben, és
    // mindketten meg volnátok győződve róla, hogy a másik csal. Ugyanabból a
    // magból indulva viszont ugyanaz a sorozat jön ki mindkét gépen —
    // üzenetváltás és várakozás nélkül.
    const sors = this.partnered && net.seed ? makeRandom(`${net.seed}|${this.houseName}`) : Math.random;
    this.sors = sors;

    // A MEGRAJZOLT ALAPRAJZ, ha van ehhez a házhoz.
    //
    // A sorsolás nem tud arról, hogy a fürdőszoba zsákutca, és hogy két
    // cukorka egy szobában nem két cél, hanem egy. A rajz tud. Ahol van
    // rajz, az dönt; ahol nincs, marad a sorsolás — nem hagyunk házat
    // játszhatatlanul csak azért, mert még nem rajzoltuk meg.
    const plan = planFor(this.houseName);
    const terv = plan && this.world instanceof VillageHouse ? plan : null;
    const hely = (pt: { u: number; v: number }): THREE.Vector3 => {
      const raw = planToWorld(pt, (this.world as VillageHouse).bounds);
      // A rajz a PADLÓRÓL szól, a bútorokról nem: a pont a legközelebbi
      // olyan helyre ugrik, ahol a test is elfér.
      return this.world.nearestStanding(raw, raw, MOVE.radius);
    };

    const bowls = this.world.candySpots.map((c) => c.position);
    const walkable: THREE.Vector3[] = [];
    if (terv) {
      for (const c of terv.corners) walkable.push(hely(c));
    } else {
      for (let i = 0; i < 60; i++) {
        const p = this.world.randomStanding(sors, MOVE.radius, bowls, 7);
        if (p) walkable.push(p);
      }
    }
    const spots = [
      ...this.world.patrolWaypoints,
      ...this.world.candySpots.map((c) => c.position),
    ];
    // A FEGYVEREK VÉLETLEN HELYEKRE kerülnek, és SOHA nem a gyűjtősarkokba:
    // egy sarokban termő fegyvert az kapna ingyen, aki épp hazaért.
    const avoid = this.corners ? this.corners.list.map((c) => c.position) : [];
    const random: THREE.Vector3[] = [];
    if (terv) {
      for (const w of terv.weapons) random.push(hely(w));
    } else {
      for (let i = 0; i < 40; i++) {
        const p = this.world.randomStanding(sors, MOVE.radius, avoid, CAPTURE.bankRadius * 3);
        if (p) random.push(p);
      }
    }

    // A KÍSÉRTETHÁZBAN NINCS FEGYVER.
    //
    // Nem elfelejtett kapcsoló: amint lőni lehet, a szörny célponttá válik,
    // és a félelem elpárolog. A fegyver minden kérdésre ugyanaz a válasz —
    // ebben a módban viszont pont az a játék, hogy mindegyikre MÁS.
    //
    // (Egyszer már beírtam ezt a feltételt, és némán nem érvényesült: a
    // keresett sor közé azóta bekerült egy megjegyzés, tehát a csere nem
    // talált. Azóta minden ilyen csere ellenőrzi magát.)
    if (!session.haunt && (random.length >= 4 || spots.length)) {
      // A KÖZÖS SORSOLÓ a fegyvereknek is kell: melyik fegyver hol terem, és
      // mikor jön vissza. Enélkül a te sörétesed a társad gépén mesterlövész
      // volna, ugyanazon a helyen.
      this.armoury = new Armoury(random.length >= 4 ? random : spots, sors);
      this.scene.add(this.pickups.group);
      void this.pickups.load();
    }
    this.scene.add(this.heldView.group);
    this.scene.add(this.tracer.mesh);
    this.scene.add(this.impact.group);

    // BELSŐ NÉZET ALAPBÓL. A ház a lopakodás és a keresés helye, és mindkettő
    // arról szól, MIT LÁTSZ: felülről a fáklyakúp egy rajz a padlón, a
    // vaksötét ház egy sötét alaprajz. A külső nézet megmarad a V… illetve a
    // C gombon, mert egy elakadt kamera ellen kell egy kiút — de a JÁTÉK a
    // szemből nézett.
    queueMicrotask(() => {
      if (this.director.firstPerson === null) this.toggleFirstPerson();
    });
    // ...ÉS OTT IS MARAD.
    //
    // Egy egyszeri bekapcsolás kevés volt: játszva felülnézetben indult a
    // kör. A rendezőt a kör alatt más is állíthatja (ablakméret, szünet,
    // szobavágás), és ha közben visszaáll külsőre, a játékos egy
    // alaprajzot néz egy horrorjáték helyett. Amíg a C-vel KI nem kéri,
    // minden képkockán visszatérünk a szemhez.
    this.belsotAkar = true;

    this.director.soloActive = this.localIndex;
    this.director.framing = {
      roomFor: (at) => this.world.roomBounds(this.world.roomNear(at.x, at.z)),
      // A kamera vízszintes iránya dönti el, MELYIK falat bontjuk le: azt,
      // amelyik köztünk és a szoba között áll. Forgatás (Q) után a bontott fal
      // magától átvált a másik oldalra.
      clipFor: (at) =>
        // A SZOBAVÁGÁS KIKAPCSOLVA: az egész ház látszik.
        //
        // A vágás a FELÜLNÉZET miatt kellett — ott a szomszéd szoba
        // tartalma a te szobád elé került volna. Belső nézetben viszont a
        // falak maguk takarnak, tehát a vágás már csak elvesz: a nyitott
        // ajtón át nem látni be a másik szobába, pedig a valóságban látni
        // lehetne. Egy verseny, amiben nem látod, hol jár az ellenfél,
        // szegényebb.
        this.director.firstPerson !== null
          ? []
          : this.world.roomClipPlanes(
              this.world.roomNear(at.x, at.z),
              new THREE.Vector3(Math.sin(stage.yaw), 0, Math.cos(stage.yaw))
            ),
    };
    // A kennel: a lakó járőrpontjai közül a LEGTÁVOLABBI a bejárattól. A
    // kutya ne az ajtóban aludjon — onnan minden belépés felriasztaná, és a
    // ház első három másodperce eldőlne, mielőtt bármit csinálnál.
    if (VillageHouse.pickInOrder(session.visited.size) === 'house3' && this.world.patrolWaypoints.length) {
      const far = this.world.patrolWaypoints.reduce((a, b) =>
        b.distanceTo(this.world.exitZone) > a.distanceTo(this.world.exitZone) ? b : a
      );
      this.dog = new Dog(far);
      // A kutya sem mehet a menedékbe: egy biztonságos szoba, ahová a kutya
      // bemehet, nem biztonságos — csak kisebb.
      this.dog.walkable = (x, z, radius) =>
        this.world.walkable(x, z, radius) && !this.inSafeRoom(x, z);
      this.dog.rescue = (from, toward, radius) => this.world.nearestStanding(from, toward, radius);
      this.dog.findRoute = (from, to, radius) => this.world.route(from, to, radius);
      // A kóborlása a lakó járőrpontjain megy, csak fordított sorrendben:
      // így a két üldöző nem egymás nyomában jár, és a ház két fele
      // egyszerre él.
      this.dog.roam.push(
        ...[...this.world.patrolWaypoints]
          .reverse()
          .map((p) => this.world.nearestStanding(p, far, DOG.width * 0.5))
      );
      this.scene.add(this.dog.group);
      this.dog.group.add(new BlobShadow(0.9).mesh);
      this.scene.add(kennelAt(far));
    } else {
      this.dog = null;
    }

    this.scene.add(this.homeowner.group);
    this.homeowner.group.add(new BlobShadow(1.4).mesh);

    this.game = new HouseGame(this.world, this.homeowner, this.noise, this.dog);

    // FOGÓ MÓD. A sarkok a legtávolabbi két pontra kerülnek: két egymás
    // melletti sarokkal a cipelés elvész — felveszed, két lépés, letetted.
    if (session.fogo && spots.length) {
      // A RAJZ SZERINTI CUKORKAHELYEK. A ház öt helyet hoz magával a
      // kooperatív körhöz; a fogóban viszont az számít, melyik SZOBÁBAN
      // terem, mert a szoba a térfél — és ehhez nyolc hely kell, nem öt.
      if (terv && this.world instanceof VillageHouse) {
        this.world.placeCandy(terv.candy.map(hely));
        // A RAJZ MONDJA MEG, melyik cukorka kié. A közelebbi sarok szabálya
        // a pálya közepén érmét dobna — a konyha épp félúton van.
        terv.candy.forEach((c, i) => {
          const spot = this.world.candySpots[i];
          if (spot && c.owner !== undefined) spot.owner = c.owner;
        });
      }
      const legkozelebbiSarok = (p: THREE.Vector3): number =>
        Math.min(...(this.corners?.list ?? []).map((c) => c.position.distanceTo(p)));
      this.corners = new Corners(
        walkable.length >= 2 ? walkable : this.world.patrolWaypoints
      );
      this.scene.add(this.corners.group);
      this.capture = new Capture(this.corners.list);
      this.fogoHud = new FogoHud(document.body);
      this.splitSides();

      this.looseView = new LooseCandy();
      this.scene.add(this.looseView.group);
      void this.looseView.load();
      this.game.capture = this.capture;
      this.game.localSlot = this.localIndex;

      // A KEZDŐHELY A SAJÁT SARKOD.
      //
      // Az ajtóból indulva az első út mindig ugyanaz volt: be a házba, ki a
      // sarokhoz, és csak utána kezdődött a játék. A sarokból indulva az
      // első döntésed már az, hogy MERRE INDULSZ cukorkáért — és a hazaút
      // hossza is rögtön kiderül.
      for (const corner of this.corners.list) {
        // A NAVIGÁCIÓS RÁCS ÉS AZ ÜTKÖZŐK NEM UGYANAZT MONDJÁK.
        //
        // A sarok a rács szerint járható volt, mégis 15,6 egységgel arrébb
        // került a játékos az induláskor: a pont egy bútor ütközőjén belül
        // esett, és a fizika kitolta. A rács a PADLÓRÓL szól, az ütközők a
        // TÁRGYAKRÓL — a kettő nem ugyanaz, és itt derül ki.
        //
        // A `nearestStanding` pont ezt oldja meg: a legközelebbi olyan
        // helyet adja, ahol a TEST is elfér. A sarok jelölője marad, ahol
        // van; a lerakás sugara (2,4) bőven elnyeli a különbséget.
        this.players[corner.player].position.copy(corner.position);
        this.players[corner.player].mesh.position.copy(corner.position);
      }
      // A LAKÓ NEM ÁLLHAT A SARKODBAN, AMIKOR ELKEZDŐDIK.
      //
      // Mérve: a megrajzolt alaprajz a narancssárga sarkot a hálószobába
      // tette, a lakó indulóhelye pedig ott van — öt egységre. A kör úgy
      // kezdődött, hogy már üldözött, mielőtt egy lépést tettem volna. Egy
      // szabály, ami azt mondja, „a sarokba nem jöhet be", semmit nem ér, ha
      // a kör kezdetén már ott áll az ajtóban.
      //
      // A járőrpontok közül arra kerül, ami a KÉT SAROKTÓL EGYÜTT a
      // legtávolabb van. Nem új szabály: ugyanaz a járőrözés indul, csak a
      // ház közepéről, nem valakinek a hálószobájából.
      const tavol = [...this.world.patrolWaypoints].sort(
        (a, b) => legkozelebbiSarok(b) - legkozelebbiSarok(a)
      )[0];
      if (tavol) {
        this.homeowner.position.copy(tavol);
        this.homeowner.group.position.copy(tavol);
      }

    }

    // === KÍSÉRTETHÁZ ========================================================
    //
    // A harmadik mód. Nem a fogó egy beállítása: ott egymás ellen játszotok,
    // itt egymásért — és ez más szabályokat kér, nem ugyanazokat szigorúbban.
    if (session.haunt) {
      // A TÖK IS EMBERMÉRTÉKŰ: harmincöt centi, nem derékig érő. A
      // méretezés a világ dolga, nem a jeleneté — ezért a ház tudja.
      if (this.world instanceof VillageHouse) {
        this.world.candyHeight = CANDY_HEIGHT_HUMAN;
        this.world.placeCandy(this.world.candySpots.map((c) => c.position));
      }
      // A TŰZ ÉS A TÁVCSŐ GOMB nem kell ide: ebben a módban nincs fegyver.
      // Az érintőgombokat a CSS veszi ki, ebből a jelzésből.
      document.body.dataset.mode = 'haunt';
      // EGYEDÜL a szobakód és a társ-sor nem jelenhet meg: nincs kit
      // meghívni, és nincs kinek a talpon létét jelenteni.
      if (!this.partnered) document.body.dataset.solo = '1';
      this.haunt = new Haunt();
      this.jumpscare = new Jumpscare(document.body);
      this.hauntHud = new HauntHud(document.body);
      this.hauntBrief = new HauntBrief(document.body);
      this.torch = new Torch();
      this.scene.add(this.torch.group);
      this.glimpse = new Glimpse();
      this.scene.add(this.glimpse.group);

      // A MUMUS EGYELŐRE KIMARAD (HAUNT.mumusOn).
      //
      // Az ötlet áll: a társad alakjában jön, és csak akkor mozdul, amikor
      // nem nézel rá. A kivitel viszont játszva nem az volt: ÁTJÖTT A
      // FALON, nekiment a játékosnak, és egy villanással beugrott egy
      // karakter — ez nem félelmetes, hanem olcsó. Két dolog hiányzik
      // hozzá: ütközés a házzal (a mumus most a rács nélkül közelít), és
      // egy találkozás, ami nem egyetlen villanás.
      //
      // A kód marad, mert a hibái javíthatók, és a felépítés jó.
      this.mumus = new Mumus();
      this.scene.add(this.mumus.group);
      const kie = this.partnered ? 1 - this.localIndex : this.localIndex;
      const alak = CHARACTERS[session.selection.characters[kie]];
      void this.mumus.load(alak.model, alak.clips);

      // ELEMEK: nyolc darab, szétszórva a házban, a saroktól távol. Nyolc
      // darab plusz háromszázhatvan másodpercnyi fény — több, mint a telep
      // maga —, de csak akkor, ha mindet megtalálod, és a keresés is
      // fénybe kerül. Ez a mód gazdasága.
      const elemek: THREE.Vector3[] = [];
      // ÖT ELEM, NEM NYOLC. Játszva úgy jött ki, hogy „egy picit túl
      // gyakori a lámpa": ha minden sarokban van pót, akkor a fény nem
      // erőforrás, hanem adottság — és a sötétség, amire az egész mód
      // épül, sosem következik be.
      for (let i = 0; i < 5 && elemek.length < 5; i++) {
        const p = this.world.randomStanding(sors, MOVE.radius, elemek, 12);
        if (p) elemek.push(p);
      }
      this.batteries = new Batteries(elemek);
      this.scene.add(this.batteries.group);

      // A SZEKRÉNYEK HELYE a ház nav fájljából jön, nem külön listából: a
      // bútort a házgenerátor rakta ki, tehát ő tudja, hol áll.
      const nav = (
        this.world as unknown as {
          nav?: {
            hideSpots?: [number, number][];
            wallRuns?: [number, number, number, number][];
            doors?: { at: [number, number]; vizszintes: boolean; cells: [number, number][] }[];
            wallCell?: number;
          };
        }
      ).nav;
      for (const p of nav?.hideSpots ?? []) {
        this.hideSpots.push(new THREE.Vector3(p[0] * 36, 0, -p[1] * 36));
      }

      // A KŐFAL KÉPE. A ház geometriája generált; a falak képét a letöltött
      // kőpanelből vesszük, és a MEGLÉVŐ anyagra tesszük rá.
      //
      // AJTÓ NINCS. Volt: nyíló-csukódó, kétszárnyú, a Követőt elzáró. De a
      // vaksötét házban a lámpa fényében egyedül AZ látszott ki élesen a
      // falból — a többi felület fekete maradt mellette —, és egy ajtó, ami
      // fontosabbnak látszik a háznál, nem ajtó, hanem hiba. A nyílások
      // nyitva maradnak: a Vak elől nincs hová becsukódni.
      if (nav?.wallRuns && this.world instanceof VillageHouse) {
        this.masonry = new Masonry();
        this.scene.add(this.masonry.group);
        void this.masonry.load().then(() => {
          // A KÉP A HÁZ ANYAGÁRA kerül, nem külön geometriára: egy kép, egy
          // anyag, egy rajzolási hívás.
          const kep = this.masonry?.wallTexture;
          if (!kep) return;
          this.world.group.traverse((o) => {
            const mesh = o as THREE.Mesh;
            if (!mesh.isMesh) return;
            const anyag = mesh.material as THREE.MeshStandardMaterial;
            if (!('map' in anyag)) return;
            anyag.map = kep;
            anyag.needsUpdate = true;
          });
        });
      }

      // A SZÖRNYEK ugyanaz az osztály, mint a lakó.
      //
      // Nem lustaságból: a lakó már tud mindent, amit egy szörnynek tudnia
      // kell — lát, hall, járőrözik, üldöz, elveszíti a nyomot. Egy külön
      // „szörny-intelligencia" ugyanezt írná le még egyszer, és a hibái is
      // külön hibák lennének. Ami más, az a HANGOLÁS és a KINÉZET.
      // A HÁROM SZÖRNY. Mindegyiknek saját modellje van, és mindegyik
      // pontosan arra a szabályra készült, amit megtestesít: a vaknak
      // óriási füle van és nincs szeme, a követő átázott kabátban jön, a
      // lesőnek pókszemei vannak — azok verik vissza a lámpád fényét.
      const fajok = [
        { kind: 'vak' as const, model: 'models/lurker-vak.json', arc: 'werewolf' as const },
        { kind: 'koveto' as const, model: 'models/lurker-koveto.json', arc: 'zombie' as const },
        { kind: 'leso' as const, model: 'models/lurker-leso.json', arc: 'vampire' as const },
      ];
      for (let i = 0; i < HAUNT.monsters; i++) {
        // Mindegyik MÁS pontról indul és más sorrendben járja a házat:
        // különben hárman ugyanazt a kört rónák egymás mögött.
        const utvonal = [...this.world.patrolWaypoints];
        for (let k = utvonal.length - 1; k > 0; k--) {
          const j = Math.floor(this.sors() * (k + 1));
          [utvonal[k], utvonal[j]] = [utvonal[j], utvonal[k]];
        }
        const faj = fajok[i % fajok.length];
        // A LESŐ OTT ÁLL, AHOVÁ ÚGYIS MENNED KELL.
        //
        // Ő az egyetlen, aki nem járőrözik: áll a sötétben, amíg rá nem
        // világítasz. Egy véletlen járőrpontra téve ez azt jelentette, hogy
        // a huszonöt szobából egybe került, és ha nem sétáltál be pont oda,
        // SOHA nem találkoztál vele — játszva pontosan ez jött vissza:
        // „egy szörny látszik a játékban, és az a Vak".
        //
        // Cukorka mellé állítva viszont biztosan összefuttok: oda menned
        // kell. Két méterrel odébb, hogy ne a zsákmányon álljon — a
        // lámpáddal kell megtalálnod, nem belebotlanod.
        let start = utvonal[0] ?? this.world.homeownerSpawn;
        if (faj.kind === 'leso' && this.world.candySpots.length) {
          const hol = this.world.candySpots[
            Math.floor(this.sors() * this.world.candySpots.length)
          ].position;
          const szog = this.sors() * Math.PI * 2;
          const mellette = new THREE.Vector3(
            hol.x + Math.sin(szog) * 2,
            0,
            hol.z + Math.cos(szog) * 2
          );
          start = this.world.walkable(mellette.x, mellette.z, MOVE.radius)
            ? mellette
            : this.world.nearestStanding(mellette, hol, MOVE.radius);
        }
        const szorny = new Homeowner(start.clone(), utvonal, this.world.occluders);
        szorny.sightBlocked = (from, to) => this.world.sightBlocked(from, to);
        szorny.walkable = (x, z, radius) => this.world.walkable(x, z, radius);
        szorny.rescue = (from, toward, radius) => this.world.nearestStanding(from, toward, radius);
        szorny.findRoute = (from, to, radius) => this.world.route(from, to, radius);

        // A HÁROM TULAJDONSÁG. Nem három nehézségi fok — három KÉRDÉS,
        // amire másképp kell válaszolni.
        // EMBERMÉRTÉKŰ TEST ÉS TEMPÓ. A lakó számai egy óriáshoz valók: 2,2
        // egység széles test és 7,6-os üldözési sebesség. Itt a test 0,8
        // (átfér egy ajtón), a tempó pedig a te sebességedhez mérve dől el.
        // A TEST SZÉLESEBB, MINT A LÁBNYOMA — ezért lógott bele a falba.
        //
        // Mérve: a szörnyek SOHA nem álltak nem járható cellán (hatvan
        // mintából nulla), tehát az útkeresés jó volt. Csak épp a 0,8-es
        // ütközőtest egy kétméteres, széttárt karú modellt visz: a lény
        // szabályosan állt a nyílás közepén, a karja viszont átment a
        // falon. Ez látszott „bebuggolt" szörnynek.
        //
        // 1,2 még bőven átfér a három méteres nyílásokon (a korábbi 2,2
        // volt az, ami beragadt és vibrált a küszöbökön), de a falaktól
        // már fél méterrel távolabb tartja.
        szorny.bodyWidth = 1.2;
        // A SZÖRNYEK NEM VILÁGÍTANAK. A lakó zseblámpája 900 candela — ez
        // a házban a legerősebb fény, és háromszor is szerepelne. Egy
        // szörny, aki maga elé világít, ráadásul elárulná magát: sötétben
        // csak a szeme látszik, és pont ez a jó benne.
        szorny.torchOn(false);

        if (faj.kind === 'vak') {
          // A VAK NEM LÁT. Nem „rosszul lát": a látása egyszerűen nem
          // létezik, mert minden útjába kerülőt falnak hisz. Ami marad, az
          // a hallása — és ettől lesz a csend maga a védelem.
          szorny.sightBlocked = () => true;
          szorny.speedScale = 0.5;
        } else if (faj.kind === 'koveto') {
          // A KÖVETŐ LASSÚ, ÉS NEM ADJA FEL. A kettő együtt a jelleme: ha
          // gyors volna, esélytelen lenne ellene; ha feladná, elég volna
          // befordulni egy sarkon. Így viszont futni kell — és a futás
          // zaj, amit a másik kettő meghall.
          // LASSÚ, MERT NEM BÁNT. A mérés mutatta meg, mennyire számít: 0,62-vel
          // az üldözési tempója 4,7 m/s, a futásod 5,2 — fél méter másodpercenként
          // a különbség, vagyis a lerázáshoz kellő tíz méter hat másodpercnyi
          // szakadatlan futás lett volna takarásban. A szabály papíron létezett,
          // a játékban nem. 0,42-vel a különbség két méter másodpercenként:
          // futva másfél másodperc, sétálva épphogy semmi.
          szorny.speedScale = 0.42;
          szorny.relentless = true;
          // ŐT NEM KELL MEGGYŐZNI. A többi szörny lát vagy hall; a követő
          // egyszerűen TUDJA, hol vagy. Ez nem csalás, hanem a szerepe: ő
          // az, aki elől nem elbújni kell, hanem lehagyni.
          szorny.sightBlocked = () => false;
        } else {
          // A LESŐ ÁLL. Amíg rá nem világítasz, nem is létezik: nem
          // járőrözik, nem hall, nem néz. Amikor viszont felébred, ő a
          // leggyorsabb a házban.
          szorny.speedScale = 0.64;
          szorny.state = 'IDLE';
        }
        this.lurkers.push(szorny);
        // Egy mindegyikből: három szörny, három ellenszer. Ha kettő volna
        // ugyanolyan, az egyik tudás feleslegessé válna.
        this.lurkerKind.push(faj.kind);
        this.lurkerTimer.push(0);
        // A KÖVETŐ nem a bejáratnál vár: az első ötven másodperc a
        // kutatásé. Ugyanaz a számláló tartja távol, ami a lerázás után.
        this.lurkerFled.push(faj.kind === 'koveto' ? HAUNT.stalkerWake : 0);
        this.lurkerShake.push(0);
        this.lurkerLast.push(Infinity);
        this.lurkerWindow.push(0);
        // AZ IJESZTÉS KÉPE A SZÖRNYÉ, NEM EGY JÁTÉKOS KARAKTERÉ.
        //
        // Eddig a választóképernyő portréi ugrottak rád: a Vak elkapásánál
        // egy mosolygó plüss vérfarkas. A házban járkáló lényeknek
        // egyszerűen nem volt képük. Most van: a `render-face.py` a
        // modellből rendereli, alulról jövő kemény fénnyel — azzal a
        // szöggel, amivel épp ráfogtad a lámpát.
        this.lurkerFaces.push(`art/monsters/lurker-${faj.kind}.webp`);
        this.scene.add(szorny.group);
        void this.dressLurker(szorny, faj.model, faj.kind);
      }

      // A LAKÓ nincs a házban: itt nem egy dühös felnőtt a tét. A csoportját
      // kivesszük a jelenetből, hogy ne bolyongjon egy szörnyekkel teli
      // házban egy pizsamás ember.
      this.homeowner.group.visible = false;
      this.homeowner.position.set(0, -500, 0);

      // MINDEN MÁS FÉNY KIALSZIK.
      //
      // Két okból, és mindkettő számít. Mérve harminc fényforrás égett a
      // jelenetben: a szereplők kulcs-, derítő- és peremfénye, a lámpások,
      // a lakó zseblámpája, a szörnyeké. Előre renderelésnél MINDEN fény
      // MINDEN képpontra számol — harminc fény a képkockaidő legnagyobb
      // tétele, és ettől akadozott.
      //
      // A másik ok a fontosabb: egy horrorházban egyetlen fénynek szabad
      // égnie, a tiédnek. Ha a szoba magától látszik, akkor nincs sötét,
      // és ha nincs sötét, nincs miért félni.
      // EGYETLEN HALVÁNY KÖRNYEZETI FÉNY marad. Vak feketén nem lopakodsz,
      // hanem tapogatózol: ennyi pont a körvonalakra elég, a formákra már
      // nem — azokhoz oda kell vinni a saját fényedet. Környezeti fény,
      // tehát nem kerül képpontonkénti számításba.
      // A HÁZ FOGADJA ÉS VETI AZ ÁRNYÉKOT. A falak és a bútor eddig csak
      // „ott voltak"; árnyékkal a fénykúp formát kap, és egy ajtónyílás
      // mögül előbb látod meg a hosszú, vetülő alakot, mint magát a
      // szörnyet.
      this.world.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
      });

      const derengés = new THREE.AmbientLight(0x2a2438, 0.09);
      this.scene.add(derengés);

      queueMicrotask(() => {
        const kimeloek = new Set<THREE.Object3D>([derengés]);
        this.torch?.group.traverse((o) => kimeloek.add(o));
        this.scene.traverse((o) => {
          const l = o as THREE.Light;
          if (!l.isLight || kimeloek.has(o)) return;
          l.intensity = 0;
        });
      });

      // A CSÍNYEK KARIKÁI sincsenek itt: a padlón világító zöld gyűrűk azt
      // üzennék, hogy ez itt játék. A kúria nav fájlja nem is ad csínyt, ez
      // csak a biztosíték.
      for (const csiny of this.world.prankSpots) csiny.mesh.visible = false;

      // EMBERMÉRTÉKŰ MOZGÁS. A hatos alapsebesség itt olimpiai sprint
      // volna, a tizenkét méteres dupla ugrás pedig a falakat tenné
      // díszletté — a szoba attól szoba, hogy nem lehet átugrani.
      for (const p of this.players) {
        p.jumpScale = HAUNT.jump;
        p.airJumpsAllowed = 0;
        p.traits = { ...p.traits, speed: p.traits.speed * HAUNT.speed };
      }
    }

    if (session.fogo && this.capture) {
      // A KIJUTÁS pillanatában a sarok tartalma a kocsiba kerül. A könyvelés
      // a munkameneté, nem a jeleneté: a rakománynak túl kell élnie az ajtót.
      this.game.onEscape = () => {
        const delivery = session.delivery;
        if (!delivery || !this.capture) return;
        for (const i of [0, 1] as const) {
          delivery.setCorner(i, this.capture.banked[i]);
          delivery.escaped(i);
        }
      };

      // AZ ELLENFÉL. Ha nincs valódi társ, egy AI ül a második helyen — és a
      // TESTE a második játékos meglévő szabályozója, nem egy külön dolog:
      // így a lakó ugyanúgy látja és kergeti, a falak ugyanúgy megállítják,
      // és a hálózati rajzolás is ugyanaz marad.
      if (!this.partnered) {
        this.rivalBody = this.players[1 - this.localIndex];
        this.rival = new Rival(
          this.rivalBody.position.clone(),
          {
            bowls: () =>
              this.world.candySpots
                // Az AI is csak a SAJÁT SZÍNŰ cukorkáját viheti — ugyanaz a
                // szabály vonatkozik rá, mint rád.
                .filter((c) => !c.taken && (c.owner === undefined || c.owner === this.rival?.index))
                .map((c) => c.position),
            walkable: (x, z, r) => this.world.walkable(x, z, r),
            route: (from, to, r) => this.world.route(from, to, r) ?? [],
            dangers: () => [this.homeowner.position, ...(this.dog ? [this.dog.position] : [])],
            sightBlocked: (a, b) => this.world.sightBlocked(a, b),
            takeBowl: (at) => {
              const bowl = this.world.candySpots.find(
                (c) =>
                  !c.taken &&
                  (c.owner === undefined || c.owner === this.rival?.index) &&
                  c.position.distanceTo(at) < 2.4
              );
              if (!bowl) return false;
              bowl.taken = true;
              bowl.mesh.visible = false;
              return true;
            },
          },
          (1 - this.localIndex) as 0 | 1
        );
      }
    }


    this.game.names = session.selection.names;
    // Egyedül a co-op kapuk egy emberre szűkülnek: nincs kit odavinni a
    // másik szörnnyel, tehát a kijárat sem kérhet kettőt.
    this.game.cast = this.partnered ? [0, 1] : [this.localIndex];
    if (!this.partnered && !session.fogo) {
      // A társ szörnye ne álljon mozdulatlanul a lakásban: nincs mögötte
      // senki, és a lakó sem keresheti.
      //
      // FOGÓ MÓDBAN VISZONT VAN mögötte valaki: az AI. Ha itt elrejtenénk,
      // az ellenfél láthatatlan lenne — versenyezni valamivel, amit nem
      // látsz, nem verseny.
      this.players[this.localIndex === 0 ? 1 : 0].mesh.visible = false;
    }

    // A VISSZHANG-FÉNYEK NINCSENEK A KÍSÉRTETHÁZBAN.
    //
    // A sötét kooperatív házban ez segítség: minden zaj felvillant egy kis
    // kék fényt ott, ahol keletkezett, tehát LÁTOD a hangokat. Tizenkét
    // pontfény forog körbe erre a célra.
    //
    // Itt viszont a séta is zajt kelt — és ettől a tizenkét fény FOLYAMATOSAN
    // égett körülötted, ahogy mentél. Kívülről ez pontosan az, hogy
    // „kivilágosodik a szoba, ha mozgok": nem a lámpád változott, hanem a
    // saját lépteid gyújtottak fényt.
    //
    // És ha nem is világítanának túl, akkor is rossz volna: egy horrorban a
    // hangot HALLANI kell, nem látni. Aki látja a zajt, az nem fél tőle.
    this.echo = this.dark && !session.haunt ? new Echo() : null;
    if (this.echo) this.scene.add(this.echo.group);
    this.addLighting();

    // A low emissive fill, now that every surface in the room carries a
    // texture. toonify lifts a textured material by `fill` so an unlit greybox
    // is not a black hole — but on real textures at the default 0.2 that same
    // lift makes the wallpaper glow, and a stealth room whose walls emit light
    // has no darkness left to hide in.
    // A SÖTÉT HÁZBAN ez a két szám a lényeg, nem a lámpák.
    //
    // A `floor` a toon-rámpa legalsó sávja: egy teljesen megvilágítatlan
    // felület ENNYIN látszik, akkor is, ha egyetlen fény sem éri. 0,27-tel
    // hiába oltottam el a szobát — a fal a saját színe negyedén világított, és
    // a „sötét pálya" csak egy sötétebb tapéta volt. A `fill` ugyanez az
    // önvilágítás oldaláról.
    //
    // Nem nulla: vak feketén a falak sem látszanak, és akkor nem lopakodsz,
    // hanem tapogatózol. Ennyi pont a körvonalakra elég, a formákra már nem —
    // azokhoz oda kell vinni a saját fényedet.
    const toon = this.dark ? { floor: 0.012, fill: 0.003 } : { floor: 0.27, fill: 0.06 };
    // A KÍSÉRTETHÁZ FALAIT NEM CEL-SHADELJÜK.
    //
    // A cel-shading a megvilágítást SÁVOKRA vágja — ez a játék stílusa, és
    // egy felülről nézett, egyenletesen világított szobában jól is áll. Egy
    // zseblámpával bevilágított folyosón viszont pont fordítva sül el:
    // ahogy lépsz, a fal és a szemed szöge alig változik, a sáv viszont
    // ÁTBILLEN — és egy egész fal egyszerre ugrik sötétből világosba.
    //
    // Kívülről ez pontosan úgy néz ki, hogy „kivilágosodik a szoba, ha
    // mozgok". Nem a fény változik, hanem az, hogy hány sávba esik.
    //
    // Sima árnyalással a fényerő folytonos: közelebb lépve fokozatosan
    // világosodik, ahogy egy lámpától várnád.
    if (!this.session.haunt) toonify(this.world.group, toon);
    toonify(this.homeowner.group, toon);
    addOutlines(this.homeowner.group, 0.9);
    for (const p of this.players) {
      // Greybox placeholder only; the authored art is never toonified.
      toonify(p.mesh, toon);
      addOutlines(p.mesh, 0.9);
    }
    void this.loadCharacters(toon);
    // A LAKÓ MODELLJE NÉGY MEGABÁJT — és a kísértetházban nincs is lakó.
    //
    // Mérve: a horror kör 7,6 MB-ot tölt le, és ebből 4,5 olyan fájl, amit
    // soha nem használ (a lakó, a klipjei, az éjjellátó). Egy linken
    // megosztott játéknál ez nem apróság: ennyivel tovább tart az első
    // betöltés, mobilneten pedig ez a különbség a „kipróbálom" és a
    // „bezárom" között.
    if (!session.haunt) void this.loadHomeowner();
    void this.loadDog();

    this.hud = new Hud(parent);
    this.map = new HouseMap(parent);

    // A ház zenéje: lopakodós, halk. A vezetésnek szándékosan nincs zenéje —
    // ott a motor és a kürt a hang, és egy aláfestés elvenné a kontrasztot,
    // amitől a ház csendje csend.
    //
    // A KÍSÉRTETHÁZBAN VISZONT NINCS ZENE. Nem spórolás: a horror a
    // CSENDEN áll. Zene alatt minden hang aláfestés lesz — egy lépés a
    // hátad mögött összekeveredik egy hangszerrel, és pont az veszik el,
    // amitől megfordulnál. Ráadásul a zene MEGMONDJA, mikor kell félni;
    // csendben viszont te találod ki, és mindig rosszul.
    if (!session.haunt) sound.playMusic('audio/house.mp3');
  }

  /**
   * A falak rajzolt magassága kövesse a kameraszöget.
   *
   * Ez a kettő EGY döntés: egy lapos kamera alacsony falat bír el, egy alacsony
   * fal viszont járdaszegélynek néz ki. Külön hangolva mindig egymás ellen
   * dolgoztak. Itt egyetlen helyen dől el, a szögből.
   */
  /** A T gomb hívja: az új szög után a falak magasságát is igazítani kell. */
  /** Odabent a nyilak a szobát keretező színpadot forgatják. */
  look(x: number, y: number, dt: number): void {
    // Belső nézetben a fel-le nézés a SAJÁT fejem szöge, nem a színpad
    // dőlése: a színpad dőlése azt mondja meg, milyen szögből LÁTJUK a
    // szobát, és belső nézetben nincs ilyen szög.
    // A VÍZSZINTES FORGÁS BELÜL FORDÍTOTT.
    //
    // Külső nézetben a nyíl a SZÍNPADOT forgatja a játékos körül: jobbra
    // nyomva a kamera jobbra kerül, és a világ ettől balra fordul a képen —
    // ez orbitálásnál helyes. Belső nézetben viszont nincs mit körbejárni: a
    // kamera a fejben ül, és ott ugyanez a jel BALRA fordítja a fejet, amikor
    // jobbra húzol. Egy előjel a különbség, és pont ezt a fajta előjelet nem
    // lehet fejben eldönteni — a képernyőn kell megnézni.
    const inside = this.director.firstPerson !== null;
    turnStage(inside ? -x : x, dt);
    if (inside) {
      this.director.fpPitch = THREE.MathUtils.clamp(
        this.director.fpPitch + y * 1.6 * dt,
        FIRST_PERSON.pitchMin,
        FIRST_PERSON.pitchMax
      );
      return;
    }
    tiltStage(y, dt);
  }

  /**
   * Nézetváltás: belső és külső között.
   *
   * A saját testet belső nézetben el kell tüntetni — a kamera a fejben ül,
   * és onnan a saját koponya belseje látszana. A TÁRSÉ viszont marad: őt
   * látni kell, különben egy láthatatlan ellenfél ellen játszol.
   */
  /** Akarjuk-e a belső nézetet. A C gomb kikapcsolja, és akkor tiszteletben tartjuk. */
  private belsotAkar = false;
  /**
   * Szemle mód: a szörnyek sorba állnak és nem bántanak.
   *
   * Címsorból (`?szemle` vagy `#szemle`) és a 0 gombbal is. A gomb azért
   * kell, mert a kiadott lap egy kereten belül fut, és oda a címsor
   * paramétere nem feltétlenül jut el — egy mérőeszköz, amit nem lehet
   * bekapcsolni, nem mérőeszköz.
   */
  private szemle =
    typeof location !== 'undefined' &&
    (location.search.includes('szemle') || location.hash.includes('szemle'));
  private szemleHelyek: THREE.Vector3[] = [];

  /**
   * A SZEMLE HELYEI: a legszabadabb irány, ami a játékos előtt van.
   *
   * Hatvannégy irányt mérünk körbe, és azt választjuk, amerre a legtovább
   * lehet menni fal nélkül — mert a ház tele van két méteres zsákutcákkal,
   * és egy falba állított szörny pontosan úgy néz ki, mint egy hibás.
   */
  private szemletHelyez(at: THREE.Vector3): void {
    let legjobb = { yaw: 0, tav: 0 };
    for (let k = 0; k < 64; k++) {
      const yaw = (k / 64) * Math.PI * 2;
      let d = 1;
      for (; d < 12; d += 0.5) {
        if (!this.world.walkable(at.x + Math.sin(yaw) * d, at.z + Math.cos(yaw) * d, 1)) break;
      }
      if (d > legjobb.tav) legjobb = { yaw, tav: d };
    }
    // ...ÉS A KAMERA IS ARRA NÉZ. A szemle akkor ér valamit, ha nem kell
    // megkeresni őket: a ház sötét, és egy rossz irányba néző kamera pont
    // azt a kérdést hagyja nyitva, amit el akarunk dönteni.
    stage.yaw = legjobb.yaw;
    const oldalX = Math.cos(legjobb.yaw);
    const oldalZ = -Math.sin(legjobb.yaw);
    const tav = Math.max(3, Math.min(6, legjobb.tav - 1));
    this.szemleHelyek = this.lurkers.map((_, i) => {
      const oldal = (i - (this.lurkers.length - 1) / 2) * 1.6;
      const p = new THREE.Vector3(
        at.x + Math.sin(legjobb.yaw) * tav + oldalX * oldal,
        0,
        at.z + Math.cos(legjobb.yaw) * tav + oldalZ * oldal
      );
      return this.world.walkable(p.x, p.z, 0.6) ? p : this.world.nearestStanding(p, at, 0.6);
    });
  }

  toggleFirstPerson(): boolean {
    const on = this.director.firstPerson === null;
    this.belsotAkar = on;
    this.director.firstPerson = on ? this.localIndex : null;
    this.director.fpPitch = 0;
    const mine = this.players[this.localIndex];
    // A MOZGÁS is tudja meg: belső nézetben az „előre" a nézés iránya.
    mine.firstPerson = on;
    // Belső nézetben a mutatót elkapjuk: a touchpad mozdulata lesz a nézés.
    // Külső nézetben nem — ott a húzás a jó, mert a kamera a szobát keretezi,
    // és egy elkapott mutatóval nem lehetne a menüre kattintani.
    this.input.lookLock = on;
    // A blokkolt test és a modell is az enyém: mindkettőt el kell tenni.
    mine.mesh.visible = !on;
    this.game.banner = on ? 'BELSŐ NÉZET' : 'KÜLSŐ NÉZET';
    // A FAL MAGASSÁGA a nézettel jár.
    //
    // Külső nézetben a falkorona LE VAN VÁGVA (9,9 egység), hogy a kamera
    // belásson a szobába — ez a „Sims-féle bontás". Belső nézetben ugyanez a
    // vágás azt jelentené, hogy a szomszéd szobába átlátsz a falon fölött,
    // és a lopakodásból nem marad semmi: a lakót a falon keresztül látnád
    // jönni. Belül tehát a fal a teljes magasságát visszakapja.
    if (on) this.world.setWallHeight(VillageHouse.fullWallHeight);
    else this.syncWallHeight();
    return on;
  }

  setCameraPitch(degrees: number): void {
    this.syncWallHeight();
    this.game.banner = `KAMERA ${degrees}°`;
  }

  /**
   * A KIÜRÍTETT TÁLAK újratöltése, fogó módban.
   *
   * A házban három tál van, a kvóta öt — az utolsó tál után nem volt honnan
   * cukorkát szerezni, és a kör megnyerhetetlenné vált. Nem nehéz volt,
   * hanem lehetetlen.
   *
   * Kooperatívban ez a szabály KI VAN KAPCSOLVA: ott a kvóta a felemelt
   * tálak száma, és egy újratelő tál visszazárná a már kinyílt ajtót.
   */
  /**
   * A HÁZ KÉT TÉRFÉLRE OSZTÁSA, és a cukorka kiosztása.
   *
   * A választóvonal a két sarok FELEZŐ MERŐLEGESE: minden pont ahhoz a
   * térfélhez tartozik, amelyik sarok közelebb van hozzá. Nem kell hozzá
   * külön geometria, és bármilyen alaprajzon értelmes marad.
   *
   * A csavar: a cukorka annak a játékosnak a színét kapja, akinek a sarka
   * TÁVOLABB van tőle — vagyis mindenki a MÁSIK térfelén gyűjt. Ettől lesz a
   * házból két egymásba fonódó útvonal: aki gyűjt, az ellenfél otthonában
   * jár, és közben a sajátja őrizetlen marad.
   */
  private splitSides(): void {
    if (!this.corners) return;
    const [a, b] = this.corners.list;
    for (const spot of this.world.candySpots) {
      const near = spot.position.distanceTo(a.position) <= spot.position.distanceTo(b.position)
        ? a
        : b;
      // A közelebbi sarok térfelén vagyunk → a cukorka a MÁSIK játékosé.
      // Kivéve, ha a megrajzolt alaprajz már megmondta: az erősebb, mert
      // ott ember döntött, nem távolságmérés.
      if (spot.owner === undefined) spot.owner = (near.player === 0 ? 1 : 0) as 0 | 1;
      const colour = spot.owner === 0 ? PALETTE.p1 : PALETTE.p2;
      spot.mesh.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const material = (mesh.material as THREE.MeshStandardMaterial).clone();
        material.color = new THREE.Color(colour);
        // Enyhén világít: a sötét házban a színnek is látszania kell,
        // különben a tulajdonos megkülönböztetése csak elmélet.
        material.emissive = new THREE.Color(colour).multiplyScalar(0.35);
        mesh.material = material;
      });
    }
  }

  /**
   * Biztonságos-e ez a pont: a gyűjtősarkok körüli menedék.
   *
   * A sugár nagyobb a lerakás sugaránál (2,4): a menedék nem lehet pont
   * akkora, mint a cél, különben a lakó az orrod előtt állva vár.
   */
  private inSafeRoom(x: number, z: number): boolean {
    if (!this.corners) return false;
    return this.corners.list.some(
      (c) => Math.hypot(c.position.x - x, c.position.z - z) < CAPTURE.bankRadius * 2.4
    );
  }

  /**
   * AZ ÉJJELLÁTÓ a vaksötét házban.
   *
   * Nem a fegyverek közé raktam, mert nem fegyver: nem lőni lehet vele,
   * hanem LÁTNI — és a második ház egész játéka a látáson áll. Ráállásra
   * veszed fel (mint mindent), húsz másodpercig tart, aztán a pálya
   * máshol adja vissza.
   */
  private updateNightVision(step: number): void {
    if (!this.goggles) return;

    if (this.nightVisionLeft > 0) {
      this.nightVisionLeft -= step;
      if (this.nightVisionLeft <= 0) {
        this.nightLight.intensity = 0;
        this.nightTint.hidden = true;
        this.game.banner = 'AZ ÉJJELLÁTÓ KIFOGYOTT';
      }
    }

    if (!this.goggles.visible) {
      this.gogglesWait -= step;
      if (this.gogglesWait <= 0) this.placeGoggles();
      return;
    }

    this.goggles.rotation.y += step * 1.4;
    this.goggles.position.y = 1.1 + Math.sin(performance.now() / 500) * 0.12;

    const me = this.players[this.localIndex];
    if (me.position.distanceTo(this.goggles.position) < 2) {
      this.goggles.visible = false;
      this.gogglesWait = DELIVERY.nightVisionRespawn;
      this.nightVisionLeft = DELIVERY.nightVision;
      // A fény a SAJÁT szemedé: egy környezeti fény, ami csak neked világít.
      // Nem a szobát kapcsolja fel — a lakó és az ellenfél ugyanolyan
      // sötétben marad, mint eddig.
      this.nightLight.intensity = 1.5;
      this.nightTint.hidden = false;
      sound.pickup();
      this.game.banner = `ÉJJELLÁTÓ — ${DELIVERY.nightVision} mp`;
    }
  }

  /** Új helyre teszi az éjjellátót. Véletlen, szabad pontra. */
  private placeGoggles(): void {
    if (!this.goggles) return;
    // A KÖZÖS SORSOLÓ: az éjjellátó ugyanoda kerül mindkét gépen. Két külön
    // helyen termő szemüveg azt jelentené, hogy ketten ugyanazt veszitek fel.
    const at = this.world.randomStanding(this.sors, MOVE.radius, [], 0);
    if (!at) return;
    this.goggles.position.set(at.x, 1.1, at.z);
    this.goggles.visible = true;
  }

  private goggles: THREE.Object3D | null = null;
  private gogglesWait = 0;
  private nightVisionLeft = 0;
  private readonly nightLight = new THREE.AmbientLight(0x9fffc9, 0);
  private readonly nightTint = (() => {
    const el = document.createElement('div');
    el.className = 'nightvision';
    el.hidden = true;
    document.body.appendChild(el);
    return el;
  })();

  private refillBowls(step: number): void {
    if (!this.capture) return;
    for (const spot of this.world.candySpots) {
      if (!spot.taken) continue;
      const timer = (this.refill.get(spot) ?? 0) + step;
      if (timer < DELIVERY.bowlRefill) {
        this.refill.set(spot, timer);
        continue;
      }
      this.refill.delete(spot);
      spot.taken = false;
      spot.mesh.visible = true;
    }
  }

  private readonly refill = new Map<object, number>();
  /** A földön heverő cukorka kirajzolása. */
  private looseView: LooseCandy | null = null;
  /** Megtörtént-e már a sarokba állítás. Lásd az első képkockás ismétlést. */
  private spawnPlaced = false;
  /** A lövések nyomjelző csíkja. Minden lövés látható, a sajátom és az AI-é is. */
  private readonly tracer = new Tracer();
  /** A becsapódás: szikrák és a rakéta robbanásgyűrűje. */
  private readonly impact = new Impact();

  /**
   * ÚJRAÉLEDÉS a saját sarokban (R gomb).
   *
   * Amitől ez nem ingyen menekülés: minden cukorka, ami a kezedben van, ITT
   * MARAD a földön — pontosan úgy, mintha lelőttek volna. A sarokba szorított
   * játékosnak így van kiútja, de az ellenfél nem jár rosszul: megkapja azt,
   * amiért végigkergetett.
   *
   * A rövid bénulás az érkezés után azt akadályozza meg, hogy az újraéledés
   * GYORSABB legyen, mint a gyaloglás — különben a sarokba szorítás helyett
   * az R gomb lenne a leggyorsabb közlekedés.
   */
  private respawn(): void {
    if (!this.capture || !this.corners) return;
    const me = this.localIndex as 0 | 1;
    const corner = this.corners.list.find((c) => c.player === me);
    if (!corner) return;
    const body = this.players[me];
    const dropped = this.capture.carried[me];
    if (dropped > 0) {
      // Ugyanaz a hívás, mint a találatnál: a szabály egy helyen él.
      this.capture.hit(me, body.position, body.position.clone().add(new THREE.Vector3(0, 0, 1)));
    }
    body.position.copy(corner.position);
    body.mesh.position.copy(corner.position);
    body.velocity.set(0, 0, 0);
    body.stun = DELIVERY.respawnStun;
    sound.thud(0.4);
    this.game.banner = dropped > 0 ? `ÚJRAÉLEDÉS — ${dropped} cukorka ottmaradt` : 'ÚJRAÉLEDÉS';
  }

  /**
   * Akikre lőni lehet: a MÁSIK játékos, soha nem én.
   *
   * A lakó szándékosan nincs köztük. Egy lelőhető lakó azt jelentené, hogy a
   * lopakodásnak nincs tétje — a ház egy lövéssel megoldható lenne, és a
   * három ház mindegyike ugyanarra a mozdulatra menne.
   */
  private targets(): Target[] {
    const out: Target[] = [];
    this.players.forEach((p, i) => {
      if (i === this.localIndex) return;
      out.push({ id: String(i), position: p.position, radius: MOVE.radius });
    });
    return out;
  }

  private syncWallHeight(): void {
    this.world.setWallHeight(
      VillageHouse.wallHeightFor(stage.pitch, CAMERA.houseMinDistance)
    );
  }

  /**
   * A lakó teste.
   *
   * Ő sincs cel-shadelve, ugyanabból az okból, amiért a szörnyek sem: a
   * szobával közös toon-rámpa mindhármat ugyanolyan műanyaggá lapítja, és a
   * lakónál ez külön drága lenne — ő az, akit a játékos a szeme sarkából
   * próbál beazonosítani egy sötét folyosón. A körvonal viszont marad, sőt
   * VASTAGABB a szörnyekénél: ha egyvalamit észre kell venned a képen, az ő.
   */
  /**
   * EGY SZÖRNY KINÉZETE.
   *
   * A modellek a játékosokéi — vérfarkas, zombi, vámpír —, de SÖTÉTRE
   * festve, izzó szemmel. Két oka van, és egyik sem a spórolás:
   *
   * Egy vaksötét házban úgyis csak a sziluettet látod, tehát a részletes
   * modell úgyis elveszik; ami számít, az a FORMA, és azt ezek tudják.
   *
   * A másik meg az, hogy a szörny, ami rád hasonlít, ijesztőbb annál, ami
   * nem. Ugyanaz a fajta vagy, mint ő — csak ő már régebben van itt.
   */
  private async dressLurker(
    who: Homeowner,
    model: string,
    fajta: 'vak' | 'leso' | 'koveto'
  ): Promise<void> {
    try {
      // EMBERMÉRETŰ SZÖRNY: két méter. A lakó 6,4 egység magas, mert ő egy
      // óriás a szörnyecskék világában — itt viszont te vagy ember, és ami
      // elindul feléd a sötétben, az akkora, mint te. Egy kicsit magasabb:
      // annyival, amennyitől rossz ránézni.
      const art = await models.instance(model, { height: 2.1 });
      if (this.disposed) return;
      // A MOZGÁS. A modell magával hozza a járásciklusát — ugyanaz a rig,
      // mint a lakóé, csak egyetlen klippel: ezek a lények nem ácsorognak
      // és nem tétováznak, csak jönnek.
      // A SAJÁT JÁRÁS ÉS A KÖZÖS KÉSZLET EGYÜTT.
      //
      // A modell egyetlen klipet hoz magával, a járását — azt megtartjuk,
      // mert az a SAJÁT teste (a Követő cammogása nem a lakóé). Minden
      // mást a közös csomagból veszünk: állás, futás, lopakodás. A két
      // csontváz huszonhét csontban azonos, tehát a klipek ráülnek.
      // A KLIPEK FORRÁSA A FAJTÁTÓL FÜGG.
      //
      // A Vak a lakó közös csomagjából mozog (a saját fájljában csak egy
      // járás van). A Követő és a Leső viszont az ÚJ szörny csomagját
      // használja: a Követő hozta magával (öt klip), a Leső pedig ugyanazt
      // a csontvázat kapta a `rig-transfer.py`-tól, tehát ráülnek.
      // A Leső és a Követő is a SAJÁT fájljából mozog (mindkettő négy-öt
      // klippel érkezett); csak a Vaknak kell a lakó közös csomagja, mert
      // az ő fájljában egyetlen járás van.
      // MINDHÁRMAN A LAKÓ KÖZÖS CSOMAGJÁBÓL MOZOGNAK.
      //
      // Az új modellek saját klipekkel érkeztek, és ez elvileg jobb volt —
      // csak épp azokat a testeket a motor egyszerűen nem rajzolta ki
      // (rajta voltak a rajzolási listán, a képernyő közepére estek, és
      // mégsem látszottak). Amíg ennek nem járok a végére, az számít, hogy
      // a szörnyek LÁTSZANAK.
      const kozosFajl = 'models/harold.clips.json';
      const [sajat, kozos] = await Promise.all([
        models.ownClips(model),
        kozosFajl ? models.clips(kozosFajl) : Promise.resolve([]),
      ]);
      if (this.disposed) return;
      // A SAJÁT KLIP HÁTUL VAN, ÉS EZ SZÁNDÉKOS.
      //
      // A rig egy névből → klip térképet épít, és abban a KÉSŐBBI nyer.
      // Mindkét csomagban van „Walking", és a szörnyé a jobb: az az ő
      // testére készült. Ezért a közös csomag megy elöl, a sajátja hátul.
      const clips = [...kozos, ...sajat];
      art.traverse((o) => {
        o.userData.cpNoOutline = true;
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // A KÉPKIVÁGÁST KIKAPCSOLJUK EZEKEN A TESTEKEN.
        //
        // A motor egy befoglaló gömbből dönti el, kell-e rajzolni valamit —
        // csontozott hálónál viszont ezt a gömböt a KÖTÉSI PÓZBÓL számolja,
        // és nem tud arról, hogy az animáció merre viszi a testet. Ha a
        // gömb elcsúszik vagy túl kicsi, a szörny ott áll előtted, és mégis
        // kimarad a rajzolásból — pontosan az, amit játszva láttál:
        // „áll konkrétan előttem valami, de láthatatlan".
        //
        // Három testről van szó: a kivágás megtakarítása náluk semmi, a
        // kockázata viszont ez.
        mesh.frustumCulled = false;
        // A HORRORFESTÉS A CSÚCSOKBAN VAN, és eddig kidobtuk.
        //
        // A modellekre nem lehetett textúrát tenni (a nyers hálón se kép,
        // se UV nincs — mérve mindháromban), ezért a `bake-lurker.py`
        // CSÚCSSZÍNRE festette őket: hullaszürke, a mélyedésekben
        // sötétebb, foltokban piszkos. Mérve ott is van mindháromban a
        // COLOR_0.
        //
        // Csak épp ez a sor cserélte le az anyagot egy olyanra, ami nem
        // olvassa a csúcsszínt — a festés tehát végig ott volt a fájlban,
        // és soha nem látszott. Ettől lett a szörny egyenletes agyagszobor.
        // (Pontosan ugyanez a hiba volt a házon a toonify-jal.)
        const eredeti = mesh.material as THREE.MeshStandardMaterial;
        // VAN-E EGYÁLTALÁN CSÚCSSZÍN? Az új szörny TEXTÚRÁVAL érkezik, és
        // azon nincs festés — ha ilyenkor is csúcsszínt kérnénk, a shader
        // egy nem létező attribútumot olvasna.
        const vanFestes = !!mesh.geometry?.attributes?.color;
        const anyag = new THREE.MeshStandardMaterial({
          vertexColors: vanFestes,
          map: eredeti?.map ?? null,
          // A FESTÉS MOST MÁR MAGA HORDOZZA A SÖTÉTET.
          //
          // Amíg a csúcsszín egyetlen szürke volt (0,011–0,133), egy külön
          // szorzóval kellett lenyomni, hogy ne fehér szoborként álljon a
          // sötétben. A `paint-lurker.py` óta a festés CSONTSÚLY szerint
          // megy — a kabát sötét kékesszürke, a kéz, a lábfej és az arc
          // halvány —, és a tartománya 0,03–0,38. Ezt már nem kell
          // tompítani: ha tompítanánk, pont a különbség veszne el
          // kabát és bőr között, ami az egészet adja.
          color: 0xffffff,
          roughness: 1,
          metalness: 0,
          // ALIG ÉRZÉKELHETŐ SAJÁT DERENGÉS — hogy a TEST is ott legyen.
          //
          // „Hol a szörny?" — a képen két piros pont lebegett a sötétben,
          // test nélkül. Mérve a test ott volt, látszott is, csak éppen
          // koromsötét: a szemek fénytől FÜGGETLEN anyagból vannak (ez a
          // dolguk: a Lesőé árulja el, hogy ébren van), a test viszont a
          // lámpától függ, és a lámpa hatótávja tizenhat méter.
          //
          // Négy százalék derengés nem világít — annyit tesz, hogy a
          // sziluett elválik a fekete faltól. A szem így jelzés marad, nem
          // az EGYETLEN dolog, ami látszik.
          emissive: new THREE.Color(0x05060a),
          emissiveIntensity: 1,
        });
        // A PEREMFÉNY EGYELŐRE KINT VAN.
        //
        // Egy saját GLSL-betoldás emelte ki a test szélét, hogy a sziluett
        // elváljon a faltól. Ezután viszont a szörnyek egyáltalán nem
        // látszottak — rajta voltak a rajzolási listán, a képernyő közepére
        // estek, a csúcsaik a helyükön voltak, mégsem jelentek meg. Egy
        // shaderbe nyúló javítás a legvalószínűbb ok, amíg az ellenkezőjét
        // nem mérem. Előbb LÁTSZANAK, aztán szépek.
        mesh.material = anyag;
      });
      // A SZEM A JEL, amiből eldöntöd, mit csinálj.
      //
      // Az ÁRNYÉKNAK NINCS SZEME — rá nyugodtan ráfoghatod a lámpát, az
      // égeti. A LESŐ szeme viszont visszaveri a fényt, MIELŐTT elindulna:
      // ha két fénylő pontot látsz a sötétben, akkor a lámpa a rossz
      // válasz, és le kell kapcsolnod.
      //
      // Ez az egész mód legfontosabb fél másodperce, és szándékosan egy
      // pillanatnyi döntés: ugyanaz a mozdulat menti meg vagy öli meg a
      // kört, attól függően, mit látsz.
      for (const oldal of fajta === 'vak' ? [] : [-1, 1]) {
        const szem = new THREE.Mesh(
          // KISEBB SZEM. A 0,075-ös gömb egy két méteres testen pingponglabda
          // volt — játszva ez volt a „borzalmas" fele: nem fénylő szem,
          // hanem két fehér golyó az arc helyén.
          new THREE.SphereGeometry(0.042, 10, 10),
          // A LESŐ SZEME VILÁGOS ÉS FÉNYLŐ — ez az a jel, amiből tudod,
          // hogy nem szabad ráfognod a lámpát. A követőé tompa vörös:
          // rajta úgysem segít semmi.
          // A KÖVETŐ SZEME TOMPÁBB. Az élénk vörös messziről neonpontnak
          // látszott; a lényeg, hogy ott VAN, nem az, hogy világít.
          new THREE.MeshBasicMaterial({ color: fajta === 'leso' ? 0xffe89a : 0x5e120d })
        );
        szem.userData.cpNoOutline = true;
        szem.position.set(oldal * 0.085, 1.82, 0.2);
        art.add(szem);
      }
      // A `setArt` maga teszi be a csoportba, és el is takarítja a tokot —
      // ugyanaz az út, amin a lakó modellje is érkezik.
      const keszlet = fajta === 'vak' ? VAK_CLIPS : fajta === 'leso' ? LESO_CLIPS : KOVETO_CLIPS;
      const rig = new CharacterRig(art, clips, keszlet);
      // MÉRJÜK, HOGY TÉNYLEG RÁÜLT-E. A retargetelés némán is elmehet
      // mellé: ha a klip csontnevei nem találnak, a szörny mozdulatlan
      // marad, és ez ránézésre „nem mozog"-nak látszik, nem hibának.
      if (rig.bound.miss > rig.bound.hit) {
        console.warn(`a(z) ${fajta} mozgása nem ült rá a csontvázra`, rig.bound);
      }
      who.setArt(art, rig);
    } catch (e) {
      // Modell nélkül a tok marad — sötét kapszula a sötétben. Nem szép,
      // de attól még ott van, és attól még elkap.
      console.warn('a szörny modellje nem töltött be', e);
    }
  }

  private async loadHomeowner(): Promise<void> {
    try {
      const art = await models.instance('models/harold.json', { height: HOMEOWNER.height });
      if (this.disposed) return;
      const [own, pack] = await Promise.all([
        models.ownClips('models/harold.json'),
        models.clips('models/harold.clips.json'),
      ]);
      if (this.disposed) return;

      addOutlines(art, 1.1, 0x1a0a12, 0.3);
      applyEnvironment(art, studioEnvironment(this.renderer), 0.5);
      this.homeowner.setArt(art, new CharacterRig(art, [...own, ...pack], HOMEOWNER_CLIPS));
    } catch (e) {
      // A tok marad, és a játék megy tovább. A lakó a szabályokban él, nem a
      // modelljében — egy hiányzó fájl nem teheti végigjátszhatatlanná a házat.
      console.warn('a lakó modellje nem töltött be', e);
    }
  }

  /**
   * A kutya teste.
   *
   * Egyetlen klipet hozott — egy járást —, tehát a rig MINDEN állapotra azt
   * kapja, és a tempót a valódi haladás állítja. Ez nem szegényes: egy kutya
   * mozgásában tényleg csak a lépésfrekvencia változik, és a nem létező
   * „ül", „alszik" klipeket kitalálni rosszabb lenne, mint lassan lépkedni.
   */
  private async loadDog(): Promise<void> {
    if (!this.dog) return;
    try {
      const art = await models.instance('models/dog.json', { height: DOG.height });
      if (this.disposed || !this.dog) return;
      const own = await models.ownClips('models/dog.json');
      if (this.disposed || !this.dog) return;

      addOutlines(art, 1.0, 0x1a0a12, 0.3);
      applyEnvironment(art, studioEnvironment(this.renderer), 0.5);
      const only = own[0]?.name;
      this.dog.setArt(
        art,
        new CharacterRig(art, own, only ? { idle: only, walk: only, run: only, grab: only } : {})
      );
    } catch (e) {
      console.warn('a kutya modellje nem töltött be', e);
    }
  }

  private async loadCharacters(toon: { floor: number }): Promise<void> {
    for (const player of this.players) {
      if (this.disposed) return;
      const def = CHARACTERS[this.session.selection.characters[player.index]];
      const art = await models.instance(def.model, { height: def.height, yaw: def.yaw });
      // Awaited twice below; the section can end in between.
      if (this.disposed) return;

      // Characters keep their authored PBR materials rather than being
      // cel-shaded with the world. Two reasons: the sculpts carry their charm
      // in soft shading — fur, velvet, skin — and a toon ramp flattens all
      // three into the same plastic; and the emissive fill that keeps the
      // greybox readable was lifting the vampire's black suit to grey.
      // Cel-shaded world plus soft-shaded characters is a deliberate contrast,
      // and it makes the players pop out of a dark room.
      addOutlines(art, 0.9);
      this.lightCharacter(art);
      // Low intensity: enough for velvet and fur to pick up a soft wrap, not
      // enough to daylight a character standing in a dark kitchen.
      applyEnvironment(art, studioEnvironment(this.renderer), 0.55);

      let rig: Rig;
      if (def.motion === 'skeletal') {
        // Every rigged character sits on the same skeleton, so one clip pack
        // animates all of them — a new character costs a mesh, not a library.
        const [own, shared] = await Promise.all([
          models.ownClips(def.model),
          def.clips ? models.clips(def.clips) : Promise.resolve([]),
        ]);
        if (this.disposed) return;
        rig = new CharacterRig(art, [...own, ...shared]);
      } else {
        rig = new ProceduralRig(art, def.motion);
      }
      player.setArt(art, rig);
    }
  }

  /**
   * A key light that travels with one character.
   *
   * The room is deliberately near-black so the homeowner's torch is the
   * brightest thing in it — which leaves the players as silhouettes. A short
   * range light on each of them restores their form without lighting the room
   * or competing with the torch.
   */
  private lightCharacter(art: THREE.Object3D): void {
    // A KÍSÉRTETHÁZBAN A SZEREPLŐKNEK NINCS SAJÁT FÉNYÜK.
    //
    // Máshol ez a három kis fény menti meg a képet: nélkülük a szörnyed
    // sziluett a sötétben. Itt viszont PONT az a cél — és az ára is
    // mérhető. Minden fény MINDEN képpontra számol: nyolc égő fénnyel a
    // rajzolás 8 ezredmásodperc egy negyed képernyőn, teljes méretben
    // ennek a többszöröse. Ettől akadozott.
    //
    // Egy egyszeri „oltsunk el mindent" nem volt elég, mert a szereplők
    // modellje KÉSŐBB érkezik, és magával hozza a saját fényeit. A forrásnál
    // kell elvágni, ne utólag takarítani.
    if (this.session.haunt) return;
    // A three-point rig, scaled to one character. Key from the front, cool
    // fill opposite so the shadow side keeps its form, and a rim behind to
    // separate a dark costume from a dark floor.
    // The numbers are candelas, and the scene they have to hold their own in
    // is loud: the fridge is 180, the doorway 230, and the homeowner's torch
    // is 900. A 16-candela key put the players nearly two orders of magnitude
    // below every other light in the room, which is why they came out as
    // silhouettes — it was never the tone mapping, it was the rig being
    // quieter than the set dressing.
    //
    // CHARACTER_KEY sits in the same league as the room's own accents and
    // still an order of magnitude under the torch, so the constraint holds:
    // the flashlight is unambiguously the brightest thing in the room. These
    // lights are parented to the character and range-limited, so they light
    // the person and not the kitchen.
    const key = new THREE.PointLight(0xfff2e0, CHARACTER_KEY, 9, 2);
    key.position.set(1.2, 2.6, 2.0);
    art.add(key);

    const fill = new THREE.PointLight(0xa9bfff, CHARACTER_KEY * 0.38, 8, 2);
    fill.position.set(-1.6, 1.4, 1.2);
    art.add(fill);

    const rim = new THREE.PointLight(0xffc98a, CHARACTER_KEY * 0.46, 7, 2);
    rim.position.set(-0.6, 2.2, -1.8);
    art.add(rim);

    // A SÖTÉT HÁZBAN kapsz egy sajátot is.
    //
    // A fenti három a szörnyet világítja meg, nem a szobát — sötétben attól
    // még vakon állsz egy fekete képernyőn. Ez a kör akkora, hogy a következő
    // két lépésedet lásd, és nem nagyobb: ha bevilágítaná a szobát, a sötét
    // pálya csak egy sötétebb tapéta lenne.
    //
    // És kétélű: a te köröd a lakónak is látszik. Sötétben nem az a kérdés,
    // látsz-e, hanem hogy megéri-e látni.
    if (this.dark) {
      const lantern = new THREE.PointLight(0xffc27a, this.session.haunt ? 0 : 300, 22, 2);
      lantern.position.set(0, 2.4, 0);
      art.add(lantern);
    }
  }

  /**
   * A MÁSODIK ház vaksötét.
   *
   * A folyosós ház egyetlen hosszú látóvonalra épül — ott a rálátás a
   * veszély. Sötétben ez megfordul: a látóvonal a te fegyvered lesz (messziről
   * meglátod a lakó zseblámpáját), a saját helyzeted viszont elárul, mert a
   * te fényed is látszik. Ugyanaz az alaprajz, ellentétes játék.
   *
   * Nem „kevesebb fény": a szoba fénye NULLA, és csak három dolog világít —
   * a lakó lámpája, a te kis köröd, és a cukorka. Ettől lesz a tájékozódás
   * maga a feladat.
   */
  private get dark(): boolean {
    // A BETÖLTÖTT ház számít, nem a sorrend.
    //
    // Eddig a látogatások számából következtetett rá — ami a `?haz=2`
    // hibakeresővel azonnal hazudott: a második házat töltöttük be, és a
    // jelenet mégis világosnak hitte magát. Egy származtatott érték, ami
    // nem a TÉNYT kérdezi, előbb-utóbb elcsúszik attól.
    // A KÍSÉRTETHÁZ MINDIG sötét, bármelyik házban játsszuk. Ott a sötét
    // nem a ház tulajdonsága, hanem a módé.
    return this.houseName === 'house2' || this.session.haunt;
  }

  /** Melyik ház van betöltve. A sötétség és a kutya is ebből következik. */
  private houseName = 'house1';
  /** A közös sorsoló: kétfős fogóban mindkét gépen ugyanaz a sorozat. */
  private sors: () => number = Math.random;

  /**
   * A ház nevétől függő beállítások, MIUTÁN kiderült, melyik ház ez.
   *
   * A konstruktor még nem tudja (a nevet a betöltő adja), a `dark` viszont
   * innentől igaz — tehát a sötétséghez kötött dolgokat itt kell elővenni.
   */
  private applyHouseName(): void {
    // Éjjellátó sincs a kísértetházban: ott a lámpa AZ erőforrás, és egy
    // húsz másodperces ingyen látás pont azt a döntést venné el.
    if (!this.dark || this.goggles || this.session.haunt) return;
    // Helykitöltő doboz, amíg a modell betölt: a játék nem várhat egy
    // letöltésre, és egy hiányzó tárgy rosszabb, mint egy ideiglenes.
    const shell = new THREE.Group();
    const box = new THREE.Mesh(
      new THREE.BoxGeometry(1.1, 0.6, 0.45),
      new THREE.MeshBasicMaterial({ color: 0x6effc0 })
    );
    shell.add(box);
    shell.userData.cpNoOutline = true;
    this.goggles = shell;
    this.scene.add(shell);
    this.scene.add(this.nightLight);
    this.placeGoggles();

    void models
      .instance('models/goggles.json', { length: 1.1 })
      .then((art) => {
        if (this.disposed || !this.goggles) return;
        art.traverse((o) => {
          o.userData.cpNoOutline = true;
          const mesh = o as THREE.Mesh;
          if (!mesh.isMesh) return;
          // Saját fényű, mint minden felszedhető: a vaksötét házban egy
          // megvilágításra szoruló tárgy egyszerűen nincs.
          const from = mesh.material as THREE.MeshStandardMaterial;
          mesh.material = new THREE.MeshBasicMaterial({
            map: from.map ?? null,
            color: from.color?.clone() ?? new THREE.Color(0xffffff),
          });
        });
        shell.clear();
        shell.add(art);
      })
      .catch(() => {});
  }

  private addLighting(): void {
    // Deliberately underlit: the flashlight has to be the brightest thing in
    // the room, because the flashlight is the AI's state made visible.
    // Sötétben a köd KÖZEL kezdődik: ez az, ami a „nem látok a szoba végéig"
    // érzést adja, és nem mellesleg a rálátást is elveszi a lakótól.
    this.scene.fog = this.dark
      ? new THREE.Fog(0x020106, 5, 30)
      : new THREE.Fog(0x0a0718, 45, 130);
    // Nem teljes nulla: egy vak fekete képernyőn a falak sem látszanak, és
    // akkor nem lopakodsz, hanem tapogatózol. Ennyi pont a körvonalakra elég.
    this.scene.add(
      this.dark
        ? new THREE.HemisphereLight(0x201c3c, 0x020106, 0.05)
        : new THREE.HemisphereLight(0x5d4ea4, 0x151029, 1.25)
    );

    const windowMoon = new THREE.DirectionalLight(0x9fb6ff, this.dark ? 0.02 : 0.85);
    windowMoon.position.set(20, 35, 30);
    windowMoon.castShadow = true;
    windowMoon.shadow.mapSize.set(2048, 2048);
    // Same defect the drive section had: a 90 m shadow box on a 2048 map is
    // 4.4 cm of depth quantisation per texel, with no bias to absorb it. It
    // shimmers less in here only because the camera moves less — it is still
    // acne. A tighter box and a real normalBias, as outside.
    const s = 38;
    windowMoon.shadow.camera.left = -s;
    windowMoon.shadow.camera.right = s;
    windowMoon.shadow.camera.top = s;
    windowMoon.shadow.camera.bottom = -s;
    windowMoon.shadow.camera.near = 1;
    windowMoon.shadow.camera.far = 130;
    windowMoon.shadow.bias = -0.0003;
    windowMoon.shadow.normalBias = 0.06;
    this.scene.add(windowMoon);

    // A hűtő és az ajtónyílás sötétben ELŐNY, nem díszlet: ez a két fix pont
    // az, amiből meg tudod mondani, hol vagy. Ezért nem oltjuk el őket, csak
    // lejjebb vesszük — messziről sejtés, közelről tájékozódási pont.
    const fridge = new THREE.PointLight(0x7ee8ff, this.dark ? 28 : 180, this.dark ? 26 : 60, 2);
    fridge.position.set(-15, 8, -22);
    this.scene.add(fridge);
    const doorway = new THREE.PointLight(0xffab52, this.dark ? 38 : 230, this.dark ? 30 : 65, 2);
    doorway.position.set(0, 9, 33);
    this.scene.add(doorway);
  }

  update(step: number, elapsed: number): void {
    // A falak magassága a kameraszöget követi, a szög pedig most már MENET
    // KÖZBEN változik a nyilakkal — tehát ez sem állhat be egyszer az
    // induláskor. Olcsó: egy vágósík konstansa.
    this.syncWallHeight();

    // CSAK a saját szörnyem megy gombról. A társamé a szobából érkezik, és
    // egy helyben futtatott szimuláció felül is írná, amit kaptunk.
    this.players[this.localIndex].update(
      step,
      this.input.get(this.localIndex),
      this.collidersFor[this.localIndex]
    );

    // A SARKOKBA ÁLLÍTÁS AZ ELSŐ KÉPKOCKÁN MEGISMÉTLŐDIK.
    //
    // A jelenet felépítésekor is megtörténik, de mérve mégsem oda kerültek a
    // testek: valami a betöltés és az első kép között elmozdította őket
    // (15,6 egységgel). Nem kerestem tovább, hogy MI — az első képkockán
    // újra odatenni olcsóbb és biztosabb, mint kitalálni, melyik késleltetett
    // betöltő nyúlt hozzá. A szabály így akkor is áll, ha a sorrend
    // megváltozik.
    if (this.capture && this.corners && !this.spawnPlaced) {
      this.spawnPlaced = true;
      for (const corner of this.corners.list) {
        this.players[corner.player].position.copy(corner.position);
        this.players[corner.player].mesh.position.copy(corner.position);
        this.players[corner.player].velocity.set(0, 0, 0);
      }
      this.rival?.position.copy(
        this.corners.list.find((c) => c.player === this.rival!.index)?.position ??
          this.players[this.rival.index].position
      );
    }

    this.updateHaunt(step);
    this.capture?.update(step);
    this.refillBowls(step);
    this.updateNightVision(step);

    // A FÖLDÖN HEVERŐ CUKORKA FELSZEDÉSE.
    //
    // A szabály eddig is megvolt, de CSAK AZ AI hívta: a játékos ráállt a
    // földre esett darabra, és nem történt semmi. Egy zsákmány, amit nem
    // lehet felvenni, nem zsákmány — és a lövésnek sem marad következménye.
    if (this.capture) {
      const got = this.capture.pickUpLoose(
        this.localIndex as 0 | 1,
        this.players[this.localIndex].position
      );
      if (got > 0) {
        sound.pickup();
        this.game.banner = `FELSZEDTED — ${this.capture.carried[this.localIndex as 0 | 1]} a kezedben`;
      }
    }

    // ÚJRAÉLEDÉS: a sarokba szorítva is legyen kiút, de legyen ára.
    if (this.capture && this.input.consumeRespawn()) this.respawn();

    // AZ AI ELLENFÉL. A gondolkodás az övé, a TEST a közös szabályozó: a
    // helyét átmásoljuk, hogy a lakó, a kutya és a falak ugyanúgy hassanak rá,
    // mint rád. Egy külön testű AI-nak külön ütközést és külön látást kellene
    // írni — és a kettő előbb-utóbb elcsúszna egymástól.
    if (this.rival && this.rivalBody && this.amHost) {
      const enemy = {
        id: String(this.localIndex),
        position: this.players[this.localIndex].position,
        radius: MOVE.radius,
      };
      const fired = this.rival.update(step, this.capture!, enemy);

      // KI VEZET KIT: alaphelyzetben az AI mozgatja a testét, DE amíg
      // ellökték, fordítva — a FIZIKA viszi, és az AI onnan veszi át a
      // helyét.
      //
      // Enélkül a lövésnek nem volt látható következménye: a test elrepült,
      // és a következő képkockán az AI visszarántotta oda, ahol a
      // gondolkodása szerint állnia kellett. A cukorka kiesett, csak épp
      // senki nem látta, hogy bármi történt.
      // A TEST FIZIKÁJÁT futtatni kell, különben a lökés csak egy sebesség
      // marad, amit soha senki nem integrál: a szám ott áll a testben, és a
      // szörny meg sem mozdul. (Pontosan ez történt: „arrébb se repült".)
      this.rivalBody.update(step, HouseScene.IDLE, this.collidersFor[this.rival.index]);

      const knocked = this.capture!.knocked[this.rival.index] > 0 || this.rivalBody.stun > 0;
      if (knocked) {
        this.rival.position.copy(this.rivalBody.position);
      } else {
        // A TEST ARRA NÉZZEN, AMERRE MEGY. Enélkül a szörny oldalazva
        // csúszkált: a helye változott, az iránya nem — és ettől lett az
        // egész mozgás „gyökér".
        const step2 = this.rival.position.clone().sub(this.rivalBody.position);
        step2.y = 0;
        if (step2.lengthSq() > 1e-4) {
          const want = Math.atan2(step2.x, step2.z);
          const mesh = this.rivalBody.mesh;
          let delta = want - mesh.rotation.y;
          while (delta > Math.PI) delta -= Math.PI * 2;
          while (delta < -Math.PI) delta += Math.PI * 2;
          // Simítva fordul, nem pattan: egy képkocka alatti fordulás
          // ugyanolyan zavaró, mint a csúszás.
          mesh.rotation.y += delta * Math.min(1, step * 10);
        }
        this.rivalBody.position.copy(this.rival.position);
        this.rivalBody.mesh.position.copy(this.rival.position);
      }
      if (fired?.shot) {
        this.noise.emit(fired.shot.noiseAt, this.rival.weapon!.gun.noiseRadius, 'lövés');
        // Az ELLENFÉL lövése is szól: ebből tudod meg, hogy fegyvere van, és
        // hogy nagyjából merről. Egy néma ellenség nem ellenfél, hanem csapda.
        sound.gun(this.rival.weapon!.kind);
        // Az ELLENFÉL lövése is hagy nyomot: ebből látod, honnan lőttek rád.
        this.tracer.add(fired.shot.from, fired.shot.to, !!fired.shot.hit);
        this.impact.burst(
          this.rival.weapon!.kind,
          fired.shot.to,
          fired.shot.to.clone().sub(fired.shot.from).normalize()
        );
        if (fired.shot.hit) {
          this.takeHit(
            this.localIndex as 0 | 1,
            fired.shot.from,
            fired.shot.strength,
            this.rival.weapon!.gun.knockback
          );
        }
      }
    }

    this.armoury?.update(step);
    // TÁVCSŐ: a jobb egérgomb (vagy a Shift) nagyít. Csak a mesterlövészen —
    // a sörétesre távcsövet tenni annyi volna, mint kalapácsra.
    // ÚJRATÖLTÉS HANGJA: egy kattanás, amikor elindul, egy, amikor kész. A
    // második az, ami számít — abból tudod, hogy megint lőhetsz, anélkül hogy
    // a számlálóra néznél.
    if (this.held) {
      const loading = this.held.reloading > 0;
      if (loading !== this.wasReloading) {
        // Töltés INDUL: fémes csattanás (a tár helyére kerül).
        // Töltés KÉSZ: a zár csattanása — ebből tudod, hogy megint lőhetsz,
        // anélkül hogy a számlálóra néznél.
        sound.clip(loading ? 'reload-start' : 'reload-done', 0.75);
        this.wasReloading = loading;
      }
    }

    if (this.held) {
      this.held.scoped = this.held.canScope && this.input.scoping;
      // A nagyítás a kamerán történik: a látószög szűkül, tehát ugyanaz a
      // képernyő kevesebb világot mutat — ettől lesz „közelebb" a célpont.
      this.director.fpFov = this.held.scoped ? this.held.gun.scopeFov : 0;
    } else {
      this.director.fpFov = 0;
    }
    this.held?.update(step, this.players[this.localIndex].moving);

    // FELVÉTEL RÁÁLLÁSRA, nem gombra.
    //
    // Először az E-re kötöttem, és a mérés megbuktatta: a gomb ÉLE elveszik,
    // ha abban a képkockában nem futott szimulációs lépés — a szabály
    // közvetlenül hívva működött, a játékban mégsem történt semmi. Ráállásra
    // viszont nincs mit elveszíteni.
    //
    // A véletlen csere sem drága: a régi fegyver a lábunk elé esik, tehát egy
    // lépés hátra visszaadja. Egy megbocsátó szabály jobb, mint egy pontos,
    // amit nem lehet eltalálni.
    const me = this.players[this.localIndex];
    if (this.armoury) {
      const got = this.armoury.tryPickUp(me.position, this.held, this.localIndex);
      if (got) {
        if (got.swapped || !this.held) {
          this.held = Armoury.make(got.kind, got.ammo);
          void this.heldView.show(got.kind);
        }
        this.game.banner = got.swapped
          ? `${GUNS[got.kind].name} — a régi a földön`
          : `${GUNS[got.kind].name} · +${got.ammo} lőszer`;
        // A FELVÉTEL HANGJA egy töltés: a fegyver a kézbe kerül és
        // felhúzódik. Egy cukorka-csilingelés itt azt mondaná, hogy jutalom
        // — pedig eszköz.
        sound.clip('reload-done', 0.8);
      }
    }

    // LÖVÉS.
    if (this.input.consumeFire() && this.held) {
      const shot = this.held.fire(
        this.heldView.muzzle.clone(),
        stage.yaw,
        this.targets(),
        (a, b) => this.world.sightBlocked(a, b)
      );
      // ÜRES TÁR: a lövés elmarad, és eddig ilyenkor SEMMI nem történt — a
      // gomb néma volt, amiből nem derült ki, hogy a fegyver üres-e vagy a
      // gomb rossz. Egy száraz kattanás megmondja.
      if (!shot && this.held.ammo <= 0) sound.clip('empty', 0.5);
      if (shot) {
        this.heldView.fired();
        // A CSÍK a csővégtől a becsapódásig. A színe mondja meg, hogy
        // találtál-e — ez gyorsabb, mint bármilyen felirat.
        this.tracer.add(shot.from, shot.to, !!shot.hit);
        // A SÖRÉTES sok apró szemet lő: több vékony csík egy kúpban, nem egy
        // vonal. A fegyver jellegét a KÉP mondja el, nem a leírás.
        if (this.held.kind === 'shotgun') {
          for (let i = 0; i < 5; i++) {
            const spread = this.held.gun.spread * 0.8;
            const off = new THREE.Vector3(
              (Math.random() - 0.5) * spread * shot.to.distanceTo(shot.from),
              (Math.random() - 0.5) * spread * 4,
              (Math.random() - 0.5) * spread * shot.to.distanceTo(shot.from)
            );
            this.tracer.add(shot.from, shot.to.clone().add(off), !!shot.hit);
          }
        }
        this.impact.burst(
          this.held.kind,
          shot.to,
          shot.to.clone().sub(shot.from).normalize()
        );
        // A TALÁLAT KÖVETKEZMÉNYE: ellökés és minden cukorka a földre. Eddig
        // a lövés elsült és zajt csapott, de a célpontnak nem történt semmi —
        // egy fegyver, aminek nincs hatása, csak egy hangeffekt.
        if (shot.hit) {
          const kit = Number(shot.hit.id) as 0 | 1;
          // KÉTFŐS FOGÓ: a TALÁLATOT A LÖVŐ DÖNTI EL.
          //
          // Kézenfekvő volna a célpont gépére bízni („te mondd meg, hogy
          // eltaláltak-e"), de az rossz: a lövésedet a SAJÁT gépeden látod
          // elsülni, ott van a csövd és ott van a képed — és ha a döntés
          // átmenne a másik gépre, a találat fél másodperccel a lövés után
          // jönne meg. Azon a fél másodpercen a játék áll vagy bukik.
          //
          // Az ára, hogy a lövőnek elhisszük a találatot. Két barát között
          // ez nem kockázat, és a nyeresége — hogy a fegyver ott sül el,
          // ahol meghúzod — mindennél többet ér.
          if (this.partnered && kit !== this.localIndex) {
            this.link.sendHit(shot.from, shot.strength, this.held.gun.knockback);
            this.game.banner = 'TALÁLAT';
            sound.clip('hit', 0.6);
          } else {
            this.takeHit(kit, shot.from, shot.strength, this.held.gun.knockback);
          }
        }
        // A társ gépén is legyen csík és becsapódás: enélkül ott csak annyi
        // történne, hogy hirtelen elrepül — anélkül, hogy látná, honnan.
        if (this.partnered) {
          this.link.sendShot(shot.from, shot.to, this.held.kind, !!shot.hit);
        }
        // A lövés ZAJ is: a fegyver hangja odahívja a lakót. Ez a fegyver
        // harmadik ára, a lőszer és az idő mellett.
        this.noise.emit(shot.noiseAt, this.held.gun.noiseRadius, 'lövés');
        sound.gun(this.held.kind);
      }
    }

    // FOGÓ: a sajátomról mondok igazat — mi van a kezemben, mennyi van
    // bevive, és mivel lövök. A társ HUD-ja ebből tudja az állást.
    if (this.capture) {
      this.link.fogo = {
        carried: this.capture.carried[this.localIndex],
        banked: this.capture.banked[this.localIndex],
        weapon: this.held?.kind ?? '',
        ammo: this.held?.ammo ?? 0,
      };
    }

    this.link.apply(this.peers(), this.players, this.homeowner, this.world, this.game);

    if (this.partnered && this.capture) {
      // A TÁRS ÁLLÁSA: az ő gépe mondja meg, mert az övé.
      const other = (1 - this.localIndex) as 0 | 1;
      this.capture.carried[other] = this.link.remoteFogo.carried;
      this.capture.banked[other] = this.link.remoteFogo.banked;

      // ELTALÁLTAK. A társ gépe döntötte el, itt csak elszenvedjük — és
      // pontosan úgy, ahogy az AI lövésénél: ellökés és a cukorka a földre.
      const hit = this.link.takeHit();
      if (hit) this.takeHit(this.localIndex, hit.from, hit.strength, hit.knockback);

      // A TÁRS LÖVÉSE: csík és becsapódás. Csak látvány — a következményt
      // már a fenti találat elintézte.
      const shot = this.link.takeShot();
      if (shot) {
        this.tracer.add(shot.from, shot.to, shot.hit);
        this.impact.burst(
          shot.kind as 'shotgun' | 'sniper' | 'rocket',
          shot.to,
          shot.to.clone().sub(shot.from).normalize()
        );
        sound.gun(shot.kind as 'shotgun' | 'sniper' | 'rocket');
      }
    }

    this.world.update(step, elapsed);

    // A szabályok és a lakó CSAK a gazda gépén futnak. A vendég a kapott
    // állapotot rajzolja — különben két zseblámpa nézne két irányba.
    if (this.amHost) {
      this.game.update(step, this.players, this.link.source(this.input));
      this.homeowner.update(step, this.cast(), this.noise);
      // A kutya a lakó UTÁN fut: így az ugatása még ebben a képkockában
      // benne van a zajlistában, amikor a lakó a következőben belehallgat.
      this.dog?.update(step, this.noise, this.cast().map((p) => p.position));
    }
    // A visszhang a zaj ELÉVÜLÉSE ELŐTT fut: az események 0,35 mp-ig élnek,
    // és ha a takarítás előbb menne, a friss zajokat sosem látnánk meg.
    this.echo?.update(step, this.noise);
    this.noise.update(step);

    this.link.publish(
      this.players,
      this.input.get(this.localIndex),
      this.homeowner,
      this.world,
      this.game,
      {
        name: this.session.selection.names[this.localIndex],
        character: this.session.selection.characters[this.localIndex],
      }
    );

    if (this.game.stats.escaped) {
      // A beat on the way out, so "KIJUTOTTATOK" is readable before the cut.
      this.exitGrace += step;
      if (this.exitGrace > 1.6) this.finished = true;
    }
  }

  /** Akik tényleg ott vannak — a lakó csak ezeket keresheti. */
  /**
   * Eltalálták: ellökés, és ami a kezében volt, a földre esik.
   *
   * Egy helyen, mert két lövő van (te és az AI), és két helyen írva a két
   * találat előbb-utóbb másképp viselkedne.
   */
  private takeHit(who: 0 | 1, from: THREE.Vector3, strength = 1, force: number = CAPTURE.knockback): void {
    if (!this.capture) return;
    const body = this.players[who];
    const { push } = this.capture.hit(who, body.position, from, strength);
    // A LÖKÉS ereje a FEGYVERÉ, nem egy közös szám: a rakéta messzire dob, a
    // sörétes közelről nagyot lök, a mesterlövész egyáltalán nem — az ő
    // fegyvere a helyben tartás. Nulla erőnél nincs repülés, csak bénulás.
    if (force > 0) {
      body.launch(push.clone().normalize(), force * Math.max(0.35, strength) * 1.6);
    }
    // A TALÁLAT hangja felvétel, nem szintetizált puffanás: egy testet érő
    // ütést két szinusszal nem lehet utánozni.
    sound.clip('hit', 0.9);
    this.game.banner = who === this.localIndex ? 'ELTALÁLTAK!' : 'TALÁLAT';
  }

  /**
   * A KÍSÉRTETHÁZ EGY LÉPÉSE.
   *
   * Négy dolog történik, és a sorrendjük számít: előbb a szörnyek lépnek
   * (mert az ő helyzetük dönti el, elkaptak-e), aztán az elkapás, aztán a
   * mentés, végül a fény. A fény azért utolsó, mert AZT MÁR a mostani
   * helyzetnek kell megvilágítania, nem az előzőnek — különben a lámpa egy
   * képkockával a fejed mozgása mögött jár, és az szédít.
   */
  private updateHaunt(step: number): void {
    const haunt = this.haunt;
    if (!haunt) return;
    // A NÉZET A SZEMBŐL VAN, amíg a játékos mást nem kér.
    if (this.belsotAkar && this.director.firstPerson === null) this.toggleFirstPerson();

    const me = this.localIndex as 0 | 1;
    const testem = this.players[me];
    // A NÉZÉS IRÁNYA egyetlen helyen dől el, és mindenki ezt használja: a
    // lámpa kúpja, az égetés szöge, és az is, hogy merre szalad át valami.
    // Ha ezek külön számolnák, előbb-utóbb elcsúsznának — és a játékos azt
    // látná, hogy ráfogja a fényt valamire, mégsem történik semmi.
    // MINDIG A KAMERA, KÜLSŐ NÉZETBEN IS.
    //
    // Eddig csak belső nézetben követte a kamerát; kívülről a szörny
    // FORGÁSÁT használta, az pedig a haladási irányból jön. Így oldalazva
    // oldalra világított, hátrálva hátra, megállva pedig ott maradt, ahol
    // utoljára léptél — miközben a kamera (és te) máshová néztél. Egy
    // kézben tartott lámpa a TEKINTETET követi, nem a lábat, és ez külső
    // nézetben ugyanúgy igaz.
    const nezesIrany = stage.yaw;
    this.jumpscare?.update(step);

    // AZ ELIGAZÍTÁS. Bármelyik gomb elteszi; a H bármikor visszahozza. Amíg
    // látszik, a ház áll — nem tisztességes menet közben olvastatni.
    if (this.hauntBrief?.open) {
      const b = this.input.get(me);
      if (b.moveX || b.moveY || b.jump || b.interact || b.sprint) this.hauntBrief.toggle(false);
      return;
    }

    if (haunt.state === 'vege') {
      this.game.banner = haunt.escaped
        ? haunt.candy >= HAUNT.quota
          ? `KIJUTOTTATOK — ${haunt.candy} CUKORKÁVAL`
          : `KIJUTOTTATOK, DE CSAK ${haunt.candy} CUKORKÁVAL`
        : 'ELKAPTAK. A CUKORKA ODAVAN.';
      // Egy pillanat, hogy a felirat olvasható legyen, aztán vége a körnek.
      this.exitGrace += step;
      if (this.exitGrace > 2.2) {
        this.game.stats.candy = haunt.candy;
        this.game.stats.escaped = haunt.escaped;
        this.finished = true;
      }
      return;
    }

    // A SZÖRNYEK. Csak azokat látják, akik ÁLLNAK: aki lent van, az már
    // nem célpont — különben a földön fekve a végtelenségig ütnének, és a
    // mentés esélytelen volna.
    // A SZEKRÉNYBEN LÉVŐT NEM LÁTJÁK. Nem külön szabály a szörnyeknek:
    // egyszerűen nincs rajta a célpontlistán, ahogy a földön fekvő sem.
    const talpon = this.players.filter(
      (_, i) => !haunt.down[i as 0 | 1].down && !(i === me && haunt.hidden)
    );
    const lampasnal = this.players[haunt.torchHolder];
    const eg = haunt.torchOn && !haunt.down[haunt.torchHolder].down;
    let eget = false;

    // SZEMLE MÓD (?szemle): a szörnyek egy sorban eléd állnak, mozdulatlanul,
    // és nem bántanak.
    //
    // Nem játékmód, hanem MÉRŐESZKÖZ. Egy vaksötét házban, ahol a szörnyek
    // kiszámíthatatlanul mozognak, órákba telt eldönteni, hogy egy alak
    // „nem látszik" vagy „nincs ott" — és a legtöbb kísérletem azon bukott
    // el, hogy a szörnyet egy falba tettem. Itt kiszámolt, szabad helyre
    // állnak, szemben veled: ha nem látod őket, az a rajzolás hibája.
    if (this.szemle) {
      if (!this.szemleHelyek.length) this.szemletHelyez(testem.position);
      for (let i = 0; i < this.lurkers.length; i++) {
        const hely = this.szemleHelyek[i];
        if (!hely) continue;
        const szorny = this.lurkers[i];
        szorny.position.copy(hely);
        szorny.group.position.copy(hely);
        szorny.group.visible = true;
        szorny.group.lookAt(testem.position.x, 0, testem.position.z);
        szorny.state = 'IDLE';
        szorny.poseIdle(step);
        this.lurkerFled[i] = 0;
      }
      this.szemleJelek(step);
      this.game.banner = `SZEMLE — ${this.lurkers.length} szörny áll előtted`;
    }

    for (let i = 0; i < this.lurkers.length && !this.szemle; i++) {
      const szorny = this.lurkers[i];

      // ELIJESZTVE: távol van, és nem is számít. Enélkül a menekülés csak
      // egy pillanat volna, és a jutalom semmi.
      if (this.lurkerFled[i] > 0) {
        this.lurkerFled[i] -= step;
        if (this.lurkerFled[i] > 0) {
          // AKI VÁR, AZ NINCS ITT.
          //
          // Eddig csak kihagytuk a léptetését, és ettől ott ÁLLT a házban
          // mozdulatlanul — a Követő az első ötven másodpercben egy
          // szoborként bámult maga elé. Kívülről ez pontosan úgy néz ki,
          // hogy „a szörny nem mozog", és igaza is van annak, aki ezt
          // mondja: nem mozgott.
          szorny.group.visible = false;
          continue;
        }
        // Visszatéréskor NE ott bukkanjon fel, ahol hagytuk: a legtávolabbi
        // járőrpontról indul újra, különben a lerázás semmit sem ért.
        const tav = [...this.world.patrolWaypoints].sort(
          (a, b) => b.distanceTo(testem.position) - a.distanceTo(testem.position)
        )[0];
        if (tav) {
          szorny.position.copy(tav);
          szorny.group.position.copy(tav);
        }
      }

      // RÁFOGTAD-E A FÉNYT. Szög és távolság — ugyanaz a kúp, amit látsz.
      const felé = szorny.position.clone().sub(lampasnal.position);
      const tav = felé.length();
      const irany = Math.atan2(felé.x, felé.z);
      // UGYANAZ A SZÖG, amit a lámpa is használ: a kúp, amit LÁTSZ, és a
      // kúp, ami ÉGET, nem lehet két különböző irány — abból az lenne,
      // hogy ráfogod a fényt, és nem történik semmi.
      const elteres = Math.abs(((irany - nezesIrany + Math.PI) % (Math.PI * 2)) - Math.PI);
      const fenyben = eg && tav < HAUNT.beamRange && elteres < HAUNT.beam;

      if (this.lurkerKind[i] === 'leso') {
        // A LESŐ: EGY MOZDULAT, KÉT KÖVETKEZMÉNY.
        //
        // A lámpa felébreszti ÉS égeti. Ha kitartod a fényt két
        // másodpercig, szétfoszlik. Ha félúton elkapod a tekinteted, akkor
        // viszont már ébren van — és ő a leggyorsabb a házban.
        //
        // Ez a mód legjobb döntése, mert nem tudás kérdése, hanem IDEGÉ:
        // pontosan tudod, mit kell tenned, és mégis nehéz megcsinálni,
        // mert közben feléd jön.
        if (fenyben) {
          if (szorny.state === 'IDLE') {
            szorny.state = 'CHASE';
            this.game.banner = 'FELÉBRESZTETTED';
            sound.clip('empty', 0.6);
          }
          this.lurkerTimer[i] += step;
          eget = true;
          this.game.banner = `ÉGETED… ${Math.round((this.lurkerTimer[i] / HAUNT.burn) * 100)}%`;
          if (this.lurkerTimer[i] >= HAUNT.burn) {
            this.lurkerTimer[i] = 0;
            this.lurkerFled[i] = HAUNT.flee;
            szorny.group.visible = false;
            szorny.state = 'IDLE';
            this.game.banner = 'SZÉTFOSZLOTT';
            sound.clip('reload-start', 0.5);
            continue;
          }
        } else {
          // Levetted róla: az égés nem őrződik meg. Szakaszokban nem megy
          // — vagy kitartod, vagy nem kezded el.
          this.lurkerTimer[i] = Math.max(0, this.lurkerTimer[i] - step * 2);
        }
      } else if (this.lurkerKind[i] === 'koveto') {
        // --- A KÖVETŐ ---------------------------------------------------
        //
        // Három dolgot csinál, és egyik sem bántás:
        //
        //   ZAJT KELT minden lépésével. Ez a tényleges veszély: a vak erre
        //   jön, és ő már bánt. A követőt azért kell lerázni, mert amíg a
        //   nyomodban van, addig folyamatosan HÍVJA a többieket rád.
        const tav = szorny.position.distanceTo(testem.position);
        this.noise.emit(szorny.position, HAUNT.stalkerNoise, 'léptek mögötted');

        //   MINDIG TUDJA, HOL VAGY, és mindig jön. A többi szörnynek látnia
        //   vagy hallania kell téged; ő nem keres, hanem követ. Enélkül a
        //   ház túlsó végében ácsorgott, amíg meg nem látott — mérve tíz
        //   másodpercig meg sem mozdult.
        szorny.lastStimulus = testem.position.clone();
        if (szorny.state !== 'CHASE') szorny.state = 'CHASE';

        //   MÖGÉD KERÜL, amikor nem nézel oda. Nem varázslat: pontosan
        //   akkor lép, amikor a fal vagy a hátad takarja. Megfordulsz, és
        //   ott áll — nem támad, csak áll.
        const latom =
          !this.world.sightBlocked(testem.position, szorny.position) &&
          Math.abs(
            ((Math.atan2(
              szorny.position.x - testem.position.x,
              szorny.position.z - testem.position.z
            ) - nezesIrany + Math.PI) % (Math.PI * 2)) - Math.PI
          ) < 1.1;

        this.lurkerTimer[i] += step;
        // ...DE NEM AKKOR, AMIKOR ÉPP MENEKÜLSZ ELŐLE.
        //
        // Ez tette lerázhatatlanná: futottál, gyűlt a lerázás ideje, aztán
        // a szörny mögéd villant, a távolság hétre esett, és a számláló
        // nullázódott. Minden menekülés így ért véget. Amíg a lerázás fut,
        // a mögéd kerülés ALSZIK — különben a szabály önmagát eszi meg.
        const menekulok = this.lurkerShake[i] > 0.4;
        if (
          !menekulok &&
          !latom &&
          this.lurkerTimer[i] > HAUNT.stalkerBlink &&
          tav > HAUNT.stalkerGap
        ) {
          const moge = new THREE.Vector3(
            testem.position.x - Math.sin(nezesIrany) * HAUNT.stalkerGap,
            0,
            testem.position.z - Math.cos(nezesIrany) * HAUNT.stalkerGap
          );
          const hely = this.world.nearestStanding(moge, testem.position, 0.5);
          if (this.world.walkable(hely.x, hely.z, 0.5)) {
            szorny.position.copy(hely);
            szorny.group.position.copy(hely);
            this.lurkerTimer[i] = 0;
            // NÉMÁN. A reccsenés-hangmintánk ajtónyikorgásnak hallatszik,
            // és a házban nincsenek ajtók — a Követő megjelenése így nem
            // jelzést adott, hanem hazudott. Aki mögéd lép, az nem
            // jelentkezik be; azt attól veszed észre, hogy megfordulsz.
          }
        }

        //   LERÁZHATÓ: ha elég sokáig nem lát és messze vagy, feladja egy
        //   időre. Ez az egyetlen ellenszere — nincs fény, ami hatna rá.
        //   ...de csak MOZGÁS KÖZBEN. Az első változatban elég volt
        //   állni: mérve a kör első másodperceiben leráztam anélkül, hogy
        //   egy lépést tettem volna, mert a ház nagy, és a fal takar.
        //   Lerázni annyit tesz, hogy MESSZEBB KERÜLSZ tőle — ezért az idő
        //   csak akkor telik, ha nő a távolság.
        //   A TÁVOLODÁST fél másodperces ablakban nézzük, nem képkockánként.
        //   Egy sarkon befordulva a távolság pillanatokra csökkenhet, és egy
        //   képkockára szigorított szabály ilyenkor nullázta a menekülést.
        this.lurkerWindow[i] += step;
        let tavolodsz = this.lurkerShake[i] > 0;
        if (this.lurkerWindow[i] >= 0.5) {
          tavolodsz = tav > (this.lurkerLast[i] ?? tav) + 0.2;
          this.lurkerLast[i] = tav;
          this.lurkerWindow[i] = 0;
        }
        if (
          tavolodsz &&
          tav > HAUNT.stalkerShakeGap &&
          this.world.sightBlocked(testem.position, szorny.position)
        ) {
          this.lurkerShake[i] += step;
          if (this.lurkerShake[i] >= HAUNT.stalkerShake) {
            this.lurkerShake[i] = 0;
            this.lurkerFled[i] = HAUNT.stalkerRest;
            szorny.group.visible = false;
            this.game.banner = 'LERÁZTAD';
            continue;
          }
        } else {
          this.lurkerShake[i] = 0;
        }
      } else if (this.lurkerKind[i] === 'vak') {
        // A VAK a csendtől veszíti el a nyomot. Nem lát, tehát nincs mit
        // megszakítani — állj meg, és néhány másodperc múlva továbbmegy.
        if (!lampasnal.moving && szorny.state !== 'PATROL') {
          this.lurkerTimer[i] += step;
          if (this.lurkerTimer[i] >= HAUNT.calm) {
            szorny.state = 'PATROL';
            this.lurkerTimer[i] = 0;
            this.game.banner = 'ELVESZTETTE A HANGOD';
          }
        } else {
          this.lurkerTimer[i] = 0;
        }
      }
      // A KÖVETŐNEK nincs fényellenszere: azt csak elveszíteni lehet. A
      // ház a fegyver ellene — sarkok, kerülők, a folyosórács.

      szorny.group.visible = true;
      // A LESŐ ÁLL, amíg alszik: nem járőrözik és nem is hall. Ezért nem
      // is lépteti a szabályait — egy alvó leső a szoba bútora, amíg rá
      // nem világítasz.
      if (this.lurkerKind[i] === 'leso' && szorny.state === 'IDLE') continue;
      szorny.update(step, talpon, this.noise);
    }

    // ELKAPTAK. A távolság dönt, ahogy a lakónál is — de itt nem csak
    // cukorkát veszítesz.
    if (!haunt.down[me].down) {
      for (let i = 0; i < this.lurkers.length; i++) {
        const szorny = this.lurkers[i];
        if (this.lurkerFled[i] > 0) continue;
        // A KÖVETŐ NEM BÁNT. Ő csak jön, és közben zajt kelt — a baj nem ő,
        // hanem amit MIATTA hallanak meg a többiek.
        if (this.lurkerKind[i] === 'koveto') continue;
        if (this.szemle) continue;
        if (szorny.position.distanceTo(testem.position) > HOUSE.catchRadius) continue;
        if (!haunt.caught(me, testem.position)) continue;
        // AZ IJESZTÉS a becsapódás PILLANATÁBAN jön, minden bevezetés
        // nélkül: az ijedés maga a felkészületlenség.
        this.jumpscare?.fire(this.lurkerFaces[i] ?? '');
        // ...ÉS MEGMONDJUK, MI VOLT AZ. Játszva ez hiányzott a
        // legjobban: „meghaltam, de nem mutatta, mitől". Egy horrorban a
        // halál lehet váratlan, de utólag mindig érthetőnek kell lennie —
        // különben nem tanulsz belőle, csak dühös leszel.
        this.game.banner =
          this.lurkerKind[i] === 'vak'
            ? 'A VAK ELKAPOTT — meghallotta a lépteidet'
            : this.lurkerKind[i] === 'leso'
              ? 'A LESŐ ELKAPOTT — felébresztette a fény'
              : 'A KÖVETŐ ELKAPOTT';
        sound.clip('hit', 1);
        testem.applyKnockback(szorny.position);
        break;
      }
    }

    // MENTÉS: a társad fölött guggolva, a HASZNÁLAT gombot nyomva tartva.
    // Nem érintés — időbe telik, és amíg ott vagy, te is célpont vagy.
    const tars = (1 - me) as 0 | 1;
    const lent = haunt.down[tars];
    if (lent.down && !haunt.down[me].down) {
      const kozel = testem.position.distanceTo(lent.at) < HAUNT.reviveRadius;
      const nyomom = this.input.get(me).interactHeld;
      if (kozel && nyomom) {
        if (haunt.lift(tars, step)) {
          this.players[tars].position.copy(lent.at);
          this.game.banner = 'TALPRA ÁLLÍTOTTAD';
        } else {
          this.game.banner = `FELSZEDÉS… ${Math.round((lent.lifting / HAUNT.revive) * 100)}%`;
        }
      } else if (lent.lifting > 0) {
        // Elengedted: visszaesik. Félig felhúzni nem ér semmit — enélkül a
        // mentés kockázat nélküli volna, mert be lehetne szakaszolni.
        haunt.letGo(tars);
      }
    }

    // === A HÁZ HANGJA ======================================================
    //
    // Ez a mód legfontosabb rétege, és sokáig hiányzott. Négy dolog szól, és
    // mindegyik MOND valamit — egyik sem díszítés:
    //
    //   ALAPHANG: halk zúgás, végig. Nem ijeszt, hanem a csendet teszi
    //   „valamivé": egy néma játékban a csend hiba, egy zúgó házban készülés.
    //
    //   LÉPTEK: a sajátod, amikor mozogsz. Ettől lesz a futásnak SÚLYA — és
    //   ezért lesz nehéz futni, amikor a csend a védelmed.
    //
    //   SZÍVVERÉS: ha szörny van a közeledben. Nem mondja meg, hogy melyik
    //   és honnan — csak azt, hogy VAN. A bizonytalanság a félelem, nem az
    //   információ.
    //
    //   MORGÁS és RECCSENÉS: ritkán, véletlenszerűen. Ezek a hamis
    //   ijesztések; ezektől lesz hihető a valódi.
    // A SÉTA IS HALLATSZIK — közelről.
    //
    // Eddig csak a FUTÁS és a földet érés keltett zajt: sétálva tökéletesen
    // néma voltál, és a Vak — aki csak hallani tud — soha nem vett észre.
    // Kívülről ez úgy néz ki, hogy „a szörnyek meg sem próbálnak elkapni".
    // Hét méter: a szomszéd szobában nem hallatszik, a hátad mögött igen.
    if (testem.moving && !haunt.down[me].down) {
      // A VAK MESSZEBBRŐL HALL.
      //
      // Hét méter volt, és játszva ez azt jelentette, hogy a szörnyekkel
      // szinte soha nem találkozol: a ház 78×64 méter, három szörny jár
      // benne, és hét méteren belülre kerülni ritka véletlen. Egy
      // horrorjáték, amiben nem történik semmi, nem félelmetes, hanem
      // üres. Tizennégy méterrel a Vak tényleg KERES — és ettől lesz
      // értelme a megállásnak is, ami az ellenszere.
      this.noise.emit(testem.position, testem.isLoud ? NOISE.sprintRadius : 14, 'lépteid');
    }

    this.hangClock += step;
    sound.loop('h-ambience', 0.22);
    sound.loop('h-steps', testem.moving && !haunt.down[me].down ? 0.5 : 0);

    // A SZÖRNY HALLATJA MAGÁT, AMIKOR JÖN.
    //
    // Enélkül a Vak kivédhetetlen volt: nincs szeme (nem világít), sötét a
    // teste, és a lámpa tizenhat méterig ér egy szűk kúpban — tehát
    // semmilyen jele nem volt. Játszva ez jött vissza: „meghaltam, de nem
    // mutatta, mitől, és nem is láttam ellenséget."
    //
    // A szabály nem változik: a Vak akkor indul el, ha zajt csapsz, és
    // akkor áll le, ha megállsz. Csak mostantól HALLOD, hogy elindult —
    // és így van mire reagálni. Közelebbről sűrűbben és hangosabban:
    // tizennégy méternél két és fél másodpercenként, karnyújtásnyira
    // majdnem folyamatosan.
    for (let i = 0; i < this.lurkers.length; i++) {
      if (this.lurkerFled[i] > 0) continue;
      const szorny = this.lurkers[i];
      const vadaszik = szorny.state === 'CHASE' || szorny.state === 'ALERT';
      if (!vadaszik) continue;
      const tav = szorny.position.distanceTo(testem.position);
      if (tav > 14) continue;
      const kozelseg = 1 - tav / 14;
      const utem = 2.6 - kozelseg * 2.0;
      if (this.hangClock - (this.lurkerHang[i] ?? -99) < utem) continue;
      this.lurkerHang[i] = this.hangClock;
      // A KÖVETŐ lépked, a másik kettő morog. A Követő a hangjával hívja
      // a többieket — az övé ezért a súlyos, ismétlődő lépés.
      sound.clip(this.lurkerKind[i] === 'koveto' ? 'h-steps' : 'h-growl', 0.25 + kozelseg * 0.6);
    }

    // A LEGKÖZELEBBI SZÖRNY dönti el a szívverést. Húsz méteren belül
    // kezdődik, és ahogy közeledik, hangosabb — de sosem mondja meg, merre.
    let legkozelebb = Infinity;
    for (let i = 0; i < this.lurkers.length; i++) {
      if (this.lurkerFled[i] > 0) continue;
      legkozelebb = Math.min(legkozelebb, this.lurkers[i].position.distanceTo(testem.position));
    }
    if (legkozelebb < 20 && !haunt.down[me].down) {
      const kozel = 1 - legkozelebb / 20;
      // A szívverés ÜTEME is gyorsul: hetven felett száztízig.
      const utem = 60 / (72 + kozel * 48);
      if (this.hangClock - this.szivUtolso > utem) {
        this.szivUtolso = this.hangClock;
        sound.clip('h-heart', 0.25 + kozel * 0.55);
      }
    }

    // A HÁZ MAGÁTÓL IS HANGOT AD. Nyolc-huszonöt másodpercenként egy távoli
    // morgás — semmi nem történik utána. Pont ez a lényeg: megtanulod, hogy
    // nem minden zaj jelent szörnyet, és akkor egyszer mégis.
    //
    // AJTÓNYIKORGÁS NINCS BENNE TÖBBÉ. A reccsenés-hangmintánk ajtónak
    // hallatszik, és a házban már nincsenek ajtók: egy hang, ami olyasmit
    // ígér, ami nincs, nem hangulat, hanem félrevezetés.
    if (this.hangClock > this.kovetkezoNesz) {
      this.kovetkezoNesz = this.hangClock + 8 + this.sors() * 17;
      sound.clip('h-growl', 0.18 + this.sors() * 0.16);
    }

    // === AMI ÁTSZALAD ELŐTTED ==============================================
    //
    // Nem történik semmi. Pont ez a lényeg: nem azt kapod, hogy „valami
    // megtámadott", hanem azt, hogy „láttam valamit?". Utána minden ajtóra
    // másképp nézel — és amikor legközelebb TÉNYLEG történik valami,
    // elhiszed.
    //
    // A helye a nézésed mentén van, tizennégy és harminc méter között, ott,
    // ahol a padló járható: így mindig egy ajtón vagy egy folyosón fut át,
    // nem a falban. Ha nincs ilyen pont — mert falnak állsz —, kivárjuk a
    // következőt; egy alak, ami a szemközti fal előtt szalad el, nem
    // rejtély, hanem hiba.
    this.glimpse?.update(step, testem.position);
    if (!haunt.hidden && this.hangClock > this.kovetkezoAlak && !this.glimpse?.running) {
      this.kovetkezoAlak =
        this.hangClock + HAUNT.glimpseMin + this.sors() * (HAUNT.glimpseMax - HAUNT.glimpseMin);
      // TÖBB TÁVOLSÁGOT PRÓBÁL, NEM CSAK EGYET.
      //
      // Eddig egyetlen véletlen pontot nézett meg húsz és harmincnégy méter
      // között, és ha az falba esett, huszonöt-hatvan másodpercet várt a
      // következő próbáig. Egy folyosón — ahol a szemközti fal tizenöt
      // méterre van — ez azt jelentette, hogy szinte soha nem indult el.
      //
      // Most végigmegy a nézésed mentén kintről befelé: a legtávolabbi
      // járható pontot választja, mert az a jó. Közel a sziluettből doboz
      // lesz.
      const oldalX = Math.cos(nezesIrany);
      const oldalZ = -Math.sin(nezesIrany);
      let hol: THREE.Vector3 | null = null;
      let felszeles = 0;
      for (let tav = HAUNT.glimpseFar; tav >= HAUNT.glimpseNear; tav -= 2) {
        const p = new THREE.Vector3(
          testem.position.x + Math.sin(nezesIrany) * tav,
          0,
          testem.position.z + Math.cos(nezesIrany) * tav
        );
        if (!this.world.walkable(p.x, p.z, 1.2)) continue;
        // MEKKORA HELY VAN OLDALRA? A legszélesebb átfutás, aminek MINDKÉT
        // vége járható padlón van. Egy szűk folyosón ez másfél méter, egy
        // teremben három — és így sehol nem indul a falból.
        for (const w of [3.2, 2.2, 1.5]) {
          const bal = this.world.walkable(p.x - oldalX * w, p.z - oldalZ * w, 0.6);
          const jobb = this.world.walkable(p.x + oldalX * w, p.z + oldalZ * w, 0.6);
          if (bal && jobb) {
            felszeles = w;
            break;
          }
        }
        if (felszeles > 0) {
          hol = p;
          break;
        }
      }
      if (hol) {
        this.glimpse?.start(hol, nezesIrany, felszeles);
      } else {
        // NEM TALÁLT HELYET (falnak állsz): ne várjon egy teljes kört a
        // következő próbáig, csak pár másodpercet. A ritkaságot az adja,
        // hogy ritkán INDUL EL, nem az, hogy ritkán próbálkozik.
        this.kovetkezoAlak = this.hangClock + 4;
      }
    }

    // === A MUMUS ===========================================================
    //
    // Csak akkor mozdul, amikor NEM NÉZEL RÁ — szembefordulva áll, mint egy
    // fénykép. Ezért soha nem látod mozogni, csak azt, hogy közelebb van.
    if (this.mumus) {
      const rajta = (() => {
        if (!this.mumus?.active) return false;
        const fele = this.mumus.position.clone().sub(testem.position);
        const szog = Math.abs(
          ((Math.atan2(fele.x, fele.z) - nezesIrany + Math.PI) % (Math.PI * 2)) - Math.PI
        );
        // Bele kell nézned, nem elég a szemed sarkából: a kúp szűkebb, mint
        // a képernyő, különben soha nem mozdulna.
        return szog < 0.5 && !this.world.sightBlocked(testem.position, this.mumus.position);
      })();

      const mi = this.mumus.update(step, testem.position, rajta);
      if (mi === 'elkapott') {
        // LEDOBJA AZ ALAKOT. Ez a mód egyetlen ijesztése, amit te idéztél
        // elő: odamentél, mert azt hitted, a társad az.
        this.jumpscare?.fire(this.lurkerFaces[0] ?? '');
        sound.clip('hit', 1);
        haunt.caught(me, testem.position);
        this.game.banner = 'NEM Ő VOLT';
      } else if (mi === 'eltunt' && !this.mumus.dangerous) {
        this.game.banner = 'OTT VOLT VALAKI…';
      }

      // FELBUKKANÁS. Csak akkor, ha nem bújsz, és van hova: a pontnak
      // járhatónak kell lennie, különben a falban állna.
      if (HAUNT.mumusOn && !this.mumus.active && !haunt.hidden && this.hangClock > this.kovetkezoMumus) {
        const tav = HAUNT.mumusNear + this.sors() * (HAUNT.mumusFar - HAUNT.mumusNear);
        const szog = nezesIrany + (this.sors() - 0.5) * 1.2;
        const hol = new THREE.Vector3(
          testem.position.x + Math.sin(szog) * tav,
          0,
          testem.position.z + Math.cos(szog) * tav
        );
        if (this.world.walkable(hol.x, hol.z, 0.6)) {
          this.kovetkezoMumus = this.hangClock + HAUNT.mumusEvery;
          this.mumus.appear(hol, testem.position);
          // Semmi hang. A mumus attól mumus, hogy NEM JELZI magát — a
          // többi szörnyet hallod, ez csak ott van.
        }
      }
    }

    // === CUKORKA ÉS KIJUTÁS ================================================
    //
    // A cukorka RÁÁLLÁSRA jön, nem gombra: a sötétben már az is elég munka,
    // hogy megtaláld. A zsák viszont nem biztonság — ha mindketten lementek,
    // az egész odavan.
    for (const spot of this.world.candySpots) {
      if (spot.taken || haunt.hidden) continue;
      if (spot.position.distanceTo(testem.position) > 1.7) continue;
      spot.taken = true;
      spot.mesh.visible = false;
      haunt.candy++;
      sound.clip('reload-done', 0.5);
      this.game.banner =
        haunt.candy >= HAUNT.quota
          ? `${haunt.candy} CUKORKA — MEHETTEK`
          : `${haunt.candy} / ${HAUNT.quota} CUKORKA`;
    }

    // A KIJÁRAT MINDIG NYITVA.
    //
    // Ez a mód legfontosabb szabálya, és szándékosan nem feltételhez kötött:
    // kimenni bármikor ki lehet, akár üres kézzel is. A küszöb csak azt
    // mondja meg, sikerült-e a kör.
    //
    // Egy zárt ajtó, ami nyolc cukorkára nyílik, ellenőrzőlistát csinál a
    // játékból. Egy nyitott ajtó, ami mögött ott a tét, KAPZSISÁGOT: minden
    // egyes darab után újra eldöntöd, hogy kimész-e most, vagy maradsz még
    // egyért.
    const ajtoban = testem.position.distanceTo(this.world.exitZone) < this.world.exitRadius;
    if (ajtoban && !haunt.hidden && HAUNT.exitOpen) {
      if (this.input.get(me).interactHeld) {
        this.kijutas += step;
        this.game.banner = `KIFELÉ… ${Math.round((this.kijutas / HAUNT.exitHold) * 100)}%`;
        if (this.kijutas >= HAUNT.exitHold) haunt.escape();
      } else {
        this.kijutas = 0;
        this.game.banner =
          haunt.candy >= HAUNT.quota
            ? `E — KIFELÉ (${haunt.candy} cukorkával, ELÉG)`
            : `E — KIFELÉ (${haunt.candy} / ${HAUNT.quota} — maradsz még egyért?)`;
      }
    } else if (ajtoban && !haunt.hidden) {
      // A KIJÁRAT MOST BE VAN ZÁRVA (lásd HAUNT.exitOpen). Nem hallgatunk
      // róla: egy küszöb, ami néma, hibának látszik.
      this.game.banner = 'A KIJÁRAT ZÁRVA — a ház még nem enged ki';
    } else {
      this.kijutas = 0;
    }

    // === BÚJÁS =============================================================
    //
    // A harmadik válasz a „fuss" és az „állj meg" mellé, és az egyetlen,
    // ami mindhárom szörny ellen működik. Ezért van ára: bent VAK VAGY.
    // Nem látsz ki, a lámpád nem ég, és nem tudod, mikor érdemes kijönni —
    // csak hallasz. A hang ezért lett a mód alapja.
    const kozeliSzekreny = this.hideSpots.reduce<THREE.Vector3 | null>((best, p) => {
      if (p.distanceTo(testem.position) > HAUNT.hideReach) return best;
      return !best || p.distanceTo(testem.position) < best.distanceTo(testem.position) ? p : best;
    }, null);

    if (this.input.get(me).interact && !haunt.down[me].down) {
      if (haunt.hidden) {
        haunt.hidden = false;
        haunt.hideAt = null;
        this.game.banner = 'KIMÁSZTÁL';
        sound.clip('h-creak', 0.45);
      } else if (kozeliSzekreny) {
        haunt.hidden = true;
        haunt.hideAt = kozeliSzekreny.clone();
        testem.position.copy(kozeliSzekreny);
        testem.mesh.position.copy(kozeliSzekreny);
        this.game.banner = 'BENT VAGY — E: kimászás';
        sound.clip('h-creak', 0.55);
      }
    }
    if (haunt.hidden) {
      // Bent nem mozdulsz. A szekrény nem menedék, ha ki lehet sétálni
      // belőle anélkül, hogy kinyitnád az ajtaját.
      if (haunt.hideAt) {
        testem.position.copy(haunt.hideAt);
        testem.velocity.set(0, 0, 0);
      }
    } else if (kozeliSzekreny) {
      this.game.banner = 'E — bebújás';
    }

    // ELEM FELVÉTELE: ráállsz, és kész. Egy külön gomb itt csak
    // bosszantás volna — a sötétben amúgy is elég megtalálni.
    if (this.batteries?.update(step, testem.position)) {
      haunt.charge();
      this.game.banner = `ELEM — +${HAUNT.battery} mp fény`;
      sound.clip('reload-done', 0.7);
    }

    // A LÁMPA. Csak annál ég, akinél van, és csak amíg van benne telep.
    const lampasE = haunt.torchHolder === me;
    // ÉGETÉS KÖZBEN a telep hatszoros ütemben fogy: az árnyék elűzése
    // FÉNYBE kerül, nem ügyességbe.
    haunt.update(step * (eget ? HAUNT.burnDrain : 1), lampasE);
    const nalam = this.players[haunt.torchHolder];
    // A LÁMPA A NÉZÉST KÖVETI, NEM A LÉPÉST.
    //
    // Eddig a szörny FORGÁSÁT használta, az pedig a haladási irányból jön
    // (`facing = atan2(velocity)`). Belső nézetben ez rossz: oldalazva a
    // lámpa oldalra világít, hátrálva hátra, állva pedig ott marad, ahol
    // utoljára léptél — miközben te előre nézel a sötétbe. Kézben tartott
    // lámpánál a kéz a fejet követi, nem a lábat.
    this.torch?.update(
      step,
      nalam.position,
      nezesIrany,
      haunt.torchOn && !haunt.down[haunt.torchHolder].down && !haunt.hidden,
      haunt.torch / HAUNT.torch,
      // A DŐLÉS IS A KAMERÁÉ, KÜLSŐ NÉZETBEN IS.
      //
      // A forgást már a kamerától vettük, a dőlést viszont csak belső
      // nézetben — kívülről nullát kapott, tehát a fénykúp MINDIG
      // vízszintes volt. Ezért volt az, hogy „a földre nézek, de nem
      // világít oda": a kamera lefelé fordult, a lámpa maradt egyenesen.
      //
      // A külső kamera dőlése lefelé pozitív (`stage.pitch`), a lámpa
      // dőlése felfelé — innen az előjel.
      this.director.firstPerson !== null
        ? this.director.fpPitch
        : // A KÜLSŐ KAMERA DŐLÉSE, AZ ALAPÁLLÁSHOZ MÉRVE.
          //
          // Nem a kamera szögét vesszük át egy az egyben: a házban a kamera
          // alapból 1,22 radiánnal (hetven fokkal) néz le, és egy ennyire
          // lebillentett fénykúp csak a saját lábadat világítaná meg. Azt
          // vesszük át, amennyivel te BILLENTED — alapállásban a kúp
          // vízszintes, lefelé döntve a padlóra néz, felfelé a plafonra.
          //
          // A másfélszeres szorzó azért kell, mert a kamera dőlése a
          // vízszintestől csak 0,28 radiánt tud lefelé menni; anélkül a
          // lefelé nézés alig látszana a fényen.
          THREE.MathUtils.clamp((CAMERA.housePitch - stage.pitch) * 1.6, -0.9, 0.9)
    );
    this.hauntHud?.update(haunt, me, this.partnered);
  }

  /**
   * A LÁMPA KAPCSOLÓJA.
   *
   * Kell egy gomb rá, mert a kikapcsolás SZABÁLY, nem kényelem: a sötétben
   * nem fogy a telep, és a Leső is csak sötétben nyugszik meg. Egy szabály,
   * amit nem lehet használni, nincs is.
   */
  toggleTorch(): void {
    const h = this.haunt;
    if (!h) return;
    if (!h.torchOn && h.torch <= 0) {
      this.game.banner = 'A TELEP KIFOGYOTT';
      return;
    }
    h.torchOn = !h.torchOn;
    this.game.banner = h.torchOn ? 'LÁMPA BE' : 'LÁMPA KI';
    sound.clip('empty', 0.4);
  }

  private szemleJel: THREE.Mesh[] = [];

  /**
   * EGY JELZÉS, AMI NEM TUD LÁTHATATLAN LENNI.
   *
   * A szörnyek a játékos gépén nem jelentek meg, az enyémen igen —
   * ugyanabból a kiadásból. Ilyenkor az első kérdés nem az, hogy „miért
   * nem látszik a modell", hanem hogy „fut-e egyáltalán a szemle".
   *
   * Ez a kocka a legegyszerűbb dolog, amit egy motor ki tud rajzolni:
   * nincs csontja, nincs textúrája, nem függ fénytől. Ha a kocka LÁTSZIK
   * és a szörny nem, akkor a modell a hibás. Ha a kocka sem látszik,
   * akkor a szemle nem is indult el. Egy mérés, két kérdésre.
   */
  private szemleJelek(step: number): void {
    void step;
    if (!this.szemleJel.length) {
      const geo = new THREE.BoxGeometry(0.35, 0.35, 0.35);
      for (let i = 0; i < this.lurkers.length; i++) {
        const szin = [0x00ff88, 0xffcc00, 0xff3355][i % 3];
        const kocka = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: szin }));
        kocka.userData.cpNoOutline = true;
        kocka.frustumCulled = false;
        this.scene.add(kocka);
        this.szemleJel.push(kocka);
      }
    }
    for (let i = 0; i < this.szemleJel.length; i++) {
      const hely = this.szemleHelyek[i];
      if (!hely) continue;
      this.szemleJel[i].visible = true;
      this.szemleJel[i].position.set(hely.x, 0.22, hely.z);
    }
  }

  /** A 0 gomb: szemle be/ki. A helyeket újraszámoljuk, ahol épp állsz. */
  toggleSzemle(): boolean {
    this.szemle = !this.szemle;
    this.szemleHelyek = [];
    if (!this.szemle) for (const k of this.szemleJel) k.visible = false;
    this.game.banner = this.szemle ? 'SZEMLE BE' : 'SZEMLE KI';
    return this.szemle;
  }

  /** A H gomb: az eligazítás bármikor visszahívható. */
  toggleBrief(): void {
    this.hauntBrief?.toggle();
  }

  private cast(): PlayerController[] {
    // A LAKÓ CÉLPONTJAI.
    //
    // Fogó módban MINDKÉT test közéjük tartozik, akkor is, ha egyedül
    // játszol: a második az AI ellenfél. Enélkül a lakó észre sem venné —
    // sérthetetlen ellenfél ellen pedig nincs értelme versenyezni.
    //
    // (Ezt korábban félreolvastam: azt hittem, a lakó már kergeti az AI-t,
    // pedig a `game.cast` egyedül csak a saját szörnyemet tartalmazta, és
    // a CHASE, amit mértem, rám vonatkozott.)
    // A SAJÁT SARKODBAN LÁTHATATLAN VAGY.
    //
    // Mérve: a lakó a kör elején odasétált a sarkomhoz, és ott MEGÁLLT —
    // pontosan a menedék peremén, 5,8 egységre, mert beljebb nem jöhetett.
    // Nyolc mérésből nyolcszor ugyanott állt, üldöző állapotban. A szabály
    // („a sarokba nem jöhet be") így nem menedéket csinált, hanem csapdát:
    // bent biztonságban voltál, de kilépni sem tudtál.
    //
    // Ha a menedék menedék, akkor a lakó ODA NEM IS NÉZ. Kilépve azonnal
    // újra látni fog — a védelem a szobáé, nem a tiéd.
    const latszik = (p: PlayerController): boolean => !this.inSafeRoom(p.position.x, p.position.z);
    if (this.capture) return this.players.filter(latszik);
    return this.game.cast.map((i) => this.players[i]).filter(latszik);
  }

  private peers(): readonly { isMe: boolean; presence: Readonly<Record<string, unknown>>; peer: string; kind: 'viewer' | 'agent' }[] {
    return netRoom?.peers() ?? [];
  }

  render(frameTime: number, width: number, height: number): void {
    this.corners?.update(frameTime);
    this.tracer.update(frameTime);
    this.impact.update(frameTime);
    if (this.capture) {
      this.looseView?.update(frameTime, this.capture, this.localIndex as 0 | 1);
    }
    if (this.capture && this.fogoHud) {
      const me = this.localIndex as 0 | 1;
      const them = (1 - me) as 0 | 1;
      this.fogoHud.update(
        this.capture.carried[me],
        this.capture.banked[me],
        this.capture.banked[them],
        this.held?.kind ?? null,
        this.held?.ammo ?? 0,
        this.held?.reserve ?? 0,
        (this.held?.reloading ?? 0) > 0
      );
    }
    if (this.armoury) {
      this.pickups.update(frameTime, this.armoury, () => 0);
    }
    this.director.update(frameTime, this.players, width, height);
    // A KÉZBEN TARTOTT fegyver csak belső nézetben látszik, és csak a
    // rendezés UTÁN kerül a helyére — a kamera pózát a rendező adja.
    const fp = this.director.firstPerson !== null;
    this.heldView.group.visible = fp && !!this.held;
    this.crosshair.hidden = !fp || !this.held;
    this.crosshair.dataset.steady = this.held?.steady === false ? '0' : '1';
    if (fp && this.held) {
      this.heldView.update(
        frameTime,
        this.director.cameraFor(this.localIndex),
        this.players[this.localIndex].moving
      );
    }
    this.director.render(this.renderer, this.scene);
    this.hud.update({
      director: this.director,
      width,
      height,
      players: this.players,
      padSources: [this.input.get(0).usingGamepad, this.input.get(1).usingGamepad],
      soloActive: this.localIndex,
      names: this.session.selection.names,
      game: this.game,
      homeowner: this.homeowner,
    });

    // A MINITÉRKÉP a jobb felső sarokban.
    //
    // Az üldözők CSAK akkor kerülnek rá, ha tudsz róluk: látod őket, vagy
    // olyan közel vannak, hogy hallanod kell. Egy térkép, amin a lakó mindig
    // ott van egy pöttyként, megszüntetné a lopakodást — onnantól nem
    // figyelni kellene, hanem a sarkot nézni.
    const me = this.players[this.localIndex].position;
    this.map.place(14, 14, Math.min(190, Math.max(130, Math.round(width * 0.14))));
    this.map.draw(
      this.world,
      this.players.map((p) => ({ position: p.position, index: p.index })),
      this.localIndex,
      [
        {
          position: this.homeowner.position,
          facing: this.homeowner.group.rotation.y,
          known: this.knows(me, this.homeowner.position),
          colour: '#ff5a5a',
        },
        ...(this.dog
          ? [
              {
                position: this.dog.position,
                facing: this.dog.group.rotation.y,
                known: this.knows(me, this.dog.position),
                colour: '#ffb347',
              },
            ]
          : []),
      ],
      // A térkép VELED FOROG belső nézetben: a kép teteje az, amerre nézel.
      // Külső nézetben marad állva — ott a kamera úgyis a szobát keretezi, és
      // a forgás csak szédítene.
      this.director.firstPerson !== null ? stage.yaw : undefined,
      // A SARKOK a térképen is ott vannak. Nem díszítés: a fényoszlop a
      // szomszéd szobából nem látszik, és egy cél, amit keresni kell, nem
      // cél, hanem bosszúság.
      this.corners
        ? this.corners.list.map((c) => ({
            position: c.position,
            colour: c.player === this.localIndex ? '#ff7a29' : '#9d5cff',
            ring: c.player !== this.localIndex,
          }))
        : []
    );
  }

  /**
   * Tudsz-e róla: LÁTOD, vagy elég közel van ahhoz, hogy halld.
   *
   * A hallótávolság az, ami miatt a térkép nem csak a látómezőt ismétli meg:
   * a fal mögül is megérzed, hogy ott van valaki — csak azt nem, hogy pontosan
   * hol néz.
   */
  private knows(me: THREE.Vector3, them: THREE.Vector3): boolean {
    // Kilencven egységes felső korlát is volt itt, „ennél messzebbről
    // semmiképp" alapon — csakhogy a házak 56–74 egység szélesek, tehát az a
    // feltétel SOHA nem teljesült. Halott szabály, ami úgy nézett ki,
    // mintha védene valamitől.
    if (me.distanceTo(them) < HEARD_WITHIN) return true;
    return !this.world.sightBlocked(me, them);
  }

  pauseActions(): Partial<PauseActions> {
    return {};
  }

  /** Fold this house into the run before the scene goes away. */
  commit(): void {
    const s = this.session.stats;
    s.candy += this.game.stats.candy;
    s.pranks += this.game.stats.pranks;
    s.catches += this.game.stats.catches;
    s.housesVisited += 1;
    if (this.game.stats.escaped) s.escapes += 1;
    for (const player of this.players) s.candyByPlayer[player.index] += player.candy;
    for (let i = 0; i < 2; i++) {
      s.catchesByPlayer[i] += this.game.catchesByPlayer[i];
      s.pranksByPlayer[i] += this.game.pranksByPlayer[i];
    }
    this.session.visited.add(this.session.targetHouseId);
  }

  dispose(): void {
    this.crosshair.remove();
    this.nightTint.remove();
    this.fogoHud?.dispose();
    this.pickups.dispose();
    this.looseView?.dispose();
    this.tracer.dispose();
    this.impact.dispose();
    this.heldView.dispose();
    this.input.lookLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.disposed = true;
    sound.stopMusic();
    sound.stopLoops();
    delete document.body.dataset.mode;
    delete document.body.dataset.solo;
    for (const k of this.szemleJel) {
      k.geometry.dispose();
      (k.material as THREE.Material).dispose();
      k.removeFromParent();
    }
    this.szemleJel = [];
    this.jumpscare?.dispose();
    this.glimpse?.dispose();
    this.mumus?.dispose();
    this.hauntBrief?.dispose();
    this.hauntHud?.dispose();
    this.torch?.dispose();
    this.commit();
    this.hud.dispose();
    this.map.dispose();
    this.scene.clear();
    pruneOutlines();
  }
}
