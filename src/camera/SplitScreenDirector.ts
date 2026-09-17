import * as THREE from 'three';
import { leadLimit, stage } from './Stage';
import { FIRST_PERSON, CAMERA, SPLIT } from '../core/config';
import type { PlayerController } from '../player/PlayerController';

/** A játékos magassága. MOVE-ból átvéve, hogy a kamera ne importáljon mozgásbeállítást. */
const MOVE_HEIGHT = 1.7;
const SCRATCH = new THREE.Vector3();

export type SplitState = 'shared' | 'transition' | 'split';

export interface Viewport {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Honnan tudja a kamera, melyik szobát kell néznie.
 *
 * A beltéri kamera nem „minél többet mutat", hanem AZT A SZOBÁT mutatja,
 * amelyikben a játékos áll — a fürdőt nem látni a nappaliból. A világ adja a
 * szoba befoglalóját és a hozzá tartozó vágósíkokat; a direktor csak keretez
 * és vág. Ha nincs ilyen szolgáltató (kültéri szakasz, vagy a szegmentálás
 * még nem áll rendelkezésre), a direktor a régi, játékos-középpontú
 * viselkedésre esik vissza — ezért opcionális minden darabja.
 */
/** A válaszvonal iránya és az, hogy melyik panel kié. */
export interface SplitLayout {
  /** Igaz: függőleges vágás (bal/jobb). Hamis: vízszintes (fent/lent). */
  vertical: boolean;
  /** Igaz: a 2. játékos panele kerül a bal/felső oldalra. */
  swap: boolean;
}

export interface RoomFraming {
  /** Annak a szobának a befoglalója, amiben ez a pont van. null = nincs szoba. */
  roomFor(player: THREE.Vector3): THREE.Box3 | null;
  /** Ugyanannak a szobának a vágósíkjai (4 oldal + 1 felső). */
  clipFor(player: THREE.Vector3): THREE.Plane[];
}

/**
 * THE system. Spec §3, §21, §37.
 *
 * Three states, one continuous parameter `t` (0 = shared, 1 = fully split).
 *
 * The seam trick: the divider does not appear at the middle of the screen and
 * grow in opacity. It *slides in from the edge*. At t=0 player 2's viewport has
 * zero height and both cameras sit at the identical shared pose, so the screen
 * is literally one image. As t rises, the divider slides toward the middle while
 * each camera eases from the shared pose to its own follow pose. There is never
 * a frame where the image "cuts" — which is the entire difference between a
 * split-screen that feels designed and one that feels bolted on.
 *
 * Nothing here ever writes to a player's position. Cameras do not herd players.
 */
export class SplitScreenDirector {
  readonly cameras: THREE.PerspectiveCamera[];

  /** Egy játékos kamerája — a kézben tartott fegyver ehhez igazodik. */
  cameraFor(index: number): THREE.PerspectiveCamera {
    return this.cameras[Math.min(index, this.cameras.length - 1)];
  }
  readonly viewports: Viewport[] = [
    { x: 0, y: 0, w: 1, h: 1 },
    { x: 0, y: 0, w: 0, h: 0 },
  ];

  /**
   * A szoba-keretezés szolgáltatója. Alapértelmezésben nincs: a HouseScene
   * köti be, amikor a világ tud szobákat. Enélkül minden a régi módon megy.
   */
  framing: RoomFraming | null = null;

  /** 0..1 blend between shared and split. */
  splitAmount = 0;
  separation = 0;

  /** Smoothed look-ahead offset, shared by every camera. */
  private readonly lead = new THREE.Vector3();
  private readonly targets: THREE.Vector3[];
  private readonly positions: THREE.Vector3[];
  private initialised = false;

