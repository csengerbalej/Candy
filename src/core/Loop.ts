import { SIM } from './config';

/**
 * Mennyi szimulációs lépés fér bele ebbe a képkockába — és mi lesz a maradékkal.
 *
 * A hurok fix 1/60-os lépésekben számol, és a valódi eltelt időt egy
 * gyűjtőben halmozza. Ha egyetlen képkocka megakad (böngésző, GC, bármi), a
 * gyűjtőbe egyszerre sok idő kerül, amit a következő képkocka ledolgoz — ez
 * eddig is így volt, és helyes.
 *
 * AMI NEM VOLT HELYES: ha a ledolgozás beleütközött a lépéskorlátba, a
 * maradék a gyűjtőben MARADT. Egy akadás után a játék így tartósan hátrébb
 * volt a valós időnél, és onnantól MINDEN képkocka hatot lépett, hogy
 * utolérje magát — amit soha nem ért el. Egy pillanatnyi akadásból állandó
 * rángás lett, pont akkor, amikor a kocsi elindul és a képkockák amúgy is
 * drágábbak.
 *
 * A javítás: ha a korlátba ütköztünk, az elveszett időt ELENGEDJÜK. Az óra
 * csúszik egy keveset, ami senkinek nem tűnik fel; a rángás viszont eltűnik.
 */
export function stepBudget(accumulator: number, frameTime: number): {
  steps: number;
  rest: number;
  dropped: number;
} {
  let left = accumulator + frameTime;
  let steps = 0;
  while (left >= SIM.step && steps < SIM.maxSteps) {
    left -= SIM.step;
    steps++;
  }
  // Csak a korlátnál dobunk. Ha magától fogyott el, a maradék a következő
  // képkockáé — az a fix lépésköz lényege.
  if (steps >= SIM.maxSteps && left >= SIM.step) return { steps, rest: 0, dropped: left };
  return { steps, rest: left, dropped: 0 };
}

/**
 * Önszabályozó felbontás.
 *
 * A pixelszám az egyetlen költség, ami NÉGYZETESEN nő, és amit le lehet venni
 * anélkül, hogy a játékból bármi eltűnne. A beállításokban megadott érték a
 * PLAFON marad — ez csak lefelé tér el tőle, és csak ha tényleg kell.
 *
 * Mediánnal dönt, nem az utolsó képkockából: egyetlen 400 ms-os tüske nem
 * jelenti, hogy a gép lassú, és egy tüskére felbontást váltani magában is
 * akadás lenne.
 */
export class Resolution {
  /** A választható lépcsők, a plafontól lefelé. */
  private static readonly STEPS = [2, 1.5, 1.25, 1];

  private readonly recent: number[] = [];
  private cooldown = 0;
  private index = 0;

  constructor(private ceiling: number) {
    this.index = Math.max(0, Resolution.STEPS.findIndex((s) => s <= ceiling));
  }

  setCeiling(ceiling: number): void {
    this.ceiling = ceiling;
    this.index = Math.max(this.index, Resolution.STEPS.findIndex((s) => s <= ceiling));
  }

  get value(): number {
    return Math.min(this.ceiling, Resolution.STEPS[this.index]);
  }

  /** Igaz, ha VÁLTOZOTT — a hívó ilyenkor állítja át a renderert. */
  sample(frameTime: number): boolean {
    this.recent.push(frameTime);
    if (this.recent.length > 90) this.recent.shift();
    this.cooldown = Math.max(0, this.cooldown - frameTime);
    if (this.recent.length < 90 || this.cooldown > 0) return false;

    const sorted = [...this.recent].sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];

    // Lefelé 22 ms-nál (45 kép/mp alatt), felfelé csak 13 ms alatt. A két
    // küszöb közti sáv szándékos: enélkül a rendszer a saját hatásától
    // oda-vissza váltana, ami rosszabb bármelyik végállapotnál.
    let next = this.index;
    if (median > 0.022) next = Math.min(Resolution.STEPS.length - 1, this.index + 1);
    else if (median < 0.013) next = Math.max(0, this.index - 1);

    if (next === this.index) return false;
    this.index = next;
    this.recent.length = 0;
    this.cooldown = 3;
    return true;
  }
}
