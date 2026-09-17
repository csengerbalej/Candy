import * as THREE from 'three';
import { CAR, NITRO } from '../core/config';
import type { PlayerInput } from '../input/InputManager';

/**
 * Arcade car (spec §8): fast, loose, and comic. Deliberately NOT a simulation —
 * the humour comes from a vehicle that oversteers when you panic.
 */
export class Car {
  readonly mesh = new THREE.Group();
  readonly position = new THREE.Vector3();
  /**
   * Signed forward speed in units/second.
   *
   * Ez MARADT skalár, szándékosan: a sebességmérő, a pontozás, a szörnyecskék
   * elütése és a hálózati csomag mind ezt olvassa, és mindnek a „milyen
   * gyorsan megyünk előre" a kérdése. Az oldalcsúszás külön mező — lásd
   * `lateral` —, mert az egy MÁSIK kérdés, és aki eddig a `speed`-et nézte,
   * annak a válasza nem változott.
   */
  speed = 0;
  /**
   * Oldalirányú sebesség a kocsi saját tengelyén, jobbra pozitív.
   *
   * Ettől lehet driftelni egyáltalán. Eddig nem létezett: a kormányzás a
   * teljes lendületet azonnal átfordította, tehát a kocsi mindig pontosan
   * arra ment, amerre nézett — ami nem viselkedés, hanem a tehetetlenség
   * hiánya.
   */
  lateral = 0;
  heading = 0;

  /** Magasság a talaj fölött, és a függőleges sebesség. */
  height = 0;
  private vertical = 0;
  private jumpLock = 0;
  /** Igaz a földetérés képkockáján — a kamera és a hang ebből él. */
  landed = false;
  /** Igaz, amíg a kerék nem ér földet. */
  get airborne(): boolean {
    return this.height > CAR.groundEpsilon;
  }
  /** 0..1: mennyire csúszik oldalra. A HUD és a gumifüst ebből dolgozik. */
  get driftAmount(): number {
    return Math.min(1, Math.abs(this.lateral) / (CAR.driftThreshold * 2));
  }
  /** Igaz, amíg számottevően csúszik. */
  get drifting(): boolean {
    return Math.abs(this.lateral) > CAR.driftThreshold;
  }
  /** Set for one frame when the car hits something solid head-on. */
  /**
   * True only on the frame an impact BEGINS.
   *
   * It used to be the per-step contact state, so holding the throttle against
   * a fence raised it sixty times a second: ten seconds of that counted 507
   * crashes and −3042 points, and re-armed the camera shake every frame into a
   * continuous rattle. Scoring and feedback both want the event, not the
   * condition — `contacting` is there for anything that wants the condition.
   */
  crashed = false;
  contacting = false;
  private wasContacting = false;
  /** Set for one frame when the car merely slid along something. */
  scraped = false;
  /** Closing speed of this frame's impact, m/s. Zero when nothing was hit. */
  impactSpeed = 0;
  /** True while the car is off the tarmac. */
  offRoad = false;
  /** How long the car has been off the surface, for CAR.offRoadDwell. */
  private offSurfaceFor = 0;
  /** 0..1 rumble level for the camera and HUD; rises off-road, decays on it. */
  rumble = 0;

  /** Mennyi van a nitró tartályban, 0..1. A HUD ezt rajzolja. */
  nitroCharge = 1;
  /** Szól-e ÉPPEN MOST. Egy képkockára igaz értékek: hang, láng, kamera. */
  boosting = false;
  /** 0..1 — mennyire áll a hátsó kerekére. A modell dőlése ebből jön. */
  wheelie = 0;

  /** Egy MEGKEZDETT nitró: addig fut, amíg ki nem ürül vagy el nem engeded. */
  private firing = false;
  /**
   * Surface test, wired up by DriveGame. Left undefined the car behaves as if
   * the whole world were road, which is what the greybox and the probes want.
   */
  surface?: (x: number, z: number) => boolean;

  /**
   * A pálya széle, ha van. A falu egy befőttesüveg alatt van, és ez az
   * üveg fala.
   *
   * Sugárirányú korlát, nem ütköződoboz — az üveg kör alakú, tehát nincs
   * sarka, ahol be lehetne szorulni. Aki nekimegy, az CSÚSZIK mellette,
   * nem megáll: a lendület érintőirányú része megmarad.
   */
  boundary?: (position: THREE.Vector3) => boolean;

