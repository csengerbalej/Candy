import * as THREE from 'three';
import { setStageLens, stage, tiltStage, turnStage } from '../camera/Stage';
import { FIRST_PERSON, CAMERA, PLAYER_COUNT, PALETTE, HOMEOWNER, DOG, GUNS, MOVE } from '../core/config';
// The first house is a real flat now, not the greybox kitchen. Both offer the
// same surface to this scene, so the swap is one import and one await.
import { VillageHouse } from '../world/VillageHouse';
import { PlayerController } from '../player/PlayerController';
import { SplitScreenDirector } from '../camera/SplitScreenDirector';
import { Armoury } from '../game/Armoury';
import { Capture } from '../game/Capture';
import { Corners } from '../world/Corners';
import { FogoHud } from '../ui/FogoHud';
import { Rival } from '../ai/Rival';
import { PickupsView } from '../world/PickupsView';
import { HeldWeapon } from '../render/HeldWeapon';
import { Weapon, type Target } from '../game/Weapon';

import { Homeowner } from '../ai/Homeowner';
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
import { CharacterRig, HOMEOWNER_CLIPS, type Rig } from '../render/CharacterRig';
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
  /** Az AI teste. A második játékos helyén ül, ha nincs valódi társ. */
  private rivalBody: PlayerController | null = null;

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
    const name = VillageHouse.pickInOrder(session.visited.size);
    const world = await VillageHouse.load(`models/${name}.json`, `models/${name}-nav.json`);
    return new HouseScene(renderer, input, session, world, parent);
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
    this.homeowner.walkable = (x, z, radius) => this.world.walkable(x, z, radius);
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
    const spots = [
      ...this.world.patrolWaypoints,
      ...this.world.candySpots.map((c) => c.position),
    ];
    if (spots.length) {
      this.armoury = new Armoury(spots);
      this.scene.add(this.pickups.group);
      void this.pickups.load();
    }
    this.scene.add(this.heldView.group);

    // BELSŐ NÉZET ALAPBÓL. A ház a lopakodás és a keresés helye, és mindkettő
    // arról szól, MIT LÁTSZ: felülről a fáklyakúp egy rajz a padlón, a
    // vaksötét ház egy sötét alaprajz. A külső nézet megmarad a V… illetve a
    // C gombon, mert egy elakadt kamera ellen kell egy kiút — de a JÁTÉK a
    // szemből nézett.
    queueMicrotask(() => {
      if (this.director.firstPerson === null) this.toggleFirstPerson();
    });

    this.director.soloActive = this.localIndex;
    this.director.framing = {
      roomFor: (at) => this.world.roomBounds(this.world.roomNear(at.x, at.z)),
      // A kamera vízszintes iránya dönti el, MELYIK falat bontjuk le: azt,
      // amelyik köztünk és a szoba között áll. Forgatás (Q) után a bontott fal
      // magától átvált a másik oldalra.
      clipFor: (at) =>
        this.world.roomClipPlanes(
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
      this.dog.walkable = (x, z, radius) => this.world.walkable(x, z, radius);
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
      this.corners = new Corners(spots);
      this.scene.add(this.corners.group);
      this.capture = new Capture(this.corners.list);
      this.fogoHud = new FogoHud(document.body);
      this.game.capture = this.capture;
      this.game.localSlot = this.localIndex;
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
              this.world.candySpots.filter((c) => !c.taken).map((c) => c.position),
            walkable: (x, z, r) => this.world.walkable(x, z, r),
            route: (from, to, r) => this.world.route(from, to, r) ?? [],
            dangers: () => [this.homeowner.position, ...(this.dog ? [this.dog.position] : [])],
            sightBlocked: (a, b) => this.world.sightBlocked(a, b),
            takeBowl: (at) => {
              const bowl = this.world.candySpots.find(
                (c) => !c.taken && c.position.distanceTo(at) < 2.4
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

    this.echo = this.dark ? new Echo() : null;
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
    toonify(this.world.group, toon);
    toonify(this.homeowner.group, toon);
    addOutlines(this.homeowner.group, 0.9);
    for (const p of this.players) {
      // Greybox placeholder only; the authored art is never toonified.
      toonify(p.mesh, toon);
      addOutlines(p.mesh, 0.9);
    }
    void this.loadCharacters(toon);
    void this.loadHomeowner();
    void this.loadDog();

    this.hud = new Hud(parent);
    this.map = new HouseMap(parent);

    // A ház zenéje: lopakodós, halk. A vezetésnek szándékosan nincs zenéje —
    // ott a motor és a kürt a hang, és egy aláfestés elvenné a kontrasztot,
    // amitől a ház csendje csend.
    sound.playMusic('audio/house.mp3');
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
  toggleFirstPerson(): boolean {
    const on = this.director.firstPerson === null;
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
      const lantern = new THREE.PointLight(0xffc27a, 300, 22, 2);
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
    return VillageHouse.pickInOrder(this.session.visited.size) === 'house2';
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

    this.capture?.update(step);

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
      this.rivalBody.position.copy(this.rival.position);
      this.rivalBody.mesh.position.copy(this.rival.position);
      if (fired?.shot) {
        this.noise.emit(fired.shot.noiseAt, this.rival.weapon!.gun.noiseRadius, 'lövés');
        // Az ELLENFÉL lövése is szól: ebből tudod meg, hogy fegyvere van, és
        // hogy nagyjából merről. Egy néma ellenség nem ellenfél, hanem csapda.
        sound.gun(this.rival.weapon!.kind);
        if (fired.shot.hit) {
          this.takeHit(this.localIndex as 0 | 1, fired.shot.from, fired.shot.strength);
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
        sound.reloadClick(!loading);
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
        sound.pickup();
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
      if (shot) {
        this.heldView.fired();
        // A TALÁLAT KÖVETKEZMÉNYE: ellökés és minden cukorka a földre. Eddig
        // a lövés elsült és zajt csapott, de a célpontnak nem történt semmi —
        // egy fegyver, aminek nincs hatása, csak egy hangeffekt.
        if (shot.hit) this.takeHit(Number(shot.hit.id) as 0 | 1, shot.from, shot.strength);
        // A lövés ZAJ is: a fegyver hangja odahívja a lakót. Ez a fegyver
        // harmadik ára, a lőszer és az idő mellett.
        this.noise.emit(shot.noiseAt, this.held.gun.noiseRadius, 'lövés');
        sound.gun(this.held.kind);
      }
    }

    this.link.apply(this.peers(), this.players, this.homeowner, this.world, this.game);

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
  private takeHit(who: 0 | 1, from: THREE.Vector3, strength = 1): void {
    if (!this.capture) return;
    const body = this.players[who];
    const { push } = this.capture.hit(who, body.position, from, strength);
    body.applyKnockback(body.position.clone().sub(push));
    sound.thud(0.7);
    this.game.banner = who === this.localIndex ? 'ELTALÁLTAK!' : 'TALÁLAT';
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
    if (this.capture) return this.players;
    return this.game.cast.map((i) => this.players[i]);
  }

  private peers(): readonly { isMe: boolean; presence: Readonly<Record<string, unknown>>; peer: string; kind: 'viewer' | 'agent' }[] {
    return netRoom?.peers() ?? [];
  }

  render(frameTime: number, width: number, height: number): void {
    this.corners?.update(frameTime);
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
    this.fogoHud?.dispose();
    this.pickups.dispose();
    this.heldView.dispose();
    this.input.lookLock = false;
    if (document.pointerLockElement) document.exitPointerLock();
    this.disposed = true;
    sound.stopMusic();
    this.commit();
    this.hud.dispose();
    this.map.dispose();
    this.scene.clear();
    pruneOutlines();
  }
}
