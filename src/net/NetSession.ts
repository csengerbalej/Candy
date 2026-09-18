import type { RoomPeer, RoomTransport } from './Room';
import { deviceId } from './Device';

/**
 * Ki kicsoda, ha ketten külön eszközről játsszák ugyanazt.
 *
 * Három kérdésre kell válaszolni, és mindháromra ÚGY, hogy a két eszköz
 * egymástól függetlenül ugyanazt a választ adja — üzenetváltás nélkül,
 * különben a válasz maga is elveszhet:
 *
 *   1. Ki a GAZDA? Az, akinek a legkisebb a peer-azonosítója. Ez minden
 *      gépen ugyanaz a sorrend, tehát nem kell megegyezni róla.
 *   2. Ki melyik szörnyet irányítja? A gazda a 0., a másik az 1. Ugyanaz a
 *      sorrend, ugyanaz az eredmény.
 *   3. Ki szimulálja a világot? A gazda. A vendég a saját bemenetét küldi és
 *      a kapott állapotot rajzolja — így nincs két, egymástól elcsúszó
 *      valóság, és nem kell eldönteni, melyiknek van igaza.
 *
 * A gazdaság ÁTSZÁLL, ha a gazda kilép: a maradék legkisebb azonosító veszi
 * át. Ez a legolcsóbb, ami nem hagyja állva a játékot.
 */

export type NetRole = 'host' | 'guest';

export interface NetState {
  /** Csatlakozva vagyunk-e egyáltalán egy szobához. */
  online: boolean;
  /** Hányan vannak most itt (magunkat is beleértve). */
  count: number;
  /** A saját szerepünk, ha van társ. Egyedül mindig gazda. */
  role: NetRole;
  /** Melyik szörny a miénk: 0 vagy 1. */
  playerIndex: 0 | 1;
  /** Van-e társ, akivel játszani lehet. */
  paired: boolean;
}

/** Csak az emberek számítanak; a kiadó munkamenet megfigyelőként is bejöhet. */
function viewers(peers: readonly RoomPeer[]): RoomPeer[] {
  return peers.filter((p) => p.kind === 'viewer');
}

export class NetSession {
  private state: NetState = {
    online: false,
    count: 1,
    role: 'host',
    playerIndex: 0,
    paired: false,
  };

  private readonly listeners: Array<(state: NetState) => void> = [];
  private stop: (() => void) | null = null;

  /**
   * @param device Melyik KÉSZÜLÉKRŐL jövünk. Alapból a böngésző sajátja; a
   * mérések adják meg kézzel, mert ott több „gép" fut egy folyamatban, és
   * ott a böngésző-azonosító mindegyiknél ugyanaz lenne.
   */
  constructor(room: RoomTransport | null, private readonly device: string = deviceId()) {
    if (!room) return;
    // Megmondjuk, MELYIK KÉSZÜLÉKRŐL jöttünk. Enélkül ugyanannak a gépnek a
    // két megnyitott lapja két játékosnak látszik, és a második lap elveszi a
    // társ helyét — pont azt a „ketten egy eszközről" állapotot hozza vissza,
    // amit kivezettünk.
    room.presence({ dev: this.device });
    this.stop = room.onPeers((peers) => this.recompute(peers));
    this.recompute(room.peers());
  }

  get current(): NetState {
    return this.state;
  }

  /**
   * KÖZÖS MAG a sorsoláshoz.
   *
   * A fogó pályája sorsolással születik (hol a két sarok, hova kerülnek a
   * fegyverek), és két gépen ugyanannak kell kijönnie — különben a társad
   * más házban játszik, mint te. A mag a résztvevők azonosítójából jön,
   * RENDEZVE: ugyanaz a lista, ugyanaz a sorrend, ugyanaz a szöveg mindkét
   * gépen, üzenetváltás nélkül.
   *
   * Egyedül üres — ott a `Math.random` a helyes válasz, mert minden kör
   * legyen más.
   */
  get seed(): string {
    return this.order.join('|');
  }

  /** A helyek sorrendje; a mag ebből jön. */
  private order: string[] = [];

  onChange(handler: (state: NetState) => void): () => void {
    this.listeners.push(handler);
    handler(this.state);
    return () => {
      const i = this.listeners.indexOf(handler);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  dispose(): void {
    this.stop?.();
    this.stop = null;
    this.listeners.length = 0;
  }

  private recompute(peers: readonly RoomPeer[]): void {
    const people = viewers(peers);
    const me = people.find((p) => p.isMe);
    // A sorrend a peer-azonosítóé: minden gépen ugyanaz, tehát nem kell
    // megállapodni benne.
    // EGY ESZKÖZ = EGY JÁTÉKOS. A sorrend a peer-azonosítóé (minden gépen
    // ugyanaz), de készülékenként csak az ELSŐ lap kap helyet; a többi néző.
    // A jelenlét késhet: amíg egy peer nem mondta meg a készülékét, a saját
    // peer-azonosítója a készüléke — vagyis külön játékosnak számít, és nem
    // esik ki tévedésből.
    const sorted = [...people].sort((a, b) => (a.peer < b.peer ? -1 : 1));
    const claimed = new Set<string>();
    const order: string[] = [];
    for (const p of sorted) {
      const dev = typeof p.presence?.dev === 'string' ? p.presence.dev : p.peer;
      if (claimed.has(dev)) continue;
      claimed.add(dev);
      order.push(p.peer);
    }
    this.order = order;
    const index = me ? order.indexOf(me.peer) : 0;

    // Kettőnél többen is benézhetnek; a játék kétfős, tehát csak az első
    // kettő játszik, a többi néző.
    const playing = index >= 0 && index < 2;
    const next: NetState = {
      online: people.length > 0,
      // A JÁTÉKOSOK száma, nem a lapoké: két fül egy gépről egy ember.
      count: order.length,
      role: index === 0 ? 'host' : 'guest',
      playerIndex: playing && index === 1 ? 1 : 0,
      paired: order.length >= 2 && playing,
    };

    if (
      next.online === this.state.online &&
      next.count === this.state.count &&
      next.role === this.state.role &&
      next.playerIndex === this.state.playerIndex &&
      next.paired === this.state.paired
    ) {
      return;
    }
    this.state = next;
    for (const handler of this.listeners) handler(next);
  }
}

/**
 * A témák, amiken a két eszköz beszél.
 *
 * Mind meg kell nyitni az „interact" szintre a kiadáskor, különben csak az
 * tud küldeni rajtuk, aki szerkesztheti az oldalt — a vendég viszont
 * jellemzően csak nézheti. Ha ez kimarad, a vendég gombjai csendben
 * eltűnnek: az üzenet el sem indul.
 */
export const TOPICS = {
  /** A navigátor igéi: célpont, irányjelzés, radar. */
  verb: 'verb',
  /** Kiszállás a kocsiból, felvett cukorka, elsütött csíny. */
  act: 'act',
  /**
   * A két játékos üzenetei.
   *
   * PILLANAT, nem állapot: ha egy üzenet elveszik, nem baj — semmilyen
   * szabály nem függ tőle. Ezért `emit`, nem jelenlét.
   */
  chat: 'chat',
} as const;
