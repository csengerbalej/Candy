import * as THREE from 'three';
import { DOG } from '../core/config';
import type { NoiseSystem } from '../systems/NoiseSystem';
import { sound } from '../audio/Sound';
import type { Rig } from '../render/CharacterRig';

export type DogState = 'SLEEP' | 'ROAM' | 'ALERT' | 'HUNT' | 'SNIFF' | 'RETURN' | 'SCENT';

/**
 * A ház kutyája.
 *
 * Egyetlen érzékszerve a füle. Nem lát, nincs lámpakúpja, a falon át is
 * meghallod — cserébe csak arra reagál, amit CSINÁLSZ. A lakó elől bújni
 * kell, a kutya elől megállni; ettől ugyanaz a szoba két ellentétes játékot
 * kíván, ha mindkettő bent van.
 *
 * A legfontosabb viselkedése nem a harapás, hanem az UGATÁS: ha odaér a
 * zajhoz és nem talál ott senkit, ugat egyet, ami maga is zajesemény — a
 * lakónak. A kutya így nem egy második üldöző, hanem egy RIASZTÓ, amit a
 * lakó hall meg.
 */
export class Dog {
  readonly group = new THREE.Group();
  readonly position = new THREE.Vector3();
  state: DogState = 'SLEEP';

  /** Ahova hazamegy: a kennel. */
  readonly home = new THREE.Vector3();

  /** A falak; ugyanaz a visszahívás, mint a lakónál. */
  walkable: ((x: number, z: number, radius: number) => boolean) | null = null;

  /** Kiszabadítás sarokból — ugyanaz, mint a lakónál. */
  rescue: ((from: THREE.Vector3, toward: THREE.Vector3, radius: number) => THREE.Vector3) | null = null;

  /** Útvonal a célig, falakat megkerülve — ugyanaz, mint a lakónál. */
  findRoute: ((from: THREE.Vector3, to: THREE.Vector3, radius: number) => THREE.Vector3[]) | null = null;

  private path: THREE.Vector3[] = [];
  private pathGoal: THREE.Vector3 | null = null;

  /**
   * Ahova csendben kóborol.
   *
   * A kutya eddig CSAK zajra mozdult, és mivel a séta néma, egy óvatos
   * játékos mellett egész este mozdulatlanul ült — ami nem „jól lopakodtál",
   * hanem „elromlott". Egy kutya járkál: körbejárja a házat, és ettől az is
   * számít, hogy ÉPPEN hol van, nem csak az, hogy hallott-e.
   */
  readonly roam: THREE.Vector3[] = [];

  private roamIndex = 0;
  private stuckFor = 0;

  /** A szagnyom: hol jártak a szörnyek, késleltetve. */
  private readonly trail: { at: THREE.Vector3; t: number }[] = [];
  private clock = 0;
  private scentTimer = DOG.scentEvery;
  /** Mennyi ideje hallott utoljára valamit. */
  private heardRecently = 0;

  private facing = 0;
  private stateTimer = 0;
  private barkLeft = 0;
  private lastHeard: THREE.Vector3 | null = null;
  private lastSpeed = 0;
  private biteLeft = 0;
  private rig: Rig | null = null;
  private readonly blockout: THREE.Mesh;
  private readonly bodyMat: THREE.MeshStandardMaterial;