  /** Panelenkénti vágósíkok — a render ciklusban, közvetlenül a rajz előtt kellenek. */
  private readonly clips: THREE.Plane[][];
  /**
   * Mennyi ideje állnak külön szobában. Egy ajtóban toporgó játékos
   * cellánként váltogatja a szobát; ez a késleltetés nélkül a fél képernyőt
   * be-ki csúsztatná másodpercenként többször.
   */
  private apartFor = 0;
  /** 0 = a keretezés a játékosokhoz igazodik, 1 = egy szobához. */
  private roomWeight = 0;
  /**
   * A keretezés simított állapota: hova néz és milyen messziről, panelenként,
   * plusz a közös kép ugyanezen két értéke.
   *
   * Ez nem ugyanaz, mint a kamerapozíció simítása alább. A szoba a küszöbön
   * CELLÁNKÉNT vált: egy képkockával korábban a nappali, egy képkockával később
   * a konyha, és a kívánt póz egyetlen képkocka alatt tizennyolc egységet ugrik.
   * Az exponenciális simítás ezt folytonossá teszi ugyan, de a SEBESSÉGET nem:
   * mérve 2196 egység/s² csúcsgyorsulás, ami a képernyőn csapás. Ha viszont már
   * a CÉL is folytonosan úszik át egyik szobáról a másikra, a kamera végig
   * sima marad — ugyanez mérve 22 egység/s².
   */
  private readonly soloBox: THREE.Box3[];
  private readonly sharedBox = new THREE.Box3();
  /** Az utoljára ismert szoba játékosonként; lásd az update() elejét. */
  private readonly lastRoom: (THREE.Box3 | null)[] = [null, null];
  /** Az aktuális vágásirány; a HUD is ezt olvassa. */
  splitLayout: SplitLayout = { vertical: SPLIT.orientation === 'vertical', swap: false };
  private readonly lastClips: (THREE.Plane[] | null)[] = [null, null];
  /** Eldobható kamera a keretezés ellenőrzéséhez — nem rajzol, csak vetít. */
  private readonly probeCamera = new THREE.PerspectiveCamera();

  constructor(private readonly playerCount: number) {
    this.cameras = Array.from({ length: playerCount }, () => {
      const c = new THREE.PerspectiveCamera(stage.fov, 1, CAMERA.near, CAMERA.far);
      return c;
    });
    this.targets = Array.from({ length: playerCount }, () => new THREE.Vector3());
    this.positions = Array.from({ length: playerCount }, () => new THREE.Vector3());
    this.clips = Array.from({ length: playerCount }, () => [] as THREE.Plane[]);
    this.soloBox = Array.from({ length: playerCount }, () => new THREE.Box3());
  }

  get state(): SplitState {
    if (this.splitAmount <= 0.001) return 'shared';
    if (this.splitAmount >= 0.999) return 'split';
    return 'transition';
  }

  /** Pixel offset of the divider from the screen edge it slides in from. */
  get dividerPixels(): number {
    // A vágás irányát a geometria adja, nem a beállítás; lásd `splitLayoutFor`.
    const pane = this.viewports[this.splitLayout.swap ? 0 : 1];
    return this.splitLayout.vertical ? pane.x : pane.h;
  }

  /**
   * Egyszemélyes módban a most irányított szörny indexe.
   *
   * Ilyenkor nincs osztott kép: egy ember nézi, tehát nincs kit külön
   * követni. A kamera azt a szörnyet keretezi, amelyiket épp mozgatja — a
   * másik ott áll, ahol hagyta, és ha kell, a Tab odaviszi a nézetet is.
   */
  soloActive: number | null = null;

  /**
   * BELSŐ NÉZET: melyik játékos saját szeméből látjuk a világot.
   *
   * `null` = külső nézet, ahogy eddig. Ha be van állítva, az ő kamerája NEM
   * a szobát keretezi, hanem a szemében ül — a keretezés, a vezetés és a
   * simítás mind kimarad, mert mind arról szólt, hogy a TESTET hol lássuk.
   * Belső nézetben nincs test, amit keretezni kell.
   */
  firstPerson: number | null = null;
  /** A fel-le nézés szöge belső nézetben. A jelenet állítja a bemenetből. */
  fpPitch = 0;
  /** Nulla = alap látószög; nagyobb nulla = távcső. A jelenet állítja. */
  fpFov = 0;

