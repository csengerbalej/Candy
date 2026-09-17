import * as THREE from 'three';
import { WEAPON, GUNS, type GunId } from '../core/config';

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
  /**
   * Mennyire volt ERŐS a találat: 1 = teljes, 0 = épp csak súrolta.
   *
   * A sörétes ettől lesz „közelre erős, távolra semmi": ugyanaz a lövés
   * közelről mindent kiver a kézből, a hatótáv szélén viszont csak egy
   * darabot, és meg sem lök rendesen. Egy fegyver, ami a hatótávja végéig
   * ugyanolyan halálos, nem sörétes, hanem lézer.
   */
  strength: number;
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
  /**
   * Melyik fegyver ez.
   *
   * Nem három osztály, hanem egy osztály három adatsorral: a lövés MENETE
   * mindegyiknél ugyanaz (van-e lőszer, kész-e, mi van a vonalban), csak a
   * számok mások. Három osztályból három helyen kellene javítani ugyanazt a
   * hibát — és a harmadik mindig kimarad.
   */
  readonly gun: (typeof GUNS)[GunId];

  constructor(kind: GunId = 'shotgun') {
    this.gun = GUNS[kind];
    this.kind = kind;
    this.ammo = this.gun.magazine;
    this.reserve = this.gun.magazine * 2;
  }

  readonly kind: GunId;

  /** Mennyi ideje áll egy helyben a lövő. A mesterlövésznek ez számít. */
  private still = 0;

  /**
   * TÁVCSŐ: be van-e nagyítva.
   *
   * Csak annak a fegyvernek van értelme, amelyiknek a beállításában van
   * `scopeFov` — a sörétesre nagyítani annyi volna, mint távcsövet tenni egy
   * kalapácsra.
   */
  scoped = false;

  /** Van-e egyáltalán távcsöve. */
  get canScope(): boolean {
    return this.gun.scopeFov > 0;
  }

  /** Hány lövés van a tárban. */
  ammo: number = WEAPON.magazine;
  /** Hány lövés van tartalékban, tárakon kívül. */
  reserve: number = WEAPON.magazine;
  /** Épp tölt-e, és mennyi van hátra. */
  reloading = 0;

  private cool = 0;

  /**
   * @param moving Mozog-e épp a lövő. A mesterlövész ettől lesz pontos vagy
   * pontatlan — ez a fegyver ára: állni kell vele, és állni a legveszélyesebb
   * dolog a házban.
   */
  update(dt: number, moving = false): void {
    this.still = moving ? 0 : this.still + dt;
    this.cool = Math.max(0, this.cool - dt);
    if (this.reloading > 0) {
      this.reloading = Math.max(0, this.reloading - dt);
      if (this.reloading === 0) {
        const want = this.gun.magazine - this.ammo;
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
    if (this.reloading > 0 || this.ammo >= this.gun.magazine || this.reserve <= 0) return;
    this.reloading = this.gun.reload;
  }

  /** Pontos-e most a fegyver. A HUD ebből rajzol célkeresztet. */
  get steady(): boolean {
    return this.still >= this.gun.needsStillness;
  }

  /** Lőszerdoboz felvétele. */
  pickUp(): void {
    this.reserve += this.gun.magazine * 2;
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
    this.cool = this.gun.cooldown;
    if (this.ammo === 0) this.reload();

    const g = this.gun;
    const dir = new THREE.Vector3(Math.sin(heading), 0, Math.cos(heading));
    const end = from.clone().addScaledVector(dir, g.range);

    // A SZÓRÁS a fegyver fajtájából jön, és a mesterlövésznél az ÁLLÁSBÓL is:
    // futás közben kilőtt távoli lövés ne legyen ugyanaz, mint a kivárt.
    const steadiness = g.needsStillness > 0 && !this.steady ? 4 : 1;
    const cone = g.spread * steadiness;
    // Sörétesnél a kúp szélessége a távolsággal nő — ettől lesz közel
    // gyilkos és távol semmi.
    const reach = (at: number): number => g.radius + at * cone;

    let best: Target | null = null;
    let bestT = Infinity;
    for (const t of targets) {
      // Merőleges távolság a lövés vonalától, és hogy előttünk van-e.
      const rel = t.position.clone().sub(from);
      const along = rel.dot(dir);
      if (along <= 0 || along > g.range) continue;
      const side = rel.clone().addScaledVector(dir, -along);
      // Csak a vízszintes eltérés számít: a nyálka csóva, és a szörnyek
      // magassága úgyis eltér.
      const miss = Math.hypot(side.x, side.z);
      if (miss > reach(along) + t.radius) continue;
      if (along >= bestT) continue;
      // Fal takarja? Akkor ez a célpont nincs is itt.
      if (blocked(from, t.position)) continue;
      best = t;
      bestT = along;
    }

    // A TÁVOLSÁG GYENGÍT. A `full` távolságon belül teljes a hatás, azon túl
    // lineárisan fogy a hatótáv széléig. A mesterlövésznél és a rakétánál a
    // `full` egyenlő a hatótávval, tehát nincs gyengülés — ott a távolság
    // nem hátrány, hanem a fegyver lényege.
    const reachEdge = Math.max(1e-3, g.range - g.full);
    const strength = best
      ? THREE.MathUtils.clamp(1 - Math.max(0, bestT - g.full) / reachEdge, 0, 1)
      : 0;

    return {
      from: from.clone(),
      to: best ? best.position.clone() : end,
      hit: best,
      strength,
      noiseAt: from.clone(),
    };
  }
}
