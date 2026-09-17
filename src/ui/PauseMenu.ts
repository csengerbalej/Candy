import { settings, saveSettings, type Settings } from '../game/Settings';
import type { InputManager } from '../input/InputManager';

interface Row {
  key: keyof Settings | 'resume' | 'swap' | 'reselect' | 'title';
  label: string;
  note?: string;
  /** Cycles the value. Absent for plain actions. */
  values?: Array<{ value: Settings[keyof Settings]; text: string }>;
}

export interface PauseActions {
  onSwapRoles?: () => void;
  onReselect: () => void;
  onTitle: () => void;
}

/** Writes one entry without widening the whole Settings type to `any`. */
function setSetting<K extends keyof Settings>(key: K, value: Settings[keyof Settings]): void {
  settings[key] = value as Settings[K];
}

const ON_OFF = [
  { value: true, text: 'BE' },
  { value: false, text: 'KI' },
];

/**
 * Pause and settings, opened with Escape or a gamepad's start button.
 *
 * Either player can open it and either player can drive it — in a couch co-op
 * the person who spots the problem is not reliably the person holding player
 * one's controls.
 *
 * Every row changes something live. Nothing here needs a restart, because a
 * setting that only takes effect later is a setting players stop believing in.
 */
export class PauseMenu {
  private readonly root: HTMLDivElement;
  private open = false;
  private cursor = 0;
  private readonly axisX: [boolean, boolean] = [false, false];
  private readonly axisY: [boolean, boolean] = [false, false];

  constructor(
    parent: HTMLElement,
    private readonly input: InputManager,
    private readonly actions: PauseActions,
    private readonly onChange: () => void,
    /** 'settings' drops the in-game rows, for opening it from the main menu. */
    private readonly variant: 'pause' | 'settings' = 'pause'
  ) {
    this.root = document.createElement('div');
    this.root.className = 'pause';
    this.root.hidden = true;
    parent.appendChild(this.root);

    this.root.addEventListener('click', this.onClick);
    this.root.addEventListener('mousemove', this.onHover);
    window.addEventListener('keydown', this.onKeyDown);
  }

