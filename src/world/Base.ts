import * as THREE from 'three';
import { DELIVERY, PALETTE } from '../core/config';

/**
 * A BÁZIS: ide kell hazavinni a rakományt.
 *
 * MINDENKINEK UGYANAZ a hely, és ez nem kényelmi döntés. Két külön bázissal
 * a hazaút két magánügy lenne, és a játék a ház ajtajában véget érne — így
 * viszont mindketten ugyanoda tartotok, és aki előbb ér oda, az előbb van
 * biztonságban.
 *
 * Messziről is látszania kell, különben a hazaút keresgélés. Ezért egy magas
 * fényoszlop jelöli: a város fölé ér, tehát bárhonnan megmutatja az irányt,
 * anélkül hogy a térképre kellene nézni.
 */
export class Base {
  readonly group = new THREE.Group();
  private clock = 0;

  constructor(readonly position: THREE.Vector3) {
    this.group.position.copy(position);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(DELIVERY.radius * 0.5, DELIVERY.radius, 40),
      new THREE.MeshBasicMaterial({
        color: PALETTE.p1,
        transparent: true,
        opacity: 0.4,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.4;
    ring.renderOrder = 2;
    ring.userData.cpNoOutline = true;
    this.group.add(ring);

    // A fényoszlop a VÁROS FÖLÉ ér: a házak 12–20 egység magasak, ez 90.
    // Egy alacsonyabb jelölést az első saroknál elnyelnének a tetők.
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 5.2, 90, 18, 1, true),
      new THREE.MeshBasicMaterial({
        color: PALETTE.p1,
        transparent: true,
        opacity: 0.12,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    beam.position.y = 45;
    beam.renderOrder = 2;
    beam.userData.cpNoOutline = true;
    this.group.add(beam);
  }

  update(dt: number): void {
    this.clock += dt;
    const beam = this.group.children[1] as THREE.Mesh;
    (beam.material as THREE.MeshBasicMaterial).opacity = 0.1 + Math.sin(this.clock * 1.3) * 0.04;
  }
}
