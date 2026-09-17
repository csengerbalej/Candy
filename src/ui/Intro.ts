import { hasTouch } from '../input/TouchControls';
/**
 * Az éjszaka felütése: sötét képernyő, betűnként kiíródó szöveg.
 *
 * A karakterválasztó után jön, és nem a menübe tartozik — ez a különbség
 * számít. A menü KÉRDÉSEKET tesz fel (ki vagy, kit választasz); ez ELMONDJA,
 * miért indulunk el. Egy kérdés közé ékelve az ember átkattint rajta; a
 * választás UTÁN, sötétben, már nincs mit sietni.
 *
 * Betűnként, mert az a szöveg ritmusát adja vissza: a három pont tényleg
 * szünet lesz, a felkiáltójel tényleg csattan. Egy egyszerre megjelenő
 * bekezdést a szem egy pillanat alatt átfut, és semmi nem marad meg belőle.
 *
 * Kihagyható — bármelyik gombbal. Aki másodszor játszik, annak ez a
 * képernyő már csak akadály, és egy át nem ugorható intró az a fajta
 * részlet, amitől az emberek nem indítják újra a játékot.
 */
const LINES: Array<{ text: string; pause: number; className?: string }> = [
  // A HÁROM ÜTEM: mi történt, hol vagytok, mit kell csinálni.
  //
  // Az első változatban „Tizenhat ház" szerepelt — az a RÉGI, négyszer
  // négyes térkép száma volt, és azóta hatvannégy telek van, amiből hármat
  // jársz végig egy este. Egy intró, ami rosszul mondja meg a szabályt,
  // rosszabb, mint ami nem mond semmit.
  //
  // És bekerült a KONYHA is: mióta a panoráma ott van az üveg mögött, a
  // játékos látja is, hol van — az intrónak meg kell neveznie, különben a
  // kép és a szöveg két külön dologról beszél.
  { text: 'Volt egyszer egy Halloween.', pause: 0.9 },
  { text: 'Aztán valaki leszedte a polcról…', pause: 0.9 },
  { text: '…és befőttesüvegbe zárta.', pause: 1.3 },
  { text: '', pause: 0.35 },
  { text: 'Bent rekedt a város.', pause: 0.4 },
  { text: 'Bent rekedt minden cukorka.', pause: 0.5 },
  { text: 'És bent rekedtetek ti is.', pause: 1.2 },
  { text: '', pause: 0.4 },
  { text: 'Odakint egy konyha. Egy asztal.', pause: 0.7 },
  { text: 'Egy lámpa, ami nem nektek ég.', pause: 1.3 },
  { text: '', pause: 0.4 },
  { text: 'Egy éjszakátok van. Három ház.', pause: 0.7 },
  { text: 'Szedjétek össze — aztán tűnjetek el!', pause: 1.2, className: 'shout' },
  { text: '', pause: 0.5 },
  { text: 'De a lakók nem alszanak.', pause: 0.9, className: 'warn' },
  { text: 'És az üvegen kívül mászik valami.', pause: 1.6, className: 'warn' },
];

/** Másodperc betűnként. A felkiáltás gyorsabb, a fenyegetés lassabb. */
const SPEED: Record<string, number> = { normal: 0.042, shout: 0.03, warn: 0.058 };

export class Intro {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly skip: HTMLDivElement;
  private resolve: (() => void) | null = null;
  private timer: number | null = null;
  private done = false;
  /**
   * Mikortól viszi el a gomb az intrót.
   *
   * Nem óvatosság: a karakterválasztót egy GOMBNYOMÁSSAL zárod le, és ha egy
   * pillanattal tovább tartod, a billentyűismétlés már az intróra érkezik —
   * az azonnal átugrik, és a játékos csak egy fekete képernyőt lát. Pontosan
   * ez történt. A rövid vakság ezt zárja ki, és semmit nem ront: aki tényleg
   * át akarja ugrani, az fél másodperccel később is megteheti.
   */
  private armed = false;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'intro';
    parent.appendChild(this.root);

    this.body = document.createElement('div');
    this.body.className = 'intro-body';
    this.root.appendChild(this.body);

    this.skip = document.createElement('div');
    this.skip.className = 'intro-skip';
    // Telón nincs „bármelyik gomb". A koppintás eddig is továbbvitt (a
    // kattintás-kezelő miatt), de EZT KI IS KELL ÍRNI: egy működő gomb, amiről
    // a játékos nem tudja, hogy létezik, nem működő gomb.
    this.skip.textContent = hasTouch() ? 'koppints: tovább' : 'bármelyik gomb: tovább';
    this.root.appendChild(this.skip);

    window.addEventListener('keydown', this.onSkip);
    this.root.addEventListener('click', this.onSkip);
    window.setTimeout(() => {
      this.armed = true;
    }, 600);
  }

  run(): Promise<void> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      void this.play();
    });
  }

  private async play(): Promise<void> {
    for (const line of LINES) {
      if (this.done) return;
      const row = document.createElement('p');
      if (line.className) row.className = line.className;
      this.body.appendChild(row);

      const speed = SPEED[line.className ?? 'normal'] ?? SPEED.normal;
      for (const letter of line.text) {
        if (this.done) return;
        row.textContent += letter;
        // A három pont saját ritmust kap: ott a szöveg levegőt vesz.
        await this.wait(letter === '…' ? speed * 12 : letter === ',' ? speed * 6 : speed);
      }
      await this.wait(line.pause);
    }
    await this.wait(0.8);
    this.finish();
  }

  private wait(seconds: number): Promise<void> {
    return new Promise((done) => {
      this.timer = window.setTimeout(done, seconds * 1000);
    });
  }

  private readonly onSkip = (): void => {
    if (!this.armed) return;
    this.finish();
  };

  /**
   * A sötét lapot csak AKKOR vesszük el, amikor van mögötte mit nézni.
   *
   * Az intró a betöltés alatt is fut — épp ez a dolga —, tehát ha a vége után
   * azonnal eltűnne, a játékos a falu betöltéséig ugyanúgy fekete képernyőt
   * bámulna. A hívó akkor szól, amikor a jelenet készen áll.
   */
  dismiss(): void {
    this.root.classList.add('is-out');
    window.setTimeout(() => this.root.remove(), 700);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    if (this.timer !== null) window.clearTimeout(this.timer);
    window.removeEventListener('keydown', this.onSkip);
    this.resolve?.();
    this.resolve = null;
  }
}
