import * as THREE from 'three';
import { models } from '../assets/ModelLoader';

export interface WallRun {
  0: number;
  1: number;
  2: number;
  3: number;
}

export interface DoorSpec {
  at: [number, number];
  vizszintes: boolean;
  cells: [number, number][];
}

/**
 * A KŐFAL ÉS AZ AJTÓK — letöltött modellekből, futásidőben.
 *
 * A ház geometriája eddig generált dobozokból állt: pontosan ott, ahol a
 * rács szerint fal van, de ránézésre doboz. A letöltött kőfal-panel ezt
 * váltja ki — és fontos, hogy NEM a dobozok MELLÉ kerül, hanem a HELYÜKRE.
 * Két réteg geometria ugyanott kétszer annyi háromszög és z-vibrálás; a
 * rács pedig változatlanul az egyetlen igazság marad, mert a panelek
 * pontosan a rács falfutamaira ülnek.
 *
 * Miért példányosított: ezer falszakasz ezer külön objektumként ezer
 * rajzolási hívás volna — abból már tudjuk, mi lesz. Így egy.
 */
export class Masonry {
  readonly group = new THREE.Group();

  /** Az ajtók, hogy a jelenet nyitni-csukni tudja őket. */
  readonly doors: {
    spec: DoorSpec;
    pivot: THREE.Group;
    open: boolean;
    /** 0…1 — hol tart a nyitásban. */
    swing: number;
  }[] = [];

  constructor(
    private readonly doorSpecs: readonly DoorSpec[],
    private readonly wallHeight: number
  ) {}

  async load(): Promise<void> {
    await Promise.all([this.buildWalls(), this.buildDoors()]);
  }

  /**
   * A KŐFAL KÉPE a ház geometriájára.
   *
   * Nem példány, hanem TEXTÚRA. Az első változat a letöltött kőpanelt
   * ültette rá minden falszakaszra, ezerkétszáz darabban, és mérve
   * negyvenmillió háromszöget rajzolt — a panel harmincegyezer háromszögű,
   * és nem lehetett lejjebb vinni (egy kőfal sok különálló kő, nincs mit
   * összevonni). A kép ugyanazt a látványt adja hatvan háromszögből.
   */
  private async buildWalls(): Promise<void> {
    const kep = await new Promise<THREE.Texture>((ok, hiba) => {
      new THREE.TextureLoader().load('art/wall.webp', ok, undefined, hiba);
    });
    kep.wrapS = THREE.RepeatWrapping;
    kep.wrapT = THREE.RepeatWrapping;
    kep.colorSpace = THREE.SRGBColorSpace;
    this.wallTexture = kep;
  }

  /** A kőfal képe, ha megérkezett. A jelenet teszi rá a ház anyagára. */
  wallTexture: THREE.Texture | null = null;

  private async buildDoors(): Promise<void> {
    const art = await models.instance('models/door.json', { height: this.wallHeight * 0.92 });
    const box = new THREE.Box3().setFromObject(art);
    const size = new THREE.Vector3();
    box.getSize(size);
    // A ZSANÉR a lap szélén van, nem a közepén. A modell a saját
    // középpontja körül áll; ezért egy forgásponthoz kötjük, és a lapot
    // félszélességgel eltoljuk benne — így az ajtó a szélén fordul, ahogy
    // egy ajtó szokott.
    const felszeles = Math.max(size.x, size.z) / 2;

    // A NYÍLÁS HÁROM MÉTER, A LAP MÁSFÉL: KÉTSZÁRNYÚ AJTÓ KELL.
    //
    // Az első változat egyetlen lapot tett a nyílás közepe mellé, és
    // ránézésre rossz volt: egy 1,6 méteres lap egy 3 méteres nyílásban se
    // ki nem tölti, se középen nincs. Nem az illesztés csúszott el — a
    // DARABSZÁM volt rossz.
    //
    // Két szárny, a nyílás két szélére zsanérozva, egymás felé csukódva:
    // középen érnek össze, és nyitáskor mindkettő a saját falának dől.
    const nyilas = 3;
    const szarny = nyilas / 2;
    // A lapot a szárny szélességére húzzuk: a modell magasságra van
    // igazítva, a szélessége abból jött ki, nem a nyílásból.
    const nyujtas = szarny / Math.max(0.001, felszeles * 2);

    for (const spec of this.doorSpecs) {
      const kozep = new THREE.Vector3(spec.at[0], 0, spec.at[1]);
      const paros: THREE.Group[] = [];
      for (const oldal of [-1, 1] as const) {
        const pivot = new THREE.Group();
        const lap = art.clone(true);
        // A lap a zsanértól BEFELÉ áll: a saját szélességének felével
        // eltolva, hogy a forgás a szélén történjen.
        lap.position.set(felszeles * oldal, 0, 0);
        lap.scale.x *= nyujtas;
        lap.scale.z *= nyujtas;
        lap.traverse((o) => {
          o.userData.cpNoOutline = true;
        });
        pivot.add(lap);
        pivot.position.copy(kozep);
        pivot.rotation.y = spec.vizszintes ? 0 : Math.PI / 2;
        // A zsanér a nyílás SZÉLÉN: innen fordul ki a falhoz.
        pivot.translateX(szarny * oldal);
        pivot.userData.oldal = oldal;
        this.group.add(pivot);
        paros.push(pivot);
      }
      // A két szárny egy ajtó: együtt nyílnak, együtt csukódnak, és a
      // jelenet egyetlen dolognak látja őket.
      const pivot = paros[0];
      pivot.userData.parja = paros[1];
      this.doors.push({ spec, pivot, open: false, swing: 0 });
    }
  }

  /**
   * @returns a legközelebbi ajtó, ha karnyújtásnyira van.
   */
  nearest(at: THREE.Vector3, reach: number): (typeof this.doors)[number] | null {
    let best: (typeof this.doors)[number] | null = null;
    let bestD = reach;
    for (const d of this.doors) {
      const dist = d.pivot.position.distanceTo(at);
      if (dist < bestD) {
        bestD = dist;
        best = d;
      }
    }
    return best;
  }

  /** A lapok mozgatása: nyílnak és csukódnak, nem ugranak. */
  update(dt: number): void {
    for (const d of this.doors) {
      const cel = d.open ? 1 : 0;
      if (Math.abs(d.swing - cel) < 0.001) continue;
      d.swing += Math.sign(cel - d.swing) * Math.min(Math.abs(cel - d.swing), dt * 2.4);
      // Kilencven fok: a nyitott ajtó a falnak dől, nem lóg az útba. A két
      // szárny EGYMÁSSAL SZEMBE fordul — ezért az előjel oldalanként más.
      const forgat = (p: THREE.Object3D): void => {
        const oldal = (p.userData.oldal as number) ?? -1;
        p.children[0].rotation.y = d.swing * (Math.PI / 2) * oldal;
      };
      forgat(d.pivot);
      const parja = d.pivot.userData.parja as THREE.Object3D | undefined;
      if (parja) forgat(parja);
    }
  }
}
