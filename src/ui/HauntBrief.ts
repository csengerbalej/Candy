import { HAUNT } from '../core/config';

/**
 * A ELIGAZÍTÁS: mi mire jó.
 *
 * Egy horrormódban a szabályokat NEM lehet kitapasztalni. A felfedezés
 * máskor a játék fele — itt viszont a tapasztalás ára a halál, és aki
 * háromszor bukik el azon, hogy nem tudta, mit kell tennie, az nem
 * megijed, hanem abbahagyja.
 *
 * Ezért a kör elején ott áll, melyik szörnyre mi hat. Nem elrontja a
 * félelmet: attól, hogy TUDOD, mit kell tenned, még nem lesz könnyű
 * megcsinálni, amikor jön feléd a sötétben. A Leső a jó példa — pontosan
 * tudod, hogy ki kell tartanod a fényt két másodpercig, és pont ez a nehéz.
 *
 * Bármelyik gombra eltűnik, és a kör alatt a H-val bármikor visszahívható.
 */
export class HauntBrief {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'haunt-brief';
    this.el.innerHTML = `
      <h2>A KÚRIA</h2>
      <p class="mit">Szedjétek össze a cukorkát, és jussatok ki. Fegyver nincs.
      Mindegyik szörnyre MÁS hat — és ez a tudás az egyetlen fegyveretek.</p>
      <div class="sorok">
        <div class="szorny">
          <b>A VAK</b>
          <span class="jel">nincs szeme · csak hall</span>
          <span class="ellen">ÁLLJ MEG. ${HAUNT.calm} másodperc csend, és továbbmegy.</span>
        </div>
        <div class="szorny">
          <b>A KÖVETŐ</b>
          <span class="jel">tompa vörös szem · lassú</span>
          <span class="ellen">Nem adja fel, és fény nem hat rá. FUSS, és kerüld meg —
          de a futás zaj, amit a Vak meghall.</span>
        </div>
        <div class="szorny">
          <b>A LESŐ</b>
          <span class="jel">fénylő pókszemek · áll a sötétben</span>
          <span class="ellen">A lámpád FELÉBRESZTI és ÉGETI is. Tartsd ki rajta
          ${HAUNT.burn} másodpercig, és szétfoszlik. Ha félúton elkapod a
          tekinteted, már ébren van — és ő a leggyorsabb.</span>
        </div>
      </div>
      <div class="eszkoz">
        <div><b>A LÁMPA</b> egy van kettőtökre, és fogy.
        Kikapcsolva nem fogy — a spórolás is döntés.</div>
        <div><b>HA ELKAPNAK</b>, összecsuklasz. A társadnak ${HAUNT.bleed} másodperce
        van melléd guggolni (${HAUNT.revive} mp, végig nyomva). Ha mindketten
        lent vagytok, vége — és a cukorka is odavan.</div>
      </div>
      <p class="tovabb">bármelyik gomb · a H bármikor visszahozza</p>`;
    parent.appendChild(this.el);
  }

  /** Látszik-e. A jelenet ebből tudja, hogy szünetel a kör. */
  get open(): boolean {
    return !this.el.hidden;
  }

  toggle(on = !this.open): void {
    this.el.hidden = !on;
  }

  dispose(): void {
    this.el.remove();
  }
}