  constructor(spawn: THREE.Vector3) {
    this.position.copy(spawn);
    this.home.copy(spawn);

    // Tok, amíg a modell betölt — a lakónál is ezért van: a helye az első
    // pillanattól foglalt legyen, különben pont ott tanulnád meg, hogy oda be
    // lehet menni.
    this.bodyMat = new THREE.MeshStandardMaterial({ color: 0x4a3b32, roughness: 0.85 });
    // Doboz, nem kapszula.
    //
    // A fektetett kapszula MÉRETE nem az volt, aminek látszania kellett: a
    // kutya 3,2 magas, a fekvő kapszula viszont csak 1,9 — a hossza ment
    // felfelé helyett előre. Egy tok, ami más méretű, mint amit helyettesít,
    // pont a betöltés előtti pillanatokban hazudik a játékosnak.
    //
    // A négylábú arányai: a hossza a marmagasság 1,6-szerese.
    this.blockout = new THREE.Mesh(
      new THREE.BoxGeometry(DOG.width, DOG.height, DOG.height * 1.6),
      this.bodyMat
    );
    this.blockout.position.y = DOG.height * 0.5;
    this.blockout.castShadow = true;
    this.group.add(this.blockout);
    this.group.position.copy(this.position);
  }

  setArt(art: THREE.Object3D, rig: Rig): void {
    this.group.remove(this.blockout);
    this.blockout.geometry.dispose();
    this.group.add(art);
    this.rig = rig;
  }

  /**
   * MEGTALÁLT — és ugat, ahelyett hogy harapna.
   *
   * A kutya nem fogó, hanem RIASZTÓ. Egy második üldöző, ami maga is elkap,
   * csak egy gyorsabb lakó lenne; egy kutya, ami megtalál és kiabál, új
   * helyzet — mert a büntetés nem azonnal jön, hanem közeledik, és van pár
   * másodperced eltűnni, mielőtt a gazdája ideér.
   */
  found(noise: NoiseSystem): void {
    this.biteLeft = 0.8;
    this.rig?.play('grab', 0.08);
    this.bark(noise);
    // ...és HÁTRÁL, ahogy a lakó is. Egy kutya, ami rajtad marad, falhoz
    // szorítva befagyasztja a játékot: nem tudsz elmozdulni, ő meg
    // másodpercenként újra beárul.
    this.backOff = 3.2;
  }

  /** Amíg fut, a kutya hátrál, nem közelít. */
  private backOff = 0;

  /** Hova tart most — a navigátor képernyőjének. */
  get destination(): THREE.Vector3 | null {
    if (this.state === 'RETURN' || this.state === 'SLEEP') return this.home;
    return this.lastHeard;
  }

