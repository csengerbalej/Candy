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
      <p class="mit"><b>A KIJÁRAT MINDIG NYITVA.</b> ${HAUNT.quota} cukorkával
      sikeres a kör, de kimenni bármikor ki lehet — akár kevesebbel is.
      Minden felvett darab után eldöntitek: kifelé most, vagy még egyért?
      Ha mindketten lent maradtok, az egész odavan.</p>
      <div class="sorok">
        <div class="szorny">
          <b>A VAK</b>
          <span class="jel">nincs szeme · csak hall</span>
          <span class="ellen">ÁLLJ MEG. ${HAUNT.calm} másodperc csend, és továbbmegy.</span>
        </div>
        <div class="szorny">
          <b>A KÖVETŐ</b>
          <span class="jel">tompa vörös szem · lassú · NEM BÁNT</span>
          <span class="ellen">Nem támad — csak jön, és minden lépésével ZAJT KELT,
          amire a Vak megérkezik. Amíg mögötted van, folyamatosan hívja rád a
          többieket. Tűnj el a szeme elől és menj messzire: pár másodperc
          után feladja.</span>
        </div>
        <div class="szorny">
          <b>A LESŐ</b>
          <span class="jel">fénylő pókszemek · áll a sötétben</span>
          <span class="ellen">A lámpád FELÉBRESZTI és ÉGETI is. Tartsd ki rajta
          ${HAUNT.burn} másodpercig, és szétfoszlik. Ha félúton elkapod a
          tekinteted, már ébren van — és ő a leggyorsabb.</span>
        </div>
        <div class="szorny">
          <b>A MUMUS</b>
          <span class="jel">a társad alakjában · nincs lámpája</span>
          <span class="ellen">Csak akkor mozdul, amikor NEM nézel rá — szemben
          állva meg sem moccan. NE MENJ ODA. Ha nálad a lámpa, a társad
          fénnyel jön; ez sötétben. Lassabb nálad: futva mindig lerázod.</span>
        </div>
      </div>
      <div class="eszkoz">
        <div><b>A LÁMPA</b> — az <b>F</b> kapcsolja. Egy van kettőtökre, és
        fogy. Kikapcsolva nem fogy: a spórolás is döntés, és a Leső csak
        sötétben nyugszik meg.</div>
        <div><b>SZEKRÉNY</b> — állj mellé, és <b>E</b>. Bent egyik szörny sem
        lát, viszont TE SEM LÁTSZ KI, és a lámpád sem ég. Csak hallasz.</div>
        <div><b>ELEM</b> — ráállsz, és a lámpa kap még fényt. Nyolc van a
        házban, a saroktól távol.</div>
        <div><b>MOZGÁS</b> W A S D · <b>futás</b> Shift (de a futás zaj) ·
        <b>E</b> felvétel, bújás, mentés · <b>F</b> lámpa · <b>H</b> súgó</div>
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
