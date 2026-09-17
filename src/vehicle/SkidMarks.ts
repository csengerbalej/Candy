import * as THREE from 'three';
import { CAR } from '../core/config';

/**
 * FÉKCSÍK az aszfalton.
 *
 * A driftnek eddig egyetlen nyoma volt: a karosszéria dőlése. Az útnak nem
 * maradt emléke arról, hogy ott valaki csúszott — így a kanyar, amit jól
 * vettél, egy pillanattal később már meg sem történt.
 *
 * Nincs részecskerendszer a projektben, és ehhez nem is kell: a fékcsík nem
 * részecske, hanem SZALAG. A megoldás egyetlen, előre lefoglalt geometria,
 * amiben a lenyomatok gyűrűben körbeérnek — így a legrégebbi nyom helyére
 * kerül az új. Se új objektum, se szemétgyűjtés, se képkockánként növekvő
 * rajzolási lista: egy darab háló, örökké ugyanaz.
 *
 * Négy nyom készül képkockánként (a négy kerék), és a nyom SÖTÉTEDIK, majd
 * elhalványul — ez a „friss gumi" és a „tíz másodperce itt jártam" közti
 * különbség.
 */

/** Hány lenyomat fér el egyszerre. Négy kerék × 150 lépés. */
const STAMPS = 600;
/** Meddig él egy nyom, másodpercben. */
const LIFE = 9;
/** Milyen sűrűn kerül le egy új lenyomat, méterben. */
const SPACING = 0.42;

interface Wheel {
  /** Hol tette le az utolsó lenyomatát — ebből jön a szalag iránya. */
  last: THREE.Vector3 | null;
}

export class SkidMarks {
  readonly mesh: THREE.Mesh;

  private readonly positions: Float32Array;
  private readonly ages: Float32Array;
  private readonly alpha: Float32Array;
  private readonly geometry: THREE.BufferGeometry;
  private next = 0;
  private readonly wheels: Wheel[] = [{ last: null }, { last: null }, { last: null }, { last: null }];

