import type { RoomTransport } from './Room';

/**
 * Mennyi idő alatt ér át egy állapot a másik gépre.
 *
 * Miért kell, és miért MOST: a PvP üldözésben a koccanás pillanata dönt. Ha
 * a késés nagy, a fogó azt látja, hogy eltalálta, a szökevény azt, hogy nem —
 * és ilyenkor nem az a kérdés, melyiknek van igaza, hanem hogy a szabályt
 * KINÉL döntjük el. Ez a döntés viszont egy számon áll, nem véleményen.
 *
 * A mérés azon a csatornán megy, amin az AUTÓK is: a jelenléten. Nem külön
 * eseménytémán — az egy másik út, más ütemezéssel, és akkor nem azt mérnénk,
 * ami a játékot érinti. A jelenlét ~30-szor megy ki másodpercenként
 * összevontan, tehát a mérésben benne van ez a szemcsézettség is. Ez nem
 * hiba: a játékos is ezt kapja.
 *
 * A protokoll a lehető legegyszerűbb, mert a bonyolult protokoll maga is
 * mérési hiba: aki kérdez, kiteszi a saját óraállását (`ping`); a másik ezt
 * változtatás nélkül visszatükrözi (`echo`). A kérdező így SAJÁT órával mér
 * körbe-vissza időt, és nem kell a két gép óráját összehangolni — ez az a
 * lépés, ami minden naiv késésmérésben elromlik.
 */
export class Latency {
  /** Az utolsó mért körbe-vissza idő, milliszekundumban. `null`, amíg nincs. */
  last: number | null = null;
  /** A legutóbbi tíz mérés mediánja — ezt érdemes kiírni, nem a pillanatnyit. */
  median: number | null = null;
  /** A legnagyobb mért érték. Egy üldözésben a legrosszabb eset a fontos. */
  worst: number | null = null;

  private readonly samples: number[] = [];
  private since = 0;
  private sent = 0;
  /** Az utolsó kérdés, amit már visszatükröztünk. Ez zárja be a hurkot. */
  private echoed = 0;
  private stop: (() => void) | null = null;

  constructor(private readonly room: RoomTransport) {
    this.stop = room.onPeers((peers) => {
      for (const peer of peers) {
        if (peer.isMe) continue;
        const echo = (peer.presence as { echo?: unknown }).echo;
        // TÜKRÖZÉS: bárki jelenléte átjöhet, ezért csak a saját, épp kint
        // lévő bélyegünket fogadjuk el válasznak. Enélkül egy régi vagy
        // idegen szám is „mérésnek" számítana.
        if (typeof echo === 'number' && echo === this.sent && this.sent !== 0) {
          this.take(performance.now() - this.sent);
          this.sent = 0;
        }
        // ...és amit tőle kaptunk kérdésként, azt visszatükrözzük — DE
        // MINDEN KÉRDÉST CSAK EGYSZER.
        //
        // EZ VOLT A LEFAGYÁS. A jelenlét kitétele értesíti a jelenlét
        // figyelőit — köztük ezt itt —, és a társ kérdése ilyenkor még
        // mindig ott áll a jelenlétében. Tehát: tükrözünk, amitől értesítés
        // lesz, amitől megint tükrözünk, amitől megint értesítés… mérve
        // `RangeError: Maximum call stack size exceeded`, és a menü
        // képkocka-hurka ezen a ponton MEGÁLL. Kívülről pontosan annyi
        // látszott belőle, hogy „lefagy, ha a társam csatlakozik".
        //
        // A kilépési feltétel egyetlen szám: amit már megválaszoltunk, arra
        // nem válaszolunk újra.
        const ping = (peer.presence as { ping?: unknown }).ping;
        if (typeof ping === 'number' && ping !== this.echoed) {
          this.echoed = ping;
          this.room.presence({ echo: ping });
        }
      }
    });
  }

  /** Képkockánként hívható; másodpercenként egyszer kérdez. */
  update(dt: number): void {
    this.since += dt;
    if (this.since < 1) return;
    this.since = 0;
    this.sent = performance.now();
    this.room.presence({ ping: this.sent });
  }

  private take(ms: number): void {
    this.last = ms;
    this.worst = this.worst === null ? ms : Math.max(this.worst, ms);
    this.samples.push(ms);
    if (this.samples.length > 10) this.samples.shift();
    const sorted = [...this.samples].sort((a, b) => a - b);
    this.median = sorted[Math.floor(sorted.length / 2)];
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
  }
}
