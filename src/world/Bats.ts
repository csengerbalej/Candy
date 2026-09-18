import * as THREE from 'three';

/**
 * DENEVÉREK AZ ÉGEN.
 *
 * Az ég eddig néma háttér volt: szép, de halott. Egy Halloween-éjszakán
 * pont az égnek kell élnie — ez az a felület, amit vezetés közben a
 * legtöbbet látsz, és amin a leginkább feltűnik, ha SEMMI nem mozog rajta.
 *
 * MIÉRT NINCS HOZZÁ MODELL. Egy denevér ebben a játékban soha nincs
 * közelebb húsz egységnél, és ott már csak sziluett: két háromszög, ami
 * csapkod. Egy letöltött, ezer háromszögű denevérmodell ugyanígy nézne ki,
 * csak ötszázszor annyiba kerülne — és pont most vettem el a szörnyecskék
 * millió háromszögét azért, hogy ne akadozzon.
 *
 * A csapkodást a VERTEX SHADER csinálja, nem a processzor: a szárnyak
 * hegyét az idő függvényében hajlítja, denevérenként más fázissal. Így egy
 * rajnyi denevér EGYETLEN rajzolási hívás, és a processzor közben semmit
 * nem csinál velük.
 */
export class Bats {
  readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private readonly mesh: THREE.InstancedMesh;
  private readonly orbit: { radius: number; height: number; speed: number; phase: number }[] = [];
  private clock = 0;

  /**
   * @param count Hány denevér. Harminc pont annyi, hogy az ég bármelyik
   * irányában legyen egy-kettő, de ne legyen belőle madárraj.
   */
  constructor(count = 30, private readonly random: () => number = Math.random) {
    // EGY DENEVÉR: két háromszög, közös törzsél mentén. Az x koordináta
    // előjele mondja meg, melyik szárny — ezt használja a shader.
    const geometry = new THREE.BufferGeometry();
    const w = 0.55;
    const positions = new Float32Array([
      0, 0, -0.18, -w, 0, 0.1, 0, 0, 0.16,
      0, 0, -0.18, 0, 0, 0.16, w, 0, 0.1,
    ]);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Denevérenként egy fázis, hogy ne egyszerre csapkodjanak. Egy raj,
    // ami ütemre mozog, gépnek látszik, nem élőlénynek.
    const phase = new Float32Array(count);
    for (let i = 0; i < count; i++) phase[i] = this.random() * Math.PI * 2;
    geometry.setAttribute('fazis', new THREE.InstancedBufferAttribute(phase, 1));

    this.material = new THREE.ShaderMaterial({
      uniforms: { ido: { value: 0 }, szin: { value: new THREE.Color(0x120a1c) } },
      vertexShader: `
        attribute float fazis;
        uniform float ido;
        void main() {
          vec3 p = position;
          // A SZÁRNY HEGYE emelkedik-süllyed, a törzs nem mozdul. A hajlítás
          // az x abszolút értékével arányos: a törzsnél nulla, a hegyénél
          // teljes — ettől hajlik a szárny, nem törik.
          p.y += sin(ido * 9.0 + fazis) * abs(p.x) * 0.9;
          gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 szin;
        void main() { gl_FragColor = vec4(szin, 1.0); }
      `,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.InstancedMesh(geometry, this.material, count);
    // A denevér az ÉGEN van, nem a világban: nem vet árnyékot (ahhoz túl
    // messze van) és a levágásból is kimarad, mert körben repül a kamera
    // körül — a befoglalója amúgy is mindig metszené a képet.
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);

    for (let i = 0; i < count; i++) {
      this.orbit.push({
        radius: 45 + this.random() * 130,
        height: 26 + this.random() * 30,
        // Váltakozó irány: a fele az óramutatóval, a fele ellene. Enélkül
        // az egész raj egy irányba sodródna, mint egy körhinta.
        speed: (0.06 + this.random() * 0.12) * (this.random() < 0.5 ? 1 : -1),
        phase: this.random() * Math.PI * 2,
      });
    }
  }

  /**
   * @param around A kamera (vagy az autó) helye. A denevérek KÖRÜLÖTTE
   * keringenek, nem a város közepe fölött: a városban bárhol jársz, legyen
   * fölötted néhány. Ugyanaz a trükk, mint a csillagos égnél — a végtelen
   * eget nem kitölteni kell, hanem követni.
   */
  update(dt: number, around: THREE.Vector3): void {
    this.clock += dt;
    this.material.uniforms.ido.value = this.clock;

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < this.orbit.length; i++) {
      const o = this.orbit[i];
      const angle = o.phase + this.clock * o.speed;
      const x = around.x + Math.cos(angle) * o.radius;
      const z = around.z + Math.sin(angle) * o.radius;
      // Enyhe hullámzás függőlegesen: egy vízszintes körön repülő denevér
      // papírrepülő, nem állat.
      const y = o.height + Math.sin(this.clock * 0.8 + o.phase) * 2.5;
      // Arra fordul, amerre megy — a keringés érintője.
      quaternion.setFromAxisAngle(up, -angle - (o.speed > 0 ? Math.PI / 2 : -Math.PI / 2));
      matrix.compose(new THREE.Vector3(x, y, z), quaternion, new THREE.Vector3(3.2, 3.2, 3.2));
      this.mesh.setMatrixAt(i, matrix);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Hány denevér repül — a mérésnek. */
  get count(): number {
    return this.orbit.length;
  }

  /** Hol van az i. denevér — a próba ezzel nézi meg, hogy tényleg mozog. */
  positionOf(i: number): THREE.Vector3 {
    const matrix = new THREE.Matrix4();
    this.mesh.getMatrixAt(i, matrix);
    return new THREE.Vector3().setFromMatrixPosition(matrix);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
