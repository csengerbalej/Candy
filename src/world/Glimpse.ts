import * as THREE from 'three';
import { models } from '../assets/ModelLoader';

/**
 * AMI ÁTSZALAD A SZEMED ELŐTT.
 *
 * Egy sötét alak, ami messze előtted keresztbe fut egy ajtón vagy egy
 * folyosón, fél másodperc alatt — és nincs ott, mire odaérsz. Nem szörny,
 * nem bánt, nem is létezik igazán: a jelenet dobja oda, aztán elveszi.
 *
 * MIÉRT EZ A LEGOLCSÓBB IJESZTÉS, AMI MŰKÖDIK:
 *
 * A valódi fenyegetés drága — kell hozzá útkeresés, ütközés, szabály,
 * következmény. Ez viszont pontosan azt adja, amitől a horror él: a
 * BIZONYTALANSÁGOT. Láttál valamit? Biztos? És ha igen, hova ment?
 *
 * Utána minden ajtóra másképp nézel majd — pedig nem történt semmi. És ez
 * a „pedig nem történt semmi" az, ami miatt a következő alkalommal, amikor
 * TÉNYLEG történik valami, elhiszed.
 *
 * Három szabály tartja meg ijesztőnek:
 *
 *   MESSZE van — de csak amennyire a ház engedi. Közelről kiderülne,
 *   hogy egy sötét doboz; húsz méteren túl viszont egy folyosón már a
 *   szemközti fal van, és akkor soha nem indul el.
 *   KERESZTBE fut, a nézésedre merőlegesen — aki feléd jön, az fenyegetés;
 *   aki átfut előtted, az rejtély.
 *   RITKA. A negyedik alkalomra rutin lenne, és a rutin a horror ellentéte.
 */
export class Glimpse {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.Mesh;
  private left = 0;
  private from = new THREE.Vector3();
  private to = new THREE.Vector3();
  private readonly length: number;

  constructor() {
    // KEZDETBEN EGY LAPOS FOLT — de csak amíg a modell meg nem érkezik.
    //
    // Az első változat véglegesen ez volt, azzal az érveléssel, hogy ilyen
    // távolságból egy alak és egy folt ugyanaz. Nem ugyanaz: a téglalap
    // téglalapnak látszik, és egy szögletes folt nem rejtély, hanem hiba.
    // A sziluett attól sziluett, hogy EMBERFORMA — a részlet hiányzik
    // belőle, nem a forma.
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.75, 1.95),
      new THREE.MeshBasicMaterial({
        color: 0x05040a,
        transparent: true,
        opacity: 0.92,
        depthWrite: false,
      })
    );
    this.mesh.userData.cpNoOutline = true;
    this.mesh.visible = false;
    this.group.add(this.mesh);
    this.length = 0.6;
    void this.alakot();
  }

  /** A sziluett anyaga: fénytől független, hogy a lámpa se leplezze le. */
  private readonly arnyek = new THREE.MeshBasicMaterial({
    color: 0x05040a,
    transparent: true,
    opacity: 0.92,
    depthWrite: false,
  });

  /**
   * A VAK ALAKJÁT VESZI FEL.
   *
   * Ugyanaz a test szalad át a folyosó végén, amelyik később tényleg
   * eljön érted. Ez többet ad, mint egy idegen forma: amikor először
   * találkozol a Vakkal, már láttad — csak akkor még nem tudtad, mit.
   *
   * FEKETÉRE FESTVE és fénytől függetlenül: a formát látod, a részletet
   * nem, és a lámpád se árulja el, hogy mi az.
   */
  private async alakot(): Promise<void> {
    try {
      const art = await models.instance('models/lurker-vak.json', { height: 1.95 });
      art.traverse((o) => {
        o.userData.cpNoOutline = true;
        const m = o as THREE.Mesh;
        if (m.isMesh) m.material = this.arnyek;
      });
      art.visible = false;
      this.group.add(art);
      this.art = art;
      // A lapos folt innentől nem kell.
      this.mesh.visible = false;
    } catch (e) {
      // Marad a folt: kevésbé jó, de mindig van.
      console.warn('az átszaladó alak modellje nem töltött be', e);
    }
  }

  /** A modell, ha megérkezett. Amíg nincs, a lapos folt fut. */
  private art: THREE.Object3D | null = null;

  /** Ami épp látszik: a modell, ha van, különben a folt. */
  private get test(): THREE.Object3D {
    return this.art ?? this.mesh;
  }

  /**
   * Indítsd el: fusson át a `kozep` ponton, a `yaw` nézésre merőlegesen.
   */
  start(kozep: THREE.Vector3, yaw: number, felszeles = 3.2): void {
    // Merőleges a nézésre: a nézés (sin, cos), erre merőleges a (cos, −sin).
    const oldal = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const irany = Math.random() < 0.5 ? 1 : -1;
    // A SZÉLESSÉG A HELYHEZ IGAZODIK. Egy három méteres folyosón egy hat
    // méter széles átfutás a falból indulna és a falban érne véget — a
    // jelenet ezért megméri, mennyi hely van, és annyit ad át.
    this.from.copy(kozep).addScaledVector(oldal, -felszeles * irany);
    this.to.copy(kozep).addScaledVector(oldal, felszeles * irany);
    this.from.y = 0;
    this.to.y = 0;
    this.left = this.length;
    this.test.visible = true;
  }

  update(dt: number, nez: THREE.Vector3): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) {
      this.test.visible = false;
      return;
    }
    const t = 1 - this.left / this.length;
    const test = this.test;
    test.position.lerpVectors(this.from, this.to, t);
    // A modell a TALPÁN áll, a lapos folt a közepén lebeg.
    test.position.y = this.art ? 0 : 0.98;
    // A SZÉLEKEN HALVÁNYABB: így nem „megjelenik és eltűnik", hanem
    // átsuhan. A hirtelen felbukkanó folt hibának látszik, az elhalványuló
    // alaknak viszont elhiszed, hogy ott volt.
    this.arnyek.opacity = 0.92 * Math.sin(t * Math.PI);
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = this.arnyek.opacity;
    if (this.art) {
      // A modell OLDALVÁST fut, ahogy egy átszaladó alak — nem néz rád.
      this.art.rotation.y = Math.atan2(this.to.x - this.from.x, this.to.z - this.from.z);
    } else {
      this.mesh.lookAt(nez.x, this.mesh.position.y, nez.z);
    }
  }

  /** Fut-e épp. A jelenet ebből tudja, hogy ne indítson újat. */
  get running(): boolean {
    return this.left > 0;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.arnyek.dispose();
  }
}
