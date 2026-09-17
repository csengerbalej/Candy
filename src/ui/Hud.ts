import { SPLIT, PALETTE } from '../core/config';
import type { SplitScreenDirector } from '../camera/SplitScreenDirector';
import type { HouseGame } from '../game/HouseGame';
import type { Homeowner } from '../ai/Homeowner';
import type { PlayerController } from '../player/PlayerController';
import { hint } from './Controls';

const hex = (n: number) => '#' + n.toString(16).padStart(6, '0');

export interface HudFrame {
  director: SplitScreenDirector;
  width: number;
  height: number;
  players: PlayerController[];
  padSources: boolean[];
  names: [string, string];
  game?: HouseGame;
  homeowner?: Homeowner;
  /** Egyszemélyes módban a most irányított szörny; egyébként null. */
  soloActive?: number | null;
}

/**
 * Per-player HUD. Two of everything, positioned inside each player's viewport —
 * because the moment a HUD element assumes "the screen", split-screen is dead.
 * The only shared elements are the ones about the thing both players share:
 * the homeowner, and whether you are getting out.
 */
export class Hud {
  private readonly root: HTMLDivElement;
  private readonly panels: HTMLDivElement[] = [];
  private readonly prompts: HTMLDivElement[] = [];
  private readonly arrows: HTMLDivElement[] = [];
  private readonly legends: HTMLDivElement[] = [];
  private readonly leashes: HTMLDivElement[] = [];
  private readonly divider: HTMLDivElement;
  private readonly watch: HTMLDivElement;
  private readonly banner: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    parent.appendChild(this.root);

    for (let i = 0; i < 2; i++) {
      const accent = hex(i === 0 ? PALETTE.p1 : PALETTE.p2);

      const panel = document.createElement('div');
      panel.className = 'hud-panel';
      panel.style.setProperty('--accent', accent);
      panel.innerHTML =
        `<span class="tag"></span>` +
        `<span class="candy">0</span>` +
        `<span class="src">keyboard</span>`;
      this.root.appendChild(panel);
      this.panels.push(panel);

      const prompt = document.createElement('div');
      prompt.className = 'hud-prompt';
      prompt.style.setProperty('--accent', accent);
      prompt.innerHTML = `<span class="text"></span><span class="bar"><i></i></span>`;
      this.root.appendChild(prompt);
      this.prompts.push(prompt);

      // A permanent legend inside each player's own pane. Couch co-op means
      // the person who forgets a button cannot lean over and read the other
      // half of the screen.
      const legend = document.createElement('div');
      legend.className = 'hud-legend';
      legend.style.setProperty('--accent', accent);
      this.root.appendChild(legend);
      this.legends.push(legend);

      const leash = document.createElement('div');
      leash.className = 'hud-leash';
      leash.textContent = '⚠ TÚL MESSZE VAGYTOK EGYMÁSTÓL';
      this.root.appendChild(leash);
      this.leashes.push(leash);
    }

    this.divider = document.createElement('div');
    this.divider.className = 'hud-divider';
    this.root.appendChild(this.divider);

    // Egy nyíl panelenként, a válaszvonal mellett, a társ felé.
    for (let i = 0; i < 2; i++) {
      const arrow = document.createElement('div');
      arrow.className = 'hud-partner';
      arrow.style.setProperty('--accent', i === 0 ? '#ff7a29' : '#9d5cff');
      this.root.appendChild(arrow);
      this.arrows.push(arrow);
    }

    this.watch = document.createElement('div');
    this.watch.className = 'hud-watch';
    this.root.appendChild(this.watch);

