import * as THREE from 'three';
import type { ModelLoader } from '../assets/ModelLoader';
import { VILLAGE_SCALE } from './VillageWorld';

/**
 * A VÁROS DÍSZLETE: fák, tökök, sírkövek.
 *
 * A város eddig házakból és aszfaltból állt. Egy Halloween-éjszakát viszont
 * nem a házak tesznek azzá, hanem az, ami KÖZÖTTÜK van: a kerítés mögé
 * kitett tök, a járda melletti fa, a sarki telken a két sírkő. Ezek nem
 * akadályok és nem is gyűjthetők — egyetlen dolguk, hogy a város ne
 * díszletnek látsszon, hanem helynek.
 *
 * MIÉRT PÉLDÁNYOSÍTOTT (InstancedMesh), és miért nem egyszerű másolat:
 *
 * Mérve: a városban képkockánként kétmillió háromszög rajzolódott, és a
 * gépnek nem a háromszögek száma fájt igazán, hanem az ötszáznyolcvanöt
 * KÜLÖN RAJZOLÁSI HÍVÁS. Százhúsz fa külön objektumként újabb százhúsz
 * hívás lenne — pont az, amit az imént vettünk el a szörnyecskéktől. Egy
 * példányosított háló ezzel szemben SZÁZHÚSZ FÁT EGYETLEN hívásból rajzol
 * ki, mert a gép ugyanazt a hálót teszi le más-más helyre.
 *
 * Ennek az ára, hogy minden példány ugyanaz a modell — de egy fánál ez
 * nem is baj: a méret és az elfordulás véletlenje elég ahhoz, hogy ne
 * tűnjenek klónoknak.
 */
interface PropKind {
  /** A modell útja. */
  url: string;
  /** Hány darab kerüljön ki belőle. */
  count: number;
  /** Mekkora legyen (magasság, világegységben) és mennyit szórhat. */
  height: number;
  spread: number;
  /** Mennyire kerülje az utat. Egy fa a járdán túl áll, a tök a ház előtt. */
  offRoad: number;
}

export class Scenery {
  readonly group = new THREE.Group();
  private readonly kinds: PropKind[];

  constructor(
    private readonly world: {
      roads: { centre: THREE.Vector3 }[];
      tileSize: number;
      onRoad(x: number, z: number): boolean;
      onMotorway(x: number, z: number): boolean;
    },
    private readonly random: () => number = Math.random
  ) {
    this.kinds = [
      // A FA a leggyakoribb: az utcák vonalát ez rajzolja ki, és messziről
      // ez mondja meg, hogy lakott helyen jársz.
      { url: 'models/tree.json', count: 90, height: 7.5, spread: 0.35, offRoad: 7 },
      // A TÖK a házak elé kerül: közel az úthoz, mert azért teszik ki, hogy
      // lássák. Ez az egyetlen díszlet, ami világít.
      { url: 'models/pumpkin-prop.json', count: 40, height: 0.9, spread: 0.25, offRoad: 5 },
      // A SÍRKÖVEK párban állnak, mint egy rögtönzött kerti temető.
      { url: 'models/grave1.json', count: 26, height: 1.5, spread: 0.2, offRoad: 8 },
      { url: 'models/grave2.json', count: 20, height: 1.3, spread: 0.2, offRoad: 8 },
    ];
  }

  /**
   * Betölti és kiszórja a díszletet.
   *
   * A hívó nem várja meg: a város az első képkockán kész, a díszlet pedig
   * akkor jelenik meg, amikor megérkezik. Egy fa, ami két másodperccel
   * később bukkan fel a látóhatáron, senkinek nem hiányzik — egy két
   * másodpercig fekete képernyő viszont igen.
   */
  async load(models: ModelLoader): Promise<void> {
    await Promise.all(
      this.kinds.map(async (kind) => {
        try {
          const art = await models.instance(kind.url, { height: kind.height });
          const placed = this.scatter(kind);
          if (placed.length > 0) this.group.add(...this.instanced(art, placed, kind));
        } catch (e) {
          // Egy hiányzó díszlet nem foszthatja meg a játékost a várostól.
          console.warn(`${kind.url} díszlet nem töltött be`, e);
        }
      })
    );
  }

  /** Hova kerüljenek: úttól távol, de az utcák mentén. */
  private scatter(kind: PropKind): THREE.Matrix4[] {
    const out: THREE.Matrix4[] = [];
    const roads = this.world.roads;
    if (roads.length === 0) return out;

    // Ötször annyi próbálkozás, mint ahány darab kell: a szabály (ne legyen
    // az úton) néha nemet mond, és a végén inkább legyen kevesebb fa, mint
    // egy végtelen ciklus.
    for (let tries = 0; tries < kind.count * 6 && out.length < kind.count; tries++) {
      const tile = roads[Math.floor(this.random() * roads.length)];
      const angle = this.random() * Math.PI * 2;
      const away = kind.offRoad + this.random() * this.world.tileSize * 0.5;
      const x = tile.centre.x + Math.cos(angle) * away;
      const z = tile.centre.z + Math.sin(angle) * away;
      // AZ ÚTON ÁLLÓ FA nem díszlet, hanem hiba: nekihajtanál. Az autópálya
      // szélét külön nézzük, mert ott kétszázzal mész.
      if (this.world.onRoad(x, z) || this.world.onMotorway(x, z)) continue;

      const scale = 1 + (this.random() * 2 - 1) * kind.spread;
      const matrix = new THREE.Matrix4();
      matrix.compose(
        new THREE.Vector3(x, 0, z),
        new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.random() * Math.PI * 2),
        new THREE.Vector3(scale, scale, scale)
      );
      out.push(matrix);
    }
    return out;
  }

  /**
   * A betöltött modellből példányosított hálót csinál.
   *
   * A modell több hálóból is állhat (törzs + lomb), ezért mindegyikből
   * külön példányosított háló lesz — de ez akkor is EGY-KÉT rajzolási
   * hívás összesen, nem darabonként egy.
   */
  private instanced(art: THREE.Object3D, spots: THREE.Matrix4[], kind: PropKind): THREE.InstancedMesh[] {
    const out: THREE.InstancedMesh[] = [];
    art.updateWorldMatrix(true, true);
    art.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      // A modell SAJÁT transzformációja (amit az illesztés adott neki) bele
      // kell égjen a geometriába — a példányok mátrixa a helyről szól, nem
      // a modell belső méretezéséről.
      const geometry = mesh.geometry.clone();
      geometry.applyMatrix4(mesh.matrixWorld);

      const instances = new THREE.InstancedMesh(geometry, mesh.material, spots.length);
      for (let i = 0; i < spots.length; i++) instances.setMatrixAt(i, spots[i]);
      instances.instanceMatrix.needsUpdate = true;
      instances.castShadow = true;
      instances.receiveShadow = true;
      // A példányosított háló befoglalója nem számolódik magától, és
      // nélküle a levágás rosszul dönt: vagy eltűnik, amikor látszania
      // kéne, vagy mindig rajzolódik.
      instances.computeBoundingSphere();
      instances.name = kind.url;
      out.push(instances);
    });
    return out;
  }

  /** Hány darab áll kint — a mérésnek. */
  get placed(): number {
    let n = 0;
    for (const child of this.group.children) {
      n += (child as THREE.InstancedMesh).count ?? 0;
    }
    return n;
  }
}

/** A falu léptéke, hogy a díszlet ugyanabban a világban álljon. */
export const SCENERY_SCALE = VILLAGE_SCALE;
