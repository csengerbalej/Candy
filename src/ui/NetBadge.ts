import type { NetSession, NetState } from '../net/NetSession';

/**
 * Egy sarokba kitett jelző arról, hogy a szoba él-e.
 *
 * Azért kell, mert enélkül a hálózat NEM MÉRHETŐ a játékos szemével: ha két
 * eszközön mást csinál az autó, abból nem derül ki, hogy a csatorna néma-e,
 * vagy csak összegabalyodott a szerep. A jelző szétválasztja a kettőt —
 * külön mondja meg, hogy csatlakozva vagyunk-e, hányan vagyunk, és melyik
 * szerep a miénk. Ez az első, amit a teszt megnéz.
 *
 * Mindig látszik, a címképernyőn is: a párosítás a menüben dől el, tehát ott
 * kell látni, hogy megérkezett-e a társ.
 */
export class NetBadge {
  private readonly el: HTMLDivElement;
  private stop: (() => void) | null = null;
  /** A megosztandó kód, ha a szoba nem a futtatókörnyezeté. */
  private code: string | null = null;
  private last: NetState | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'net-badge';
    parent.appendChild(this.el);
    this.show(null);
  }

  /**
   * Megjeleníti a MEGHÍVÓT.
   *
   * Enélkül a közvetlen (fiók nélküli) szoba használhatatlan: a kód létezik,
   * de a játékos nem látja, tehát nincs mit elküldenie a társának. A linkre
   * kattintva vágólapra kerül — begépelni nem kell.
   */
  invite(code: string): void {
    this.code = code;
    this.el.onclick = () => {
      const link = location.origin + location.pathname + location.search + '#j=' + code;
      void navigator.clipboard?.writeText(link).then(
        () => this.flash('LINK MÁSOLVA'),
        () => this.flash(link)
      );
    };
    this.el.style.cursor = 'pointer';
    this.show(this.last);
  }

  private flash(text: string): void {
    const note = this.el.querySelector('span');
    if (!note) return;
    const before = note.textContent;
    note.textContent = text;
    setTimeout(() => {
      if (note.textContent === text) note.textContent = before;
    }, 1800);
  }

  /** A munkamenet lecserélődik, amikor a szoba megnyílik — ezért követhető. */
  watch(session: NetSession): void {
    this.stop?.();
    this.stop = session.onChange((state) => this.show(state));
  }

  private show(state: NetState | null): void {
    this.last = state;
    // A közvetlen szobában az „egyedül vagyok" nem hiba, hanem a VÁRAKOZÁS
    // állapota: a kód már él, csak még nem jött meg a társ. Ha ilyenkor
    // „nincs szoba" volna kiírva, a játékos jogosan hinné, hogy nem működik.
    if (this.code && (!state || !state.paired)) {
      this.el.dataset.state = 'wait';
      this.el.innerHTML =
        `<i></i><b>KÓD: ${this.code}</b><span>kattints: meghívó link másolása</span>`;
      return;
    }
    if (!state || !state.online) {
      this.el.dataset.state = 'off';
      this.el.innerHTML = `<i></i><b>EGY GÉPEN</b><span>nincs szoba</span>`;
      return;
    }
    if (!state.paired) {
      this.el.dataset.state = 'wait';
      this.el.innerHTML =
        `<i></i><b>SZOBA NYITVA</b>` +
        `<span>${state.count} eszköz · várunk a társra</span>`;
      return;
    }
    this.el.dataset.state = 'on';
    this.el.innerHTML =
      `<i></i><b>${state.role === 'host' ? 'GAZDA' : 'VENDÉG'}</b>` +
      `<span>${state.count} eszköz · te vagy a ${state.playerIndex + 1}. szörny</span>`;
  }

  dispose(): void {
    this.stop?.();
    this.el.remove();
  }
}
