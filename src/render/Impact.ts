import * as THREE from 'three';

/**
 * BECSAPÓDÁS: ami a csík VÉGÉN történik.
 *
 * A nyomjelző megmutatja, MERRE ment a lövés; ez azt, hogy MIBE. A kettő
 * együtt adja a visszajelzést, és fegyverenként mást kell mondaniuk:
 *
 *   sörétes      sok apró szem szóródik szét — ez maga a sörét
 *   mesterlövész egyetlen éles szikra, semmi több: ő pontosság, nem tűzijáték
 *   rakétavető   TERJEDŐ GYŰRŰ és villanás — a robbanás sugara látható is,
 *                nem csak számít
 *
 * Egyetlen pontfelhő és egy gyűrű, előre lefoglalva: a becsapódás a
 * legmozgalmasabb pillanat, és pont ott nem szabad se objektumot gyártani,
 * se szemétgyűjtőt hívni.
 */

const SPARKS = 160;
const RINGS = 6;

interface Ring {
  mesh: THREE.Mesh;
  age: number;
  life: number;
  size: number;
}

export class Impact {
  readonly group = new THREE.Group();

  private readonly points: THREE.Points;
  private readonly positions: Float32Array;
  private readonly velocities: Float32Array;
  private readonly ages: Float32Array;
  private next = 0;
  private readonly rings: Ring[] = [];

  constructor() {
    const geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(SPARKS * 3);
    this.velocities = new Float32Array(SPARKS * 3);
    this.ages = new Float32Array(SPARKS).fill(Infinity);
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.09,
        color: 0xffd9a8,
        transparent: true,
        opacity: 0.95,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    this.points.frustumCulled = false;
    this.points.userData.cpNoOutline = true;
    this.group.add(this.points);

    for (let i = 0; i < RINGS; i++) {
      const mesh = new THREE.Mesh(
        new THREE.RingGeometry(0.6, 1, 24),
        new THREE.MeshBasicMaterial({
          color: 0xff9a45,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        })
      );
      mesh.visible = false;
      mesh.userData.cpNoOutline = true;
      this.group.add(mesh);
      this.rings.push({ mesh, age: Infinity, life: 0.45, size: 1 });
    }
  }

  /**
   * @param kind A fegyver fajtája — ez dönti el, mit látsz.
   * @param normal Amerre a lövés ment: a szemek EBBE az irányba pattannak
   * vissza, szórva. Enélkül a szikrák a falba szóródnának.
   */
  burst(kind: 'shotgun' | 'sniper' | 'rocket', at: THREE.Vector3, normal: THREE.Vector3): void {
    const shape = {
      shotgun: { count: 26, speed: 7, spread: 1, colour: 0xffd9a8 },
      sniper: { count: 8, speed: 10, spread: 0.35, colour: 0xbff3ff },
      rocket: { count: 46, speed: 12, spread: 1.4, colour: 0xff9a45 },
    }[kind];

    (this.points.material as THREE.PointsMaterial).color.setHex(shape.colour);

    const back = normal.clone().multiplyScalar(-1).normalize();
    for (let i = 0; i < shape.count; i++) {
      const k = this.next;
      this.next = (this.next + 1) % SPARKS;
      this.positions[k * 3] = at.x;
      this.positions[k * 3 + 1] = at.y;
      this.positions[k * 3 + 2] = at.z;
      // Visszapattanás a becsapódás irányából, szórva: a szórás a fegyveré.
      const v = back
        .clone()
        .add(
          new THREE.Vector3(
            (Math.random() - 0.5) * shape.spread,
            Math.random() * shape.spread * 0.8,
            (Math.random() - 0.5) * shape.spread
          )
        )
        .normalize()
        .multiplyScalar(shape.speed * (0.5 + Math.random() * 0.8));
      this.velocities[k * 3] = v.x;
      this.velocities[k * 3 + 1] = v.y;
      this.velocities[k * 3 + 2] = v.z;
      this.ages[k] = 0;
    }

    // A RAKÉTA gyűrűje: a robbanás sugara látható lesz, nem csak számít.
    if (kind === 'rocket') this.ring(at, 5);
  }

  private ring(at: THREE.Vector3, size: number): void {
    const free = this.rings.find((r) => !Number.isFinite(r.age)) ?? this.rings[0];
    free.mesh.position.copy(at);
    free.mesh.rotation.x = -Math.PI / 2;
    free.age = 0;
    free.size = size;
    free.mesh.visible = true;
  }

  update(dt: number): void {
    let live = false;
    for (let i = 0; i < SPARKS; i++) {
      if (!Number.isFinite(this.ages[i])) continue;
      this.ages[i] += dt;
      if (this.ages[i] > 0.55) {
        this.ages[i] = Infinity;
        // A szem a semmibe kerül: nem rajzolódik, de nem is kell törölni.
        this.positions[i * 3 + 1] = -999;
        live = true;
        continue;
      }
      this.velocities[i * 3 + 1] -= 22 * dt; // gravitáció
      this.positions[i * 3] += this.velocities[i * 3] * dt;
      this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
      this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;
      live = true;
    }
    if (live) {
      (this.points.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }

    for (const r of this.rings) {
      if (!Number.isFinite(r.age)) continue;
      r.age += dt;
      const t = r.age / r.life;
      if (t >= 1) {
        r.age = Infinity;
        r.mesh.visible = false;
        continue;
      }
      // Gyorsan tágul, és közben elhalványul: a szem a SZÉLÉT követi, és
      // pont annyit lát belőle, amekkora a robbanás.
      const scale = 0.2 + t * r.size;
      r.mesh.scale.setScalar(scale);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = (1 - t) * 0.8;
    }
  }

  dispose(): void {
    this.points.geometry.dispose();
    (this.points.material as THREE.Material).dispose();
    for (const r of this.rings) r.mesh.geometry.dispose();
    this.group.clear();
  }
}
