import * as THREE from 'three';
import { HAUNT } from '../core/config';

/**
 * ELEMEK A ZSEBLÁMPÁBA.
 *
 * A telep az egyetlen erőforrás a házban, és eddig csak FOGYOTT — ami azt
 * jelentette, hogy a kör hossza előre el volt döntve, és semmit nem
 * tehettél ellene. Egy erőforrás, amit nem lehet pótolni, nem erőforrás,
 * hanem homokóra.
 *
 * Az elem ettől lesz DÖNTÉS: ott hever a folyosó végén, a fényed viszont
 * fogy, amíg odaérsz érte. Megéri-e? És ha épp a nyomodban van valami?
 *
 * Magától világít halványan — nem azért, hogy könnyű legyen megtalálni,
 * hanem mert egy vaksötét szobában egy sötét tárgy nem tárgy, hanem
 * semmi. A fénye kicsi: két méterről látod meg, nem húszról.
 */
export class Batteries {
  readonly group = new THREE.Group();
  private readonly items: { mesh: THREE.Object3D; taken: boolean }[] = [];
  private clock = 0;

  constructor(spots: readonly THREE.Vector3[]) {
    const geometry = new THREE.CylinderGeometry(0.11, 0.11, 0.42, 10);
    for (const spot of spots) {
      const mesh = new THREE.Group();
      const body = new THREE.Mesh(
        geometry,
        new THREE.MeshBasicMaterial({ color: 0x6effc0 })
      );
      body.rotation.z = Math.PI / 2;
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.34, 10, 8),
        new THREE.MeshBasicMaterial({ color: 0x1f7a5a, transparent: true, opacity: 0.28 })
      );
      mesh.add(body, glow);
      mesh.position.copy(spot);
      mesh.position.y = 0.55;
      mesh.userData.cpNoOutline = true;
      this.group.add(mesh);
      this.items.push({ mesh, taken: false });
    }
  }

  /**
   * @returns igaz, ha most vettél fel egyet.
   */
  update(dt: number, at: THREE.Vector3): boolean {
    this.clock += dt;
    let felvette = false;
    for (const item of this.items) {
      if (item.taken) continue;
      // Forog és lebeg: egy mozgó tárgy a sötétben akkor is elkapja a
      // szemedet, ha épp nem arra nézel.
      item.mesh.rotation.y += dt * 1.6;
      item.mesh.position.y = 0.55 + Math.sin(this.clock * 2 + item.mesh.position.x) * 0.07;
      if (item.mesh.position.distanceTo(at) < 1.6) {
        item.taken = true;
        item.mesh.visible = false;
        felvette = true;
      }
    }
    return felvette;
  }

  /** Hány maradt — a mérésnek és a kijelzőnek. */
  get left(): number {
    return this.items.filter((i) => !i.taken).length;
  }

  /** Hányat tettünk ki összesen. */
  get total(): number {
    return this.items.length;
  }

  /** Mennyi fényt ad összesen, ha mindet megtalálod. */
  static get worth(): number {
    return HAUNT.battery;
  }
}
