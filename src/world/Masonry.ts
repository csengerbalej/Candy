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

    for (const spec of this.doorSpecs) {
      const pivot = new THREE.Group();
      const lap = art.clone(true);
      lap.position.set(felszeles, 0, 0);
      lap.traverse((o) => {
        o.userData.cpNoOutline = true;
      });
      pivot.add(lap);
      const at = new THREE.Vector3(spec.at[0], 0, spec.at[1]);
      // A nyílás közepére, a fal vonalával egy irányba.
      pivot.position.copy(at);
      pivot.rotation.y = spec.vizszintes ? 0 : Math.PI / 2;
      // A lapot a nyílás egyik széléhez toljuk, hogy csukva kitöltse.
      pivot.translateX(-felszeles * 1.6);
      this.group.add(pivot);
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
      // Kilencven fok: a nyitott ajtó a falnak dől, nem lóg az útba.
      d.pivot.children[0].rotation.y = -d.swing * (Math.PI / 2);
    }
  }
}
