import * as THREE from 'three';
import type { VillageHouse } from '../world/VillageHouse';

/**
 * A ház minitérképe, a jobb felső sarokban.
 *
 * A házban eddig CSAK az látszott, ami a kamera képébe fért — és a kamera
 * szándékosan egy szobát mutat. Ettől a lakás bejárása találgatás volt: nem
 * tudtad, hány szoba van, merre nem jártál még, és hol a kijárat.
 *
 * A minitérkép nem veszi el a felfedezést, mert NEM MUTAT MINDENT:
 *
 *   · az ALAPRAJZ látszik — hány szoba van és hogyan kapcsolódnak;
 *   · a CUKORKA és a KIJÁRAT látszik — ezek a célok, nem a titkok;
 *   · az ÜLDÖZŐK viszont csak akkor, ha látod vagy hallod őket.
 *
 * Ez utóbbi a lényeg. Egy térkép, amin a lakó mindig ott van egy pöttyként,
 * megszünteti a lopakodást — onnantól nem figyelni kell, hanem a sarkot
 * nézni. Így viszont a térkép azt mondja el, amit TUDSZ, nem azt, amit a
 * játék tud.
 */
export class HouseMap {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  constructor(parent: HTMLElement) {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'house-map';
    parent.appendChild(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
  }

  dispose(): void {
    this.canvas.remove();
  }

  place(right: number, top: number, size: number): void {
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.style.right = `${right}px`;
    this.canvas.style.top = `${top}px`;
    this.canvas.style.width = `${size}px`;
    this.canvas.style.height = `${size}px`;
    const p = Math.max(1, Math.round(size * dpr));
    if (this.canvas.width !== p) {
      this.canvas.width = p;
      this.canvas.height = p;
    }
  }

  /**
   * @param heading Merre nézel. Ha meg van adva, a térkép VELED EGYÜTT FOROG:
   * a kép teteje mindig az, amerre nézel.
   *
   * Belső nézetben ez nem kényelmi kérdés. Álló térképnél a fejedben kell
   * elforgatni a világot, hogy megtaláld, merre van „balra" — és pont akkor,
   * amikor menekülsz. Forgó térképnél a bal kéz felőli folyosó a képen is
   * balra van.
   * @param marks Külön jelölések: a sarkok és a bázis.
   */
  draw(
    house: VillageHouse,
    players: { position: THREE.Vector3; index: number }[],
    localIndex: number,
    hunters: { position: THREE.Vector3; facing: number; known: boolean; colour: string }[],
    heading?: number,
    marks: { position: THREE.Vector3; colour: string; ring?: boolean }[] = []
  ): void {
    const ctx = this.ctx;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const s = this.canvas.width / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, s, s);

    ctx.fillStyle = 'rgba(10,6,22,.82)';
    ctx.fillRect(0, 0, s, s);

    const n = house.gridSize;
    // A rács NEM négyzet a világban: a cellák x és z mérete külön. A
    // térképen viszont az arány számít, különben a folyosós ház
    // négyzetesnek látszana.
    const pad = 6;
    const k = (s - pad * 2) / n;
    const px = (x: number): number => pad + house.col(x) * k;
    const py = (z: number): number => pad + house.row(z) * k;

    // A FORGATÁS a vászon körül történik, nem elemenként: így az alaprajz, a
    // célok és az üldözők egyszerre fordulnak, és nem tud egyik a másikhoz
    // képest elcsúszni. A saját jelölőnk marad álló — az mindig felfelé néz,
    // mert az VAGY TE.
    const me = players.find((p) => p.index === localIndex);
    const spin = heading !== undefined && me;
    if (spin) {
      ctx.save();
      ctx.translate(s / 2, s / 2);
      ctx.rotate(heading);
      ctx.translate(-px(me.position.x), -py(me.position.z));
    }

