import * as THREE from 'three';

/**
 * NYOMJELZŐ: a lövés látható csíkja.
 *
 * A lövés eddig egy hang volt és egy torkolattűz — a találatról csak a
 * következményből lehetett tudni, és ha a másik takarásban volt, semmiből.
 * Egy csík viszont MEGMUTATJA, merre ment a lövés, és a végén azt is, hogy
 * mibe csapódott.
 *
 * A SZÍN mondja meg az eredményt, mert egy szöveges felirat ehhez túl lassú:
 *   meleg narancs  — TALÁLAT
 *   halvány kék    — mellé ment
 *
 * Egyetlen `LineSegments`, előre lefoglalt szakaszokkal: lövésenként új
 * objektumot létrehozni ugyanaz a hiba volna, mint a fékcsíknál — a
 * szemétgyűjtő pont a legmozgalmasabb pillanatban kapna munkát.
 */

const MAX = 24;
/** Meddig látszik egy csík. Rövid: a nyomjelző nem díszítés, hanem jelzés. */
const LIFE = 0.14;

export class Tracer {
  readonly mesh: THREE.LineSegments;
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly ages: Float32Array;
  private next = 0;

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(MAX * 2 * 3);
    this.colours = new Float32Array(MAX * 2 * 3);
    this.ages = new Float32Array(MAX).fill(Infinity);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colours, 3));
    this.mesh = new THREE.LineSegments(
      geometry,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.userData.cpNoOutline = true;
  }

  /** Egy lövés nyoma. `hit` dönti el a színt — ez maga a visszajelzés. */
  add(from: THREE.Vector3, to: THREE.Vector3, hit: boolean): void {
    const i = this.next;
    this.next = (this.next + 1) % MAX;
    const p = this.positions;
    const o = i * 6;
    p[o] = from.x;
    p[o + 1] = from.y;
    p[o + 2] = from.z;
    p[o + 3] = to.x;
    p[o + 4] = to.y;
    p[o + 5] = to.z;

    const c = this.colours;
    // A csík a csővégnél halványabb, a becsapódásnál erősebb: így a szem a
    // VÉGÉT követi, és pont ott néz oda, ahol az eredmény eldől.
    const [r, g, b] = hit ? [1, 0.45, 0.16] : [0.55, 0.78, 1];
    c[o] = r * 0.35;
    c[o + 1] = g * 0.35;
    c[o + 2] = b * 0.35;
    c[o + 3] = r;
    c[o + 4] = g;
    c[o + 5] = b;

    this.ages[i] = 0;
    this.flush();
  }

  update(dt: number): void {
    let live = false;
    for (let i = 0; i < MAX; i++) {
      if (!Number.isFinite(this.ages[i])) continue;
      this.ages[i] += dt;
      if (this.ages[i] > LIFE) {
        // Elévült: a szakasz önmagára húzódik, tehát nem rajzolódik.
        const o = i * 6;
        for (let k = 0; k < 6; k++) this.positions[o + k] = 0;
        this.ages[i] = Infinity;
      }
      live = true;
    }
    if (live) this.flush();
  }

  private flush(): void {
    (this.mesh.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    (this.mesh.geometry.getAttribute('color') as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
