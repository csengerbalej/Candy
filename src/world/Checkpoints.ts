import * as THREE from 'three';
import { Challenge } from '../game/Challenge';

/**
 * Az időfutam kapui.
 *
 * Nem lebegő karikák a semmiben: minden kapu egy ÚTSZAKASZ végén áll, a
 * földre simuló foltból és két oszlopból. A folt azért kell, mert menet
 * közben, 120-szal, a földre nézel — egy fej magasságban lebegő gyűrűt
 * pontosan akkor nem látsz, amikor kellene.
 *
 * Egyszerre CSAK A KÖVETKEZŐ világít. Az összes kapu egyszerre kigyújtva
 * nem pálya, hanem karácsonyfa: nem derül ki belőle, merre kell menni.
 * A soron következő lüktet, a többi sötét.
 */
export class Checkpoints {
  readonly group = new THREE.Group();

  private readonly gates: {
    group: THREE.Group;
    pad: THREE.MeshBasicMaterial;
    posts: THREE.MeshStandardMaterial;
  }[] = [];

  private clock = 0;

  constructor(points: THREE.Vector3[], radius: number) {
    for (let i = 0; i < points.length; i++) {
      const g = new THREE.Group();
      g.position.copy(points[i]);

      const pad = new THREE.MeshBasicMaterial({
        color: 0x5ad7ff,
        transparent: true,
        opacity: 0.2,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 36), pad);
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.05;
      g.add(disc);

      // A gyűrű pereme: a folt közepét az autó úgyis eltakarja.
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(radius * 0.86, radius, 48),
        new THREE.MeshBasicMaterial({
          color: 0x9beaff,
          transparent: true,
          opacity: 0.55,
          depthWrite: false,
          side: THREE.DoubleSide,
        })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.06;
      g.add(ring);

      // BOLTÍV, nem két oszlop.
      //
      // Két különálló rúd között „elmenni" lehet; egy íven ÁT kell hajtani —
      // a forma maga mondja meg, mi a dolgod vele. És messziről is felismerhető
      // sziluett, ami egy pár függőleges vonalról nem mondható el.
      const posts = new THREE.MeshStandardMaterial({
        color: 0x2aa8cc,
        emissive: 0x5ad7ff,
        emissiveIntensity: 1.6,
        roughness: 0.4,
      });
      const thick = 0.45;
      const legs = radius * 0.55;                 // ameddig egyenes a láb
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(thick, thick, legs, 10), posts);
        post.position.set(side * radius, legs / 2, 0);
        g.add(post);
      }
      // A félkör: cső, ami a két láb tetejét köti össze.
      const arch = new THREE.Mesh(
        new THREE.TorusGeometry(radius, thick, 10, 28, Math.PI),
        posts
      );
      arch.position.y = legs;
      g.add(arch);

      this.group.add(g);
      this.gates.push({ group: g, pad, posts });
    }
  }

  /** @param next Hányadik kapu a soron következő. */
  update(dt: number, next: number): void {
    this.clock += dt;
    const pulse = 0.55 + Math.sin(this.clock * 3.4) * 0.28;
    for (let i = 0; i < this.gates.length; i++) {
      const g = this.gates[i];
      const done = i < next;
      const active = i === next;
      g.group.visible = !done;
      g.pad.opacity = active ? pulse * 0.42 : 0.07;
      g.posts.emissiveIntensity = active ? 1.2 + pulse : 0.14;
    }
  }

  /** Nyolc-tíz utcán szétszórt pont, ahol a kocsi el is fér. */
  static pick(
    onRoad: (x: number, z: number) => boolean,
    bounds: THREE.Box2,
    count: number,
    random: () => number = Math.random
  ): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    // A minimális távolság a VÁROS méretéből jön: a kapuknak külön
    // útszakaszokon kell lenniük, különben az időfutam egy körözés egy
    // kereszteződés körül.
    const span = Math.min(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y);
    const apart = span / (count + 1);

    // A kapuk a VÁROS BELSEJÉBEN vannak, nem a peremén.
    //
    // A keresés eddig a teljes befoglaló dobozból sorsolt, a város viszont
    // KORONG: a doboz sarkai a kupolán kívül esnek, a széle pedig az utolsó
    // házsor mögötti körút. Egy oda kihelyezett kapu azt jelenti, hogy a
    // futam nagy része a lakatlan peremen zajlik — se ház, se lámpa, se
    // szörnyecske, csak üres aszfalt.
    const cx = (bounds.min.x + bounds.max.x) / 2;
    const cz = (bounds.min.y + bounds.max.y) / 2;
    const reach = (span / 2) * 0.62;

    for (let tries = 0; tries < 8000 && out.length < count; tries++) {
      const angle = random() * Math.PI * 2;
      // Négyzetgyökös sugár: enélkül a pontok a közép köré tömörülnének.
      const r = Math.sqrt(random()) * reach;
      const x = cx + Math.cos(angle) * r;
      const z = cz + Math.sin(angle) * r;
      if (!onRoad(x, z)) continue;
      const at = new THREE.Vector3(x, 0, z);
      if (out.some((p) => p.distanceTo(at) < apart)) continue;
      out.push(at);
    }
    return out;
  }

  /**
   * A kapuk SORRENDBE rakva: mindig a legközelebbi következik.
   *
   * Véletlen sorrendben a futam a városon át-meg-át rohangálás lenne, és az
   * ideje sem lenne jósolható. Így viszont egy bejárható kör lesz belőle.
   */
  static order(points: THREE.Vector3[], from: THREE.Vector3): THREE.Vector3[] {
    const left = [...points];
    const out: THREE.Vector3[] = [];
    let at = from.clone();
    while (left.length) {
      let best = 0;
      for (let i = 1; i < left.length; i++) {
        if (left[i].distanceTo(at) < left[best].distanceTo(at)) best = i;
      }
      at = left[best];
      out.push(left.splice(best, 1)[0]);
    }
    return out;
  }
}

export { Challenge };
