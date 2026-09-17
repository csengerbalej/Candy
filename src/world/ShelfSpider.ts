import * as THREE from 'three';
import { SpiderGait, type RigData } from '../render/SpiderGait';

/**
 * A PÓK A POLCON.
 *
 * Ha a falu egy befőttesüveg, akkor az üveg valahol áll — egy poros polcon.
 * És ami egy befőttesüveghez képest óriási, az egy pók: hozzánk mérve akkora,
 * mint egy felhőkarcoló, magához képest teljesen hétköznapi.
 *
 * Ez az egyetlen dolog a játékban, ami NEM a falu léptékében van, és pont
 * ezért működik: minden más azt sugallja, hogy a falu egy világ; a pók egy
 * pillanat alatt megmondja, hogy nem az — egy üveg egy polcon.
 *
 * Az üvegen KÍVÜL mászik, tehát soha nem veszély a szó játékbeli értelmében.
 * A fenyegetés nem az, hogy elkap; az, hogy ott van.
 *
 * A mozgás a gömbfelületen történik: a pók mindig az üveghez lapul, és
 * nagykörök mentén sétál egyik véletlen pontról a másikra. Ez azért fontos,
 * mert egy egyenes vonalú mozgás a gömbön átvágna az üvegen — a pók
 * belelógna a faluba, és a trükk azonnal szétesne.
 */
export class ShelfSpider {
  readonly group = new THREE.Group();

  /** A doboz-pók lábai. Csak addig él, amíg a modell be nem tölt. */
  private readonly legs: THREE.Object3D[] = [];
  /** Mennyit haladt az utolsó képkockában — a járás ebből lép. */
  private travelled = 0;
  /** Egy teljes lépésciklus alatt megtett út. */
  private readonly stride: number;
  /** A valódi pók csontváza, ha megérkezett. */
  private gait: SpiderGait | null = null;
  private blockout: THREE.Object3D | null = null;
  /** Mennyire mászik épp: a járás ütemét ez adja. */
  private moving = 0;
  /**
   * A modell „előre" tengelye, mérésből (tools/spider-rig.py).
   *
   * Amíg csak a felület normálisához igazítottam, a pók lapult az üveghez, de
   * tetszőleges irányba nézett — a felhasználó szava: „háttal megy". A
   * haladási irányt is meg kell adni, és ahhoz tudni kell, merre van a pók
   * eleje. Ezt nem tippeljük: az ELSŐ és a HÁTSÓ lábak töve közti vektor
   * mondja meg, és a mérés a modell mellé kerül.
   */
  private forward = new THREE.Vector3(0, 0, -1);
  /** A haladás érintőiránya a gömbön, simítva. */
  private readonly heading = new THREE.Vector3(1, 0, 0);
  /** Merre áll most a gömbön (egységvektor) és hova tart. */
  private readonly at = new THREE.Vector3(0.6, 0.55, 0.6).normalize();
  private readonly target = new THREE.Vector3();
  private pause = 0;
  private clock = 0;

