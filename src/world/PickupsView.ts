import * as THREE from 'three';
import { models } from '../assets/ModelLoader';
import { GUNS, PICKUP, type GunId } from '../core/config';
import type { Armoury, Dropped } from '../game/Armoury';

/**
 * A pályán heverő fegyverek KIRAJZOLÁSA.
 *
 * Három dolgot kell ránézésre megmondania, és mind a három játékinformáció:
 *
 *   MI az     — a modell maga, forogva, hogy minden oldalról felismerd,
 *   HOL van   — lebeg a padló fölött, mert a földön fekvő tárgy beleolvad
 *               a szőnyegbe, és egy sötét házban sosem találnád meg,
 *   MEDDIG    — a vége felé villog. Nem díszítés: ebből tudod, hogy érdemes-e
 *               még érte futni, vagy inkább hagyd.
 *
 * A modellek MEGOSZTVA vannak (egy betöltés fajtánként), és a nem használt
 * példányok elrejtve maradnak, nem törlődnek: egy fegyver felbukkanása így
 * nem jár betöltéssel a játék közepén.
 */

const FLOAT = 0.55;
/** Az utolsó ennyi másodpercben villog. */
const BLINK = 6;

export class PickupsView {
  readonly group = new THREE.Group();
  private readonly pool = new Map<GunId, THREE.Object3D[]>();
  private readonly used = new Map<GunId, number>();
  private clock = 0;
  private ready = false;

  async load(): Promise<void> {
    for (const kind of Object.keys(GUNS) as GunId[]) {
      const { scene } = await models.load(GUNS[kind].model);
      const list: THREE.Object3D[] = [];
      // Annyi példány, amennyi elvileg egyszerre kint lehet.
      for (let i = 0; i < PICKUP.live; i++) {
        const copy = scene.clone(true);
        copy.visible = false;
        // A körvonalazó a kis lebegő tárgyakat vastag fekete folttá tenné.
        copy.traverse((o) => {
          o.userData.cpNoOutline = true;
        });
        this.group.add(copy);
        list.push(copy);
      }
      this.pool.set(kind, list);
    }
    this.ready = true;
  }

  update(dt: number, armoury: Armoury, floorAt: (x: number, z: number) => number = () => 0): void {
    if (!this.ready) return;
    this.clock += dt;
    for (const kind of this.pool.keys()) this.used.set(kind, 0);

    for (const item of armoury.items) {
      const list = this.pool.get(item.kind);
      if (!list) continue;
      const index = this.used.get(item.kind) ?? 0;
      const mesh = list[index];
      if (!mesh) continue;
      this.used.set(item.kind, index + 1);
      this.place(mesh, item, floorAt(item.position.x, item.position.z));
    }

    // Ami nem kapott darabot, az elrejtőzik.
    for (const [kind, list] of this.pool) {
      for (let i = this.used.get(kind) ?? 0; i < list.length; i++) list[i].visible = false;
    }
  }

  private place(mesh: THREE.Object3D, item: Dropped, floor: number): void {
    // A VILLOGÁS a hátralévő időből jön. Fél másodperces ütem: elég lassú,
    // hogy ne idegesítsen, elég gyors, hogy sürgetésnek érződjön.
    const dying = item.left < BLINK;
    mesh.visible = !dying || Math.sin(this.clock * 9) > -0.35;
    if (!mesh.visible) return;

    const bob = Math.sin(this.clock * 1.8 + item.position.x) * 0.09;
    mesh.position.set(item.position.x, floor + FLOAT + bob, item.position.z);
    mesh.rotation.set(0, this.clock * 1.1 + item.position.z, 0.35);
  }

  dispose(): void {
    this.group.clear();
    this.pool.clear();
  }
}