    this.banner = document.createElement('div');
    this.banner.className = 'hud-banner';
    this.root.appendChild(this.banner);
  }

  dispose(): void {
    this.root.remove();
  }

  /**
   * Nyíl a válaszvonal mellett, a társad felé.
   *
   * Osztott képen a leggyakoribb baj nem az, hogy nem látod a saját szobádat,
   * hanem hogy elveszíted a másikat: két kép, két hely, és semmi nem köti
   * össze őket. A nyíl a válaszvonalon áll — ott, ahol a két világ találkozik
   * — és arra mutat, amerre a társad valóban van, a KÉPERNYŐN mérve, nem
   * világkoordinátában, mert a játékos a képernyőt nézi.
   */
  private renderPartnerArrows(f: HudFrame, horizontal: boolean, px: number): void {
    const { director: dir, width, height } = f;
    const show = dir.splitAmount > 0.35;
    for (let i = 0; i < 2; i++) {
      const arrow = this.arrows[i];
      arrow.style.opacity = show ? String(Math.min(1, (dir.splitAmount - 0.35) * 3)) : '0';
      if (!show) continue;

      // A társ panelje a válaszvonal másik oldalán van; a nyíl arrafelé mutat.
      const mineIsFirst = (i === 0) !== dir.splitLayout.swap;
      if (horizontal) {
        arrow.style.left = `${width * 0.5 - 14}px`;
        arrow.style.top = `${height - px - (mineIsFirst ? -8 : 28)}px`;
        arrow.textContent = mineIsFirst ? '▼' : '▲';
      } else {
        arrow.style.left = `${px + (mineIsFirst ? 8 : -36)}px`;
        arrow.style.top = `${height * 0.5 - 14}px`;
        arrow.textContent = mineIsFirst ? '►' : '◄';
      }
    }
  }

  update(f: HudFrame): void {
    const { director: dir, width, height } = f;
    // A vágás iránya a geometriából jön, nem beállításból: ha a két szoba
    // egymás mellett van, függőleges; ha egymás fölött, vízszintes.
    const horizontal = !dir.splitLayout.vertical;
    const t = dir.splitAmount;

    for (let i = 0; i < 2; i++) {
      const vp = dir.viewports[i];
      const visible = vp.w > 2 && vp.h > 34;
      const opacity = i === 0 ? 1 : visible ? Math.min(1, t * 3) : 0;
      // WebGL viewports are bottom-left origin; CSS is top-left.
      const cssTop = height - (vp.y + vp.h);

      const panel = this.panels[i];
      panel.style.opacity = String(opacity);
      panel.style.left = `${vp.x + 14}px`;
      panel.style.top = `${cssTop + 12}px`;
      (panel.querySelector('.tag') as HTMLElement).textContent = f.names[i];
      (panel.querySelector('.candy') as HTMLElement).textContent = `🍬 ${f.players[i].candy}`;
      (panel.querySelector('.src') as HTMLElement).textContent = f.padSources[i]
        ? 'gamepad'
        : 'keyboard';

      const pad = f.padSources[i];
      const legend = this.legends[i];
      legend.style.opacity = String(visible ? opacity * 0.85 : 0);
      legend.style.left = `${vp.x + 14}px`;
      // Clear of the shared watch pill, which is centred along the bottom.
      legend.style.top = `${cssTop + vp.h - 52}px`;
      legend.innerHTML =
        hint('move', i, pad, 'mozgás') +
        hint('sprint', i, pad, 'futás') +
        hint('jump', i, pad, 'ugrás ×2') +
        hint('action', i, pad, 'csíny / cukorka') +
        // A kamera: egy eszközön egy ember nézi, tehát a sajátja. A nyilak
        // forgatják, a Q negyedfordulót lép, a T szöget vált.
        (f.soloActive === i ? '<kbd>↑↓←→</kbd>kamera' : '');

      const st = f.game?.status[i];
      const prompt = this.prompts[i];
      prompt.style.opacity = String(st?.prompt && visible ? opacity : 0);
      prompt.style.left = `${vp.x + vp.w / 2}px`;
      prompt.style.top = `${cssTop + vp.h - 84}px`;
      // The prompt names the key, so a player never has to guess which button
      // "nyomd meg" means on their own device.
      (prompt.querySelector('.text') as HTMLElement).innerHTML = st?.prompt
        ? hint('action', i, pad, st.prompt)
        : '';
      (prompt.querySelector('.bar i') as HTMLElement).style.width = `${(st?.grabProgress ?? 0) * 100}%`;
      (prompt.querySelector('.bar') as HTMLElement).style.opacity = st?.grabProgress ? '1' : '0';

      const nagging = dir.separation > SPLIT.maxDistance;
      const leash = this.leashes[i];
      leash.style.opacity = nagging && visible ? '1' : '0';
      leash.style.left = `${vp.x + vp.w / 2}px`;
      leash.style.top = `${cssTop + vp.h - 46}px`;
    }

    // Divider slides in from the edge rather than fading in at the middle.
    const px = dir.dividerPixels;
    const d = this.divider.style;
    d.opacity = String(Math.min(1, t * 6));
    // Set properties, never append to cssText: appending every frame grows the
    // style string without bound and leaves the previous orientation's line
    // painted on screen.
    if (horizontal) {
      d.left = '0px';
      d.top = `${height - px}px`;
      d.width = `${width}px`;
      d.height = '3px';
    } else {
      d.left = `${px}px`;
      d.top = '0px';
      d.width = '3px';
      d.height = `${height}px`;
    }

    this.renderPartnerArrows(f, horizontal, px);

    this.renderWatch(f);

    this.banner.textContent = f.game?.banner ?? '';
    this.banner.style.opacity = f.game?.banner ? '1' : '0';
  }

  /** The one thing both players genuinely share: where his attention is. */
  private renderWatch(f: HudFrame): void {
    if (!f.homeowner || !f.game) {
      this.watch.innerHTML =
        `<b>${f.director.state.toUpperCase()}</b> &nbsp; split <b>${f.director.splitAmount.toFixed(2)}</b>` +
        ` &nbsp; távolság <b>${f.director.separation.toFixed(1)}m</b>`;
      return;
    }

    const h = f.homeowner;
    const alarmed = h.state === 'CHASE' || h.state === 'ALERT';
    this.watch.classList.toggle('is-alarmed', alarmed);
    this.watch.innerHTML =
      `<span class="state">${h.state}</span>` +
      `<span class="meter"><i style="width:${(h.suspicion * 100).toFixed(0)}%"></i></span>` +
      (f.game.stats.escaped
        ? `<span class="done">MEGSZÖKTETEK · 🍬 ${f.game.stats.candy}</span>`
        : `<span class="dim">🍬 ${f.game.stats.candy} · ${f.game.stats.pranks} csíny · ${f.game.stats.catches} lebukás</span>`) +
      (f.game.exitProgress > 0 && !f.game.stats.escaped
        ? `<span class="exit">AJTÓ ${(f.game.exitProgress * 100).toFixed(0)}%</span>`
        : '');
  }
}
