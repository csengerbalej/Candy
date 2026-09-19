import {
  CHARACTERS,
  CHARACTER_ORDER,
  type Selection,
} from '../game/Characters';
import { describeSave } from '../game/SaveGame';
import type { InputManager } from '../input/InputManager';

/** Amit a szobanyitás/belépés válaszol. Ugyanaz az alak, mint a `main`-ben. */
export type LobbyValasz = { ok: true; kod: string } | { ok: false; miert: string };

export type FrontendResult =
  | { kind: 'new'; selection: Selection }
  | { kind: 'continue' };

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/**
 * ÉRINTŐN VAGYUNK-E.
 *
 * Nem kozmetika: iPaden nincs `E`, nincs `Enter` és nincs `Space`, tehát egy
 * olyan súgó, ami ezeket kéri, nem hiányos — HAZUDIK. Aki elhiszi, azt
 * keresi a képernyőn, ami nincs ott, és közben nem veszi észre, hogy az
 * egészet meg lehet koppintani.
 */
function erinto(): boolean {
  return document.body.dataset.touch === '1';
}

/**
 * A képernyők, amiken át a játékig el lehet jutni.
 *
 * Volt itt `roles` és `brief` is — öt képernyő a játék előtt —, és a
 * felhasználó szava rá: „túl bonyi". Mindkettőt kivettem, mert mindkettő
 * ceremónia volt:
 *
 *   · `roles` — azt döntötte el, ki vezet, holott az `R` menet közben bármikor
 *     felülírja, és a szünetmenü is. Egy képernyő egy visszavonható döntésért.
 *   · `brief` — négy bekezdés szabály olvasásra. Mind a négy olyasmi, amit a
 *     játék a HELYÉN kiír, amikor számít: „MÉG 3 CUKORKA KELL", „SZÁLLJATOK KI
 *     MINDKETTEN", „VÁRD MEG A TÁRSAD". Olvasással tanítani azt, amit a játék
 *     játszva tanít, kétszer mondja el ugyanazt — először rosszabbul.
 */
type Phase = 'menu' | 'lobby' | 'names' | 'characters' | 'done';

/** Fallback letter wheel, for a player holding a gamepad instead of a keyboard. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZÁÉÍÓÖŐÚÜŰ '.split('');
const NAME_LIMIT = 12;

/**
 * Everything before the car starts moving (spec §5, §6).
 *
 *   címképernyő → név → karakter → szerep → eligazítás → játék
 *
 * One rule runs through all five screens: both players act at the same time,
 * on their own controls, and nothing waits for a turn. A front-end that makes
 * player two watch player one choose has already broken the promise of the
 * game before it starts.
 *
 * The name picker is a letter wheel rather than a text field for the same
 * reason — two people cannot share one keyboard's text cursor, but they can
 * each spin their own wheel with the same buttons they will play with.
 */
export type FrontendPhase = Phase;

/**
 * A menüsorok jele.
 *
 * Nem dísz: négy egyforma sötét téglalap között a szem nem tud tájékozódni,
 * és a sorok olvasása nélkül nem derül ki, melyik mit csinál. Egy jel a
 * sor elején fél pillantásból megmondja — a szöveg utána már csak
 * megerősítés.
 */
const MENU_MARK: Record<string, string> = {
  solo: '🎃',
  new: '👻',
  // A három újabb mód sokáig egy szürke pontot kapott, mert a táblázat nem
  // nőtt velük. Egy menüsor ikon nélkül a többi mellett nem szerénynek
  // látszik, hanem befejezetlennek.
  fogo: '🍬',
  fogo2: '⚔️',
  kisertet: '🕯️',
  continue: '🌙',
  settings: '⚙',
};

export class Frontend {
  private readonly root: HTMLDivElement;
  private phase: Phase = 'menu';
  private menuCursor = 0;
  private menuItems: Array<{ id: string; label: string; detail?: string }> = [];

  private readonly cursor: [number, number] = [0, 1];
  private readonly locked: [boolean, boolean] = [false, false];
  private readonly names: [string, string] = readStoredNames();
  private driverIndex: 0 | 1 = 0;
  /** Egyedül játszik-e. A választás a címképernyőn dől el. */
  private solo = false;
  /** FOGÓ mód: versengés a kooperáció helyett. */
  private fogo = false;
  /** Kísértetház mód: a harmadik játékmód kapcsolója. */
  private haunt = false;
  private resolve: ((result: FrontendResult) => void) | null = null;
  /** Opens the settings panel; supplied by main, which owns the renderer. */
  onSettings: (() => void) | null = null;