  update(dt: number, players: PlayerController[], width: number, height: number): void {
    const a = players[0].position;
    const b = players[1].position;
    this.separation = a.distanceTo(b);

    // --- Melyik szobában állnak? -------------------------------------------
    //
    // Ha egy pillanatra NINCS szoba — küszöbön áll, ajtónyílásban van, vagy a
    // szegmentálás nem címkézte azt a pár cellát —, akkor az ELŐZŐ szobát
    // tartjuk meg. Enélkül a kamera arra a néhány képkockára elejti a
    // keretezést és visszaesik a játékos-középpontú nézetre, majd visszaugrik:
    // mértük, 226 e/s² gyorsulási tüske, ami a képernyőn csapás. A kamerának
    // nincs dolga azzal, hogy a rács egy cellát nem tudott hova sorolni.
    const rooms = players.map((p, i) => {
      // Egyedül mindkét kamera az IRÁNYÍTOTT szörny szobáját keretezi:
      // különben a máshol hagyott társ szobája beleszámítana az unióba, és a
      // kép olyan helyet is mutatna, ahol épp senki sincs.
      const at = this.soloActive !== null ? players[this.soloActive].position : p.position;
      const found = this.framing?.roomFor(at) ?? null;
      if (found) this.lastRoom[i] = found;
      return found ?? this.lastRoom[i];
    });
    const known = rooms[0] !== null && rooms[1] !== null;
    const differ = known && !sameBox(rooms[0]!, rooms[1]!);

    // --- Mikor váljon ketté a kép? ------------------------------------------
    //
    // A SZOBA dönti el, nem a távolság.
    //
    // A távolság-alapú küszöb (7 / 14 egység) a nyílt városi szakaszból
    // maradt itt, és a szobakamerával szemben dolgozott. Lemérve: a 4. szoba
    // 39 egység, tehát a két végében állva szétvált a kép, pedig EGY szobában
    // voltak és egy kamera bőven mutatta volna mindkettőt; a 6. szoba viszont
    // 18 egység, ott a pár szinte sosem ért el 14 egységet, tehát akkor sem
    // vált szét, ha külön sarokban álltak. Az osztás pont fordítva működött,
    // mint ahogy kellett volna.
    //
    // Szoba-döntéssel az osztásnak JELENTÉSE lesz: a kép akkor és csak akkor
    // válik ketté, amikor elszakadtok egymástól — ami co-opban egyébként is az
    // a pillanat, ami számít.
    //
    // A távolság egyetlen dologra marad meg: ha valamelyiküknek nincs szobája
    // (kültéren, vagy amíg a szegmentálás nem áll rendelkezésre), a régi
    // szabály veszi át, különben a szakasznak nem lenne osztott képe egyáltalán.
    this.apartFor = differ ? this.apartFor + dt : 0;
    const desired =
      this.soloActive !== null
        ? 0
        : known
          ? this.apartFor >= SPLIT.roomSplitDwell
            ? 1
            : 0
          : smoothstep(SPLIT.mergeDistance, SPLIT.splitDistance, this.separation);
    this.splitAmount += (desired - this.splitAmount) * (1 - Math.exp(-SPLIT.easeSpeed * dt));
    // Snap once the remainder is below what a pixel or a label can show, so the
    // state readout never disagrees with the rendered layout.
    if (Math.abs(desired - this.splitAmount) < 0.004) this.splitAmount = desired;

    this.splitLayout = this.splitLayoutFor(rooms, stageDirection());
    this.layoutViewports(width, height, this.splitLayout);

    const t = this.splitAmount;
    const dir = stageDirection();

    // Mennyire szoba-vezérelt a kép most. Csak akkor 1, ha MINDKÉT oldalnak
    // van szobája — különben a két panel két különböző szabály szerint
    // mozogna, és az átmenet közben ugrana.
    const wantRoom = known ? 1 : 0;
    this.roomWeight += (wantRoom - this.roomWeight) * (1 - Math.exp(-CAMERA.roomEase * dt));

    // --- Shared pose --------------------------------------------------------
    //
    // Egy szobában: azt a szobát keretezi. Külön szobában: a kettő unióját,
    // de ez csak átmeneti állapot, mert a szétválás már úton van.
    const sharedAspect = width / height;
    const ease = 1 - Math.exp(-CAMERA.roomEase * dt);
    // Egyedül a kamera az irányított szörnyre néz, nem a kettő közepére: a
    // másik lehet a lakás túlfelén, és a közép egy üres folyosó lenne.
    const mid =
      this.soloActive !== null
        ? players[this.soloActive].position.clone()
        : new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
    let sharedFocus: THREE.Vector3;
    let sharedDist: number;
    if (known) {
      const box = rooms[0]!.clone();
      if (differ) box.union(rooms[1]!);
      easeBox(this.sharedBox, box, this.initialised ? ease : 1);
      sharedDist = this.boxDistance(this.sharedBox, dir, sharedAspect);
      sharedFocus = this.framedFocus(this.sharedBox, mid, dir, sharedDist, sharedAspect);
    } else {
      this.sharedBox.makeEmpty();
      sharedDist = this.framingDistance(a, b, dir, sharedAspect);
      sharedFocus = mid.clone();
      sharedFocus.y += CAMERA.focusHeight;
    }

    // The tightest camera actually in play — a split pane is much closer in
    // than the shared view, and a lead sized for the shared view would push the
    // player clean off the bottom of their own pane.
    const tightest = sharedDist * (1 - t) + stage.followDistance * t;

    // The focus leads where the pair is GOING, not just where it is. Centring
    // exactly on the players spends half the screen on the room they have
    // already crossed: you walk into things because the thing you are walking
    // at is the one part of the shot that is off it.
    //
    // Szoba-keretezésnél ennek nincs értelme és kárt is tenne: az egész szoba
    // a képen van, elébe menni csak kilógatná belőle. Ezért a `roomWeight`
    // arányában elhal — folytonosan, nem kapcsolóval.
    const travel = new THREE.Vector3()
      .addVectors(players[0].velocity, players[1].velocity)
      .multiplyScalar(0.5);
    travel.y = 0;
    const speed = travel.length();
    if (speed > 0.2) {
      const cap = leadLimit(tightest);
      travel.multiplyScalar(Math.min(cap, speed * stage.lookAheadPerSpeed) / speed);
    } else {
      travel.set(0, 0, 0);
    }
    travel.multiplyScalar(1 - this.roomWeight);
    this.lead.lerp(travel, 1 - Math.exp(-CAMERA.leadEase * dt));

    const midpoint = sharedFocus.clone().add(this.lead);
    const sharedPos = midpoint.clone().addScaledVector(dir, sharedDist);

    // Szoba-keretezésnél a kamera egy szobáról a másikra ÚSZIK át, nem egy
    // futó játékost követ: ugyanaz a rugó, ami követésnél feszes, itt
    // rándulásnak érződik az ajtóban. Ezért két állandó, a súly szerint keverve.
    const spring = CAMERA.smoothing * (1 - this.roomWeight) + CAMERA.roomSmoothing * this.roomWeight;

    for (let i = 0; i < this.playerCount; i++) {
      const p = players[i].position;
      const room = rooms[i];

      // --- Solo pose ------------------------------------------------------
      const vp = this.viewports[i];
      const cam = this.cameras[i];
      const aspect = vp.h > 0 && vp.w > 0 ? vp.w / vp.h : sharedAspect;

      let focus: THREE.Vector3;
      let soloDist: number;
      if (room) {
        // Saját szoba, saját panel képarányával: egy álló panelben ugyanaz a
        // szoba messzebbről fér csak be, mint egy fekvőben.
        //
        // A SZOBA úszik át lassan egyikről a másikra; a szobán BELÜL a kamera
        // azonnal követi a játékost. Ha a fókuszt magát simítanánk, a két dolog
        // egy rugóra kerülne: vagy az ajtóban csap egyet, vagy a nagy szobában
        // lemarad a futó játékos mögött.
        easeBox(this.soloBox[i], room, this.initialised ? ease : 1);
        soloDist = this.boxDistance(this.soloBox[i], dir, aspect);
        focus = this.framedFocus(this.soloBox[i], p, dir, soloDist, aspect);
      } else {
        this.soloBox[i].makeEmpty();
        focus = p.clone();
        focus.y += CAMERA.focusHeight;
        soloDist = stage.followDistance;
      }
      const soloTarget = focus.add(this.lead);
      const soloPos = soloTarget.clone().addScaledVector(dir, soloDist);

      // Blend. At t=0 every camera collapses onto the shared pose — that is
      // what makes the seam invisible.
      const wantTarget = soloTarget.lerp(midpoint, 1 - t);
      const wantPos = soloPos.lerp(sharedPos, 1 - t);

      if (!this.initialised) {
        this.positions[i].copy(wantPos);
        this.targets[i].copy(wantTarget);
      } else {
        const k = 1 - Math.exp(-spring * dt);
        this.positions[i].lerp(wantPos, k);
        this.targets[i].lerp(wantTarget, k);
      }

      cam.aspect = aspect;
      // The lens belongs to the section, not to the camera object: indoors it
      // is wider and further back so a room fits on screen.
      cam.fov = stage.fov;

      if (this.firstPerson === i) {
        // BELSŐ NÉZET. A kamera a szemben ül, és semmit nem simítunk:
        // egy késleltetett saját fejmozgás pontosan az, amitől a belső
        // nézettől megfájdul az ember feje.
        const eye = p.clone();
        eye.y += FIRST_PERSON.eye;
        const look = new THREE.Vector3(
          Math.sin(stage.yaw) * Math.cos(this.fpPitch),
          Math.sin(this.fpPitch),
          Math.cos(stage.yaw) * Math.cos(this.fpPitch)
        );
        // A saját test ne lógjon a képbe: egy tenyérrel előre.
        eye.addScaledVector(look, FIRST_PERSON.forward);
        // A TÁVCSŐ a látószöget szűkíti — ez maga a nagyítás. A jelenet
        // állítja be, mert csak ő tudja, van-e távcsöves fegyver a kézben.
        cam.fov = this.fpFov || FIRST_PERSON.fov;
        // A vágósík is a nézeté: enélkül a kézben tartott fegyver a sík mögé
        // kerül, és belülről tölti ki a képet.
        cam.near = FIRST_PERSON.near;
        cam.position.copy(eye);
        cam.lookAt(eye.clone().add(look));
        // A simított pózokat is átírjuk, különben nézetváltáskor a kamera
        // átzuhan a szoba túlsó feléből.
        this.positions[i].copy(eye);
        this.targets[i].copy(eye.clone().add(look));
      } else {
        cam.near = CAMERA.near;
        cam.position.copy(this.positions[i]);
        cam.lookAt(this.targets[i]);
      }
      cam.updateProjectionMatrix();

      // A vágás MINDIG él, nem csak osztott képen.
      //
      // Korábban csak `t > 0.999`-nél kapcsolt be, azzal az indokkal, hogy a
      // közös kamera az átmenet alatt két szobát is mutathat. A gyakorlatban
      // ez azt jelentette, hogy az idő nagy részében — amikor a pár együtt
      // van, tehát közös a kép — SEMMI nem volt levágva: a kamera beállt egy
      // ajtó mögé, és a képernyőt egy ajtólap töltötte ki.
      //
      // Ha együtt vannak, ugyanabban a szobában vannak, tehát ugyanazok a
      // síkok jutnak mindkét panelre és nincs varrat. Ha két szobában vannak,
      // az osztást amúgy is kikényszerítjük.
      //
      // Egy címkézetlen cella (küszöb, ajtónyílás) nem ok arra, hogy egy
      // képkockára az egész lakás felvillanjon: olyankor az előzőt tartjuk.
      if (this.framing) {
        const planes = this.framing.clipFor(
          this.soloActive !== null ? players[this.soloActive].position : p
        );
        if (planes.length > 1) this.lastClips[i] = planes;
        this.clips[i] = this.lastClips[i] ?? planes;
      } else {
        this.clips[i] = [];
      }
    }

    this.initialised = true;
  }

