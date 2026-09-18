/**
 * AZ IJESZTÉS.
 *
 * Egy teljes képernyős arc és egy hang, másfél másodpercig. Nem több — egy
 * hosszabb ijesztés nem ijesztőbb, csak bosszantóbb, és a másodperc végére
 * már a gombot keresed.
 *
 * Amitől MŰKÖDIK, és amiért nem véletlenszerű:
 *
 * A képernyő a becsapódás pillanatáig NEM készül rá. Nincs bevezető zene,
 * nincs sötétedés, nincs figyelmeztetés — mert bármelyik elvenné az egészet.
 * Az ijedés maga a FELKÉSZÜLETLENSÉG; amire számítasz, az legfeljebb
 * kellemetlen.
 *
 * Ezért hívja a jelenet PONTOSAN akkor, amikor a szörny elér — és ezért
 * nincs időzítője.
 */
export class Jumpscare {
  private readonly el: HTMLDivElement;
  private left = 0;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'jumpscare';
    this.el.hidden = true;
    parent.appendChild(this.el);
  }

  /**
   * @param face A szörny képe (a karakterválasztó portréi).
   */
  fire(face: string): void {
    this.el.style.backgroundImage = `url(${face})`;
    this.el.hidden = false;
    // ÚJRAINDÍTOTT ANIMÁCIÓ. Enélkül a második ijesztés néma maradna: a
    // böngésző ugyanazt az osztályt látja, és nem kezdi elölről.
    this.el.classList.remove('hit');
    void this.el.offsetWidth;
    this.el.classList.add('hit');
    this.left = 1.2;
  }

  update(dt: number): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) {
      this.el.hidden = true;
      this.el.classList.remove('hit');
    }
  }

  /** Megy-e épp. A jelenet ebből tudja, hogy ne fogadjon el gombot. */
  get running(): boolean {
    return this.left > 0;
  }

  dispose(): void {
    this.el.remove();
  }
}