  /**
   * @param players Hol vannak a szörnyek — a SZAGNYOMHOZ, nem a látáshoz.
   *
   * A kutya nem tudja, hol vagy. Csak azt, merre jártál pár másodperce, és
   * ezt is csak időnként kapja el. Ettől lesz kereső, nem mindentudó.
   */
  update(dt: number, noise: NoiseSystem, players: THREE.Vector3[] = []): void {
    this.stateTimer -= dt;
    this.clock += dt;

    if (this.backOff > 0) {
      this.backOff -= dt;
      const from = players[0];
      if (from) {
        const away = new THREE.Vector3(this.position.x - from.x, 0, this.position.z - from.z);
        if (away.lengthSq() < 1e-4) away.set(-Math.sin(this.facing), 0, -Math.cos(this.facing));
        away.normalize();
        this.step(away, DOG.walkSpeed * dt);
      }
      this.applyTransform(dt);
      return;
    }

    // A nyom rögzítése. Fél másodpercenként elég: a régi pontokat eldobjuk.
    if (players.length && this.trail.length === 0) {
      this.trail.push({ at: players[0].clone(), t: this.clock });
    } else if (players.length && this.clock - this.trail[this.trail.length - 1].t > 0.5) {
      this.trail.push({ at: players[0].clone(), t: this.clock });
      while (this.trail.length > 40) this.trail.shift();
    }
    this.barkLeft = Math.max(0, this.barkLeft - dt);
    this.heardRecently = Math.max(0, this.heardRecently - dt);

    // --- A hallás. Ez az EGYETLEN bemenete. -------------------------------
    // A NoiseSystem a saját sugarával dönt; a kutya jobb fülét úgy kapjuk
    // meg, hogy a saját helyét közelebb hazudjuk a zajhoz. Ez pontosan
    // ugyanaz, mintha a sugarat szoroznánk, de nem kell a közös rendszerhez
    // nyúlni egyetlen hallgató kedvéért.
    let heard: { position: THREE.Vector3; radius: number } | null = null;
    for (const e of noise.events) {
      if (this.position.distanceTo(e.position) > e.radius * DOG.hearing) continue;
      if (!heard || e.radius > heard.radius) heard = e;
    }
    if (heard) {
      this.lastHeard = heard.position.clone();
      // Akármit csinál épp: egy új zaj felülírja. A kutya nem tervez.
      if (this.state === 'SLEEP' || this.state === 'RETURN' || this.state === 'ROAM' || this.state === 'SCENT')
        this.enter('ALERT', DOG.alertTime);
      // SNIFF-ből vissza vadászatra — de a HUNT csak akkor vált SNIFF-re, ha
      // már NEM hall semmit. Enélkül a kutya a zaj mellett állva
      // szimat–vadászat–szimat körbe esett, és 45 másodpercből 24-et
      // szimatolással töltött ahelyett, hogy üldözött volna.
      else if (this.state === 'SNIFF') this.enter('HUNT', DOG.huntTime);
      else if (this.state === 'HUNT') this.stateTimer = DOG.huntTime;
      this.heardRecently = 1.2;
    }

    // SZAGOT FOG. Csak nyugodt állapotból: ami hangosabb, az fontosabb.
    this.scentTimer -= dt;
    if (this.scentTimer <= 0 && (this.state === 'ROAM' || this.state === 'SLEEP' || this.state === 'RETURN')) {
      this.scentTimer = DOG.scentEvery;
      const want = this.clock - DOG.scentAge;
      const mark = this.trail.find((m) => m.t >= want) ?? this.trail[this.trail.length - 1];
      if (mark) {
        this.lastHeard = mark.at.clone();
        this.enter('SCENT', DOG.huntTime);
      }
    }

    switch (this.state) {
      case 'SCENT': {
        // Ugyanaz, mint a vadászat, csak lassabb: a szag nem sürget úgy,
        // mint egy csattanás. És a végén szimatol egyet, ahogy kell.
        const spot = this.lastHeard ?? this.home;
        if (this.walkToward(spot, DOG.chaseSpeed * 0.72, dt) || this.stateTimer <= 0) {
          this.enter('SNIFF', DOG.sniffTime);
        }
        break;
      }

      case 'SLEEP':
        // Szunyókál a kennelben, aztán körbejár. Nem őrszem: a kóborlás
        // lassú, és a saját zaját nem hallja meg.
        if (this.position.distanceTo(this.home) > 2) this.enter('RETURN');
        else if (this.stateTimer <= 0) this.enter('ROAM');
        break;

      case 'ROAM': {
        if (this.roam.length === 0) { this.enter('SLEEP', DOG.napTime); break; }
        const spot = this.roam[this.roamIndex % this.roam.length];
        if (this.walkToward(spot, DOG.walkSpeed, dt)) {
          this.roamIndex++;
          // Minden második pont után visszatér aludni: így a kennel marad a
          // horgony, és kiszámítható, hol lesz.
          if (this.roamIndex % 2 === 0) this.enter('RETURN');
        }
        break;
      }

      case 'ALERT':
        // Feláll, fülel. Ez a fél másodperc a játékosé: ennyi ideje van
        // megállni, mielőtt a kutya megindul.
        if (this.lastHeard) this.turnToward(this.lastHeard, dt);
        if (this.stateTimer <= 0) this.enter('HUNT', DOG.huntTime);
        break;

      case 'HUNT': {
        const target = this.lastHeard ?? this.home;
        const arrived = this.walkToward(target, DOG.chaseSpeed, dt);
        if ((arrived && this.heardRecently <= 0) || this.stateTimer <= 0) {
          this.enter('SNIFF', DOG.sniffTime);
        }
        break;
      }

      case 'SNIFF':
        // Megérkezett, és nincs itt senki. Ugat — és EZZEL hívja a lakót.
        if (this.barkLeft <= 0) this.bark(noise);
        if (this.stateTimer <= 0) this.enter('RETURN');
        break;

      case 'RETURN':
        if (this.walkToward(this.home, DOG.walkSpeed, dt)) this.enter('SLEEP', DOG.napTime);
        break;
    }

    this.applyTransform(dt);
  }

