import * as THREE from 'three';

/**
 * Milyen lábakat talált a mérés. Lásd tools/spider-rig.py.
 *
 * A Meshy automatikus rigje általános neveket ad (Bone_000…), tehát a lábakat
 * nem lehet névről felismerni. Offline megmérjük — melyik csont szakad el a
 * test hossztengelyétől —, és az eredményt a modell mellé tesszük. A futásidő
 * ezt OLVASSA: nem talál ki semmit, tehát nem is tud félremenni.
 */
export interface RigData {
  legs: Array<{ bones: string[]; side: 'left' | 'right'; front: number }>;
  /** A modell „előre" tengelye, mérésből. Régi fájlokban hiányozhat. */
  forward?: [number, number, number];
}

interface Leg {
  bones: THREE.Bone[];
  rest: THREE.Quaternion[];
  /** Lengetés és emelés tengelye a comb SZÜLŐJÉNEK terében. */
  swing: THREE.Vector3;
  lift: THREE.Vector3;
  /** Melyik ütemben lép. Szomszédos lábak sosem egyszerre. */
  phase: number;
}

/**
 * Pókjárás.
 *
 * Nem ciklus-klip, hanem számolt mozgás, és ennek oka van: a pók egy GÖMBÖN
 * mászik tetszőleges irányba, néha megáll, néha nekiiramodik. Egy rögzített
 * járásklip vagy csúszna a felület fölött, vagy minden irányhoz külön kellene.
 *
 * A ritmus VÁLTAKOZÓ NÉGYES — ahogy egy valódi póké: a bal 1., 3. és a jobb
 * 2., 4. láb együtt lép, aztán a másik négy. Ez az egyetlen dolog, amitől a
 * mozgás rovarnak látszik és nem egy remegő tárgynak; nyolc egyszerre emelt
 * láb ugrálás, nem járás.
 */
export class SpiderGait {
  private readonly legs: Leg[] = [];
  private clock = 0;

  constructor(root: THREE.Object3D, rig: RigData) {
    const byName = new Map<string, THREE.Bone>();
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) byName.set(o.name, o as THREE.Bone);
    });

    root.updateWorldMatrix(true, true);
    const up = new THREE.Vector3(0, 1, 0);

    rig.legs.forEach((spec, index) => {
      const bones = spec.bones.map((n) => byName.get(n)).filter(Boolean) as THREE.Bone[];
      if (bones.length < 2) return;

      const femur = bones[0];
      const tip = bones[bones.length - 1];

      // A lengetés tengelye a pók FÜGGŐLEGESE, az emelésé arra és a lábra is
      // merőleges. Világtérben számoljuk, aztán átvisszük a comb szülőjének
      // terébe — egy csont forgatása ugyanis ott értelmezett, és a csontok
      // saját tengelyei automatikus rignél kiszámíthatatlanok.
      const hip = new THREE.Vector3();
      const toe = new THREE.Vector3();
      femur.getWorldPosition(hip);
      tip.getWorldPosition(toe);
      const outward = toe.sub(hip).setY(0).normalize();

      const parentQuat = new THREE.Quaternion();
      (femur.parent ?? root).getWorldQuaternion(parentQuat);
      const toParent = parentQuat.invert();

      const swing = up.clone().applyQuaternion(toParent).normalize();
      const lift = new THREE.Vector3().crossVectors(up, outward).applyQuaternion(toParent).normalize();

      // Váltakozó négyes: az oldal és a sorszám együtt dönt.
      const group = (index % 4 + (spec.side === 'right' ? 1 : 0)) % 2;

      this.legs.push({
        bones,
        rest: bones.map((b) => b.quaternion.clone()),
        swing,
        lift,
        phase: group * Math.PI,
      });
    });
  }

  /** Hány lábat sikerült bekötni. A próba ezt kéri számon. */
  get legCount(): number {
    return this.legs.length;
  }

  /**
   * @param dt     eltelt idő
   * @param moving 0 = áll, 1 = teljes iramban mászik
   */
  /**
   * @param travelled Mennyit haladt a pók ebben a képkockában, egységben.
   * @param stride    Mekkora utat tesz meg egy teljes lépésciklus alatt.
   *
   * A LÉPÉS A MEGTETT ÚTHOZ kötődik, nem az órához.
   *
   * Eddig a lábak fix ütemben lengtek, a test meg állandó sebességgel
   * haladt — a kettőnek semmi köze nem volt egymáshoz, tehát a talpak
   * FOLYAMATOSAN CSÚSZTAK a felületen. Ez az, amit „bugos mászásnak" látni:
   * nem a lábak mozgása rossz, hanem az, hogy nem érnek a talajhoz.
   *
   * Így viszont egy lépés mindig ugyanakkora utat jelent, akármilyen gyorsan
   * megy — pontosan úgy, ahogy egy valódi lábnak kell.
   */
  update(dt: number, moving: number, travelled = 0, stride = 1): void {
    // Az út szerinti léptetés mellett marad egy pici, idő szerinti mocorgás:
    // egy tökéletesen mozdulatlan pók halottnak látszik.
    this.clock += (travelled / Math.max(0.001, stride)) * Math.PI * 2 + dt * 1.2;
    const amplitude = 0.06 + moving * 0.26;

    const delta = new THREE.Quaternion();
    const step = new THREE.Quaternion();

    for (const leg of this.legs) {
      const t = this.clock + leg.phase;
      const forward = Math.sin(t) * amplitude;
      // Az emelés csak a lépés ELSŐ felében van: a láb fölemelkedik, előre
      // lendül, letesz, és a földön HÚZZA hátra. Egy szinuszos emelés a
      // visszafelé úton is fölemelné, amitől a pók evezne, nem járna.
      const raise = Math.max(0, Math.sin(t)) * amplitude * 1.35;

      delta.setFromAxisAngle(leg.swing, forward);
      step.setFromAxisAngle(leg.lift, raise);
      delta.multiply(step);
      leg.bones[0].quaternion.copy(delta).multiply(leg.rest[0]);

      // A térd ellentétesen hajlik, feleakkorát: ettől tört a láb és nem pálca.
      if (leg.bones.length > 1) {
        step.setFromAxisAngle(leg.lift, -raise * 0.55);
        leg.bones[1].quaternion.copy(step).multiply(leg.rest[1]);
      }
    }
  }
}
