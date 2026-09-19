import * as THREE from 'three';
import { models } from '../assets/ModelLoader';
import { CharacterRig } from '../render/CharacterRig';
import { MOVE, HAUNT } from '../core/config';

/**
 * A MUMUS — a társad alakjában.
 *
 * A többi szörny a testedet fenyegeti. Ez a BIZALMAT: azt az egyetlen
 * dolgot, amin egy kétszemélyes mód áll. A társad eddig a megnyugvás volt a
 * sötétben — ha megláttad, fellélegeztél. Ez elveszi.
 *
 * Egyedül játszva a TIÉD alakját veszi fel. Ugyanaz a kód, és egy sokkal
 * régebbi félelem: valaki, aki te vagy, ott áll a folyosó végén.
 *
 * AMITŐL MŰKÖDIK, ÉS AMITŐL TISZTESSÉGES MARAD:
 *
 *   Csak akkor mozdul, amikor NEM NÉZEL RÁ. Szembefordulva áll, mint egy
 *   fénykép. Ettől lesz a megfordulás maga a feszültség — és ettől lesz az
 *   is, hogy soha nem látod MOZOGNI, csak azt, hogy közelebb van.
 *
 *   Nincs lámpája. Ha nálad van a fény, és valaki fénnyel jön szembe, az a
 *   társad; ha sötétben, az bármelyik lehet.
 *
 *   Lassabb nálad. Ha rájössz és futni kezdesz, mindig megmenekülsz.
 *
 * Az első felbukkanása ÁRTATLAN: csak áll, aztán eltűnik. A feladata nem
 * az elkapás, hanem hogy megtudd, hogy létezik — onnantól minden VALÓDI
 * találkozás is ijesztő lesz.
 */
export class Mumus {
  readonly group = new THREE.Group();
  private art: THREE.Object3D | null = null;
  /**
   * A CSONTVÁZ — enélkül T-PÓZBAN ÁLLT, kitárt karokkal.
   *
   * Ez mindent elrontott, amire a mumus épül: a lényeg, hogy a TÁRSADNAK
   * nézd egy pillanatra. Egy T-pózban álló alak nem társ, hanem egy
   * betöltetlen modell — azonnal látszik rajta, hogy a játék hibázott, és
   * onnantól nem félsz tőle, hanem nézed.
   *
   * Áll: `idle`. Amíg közelít (tehát amikor NEM nézel rá): `walk`. Sosem
   * fogod látni járni — de amikor visszafordulsz, nem egy szobor áll ott,
   * hanem valaki, aki épp megállt.
   */
  private rig: CharacterRig | null = null;
  /** Amíg fut, itt áll valahol. */
  private left = 0;
  /** Hányadik felbukkanás. Az első nem bánt. */
  private count = 0;

  /** Látszik-e épp. */
  get active(): boolean {
    return this.left > 0;
  }

  /** Bánt-e ez a felbukkanás. Az elsőtől nem kell félni — utána igen. */
  get dangerous(): boolean {
    return this.count > 1;
  }

  get position(): THREE.Vector3 {
    return this.group.position;
  }

  /**
   * @param model A társad (egyedül: a saját) karaktermodellje.
   */
  async load(model: string): Promise<void> {
    try {
      const art = await models.instance(model, { height: MOVE.height });
      const clips = await models.ownClips(model);
      art.traverse((o) => {
        o.userData.cpNoOutline = true;
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        // NEM FEKETE SZILUETT. Pont az a lényeg, hogy a TÁRSADNAK nézd —
        // egy árnyék azonnal elárulná magát. Csak tompább és hidegebb,
        // amennyivel egy sötét folyosó amúgy is tompítana mindent.
        const from = mesh.material as THREE.MeshStandardMaterial;
        const made = from.clone();
        made.color = new THREE.Color().copy(from.color ?? new THREE.Color(0xffffff)).multiplyScalar(0.62);
        made.emissive = new THREE.Color(0x000000);
        mesh.material = made;
      });
      this.art = art;
      this.rig = new CharacterRig(art, clips);
      this.group.add(art);
      this.group.visible = false;
    } catch (e) {
      // Modell nélkül nincs mumus — és ez jobb, mint egy kapszula, ami
      // nyilvánvalóan nem a társad.
      console.warn('a mumus alakja nem töltött be', e);
    }
  }

  /** Felbukkan ezen a ponton, feléd fordulva. */
  appear(at: THREE.Vector3, nez: THREE.Vector3): void {
    if (!this.art) return;
    this.count++;
    this.left = HAUNT.mumusStay;
    this.group.position.copy(at);
    this.group.visible = true;
    // Szembefordulva ÁLL — nem T-pózban lebeg.
    this.rig?.play('idle', 0);
    this.face(nez);
  }

  private face(to: THREE.Vector3): void {
    this.group.rotation.y = Math.atan2(to.x - this.group.position.x, to.z - this.group.position.z);
  }

  /**
   * @param nezik Ránéz-e épp a játékos. Amíg igen, a mumus NEM MOZDUL.
   * @returns 'elkapott', ha most ért hozzád; 'eltunt', ha most adta fel.
   */
  update(dt: number, cel: THREE.Vector3, nezik: boolean): 'semmi' | 'elkapott' | 'eltunt' {
    if (this.left <= 0) return 'semmi';
    this.rig?.update(dt);
    this.left -= dt;
    if (this.left <= 0) {
      this.hide();
      return 'eltunt';
    }

    // MINDIG FELÉD FORDUL. Egy alak, ami elfordulva áll, tárgy; egy alak,
    // ami néz, személy.
    this.face(cel);

    const tav = this.group.position.distanceTo(cel);
    if (nezik) this.rig?.play('idle');
    if (!nezik) {
      // Csak amíg nem nézel rá. A sebessége a SÉTÁDHOZ van mérve: futva
      // mindig lerázod, sétálva épphogy nem.
      this.rig?.play('walk');
      const lep = MOVE.walkSpeed * HAUNT.speed * HAUNT.mumusSpeed * dt;
      if (tav > 0.001) {
        this.group.position.addScaledVector(
          cel.clone().sub(this.group.position).setY(0).normalize(),
          Math.min(lep, tav)
        );
      }
    }

    if (tav < HAUNT.mumusReach) {
      this.hide();
      return this.dangerous ? 'elkapott' : 'eltunt';
    }
    // TÚL MESSZE KERÜLTÉL: feladja. Nem üldöz a ház végéig — a mumus nem
    // hajsza, hanem egy találkozás, amit el lehet kerülni.
    if (tav > 34) {
      this.hide();
      return 'eltunt';
    }
    return 'semmi';
  }

  private hide(): void {
    this.left = 0;
    this.group.visible = false;
  }

  dispose(): void {
    this.art?.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) (mesh.material as THREE.Material).dispose();
    });
  }
}
