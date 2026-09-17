import * as THREE from 'three';
import { HOMEOWNER } from '../core/config';
import type { PlayerController } from '../player/PlayerController';
import type { NoiseSystem } from '../systems/NoiseSystem';
import type { Rig, RigState } from '../render/CharacterRig';

/**
 * Meddig tart az elkapás mozdulata.
 *
 * Nem a klip hossza: a klip a rigben él, és a szabályoknak nem dolguk
 * megnyitni egy animációs fájlt, hogy megtudják. Ennyi az, ameddig az
 * állapotváltás nem szakíthatja félbe — utána a futás úgyis visszaveszi.
 */
const GRAB_TIME = 0.9;

/**
 * Ennyi hiábavaló lépés után szabadítjuk ki.
 *
 * Nem nulla: a falnak feszülés fél másodpercig NORMÁLIS — a lakó megkerüli a
 * kanapét, és közben egy-két képkockán át tényleg nem halad. Másfél másodperc
 * viszont már nem manőver, hanem beszorulás.
 */
const STUCK_LIMIT = 1.5;

/**
 * Meddig hátrál a lakó egy elkapás után.
 *
 * Elég ahhoz, hogy kiszabadulj a sarokból, kevés ahhoz, hogy nyugodtan
 * folytasd a cukorka begyűjtését az orra előtt.
 */
const BACK_OFF_TIME = 2.6;

export type HomeownerState =
  | 'IDLE'
  | 'PATROL'
  | 'SUSPICIOUS'
  | 'INVESTIGATE'
  | 'ALERT'
  | 'CHASE'
  | 'SEARCH'
  | 'RETURN';

/**
 * The homeowner (spec §18). Eight states, one suspicion meter, one flashlight.
 *
 * The design rule underneath all of it: he can only ever be in ONE place. That
 * is what makes two players stronger than one player twice — everything he
 * walks toward is somewhere he is not.
 */
export class Homeowner {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();

  state: HomeownerState = 'PATROL';
  suspicion = 0;
  /** Non-null while he is actively looking at something. */
  lastStimulus: THREE.Vector3 | null = null;
  lastStimulusLabel = '';

  private facing = 0;
  private stateTimer = 0;
  private waypointIndex = 0;
  private sightLostTimer = 0;
  private readonly raycaster = new THREE.Raycaster();
  private readonly cone: THREE.Mesh;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly torch: THREE.SpotLight;
  /** A helyettesítő tok — addig áll ott, amíg a valódi test be nem tölt. */
  private readonly blockout: THREE.Mesh;
  private rig: Rig | null = null;
  /** Milyen gyorsan ment az előző képkockában; a lépésütem ebből jön. */
  private lastSpeed = 0;
  /** Hátralévő idő az elkapás mozdulatából. Amíg fut, az állapot nem írja felül. */
  private grabLeft = 0;

  /**
   * A valódi test és a csontváza, ha megérkezett.
   *
   * A tok addig marad, amíg a modell be nem tölt, és NEM azért, mert
   * kényelmes: a lakó az első pillanattól árnyékot vet és takar, és ha a
   * helye a betöltésig üres lenne, a játékos pont abban a pár másodpercben
   * tanulná meg, hogy oda be lehet menni.
   */
  setArt(art: THREE.Object3D, rig: Rig): void {
    this.group.remove(this.blockout);
    this.blockout.geometry.dispose();
    this.group.add(art);
    this.rig = rig;
  }

  /**
   * Az elkapás mozdulata.
   *
   * Nem állapot, hanem ESEMÉNY, és ez a különbség számít: az állapotokat
   * minden képkockán újraolvassa az `applyTransform`, tehát egy állapotként
   * kezelt elkapás a következő képkockán már felül is íródna a futással. Egy
   * visszaszámláló viszont kitartja, amíg végigmegy.
   *
   * A szabályok hívják, ott, ahol az elkapás TÉNYLEGESEN megtörténik — nem a
   * lakó találgatja a távolságból, mert akkor kétszer dőlne el ugyanaz.
   */
  playCatch(): void {
    this.grabLeft = GRAB_TIME;
    this.rig?.play('grab', 0.08);
    // HÁTRALÉP az elkapás után.
    //
    // Enélkül a lakó rajtad marad: falhoz szorítva a lökés visszatol a falba,
    // ő egy lépésre van, és a következő pillanatban újra elkap. A játékos
    // ilyenkor nem tud mit tenni — nem nehéz helyzet, hanem befagyott játék.
    //
    // Az elkapás ÁRA már megvolt (a cukorka); a folytatásnak esélyt kell
    // adnia. Ezért a lakó pár másodpercre ELHÁTRÁL, és csak utána vesz újra
    // üldözőbe.
    this.backOff = BACK_OFF_TIME;
  }

