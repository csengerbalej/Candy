import { HAUNT } from '../core/config';
import type { Haunt } from '../game/Haunt';

/**
 * A KÍSÉRTETHÁZ KIJELZŐJE.
 *
 * Három szám, és mind a három olyan, amiért különben a szemedet kéne
 * levenned a sötétről:
 *
 *   A TELEP — mert a fény fogy, és tudni akarod, mennyi maradt.
 *   A TÁRSAD — áll-e a lábán, és ha nem, mennyi ideje van.
 *   A ZSÁKMÁNY — mert elbukva mind elvész.
 *
 * Szándékosan halvány és kicsi: egy horror módban a kijelző nem
 * kapaszkodó lehet, hanem a lehető legkevesebb, ami még elég.
 */
export class HauntHud {
  private readonly el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'haunt-hud';
    parent.appendChild(this.el);
  }

  update(haunt: Haunt, me: 0 | 1): void {
    const other = (1 - me) as 0 | 1;
    const telep = Math.round((haunt.torch / HAUNT.torch) * 100);
    // A TELEP SZÍNE a saját figyelmeztetése: húsz százalék alatt vörös. Egy
    // szám, amit el kell olvasni, késő; egy szín, ami megváltozik, nem.
    const allapot = telep <= 20 ? 'keves' : telep <= 50 ? 'fele' : 'jo';
    const tars = haunt.down[other].down
      ? `<b class="baj">A TÁRSAD LENT VAN — ${Math.ceil(haunt.down[other].left)} mp</b>`
      : '<span>a társad talpon</span>';
    const en = haunt.down[me].down
      ? `<b class="baj">LENT VAGY — ${Math.ceil(haunt.down[me].left)} mp</b>`
      : '';
    this.el.innerHTML =
      `<div class="telep" data-allapot="${allapot}">` +
      `<i style="width:${Math.max(0, telep)}%"></i>` +
      `<span>${haunt.torchOn ? 'LÁMPA' : 'SÖTÉT'} ${telep}%</span></div>` +
      // A GOMB ott áll a telep alatt. Egy szabály, amit nem tudsz
      // használni, nincs is — és a lekapcsolás itt szabály: sötétben nem
      // fogy a telep, és a Leső is csak sötétben nyugszik meg.
      `<div class="sor"><span><b>F</b> — lámpa be/ki · <b>H</b> — súgó</span></div>` +
      `<div class="sor">${tars}</div>` +
      (en ? `<div class="sor">${en}</div>` : '') +
      `<div class="sor"><span>${haunt.candy} cukorka a zsákban</span></div>`;
  }

  dispose(): void {
    this.el.remove();
  }
}