    // --- az alaprajz --------------------------------------------------------
    // Nyers cellánként rajzolni 384×384-et minden képkockán drága lenne. A
    // szobák egyszer épülnek fel egy külön vászonra, és utána csak másoljuk.
    if (!this.plan) this.buildPlan(house, n, pad, k, s);
    if (this.plan) ctx.drawImage(this.plan, 0, 0, s, s);

    // --- a célok ------------------------------------------------------------
    for (const c of house.candySpots) {
      ctx.fillStyle = c.taken ? 'rgba(255,217,168,.22)' : '#ffd9a8';
      ctx.beginPath();
      ctx.arc(px(c.position.x), py(c.position.z), c.taken ? 2 : 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // A kijárat: az egyetlen hely, ami akkor is számít, ha még nem mehetsz ki.
    ctx.strokeStyle = '#7ef0b6';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px(house.exitZone.x), py(house.exitZone.z), 5, 0, Math.PI * 2);
    ctx.stroke();

    // --- külön jelölések: a sarkok és a bázis -------------------------------
    for (const m of marks) {
      const mx = px(m.position.x);
      const my = py(m.position.z);
      ctx.strokeStyle = m.colour;
      ctx.fillStyle = m.colour;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(mx, my, 6, 0, Math.PI * 2);
      m.ring ? ctx.stroke() : ctx.fill();
    }

    // --- az üldözők, ha tudsz róluk ----------------------------------------
    for (const h of hunters) {
      if (!h.known) continue;
      const hx = px(h.position.x);
      const hy = py(h.position.z);
      ctx.fillStyle = h.colour;
      ctx.beginPath();
      ctx.arc(hx, hy, 3.4, 0, Math.PI * 2);
      ctx.fill();
      // Az iránya: ez az, amiből meg lehet ítélni, hogy feléd jön-e.
      ctx.strokeStyle = h.colour;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx + Math.sin(h.facing) * 9, hy - Math.cos(h.facing) * 9);
      ctx.stroke();
    }

    // --- a szörnyek ---------------------------------------------------------
    for (const p of players) {
      const mine = p.index === localIndex;
      if (mine && spin) continue; // forgó térképen a sajátunk a közepén, állva
      ctx.fillStyle = mine ? '#ff7a29' : '#9d5cff';
      ctx.beginPath();
      ctx.arc(px(p.position.x), py(p.position.z), mine ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (mine) {
        ctx.strokeStyle = 'rgba(255,122,41,.55)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(px(p.position.x), py(p.position.z), 7.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    if (spin) {
      ctx.restore();
      // A SAJÁT JELÖLŐ a forgatáson KÍVÜL: mindig a kép közepén áll, és
      // mindig felfelé néz. Ez adja a forgó térkép értelmét — te vagy a
      // rögzített pont, és a világ fordul körülötted.
      ctx.fillStyle = '#ff7a29';
      ctx.beginPath();
      ctx.moveTo(s / 2, s / 2 - 7);
      ctx.lineTo(s / 2 - 5, s / 2 + 5);
      ctx.lineTo(s / 2 + 5, s / 2 + 5);
      ctx.closePath();
      ctx.fill();
    }
  }

  private plan: HTMLCanvasElement | null = null;

  /** Az alaprajz egyszer rajzolódik meg, és utána képként másolódik. */
  private buildPlan(house: VillageHouse, n: number, pad: number, k: number, s: number): void {
    const c = document.createElement('canvas');
    c.width = s;
    c.height = s;
    const g = c.getContext('2d');
    if (!g) return;
    // Szobánként más árnyalat: így a szobák HATÁRA is látszik, nem csak az,
    // hogy hol van padló. Egy egyszínű alaprajzon a hétszobás lakás egyetlen
    // amőbának néz ki.
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const room = house.roomAt(house.worldX(i), house.worldZ(j));
        if (room === 0) continue;
        const hue = (room * 47) % 360;
        g.fillStyle = `hsla(${hue}, 28%, 46%, .5)`;
        g.fillRect(pad + i * k, pad + j * k, Math.ceil(k), Math.ceil(k));
      }
    }
    this.plan = c;
  }
}
