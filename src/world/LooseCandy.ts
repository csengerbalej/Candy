import * as THREE from 'three';
import { models } from '../assets/ModelLoader';
import { CAPTURE } from '../core/config';
import type { Capture } from '../game/Capture';

/**
 * A FÖLDÖN HEVERŐ CUKORKA.
 *
 * Amit a lövés vagy az elkapás kiver a kézből, annak LÁTSZANIA is kell —
 * különben a találatnak nincs zsákmánya, csak könyvelése. Mérve (és a
 * játékos jelentette): a földre esett darabok se nem látszottak, se fel nem
 * voltak vehetők, tehát a lövés egyetlen következménye egy szám volt, amit
 * senki nem lát.
 *
 * Előre lefoglalt készlet, mint a fegyvereknél: egy találat pillanatában
 * nincs idő modellt betölteni, és a szemétgyűjtő sem kap munkát.
 */

const POOL = 12;
/** A türelmi idő alatt halványan villog: „ezt még nem te veheted fel". */
const FLOAT = 0.45;

export class LooseCandy {
  readonly group = new THREE.Group();
  private readonly pool: THREE.Object3D[] = [];
  private clock = 0;
  private ready = false;

  async load(): Promise<void> {
    const art = await models.instance('models/candy.json', { height: 1.1 });
    for (let i = 0; i < POOL; i++) {
      const copy = art.clone(true);
      copy.visible = false;
      copy.traverse((o) => {
        o.userData.cpNoOutline = true;
        // Saját fényű, mint a fegyverek: a sötét házban a földön fekvő
        // zsákmánynak látszania kell, különben nincs miért futni érte.
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const from = mesh.material as THREE.MeshStandardMaterial;
        mesh.material = new THREE.MeshBasicMaterial({
          map: from.map ?? null,
          color: from.color?.clone() ?? new THREE.Color(0xffffff),
        });
      });
      this.group.add(copy);
      this.pool.push(copy);
    }
    this.ready = true;
  }

  update(dt: number, game: Capture, localIndex: 0 | 1, floor = 0): void {
    if (!this.ready) return;
    this.clock += dt;
    game.loose.forEach((piece, i) => {
      const mesh = this.pool[i];
      if (!mesh) return;
      // A SAJÁT, ép most elejtett darabod halványan villog: ebből tudod,
      // hogy még nem a tiéd — és nem állsz fölötte értetlenül.
      const mine = piece.droppedBy === localIndex && piece.age < CAPTURE.graceOwn;
      mesh.visible = !mine || Math.sin(this.clock * 12) > -0.2;
      mesh.position.set(
        piece.position.x,
        floor + FLOAT + Math.sin(this.clock * 2.4 + i) * 0.07,
        piece.position.z
      );
      mesh.rotation.y = this.clock * 1.6 + i;
    });
    for (let i = game.loose.length; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  dispose(): void {
    this.group.clear();
    this.pool.length = 0;
  }
}