  constructor(
    private readonly radius: number,
    private readonly height: number,
    scale: number
  ) {
    this.stride = scale * 1.1;

    const dark = new THREE.MeshBasicMaterial({ color: 0x0a0710 });

    // A test: két lapított gömb. Nem részletes, és nem is kell annak lennie —
    // üvegen keresztül, ellenfényben egy SZILUETT, és a sziluettet a lábak
    // adják, nem a potroh.
    const abdomen = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.62, 12, 9), dark);
    abdomen.position.set(0, 0, -scale * 0.55);
    abdomen.scale.set(1, 0.72, 1.25);
    this.group.add(abdomen);

    const thorax = new THREE.Mesh(new THREE.SphereGeometry(scale * 0.38, 10, 8), dark);
    thorax.position.set(0, 0, scale * 0.3);
    thorax.scale.set(1, 0.7, 1);
    this.group.add(thorax);

    // Nyolc láb, oldalanként négy. Mindegyik két ízből áll — egy felfelé, egy
    // lefelé —, mert egy egyenes láb pálcikának látszik, egy tört pedig
    // pókénak.
    for (const side of [-1, 1]) {
      for (let i = 0; i < 4; i++) {
        const hip = new THREE.Group();
        hip.position.set(side * scale * 0.3, 0, scale * (0.42 - i * 0.28));
        hip.rotation.y = side * (0.5 - i * 0.34);

        const upper = new THREE.Mesh(
          new THREE.BoxGeometry(scale * 0.09, scale * 0.09, scale * 1.15),
          dark
        );
        upper.position.set(side * scale * 0.5, scale * 0.42, 0);
        upper.rotation.z = side * -0.72;
        upper.rotation.x = Math.PI / 2;
        hip.add(upper);

        const lower = new THREE.Mesh(
          new THREE.BoxGeometry(scale * 0.07, scale * 0.07, scale * 1.35),
          dark
        );
        lower.position.set(side * scale * 1.15, scale * 0.12, 0);
        lower.rotation.z = side * 0.95;
        lower.rotation.x = Math.PI / 2;
        hip.add(lower);

        this.group.add(hip);
        this.legs.push(hip);
      }
    }

    this.blockout = new THREE.Group();
    for (const child of [...this.group.children]) this.blockout.add(child);
    this.group.add(this.blockout);

    this.pickTarget();
    this.place();
  }

  /**
   * A megsütött pók a helyettesítő kockák helyére.
   *
   * A tok addig marad, amíg a modell be nem tölt — nem kényelemből: a pók az
   * üvegen kívül az egyetlen dolog, ami elárulja, hogy a falu egy befőtt egy
   * polcon. Ha a betöltésig üres lenne az ég, a játékos pont az első
   * másodpercekben tanulná meg, hogy odakint nincs semmi.
   */
  setArt(art: THREE.Object3D, rig: RigData): void {
    if (this.blockout) {
      this.group.remove(this.blockout);
      this.blockout.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) mesh.geometry?.dispose?.();
      });
      this.blockout = null;
    }
    this.legs.length = 0;
    this.group.add(art);
    if (rig.forward) this.forward.fromArray(rig.forward).normalize();
    this.gait = new SpiderGait(art, rig);
  }

  /**
   * Új úti cél a gömb felső felén.
   *
   * Csak a felső felén: az alsó fele a polc, ott nem mászkálhat. A szűrés
   * azért kell, mert egy egyenletes gömbi véletlen az idő felében a talaj alá
   * küldené, és a pók eltűnne percekre.
   */
  private pickTarget(): void {
    const theta = Math.random() * Math.PI * 2;
    const y = 0.12 + Math.random() * 0.8;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    this.target.set(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize();
    // Néha megáll. Egy folyamatosan haladó pók gépnek látszik; egy megálló,
    // aztán hirtelen elinduló rovarnak.
    this.pause = Math.random() < 0.35 ? 1.5 + Math.random() * 3 : 0;
  }

  /** A pókot a gömbre ülteti, a felszínre lapulva. */
  private place(): void {
    const dir = this.at;
    // Az ellipszoid miatt a magassági tengely másképp skálázódik.
    //
    // A szorzó nem kozmetika: a modell origója a pók TALPÁN van, tehát a
    // testének kifelé kell nőnie az üvegtől. Egy hajszállal kijjebb téve a
    // has az üveghez ér, nem félig bele.
    this.group.position.set(
      dir.x * this.radius * 1.02,
      dir.y * this.height * 1.02,
      dir.z * this.radius * 1.02
    );
    // A pók „fent" iránya a felszíni normális — kifelé.
    const up = new THREE.Vector3(
      dir.x / this.radius,
      dir.y / this.height,
      dir.z / this.radius
    ).normalize();
    // Két dolgot kell egyszerre teljesíteni: a pók HASA az üveg felé nézzen,
    // és az ELEJE arra, amerre megy. Egy sima „fel-vektort a normálisra"
    // forgatás csak az elsőt adja meg, a másodikat a véletlenre bízza.
    const tangent = this.heading.clone().projectOnPlane(up);
    if (tangent.lengthSq() < 1e-6) tangent.set(up.z, 0, -up.x).projectOnPlane(up);
    tangent.normalize();

    // A lookAt a -Z tengelyt fordítja a CÉLPONT felé, tehát a célpont maga a
    // haladási irány. Elsőre megfordítottam — a próba pontosan 180 fokot
    // mért, vagyis a pók tökéletesen háttal mászott.
    const basis = new THREE.Matrix4().lookAt(new THREE.Vector3(), tangent, up);
    const quat = new THREE.Quaternion().setFromRotationMatrix(basis);
    const correction = new THREE.Quaternion().setFromUnitVectors(
      this.forward,
      new THREE.Vector3(0, 0, -1)
    );
    this.group.quaternion.copy(quat).multiply(correction);
  }

  update(dt: number): void {
    this.clock += dt;

    const wasMoving = this.pause <= 0 ? 1 : 0;
    this.moving += (wasMoving - this.moving) * (1 - Math.exp(-4 * dt));

    if (this.pause > 0) {
      this.pause -= dt;
    } else {
      // Nagykör mentén, lassan. A sebesség szándékosan alacsony: egy gyors
      // pók komikus, egy lassú nyugtalanító.
      const step = 0.055 * dt;
      const remaining = this.at.angleTo(this.target);
      if (remaining < step * 2) this.pickTarget();
      else {
        const before = this.at.clone();
        this.at.lerp(this.target, Math.min(1, step / Math.max(1e-4, remaining)));
        this.at.normalize();
        // A haladási irány a KÉT egymás utáni helyzetből jön, világtérben.
        // Simítva, mert a kanyarodás közben az irány ugrálna, és a pók
        // rángatná a fejét.
        const moved = new THREE.Vector3(
          (this.at.x - before.x) * this.radius,
          (this.at.y - before.y) * this.height,
          (this.at.z - before.z) * this.radius
        );
        // Mennyit haladt VILÁGTÉRBEN ebben a képkockában — a lépés ehhez
        // kötődik, nem az órához, különben a talpak csúsznak.
        this.travelled = moved.length();
        if (moved.lengthSq() > 1e-10) {
          this.heading.lerp(moved.normalize(), 1 - Math.exp(-3 * dt)).normalize();
        }
      }
      this.place();
    }

    if (this.gait) {
      // A LÉPÉSHOSSZ a pók méretéből jön: egy teljes lépésciklus alatt
      // nagyjából egy testhossznyit halad. Beírt szám helyett ez az, ami
      // magától együtt mozog a mérettel.
      this.gait.update(dt, this.moving, this.travelled, this.stride);
      return;
    }

    // A helyettesítő kockák lábmozgása, amíg a modell be nem tölt.
    const moving = this.pause > 0 ? 0.25 : 1;
    this.legs.forEach((leg, i) => {
      const phase = this.clock * 2.6 + i * 0.8;
      leg.rotation.x = Math.sin(phase) * 0.16 * moving;
      leg.position.y = Math.abs(Math.sin(phase)) * 0.12 * moving;
    });
  }
}
