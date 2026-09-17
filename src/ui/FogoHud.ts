import { DELIVERY, CAPTURE, type GunId, GUNS } from '../core/config';

/**
 * A FOGÓ MÓD KIJELZŐJE.
 *
 * Négy számot kell egyszerre látni, és mind a négy MÁS döntést támogat:
 *
 *   a kézben  — mennyit kockáztatsz épp (egy lövés, és mind a földön)
 *   a sarokban— mennyi van már biztonságban, és mennyi hiányzik a kvótáig
 *   a lőszer  — van-e mivel visszalőni
 *   az ellenfél — érdemes-e még gyűjteni, vagy sietni kell
 *
 * Külön HUD, nem a meglévő bővítése: a kooperatív kijelző ELLENTÉTES dolgokat
 * mond (közös cukorka, közös cél), és egy helyre zsúfolva a kettő
 * mindkettőt olvashatatlanná tenné.
 */
export class FogoHud {
  private readonly root: HTMLDivElement;

  /**
   * @param where Hol vagyunk. A két helyszínen ugyanaz a KÉT SZEREP él —
   * „amit most kockáztatsz" és „ami már biztonságban van" —, csak mást
   * jelentenek: bent a kéz és a sarok, kint a kocsi és a bázis. Ugyanaz a
   * doboz rossz felirattal viszont nem takarékosság, hanem félrevezetés.
   */
  constructor(parent: HTMLElement, private readonly where: 'haz' | 'varos' = 'haz') {
    const risk = where === 'haz' ? 'a kézben' : 'a kocsiban';
    const safe = where === 'haz' ? 'a sarokban' : 'leadva';
    const theirs = where === 'haz' ? 'az ellenfélnél' : 'ő leadott';
    this.root = document.createElement('div');
    this.root.className = 'fogo';
    this.root.dataset.where = where;
    this.root.innerHTML = `
      <div class="fogo-me">
        <b class="kez">0</b><span>${risk}</span>
        <b class="bank">0</b><span>${safe}</span>
      </div>
      <div class="fogo-gun"><b class="ammo">—</b><span class="gunname">nincs fegyver</span></div>
      <div class="fogo-them"><b class="ellen">0</b><span>${theirs}</span></div>`;
    parent.appendChild(this.root);
    // Kint nincs fegyver a kézben: egy örökké „nincs fegyver" felirat csak
    // zaj, és elveszi a helyet attól, ami számít.
    if (where === 'varos') {
      (this.root.querySelector('.fogo-gun') as HTMLElement).hidden = true;
    }
  }

  /**
   * @param carried Ami a kézben van.
   * @param banked Ami a sarokban áll.
   * @param rival Amennyi az ellenfélnek a sarkában áll.
   */
  update(
    carried: number,
    banked: number,
    rival: number,
    gun: GunId | null,
    ammo: number,
    reserve: number,
    reloading: boolean
  ): void {
    const kez = this.root.querySelector('.kez') as HTMLElement;
    kez.textContent = String(carried);
    if (this.where === 'varos') kez.dataset.full = carried > 0 ? '1' : '0';
    // A TELE KÉZ figyelmeztet: innentől nem tudsz többet felvenni, és minél
    // többet cipelsz, annál többet veszítesz egy találatra.
    else kez.dataset.full = carried >= CAPTURE.carry ? '1' : '0';

    // A KVÓTA a HÁZRA vonatkozik: odabent azt mutatja, mennyi hiányzik az
    // ajtó nyitásához. Kint nincs kvóta — ott a leadott mennyiség maga a
    // pontszám, és egy „/5" csak hamis határt sugallna.
    const bank = this.root.querySelector('.bank') as HTMLElement;
    const inHouse = this.where === 'haz';
    bank.textContent = inHouse ? `${banked}/${DELIVERY.quota}` : String(banked);
    bank.dataset.done = inHouse && banked >= DELIVERY.quota ? '1' : '0';

    (this.root.querySelector('.ellen') as HTMLElement).textContent = inHouse
      ? `${rival}/${DELIVERY.quota}`
      : String(rival);

    const ammoEl = this.root.querySelector('.ammo') as HTMLElement;
    const nameEl = this.root.querySelector('.gunname') as HTMLElement;
    if (!gun) {
      ammoEl.textContent = '—';
      nameEl.textContent = 'nincs fegyver';
      ammoEl.dataset.state = 'none';
      return;
    }
    ammoEl.textContent = reloading ? '…' : `${ammo}`;
    nameEl.textContent = `${GUNS[gun].name} · tartalék ${reserve}`;
    ammoEl.dataset.state = reloading ? 'reload' : ammo === 0 ? 'empty' : 'ok';
  }

  dispose(): void {
    this.root.remove();
  }
}