  /** Amíg fut, a lakó HÁTRÁL, nem közelít. */
  private backOff = 0;

  /**
   * Épp lábadozik-e egy elkapás után.
   *
   * A szabályok ezt nézik, nem a távolságot. A hátrálás ugyanis SAROKBAN
   * nem tud elmozdulni — épp abban a helyzetben, amiért kitaláltuk. A
   * kiszabadulást tehát nem a lépés garantálja, hanem az, hogy ezalatt NEM
   * KAP EL újra, akkor sem, ha egymáson állnak.
   */
  get recovering(): boolean {
    return this.backOff > 0;
  }

  /**
   * Melyik mozgás illik ehhez az állapothoz.
   *
   * Nem díszítés: a lakó szándéka eddig KIZÁRÓLAG a zseblámpából volt
   * olvasható, és a lámpa csak azt mondja meg, merre néz — azt nem, hogy
   * gyanakszik-e. A testtartás ezt a hiányzó felet mondja el, méghozzá
   * perifériásan is: a guggoló settenkedést akkor is észreveszed, amikor épp
   * a saját szörnyedet nézed.
   */
  private static motionFor(state: HomeownerState): RigState {
    switch (state) {
      case 'CHASE':
      case 'ALERT':
        return 'run';
      case 'SUSPICIOUS':
      case 'INVESTIGATE':
      case 'SEARCH':
        return 'sneak';
      case 'IDLE':
        return 'idle';
      default:
        return 'walk';
    }
  }

  /**
   * Optional fast line-of-sight test. When a world supplies one it is used
   * instead of raycasting the scene.
   */
  sightBlocked: ((from: THREE.Vector3, to: THREE.Vector3) => boolean) | null = null;

  /**
   * Járható-e ott a padló? A világ adja meg.
   *
   * Enélkül a lakó ÁTMEGY A FALAKON — és ment is: a járőrözés egyenesen a
   * célpont felé lépkedett, ütközésvizsgálat nélkül. A játékosnak volt
   * ütközése, a lakónak nem, és ez pont a stealth-játék ígéretét vonta
   * vissza: hiába kerülöd meg a falon át, ha ő nem kerüli meg.
   */
  walkable: ((x: number, z: number, radius: number) => boolean) | null = null;

  /**
   * Kiszabadítás, ha beszorult.
   *
   * A fal menti csúszás egy SAROKBAN nem működik: ott mindhárom irány zárva
   * van, a lakó megáll, és mivel a járőr-állapotot csak a megérkezés zárja
   * le, ott is marad — a játék egyik fogója egyszerűen kiesik az estéből.
   * Ilyenkor a világ megmondja, hol a legközelebbi pont, ahol elfér.
   */
  rescue: ((from: THREE.Vector3, toward: THREE.Vector3, radius: number) => THREE.Vector3) | null = null;

  /**
   * Útvonal a célig, falakat megkerülve.
   *
   * Enélkül a lakó egyenesen nekiindult a célnak, és minden ajtófélfánál
   * megállt — mérve hatvan másodperc alatt huszonegy egység egy hatvannyolc
   * egység széles házban. A fal menti csúszás egy szobából álló térben elég;
   * egy hétszobás lakásban nem.
   */
  findRoute: ((from: THREE.Vector3, to: THREE.Vector3, radius: number) => THREE.Vector3[]) | null = null;

  private path: THREE.Vector3[] = [];
  private pathGoal: THREE.Vector3 | null = null;

  /** Mennyi ideje próbál menni anélkül, hogy haladna. */
  private stuckFor = 0;