  /**
   * A SZOBA HÁROM KÉRDÉSE, kívülről válaszolva.
   *
   * A menü nem tud a hálózatról, és nem is kell tudnia: csak annyit kérdez,
   * hogy „nyiss szobát", „lépj be ezzel a kóddal", „megjött-e a társ".
   * A `main` válaszol, mert a csatorna az övé.
   */
  onHost: (() => Promise<LobbyValasz>) | null = null;
  onJoin: ((kod: string) => Promise<LobbyValasz>) | null = null;
  partnerHere: (() => boolean) | null = null;
  /** A linkből hozott kód, ha a társ már elküldte a meghívót. */
  linkKod = '';

  /** A lobbi állapota: melyik felén állunk. */
  private lobby: 'valaszt' | 'gazda' | 'belep' = 'valaszt';
  private lobbyKod = '';
  /**
   * AMIT A JÁTÉKOS BEGÉPELT — az ÁLLAPOTBAN, nem a mezőben.
   *
   * A képernyő magától is újrarajzolódhat (megjött a társ, változott a
   * késés), és minden újrarajzolás új `input` elemet csinál. Ha a beírt kód
   * csak a régi elemben élne, a második betű után elveszne — mérve pont ez
   * történt: a mező eltűnt a kezem alól.
   */
  private lobbyBeirt = '';
  private lobbyUzenet = '';
  private lobbyDolgozik = false;
  private lobbyTars = false;

