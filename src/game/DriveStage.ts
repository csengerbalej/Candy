import * as THREE from 'three';
import { CAMERA, CAR } from '../core/config';

/** A vízszintes forgatás tengelye. Egy példány, mert minden képkockán kell. */
const UP_AXIS = new THREE.Vector3(0, 1, 0);
import type { Car } from '../vehicle/Car';

export interface Pane {
  /** GL viewport (bottom-left origin). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** CSS top edge, for DOM overlays. */
  cssTop: number;
}

/** Driver gets the larger pane: they are the one who has to read the road. */
const DRIVER_SHARE = 0.62;

/**
 * Meddig emelkedik a nézéspont, ha teljesen felfelé döntesz.
 *
 * A kupola teteje a város sugarának nagyjából a felénél van; ennyi elég
 * ahhoz, hogy a fedő beférjen a képbe, anélkül hogy az autó kicsúszna alóla.
 */
const LOOK_UP_REACH = 150;

/**
 * The driving section deliberately does NOT use SplitScreenDirector.
 *
 * That system blends two 3D cameras toward one shared pose, which only makes
 * sense when both players are looking at the same kind of space. Here they are
 * not: one has a chase camera, the other has a map. The split is therefore
 * fixed and asymmetric — a different problem, so a different system.
 */
export class DriveStage {
  /**
   * Near and far are as tight as the scene allows, because their RATIO is what
   * buys depth precision. 0.5–900 spent almost all of it in the first few
   * metres and left the road surfaces fighting each other at 60 m.
   */
  readonly camera = new THREE.PerspectiveCamera(CAMERA.fov + 10, 1, 1.2, 320);

  private readonly camPos = new THREE.Vector3();
  private readonly camLook = new THREE.Vector3();
  private initialised = false;
  private readonly ray = new THREE.Ray();
  private readonly hit = new THREE.Vector3();
  /** Decaying impulse from the last impact, and a running clock for the kerb. */
  private shake = 0;
  private shakeClock = 0;

  /**
   * Egyedül játszva NINCS osztott kép.
   *
   * Kétfősnél a képernyő alsó harmada a navigátoré: az ő térképe akkora, hogy
   * a MÁSIK ember a szoba túlfeléről is olvassa. Egyedül ugyanaz az ember
   * vezet és navigál, tehát a fél képet elvenni a térképnek csak annyit
   * jelentene, hogy kevesebbet lát az útból — a térkép mehet sarokba,
   * áttetsző kis panelként.
   */
  solo = false;

  layout(width: number, height: number): { driver: Pane; navigator: Pane } {
    if (this.solo) {
      const side = Math.round(Math.min(width, height) * 0.28);
      const margin = Math.round(Math.min(width, height) * 0.025);
      return {
        driver: { x: 0, y: 0, w: width, h: height, cssTop: 0 },
        navigator: {
          x: width - side - margin,
          y: margin,
          w: side,
          h: side,
          cssTop: height - side - margin,
        },
      };
    }
    const driverH = Math.round(height * DRIVER_SHARE);
    return {
      driver: { x: 0, y: height - driverH, w: width, h: driverH, cssTop: 0 },
      navigator: { x: 0, y: 0, w: width, h: height - driverH, cssTop: driverH },
    };
  }

  /**
   * Pull the camera in until it has line of sight to the car.
   *
   * The greybox had open ground behind the car; the authored town has houses
   * a few metres off the kerb, so a fixed eleven-metre boom spends half its
   * life inside somebody's living room. Cast toward the wanted position and
   * stop at the first thing in the way.
   */
  private unobstructed(
    focus: THREE.Vector3,
    wanted: THREE.Vector3,
    colliders: THREE.Box3[]
  ): THREE.Vector3 {
    const direction = new THREE.Vector3().subVectors(wanted, focus);
    const distance = direction.length();
    if (distance < 0.001 || colliders.length === 0) return wanted;
    direction.divideScalar(distance);

    this.ray.set(focus, direction);
    let nearest = distance;
    for (const box of colliders) {
      if (box.containsPoint(focus)) continue;
      if (!this.ray.intersectBox(box, this.hit)) continue;
      const d = this.hit.distanceTo(focus);
      if (d < nearest) nearest = d;
    }

    if (nearest >= distance) return wanted;
    // A little margin so the near plane does not poke through the wall.
    const pulled = Math.max(2.5, nearest - 0.6);
    return focus.clone().addScaledVector(direction, pulled);
  }

  /**
   * Szabad körülnézés vezetés közben.
   *
   * Nem luxus: a falut egy befőttesüveg fedi, és az üvegen KÍVÜL mászkál
   * valami. Egy merev, autó mögé szögezett kamera mellett a játékos csak
   * akkor látná meg, ha épp arra vezet — vagyis a játék legfontosabb
   * fenyegetése attól függne, merre kanyarodik.
   *
   * A visszaállás SEBESSÉGFÜGGŐ, és ez a lényeges döntés. Állva nem áll
   * vissza: nyugodtan nézelődhetsz, körbefordulhatsz, követheted a pókot.
   * Gyorsan haladva viszont visszahúz az autó mögé, mert ott a másik
   * veszély — vezetés közben nem nézhetsz hátra büntetlenül.
   */
  private orbitYaw = 0;
  private orbitPitch = 0;