  /** Mouse acts as player one — see Frontend for why. */
  private readonly onClick = (event: MouseEvent): void => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!row) {
      // Clicking the backdrop is the universal "close this".
      if (event.target === this.root) this.toggle();
      return;
    }
    this.cursor = Number(row.dataset.row);
    const definition = this.rows[this.cursor];
    if (definition.values) this.cycle(definition, 1);
    else this.activate(definition.key);
    this.render();
  };

  private readonly onHover = (event: MouseEvent): void => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
    if (!row) return;
    const next = Number(row.dataset.row);
    if (next === this.cursor) return;
    this.cursor = next;
    this.render();
  };

  private cycle(row: Row, direction: number): void {
    if (!row.values) return;
    const index = row.values.findIndex((v) => v.value === settings[row.key as keyof Settings]);
    const next = (index + direction + row.values.length) % row.values.length;
    setSetting(row.key as keyof Settings, row.values[next].value);
    saveSettings();
    this.onChange();
  }

  /**
   * A menu is created per section, so its listener has to go with it —
   * otherwise Escape ends up toggling three menus at once by the third house.
   */
  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.root.removeEventListener('click', this.onClick);
    this.root.removeEventListener('mousemove', this.onHover);
    this.root.remove();
  }

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.code !== 'Escape') return;
    e.preventDefault();
    this.toggle();
  };

  get isOpen(): boolean {
    return this.open;
  }

  toggle(): void {
    this.open = !this.open;
    this.root.hidden = !this.open;
    if (this.open) this.render();
  }

  private get rows(): Row[] {
    const rows: Row[] = [
      { key: 'resume', label: this.variant === 'settings' ? 'VISSZA' : 'FOLYTATÁS' },
    ];
    if (this.variant === 'pause' && this.actions.onSwapRoles) {
      rows.push({ key: 'swap', label: 'SZEREPCSERE', note: 'sofőr ↔ navigátor' });
    }
    rows.push(
      {
        key: 'splitOrientation',
        label: 'OSZTÁS IRÁNYA',
        note: 'szűk terekben a függőleges olvashatóbb',
        values: [
          { value: 'horizontal', text: 'VÍZSZINTES' },
          { value: 'vertical', text: 'FÜGGŐLEGES' },
        ],
      },
      {
        key: 'splitSensitivity',
        label: 'OSZTÁS KÜSZÖBE',
        note: 'mennyire távolodhattok, mielőtt kettéválik',
        values: [
          { value: 'tight', text: 'KÖZELI' },
          { value: 'normal', text: 'ALAP' },
          { value: 'loose', text: 'TÁVOLI' },
        ],
      },
      {
        key: 'outlines',
        label: 'KONTÚROK',
        note: 'a rajzfilmes körvonal',
        values: ON_OFF,
      },
      { key: 'shadows', label: 'ÁRNYÉKOK', note: 'gyengébb gépen kapcsold ki', values: ON_OFF },
      {
        key: 'resolution',
        label: 'FELBONTÁS',
        note: 'ÉLES a kijelződ saját sűrűségén rajzol',
        values: [
          { value: 0.75, text: 'ALACSONY' },
          { value: 1, text: 'KÖZEPES' },
          { value: 2, text: 'ÉLES' },
        ],
      },
      {
        key: 'invertSteering',
        label: 'FORDÍTOTT KORMÁNY',
        note: 'ha tolatva zavar',
        values: ON_OFF,
      },
      { key: 'showFps', label: 'KÉPKOCKA/MP', values: ON_OFF }
    );
    if (this.variant === 'pause') {
      rows.push(
        { key: 'reselect', label: 'ÚJ KARAKTER ÉS SZEREP', note: 'új éjszakát kezd — a neveitek megmaradnak' },
        { key: 'title', label: 'KILÉPÉS A FŐMENÜBE', note: 'a menet megmarad — a FOLYTATÁS visszahoz' }
      );
    }
    return rows;
  }

  update(): void {
    if (!this.open) return;
    const rows = this.rows;
    let changed = false;

    for (const player of [0, 1] as const) {
      const inp = this.input.get(player);
      const stepY = this.edge(this.axisY, player, inp.moveY);
      const stepX = this.edge(this.axisX, player, inp.moveX);

      if (stepY) {
        // Up on a stick is +1, and up a list is backwards.
        this.cursor = (this.cursor - stepY + rows.length) % rows.length;
        changed = true;
      }

      const row = rows[this.cursor];
      if (stepX && row.values) {
        this.cycle(row, stepX);
        changed = true;
      }

      if (inp.interact || inp.jump) {
        if (row.values) {
          this.cycle(row, 1);
          changed = true;
        } else {
          this.activate(row.key);
          return;
        }
      }
    }

    if (changed) this.render();
  }

  private activate(key: Row['key']): void {
    switch (key) {
      case 'resume':
        this.toggle();
        break;
      case 'swap':
        this.actions.onSwapRoles?.();
        this.toggle();
        break;
      case 'reselect':
        this.actions.onReselect();
        break;
      case 'title':
        this.actions.onTitle();
        break;
    }
  }

  private edge(state: [boolean, boolean], player: 0 | 1, value: number): number {
    const active = Math.abs(value) > 0.5;
    const step = active && !state[player] ? Math.sign(value) : 0;
    state[player] = active;
    return step;
  }

  private render(): void {
    const rows = this.rows;
    this.root.innerHTML = `
      <div class="pause-card">
        <h2>${this.variant === 'settings' ? 'BEÁLLÍTÁSOK' : 'SZÜNET'}</h2>
        <p class="hint">Fel/le lépked · balra/jobbra állít · <b>E</b> / <b>Enter</b> választ ·
        <b>Esc</b> vagy <b>Start</b> ${this.variant === 'settings' ? 'bezár' : 'vissza a játékba'}</p>
        <ul>
          ${rows
            .map((row, index) => {
              const value = row.values
                ? row.values.find((v) => v.value === settings[row.key as keyof Settings])?.text ??
                  '—'
                : '';
              return `
                <li data-row="${index}" class="${index === this.cursor ? 'is-active' : ''}${
                  row.values ? '' : ' is-action'
                }">
                  <span class="label">${row.label}</span>
                  ${row.values ? `<span class="value">◂ ${value} ▸</span>` : '<span class="value">›</span>'}
                  ${row.note ? `<span class="note">${row.note}</span>` : ''}
                </li>`;
            })
            .join('')}
        </ul>
      </div>`;
  }
}
