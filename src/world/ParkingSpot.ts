import * as THREE from 'three';
import { STREET } from '../core/config';

/**
 * A narancsszínű parkolóhely a célháznál.
 *
 * Eddig a megérkezés láthatatlan volt: a szabály egy sugár a ház „stop"
 * pontja körül, a játékos meg csak annyit látott, hogy valahol a ház előtt
 * egyszer csak kiírja, hogy megálltatok. Ami nem tanít semmit — legközelebb
 * ugyanúgy találgatsz.
 *
 * A megoldásban az EGYETLEN fontos döntés az, hogy a kör sugara pontosan
 * `STREET.arriveRadius`, nem egy ahhoz hasonló szám. Egy jelölés, ami nem
 * ott van, ahol a szabály, rosszabb, mint a semmi: megtanulod a helyét, és
 * utána a játék cáfol.
 *
 * Lapos, és a földre simul: bármi, ami kiáll az úttestből, olyasmi lenne, ami
 * az úton áll — és az utak tiszták maradnak.
 */
export class ParkingSpot {
  /** Négy csík egy téglalap szélén — a felfestett parkolóhely kerete. */
  private static frame(w: number, d: number, t: number): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    for (const [sx, sz, pw, pd] of [
      [0, (d - t) / 2, w, t],
      [0, -(d - t) / 2, w, t],
      [(w - t) / 2, 0, t, d - t * 2],
      [-(w - t) / 2, 0, t, d - t * 2],
    ] as [number, number, number, number][]) {
      const g = new THREE.PlaneGeometry(pw, pd);
      g.translate(sx, sz, 0);
      parts.push(g);
    }
    // Egyetlen geometriává fűzve: négy külön mesh négy rajzolás lenne.
    const merged = parts[0];
    return parts.slice(1).reduce((acc, g) => {
      const a = acc.getAttribute('position').array as Float32Array;
      const b = g.getAttribute('position').array as Float32Array;
      const ia = acc.getIndex()!.array as ArrayLike<number>;
      const ib = g.getIndex()!.array as ArrayLike<number>;
      const pos = new Float32Array(a.length + b.length);
      pos.set(a, 0);
      pos.set(b, a.length);
      const idx: number[] = [...Array.from(ia), ...Array.from(ib).map((v) => v + a.length / 3)];
      const out = new THREE.BufferGeometry();
      out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      out.setIndex(idx);
      return out;
    }, merged);
  }

  readonly group = new THREE.Group();

  private readonly pad: THREE.Mesh;
  private readonly ring: THREE.Mesh;
  private readonly padMat: THREE.MeshBasicMaterial;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private clock = 0;

  constructor() {
    const r = STREET.arriveRadius;

    this.padMat = new THREE.MeshBasicMaterial({
      color: 0xff7a1a,
      transparent: true,
      opacity: 0.22,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // TÉGLALAP, nem kör — de a szabály KÖRÉBE ÍRVA.
    //
    // A szabály sugárban mér, a parkolóhely viszont egy AUTÓ helye, és egy
    // autó téglalap: a kör azt sugallta, hogy bárhonnan bármilyen szögben jó.
    //
    // A méret viszont nem szabad: a fél átló PONTOSAN a szabály sugara
    // (0,6² + 0,8² = 1), tehát a téglalap minden pontja a körön BELÜL van.
    // Fordítva — nagyobb téglalappal — a sarkai kilógnának a szabályból, és a
    // jelölés többet ígérne, mint amit a játék elfogad. Ez a legrosszabb
    // fajta hiba: megtanulod a jelölést, aztán a szabály cáfol.
    this.pad = new THREE.Mesh(new THREE.PlaneGeometry(r * 1.2, r * 1.6), this.padMat);
    this.pad.rotation.x = -Math.PI / 2;
    // Egy hajszállal az úttest fölött: pontosan egy síkban z-harcot vívna a
    // burkolattal, és a folt villogna vezetés közben.
    this.pad.position.y = 0.04;
    this.pad.renderOrder = 2;
    this.group.add(this.pad);

    this.ringMat = new THREE.MeshBasicMaterial({
      color: 0xffb347,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    // A keret is téglalap: négy vékony csík a folt szélén. Egy kör keret egy
    // téglalap folt körül két különböző dolgot mondana ugyanarról a helyről.
    this.ring = new THREE.Mesh(ParkingSpot.frame(r * 1.2, r * 1.6, 0.5), this.ringMat);
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.y = 0.05;
    this.ring.renderOrder = 3;
    this.group.add(this.ring);

    // A fény adja a „világít" felét. Rövid hatótávval, hogy a ház falát
    // narancsra mossa, de ne világítsa be a fél utcát.
    const glow = new THREE.PointLight(0xff8a2a, 120, r * 3.2, 2);
    glow.position.y = 2.2;
    this.group.add(glow);
  }

  /** Hova kell állni. A cél váltásakor (CÉL gomb) ide költözik. */
  moveTo(at: THREE.Vector3): void {
    this.group.position.set(at.x, 0, at.z);
  }

  /**
   * Lüktet, amíg oda nem álltok, és MEGÁLL, amint sikerült.
   *
   * A lüktetés hívogatás; ha a megérkezés után is folytatná, ugyanazt
   * mondaná, mint előtte, és a játékos nem tudná, mit ért el. A nyugodt,
   * teli kör az elismerés.
   */
  update(dt: number, parked: boolean): void {
    this.clock += dt;
    const pulse = parked ? 1 : 0.55 + Math.sin(this.clock * 3.4) * 0.45;
    this.padMat.opacity = parked ? 0.34 : 0.14 + pulse * 0.14;
    this.ringMat.opacity = parked ? 1 : 0.5 + pulse * 0.4;
    this.ringMat.color.setHex(parked ? 0xffe0a0 : 0xffb347);
    const scale = parked ? 1 : 0.97 + pulse * 0.03;
    this.ring.scale.set(scale, scale, 1);
  }
}
