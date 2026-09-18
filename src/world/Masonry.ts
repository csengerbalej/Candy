import * as THREE from 'three';

export interface WallRun {
  0: number;
  1: number;
  2: number;
  3: number;
}

/**
 * A KŐFAL KÉPE — letöltött panelből, futásidőben.
 *
 * A ház geometriája eddig generált dobozokból állt: pontosan ott, ahol a
 * rács szerint fal van, de ránézésre doboz. A letöltött kőfal-panel ezt
 * váltja ki — és fontos, hogy NEM a dobozok MELLÉ kerül, hanem a HELYÜKRE.
 * Két réteg geometria ugyanott kétszer annyi háromszög és z-vibrálás; a
 * rács pedig változatlanul az egyetlen igazság marad, mert a panelek
 * pontosan a rács falfutamaira ülnek.
 *
 * AJTÓ NINCS TÖBBÉ. Volt: kétszárnyú, nyíló-csukódó, a Követőt elzáró.
 * Csak épp a vaksötét házban egyedül AZ látszott ki a falból, mert a
 * letöltött ajtónak rendes világos alapszíne van, a generált falnak pedig
 * nincs — és egy ajtó, ami fontosabbnak látszik a háznál, nem ajtó, hanem
 * hiba. A nyílások nyitva maradnak.
 */
export class Masonry {
  readonly group = new THREE.Group();

  async load(): Promise<void> {
    await this.buildWalls();
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

}
