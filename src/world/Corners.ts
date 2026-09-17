import * as THREE from 'three';
import { CAPTURE, PALETTE } from '../core/config';
import type { Corner } from '../game/Capture';

/**
 * A KÉT SAROK: ide kell bevinni a cukorkát.
 *
 * Nem díszlet, hanem a pálya szerkezete. Két szabály dönti el, hol legyenek,
 * és mindkettő a játékról szól, nem a látványról:
 *
 *   TÁVOL EGYMÁSTÓL — különben a két sarok egy hely, és az egész cipelés
 *   elvész: felveszed, két lépés, letetted.
 *
 *   NEM EGYFORMA MESSZE A TÁLAKTÓL — de közel sem szabad egyformán rossznak
 *   lenniük. A cél az, hogy mindkettő MÁS utat kínáljon ugyanahhoz a
 *   cukorkához, mert abból lesz találkozás.
 *
 * A jelölés fentről is látszik (a minimapán) és belső nézetből is: egy
 * fényoszlop, ami a falon túlról is felismerhető. Egy sarok, amit keresni
 * kell, nem cél, hanem bosszúság.
 */

export class Corners {
  readonly group = new THREE.Group();
  readonly list: [Corner, Corner];

  constructor(spots: readonly THREE.Vector3[]) {
    const [a, b] = Corners.pick(spots);
    this.list = [
      { player: 0, position: a },
      { player: 1, position: b },
    ];
    this.group.add(this.pillar(a, PALETTE.p1));
    this.group.add(this.pillar(b, PALETTE.p2));
  }

  /**
   * A két legtávolabbi pont a felkínáltak közül.
   *
   * Nyers erő: a lista néhány tucat elemű (járőrpontok és cukorkahelyek),
   * tehát a teljes páronkénti összevetés olcsóbb, mint bármilyen okosság —
   * és pontosan azt adja, amit kérünk, nem egy közelítést.
   */
  private static pick(spots: readonly THREE.Vector3[]): [THREE.Vector3, THREE.Vector3] {
    if (spots.length < 2) {
      const only = spots[0]?.clone() ?? new THREE.Vector3();
      return [only, only.clone().add(new THREE.Vector3(10, 0, 0))];
    }
    let best: [THREE.Vector3, THREE.Vector3] = [spots[0], spots[1]];
    let far = -1;
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const d = spots[i].distanceToSquared(spots[j]);
        if (d > far) {
          far = d;
          best = [spots[i], spots[j]];
        }
      }
    }
    return [best[0].clone(), best[1].clone()];
  }

  /** Egy fényoszlop és egy padlógyűrű: fentről és szemből is látszik. */
  private pillar(at: THREE.Vector3, colour: number): THREE.Group {
    const group = new THREE.Group();
    group.position.copy(at);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(CAPTURE.bankRadius * 0.55, CAPTURE.bankRadius, 28),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.55,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.06;
    ring.userData.cpNoOutline = true;
    ring.renderOrder = 2;
    group.add(ring);

    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(CAPTURE.bankRadius * 0.5, CAPTURE.bankRadius * 0.62, 9, 16, 1, true),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity: 0.16,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    beam.position.y = 4.5;
    beam.userData.cpNoOutline = true;
    beam.renderOrder = 2;
    group.add(beam);

    return group;
  }

  /** Lüktetés: az élő cél jobban hívja a szemet, mint egy álló folt. */
  update(dt: number): void {
    this.clock += dt;
    this.group.children.forEach((pillar, i) => {
      const beam = pillar.children[1] as THREE.Mesh;
      const material = beam.material as THREE.MeshBasicMaterial;
      material.opacity = 0.12 + Math.sin(this.clock * 1.6 + i * 2) * 0.05;
    });
  }

  private clock = 0;
}