  /**
   * Az ugatás.
   *
   * Zajesemény a saját helyén, a csínynél is nagyobb sugárral. Nem hallja
   * vissza saját maga: a `bark` utáni türelmi idő pont ezért van, különben a
   * kutya a saját ugatására indulna tovább, és soha nem menne haza.
   */
  private bark(noise: NoiseSystem): void {
    this.barkLeft = DOG.barkCooldown;
    noise.emit(this.position, DOG.barkRadius, 'kutya');
    this.rig?.play('grab', 0.1);
    sound.thud(0.5);
  }

  private enter(state: DogState, timer = 0): void {
    this.state = state;
    this.stateTimer = timer;
  }

  /** Igaz, ha megérkezett. */
  private walkToward(target: THREE.Vector3, speed: number, dt: number): boolean {
    const flat = new THREE.Vector3(target.x - this.position.x, 0, target.z - this.position.z);
    const dist = flat.length();
    if (dist < 2.2) return true;

    if (this.findRoute && (!this.pathGoal || this.pathGoal.distanceTo(target) > 6)) {
      this.path = this.findRoute(this.position, target, DOG.width * 0.5);
      this.pathGoal = target.clone();
    }
    while (this.path.length > 0 && this.position.distanceTo(this.path[0]) < 2) this.path.shift();
    const leg = this.path.length > 0 ? this.path[0] : target;
    flat.set(leg.x - this.position.x, 0, leg.z - this.position.z);
    this.turnToward(leg, dt);
    flat.normalize();
    if (this.step(flat, speed * dt)) this.stuckFor = 0;
    else this.stuckFor += dt;

    if (this.stuckFor > 1.5) {
      this.stuckFor = 0;
      this.roamIndex++;
      this.path = [];
      this.pathGoal = null;
      if (this.rescue) this.position.copy(this.rescue(this.position, target, DOG.width * 0.5));
    }
    return false;
  }

  /** Egy lépés, fal mentén csúszva — ugyanaz a megoldás, mint a lakónál. */
  private step(direction: THREE.Vector3, distance: number): boolean {
    const radius = DOG.width * 0.5;
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
    this.facing += THREE.MathUtils.clamp(d, -DOG.turnSpeed * dt, DOG.turnSpeed * dt);
  }

  private applyTransform(dt: number): void {
    const moved = this.group.position.distanceTo(this.position);
    this.group.position.copy(this.position);
    this.group.rotation.y = this.facing;

    if (this.rig) {
      this.biteLeft = Math.max(0, this.biteLeft - dt);
      const speed = dt > 0 ? moved / dt : 0;
      this.lastSpeed += (speed - this.lastSpeed) * (1 - Math.exp(-9 * dt));
      // A kutya egyetlen klipet hozott, egy járást. A tempóját a VALÓDI
      // haladás adja, így ugyanaz a klip visz lopakodó hazasétálást és
      // rohanást is — csak gyorsabban pörög.
      this.rig.setSpeedScale(THREE.MathUtils.clamp(this.lastSpeed / DOG.walkSpeed, 0.3, 3.2));
      if (this.biteLeft <= 0) this.rig.play(this.state === 'SLEEP' ? 'idle' : 'walk');
      this.rig.update(dt);
    }

    const hot = this.state === 'HUNT' || this.state === 'ALERT';
    this.bodyMat.color.lerp(
      new THREE.Color(hot ? 0xc25a3a : this.state === 'SNIFF' ? 0xb08a4a : 0x4a3b32),
      1 - Math.exp(-8 * dt)
    );
  }
}