  constructor() {
    this.geometry = new THREE.BufferGeometry();
    this.positions = new Float32Array(STAMPS * 6 * 3);
    this.alpha = new Float32Array(STAMPS * 6);
    this.ages = new Float32Array(STAMPS).fill(Infinity);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    // Saját árnyaló, mert a nyom átlátszósága CSÚCSONKÉNT változik: egy
    // anyagszintű `opacity` az egész szalagot egyszerre halványítaná, és a
    // frissen letett nyom ugyanúgy tűnne el, mint a tíz másodperces.
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      // Először SÖTÉTÍTŐ keverést használtam — ez a fizikailag helyes: a gumi
      // korom, nem festék. A játékban viszont láthatatlan lett, és ezt mérni
      // kellett hozzá: az éjszakai aszfalt maga is majdnem fekete, tehát egy
      // sötétítő nyomnak nincs mit elvennie. Ami sötétebb a feketénél, az
      // nem nyom, hanem semmi.
      //
      // Ezért a nyom most egy matt, hűvös szürke CSÍK, normál keveréssel: az
      // aszfaltnál világosabb, a fűnél sötétebb, és mindkettőn látszik.
      blending: THREE.NormalBlending,
      // KÉTOLDALÚ. A négyszögek körüljárási iránya a kocsi haladásától függ
      // (jobbra vagy balra csúszik), tehát az egyik kanyarban a lap FELFELÉ
      // néz, a másikban lefelé — egyoldalú anyaggal a nyom fele egyszerűen
      // eltűnne, méghozzá kiszámíthatatlanul.
      side: THREE.DoubleSide,
      // Sokszög-eltolás z-villogás ellen: a nyom az úttal PÁRHUZAMOS, és egy
      // ujjnyi emelés ferde nézetből még mindig belevillan az aszfaltba.
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -4,
      vertexShader: `
        attribute float aAlpha;
        varying float vAlpha;
        void main() {
          vAlpha = aAlpha;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: `
        varying float vAlpha;
        void main() {
          // Hűvös szürke, enyhe lila felhanggal: ugyanabba a világba tartozik,
          // mint az út, csak világosabb nála.
          gl_FragColor = vec4(vec3(0.30, 0.27, 0.36), vAlpha);
        }`,
    });

    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    // A nyom az ÁTLÁTSZÓ menetben rajzolódik, az út UTÁN.
    //
    // Először −1 volt, hogy „a talajra simuljon" — és ettől lett láthatatlan:
    // a negatív sorszám az átlátszatlan út ELÉ vitte, az út pedig szépen
    // ráfestett. Mérve: 600 lenyomat élt a pufferben, a képen semmi.
    this.mesh.renderOrder = 2;
    this.mesh.userData.cpNoOutline = true;
  }

  /**
   * @param groundAt Az ÚT SZINTJE az adott pontban.
   *
   * Nem a kocsi `position.y`-ja, és ez mérve derült ki: a kocsi nulla
   * magasságban áll, az aszfalt teteje viszont 0,353-nál van (a járdaszegély
   * magassága). A nyom így harminc centivel az út ALATT készült — létezett,
   * élt, öregedett, és soha senki nem láthatta. A talajt tehát meg kell
   * kérdezni, nem levezetni.
   */
  update(
    dt: number,
    car: { position: THREE.Vector3; heading: number; slip: number; airborne: boolean },
    groundAt: (x: number, z: number) => number = () => 0
  ): void {
    // Öregítés: minden nyom halványodik, akkor is, ha épp nem teszünk le újat.
    const attr = this.geometry.getAttribute('aAlpha') as THREE.BufferAttribute;
    let touched = false;
    for (let i = 0; i < STAMPS; i++) {
      if (!Number.isFinite(this.ages[i])) continue;
      this.ages[i] += dt;
      const t = 1 - this.ages[i] / LIFE;
      const a = t <= 0 ? 0 : Math.min(1, t) * 0.42;
      for (let v = 0; v < 6; v++) this.alpha[i * 6 + v] = a;
      if (a <= 0) this.ages[i] = Infinity;
      touched = true;
    }

    if (car.slip > 0.3 && !car.airborne) {
      const sin = Math.sin(car.heading);
      const cos = Math.cos(car.heading);
      const halfW = CAR.width * 0.45;
      const halfL = CAR.length * 0.34;
      for (let w = 0; w < 4; w++) {
        const sx = w % 2 === 0 ? -1 : 1;
        const sz = w < 2 ? -1 : 1;
        const x = car.position.x + cos * (sx * halfW) + sin * (sz * halfL);
        const z = car.position.z - sin * (sx * halfW) + cos * (sz * halfL);
        const at = new THREE.Vector3(x, groundAt(x, z) + 0.02, z);
        const wheel = this.wheels[w];
        if (wheel.last && wheel.last.distanceTo(at) < SPACING) continue;
        if (wheel.last) {
          this.stamp(wheel.last, at, car.slip);
          touched = true;
        }
        wheel.last = at;
      }
    } else {
      // Kiengedve elszakad a szalag: különben a következő csúszás egy hosszú
      // egyenessel kötődne az előzőhöz, a fél városon át.
      for (const wheel of this.wheels) wheel.last = null;
    }

    if (touched) {
      attr.needsUpdate = true;
      (this.geometry.getAttribute('position') as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  /** Egy szalagdarab a-tól b-ig, két háromszögből. */
  private stamp(a: THREE.Vector3, b: THREE.Vector3, slip: number): void {
    const i = this.next;
    this.next = (this.next + 1) % STAMPS;

    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz) || 1;
    // Merőleges, fél szélességre. Erősebb csúszás = szélesebb nyom.
    const w = (0.09 + slip * 0.07) / len;
    const px = -dz * w;
    const pz = dx * w;

    const p = this.positions;
    const o = i * 18;
    const quad = [
      [a.x - px, a.y, a.z - pz],
      [a.x + px, a.y, a.z + pz],
      [b.x + px, b.y, b.z + pz],
      [a.x - px, a.y, a.z - pz],
      [b.x + px, b.y, b.z + pz],
      [b.x - px, b.y, b.z - pz],
    ];
    for (let v = 0; v < 6; v++) {
      p[o + v * 3] = quad[v][0];
      p[o + v * 3 + 1] = quad[v][1];
      p[o + v * 3 + 2] = quad[v][2];
    }
    this.ages[i] = 0;
    const a0 = 0.42;
    for (let v = 0; v < 6; v++) this.alpha[i * 6 + v] = a0;
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