  /** Render each active viewport with scissor. Skips zero-area panes. */
  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene): void {
    const previous = renderer.clippingPlanes;
    renderer.setScissorTest(true);
    for (let i = 0; i < this.playerCount; i++) {
      const vp = this.viewports[i];
      if (vp.w < 1 || vp.h < 1) continue;
      renderer.setViewport(vp.x, vp.y, vp.w, vp.h);
      renderer.setScissor(vp.x, vp.y, vp.w, vp.h);
      // Panelenként külön: a bal játékos szobája nem a jobbé.
      renderer.clippingPlanes = this.clips[i];
      renderer.render(scene, this.cameras[i]);
    }
    renderer.clippingPlanes = previous;
    renderer.setScissorTest(false);
  }

  /**
   * Hol legyen a válaszvonal, és melyik panel kié.
   *
   * A geometria dönti el, nem egy beállítás. Ha a két szoba egymás MELLETT
   * van, függőleges a vágás; ha egymás FÖLÖTT, vízszintes — és a paneled azon
   * az oldalon van, amerre a szobád valóban van. Így maga a képernyő mondja
   * meg, merre kell keresned a társadat: a kép a térkép.
   *
   * Beállításból ez nem jöhet: az `O` gomb régi, fix iránya azt eredményezte,
   * hogy a bal oldali szobában lévő játékos panele a képernyő jobb felén
   * landolt, ami pont a rossz irányba tanít.
   *
   * Amíg csak egy szoba van (vagy egyik oldalnak sincs), marad a beállított
   * irány — ott nincs geometria, amit követni lehetne.
   */
  private layoutViewports(width: number, height: number, split: SplitLayout): void {
    const t = this.splitAmount;
    const pixels = Math.round(t * 0.5 * (split.vertical ? width : height));
    // `first` az a játékos, akinek a panele a bal/felső oldalra kerül.
    const first = split.swap ? 1 : 0;
    const second = split.swap ? 0 : 1;

    if (split.vertical) {
      this.viewports[second] = { x: width - pixels, y: 0, w: pixels, h: height };
      this.viewports[first] = { x: 0, y: 0, w: width - pixels, h: height };
    } else {
      this.viewports[second] = { x: 0, y: 0, w: width, h: pixels };
      this.viewports[first] = { x: 0, y: pixels, w: width, h: height - pixels };
    }
  }

