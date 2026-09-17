import * as THREE from 'three';
import { WEAPON } from '../core/config';

/**
 * NYÁLKAPUSKA — a kétfős mód távolsági zsákmányszerzése.
 *
 * A lövés SUGÁRPRÓBA, nem repülő lövedék. Ez nem egyszerűsítés, hanem
 * hálózati döntés: egy lövedéket két gépnek kellene egyformán röptetnie, és
 * a két röppálya a késés miatt sosem egyezne — a dobó azt látná, hogy
 * talált, a célpont azt, hogy elment mellette. Egy azonnali sugárnál viszont
 * egyetlen pillanat van, amit el kell dönteni, és azt EL LEHET dönteni.
 *
 * Aki eldönti: a CÉLPONT gépe. „Kitértem, mégis eltalált" a legrosszabb
 * érzés, amit hálózati játék adhat; a másik irányban csak annyit látsz, hogy
 * a lövésed egy pillanattal később számít.
 *
 * A fegyver három dolgot költ, és mind a három látható: időt (újratöltés),
 * figyelmet (a lövés zaja odahívja a lakót), és lőszert.
 */

export interface Target {
  /** Ki ez — a hálózaton ezzel nevezzük meg a találatot. */
  id: string;
  position: THREE.Vector3;
  /** Mekkora testet takar. A szörnyek magassága eltér, a sugár nem. */
  radius: number;
}

export interface Shot {
  /** Honnan indult — a lövedék rajzolásához és a próbához. */
  from: THREE.Vector3;
  /** Ameddig elért: vagy a célpont, vagy a hatótáv vége. */
  to: THREE.Vector3;
  /** Kit talált el, ha bárkit. */
  hit: Target | null;
  /** A zaj helye. Mindig a CSŐVÉG, nem a becsapódás: a lövés hangja ott szól. */
  noiseAt: THREE.Vector3;
}

export class Weapon {
  /** Hány lövés van a tárban. */
  ammo = WEAPON.magazine;
  /** Hány lövés van tartalékban, tárakon kívül. */
  reserve = WEAPON.magazine;
  /** Épp tölt-e, és mennyi van hátra. */
  reloading = 0;

  private cool = 0;

  update(dt: number): void {
    this.cool = Math.max(0, this.cool - dt);
    if (this.reloading > 0) {
      this.reloading = Math.max(0, this.reloading - dt);
      if (this.reloading === 0) {
        const want = WEAPON.magazine - this.ammo;
        const take = Math.min(want, this.reserve);
        this.ammo += take;
        this.reserve -= take;
      }
    }
  }

  /** Lőhető-e ebben a pillanatban. A HUD is ezt kérdezi. */
  get ready(): boolean {
    return this.ammo > 0 && this.cool === 0 && this.reloading === 0;
  }

  /** Kézzel indított újratöltés. Üres tárral magától is elindul. */
  reload(): void {
    if (this.reloading > 0 || this.ammo >= WEAPON.magazine || this.reserve <= 0) return;
    this.reloading = WEAPON.reload;
  }

  /** Lőszerdoboz felvétele. */
  pickUp(): void {
    this.reserve += WEAPON.pack;
  }

  /**
   * Lövés a `heading` irányba.
   *
   * @param targets Akik eltalálhatók. A LÖVŐ nincs köztük — magadat nem
   * lőheted meg, és ezt nem a játékosnak kell kikerülnie.
   * @param blocked Igaz, ha a két pont között fal van. A jelenet adja; a
   * fegyver nem ismeri a házat, csak azt kérdezi, átlátni-e.
   */
  fire(
    from: THREE.Vector3,
    heading: number,
    targets: readonly Target[],
    blocked: (a: THREE.Vector3, b: THREE.Vector3) => boolean = () => false
  ): Shot | null {
    if (this.ammo <= 0) {
      // Üres tár MAGÁTÓL tölt. Enélkül a játékos a legrosszabb pillanatban
      // nyomkodná a gombot, és nem értené, miért nem történik semmi.
      this.reload();
      return null;
    }
    if (!this.ready) return null;

    this.ammo--;
    this.cool = WEAPON.cooldown;
    if (this.ammo === 0) this.reload();

    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const end = from.clone().addScaledVector(dir, WEAPON.range);

    let best: Target | null = null;
    let bestT = Infinity;
    for (const t of targets) {
      // Merőleges távolság a lövés vonalától, és hogy előttünk van-e.
      const rel = t.position.clone().sub(from);
      const along = rel.dot(dir);
      if (along <= 0 || along > WEAPON.range) continue;
      const side = rel.clone().addScaledVector(dir, -along);
      // Csak a vízszintes eltérés számít: a nyálka csóva, és a szörnyek
      // magassága úgyis eltér.
      const miss = Math.hypot(side.x, side.z);
      if (miss > WEAPON.radius + t.radius) continue;
      if (along >= bestT) continue;
      // Fal takarja? Akkor ez a célpont nincs is itt.
      if (blocked(from, t.position)) continue;
      best = t;
      bestT = along;
    }

    return {
      from: from.clone(),
      to: best ? best.position.clone() : end,
      hit: best,
      noiseAt: from.clone(),
    };
  }
}
