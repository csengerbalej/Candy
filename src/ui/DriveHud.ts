import { PALETTE, CAR } from '../core/config';
import type { DriveGame } from '../game/DriveGame';
import type { Car } from '../vehicle/Car';
import type { Pane } from '../game/DriveStage';
import { hint, keyFor } from './Controls';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

/**
 * Two HUDs that share almost nothing, because the two roles share almost
 * nothing. The driver gets speed and — only when the navigator sends it — a
 * direction. The navigator gets their verbs. Neither gets the other's job.
 */
export class DriveHud {
  private readonly root: HTMLDivElement;
  private readonly driverTag: HTMLDivElement;
  private readonly navTag: HTMLDivElement;
  private readonly speed: HTMLDivElement;
  private readonly ping: HTMLDivElement;
  private readonly verbs: HTMLDivElement;
  private readonly driveLegend: HTMLDivElement;
  private readonly banner: HTMLDivElement;
  private readonly score: HTMLDivElement;
  private readonly divider: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);

    this.driverTag = this.add('hud-panel');
    this.navTag = this.add('hud-panel');
    this.speed = this.add('drive-speed');
    this.ping = this.add('drive-ping');
    this.ping.innerHTML = `<span class="arrow">➤</span><span class="cap">IRÁNY</span>`;
    this.verbs = this.add('drive-verbs');
    this.driveLegend = this.add('hud-legend');
    this.banner = this.add('hud-banner');
    this.score = this.add('hud-watch');
    this.divider = this.add('hud-divider');
  }

  /** Remove every element this HUD owns — a section change must leave none. */
  dispose(): void {
    this.root.remove();
  }

  private add(cls: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = cls;
    this.root.appendChild(el);
    return el;
  }

  update(
    game: DriveGame,
    car: Car,
    panes: { driver: Pane; navigator: Pane },
    width: number,
    padSources: boolean[],
    names: [string, string],
    solo = false,
    /** A futó este mérlege — a zsák, ami a házból jön. */
    run: { candy: number; housesVisited: number } | null = null,
    /** A város haragja — ebből lesz a falka a célháznál. */
    anger: { level: number; label: string; lastReason: string } | null = null
  ): void {
    const d = game.driverIndex;
    const n = game.navigatorIndex;
    const accent = (i: number) => hex(i === 0 ? PALETTE.p1 : PALETTE.p2);

    this.driverTag.style.setProperty('--accent', accent(d));
    this.driverTag.style.left = '14px';
    this.driverTag.style.top = `${panes.driver.cssTop + 12}px`;
    this.driverTag.innerHTML =
      `<span class="tag">${names[d]}</span><span class="role">${solo ? 'SOFŐR ÉS NAVIGÁTOR' : 'SOFŐR'}</span>` +
      `<span class="src">${padSources[d] ? 'gamepad' : 'keyboard'}</span>`;

    // Egyedül nincs második játékos, akinek a neve és a szerepe szólna, és
    // nincs mit elválasztani sem: a második névtábla és a vonal ilyenkor nem
    // információ, hanem épp azt sugallja, hogy a kép ketté van osztva.
    this.navTag.style.display = solo ? 'none' : '';
    this.divider.style.display = solo ? 'none' : '';
    if (!solo) {
      this.navTag.style.setProperty('--accent', accent(n));
      this.navTag.style.left = '14px';
      this.navTag.style.top = `${panes.navigator.cssTop + 12}px`;
      this.navTag.innerHTML =
        `<span class="tag">${names[n]}</span><span class="role">NAVIGÁTOR</span>` +
        `<span class="src">${padSources[n] ? 'gamepad' : 'keyboard'}</span>`;
    }

    const kmh = Math.round(Math.abs(car.speed) * 3.6);
    this.speed.style.top = `${panes.driver.cssTop + panes.driver.h - 74}px`;
    // A DRIFT a sebességmérőn jelenik meg, nem külön kijelzőn: ugyanannak a
    // kérdésnek a másik fele („hogy megyünk"), és egy önálló ikon a képernyő
    // másik sarkában olyan helyre kérné a szemet, ahol vezetés közben senki
    // nem néz.
    this.speed.classList.toggle('is-drifting', car.drifting);
    this.speed.innerHTML =
      `<b>${kmh}</b><span>km/h</span>` +
      `<u><i style="width:${(Math.abs(car.speed) / CAR.maxSpeed) * 100}%"></i></u>` +
      (car.drifting ? `<em>DRIFT</em>` : '');

    // A nyíl: irány, nem útvonal.
    //
    // A HÁZHOZ továbbra is elévül — a navigátornak azért van gombja, hogy
    // kérni kelljen. A KAPUHOZ viszont VÉGIG látszik: egy időfutam, amiben
    // előbb meg kell találni a kapukat, nem ügyességi feladat, hanem
    // bújócska, és négyszázötven egység széles városban reménytelen.
    const toGate = game.pingLabel === 'KAPU';
    const live = toGate || game.pingLeft > 0;
    this.ping.style.opacity = toGate ? '1' : live ? String(Math.min(1, game.pingLeft / 0.4)) : '0';
    this.ping.style.top = `${panes.driver.cssTop + panes.driver.h * 0.22}px`;
    (this.ping.querySelector('.arrow') as HTMLElement).style.transform =
      `rotate(${game.pingBearing + Math.PI / 2}rad)`;
    // A felirat megmondja, MIRE mutat, és milyen messze van. Egy nyíl
    // távolság nélkül nem tudod, hogy a következő sarok vagy a város túlvége.
    (this.ping.querySelector('.cap') as HTMLElement).textContent = toGate
      ? `KAPU ${Math.round(game.distanceToWaypoint)}m`
      : 'IRÁNY';

    // Each verb names the button that fires it, for the device that player is
    // actually holding. "RADAR" alone told the navigator nothing.
    const navPad = padSources[n];
    // Egyedül a térkép a sarokban van, és az igék fölé kerülnek — nem a
    // képernyő aljára, ahol kétfősnél a navigátor panele volt.
    this.verbs.style.top = solo
      ? `${panes.navigator.cssTop - 30}px`
      : `${panes.navigator.cssTop + 12}px`;
    // Az igék a JOBB szélhez igazodnak, mindig.
    //
    // Korábban egyedül a térkép bal széléhez kerültek (`left: navigator.x`),
    // miközben a `right: 20px` is érvényben maradt: a doboz mindkét oldalról
    // meg volt fogva, a három ige pedig szélesebb volt a panelnél, és
    // kilógott — mérve 1337 képpontig egy 1280 képpont széles ablakban.
    // Jobbról igazítva a szélessége már nem tud kifutni a képernyőről,
    // és a térkép fölött marad, ami az eredeti szándék volt.
    this.verbs.style.left = 'auto';
    this.verbs.style.right = '20px';
    this.verbs.innerHTML =
      `<span${game.radarLeft > 0 ? ' class="hot"' : ''}>` +
      `<kbd>${keyFor('sprint', n, navPad)}</kbd>RADAR</span>` +
      `<span><kbd>${keyFor('jump', n, navPad)}</kbd>IRÁNY</span>` +
      `<span><kbd>${keyFor('action', n, navPad)}</kbd>CÉL</span>`;

    // The driver only ever steers and brakes, so their legend is two entries.
    this.driveLegend.style.left = '20px';
    // ALULRÓL, nem felülről. A magyarázó hét bejegyzésből áll, és keskeny
    // ablakban két-három sorra tördel: egy 1280×800-as ablakban 770-től
    // 813-ig ért, vagyis a fele a képernyő alatt volt. Az alsó élhez kötve a
    // magassága már nem számít.
    this.driveLegend.style.top = 'auto';
    this.driveLegend.style.bottom = `${Math.max(
      10,
      window.innerHeight - (panes.driver.cssTop + panes.driver.h) + 12
    )}px`;
    this.driveLegend.innerHTML =
      hint('steer', d, padSources[d], 'kormány') +
      hint('brake', d, padSources[d], 'fék / tolatás') +
      hint('jump', d, padSources[d], 'ugrás') +
      hint('sprint', d, padSources[d], car.speed < 1 ? 'bőgetés' : 'kézifék') +
      `<kbd>↑↓←→</kbd>körülnézés` +
      hint('action', d, padSources[d], 'duda') +
      // A nitró a tartály állásával együtt jelenik meg: egy gomb, aminek a
      // kijelzőjéből nem derül ki, van-e még benne, nem gomb, hanem találgatás.
      `<span class="${car.boosting ? 'hot' : ''}"><kbd>F</kbd>NITRÓ ${'|'.repeat(Math.round(car.nitroCharge * 8)).padEnd(8, '·')}</span>`;

    if (!solo) {
      this.divider.style.left = '0px';
      this.divider.style.top = `${panes.navigator.cssTop}px`;
      this.divider.style.width = `${width}px`;
      this.divider.style.height = '3px';
      this.divider.style.opacity = '1';
    }

    // The parking prompt outranks the banner: it is an instruction, not news,
    // and it stays up until the players act on it.
    const message = game.parkPrompt || game.banner;
    this.banner.textContent = message;
    this.banner.style.opacity = message ? '1' : '0';
    this.banner.classList.toggle('is-prompt', Boolean(game.parkPrompt));

    const s = game.stats;
    this.score.classList.toggle('is-alarmed', s.crittersHit > 0 && game.banner.startsWith('JAJ'));
    this.score.innerHTML = s.arrived
      ? `<span class="done">MEGÉRKEZTETEK</span><span class="dim">${s.score} pont · ${s.time.toFixed(0)}s</span>`
      : `<span class="state">${s.score} PONT</span>` +
        // A ZSÁK. Eddig csak a házban látszott, pedig az egész este róla szól:
        // kint gyűjtöd be a következő házat, és kint is lehet elveszíteni.
        (run ? `<span class="candy">🍬 ${run.candy}</span>` : '') +
        // A KIHÍVÁS állandóan látszik, amíg nincs kész. Nem szalagcím: azt
        // egy pillanat múlva felváltja a következő üzenet, és akkor megint
        // nem tudod, mivel tartozol a házért.
        (game.challenge && !game.challenge.done
          ? `<span class="task">${game.challenge.label}</span>`
          : '') +
        // A HARAG. Nem szám, hanem állapot: „figyelnek", „idegesek". Egy
        // százalék nem mond semmit arról, mi vár rád — egy hangulat igen.
        (anger
          ? `<span class="anger" data-hot="${anger.level > 0.45}">${anger.lastReason || anger.label}</span>`
          : '') +
        `<span class="dim">${s.crittersHit} elütés · ${s.nearMisses} majdnem · ${s.crashes} koccanás</span>` +
        `<span class="dim">${Math.round(game.distanceToTarget)}m</span>` +
        (game.radarLeft > 0 ? `<span class="exit">RADAR ${game.radarLeft.toFixed(1)}s</span>` : '');
  }

  /** Where the navigator map canvas should sit. */
  mapRect(panes: { navigator: Pane }): { x: number; top: number; w: number; h: number } {
    // A navigátor panel maga mondja meg, hol van: kétfősnél a képernyő alján
    // végig, egyedül a jobb felső sarokban. A térkép csak követi.
    return {
      x: panes.navigator.x,
      top: panes.navigator.cssTop,
      w: panes.navigator.w,
      h: panes.navigator.h,
    };
  }
}
