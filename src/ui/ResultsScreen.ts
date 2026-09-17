import { awardsFor } from '../game/Awards';
import type { Session } from '../game/Session';
import type { InputManager } from '../input/InputManager';

/**
 * End of the night (spec §30, §31).
 *
 * The numbers come first because they are the shared record of what happened,
 * and the awards come second because they are what the players will actually
 * quote at each other. Every award is positive — see Awards.ts.
 */
export class ResultsScreen {
  private readonly root: HTMLDivElement;
  private resolve: ((again: boolean) => void) | null = null;
  private cursor = 0;
  private readonly axis: [boolean, boolean] = [false, false];

  constructor(
    parent: HTMLElement,
    private readonly session: Session,
    private readonly input: InputManager
  ) {
    this.root = document.createElement('div');
    this.root.className = 'select results';
    parent.appendChild(this.root);
    this.root.addEventListener('click', this.onClick);
    this.render();
  }

  private readonly onClick = (event: MouseEvent): void => {
    const choice = (event.target as HTMLElement).closest<HTMLElement>('[data-choice]');
    if (!choice) return;
    this.cursor = Number(choice.dataset.choice);
    this.finish();
  };

  private finish(): void {
    this.root.removeEventListener('click', this.onClick);
    this.root.remove();
    this.resolve?.(this.cursor === 0);
    this.resolve = null;
  }

  run(): Promise<boolean> {
    return new Promise((resolve) => {
      this.resolve = resolve;
    });
  }

  update(): void {
    for (const player of [0, 1] as const) {
      const inp = this.input.get(player);
      const active = Math.abs(inp.moveX) > 0.5;
      if (active && !this.axis[player]) {
        this.cursor = this.cursor === 0 ? 1 : 0;
        this.render();
      }
      this.axis[player] = active;

      if (inp.interact || inp.jump) return this.finish();
    }
  }

  private render(): void {
    const s = this.session.stats;
    const minutes = Math.floor(s.time / 60);
    const seconds = Math.round(s.time % 60);

    const stat = (label: string, value: string | number) =>
      `<div><dt>${label}</dt><dd>${value}</dd></div>`;

    this.root.innerHTML = `
      <h1>VÉGE AZ ÉJSZAKÁNAK</h1>
      <p class="hint">${this.session.nameOf(0)} és ${this.session.nameOf(1)} ·
      ${s.housesVisited} ház · ${minutes}:${String(seconds).padStart(2, '0')}</p>

      <div class="candy-total"><span>🍬</span><b>${s.candy}</b><em>összegyűjtött cukorka</em></div>

      <dl class="stats">
        ${stat('sikeres csínyek', s.pranks)}
        ${stat('menekülések', s.escapes)}
        ${stat('lebukások', s.catches)}
        ${stat('megmentett szörnyek', Math.max(0, s.nearMisses))}
        ${stat('elütések', s.crittersHit)}
        ${stat('koccanások', s.crashes)}
      </dl>

      <div class="awards">
        ${awardsFor(this.session)
          .map(
            (a) => `
          <article>
            <h3>${a.title}</h3>
            <span class="who">${a.who}</span>
            <p>${a.detail}</p>
          </article>`
          )
          .join('')}
      </div>

      <div class="choices">
        <span data-choice="0" class="${this.cursor === 0 ? 'is-active' : ''}">MÉG EGY ÉJSZAKA</span>
        <span data-choice="1" class="${this.cursor === 1 ? 'is-active' : ''}">FŐMENÜ</span>
      </div>
      <p class="foot">Balra/jobbra vált · <b>E</b> / <b>Enter</b> választ</p>`;
  }
}