  /**
   * A vágás iránya és sorrendje a két szoba egymáshoz képesti helyzetéből.
   *
   * A szobák VILÁG-koordinátában vannak, a képernyő pedig a kamera irányából
   * néz rájuk — ezért a döntést a kamera jobb-vektorára és „felfelé a képen"
   * vektorára vetítve hozzuk meg, nem nyersen x/z-ben. Forgatás (Q) után a
   * vágás iránya vele fordul, ahogy kell.
   */
  private splitLayoutFor(rooms: Array<THREE.Box3 | null>, dir: THREE.Vector3): SplitLayout {
    const fallback: SplitLayout = { vertical: SPLIT.orientation === 'vertical', swap: false };
    if (!rooms[0] || !rooms[1]) return fallback;

    const a = rooms[0].getCenter(new THREE.Vector3());
    const b = rooms[1].getCenter(new THREE.Vector3());
    const between = new THREE.Vector3().subVectors(b, a).setY(0);
    if (between.lengthSq() < 1e-4) return fallback;

    // A kamera jobb-vektora a talajon, és az, ami a képen „fölfelé" mutat.
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3(-dir.x, 0, -dir.z).normalize();

    const sideways = between.dot(right);
    const forward = between.dot(up);

    if (Math.abs(sideways) >= Math.abs(forward)) {
      // A 2. játékos szobája jobbra van: az ő panelje a jobb oldalra.
      return { vertical: true, swap: sideways < 0 };
    }
    // A 2. játékos szobája feljebb van a képen: az ő panelje fölülre.
    return { vertical: false, swap: forward > 0 };
  }

