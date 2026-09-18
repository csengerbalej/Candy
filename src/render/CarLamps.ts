import * as THREE from 'three';

/**
 * LÁMPÁK EGY NPC AUTÓRA: fényszóró elöl, hátsó lámpa hátul.
 *
 * Éjszaka egy autó, aminek nincs lámpája, nem autó, hanem egy doboz, ami
 * csúszik az úton. A lámpa ráadásul INFORMÁCIÓ is: messziről a fényéről
 * tudod meg, hogy jön valaki, és a féklámpáról, hogy lassít.
 *
 * Nem valódi fényforrás, hanem világító lap. Egy tizenkét autós városban
 * huszonnégy pontfény a képkockaidő fele lenne — a lapok viszont ingyen
 * vannak, és éjjel ugyanazt mondják.
 */

export interface Lamps {
  /** Ki- és bekapcsolja a féklámpát. */
  setBraking(on: boolean): void;
}

export function addLamps(car: THREE.Object3D, length = 4.3, width = 1.9): Lamps {
  const brakes: THREE.Mesh[] = [];

  const quad = (colour: number, opacity: number, w: number, h: number): THREE.Mesh =>
    new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({
        color: colour,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

  for (const side of [-1, 1]) {
    // FÉNYSZÓRÓ: meleg fehér, elöl.
    const head = quad(0xfff2cf, 0.85, 0.34, 0.16);
    head.position.set(side * width * 0.32, 0.62, length * 0.5);
    head.userData.cpNoOutline = true;
    car.add(head);

    // FÉNYKÚP NINCS.
    //
    // Először tettem egy hosszú, halvány lapot a fényszóró elé, hogy
    // látsszon: világít. A gyakorlatban viszont az aszfaltra FEKTETVE nagy
    // fakó foltként terült szét — huszonegy autónál az egész úttest csíkos
    // lett, és a játékos jogosan kérdezte, mik azok. A lámpa maga elég:
    // éjjel egy világító pont pontosan annyit mond, amennyit kell.

    // HÁTSÓ LÁMPA: mindig halványan ég, fékezéskor felizzik.
    const tail = quad(0xff2b18, 0.45, 0.3, 0.14);
    tail.position.set(side * width * 0.32, 0.62, -length * 0.5);
    tail.rotation.y = Math.PI;
    tail.userData.cpNoOutline = true;
    car.add(tail);
    brakes.push(tail);
  }

  return {
    setBraking(on: boolean): void {
      for (const t of brakes) {
        (t.material as THREE.MeshBasicMaterial).opacity = on ? 1 : 0.45;
        t.scale.setScalar(on ? 1.35 : 1);
      }
    },
  };
}