  private readonly body: THREE.Mesh;
  private readonly wheels: THREE.Mesh[] = [];
  /** Holds the authored model once it arrives; greybox stays until then. */
  private readonly art = new THREE.Group();
  private greybox = new THREE.Group();

  constructor(spawn: THREE.Vector3, heading = 0) {
    this.position.copy(spawn);
    this.heading = heading;
    this.mesh.add(this.art);

    this.body = new THREE.Mesh(
      new THREE.BoxGeometry(CAR.width, 1.2, CAR.length),
      new THREE.MeshStandardMaterial({ color: 0xff7a29, roughness: 0.45, metalness: 0.1 })
    );
    this.body.position.y = 0.95;
    this.body.castShadow = true;
    this.greybox.add(this.body);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(CAR.width * 0.82, 0.9, CAR.length * 0.44),
      new THREE.MeshStandardMaterial({ color: 0x2b2148, roughness: 0.3 })
    );
    cabin.position.set(0, 1.9, -0.3);
    cabin.castShadow = true;
    this.greybox.add(cabin);

    for (const [x, z] of [
      [-1, 1],
      [1, 1],
      [-1, -1],
      [1, -1],
    ]) {
      const wheel = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.3, 12),
        new THREE.MeshStandardMaterial({ color: 0x15102a, roughness: 0.9 })
      );
      wheel.rotation.z = Math.PI / 2;
      wheel.position.set(x * (CAR.width / 2), 0.42, z * (CAR.length / 2 - 0.85));
      this.greybox.add(wheel);
      this.wheels.push(wheel);
    }

    // A hero light travelling with the car. Headlights point AWAY from the
    // camera, so without this the player's own vehicle — the most looked-at
    // object in the game — is lit only by a distant moon and reads as a dark
    // blob. One light, attached to the car, and the paintwork comes back.
    const hero = new THREE.DirectionalLight(0xffd9b0, 1.5);
    hero.position.set(-3, 4.5, -3.5);
    hero.target.position.set(0, 0.6, 1);
    this.mesh.add(hero);
    this.mesh.add(hero.target);

    const rim = new THREE.DirectionalLight(0x9db6ff, 0.9);
    rim.position.set(3.5, 2.5, -4.5);
    rim.target.position.set(0, 1, 0);
    this.mesh.add(rim);
    this.mesh.add(rim.target);

    // Headlights: the driver's only real read on the road ahead.
    for (const side of [-1, 1]) {
      const lamp = new THREE.SpotLight(0xfff2cf, 55, 46, 0.55, 0.5, 1.4);
      lamp.position.set(side * (CAR.width / 2 - 0.3), 0.9, CAR.length / 2);
      lamp.target.position.set(side * 1.6, 0, CAR.length / 2 + 22);
      this.mesh.add(lamp);
      this.mesh.add(lamp.target);
    }

    this.mesh.add(this.greybox);
    this.mesh.position.copy(this.position);
  }

  /**
   * Swap the placeholder for the authored model. Physics never sees this —
   * the collision box stays derived from CAR.length, so art can change without
   * retuning the handling.
   */
  setArt(model: THREE.Object3D): void {
    this.art.clear();
    this.art.add(model);
    this.greybox.visible = false;
  }

  get forward(): THREE.Vector3 {
    return new THREE.Vector3(Math.sin(this.heading), 0, Math.cos(this.heading));
  }

  /**
   * A modellt a mostani állapotra igazítja, szimuláció nélkül.
   *
   * A VENDÉG gépén a kocsi nem fut: a helyét, irányát és sebességét a szoba
   * hozza, az `update` pedig soha nem hívódik meg rá. Márpedig a modellt
   * eddig KIZÁRÓLAG az `update` mozgatta — a vendég képernyőjén tehát a kocsi
   * ott állt, ahol megszületett, miközben a térképén szépen haladt. Ez a
   * hiány csak most derült ki, amikor az ugrás miatt megnéztem, hova is kerül
   * a `mesh.position.y`.
   */
  syncMesh(dt = 1 / 60): void {
    this.mesh.position.copy(this.position);
    this.mesh.position.y = this.position.y + this.height;
    this.mesh.rotation.y = this.heading;
    this.mesh.rotation.x = THREE.MathUtils.lerp(
      this.mesh.rotation.x,
      THREE.MathUtils.clamp(-this.height * 0.12, -0.22, 0.22) - this.wheelie * NITRO.wheelie,
      1 - Math.exp(-10 * dt)
    );
    const roll = this.speed * dt;
    for (const w of this.wheels) w.rotation.x += roll;
    this.body.rotation.z = THREE.MathUtils.lerp(
      this.body.rotation.z,
      THREE.MathUtils.clamp(this.lateral * 0.06, -1, 1) * 0.11,
      1 - Math.exp(-8 * dt)
    );
    this.art.rotation.z = this.body.rotation.z;
  }

  update(dt: number, input: PlayerInput, colliders: THREE.Box3[]): void {
    this.crashed = false;
    this.wasContacting = this.contacting;
    this.contacting = false;
    this.scraped = false;
    this.impactSpeed = 0;

    this.landed = false;
    this.jumpLock = Math.max(0, this.jumpLock - dt);

    // --- Ugrás --------------------------------------------------------------
    //
    // Csak a földről, és csak ha letelt a rövid zár. A zár nélkül a lenyomva
    // tartott gomb a földetérés képkockáján azonnal újra elsülne, és a kocsi
    // egy folyamatosan pattogó labda lenne, nem egy ugró autó.
    if (input.jump && !this.airborne && this.jumpLock <= 0) {
      this.vertical = CAR.jumpSpeed;
      this.jumpLock = CAR.jumpCooldown;
    }

    if (this.airborne || this.vertical > 0) {
      this.vertical -= CAR.gravity * dt;
      this.height += this.vertical * dt;
      if (this.height <= 0) {
        this.height = 0;
        // A földetérés ESEMÉNY, nem állapot: egyetlen képkockára igaz. A
        // kamera és a hang egyszer akar szólni, nem addig, amíg a földön
        // vagyunk.
        this.landed = this.vertical < -2;
        this.vertical = 0;
      }
    }

    // --- Gáz és fék ---------------------------------------------------------
    //
    // Levegőben nincs kerék, tehát nincs se gyorsítás, se fékezés. Ez nem
    // szigor, hanem az ugrás ÁRA: amíg repülsz, a sebességed adott, és ezért
    // számít, hogy honnan ugrasz neki.
    const throttle = this.airborne ? 0 : input.moveY;
    if (throttle > 0) this.speed += CAR.accel * throttle * dt;
    else if (throttle < 0) {
      // One pedal does both jobs: brake while rolling forward, reverse once stopped.
      const decel = this.speed > 0 ? CAR.brake : CAR.accel;
      this.speed += decel * throttle * dt;
    }

    // --- Nitró ---------------------------------------------------------------
    //
    // Nem egyszerűen „több gáz". Két dolgot csinál, és a kettő ugyanaz a
    // pillanat: ÁLLÓ HELYZETBŐL adja a legtöbbet (a ráadás a sebességgel
    // elfogy), és ettől emeli meg az orrát. Egy nitró, ami 110-nél ugyanúgy
    // hat, mint állva, csak egy nagyobb szám; ez itt egy indulás.
    this.boosting = false;
    if (!input.nitro || this.nitroCharge <= 0) this.firing = false;
    // Elindítani csak a küszöb fölül lehet; a MÁR FUTÓ nitró viszont megy,
    // amíg van benne. Így a gomb vagy szól, vagy nem — nem villog.
    if (input.nitro && !this.firing && this.nitroCharge >= NITRO.minStart) this.firing = true;
    const wantNitro = this.firing && !this.airborne && this.nitroCharge > 0 && this.speed >= -0.5;
    if (wantNitro) {
      this.boosting = true;
      this.nitroCharge = Math.max(0, this.nitroCharge - dt / NITRO.duration);
      const launch = 1 - Math.min(1, Math.abs(this.speed) / CAR.maxSpeed);
      const gain = NITRO.push + NITRO.launchBonus * launch;
      this.speed += CAR.accel * gain * dt;
      // Az orr annyira megy fel, amennyire a nitró ÉPPEN dolgozik: teljes
      // erővel állóból, semennyire a végsebességnél.
      this.wheelie = Math.min(1, this.wheelie + dt * 4 * launch);
    } else {
      // Nyomva tartott gomb alatt NEM tölt: különben a kiürült tartály
      // azonnal újraindulna, és pont a villogás jönne vissza.
      if (!input.nitro) this.nitroCharge = Math.min(1, this.nitroCharge + dt / NITRO.refill);
      this.wheelie = Math.max(0, this.wheelie - dt * 2.4);
    }

    // --- Kézifék ------------------------------------------------------------
    const handbrake = input.sprint && !this.airborne && Math.abs(this.speed) > 1;
    if (handbrake) this.speed -= this.speed * CAR.handbrakeDrag * dt;

    this.speed -= this.speed * CAR.drag * dt;
    // A nitró a végsebesség FÖLÉ visz — enélkül a gomb a maxon nem csinál
    // semmit, és pont a leglátványosabb pillanatban lenne néma.
    const ceiling = CAR.maxSpeed * (this.boosting ? NITRO.overspeed : 1);
    this.speed = THREE.MathUtils.clamp(this.speed, -CAR.reverseSpeed, ceiling);

    // --- Kormányzás ---------------------------------------------------------
    //
    // A kormány a KAROSSZÉRIÁT fordítja el. Hogy a lendület követi-e, az a
    // tapadás dolga, nem a kormányé — és pontosan ez a különbség tette
    // lehetővé a driftet.
    const speedFactor = 1 - (Math.abs(this.speed) / CAR.maxSpeed) * CAR.steerAtSpeed;
    const traction = Math.min(1, Math.hypot(this.speed, this.lateral) / 6);
    const authority =
      (handbrake ? CAR.handbrakeSteer : 1) * (this.airborne ? CAR.airSteer : 1);
    const turn =
      -input.moveX *
      CAR.steerInvert *
      CAR.steerRate *
      speedFactor *
      traction *
      authority *
      Math.sign(this.speed || 1) *
      dt;
    this.heading += turn;

    // --- Tapadás ------------------------------------------------------------
    //
    // A kocsi elfordult, a lendület nem. A korábbi kód itt ért véget: a
    // `speed` a friss `heading` mentén indult el, tehát a lendület MINDIG
    // követte a kormányt. Most a fordulás a hosszirányú sebesség egy részét
    // ÁTTOLJA az oldalirányúba — ez maga az oldalcsúszás —, és a tapadás
    // szívja vissza. Kézifékkel sokkal lassabban.
    this.lateral += this.speed * Math.sin(turn);
    this.speed *= Math.cos(turn);

    const grip = handbrake ? CAR.driftGrip : CAR.grip;
    // Exponenciálisan, nem lineárisan: így a csillapítás nem függ attól,
    // hányszor fut le a szimuláció egy képkocka alatt.
    this.lateral *= Math.exp(-grip * dt);
    if (Math.abs(this.lateral) < 0.02) this.lateral = 0;

    // Kerbs. Tarmac is fast; pavements, gardens and the lawn you just mounted
    // are not. Without this the road is decorative — you can cut every corner
    // across somebody's garden at full speed and the town stops being a town.
    //
    // Leaving the road has to persist to count. A baked map is measured, not
    // authored, so its road surface has pinholes in it — a drain lip, a seam
    // left by decimation, the shadow of a kerbstone — and a car at 12 m/s
    // crosses a 40 cm one in a thirtieth of a second. Reacting to that
    // instantly is what shook the screen the length of every street: the
    // rumble switched on and off, and the speed cap with it. A short dwell
    // costs nothing on a real verge, which you are on for seconds, and removes
    // the whole class of bug.
    // Levegőben nincs felület, amiről le lehetne térni. Enélkül egy kerítés
    // fölött átugorva a kocsi a levegőben kapná meg a terepbüntetést.
    const offSurface =
      !this.airborne && this.surface ? !this.surface(this.position.x, this.position.z) : false;
    this.offSurfaceFor = offSurface ? this.offSurfaceFor + dt : 0;
    this.offRoad = this.offSurfaceFor >= CAR.offRoadDwell;
    if (this.offRoad) {
      this.speed -= this.speed * CAR.offRoadDrag * dt;
      const cap = CAR.offRoadMaxSpeed;
      if (this.speed > cap) this.speed = cap;
      else if (this.speed < -cap) this.speed = -cap;
      this.rumble = Math.min(1, this.rumble + dt * 6 * Math.min(1, Math.abs(this.speed) / 6));
    } else {
      this.rumble = Math.max(0, this.rumble - dt * 4);
    }

    // A lépés MINDKÉT irányból áll össze. Enélkül az oldalcsúszás csak egy
    // szám lenne, amit senki nem érez.
    const step = this.forward.multiplyScalar(this.speed * dt);
    const side = new THREE.Vector3(Math.cos(this.heading), 0, -Math.sin(this.heading))
      .multiplyScalar(this.lateral * dt);
    step.add(side);
    this.position.x += step.x;
    this.position.z += step.z;
    this.resolve(colliders, step);

    if (this.boundary?.(this.position)) {
      // Az üvegnek nekimenve a SUGÁRIRÁNYÚ sebesség vész el, az érintőirányú
      // marad. Enélkül a fal megállítana, és a játékos a pálya szélén
      // ragadna ahelyett, hogy elkanyarodna mellette.
      const out = new THREE.Vector3(this.position.x, 0, this.position.z).normalize();
      const along = this.forward.multiplyScalar(this.speed);
      const radial = out.multiplyScalar(along.dot(out));
      along.sub(radial);

      // A sugárirányú rész NEM tűnik el teljesen, és ez a lényeg.
      //
      // Teljesen kivonva a merőlegesen nekihajtó autó sebessége nullára esik
      // — a kormány pedig sebességtől függ, tehát ott is ragad. Lemértem:
      // nulla fokot haladt a fal mentén 4 másodperc alatt. Ez ugyanaz az
      // elakadás, amit az imént a sövényeknél megszüntettünk, csak a pálya
      // szélén.
      //
      // Egy harmadát meghagyva marad annyi lendület, amennyiből kormányozni
      // lehet, a helyzetet pedig úgyis a korlát tartja bent: a kocsi nem megy
      // kijjebb, csak elfordul és elcsúszik a fal mellett.
      // FIX PADLÓ, nem hányad. Először a sebesség egyharmadát hagytam meg —
      // csakhogy ez képkockánként ismétlődik, tehát mértani sorban nullába
      // tart: négy másodperc falnak feszülés után megint nulla fokot haladt.
      // Egy abszolút padló nem fogy el, és pont annyi, amennyiből a kormány
      // még dolgozik.
      const floor = Math.min(Math.abs(this.speed), CAR.maxSpeed * 0.18);
      this.speed = Math.sign(this.speed) * Math.max(along.length(), floor);
      this.lateral *= 0.6;
    }

    // The event, derived from the condition: a crash is the moment you START
    // being against something, not every frame you remain there.
    this.crashed = this.contacting && !this.wasContacting;

    this.mesh.position.copy(this.position);
    this.mesh.position.y = this.position.y + this.height;
    this.mesh.rotation.y = this.heading;
    // Orral felfelé emelkedés közben, orral lefelé esésben. Egy magasságot
    // váltó, de végig vízszintes autó liftnek látszik, nem ugrásnak.
    this.mesh.rotation.x = THREE.MathUtils.lerp(
      this.mesh.rotation.x,
      THREE.MathUtils.clamp(-this.vertical * 0.035, -0.22, 0.22),
      1 - Math.exp(-10 * dt)
    );

    const roll = this.speed * dt;
    for (const w of this.wheels) w.rotation.x += roll;

    // Body lean, because a car that never leans reads as a sliding box.
    // Driftben a dőlést az OLDALCSÚSZÁS adja, nem a kormány: egy megcsúszott
    // kocsi akkor is kifelé dől, amikor a vezető már ellenkormányoz — és
    // pont az ellenkormányzás a drift látható része.
    const lean = THREE.MathUtils.clamp(
      input.moveX * (Math.abs(this.speed) / CAR.maxSpeed) + this.lateral * 0.06,
      -1,
      1
    );
    const target = lean * 0.11;
    this.body.rotation.z = THREE.MathUtils.lerp(this.body.rotation.z, target, 1 - Math.exp(-8 * dt));
    this.art.rotation.z = this.body.rotation.z;
  }

  /**
   * Collision.
   *
   * The car is three circles along its spine, not one circumscribed square.
   * The square was 3.6 m on a side for a car 1.95 m wide: it stopped the jeep
   * a metre clear of walls when travelling straight, and — because a square is
   * heading-blind — clipped corners the nose visually missed on the diagonal.
   * Circles are heading-aware for free (their centres rotate with the car),
   * give a real contact NORMAL rather than an axis, and cost one clamp each.
   *
   * The normal is what lets a graze behave like a graze: see `respond`.
   */
  private resolve(colliders: THREE.Box3[], step: THREE.Vector3): void {
    const statics = this.prepare(colliders);
    // A mozgó akadályok a statikus falak MÖGÉ kerülnek: ugyanaz a kör-doboz
    // próba fut rájuk, ugyanaz a válasz (súrolás vagy frontális) születik.
    const boxes = this.obstacles.length ? statics.concat(this.obstacles) : statics;
    const r = CAR.bodyRadius;
    const budget = step.length() + r * 2;

    const normal = new THREE.Vector3();
    let contact = false;

    // Two passes: pushing out of one box can seat the car into its neighbour.
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;

      for (const c of boxes) {
        // Broadphase. 1029 boxes × 3 circles × 2 passes every step is worth
        // one rectangle test to avoid.
        if (
          this.position.x + CAR.spineSpread + r < c.min.x ||
          this.position.x - CAR.spineSpread - r > c.max.x ||
          this.position.z + CAR.spineSpread + r < c.min.z ||
          this.position.z - CAR.spineSpread - r > c.max.z
        ) {
          continue;
        }
        // Függőleges: ami a motorháztető ALATT elfér, az nem ütközés — és
        // most már az sem, ami a kerekek alatt marad el, mert a kocsi tud
        // ugrani. Ez adja az ugrásnak az értelmét: egy alacsony fal fölött át
        // lehet vinni. A padlót a saját magasságunkkal együtt emeljük.
        const floor = this.height + 0.15;
        if (c.min.y > this.height + 2.4 || c.max.y < floor) continue;

        for (const local of Car.SPINE) {
          const cx = this.position.x + Math.sin(this.heading) * local;
          const cz = this.position.z + Math.cos(this.heading) * local;

          const qx = THREE.MathUtils.clamp(cx, c.min.x, c.max.x);
          const qz = THREE.MathUtils.clamp(cz, c.min.z, c.max.z);
          let dx = cx - qx;
          let dz = cz - qz;
          let dist = Math.hypot(dx, dz);
          let push: number;

          if (dist > 1e-4) {
            if (dist >= r) continue;
            push = r - dist;
            dx /= dist;
            dz /= dist;
          } else {
            // Centre is inside the box: fall back to the least-penetration
            // axis. Picking the smaller overlap is what keeps a corner clip
            // from being resolved out of the far side of an 18 m house.
            const left = cx - c.min.x;
            const right = c.max.x - cx;
            const back = cz - c.min.z;
            const front = c.max.z - cz;
            const mx = Math.min(left, right);
            const mz = Math.min(back, front);
            if (mx < mz) {
              dx = left < right ? -1 : 1;
              dz = 0;
              push = mx + r;
            } else {
              dx = 0;
              dz = back < front ? -1 : 1;
              push = mz + r;
            }
          }

          if (push > budget) {
            // Deeply embedded.
            //
            // Teleporting to the nearest face is what used to fling the jeep
            // across the map, so that is out. But simply REFUSING — which is
            // what this did — means an actor that ever ends up inside
            // geometry never comes out: a probe found the car escaping from
            // only one of three embedded positions, and the other two end the
            // night. So: refuse the big push, and creep out along the same
            // direction a little each frame instead. Bounded per step, so it
            // can never be a teleport; monotonic, so it always finishes.
            this.position.x -= step.x;
            this.position.z -= step.z;
            this.position.x += dx * CAR.unstickStep;
            this.position.z += dz * CAR.unstickStep;
            this.impactSpeed = Math.abs(this.speed);
            this.speed = 0;
            this.contacting = true;
            return;
          }

          this.position.x += dx * push;
          this.position.z += dz * push;
          normal.x += dx;
          normal.z += dz;
          contact = true;
          moved = true;
        }
      }

      if (!moved) break;
    }

    if (contact) this.respond(normal);
  }

  /**
   * One response per frame, chosen by the angle between travel and the wall.
   *
   * The old code did `speed *= -crashBounce` for every contact, including the
   * gentlest kerb graze — so brushing a hedge at 60 km/h reversed the car and
   * left the player facing back down the street with no idea why. Scraping now
   * bleeds off only the component of speed that went INTO the wall and steers
   * the nose along it; only a genuinely head-on hit stops and jolts.
   */
  private respond(normal: THREE.Vector3): void {
    const n = Math.hypot(normal.x, normal.z);
    const speedAbs = Math.abs(this.speed);
    if (n < 1e-5 || speedAbs < 1e-4) {
      if (speedAbs >= CAR.impactMinSpeed) this.contacting = true;
      return;
    }
    const nx = normal.x / n;
    const nz = normal.z / n;

    // Travel direction (reversing counts, and reverses the test with it).
    const dir = Math.sign(this.speed);
    const vx = Math.sin(this.heading) * dir;
    const vz = Math.cos(this.heading) * dir;

    // Positive when the car is driving into the surface.
    const into = -(vx * nx + vz * nz);
    if (into <= 0) return; // already leaving; pushing out was enough

    this.impactSpeed = speedAbs * into;

    if (into >= CAR.impactCos) {
      // Head-on. Stop, jolt, keep the heading the player chose.
      this.contacting = true;
      this.speed =
        speedAbs < CAR.impactMinSpeed
          ? 0
          : -dir * Math.min(speedAbs * CAR.crashBounce, CAR.crashBounceMax);
      return;
    }

    // Glance. Keep the tangential part of the speed, lose the rest.
    this.scraped = true;
    const tangential = Math.sqrt(Math.max(0, 1 - into * into));
    this.speed = dir * speedAbs * tangential * CAR.scrapeFriction;

    // Steer the nose along the wall, a little. This is the difference between
    // "sliding down a wall" and "a car repeatedly headbutting a wall".
    // Tangent = travel with the into-the-wall component removed, which is
    // already normalised to `tangential`.
    const tx = (vx + nx * into) / Math.max(tangential, 1e-4);
    const tz = (vz + nz * into) / Math.max(tangential, 1e-4);
    const want = Math.atan2(tx * dir, tz * dir);
    let delta = want - this.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    this.heading += THREE.MathUtils.clamp(
      delta * CAR.scrapeSteer * into,
      -CAR.scrapeSteerMax,
      CAR.scrapeSteerMax
    );
  }

  /** Local-z offsets of the three collision circles: rear, centre, nose. */
  private static readonly SPINE = [-CAR.spineSpread, 0, CAR.spineSpread];

  /**
   * MOZGÓ akadályok: a másik játékos kocsija és az NPC autók.
   *
   * Külön lista, nem a világ falai közé keverve, két okból. Egy: a falakat
   * `prepare()` egyszer megszűri és gyorsítótárazza a tömb azonossága
   * alapján — egy képkockánként újraépülő tömb ezt a gyorsítótárat minden
   * képkockán eldobná (1029 doboz újraszűrése 60-szor másodpercenként).
   * Kettő: az autódobozokat NEM szabad a név-heurisztikával zsugorítani, mert
   * nincs nevük; úgy kerülnének be, ahogy vannak.
   *
   * Ürítve nem kerül semmibe: a kör-doboz próba a széles fázison elhasal.
   */
  obstacles: THREE.Box3[] = [];

  private preparedFrom: THREE.Box3[] | null = null;
  private prepared: THREE.Box3[] = [];
  /**
   * Asset names for the collider list, index-aligned, when the world provides
   * them. With names the shape heuristic below becomes a lookup and stops
   * guessing; without them it still works.
   */
  colliderAssets: string[] | null = null;
  /**
   * 'derive' guesses each collider's real shape from its name and proportions,
   * which a kit-of-parts town needs. 'exact' takes the boxes as given, for a
   * world that measured them off its own geometry.
   */
  colliderMode: 'derive' | 'exact' = 'derive';

  /**
   * Filter and shrink the town's colliders, once per collider list.
   *
   * TownWorld derives one AABB per mesh part from its geometry bounding box,
   * which is right for houses and wrong for everything organic: a tree's box
   * is its CANOPY, so the car hits an invisible wall three metres from the
   * trunk. Until the world can tag its colliders (see the report), the shape
   * itself is the only signal available — and it is a surprisingly good one:
   *
   *   · short and small       → a bin, a pumpkin, a sign. Drive over it.
   *   · tall, small, square   → a trunk or a pole wearing a canopy. Shrink the
   *                             footprint to the trunk and keep the height.
   *   · anything else         → a building or a fence. Solid, unchanged.
   *
   * Cached by array identity: the town builds its list once, so this runs once.
   */
  private prepare(colliders: THREE.Box3[]): THREE.Box3[] {
    if (this.preparedFrom === colliders) return this.prepared;
    this.preparedFrom = colliders;

    // Boxes measured from the mesh are already the right shape. The heuristics
    // below exist to recover, from a NAME, what a kit-of-parts town could not
    // tell us; run them over a measured grid and they do pure harm — a merged
    // rectangle that happens to be tall and squarish is not a tree, and
    // shrinking it to a "trunk" opens a hole in the side of a house.
    if (this.colliderMode === 'exact') {
      this.prepared = colliders;
      return colliders;
    }

    const named = this.colliderAssets?.length === colliders.length ? this.colliderAssets : null;

    const out: THREE.Box3[] = [];
    colliders.forEach((c, index) => {
      const asset = named?.[index] ?? '';
      const w = c.max.x - c.min.x;
      const d = c.max.z - c.min.z;
      const h = c.max.y - c.min.y;
      const footprint = Math.max(w, d);

      // Named assets decide for themselves; unnamed ones fall back to shape.
      const isVegetation = /Nature_(Tree|Bush)/.test(asset);
      const isSolid = /House_|Fence_|Gate|Street_/.test(asset);
      const isClutter =
        /Pumpkin|JackOLantern|Mailbox|TrashCan|Hydrant|Manhole|Gravestone|Bench|Cobweb|Spider|Poster|Flag|Wreath|Broom|WitchHat|GrassPatch|CandyBowl|StringLights/.test(
          asset
        );

      if (isClutter || (!asset && h <= CAR.propMaxHeight && footprint <= CAR.propMaxFootprint)) {
        return;
      }

      const square = Math.min(w, d) / Math.max(footprint, 1e-4) > 0.55;
      const shrinkToTrunk = isVegetation
        ? true
        : !asset && !isSolid && h >= CAR.canopyMinHeight && footprint <= CAR.canopyMaxFootprint && square;
      if (!isSolid && shrinkToTrunk) {
        const cx = (c.min.x + c.max.x) / 2;
        const cz = (c.min.z + c.max.z) / 2;
        const hx = Math.min(w / 2, CAR.trunkHalfExtent);
        const hz = Math.min(d / 2, CAR.trunkHalfExtent);
        out.push(
          new THREE.Box3(
            new THREE.Vector3(cx - hx, c.min.y, cz - hz),
            new THREE.Vector3(cx + hx, c.max.y, cz + hz)
          )
        );
        return;
      }

      out.push(c);
    });
    this.prepared = out;
    return out;
  }

  /**
   * Distance from a point to the car's body, measured against the spine rather
   * than the centre. The critters use this: a 2.4 m circle around the centre
   * "hit" monsters that passed a metre clear of the flank, which is the single
   * most unfair thing in the driving section.
   */
  clearanceTo(point: THREE.Vector3): number {
    const t = THREE.MathUtils.clamp(
      (point.x - this.position.x) * Math.sin(this.heading) +
        (point.z - this.position.z) * Math.cos(this.heading),
      -CAR.spineSpread,
      CAR.spineSpread
    );
    const sx = this.position.x + Math.sin(this.heading) * t;
    const sz = this.position.z + Math.cos(this.heading) * t;
    return Math.hypot(point.x - sx, point.z - sz) - CAR.bodyRadius;
  }
}