  private readonly axisX: [boolean, boolean] = [false, false];
  private readonly axisY: [boolean, boolean] = [false, false];

  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
    startAt: Phase = 'menu'
  ) {
    this.phase = startAt;
    this.root = document.createElement('div');
    this.root.className = 'select';
    parent.appendChild(this.root);

    // Mouse support. One mouse, two players — so a click always acts as
    // player one, which is the person sitting at the keyboard it belongs to.
    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('mousemove', this.onHover);

    this.render();
  }

  run(): Promise<FrontendResult> {
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  private readonly onClick = (event: MouseEvent): void => {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-pick]');
    if (!target) return;
    const [kind, value] = (target.dataset.pick ?? '').split(':');

    if (kind === 'menu') {
      this.menuCursor = Number(value);
      this.activateMenu();
      return;
    }
    if (kind === 'lobby') {
      void this.lobbyPick(value);
      return;
    }
    if (kind === 'card') {
      this.cursor[0] = Number(value);
      this.locked[0] = true;
      this.afterChange();
      return;
    }
    if (kind === 'role') {
      this.driverIndex = Number(value) as 0 | 1;
      this.render();
      return;
    }
    if (kind === 'go') {
      // Egy ember, egy zár.
      this.locked[0] = true;
      this.afterChange();
    }
  };

  private readonly onHover = (event: MouseEvent): void => {
    if (this.phase !== 'menu') return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-pick^="menu:"]');
    if (!target) return;
    const next = Number((target.dataset.pick ?? '').split(':')[1]);
    if (next === this.menuCursor) return;
    this.menuCursor = next;
    this.render();
  };

  /** Shared tail for anything that may have completed a phase. */
  private afterChange(): void {
    // Csak a HELYI játékos zárása számít. A társ a saját eszközén tart ott,
    // ahol tart, és a két front-endnek nem kell egymásra várnia: ha várna, a
    // lassabb játékos a másik képernyőjét is fogva tartaná — pont azt hoznánk
    // vissza, amiért az egy gépes kétfős kikerült.
    if (this.phase === 'names' && this.locked[0]) {
      return this.advancePhase('characters');
    }
    if (this.phase === 'characters' && this.locked[0]) {
      return this.finish();
    }
    this.render();
  }

  private buildMenu(): void {
    const save = describeSave();
    // Az „egy gépen ketten" kikerült. Nem szűkítés volt, hanem egy HARMADIK
    // játék: osztott kép, két billentyűkiosztás egy klaviatúrán, Tab-bal
    // váltogatott szörnyek — és mindhárom külön hangolást kívánt, miközben
    // egyiket sem ezért játszotta senki. Marad két alak, és mindkettőben
    // pontosan egy szörny tartozik egy emberhez.
    this.menuItems = [
      { id: 'solo', label: 'EGYEDÜL', detail: 'te vezetsz és te navigálsz' },
      { id: 'new', label: 'KÉTFŐS', detail: 'a társad másik eszközről lép be' },
      // A FOGÓ külön bejegyzés, nem a kooperatív egy kapcsolója: teljesen más
      // játék ugyanabban a házban — cukorkát rabolni egymástól, fegyverrel.
      { id: 'fogo', label: 'FOGÓ', detail: 'cukorkarablás — egyedül AI ellen' },
      // FOGÓ KETTEN: ugyanaz a játék, de a második helyen nem AI ül, hanem a
      // barátod a saját eszközéről. A kooperatív KÉTFŐS megmarad mellette —
      // két külön játék, nem egy kapcsoló két állása.
      { id: 'fogo2', label: 'FOGÓ KETTEN', detail: 'egymás ellen — a társad másik eszközről' },
      // A HARMADIK MÓD: nem egymás ellen, hanem egymásért. Egyedül is
      // elindítható — úgy a legijesztőbb —, de ketten a játék.
      { id: 'kisertet', label: 'KÍSÉRTETHÁZ', detail: 'horror — sötét, szörnyek, meg lehet halni' },
    ];
    if (save) this.menuItems.push({ id: 'continue', label: 'FOLYTATÁS', detail: save.label });
    this.menuItems.push({ id: 'settings', label: 'BEÁLLÍTÁSOK' });
    this.menuCursor = Math.min(this.menuCursor, this.menuItems.length - 1);
  }

  private activateMenu(): void {
    const item = this.menuItems[this.menuCursor];
    if (!item) return;
    if (
      item.id === 'new' ||
      item.id === 'solo' ||
      item.id === 'fogo' ||
      item.id === 'fogo2' ||
      item.id === 'kisertet'
    ) {
      // Csak az EGYEDÜL és a sima FOGÓ megy egy eszközön; a másik kettőhöz
      // társ kell.
      this.solo = item.id === 'solo' || item.id === 'fogo';
      this.fogo = item.id === 'fogo' || item.id === 'fogo2';
      this.haunt = item.id === 'kisertet';
      // AKI TÁRSAT AKAR, ANNAK ELŐBB TÁRSA LESZ. A kétfős módok a lobbin át
      // mennek: ott dől el, hogy ez a gép nyit szobát, vagy belép egybe.
      // Enélkül a játék elindult, és a társ egy már futó körbe esett bele.
      if (!this.solo) {
        this.lobby = 'valaszt';
        this.lobbyKod = '';
        this.lobbyUzenet = '';
        this.lobbyTars = false;
        return this.advancePhase('lobby');
      }
      this.advancePhase('names');
    }
    else if (item.id === 'continue') this.finishContinue();
    else if (item.id === 'settings') this.onSettings?.();
  }

  private finishContinue(): void {
    this.phase = 'done';
    this.dispose();
    this.resolve?.({ kind: 'continue' });
    this.resolve = null;
  }

  dispose(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('mousemove', this.onHover);
    this.root.remove();
  }

  update(): void {
    if (this.phase === 'done') return;
    let changed = false;

    // A TÁRS MEGÉRKEZÉSE nem gombnyomás, hanem esemény: minden képkockán
    // megkérdezzük, mert máskor nem tudnánk meg.
    if (this.phase === 'lobby') {
      const itt = this.partnerHere?.() ?? false;
      if (itt !== this.lobbyTars) {
        this.lobbyTars = itt;
        if (itt && this.lobby === 'belep') this.lobby = 'gazda';
        this.render();
      }
    }

    // Egy eszköz, egy ember: csak az első kiosztás olvasódik.
    for (const player of [0] as const) {
      const inp = this.input.get(player);
      const stepX = this.edge(this.axisX, player, inp.moveX);
      const stepY = this.edge(this.axisY, player, inp.moveY);
      const confirm = inp.interact || inp.jump;

      switch (this.phase) {
        // A LOBBIBAN A GOMB DÖNT, NEM A FÁZIS.
        //
        // Az első változat a megerősítésből TALÁLGATTA, mit akarsz: a
        // választóképernyőn indítást, a kódmezőn belépést. Mérve ez
        // kiszámíthatatlan volt — egy kattintás a gombra ÉS egy
        // megerősítés ugyanabból a kattintásból két külön lépést csinált,
        // és a képernyő oda-vissza ugrált a kezem alatt.
        //
        // Most a megerősítés azt nyomja meg, ami épp ki van emelve. Ez
        // ugyanaz, amit a böngésző csinál az Enterrel — és ami látszik is:
        // a kiemelt gomb a válasz.
        case 'lobby': {
          if (!confirm) break;
          const fokusz = document.activeElement as HTMLElement | null;
          if (fokusz && this.root.contains(fokusz) && fokusz.tagName === 'BUTTON') {
            fokusz.click();
          }
          return;
        }

        case 'menu':
          if (stepY) {
            this.menuCursor =
              (this.menuCursor - stepY + this.menuItems.length) % this.menuItems.length;
            changed = true;
          }
          if (confirm) return this.activateMenu();
          break;

        case 'names': {
          // Keyboard typing is handled by the input elements themselves. Only a
          // player on a gamepad needs the wheel, because a pad cannot type.
          const inp2 = this.input.get(player);
          if (!inp2.usingGamepad) break;
          if (this.locked[player] && confirm) {
            this.locked[player] = false;
            changed = true;
            break;
          }
          if (stepY) {
            const current = this.names[player];
            const last = current.slice(-1).toUpperCase();
            const index = ALPHABET.indexOf(last || ' ');
            const next = ALPHABET[(index + stepY + ALPHABET.length) % ALPHABET.length];
            this.names[player] = current.slice(0, -1) + next;
            changed = true;
          }
          if (stepX > 0 && this.names[player].length < NAME_LIMIT) {
            this.names[player] += 'A';
            changed = true;
          }
          if (stepX < 0 && this.names[player].length > 0) {
            this.names[player] = this.names[player].slice(0, -1);
            changed = true;
          }
          if (confirm) {
            this.locked[player] = true;
            changed = true;
          }
          break;
        }

        case 'characters':
          if (stepX && !this.locked[player]) {
            this.cursor[player] =
              (this.cursor[player] + stepX + CHARACTER_ORDER.length) % CHARACTER_ORDER.length;
            changed = true;
          }
          if (confirm) {
            this.locked[player] = !this.locked[player];
            changed = true;
          }
          break;

      }
    }

    if (this.phase === 'names') {
      // Egyedül csak az első mező van; a másodikat nem lehet kitölteni, tehát
      // nem is szabad megvárni.
      if (this.locked[0]) return this.advancePhase('characters');
      if (changed) this.refreshNameFields();
      return;
    }
    if (this.phase === 'characters' && this.locked[0] && this.locked[1]) {
      return this.finish();
    }

    if (changed) this.render();
  }

  /** One step per press, however long the key or stick is held. */
  private edge(state: [boolean, boolean], player: 0 | 1, value: number): number {
    const active = Math.abs(value) > 0.5;
    const step = active && !state[player] ? Math.sign(value) : 0;
    state[player] = active;
    return step;
  }

  private nameOf(player: 0 | 1): string {
    return this.names[player].trim() || `JÁTÉKOS ${player + 1}`;
  }

  private finish(): void {
    this.phase = 'done';
    this.dispose();
    this.resolve?.({
      kind: 'new',
      selection: {
        names: [this.nameOf(0), this.nameOf(1)],
        characters: [CHARACTER_ORDER[this.cursor[0]], CHARACTER_ORDER[this.cursor[1]]],
        driverIndex: this.driverIndex,
        solo: this.solo,
        fogo: this.fogo,
        haunt: this.haunt,
      },
    });
    this.resolve = null;
  }

  private render(): void {
    this.root.dataset.phase = this.phase;
    if (this.phase === 'menu') this.buildMenu();
    this.root.innerHTML = {
      menu: () => this.renderMenu(),
      lobby: () => this.renderLobby(),
      names: () => this.renderNames(),
      characters: () => this.renderCharacters(),
      done: () => '',
    }[this.phase]();

    if (this.phase === 'lobby') {
      this.bindKodField();
      // Ha nincs kódmező, az első gomb kapja a fókuszt: így a billentyű és a
      // kontroller is tud választani, és látszik is, mit választana.
      if (!this.root.querySelector('.kod-field')) {
        this.root.querySelector<HTMLElement>('.lobby button')?.focus();
      }
    }

    if (this.phase === 'names') this.bindNameFields();
  }

  /**
   * A lobbi gombjai.
   *
   * Minden ág a KÉPERNYŐN válaszol, nem a konzolon: ha a szoba nem nyílt meg,
   * az látszik, és a játékos tud vele kezdeni valamit. A néma bukás volt a
   * korábbi változat legnagyobb baja — „csatlakozott", és utána semmi.
   */
  private async lobbyPick(what: string): Promise<void> {
    if (this.lobbyDolgozik) return;

    if (what === 'host') {
      this.lobbyDolgozik = true;
      this.lobbyUzenet = 'szoba nyitása…';
      this.lobby = 'gazda';
      this.render();
      const valasz = await (this.onHost?.() ?? Promise.resolve({ ok: false as const, miert: 'nincs csatorna' }));
      this.lobbyDolgozik = false;
      if (valasz.ok) {
        this.lobbyKod = valasz.kod;
        this.lobbyUzenet = '';
      } else {
        this.lobby = 'valaszt';
        this.lobbyUzenet = valasz.miert;
      }
      this.render();
      return;
    }

    if (what === 'join') {
      this.lobby = 'belep';
      this.lobbyUzenet = '';
      this.render();
      return;
    }

    if (what === 'enter') {
      const mezo = this.root.querySelector<HTMLInputElement>('.kod-field');
      const kod = (mezo?.value || this.lobbyBeirt).trim().toUpperCase();
      this.lobbyDolgozik = true;
      this.lobbyUzenet = 'belépés…';
      this.render();
      const valasz = await (this.onJoin?.(kod) ?? Promise.resolve({ ok: false as const, miert: 'nincs csatorna' }));
      this.lobbyDolgozik = false;
      if (valasz.ok) {
        this.lobbyKod = valasz.kod;
        this.lobbyUzenet = '';
        this.lobby = 'gazda';
      } else {
        this.lobbyUzenet = valasz.miert;
      }
      this.render();
      return;
    }

    if (what === 'copy') {
      try {
        await navigator.clipboard.writeText(location.href);
        this.lobbyUzenet = 'a link a vágólapon';
      } catch {
        this.lobbyUzenet = 'a másolás nem ment — mondd be a kódot';
      }
      this.render();
      return;
    }

    if (what === 'back') {
      this.lobby = 'valaszt';
      this.lobbyUzenet = '';
      this.render();
      return;
    }

    if (what === 'solo') {
      // EGYEDÜL IS JÁTSZHATÓ. A kísértetház egyedül a legijesztőbb, és a
      // kétfős módokban sincs értelme fogva tartani azt, aki most nem talál
      // társat: menjen be, a társ később úgyis beléphet.
      this.solo = true;
      this.advancePhase('names');
      return;
    }

    if (what === 'tovabb') {
      this.advancePhase('names');
    }
  }

  // --- screens -------------------------------------------------------------

  /**
   * A LOBBI: itt dől el, kivel játszol.
   *
   * Négy betű, és semmi más. Nem szobalista, nem barátlista, nem bejelentkezés
   * — két ember ül egymás mellett vagy telefonál, és az egyik bemondja a
   * másiknak. Ennél kevesebb lépésből nem lehet két külön eszközt egy játékba
   * tenni, és minden további lépés csak elvenne abból az időből, ami a
   * játékra marad.
   *
   * ÉRINTŐN IS TELJES ÉRTÉKŰ: minden választás GOMB, amire rá lehet
   * koppintani, a kód pedig szövegmező — iPaden nincs „E" és nincs „Space",
   * amit meg lehetne nyomni, tehát nem is hivatkozunk rájuk.
   */
  private renderLobby(): string {
    const erintes = erinto();
    const modNev = this.haunt ? 'KÍSÉRTETHÁZ' : this.fogo ? 'FOGÓ KETTEN' : 'KÉTFŐS';
    const uzenet = this.lobbyUzenet
      ? `<p class="lobby-uzenet">${escapeAttribute(this.lobbyUzenet)}</p>`
      : '';

    if (this.lobby === 'valaszt') {
      return `
        <h1>KETTEN JÁTSSZÁTOK</h1>
        <p class="hint">${modNev} · az egyikőtök indít, a másik belép a kóddal</p>
        <div class="lobby">
          <button type="button" class="lobby-nagy" data-pick="lobby:host">
            <b>JÁTÉK INDÍTÁSA</b>
            <small>kapsz egy négybetűs kódot, amit bemondasz a társadnak</small>
          </button>
          <button type="button" class="lobby-nagy" data-pick="lobby:join">
            <b>CSATLAKOZÁS</b>
            <small>a társad kódjával lépsz be az ő játékába</small>
          </button>
          <button type="button" class="lobby-kicsi" data-pick="lobby:solo">
            EGYEDÜL INDULOK
          </button>
        </div>
        ${uzenet}
        <p class="foot">${
          erintes ? 'Koppints a választáshoz.' : 'Kattints, vagy fel/le és Enter.'
        }</p>`;
    }

    if (this.lobby === 'belep') {
      return `
        <h1>A TÁRSAD KÓDJA</h1>
        <p class="hint">Négy betű, amit ő lát a képernyőjén</p>
        <div class="lobby">
          <input class="kod-field" type="text" maxlength="4" inputmode="text"
                 autocomplete="off" autocapitalize="characters" spellcheck="false"
                 placeholder="ABCD" value="${escapeAttribute(this.lobbyBeirt || this.linkKod)}" />
          <button type="button" class="lobby-nagy" data-pick="lobby:enter">
            <b>${this.lobbyDolgozik ? 'BELÉPÉS…' : 'BELÉPÉS'}</b>
          </button>
          <button type="button" class="lobby-kicsi" data-pick="lobby:back">VISSZA</button>
        </div>
        ${uzenet}`;
    }

    // GAZDA (vagy sikeres belépés): a kód és a várakozás.
    const tars = this.lobbyTars;
    return `
      <h1>${tars ? 'MEGVAGYTOK' : 'A KÓDOD'}</h1>
      <p class="hint">${
        tars ? 'a társad belépett' : 'mondd be a társadnak, vagy küldd el a linket'
      }</p>
      <div class="lobby">
        <div class="kod-nagy">${this.lobbyKod || '····'}</div>
        ${
          tars
            ? `<button type="button" class="lobby-nagy" data-pick="lobby:tovabb"><b>TOVÁBB</b></button>`
            : `<button type="button" class="lobby-kicsi" data-pick="lobby:copy">LINK MÁSOLÁSA</button>
               <p class="lobby-varas">várunk a társadra…</p>
               <button type="button" class="lobby-kicsi" data-pick="lobby:back">VISSZA</button>`
        }
      </div>
      ${uzenet}`;
  }

  /** A kódmező: nagybetű, négy karakter, és az Enter is belép. */
  private bindKodField(): void {
    const mezo = this.root.querySelector<HTMLInputElement>('.kod-field');
    if (!mezo) return;
    mezo.addEventListener('input', () => {
      mezo.value = mezo.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
      this.lobbyBeirt = mezo.value;
    });
    mezo.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.lobbyPick('enter');
      e.stopPropagation();
    });
    // A fókusz visszakerül oda, ahol volt: gépelés közben újrarajzolt
    // mezőbe kattintani újra nem a játékos dolga.
    mezo.focus();
    const vege = mezo.value.length;
    try {
      mezo.setSelectionRange(vege, vege);
    } catch {
      // Néhány böngésző csak bizonyos mezőkön engedi. Nem kritikus.
    }
  }

  private renderMenu(): string {
    const items = this.menuItems
      .map(
        (item, index) => `
        <button type="button" class="menu-item${index === this.menuCursor ? ' is-active' : ''}"
                data-pick="menu:${index}">
          <span class="mark" aria-hidden="true">${MENU_MARK[item.id] ?? '·'}</span>
          <span class="text">
            <span class="label">${item.label}</span>
            ${item.detail ? `<span class="detail">${item.detail}</span>` : ''}
          </span>
          <span class="go" aria-hidden="true">▸</span>
        </button>`
      )
      .join('');

    return `
      <div class="keyart" aria-hidden="true"></div>
      <div class="title-inner">
        <p class="kicker">KÉTFŐS HALLOWEEN-KALAND</p>
        <h1 class="logo">CANDYPOCALYPSE</h1>
        <p class="tagline">Valaki üveg alá zárta a várost, mint egy cukorkát. Egy éjszakátok van.</p>
        <nav class="menu">${items}</nav>
        ${erinto() ? '' : Frontend.keyboard()}
        <p class="foot">${
          erinto()
            ? 'Koppints a módra, amit játszani akartok.'
            : 'Fel/le vagy egér · <b>E</b> / <b>Enter</b> választ · kontroller is jó'
        }</p>
      </div>`;
  }

  /**
   * A gombok KIRAJZOLVA, nem felsorolva.
   *
   * Eddig két szöveges sor volt itt: „JÁTÉKOS 1 — W A S D · Space · Shift · E"
   * és ugyanez a másodiknak a nyilakkal. Két baja volt.
   *
   * Egy: a MÁSODIK SOR HAZUDOTT. Amióta egy eszköz egy játékos, a nyilak nem
   * mozgatnak senkit — a kamerát forgatják. Aki elhitte, a nyilakat nyomkodta,
   * és nem értette, miért nem indul el.
   *
   * Kettő: egy felsorolt betűsor nem mutatja meg, HOL van a gomb. Egy
   * kirajzolt billentyűzeten a WASD ott van, ahol a kezed — és a kiemelés
   * megmondja, melyiket keresd.
   */
  private static keyboard(): string {
    const row = (keys: [string, string?][]) =>
      `<div class="kb-row">${keys
        .map(([label, role]) =>
          `<kbd${role ? ` class="${role}"` : ''}>${label}</kbd>`
        )
        .join('')}</div>`;

    return `
      <div class="kb" aria-hidden="true">
        <div class="kb-keys">
          ${row([['Q'], ['W', 'move'], ['E', 'use'], ['R'], ['T', 'msg']])}
          ${row([['A', 'move'], ['S', 'move'], ['D', 'move'], ['F', 'boost'], ['G']])}
          ${row([['1', 'msg'], ['2', 'msg'], ['3', 'msg'], ['4', 'msg']])}
          ${row([['Shift', 'wide drift'], ['Space', 'wide jump']])}
        </div>
        <div class="kb-arrows">
          <kbd class="look">↑</kbd>
          <div class="kb-row"><kbd class="look">←</kbd><kbd class="look">↓</kbd><kbd class="look">→</kbd></div>
        </div>
        <ul class="kb-legend">
          <li><i class="move"></i>mozgás</li>
          <li><i class="jump"></i>ugrás</li>
          <li><i class="drift"></i>kézifék / futás</li>
          <li><i class="boost"></i>nitró</li>
          <li><i class="use"></i>duda / használat</li>
          <li><i class="look"></i>kamera</li>
          <li><i class="msg"></i>üzenet a társnak</li>
        </ul>
      </div>`;
  }

  private renderNames(): string {
    // Egyedül egy ember ül a gépnél: egy nevet kérünk. A második szörny is
    // kap egyet — a HUD-nak és a végi díjaknak kell —, de azt nem a játékos
    // gépeli be, mert nem az ő neve.
    // Mindig egy mező. A társ a SAJÁT eszközén írja be a saját nevét — egy
    // olyan mező, amibe más gépnél ülő ember gépelne, nincs.
    const fields = [0] as const;
    return `
      <h1>HOGY HÍVNAK?</h1>
      <p class="hint">${
        erinto() ? 'Írd be a neved, aztán koppints a TOVÁBB-ra' : 'Írd be a neved · <b>Enter</b> tovább'
      }</p>
      <div class="names">
        ${(fields as readonly (0 | 1)[])
          .map((p) => {
            const accent = p === 0 ? '#ff7a29' : '#9d5cff';
            return `
              <article class="name${this.locked[p] ? ' is-locked' : ''}" style="--c:${accent}">
                <label class="tag" for="name-${p}">JÁTÉKOS ${p + 1}</label>
                <input id="name-${p}" class="name-field" type="text" maxlength="${NAME_LIMIT}"
                       autocomplete="off" autocapitalize="off" spellcheck="false"
                       placeholder="a neved" value="${escapeAttribute(this.names[p])}" />
                <span class="state">${this.locked[p] ? 'KÉSZ' : '&nbsp;'}</span>
              </article>`;
          })
          .join('')}
      </div>
      <button type="button" class="go" data-pick="go">TOVÁBB</button>
      <p class="foot">${
        this.solo
          ? 'Te vezetsz és te navigálsz — a másik szörny most nem jön.'
          : 'A társad a saját eszközén írja be a saját nevét.'
      }</p>`;
  }

  /**
   * Real text fields, bound once.
   *
   * The screen is re-rendered on state changes, which would blow away a focused
   * input mid-word — so the names phase updates its own fields in place instead
   * of going through render().
   */
  private bindNameFields(): void {
    const field = this.root.querySelector<HTMLInputElement>('#name-0');
    if (!field) return;
    field.addEventListener('input', () => {
      this.names[0] = field.value;
    });
    field.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      this.advancePhase('characters');
    });
    field.focus();
  }

  /**
   * Push wheel edits into the live fields without re-rendering.
   * Re-rendering here would destroy the input the other player is typing into.
   */
  private refreshNameFields(): void {
    for (const player of [0] as const) {
      const field = this.root.querySelector<HTMLInputElement>(`#name-${player}`);
      if (field && field.value !== this.names[player]) field.value = this.names[player];
      const card = this.root.querySelectorAll('.name')[player];
      card?.classList.toggle('is-locked', this.locked[player]);
      const state = card?.querySelector('.state');
      if (state) state.innerHTML = this.locked[player] ? 'KÉSZ' : '&nbsp;';
    }
  }

  private advancePhase(next: Phase): void {
    this.phase = next;
    this.locked[0] = false;
    this.locked[1] = false;
    this.render();
  }

  private renderCharacters(): string {
    const cards = CHARACTER_ORDER.map((id, index) => {
      const c = CHARACTERS[id];
      const on = ([0] as const).filter((p) => this.cursor[p] === index);
      return `
        <article data-pick="card:${index}" class="card${on.length ? ' is-hovered' : ''}${
          on.some((p) => this.locked[p]) ? ' is-locked' : ''
        }" style="--c:${hex(c.color)}">
          <!-- A szörny maga, nem a leírása. Négy név és három sávdiagram
               kártyánként azt kérte a játékostól, hogy OLVASSON, hogy
               eldöntse, ki tetszik neki — pedig ránézésre egy pillanat. A
               számok ott maradnak, csak alárendelve. -->
          <img class="portrait" src="${c.portrait}" alt="${c.name}" draggable="false" />
          <div class="who">${on
            .map(
              (p) =>
                `<span class="chip p${p + 1}${this.locked[p] ? ' on' : ''}">${this.nameOf(p)}</span>`
            )
            .join('')}</div>
          <header><h3>${c.name}</h3></header>
          <p class="ability">${c.ability}</p>
          <dl>
            <div><dt>tempó</dt><dd>${bar(c.traits.speed, 0.8, 1.2)}</dd></div>
            <div><dt>halkság</dt><dd>${bar(1 / c.traits.noise, 0.8, 2.2)}</dd></div>
            <div><dt>strapa</dt><dd>${bar(1 / c.traits.candyLoss, 0.6, 2)}</dd></div>
          </dl>
        </article>`;
    }).join('');

    return `
      <h1>VÁLASSZ SZÖRNYET</h1>
      <p class="hint">${
        erinto() ? 'Koppints a karakterre, amelyikkel játszani akarsz' : 'Balra/jobbra lépked · <b>E</b> / <b>Enter</b> rögzít'
      }</p>
      <div class="grid">${cards}</div>
      <button type="button" class="go" data-pick="go">INDULÁS</button>
      <p class="foot">${
        erinto()
          ? this.solo
            ? 'Bal oldalt mozogsz, jobb oldalt forgatod a kamerát.'
            : 'A társad a saját eszközén választ — nem kell megvárnod.'
          : this.solo
            ? 'Te vezetsz elsőnek — a <b>nyilakkal</b> forgatod a kamerát.'
            : '<b>' + this.nameOf(0) + '</b> vezet elsőnek, a társad navigál — az <b>R</b> bármikor cserél. ' +
              'A társad a saját eszközén választ, nem kell megvárnod.'
      }</p>`;
  }
}

/**
 * Names typed earlier in this session.
 *
 * Changing character mid-run drops straight into the character screen, which
 * skips the names phase — so without this the pair silently became JÁTÉKOS 1
 * and JÁTÉKOS 2 for wanting a different monster.
 */
function readStoredNames(): [string, string] {
  try {
    const raw = sessionStorage.getItem('candypocalypse.names');
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      if (Array.isArray(parsed) && parsed.length === 2) return [parsed[0] ?? '', parsed[1] ?? ''];
    }
  } catch {
    /* storage disabled */
  }
  return ['', ''];
}

function escapeAttribute(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}

function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value));
}

/** A five-pip meter. Enough to compare two characters, not enough to min-max. */
function bar(value: number, low: number, high: number): string {
  const pips = clamp(Math.round(((value - low) / (high - low)) * 5), 1, 5);
  return Array.from({ length: 5 }, (_, i) => `<i${i < pips ? ' class="on"' : ''}></i>`).join('');
}