  constructor(
    spawn: THREE.Vector3,
    private readonly waypoints: THREE.Vector3[],
    private readonly occluders: THREE.Mesh[]
  ) {
    this.position.copy(spawn);

    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x5d6b8c, roughness: 0.75 });
    // A TOK MÉRETE a lakóból számol, nem beírt számokból.
    //
    // Beírva `CapsuleGeometry(3.4, height - 6.8)` állt itt, ami egy régebbi,
    // magasabb lakóhoz készült. A mostani 6,4-es magassággal a kapszula
    // HOSSZA −0,4 lett — vagyis nem emberke, hanem egy 6,8 egység átmérőjű
    // sápadt GÖMB, ami közelről az egész képet betölti. Pont ez volt „a nagy
    // fehér".
    //
    // A sugár a szélességből jön, a hengeres rész a maradék magasságból, és
    // az utóbbi sosem lehet negatív.
    const radius = HOMEOWNER.width * 0.5;
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(radius, Math.max(0.2, HOMEOWNER.height - radius * 2), 6, 16),
      this.bodyMat
    );
    body.position.y = HOMEOWNER.height / 2;
    body.castShadow = true;
    this.group.add(body);
    this.blockout = body;

    // The flashlight cone is the AI's state made visible — the players read his
    // mind entirely through where this thing points.
    // A RAJZOLT kúp rövidebb a valódi látótávnál. Nem csalás: a teljes
    // hosszban kirajzolva egy huszonhárom egység hosszú, huszonhat széles
    // test áll a szobában, ami magát a szobát takarja el. A rövidebb kúp
    // ugyanazt az irányt mondja el, és látni is hagyja, amiről szól.
    const drawn = HOMEOWNER.viewRange * 0.62;
    const geo = new THREE.ConeGeometry(
      Math.tan(HOMEOWNER.viewHalfAngle) * drawn,
      drawn,
      24,
      1,
      true
    );
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, 0, drawn / 2);
    this.cone = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({
        color: 0xffe9a8,
        transparent: true,
        opacity: 0.1,
        side: THREE.DoubleSide,
        depthWrite: false,
        // ÖSSZEADÓ keverés: a fény hozzáad, nem eltakar.
        //
        // Egyszerű átlátszósággal a kúp FESTÉK volt — egy húsz egység széles
        // fehér folt a szoba előtt, ami a bútort is elfedte, és mivel a
        // kamera lebontja a közelebbi falat, semmi nem takarta ki. Így viszont
        // a sötét padlón felfénylik, a világos falon pedig alig látszik, ami
        // pont az, amit egy lámpakúptól vársz.
        blending: THREE.AdditiveBlending,
      })
    );
    // Sosem takar ki mást: a fénykúp mögötti bútornak látszania kell.
    this.cone.renderOrder = 2;
    // ...és NINCS KÖRVONALA. A körvonal egy kifordított, tömör héj a test
    // köré — egy húsz egység széles fénykúp köré húzva az egész szobát
    // betöltő sápadt tömb lesz belőle. Ez volt a „nagy fehér".
    this.cone.userData.cpNoOutline = true;
    this.cone.position.y = HOMEOWNER.height * 0.62;
    this.group.add(this.cone);

    this.torch = new THREE.SpotLight(0xfff0c4, 900, HOMEOWNER.viewRange * 1.1, HOMEOWNER.viewHalfAngle, 0.45, 1.4);
    this.torch.position.set(0, HOMEOWNER.height * 0.62, 0);
    this.group.add(this.torch);
    this.group.add(this.torch.target);

    this.group.position.copy(this.position);
  }

  /** Where he is heading right now, for the navigator UI and debugging. */
  get destination(): THREE.Vector3 | null {
    if (this.state === 'PATROL' || this.state === 'RETURN') return this.waypoints[this.waypointIndex];
    return this.lastStimulus;
  }

  update(dt: number, players: PlayerController[], noise: NoiseSystem): void {
    this.stateTimer -= dt;

    // A HÁTRÁLÁS mindent felülír: amíg tart, nem közelít senkihez.
    if (this.backOff > 0) {
      this.backOff -= dt;
      const from = players.length
        ? players.reduce((a, b) =>
            this.position.distanceTo(a.position) < this.position.distanceTo(b.position) ? a : b
          ).position
        : null;
      if (from) {
        const away = new THREE.Vector3(
          this.position.x - from.x,
          0,
          this.position.z - from.z
        );
        // Ha PONTOSAN egymáson állnak, nincs „elfelé" irány — ilyenkor a
        // saját hátába lép. Enélkül a hátrálás épp abban az esetben nem
        // csinál semmit, amiért kitaláltuk.
        if (away.lengthSq() < 1e-4) away.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
        away.normalize();
        this.step(away, HOMEOWNER.walkSpeed * dt);
      }
      this.applyTransform(dt);
      return;
    }

    const visible = players.filter((p) => this.canSee(p));
    const heard = noise.heardAt(this.position);

    // --- Suspicion, independent of state: it is the input, not the output. ---
    if (visible.length > 0) {
      const nearest = visible.reduce((a, b) =>
        this.position.distanceTo(a.position) < this.position.distanceTo(b.position) ? a : b
      );
      const closeness = 1 - this.position.distanceTo(nearest.position) / HOMEOWNER.viewRange;
      this.suspicion = Math.min(1, this.suspicion + HOMEOWNER.suspicionRise * (0.45 + closeness) * dt);
      this.lastStimulus = nearest.position.clone();
      this.lastStimulusLabel = `P${nearest.index + 1}`;
      this.sightLostTimer = HOMEOWNER.loseSightTime;
    } else {
      this.suspicion = Math.max(0, this.suspicion - HOMEOWNER.suspicionFall * dt);
      this.sightLostTimer -= dt;
    }

    if (heard && this.state !== 'CHASE' && this.state !== 'ALERT') {
      this.lastStimulus = heard.position.clone();
      this.lastStimulusLabel = heard.source;
      this.suspicion = Math.max(this.suspicion, 0.45);
      this.enter('SUSPICIOUS', 0.6);
    }

    this.tick(dt);
    this.applyTransform(dt);
  }

  private tick(dt: number): void {
    switch (this.state) {
      case 'IDLE':
        if (this.suspicion >= 1) return this.enter('ALERT', HOMEOWNER.alertTime);
        if (this.suspicion > 0.35) return this.enter('SUSPICIOUS', 0.8);
        if (this.stateTimer <= 0) this.enter('PATROL');
        break;

      case 'PATROL':
      case 'RETURN': {
        if (this.suspicion >= 1) return this.enter('ALERT', HOMEOWNER.alertTime);
        if (this.suspicion > 0.35) return this.enter('SUSPICIOUS', 0.8);
        const wp = this.waypoints[this.waypointIndex];
        if (this.walkToward(wp, HOMEOWNER.walkSpeed, dt)) {
          this.waypointIndex = (this.waypointIndex + 1) % this.waypoints.length;
          this.enter('IDLE', HOMEOWNER.idleTime);
        }
        break;
      }

      case 'SUSPICIOUS':
        // Stops and turns toward it. Standing still is the tell players read.
        if (this.lastStimulus) this.turnToward(this.lastStimulus, dt);
        if (this.suspicion >= 1) return this.enter('ALERT', HOMEOWNER.alertTime);
        if (this.stateTimer <= 0) this.enter('INVESTIGATE', this.travelBudget());
        break;

      case 'INVESTIGATE':
        if (this.suspicion >= 1) return this.enter('ALERT', HOMEOWNER.alertTime);
        if (!this.lastStimulus) return this.enter('RETURN');
        if (this.walkToward(this.lastStimulus, HOMEOWNER.walkSpeed * 1.15, dt) || this.stateTimer <= 0) {
          this.enter('SEARCH', HOMEOWNER.searchTime);
        }
        break;

      case 'ALERT':
        // A beat of pure comedy: he freezes, then commits.
        if (this.stateTimer <= 0) this.enter('CHASE');
        break;

      case 'CHASE':
        if (!this.lastStimulus) return this.enter('SEARCH', HOMEOWNER.searchTime);
        this.walkToward(this.lastStimulus, HOMEOWNER.chaseSpeed, dt);
        if (this.sightLostTimer <= 0) this.enter('SEARCH', HOMEOWNER.searchTime);
        break;

      case 'SEARCH':
        // Sweeps the torch around the last known spot.
        this.facing += dt * 1.5;
        if (this.suspicion >= 1) return this.enter('ALERT', HOMEOWNER.alertTime);
        if (this.stateTimer <= 0) {
          this.lastStimulus = null;
          this.enter('RETURN');
        }
        break;
    }
  }

  private enter(state: HomeownerState, timer = 0): void {
    this.state = state;
    this.stateTimer = timer;
  }

  /**
   * How long he is willing to walk toward a noise. A flat timer looks fine
   * until the prank is on the far side of the kitchen: he then turns back
   * halfway and the distraction buys the other player nothing. The budget is
   * the actual travel time, so a prank always moves him to where it happened.
   */
  private travelBudget(): number {
    if (!this.lastStimulus) return HOMEOWNER.investigateTime;
    const dist = this.position.distanceTo(this.lastStimulus);
    return THREE.MathUtils.clamp(
      (dist / (HOMEOWNER.walkSpeed * 1.15)) * 1.25,
      HOMEOWNER.investigateTime,
      HOMEOWNER.maxInvestigateTime
    );
  }

  /** Returns true on arrival. */
  private walkToward(target: THREE.Vector3, speed: number, dt: number): boolean {
    const flat = new THREE.Vector3(target.x - this.position.x, 0, target.z - this.position.z);
    const dist = flat.length();
    if (dist < 3) return true;

    // Az útvonal a VÉGSŐ célhoz tartozik; ha az elmozdult, újratervezünk.
    // Nem képkockánként: a keresés olcsó, de nem ingyen, és egy üldözés
    // közben amúgy is minden fél másodpercben új a cél.
    if (this.findRoute && (!this.pathGoal || this.pathGoal.distanceTo(target) > 6)) {
      this.path = this.findRoute(this.position, target, HOMEOWNER.width * 0.5);
      this.pathGoal = target.clone();
    }
    // A következő szakasz felé megyünk, nem a célra. A már elért pontokat
    // eldobjuk — így az út magától fogy el a lába alatt.
    while (this.path.length > 0 && this.position.distanceTo(this.path[0]) < 2.5) this.path.shift();
    const leg = this.path.length > 0 ? this.path[0] : target;
    flat.set(leg.x - this.position.x, 0, leg.z - this.position.z);
    this.turnToward(target, dt);
    flat.normalize();
    // A beszorulás MÉRT, nem sejtett: akkor számol, ha ténylegesen lépni
    // akart, és egyik irányban sem sikerült.
    if (this.step(flat, speed * dt)) this.stuckFor = 0;
    else this.stuckFor += dt;

    if (this.stuckFor > STUCK_LIMIT) {
      this.stuckFor = 0;
      // Előbb a szelídebb megoldás: más cél, hátha onnan van kiút.
      this.waypointIndex = (this.waypointIndex + 1) % Math.max(1, this.waypoints.length);
      this.lastStimulus = null;
      this.path = [];
      this.pathGoal = null;
      // Ha a világ tud jobb helyet, oda tesszük. Ez nem falon átsétálás: a
      // legközelebbi pont, ahol a teste ELFÉR — általában fél méterre.
      if (this.rescue) this.position.copy(this.rescue(this.position, target, HOMEOWNER.width * 0.5));
    }
    return false;
  }

  /**
   * Egy lépés, falakat kerülve.
   *
   * Ha az egyenes út zárva, megpróbál CSAK X-ben vagy CSAK Z-ben lépni —
   * ettől csúszik el a fal mentén ahelyett, hogy nekifeszülne. Ez a
   * legolcsóbb megoldás, ami nem igényel útkeresést, és egy szobákra osztott
   * lakásban elég: a lakó célpontjai amúgy is ugyanabban a járható térben
   * vannak, csak épp nem egyenes vonalban.
   *
   * Ha mindhárom irány zárva, marad a helyén — nem tolakszik bele a falba.
   */
  private step(direction: THREE.Vector3, distance: number): boolean {
    const radius = HOMEOWNER.width * 0.5;
    if (!this.walkable) {
      this.position.addScaledVector(direction, distance);
      return true;
    }

    const tryMove = (dx: number, dz: number): boolean => {
      const x = this.position.x + dx;
      const z = this.position.z + dz;
      if (!this.walkable!(x, z, radius)) return false;
      this.position.x = x;
      this.position.z = z;
      return true;
    };

    const dx = direction.x * distance;
    const dz = direction.z * distance;
    if (tryMove(dx, dz)) return true;
    // Csak vízszintesen, majd csak mélységben: a fal mentén csúszás.
    if (Math.abs(dx) > Math.abs(dz)) {
      if (tryMove(dx, 0)) return true;
      return tryMove(0, dz);
    }
    if (tryMove(0, dz)) return true;
    return tryMove(dx, 0);
  }

  private turnToward(target: THREE.Vector3, dt: number): void {
    const want = Math.atan2(target.x - this.position.x, target.z - this.position.z);
    let d = ((want - this.facing + Math.PI) % (Math.PI * 2)) - Math.PI;
    if (d < -Math.PI) d += Math.PI * 2;
    this.facing += THREE.MathUtils.clamp(d, -HOMEOWNER.turnSpeed * dt, HOMEOWNER.turnSpeed * dt);
  }

  /** Cone test, then peripheral test, then a line-of-sight ray. */
  canSee(player: PlayerController): boolean {
    const eye = this.position.clone().setY(HOMEOWNER.height * 0.62);
    const target = player.position.clone().setY(1.2);
    const to = new THREE.Vector3().subVectors(target, eye);
    const dist = to.length();
    if (dist > HOMEOWNER.viewRange) return false;

    const forward = new THREE.Vector3(Math.sin(this.facing), 0, Math.cos(this.facing));
    const flatTo = new THREE.Vector3(to.x, 0, to.z).normalize();
    const inCone = flatTo.dot(forward) > Math.cos(HOMEOWNER.viewHalfAngle);
    if (!inCone && dist > HOMEOWNER.peripheralRadius) return false;

    // A world that can answer "is there anything between these two points"
    // faster than a raycast gets to. The flat is one 200k-triangle mesh, and
    // three.js tests every triangle: asking it twice a frame costs more than
    // the rest of the scene together. A grid walk answers the same question in
    // a few dozen array lookups.
    if (this.sightBlocked) {
      return !this.sightBlocked(eye, target);
    }

    this.raycaster.set(eye, to.clone().normalize());
    this.raycaster.far = dist - 1;
    return this.raycaster.intersectObjects(this.occluders, false).length === 0;
  }

  private applyTransform(dt: number): void {
    const moved = this.group.position.distanceTo(this.position);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    if (this.rig) {
      this.grabLeft = Math.max(0, this.grabLeft - dt);
      // A lépésütem a VALÓDI haladásból jön, nem az állapotból: ugyanaz a
      // járóklip visz járőrözéskor és falnak szorulva is, és ha ilyenkor
      // tovább lépkedne a helyben álló test, az csúszásnak látszana.
      const speed = dt > 0 ? moved / dt : 0;
      this.lastSpeed += (speed - this.lastSpeed) * (1 - Math.exp(-9 * dt));
      this.rig.setSpeedScale(
        THREE.MathUtils.clamp(this.lastSpeed / HOMEOWNER.walkSpeed, 0.35, 2.2)
      );
      if (this.grabLeft <= 0) this.rig.play(Homeowner.motionFor(this.state));
      this.rig.update(dt);
    }

    const alerted = this.state === 'CHASE' || this.state === 'ALERT';
    const curious = this.state === 'SUSPICIOUS' || this.state === 'INVESTIGATE' || this.state === 'SEARCH';
    const color = alerted ? 0xff5a5a : curious ? 0xffc46b : 0x5d6b8c;
    this.bodyMat.color.lerp(new THREE.Color(color), 1 - Math.exp(-8 * dt));

    const coneMat = this.cone.material as THREE.MeshBasicMaterial;
    coneMat.color.lerp(new THREE.Color(alerted ? 0xff7a7a : 0xffe9a8), 1 - Math.exp(-8 * dt));
    // Halványabb, mint volt: összeadó keverésnél ugyanaz a szám sokkal
    // erősebben látszik.
    coneMat.opacity = 0.05 + this.suspicion * 0.09;

    this.torch.target.position.set(0, HOMEOWNER.height * 0.5, HOMEOWNER.viewRange);
    this.torch.color.lerp(new THREE.Color(alerted ? 0xffb0b0 : 0xfff0c4), 1 - Math.exp(-8 * dt));
  }
}