  /**
   * Hova nézzen a kamera, ha egy szobát keretez.
   *
   * A szoba közepe, a szemmagasság fölött egy kevéssel — nem a padló
   * közepe: a padlóra nézve a szoba fele a kép alsó szélére csúszik.
   */
  private roomFocus(box: THREE.Box3): THREE.Vector3 {
    const c = box.getCenter(new THREE.Vector3());
    c.y = box.min.y + CAMERA.focusHeight;
    return c;
  }

  /**
   * Hova nézzen, ha a szoba NEM fér be egyben.
   *
   * A lakás szobái 15×21-től 42×39 egységig terjednek — a legnagyobb maga a
   * lakás fele. Azt egyben bekeretezni 41 egység távolságot kívánna, ahol egy
   * 1,7 egység magas szörny a képmagasság 3,4 százaléka: felismerhetetlen. A
   * távolságot ezért a felismerhetőség fogja meg, és a nagy szobákból egyszerre
   * csak egy darab látszik.
   *
   * Ilyenkor a szoba közepére nézni a legrosszabb, amit tenni lehet: a sarokban
   * álló játékos egyszerűen kicsúszik a képből. A kép ezért a szoba közepétől
   * ANNYIT mozdul a játékos felé, amennyi ahhoz kell, hogy a játékos biztosan a
   * képen legyen — és egy hajszállal se többet. Ahol a szoba befér, ez nulla:
   * a kis szobák állóképe változatlan marad, ami épp a szobánkénti kamera
   * lényege.
   *
   * A keresés felezéssel megy, nem képlettel. Volt képletes változat — a
   * látható félszélesség és -mélység becslése —, és mérhetően rossz volt: a
   * félszélesség a FÓKUSZ mélységében igaz, a kamerához közelebb álló játékosé
   * viszont keskenyebb, és 140 mintából 3 ott csúszott ki. A felezés magát a
   * vetítést kérdezi meg, tehát nem tud tévedni; nyolc lépés bőven elég, és
   * csak akkor fut le, ha a szoba tényleg nem fér be.
   */
  private framedFocus(box: THREE.Box3, p: THREE.Vector3, dir: THREE.Vector3, dist: number, aspect: number): THREE.Vector3 {
    const centre = this.roomFocus(box);
    const ground = new THREE.Vector3(p.x, centre.y, p.z);
    if (this.playerFits(centre, ground, dir, dist, aspect)) return centre;
    if (!this.playerFits(ground, ground, dir, dist, aspect)) return ground;

    let lo = 0;
    let hi = 1;
    const at = new THREE.Vector3();
    for (let k = 0; k < 8; k++) {
      const mid = (lo + hi) * 0.5;
      at.lerpVectors(centre, ground, mid);
      if (this.playerFits(at, ground, dir, dist, aspect)) hi = mid;
      else lo = mid;
    }
    return centre.clone().lerp(ground, hi);
  }

