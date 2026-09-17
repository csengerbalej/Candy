/**
 * ÉRINTŐVEZÉRLÉS — a játék telefonon.
 *
 * Eddig egyetlen érintés-kezelő sem volt a kódban: telón a menü megjelent, a
 * kocsi viszont meg sem mozdult. Nem „kényelmetlen" volt, hanem
 * JÁTSZHATATLAN — és ez pont az a fajta hiba, ami nem ad hibaüzenetet.
 *
 * Amitől ez egyetlen vezérlő tud lenni mindkét szakaszra: a játéknak
 * ugyanaz a bemenete vezetés közben és a házban — egy irány és pár gomb. A
 * bot FÜGGŐLEGES tengelye vezetéskor gáz és fék, a házban előre-hátra; a
 * vízszintes kormány, illetve oldalazás. Nem kell két kiosztás.
 *
 * Két dolgot tanultam meg a mobilos bemenetről, és mindkettő itt van kódban:
 *
 *   · A bot nem oda kerül, ahová rajzoltam, hanem ahová a hüvelykujj
 *     LETESZI magát. Rögzített bot esetén a játékos vakon keresi.
 *   · Egy ujj egy gomb: a `touchend` a MAGA azonosítóját engedi el, nem az
 *     összeset. Enélkül a gáz elhal, amint a másik ujj felemelkedik.
 */

export interface TouchState {
  moveX: number;
  moveY: number;
  jumpHeld: boolean;
  interactHeld: boolean;
  nitro: boolean;
  sprint: boolean;
}

/** Van-e egyáltalán érintőképernyő. Egérrel a gombok csak zavarnának. */
export function hasTouch(): boolean {
  return (
    typeof window !== 'undefined' &&
    (navigator.maxTouchPoints > 0 || 'ontouchstart' in window)
  );
}

/** Ekkora elmozdulás a bot közepétől már teljes kitérés (képpont). */
const STICK_RANGE = 46;

export class TouchControls {
  readonly state: TouchState = {
    moveX: 0, moveY: 0, jumpHeld: false, interactHeld: false, nitro: false, sprint: false,
  };

  /** Egyszer igaz, ha a szünet gombot nyomták. */
  private pausePressed = false;
  /** Egyszer igaz, ha a beszélgetés gombját nyomták. */
  private chatPressed = false;

  private readonly root: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly pad: HTMLDivElement;
  /** Melyik ujj tartja a botot, és honnan indult. */
  private stickId: number | null = null;
  private originX = 0;
  private originY = 0;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'touch';
    this.root.innerHTML = `
      <div class="touch-pad"><div class="touch-knob"></div></div>
      <div class="touch-keys">
        <button class="touch-btn nitro" data-hold="nitro">NITRÓ</button>
        <button class="touch-btn act" data-hold="interactHeld">E</button>
        <button class="touch-btn jump" data-hold="jumpHeld">UGRÁS</button>
      </div>
      <div class="touch-top">
        <button class="touch-mini" data-tap="chat">CHAT</button>
        <button class="touch-mini" data-tap="pause">II</button>
      </div>`;
    parent.appendChild(this.root);
    this.pad = this.root.querySelector('.touch-pad') as HTMLDivElement;
    this.knob = this.root.querySelector('.touch-knob') as HTMLDivElement;

    // A BOT. A `touches` listát végigjárjuk, mert a hüvelykujj nem az egyetlen
    // ujj a képernyőn: a gázt nyomó másik ujj eseményei is ide érkeznek.
    this.pad.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.stickId = t.identifier;
      // A bot ODA ugrik, ahová letetted — nem a kirajzolt körbe.
      this.originX = t.clientX;
      this.originY = t.clientY;
      const box = this.pad.getBoundingClientRect();
      this.pad.style.transform =
        `translate(${t.clientX - (box.left + box.width / 2)}px, ${t.clientY - (box.top + box.height / 2)}px)`;
      e.preventDefault();
    }, { passive: false });

    const move = (e: TouchEvent) => {
      if (this.stickId === null) return;
      for (const t of Array.from(e.touches)) {
        if (t.identifier !== this.stickId) continue;
        const dx = (t.clientX - this.originX) / STICK_RANGE;
        const dy = (t.clientY - this.originY) / STICK_RANGE;
        const len = Math.hypot(dx, dy);
        const k = len > 1 ? 1 / len : 1;
        this.state.moveX = dx * k;
        this.state.moveY = -dy * k; // képernyőn lefelé = hátra
        this.knob.style.transform = `translate(${dx * k * STICK_RANGE}px, ${dy * k * STICK_RANGE}px)`;
        e.preventDefault();
        return;
      }
    };
    this.pad.addEventListener('touchmove', move, { passive: false });

    const release = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        // CSAK a bot ujja számít. Ha bármelyik felemelt ujjra elengednénk, a
        // kormány elhalna, valahányszor a másik kezed gombot enged el.
        if (t.identifier !== this.stickId) continue;
        this.stickId = null;
        this.state.moveX = 0;
        this.state.moveY = 0;
        this.knob.style.transform = '';
        this.pad.style.transform = '';
      }
    };
    this.pad.addEventListener('touchend', release);
    this.pad.addEventListener('touchcancel', release);

    // A GOMBOK. Nyomva tartva szólnak, tehát nem `click` — az csak az
    // elengedéskor sülne el, és a gáz sosem lenne folyamatos.
    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('[data-hold]'))) {
      const key = el.dataset.hold as 'nitro' | 'interactHeld' | 'jumpHeld';
      const down = (e: Event) => {
        this.state[key] = true;
        el.dataset.on = '1';
        e.preventDefault();
      };
      const up = () => {
        this.state[key] = false;
        delete el.dataset.on;
      };
      el.addEventListener('touchstart', down, { passive: false });
      el.addEventListener('touchend', up);
      el.addEventListener('touchcancel', up);
    }

    for (const el of Array.from(this.root.querySelectorAll<HTMLElement>('[data-tap]'))) {
      el.addEventListener('touchstart', (e) => {
        if (el.dataset.tap === 'pause') this.pausePressed = true;
        else this.chatPressed = true;
        e.preventDefault();
      }, { passive: false });
    }
  }

  /** Igaz egyszer, szünet gomb után. */
  consumePause(): boolean {
    const hit = this.pausePressed;
    this.pausePressed = false;
    return hit;
  }

  /** Igaz egyszer, beszélgetés gomb után. */
  consumeChat(): boolean {
    const hit = this.chatPressed;
    this.chatPressed = false;
    return hit;
  }

  /**
   * A menüben nincs mit kormányozni — ott a gombok csak eltakarnák a
   * képernyőt. A jelenetek kapcsolják.
   */
  setVisible(on: boolean): void {
    this.root.dataset.on = on ? '1' : '0';
  }

  dispose(): void {
    this.root.remove();
  }
}
