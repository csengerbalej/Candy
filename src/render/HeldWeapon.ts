import * as THREE from 'three';
import { models } from '../assets/ModelLoader';
import { GUNS, type GunId } from '../core/config';

/**
 * A FEGYVER A KÉZBEN, belső nézetben.
 *
 * A modell nem a kamera GYEREKE, hanem képkockánként a kamera elé kerül.
 * Gyerekként egyszerűbb volna, de a kamerát a rendező birtokolja, és minden
 * nézetváltásnál újrapózolja — egy odaakasztott fegyver előbb-utóbb ott
 * maradna egy másik nézetben, vagy megkapná a kamera rázását kétszeresen.
 * Így a fegyver a sajátja marad, és bármelyik kamerához oda tudjuk tenni.
 *
 * Három mozgás van rajta, és mind a három a LÖVÉSRŐL mond valamit:
 *
 *   hátralökés — a lövés pillanatában hátracsapódik, majd visszaül,
 *   torkolattűz — egyetlen képkockányi fény a csővégen,
 *   lengés      — járás közben finoman ring, hogy ne ragadjon a képre.
 */

/** A markolat helye a kamerához képest: jobbra, lejjebb, előre. */
const HOLD = new THREE.Vector3(0.28, -0.24, 0.42);

export class HeldWeapon {
  readonly group = new THREE.Group();
  private art: THREE.Object3D | null = null;
  private flash: THREE.Mesh | null = null;

  /** Hátralökés: 0 = nyugalom, 1 = teljesen hátra. */
  private kick = 0;
  /** Meddig ég még a torkolattűz. */
  private flashLeft = 0;
  private sway = 0;
  private kind: GunId | null = null;

  /** A csővég helye a világban — ide kerül a torkolattűz és a lövés zaja. */
  readonly muzzle = new THREE.Vector3();

  async show(kind: GunId): Promise<void> {
    if (this.kind === kind) return;
    this.kind = kind;
    const { scene } = await models.load(GUNS[kind].model);
    // Nem `instance()`: az újraközépre tenné a modellt, és pont az origót
    // dobná el, amit a markolathoz igazítottunk a sütéskor.
    const clone = scene.clone(true);
    this.art?.removeFromParent();
    this.art = clone;
    this.group.clear();
    this.group.add(clone);

    // A torkolattűz: egy lapos, additív korong a csővégen. Nem fényforrás —
    // egy pillanatra felkapcsolt pontfény a toon-rámpán az egész szobát
    // kifehérítené.
    const flash = new THREE.Mesh(
      new THREE.CircleGeometry(0.14, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffd9a8,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    flash.userData.cpNoOutline = true;
    flash.renderOrder = 6;
    this.flash = flash;
    this.group.add(flash);
  }

  /** Lövés: hátralökés és torkolattűz. */
  fired(): void {
    this.kick = 1;
    this.flashLeft = 0.05;
  }

  /**
   * @param moving Jár-e a játékos. Ettől leng a fegyver — állva nem.
   */
  update(dt: number, camera: THREE.Camera, moving: boolean): void {
    this.kick = Math.max(0, this.kick - dt * 6);
    this.flashLeft = Math.max(0, this.flashLeft - dt);
    this.sway += dt * (moving ? 7 : 1.4);

    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);

    const bob = moving ? Math.sin(this.sway) * 0.012 : Math.sin(this.sway) * 0.004;
    const back = this.kick * 0.12;

    this.group.position
      .copy(camera.position)
      .addScaledVector(right, HOLD.x + Math.cos(this.sway * 0.5) * bob)
      .addScaledVector(up, HOLD.y + bob)
      .addScaledVector(forward, HOLD.z - back);
    this.group.quaternion.copy(camera.quaternion);
    // A hátralökés az orrot is felkapja.
    this.group.rotateX(this.kick * 0.22);

    // A csővég a modell hosszából jön, nem beírt számból: a három fegyver
    // hossza más, és egy fix szám a rakétavetőnél a cső közepén állna.
    const length = this.kind ? lengthOf(this.kind) : 0.8;
    this.muzzle.copy(this.group.position).addScaledVector(forward, length);

    if (this.flash) {
      const material = this.flash.material as THREE.MeshBasicMaterial;
      material.opacity = this.flashLeft > 0 ? 0.9 : 0;
      this.flash.visible = this.flashLeft > 0;
      this.flash.position.set(0, 0, -length);
      this.flash.scale.setScalar(0.8 + Math.random() * 0.5);
    }
  }

  dispose(): void {
    this.group.clear();
    this.art = null;
  }
}

/** A fegyver hossza a markolattól a csővégig, a sütéskor beállított méretből. */
function lengthOf(kind: GunId): number {
  // A normalizáló a markolatot a hossz 28–32%-ánál teszi, tehát a cső a
  // maradék ~70%. Egy helyen él, hogy a torkolattűz és a lövés zaja ugyanott
  // szülessen.
  const total = { shotgun: 0.95, sniper: 1.5, rocket: 1.3 }[kind];
  return total * 0.7;
}
