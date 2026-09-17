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

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'net-badge';
    parent.appendChild(this.el);
    this.show(null);
  }

  /** A munkamenet lecserélődik, amikor a szoba megnyílik — ezért követhető. */
  watch(session: NetSession): void {
    this.stop?.();
    this.stop = session.onChange((state) => this.show(state));
  }

  private show(state: NetState | null): void {
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