  look(x: number, y: number, dt: number): void {
    this.orbitYaw += x * 2.4 * dt;
    const full = Math.PI * 2;
    this.orbitYaw = ((this.orbitYaw % full) + full) % full;
    this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + y * 1.1 * dt, -0.55, 1.1);
  }

  private recentre(car: Car, dt: number): void {
    const speedT = Math.min(1, Math.abs(car.speed) / CAR.maxSpeed);
    if (speedT < 0.25) return;
    const rate = (speedT - 0.25) * 2.4;
    let d = this.orbitYaw;
    if (d > Math.PI) d -= Math.PI * 2;
    this.orbitYaw -= d * (1 - Math.exp(-rate * dt));
    this.orbitPitch *= Math.exp(-rate * dt);
  }

  update(dt: number, car: Car, pane: Pane, colliders: THREE.Box3[] = []): void {
    this.recentre(car, dt);
    const forward = car.forward.applyAxisAngle(UP_AXIS, this.orbitYaw);
    // The camera backs off and drops as speed rises: a cheap, readable speed cue
    // that costs nothing and works even in greybox.
    const speedT = Math.abs(car.speed) / CAR.maxSpeed;
    const dist = 11 + speedT * 5;
    const height = 5.2 - speedT * 1.1;

    const want = car.position.clone().addScaledVector(forward, -dist);
    // A dőlés a MAGASSÁGOT mozgatja, nem a kamera szögét: így a kocsi a kép
    // közepén marad, miközben a horizont fel-le csúszik. Egy elforgatott
    // kamera ugyanennél a mozdulatnál kicsúsztatná a képből az autót.
    want.y = height + this.orbitPitch * (dist * 0.85);
    const focus = car.position.clone().setY(1.4);
    const clear = this.unobstructed(focus, want, colliders);
    // A nézéspont az AUTÓ ELŐTT van, de körülnézve az autóra húzódik vissza:
    // hátrafelé fordulva a „nyolc méterrel előre" pont a kamera mögé esne.
    const ahead = 8 + speedT * 12;
    const centred = Math.max(0, Math.cos(this.orbitYaw));
    const look = car.position.clone().addScaledVector(car.forward, ahead * centred);
    // FEL LEHET NÉZNI AZ ÜVEGRE.
    //
    // Eddig a kamera MINDIG a talajra nézett (1,4 magasságba), akármerre
    // döntötted — a dőlés csak a kamera magasságát mozgatta. Vagyis az egész
    // történet (befőttesüvegbe zártak) fölötted volt, és fizikailag nem
    // lehetett ránézni.
    //
    // Lefelé döntve (negatív dőlés) a kamera leereszkedik ÉS a nézéspont
    // felemelkedik: a kettő együtt az égre fordítja a képet. Felfelé döntve
    // marad a régi, madártávlati nézet.
    const skyward = Math.max(0, -this.orbitPitch) / 0.55;
    look.y = 1.4 + skyward * skyward * LOOK_UP_REACH;

    if (!this.initialised) {
      this.camPos.copy(clear);
      this.camLook.copy(look);
      this.initialised = true;
    } else {
      // Position lags more than aim, so the car leads the frame in a corner.
      // Snap in faster than out: a wall arriving must not be entered, but
      // leaving one should not whip the camera backwards.
      const pullingIn = clear.distanceTo(car.position) < this.camPos.distanceTo(car.position);
      this.camPos.lerp(clear, 1 - Math.exp(-(pullingIn ? 16 : 5.5) * dt));
      this.camLook.lerp(look, 1 - Math.exp(-9 * dt));
    }

    // Feedback. A crash the camera does not acknowledge reads as a bug; a
    // kerb the camera does not acknowledge reads as tarmac.
    this.shakeClock += dt;
    if (car.crashed) this.shake = Math.max(this.shake, Math.min(1, car.impactSpeed / 14));
    this.shake = Math.max(0, this.shake - dt * 3.2);
    const rumble = car.rumble * 0.22;
    const amount = this.shake * 0.55 + rumble;

    this.camera.aspect = pane.h > 0 ? pane.w / pane.h : 1;
    this.camera.position.copy(this.camPos);
    if (amount > 0.001) {
      const t = this.shakeClock;
      this.camera.position.x += Math.sin(t * 61) * amount * 0.5;
      this.camera.position.y += Math.sin(t * 47 + 1.7) * amount * 0.4;
      this.camera.position.z += Math.sin(t * 53 + 0.9) * amount * 0.5;
    }
    this.camera.lookAt(this.camLook);
    this.camera.updateProjectionMatrix();
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, pane: Pane): void {
    renderer.setScissorTest(true);
    renderer.setViewport(pane.x, pane.y, pane.w, pane.h);
    renderer.setScissor(pane.x, pane.y, pane.w, pane.h);
    renderer.render(scene, this.camera);
    renderer.setScissorTest(false);
  }
}