  /** Erről a fókuszpontról nézve biztonságosan a képen van-e a játékos? */
  private playerFits(
    focus: THREE.Vector3,
    player: THREE.Vector3,
    dir: THREE.Vector3,
    dist: number,
    aspect: number
  ): boolean {
    const probe = this.probeCamera;
    probe.fov = stage.fov;
    probe.aspect = aspect;
    probe.near = CAMERA.near;
    probe.far = CAMERA.far;
    probe.position.copy(focus).addScaledVector(dir, dist);
    probe.lookAt(focus);
    probe.updateMatrixWorld(true);
    probe.updateProjectionMatrix();
    // A fejtetőt és a talpat is: a keret SZÉLÉRE szorítva a figura fele már
    // le lenne vágva, ezért a biztonságos doboz szűkebb, mint a képkeret.
    for (const y of [0, MOVE_HEIGHT]) {
      const q = SCRATCH.set(player.x, player.y - CAMERA.focusHeight + y, player.z).project(probe);
      if (Math.abs(q.x) > CAMERA.roomSafeFrame || Math.abs(q.y) > CAMERA.roomSafeFrame || q.z >= 1) return false;
    }
    return true;
  }

  /**
   * Milyen messziről fér bele ez a doboz a képbe.
   *
   * A doboz nyolc sarkát a kamera saját jobb/fel tengelyeire vetítjük, mert
   * a színpad elforgatható (Q): ugyanaz a szoba átlósan nézve szélesebb, és
   * fixen a szoba oldalhosszából számolva kilógna a kép szélén.
   *
   * A falakból csak `roomHeadroom` magasságot veszünk figyelembe. A teljes
   * kilenc egységnyi rajzolt falmagasságot bekeretezni azt jelentené, hogy a
   * kamera egy 17 egységes szobát 26 egységről néz — a szoba fele üres fal
   * lenne a képen.
   */
  private boxDistance(box: THREE.Box3, dir: THREE.Vector3, aspect: number): number {
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const c = this.roomFocus(box);

    const tanV = Math.tan(THREE.MathUtils.degToRad(stage.fov) * 0.5);
    const corner = new THREE.Vector3();
    let need = 0;
    for (const x of [box.min.x, box.max.x]) {
      for (const z of [box.min.z, box.max.z]) {
        for (const y of [box.min.y, box.min.y + CAMERA.roomHeadroom]) {
          corner.set(x, y, z).sub(c);
          // A látótér gúla, nem hasáb: egy KÖZELEBBI sarok kisebb keresztmetszetbe
          // fér bele, mint egy távolabbi. A „félméret / tan" képlet ezt nem tudja —
          // a szoba középpontjára számolva a kamerához közel eső sarkok kilógnak.
          // Mérve: egy 17×17-es szobának így csak a 89 százaléka volt a képen.
          //
          // Sarkonként megoldva: a kamera a c + dir*d ponton áll, a sarok
          // nézetirányú mélysége d − (p−c)·dir, és ebbe kell férnie az oldal- és
          // a függőleges kitérésnek.
          const along = corner.dot(dir);
          const lat = Math.abs(corner.dot(right)) + CAMERA.roomPadding;
          const vert = Math.abs(corner.dot(up)) + CAMERA.roomPadding;
          need = Math.max(need, along + Math.max(vert / tanV, lat / (tanV * aspect)));
        }
      }
    }
    return THREE.MathUtils.clamp(need, stage.minDistance, stage.maxDistance);
  }

