import * as THREE from 'three';
import type { DriveWorld } from './DriveWorld';

/**
 * Elszórt cukorka az utcán.
 *
 * A város eddig ÚT volt: átmenet a házak között, ahol a vezetés önmagáért
 * volt jó, de semmi nem tartozott hozzá. Ez az első dolog kint, ami a zsákba
 * kerül — és ettől a kitérő is döntés lesz, nem csak kanyar.
 *
 * Mindig `LIVE` darab fekszik odakint. Amit felszedsz, az nem tűnik el
 * végleg: pár másodperc múlva a város EGY MÁSIK pontján bukkan fel. Nem
 * körpálya és nem is teljesen véletlen: aszfalton terem, mert az autóval
 * kell odaérni, viszont a célházadtól messzebb szívesebben — a kitérőért jár,
 * nem az útba esésért.
 */
export class StreetCandy {
  readonly group = new THREE.Group();

  /**
   * Hány darab fekszik egyszerre a városban.
   *
   * Hét volt, a 233 egységes városhoz mérve. A város ötszörös területén ez
   * annyit jelentett, hogy percekig vezettél anélkül, hogy egyet is láttál
   * volna — és a „szedj fel hármat" kihívás ettől nem kitérő lett, hanem
   * kutatás.
   */
  /** Nyilvános, mert a próba ehhez méri a készletet — nem egy régi számhoz. */
  static readonly LIVE = 22;
  /** Mennyi idő múlva bukkan fel újra, amit felszedtél. */
  private static readonly RESPAWN = 11;
  /** Ennyire kell megközelíteni. Nagyvonalú: 120-szal nehéz célozni. */
  private static readonly REACH = 4.2;

  private readonly pieces: {
    mesh: THREE.Object3D;
    home: THREE.Vector3;
    cooldown: number;
    spin: number;
  }[] = [];

  private taken = 0;

  constructor(
    private readonly world: DriveWorld,
    private readonly random: () => number = Math.random
  ) {
    for (let i = 0; i < StreetCandy.LIVE; i++) {
      const mesh = new THREE.Group();
      const at = this.freeSpot();
      mesh.position.copy(at);
      this.group.add(mesh);
      this.pieces.push({ mesh, home: at, cooldown: 0, spin: this.random() * Math.PI * 2 });
    }
  }

  /**
   * A modell — ugyanaz a geometria minden darabon.
   *
   * Külön jön, mert a fájl hálózatról érkezik, a helyek viszont az első
   * képkockán kellenek: enélkül a cukorka HELYE a betöltéstől függne, és egy
   * lassú kapcsolat átrendezné a pályát.
   */
  setArt(art: THREE.Object3D): void {
    for (const p of this.pieces) {
      // A modell MÁR a helyes méretben érkezik (a jelenet a szörnyecskéből
      // számolja). Egy szorzó itt csak újra szétcsúsztatná a kettőt.
      p.mesh.add(art.clone(true));
    }
  }

  /** Hány darabot szedtek fel eddig. */
  get collected(): number {
    return this.taken;
  }

  /** Épp hány fekszik kint. */
  get live(): number {
    return this.pieces.filter((p) => p.cooldown <= 0).length;
  }

  /**
   * A KINT FEKVŐ darabok helye.
   *
   * Az AI sofőrnek kell: neki is teljesítenie kell a gyűjtés-kihívást, és
   * ahhoz tudnia kell, hová menjen. A lista csak a felszedhetőket adja — egy
   * épp visszatérő darab felé indulni annyi, mint a semmi felé.
   */
  get spots(): THREE.Vector3[] {
    return this.pieces.filter((p) => p.cooldown <= 0).map((p) => p.home.clone());
  }

  /**
   * @returns hány darabot szedett fel ez a képkocka.
   */
  update(dt: number, elapsed: number, car: THREE.Vector3): number {
    let got = 0;
    for (const p of this.pieces) {
      if (p.cooldown > 0) {
        p.cooldown -= dt;
        if (p.cooldown <= 0) {
          // Új helyen bukkan fel, nem ott, ahol felszedték. Enélkül egy
          // sarkon körözve végtelen cukorkát lehetne termelni.
          p.home.copy(this.freeSpot());
          p.mesh.position.copy(p.home);
          p.mesh.visible = true;
        }
        continue;
      }

      // Forog és lebeg: egy mozdulatlan tárgy az aszfalton szemét, egy forgó
      // tárgy felvehető. Ez az egyetlen jelzés, amit menet közben el lehet
      // olvasni.
      p.mesh.rotation.y = p.spin + elapsed * 1.9;
      p.mesh.position.y = p.home.y + Math.sin(elapsed * 2.6 + p.spin) * 0.35;

      const dx = car.x - p.mesh.position.x;
      const dz = car.z - p.mesh.position.z;
      if (dx * dx + dz * dz < StreetCandy.REACH * StreetCandy.REACH) {
        p.cooldown = StreetCandy.RESPAWN;
        p.mesh.visible = false;
        this.taken++;
        got++;
      }
    }
    return got;
  }

  /** Egy szabad aszfaltpont a városban. */
  private freeSpot(): THREE.Vector3 {
    const b = this.world.bounds;
    for (let tries = 0; tries < 400; tries++) {
      const x = b.min.x + this.random() * (b.max.x - b.min.x);
      const z = b.min.y + this.random() * (b.max.y - b.min.y);
      if (!this.world.onRoad(x, z)) continue;
      // Ne kerüljön oda, ahol már fekszik egy: két cukorka egy helyen egy
      // cukorkának látszik, és a hetedik darab elvész.
      // A minimális távolság a DARABSZÁMHOZ igazodik: huszonkét darabot nem
      // lehet húsz egységenként elhelyezni egy városban úgy, hogy közben
      // mindegyik úton legyen.
      if (this.pieces.some((p) => p.home.distanceToSquared(new THREE.Vector3(x, 0.75, z)) < 900)) {
        continue;
      }
      return new THREE.Vector3(x, 0.75, z);
    }
    return new THREE.Vector3(0, 1.5, 0);
  }
}
