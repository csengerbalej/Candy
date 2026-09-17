import type { RoomTransport } from '../net/Room';
import { TOPICS } from '../net/NetSession';

/**
 * A két játékos beszélgetése.
 *
 * Kétfős módban a társad egy MÁSIK ESZKÖZÖN ül — nem feltétlenül melletted.
 * Eddig semmi nem kötötte össze titeket a játékon belül: a „várj a
 * társadra" kiírás megmondta, hogy várni kell, de azt nem, hogy miért.
 *
 * Két szint, mert két különböző helyzet van:
 *
 *   GYORSÜZENET (1–4)  vezetés közben. Egy gomb, kész mondat, nulla
 *                      figyelem. Aki 120-szal megy, nem gépel.
 *   SZABAD SZÖVEG (T)  amikor állsz vagy a házban vagy. Megnyílik egy
 *                      mező, Enter küld, Esc kilép.
 *
 * Ami leírva van, az PILLANAT, nem állapot: `emit`-tel megy, nem
 * jelenléttel. Ha egy üzenet elveszik, nem baj — a következő úgyis jön.
 * Semmilyen szabály nem függ tőle.
 */

/** A gyorsüzenetek. Rövidek, és mind arról szólnak, amit VEZETÉS közben kell. */
export const QUICK = [
  'Megyek!',
  'Várj meg!',
  'Itt vagyok a háznál',
  'Bajban vagyok',
] as const;

interface Line {
  who: string;
  text: string;
  mine: boolean;
  left: number;
}

export class Chat {
  private readonly root: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly field: HTMLInputElement;
  private readonly lines: Line[] = [];
  private stop: (() => void) | null = null;

  /** Nyitva van-e a szövegmező — ilyenkor a játék nem kaphat gombot. */
  typing = false;

  /** Meddig marad egy sor a képen. Elég hosszú ahhoz, hogy elolvasd. */
  private static readonly LIFE = 9;

  constructor(
    parent: HTMLElement,
    private readonly room: RoomTransport | null,
    private readonly myName: string
  ) {
    this.root = document.createElement('div');
    this.root.className = 'chat';
    this.root.innerHTML =
      '<div class="chat-log"></div>' +
      '<input class="chat-field" type="text" maxlength="90" hidden ' +
      'placeholder="írj valamit · Enter küld · Esc mégse" />';
    parent.appendChild(this.root);
    this.log = this.root.querySelector('.chat-log') as HTMLDivElement;
    this.field = this.root.querySelector('.chat-field') as HTMLInputElement;

    this.field.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = this.field.value.trim();
        if (text) this.send(text);
        this.close();
      } else if (e.key === 'Escape') {
        this.close();
      }
    });

    if (room) {
      this.stop = room.on(TOPICS.chat, (msg) => {
        if (msg.isMe) return;
        const data = msg.data as { n?: string; t?: string } | undefined;
        if (!data?.t) return;
        // A KAPOTT SZÖVEG NEM MEGBÍZHATÓ: a másik gépről jön, tehát
        // szövegként kezeljük, sosem jelölőnyelvként.
        this.push(String(data.n ?? 'TÁRS').slice(0, 24), String(data.t).slice(0, 120), false);
      });
    }
  }

  dispose(): void {
    this.stop?.();
    this.root.remove();
  }

  /** A `T` nyitja, ha épp nem gépelsz. */
  open(): void {
    if (this.typing) return;
    this.typing = true;
    this.field.hidden = false;
    this.field.value = '';
    this.field.focus();
  }

  private close(): void {
    this.typing = false;
    this.field.hidden = true;
    this.field.blur();
  }

  /** Egy gyorsüzenet a számgombokról. */
  quick(index: number): void {
    const text = QUICK[index];
    if (text) this.send(text);
  }

  send(text: string): void {
    this.push(this.myName, text, true);
    this.room?.emit(TOPICS.chat, { n: this.myName, t: text });
  }

  update(dt: number): void {
    let changed = false;
    for (let i = this.lines.length - 1; i >= 0; i--) {
      this.lines[i].left -= dt;
      if (this.lines[i].left <= 0) {
        this.lines.splice(i, 1);
        changed = true;
      }
    }
    if (changed) this.render();
  }

  private push(who: string, text: string, mine: boolean): void {
    this.lines.push({ who, text, mine, left: Chat.LIFE });
    // Négy sornál több nem fér el a képen anélkül, hogy a játékot takarná.
    while (this.lines.length > 4) this.lines.shift();
    this.render();
  }

  private render(): void {
    this.log.replaceChildren(
      ...this.lines.map((l) => {
        const row = document.createElement('p');
        row.className = l.mine ? 'mine' : 'theirs';
        const who = document.createElement('b');
        who.textContent = l.who;
        row.append(who, document.createTextNode(l.text));
        return row;
      })
    );
  }
}