  /** Distance needed for both players (plus padding) to fit the frustum. */
  private framingDistance(
    a: THREE.Vector3,
    b: THREE.Vector3,
    dir: THREE.Vector3,
    aspect: number
  ): number {
    const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const sep = new THREE.Vector3().subVectors(b, a);

    const halfW = Math.abs(sep.dot(right)) * 0.5 + CAMERA.framingPadding;
    const halfH = Math.abs(sep.dot(up)) * 0.5 + CAMERA.framingPadding;

    const tanV = Math.tan(THREE.MathUtils.degToRad(stage.fov) * 0.5);
    const distV = halfH / tanV;
    const distH = halfW / (tanV * aspect);

    return THREE.MathUtils.clamp(
      Math.max(distV, distH),
      stage.minDistance,
      stage.maxDistance
    );
  }
}

/**
 * A keretező doboz átúsztatása egyik szobáról a másikra.
 *
 * Az ajtóküszöbön a szoba CELLÁNKÉNT vált: egy képkockával korábban a nappali,
 * egy képkockával később a konyha. A kívánt póz így egyetlen képkocka alatt
 * ugrik akár húsz egységet, és az utána következő pozíciósimítás ezt folytonossá
 * teszi ugyan, de a SEBESSÉGET nem — mérve 2196 egység/s² csúcsgyorsulás, ami a
 * képernyőn csapás. Ha már a keret is átúszik, ugyanez a mérés 100 alatt marad.
 */
/**
 * A keretező doboz simítása egy exponenciális lépéssel.
 *
 * Megjegyzés, mert kipróbáltuk és NEM ez kellett: két ilyen szűrő sorba kötve
 * elvben folytonos sebességet ad, a gyakorlatban viszont ROSSZABB lett
 * (226 → 359 e/s²), mert az ajtóban mért tüske nem innen jött. Az ok az volt,
 * hogy a kamera egy-két képkockára ELEJTETTE a szobát; lásd az update()
 * elején a `lastRoom`-ot.
 */
function easeBox(current: THREE.Box3, want: THREE.Box3, k: number): void {
  if (current.isEmpty()) {
    current.copy(want);
    return;
  }
  current.min.lerp(want.min, k);
  current.max.lerp(want.max, k);
}


/** Ugyanaz a szoba? A befoglaló az azonossága — külön azonosító nem kell hozzá. */
function sameBox(a: THREE.Box3, b: THREE.Box3): boolean {
  return a.min.distanceToSquared(b.min) < 1e-6 && a.max.distanceToSquared(b.max) < 1e-6;
}

/** Unit vector from the focus point toward the camera. Fixed yaw = stable controls. */
function stageDirection(): THREE.Vector3 {
  const pitch = stage.pitch;
  const cp = Math.cos(pitch);
  return new THREE.Vector3(
    Math.sin(stage.yaw) * cp,
    Math.sin(pitch),
    Math.cos(stage.yaw) * cp
  ).normalize();
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}
