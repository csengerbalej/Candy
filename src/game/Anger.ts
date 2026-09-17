import { ANGER } from '../core/config';

/**
 * A VÁROS HARAGJA.
 *
 * Egyetlen szám, sok forrásból. A szörnyecskék egész este számolnak: kit
 * ütöttél el, hol hajtottál át piroson, mikor mentél fel a járdára, meddig
 * tartottad a padlón, hányszor dudáltál, mikor nitróztál.
 *
 * Amiért egy szám, és nem sok külön szabály: mert a végén EGY dolgot mond
 * meg — mekkora falka vár a célháznál. A jó vezetés jutalma nem az, hogy
 * elmarad a futás (az elvett tartalom lenne), hanem hogy KEVESEBBEN jönnek.
 *
 * És APAD. Ez nem részletkérdés: ha csak nőne, akkor nem ügyesség, hanem
 * visszaszámláló — elég hosszan vezetsz, és úgyis maximumon vagy. Apadással
 * viszont egy hiba után van értelme összeszedni magad, és a jó vezetés végig
 * számít, nem csak az első percben.
 */
export class Anger {
  /** 0..1. A falka mérete ebből jön. */
  level = 0;

  /** Amit legutóbb elrontottál — a HUD egy pillanatra kiírja. */
  lastReason = '';
  private flash = 0;

  private hornCooldown = 0;

  /** Egy elütött szörnyecske. Ez a legsúlyosabb: ez személyes. */
  hitCritter(count = 1): void {
    this.add(ANGER.critterHit * count, 'ELÜTÖTTÉL EGY SZÖRNYET');
  }

  /** Piroson áthajtás: szándékos szabályszegés. */
  ranRedLight(): void {
    this.add(ANGER.redLight, 'PIROSON MENTÉL ÁT');
  }

  /**
   * Egy képkocka a városban.
   *
   * @param onPavement Nem az úttesten van-e a kocsi.
   * @param speedShare A sebesség a végsebesség hányadában.
   * @param horn Most nyomtad-e meg a dudát.
   * @param nitro Szól-e a nitró.
   */
  update(
    dt: number,
    onPavement: boolean,
    speedShare: number,
    horn: boolean,
    nitro: boolean
  ): void {
    this.flash = Math.max(0, this.flash - dt);
    if (this.flash <= 0) this.lastReason = '';
    this.hornCooldown = Math.max(0, this.hornCooldown - dt);

    let rise = 0;
    // A járda: ott laknak, ott sétálnak. Amíg rajta vagy, folyamatosan tölt.
    if (onPavement) rise += ANGER.pavement;
    // A gyorshajtás LASSAN tölt, nem ugrásszerűen.
    //
    // A százhúsz km/h a te kérésed volt, és a kocsi arra van hangolva. Ha a
    // sebesség keményen büntetne, azt vennénk vissza: soha nem használnád.
    // Így viszont egy rövid száguldás olcsó, az egész estét végigtolni
    // maximumon drága — a sebesség eszköz marad, csak nem ingyen.
    if (speedShare > ANGER.speedLimit) {
      rise += ANGER.speeding * ((speedShare - ANGER.speedLimit) / (1 - ANGER.speedLimit));
    }
    // A nitró a leghangosabb dolog a városban.
    if (nitro) rise += ANGER.nitro;

    if (rise > 0) {
      this.level = Math.min(1, this.level + rise * dt);
      if (!this.lastReason) {
        this.lastReason = onPavement ? 'A JÁRDÁN MÉSZ' : nitro ? 'A NITRÓ HANGOS' : 'GYORSHAJTÁS';
        this.flash = 1.4;
      }
    } else {
      // Csak akkor apad, ha ÉPP NEM rontod. Enélkül a járdán tolatva is
      // csökkenne, amíg a levonás nagyobb a hozzáadásnál.
      this.level = Math.max(0, this.level - ANGER.calm * dt);
    }

    // A duda azonnali és kicsi — és ezért lehet SZÁNDÉKOSAN bőszíteni vele.
    if (horn && this.hornCooldown <= 0) {
      this.hornCooldown = 0.35;
      this.add(ANGER.horn, 'DUDÁLTÁL');
    }
  }

  /**
   * Mekkora falka vár a háznál.
   *
   * Sosem nulla: a tiszta estén is jön egy kis csapat. A jó játék nem vehet
   * el tartalmat — az ügyesség jutalma a könnyebb menet, nem a kimaradó.
   */
  get packSize(): number {
    return Math.round(ANGER.packMin + (ANGER.packMax - ANGER.packMin) * this.level);
  }

  /** Emberi szöveg a HUD-nak. */
  get label(): string {
    const pct = Math.round(this.level * 100);
    if (pct < 20) return 'A VÁROS NYUGODT';
    if (pct < 45) return 'FIGYELNEK';
    if (pct < 75) return 'IDEGESEK';
    return 'DÜHÖSEK';
  }

  private add(amount: number, why: string): void {
    this.level = Math.min(1, this.level + amount);
    this.lastReason = why;
    this.flash = 1.8;
  }
}
