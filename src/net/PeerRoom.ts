import Peer, { type DataConnection } from 'peerjs';
import type { RoomPeer, RoomTransport } from './Room';

/**
 * Szoba Claude-fiók NÉLKÜL: két böngésző közvetlenül egymásnak.
 *
 * A kiadott artifact szobája csak azonos szervezetből engedi be a másikat —
 * egy külön Claude-fiókkal létrehozott „teszt felhasználó" nem tud
 * csatlakozni. Mérve: a vendég oldalán a szoba megnyílik, de a társ sosem
 * jelenik meg a peer-listában. Ezért a GitHub Pages-re kirakott változat NEM
 * a futtatókörnyezet csatornáját használja, hanem WebRTC-t: a két böngésző
 * egymással beszél, a nyilvános jelzőszerver csak összeismerteti őket.
 *
 * A KÓD a találkozási pont. Aki elsőnek foglalja le, az lesz a gazda; aki
 * másodiknak jön, annak a foglalás nem sikerül — és pont ebből tudja, hogy ő
 * a vendég. Így nincs szükség külön „szoba létrehozása" gombra: ugyanaz a
 * link mindkettőnek működik.
 *
 * A protokoll AZONOS a futtatókörnyezetével (jelenlét + pillanatok), tehát a
 * játék semmit nem tud arról, melyiken fut éppen.
 */

const BROKER_PREFIX = 'candypoc-';
/** Meddig várjunk a foglalásra, mielőtt feladjuk. Mérve: a nyilvános jelző 1-2 mp. */
const CLAIM_TIMEOUT = 9000;

type Wire =
  | { k: 'p'; presence: Record<string, unknown> }
  | { k: 'e'; topic: string; data?: unknown };

export interface PeerRoomHandle extends RoomTransport {
  /** A megosztandó kód. Ezzel talál ide a társ. */
  readonly code: string;
  /** Igaz, ha mi foglaltuk le a kódot. Csak a jelzéshez; a szerepet a NetSession dönti el. */
  readonly isOwner: boolean;
}

/** Négy betű: telefonba bediktálható, és 456 976 lehetőség bőven elég két embernek. */
export function makeCode(): string {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; // I és O kimarad: 1-gyel és 0-val keverhető
  let out = '';
  for (let i = 0; i < 4; i++) out += abc[Math.floor(Math.random() * abc.length)];
  return out;
}

/**
 * SZOBÁT NYIT ezzel a kóddal. `null`, ha a kód foglalt, vagy nem jött össze.
 *
 * A régi `openPeerRoom` egyetlen hívásban döntötte el, hogy gazda vagy vendég
 * lesz-e belőled: „foglald le, és ha nem sikerül, menj be hozzá". Kényelmes
 * volt, és pont ez volt a baja — SENKI nem választott. Aki elsőnek töltötte be
 * az oldalt, az lett a gazda, akkor is, ha csak nézelődött; aki másodiknak,
 * az bement egy idegen szobába, akkor is, ha ő akart újat kezdeni. A kettéosztás
 * innentől a JÁTÉKOSÉ: az indít, aki indítani akar.
 */
export async function hostPeerRoom(code: string): Promise<PeerRoomHandle | null> {
  const upper = code.toUpperCase();
  const owner = await claim(BROKER_PREFIX + upper);
  return owner ? new PeerLink(owner, upper, true) : null;
}

/**
 * BELÉP egy meglévő szobába. `null`, ha nincs ott senki ezzel a kóddal.
 *
 * És ezt MEG IS VÁRJA. A foglalás sikere ugyanis semmit nem mond a társról:
 * a saját vendég-azonosítónkat mindig le tudjuk foglalni, a hívás viszont
 * elhalhat némán, ha a gazda nincs ott. Aki így „belépett", az egy üres
 * szobában ült, miközben a képernyő azt írta, hogy minden rendben — ezért
 * a belépés csak akkor sikeres, ha a csatorna tényleg megnyílt.
 */
export async function joinPeerRoom(code: string): Promise<PeerRoomHandle | null> {
  const upper = code.toUpperCase();
  const guest = await claim(BROKER_PREFIX + upper + '-g' + makeCode().toLowerCase());
  if (!guest) return null;
  const link = new PeerLink(guest, upper, false, BROKER_PREFIX + upper);
  if (await link.megnyilt(CLAIM_TIMEOUT)) return link;
  link.dispose();
  return null;
}

/** Lefoglal egy azonosítót a jelzőszerveren. `null`, ha már foglalt vagy nem jött össze. */
function claim(id: string): Promise<Peer | null> {
  return new Promise((resolve) => {
    let settled = false;
    const peer = new Peer(id, { debug: 0 });
    const done = (value: Peer | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!value) peer.destroy();
      resolve(value);
    };
    const timer = setTimeout(() => done(null), CLAIM_TIMEOUT);
    peer.on('open', () => done(peer));
    // Minden hiba ugyanaz a válasz: nem a miénk. A hívó ebből tudja, hogy
    // vendég lesz — a hibakódot nem érdemes szétválogatni, mert a „foglalt"
    // és a „nem sikerült" ugyanoda vezet.
    peer.on('error', () => done(null));
  });
}

export class PeerLink implements PeerRoomHandle {
  private own: Record<string, unknown> = {};
  private theirs: Record<string, unknown> = {};
  private link: DataConnection | null = null;
  private theirId: string | null = null;
  private readonly peerHandlers: Array<(peers: readonly RoomPeer[]) => void> = [];
  private readonly topicHandlers = new Map<
    string,
    Array<(msg: { peer: string; isMe: boolean; data?: unknown }) => void>
  >();

  constructor(
    private readonly peer: Peer,
    readonly code: string,
    readonly isOwner: boolean,
    dial?: string
  ) {
    // A gazda vár, a vendég hív. A gazda akkor is fogad, ha a vendég
    // kilépett és visszajön — a szoba nem szűnik meg egy bontott hívástól.
    this.peer.on('connection', (conn) => this.adopt(conn));
    if (dial) this.adopt(this.peer.connect(dial, { reliable: true }));
  }

  /** Akik a csatorna megnyílására várnak. A belépés ebből tudja, sikerült-e. */
  private readonly varok: Array<(ok: boolean) => void> = [];
  private nyitva = false;

  /**
   * Megvárja, hogy a csatorna tényleg megnyíljon. `false`, ha `ms` alatt sem.
   */
  megnyilt(ms: number): Promise<boolean> {
    if (this.nyitva) return Promise.resolve(true);
    return new Promise((resolve) => {
      let kesz = false;
      const zar = (ok: boolean) => {
        if (kesz) return;
        kesz = true;
        clearTimeout(ido);
        resolve(ok);
      };
      const ido = setTimeout(() => zar(false), ms);
      this.varok.push(zar);
      // A jelző azonnal szól, ha nincs ott senki — nem kell kivárni az időt.
      this.peer.on('error', () => zar(false));
    });
  }

  private adopt(conn: DataConnection): void {
    this.link = conn;
    this.theirId = conn.peer;
    conn.on('open', () => {
      this.nyitva = true;
      for (const varo of this.varok.splice(0)) varo(true);
      // Az ÚJONNAN érkező a teljes jelenlétet kapja, nem a következő
      // változást: különben addig láthatatlan lenne a társ, amíg meg nem
      // mozdul.
      this.wire({ k: 'p', presence: this.own });
      this.announce();
    });
    conn.on('data', (raw) => this.receive(raw as Wire));
    const drop = () => {
      if (this.link !== conn) return;
      this.nyitva = false;
      this.link = null;
      this.theirId = null;
      this.theirs = {};
      this.announce();
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  private receive(msg: Wire): void {
    if (!msg || typeof msg !== 'object') return;
    if (msg.k === 'p') {
      this.theirs = { ...this.theirs, ...msg.presence };
      for (const key of Object.keys(msg.presence)) {
        if (msg.presence[key] === null) delete this.theirs[key];
      }
      this.announce();
      return;
    }
    if (msg.k === 'e' && this.theirId) {
      for (const handler of this.topicHandlers.get(msg.topic) ?? []) {
        handler({ peer: this.theirId, isMe: false, data: msg.data });
      }
    }
  }

  private wire(msg: Wire): void {
    if (this.link?.open) {
      try {
        this.link.send(msg);
      } catch {
        // Egy elveszett képkocka állapotát a következő úgyis felülírja.
      }
    }
  }

  private snapshot(): readonly RoomPeer[] {
    const me: RoomPeer = { peer: this.peer.id, isMe: true, kind: 'viewer', presence: this.own };
    if (!this.theirId) return [me];
    const them: RoomPeer = { peer: this.theirId, isMe: false, kind: 'viewer', presence: this.theirs };
    return [me, them];
  }

  /** Fut-e épp az értesítés. Lásd a metódus fölötti magyarázatot. */
  private bejelent = false;
  private ujraKell = false;

  /**
   * ÉRTESÍTÉS, AMI NEM TUD ÖNMAGÁBA ESNI.
   *
   * A figyelők közül bármelyik kitehet jelenlétet — a késésmérő pontosan
   * ezt teszi —, a jelenlét kitétele pedig újabb értesítést szül. Ebből
   * végtelen mélységű hívás lett, és a hívási verem betelt: a játék
   * lefagyott abban a pillanatban, amikor a társ csatlakozott.
   *
   * A mérés helye a `Latency`, és ott is javítottam. Ez itt a KERÍTÉS: ha
   * egy későbbi figyelő megint ilyet csinál, ne a verem álljon meg, hanem
   * fusson le még egyszer az értesítés, és legyen vége.
   */
  private announce(): void {
    if (this.bejelent) {
      this.ujraKell = true;
      return;
    }
    this.bejelent = true;
    try {
      do {
        this.ujraKell = false;
        const list = this.snapshot();
        for (const handler of this.peerHandlers) handler(list);
      } while (this.ujraKell);
    } finally {
      this.bejelent = false;
    }
  }

  peers(): readonly RoomPeer[] {
    return this.snapshot();
  }

  onPeers(handler: (peers: readonly RoomPeer[]) => void): () => void {
    this.peerHandlers.push(handler);
    handler(this.snapshot());
    return () => {
      const i = this.peerHandlers.indexOf(handler);
      if (i >= 0) this.peerHandlers.splice(i, 1);
    };
  }

  presence(patch: Record<string, unknown>): void {
    this.own = { ...this.own, ...patch };
    for (const key of Object.keys(patch)) {
      if (patch[key] === null) delete this.own[key];
    }
    this.wire({ k: 'p', presence: patch });
    this.announce();
  }

  emit(topic: string, data?: unknown): void {
    this.wire({ k: 'e', topic, data });
    // A saját üzenetet magunk is megkapjuk, ahogy a futtatókörnyezet
    // szobájában — különben a chat nem mutatná, amit ÉN írtam.
    for (const handler of this.topicHandlers.get(topic) ?? []) {
      handler({ peer: this.peer.id, isMe: true, data });
    }
  }

  on(topic: string, handler: (msg: { peer: string; isMe: boolean; data?: unknown }) => void): () => void {
    const list = this.topicHandlers.get(topic) ?? [];
    list.push(handler);
    this.topicHandlers.set(topic, list);
    return () => {
      const i = list.indexOf(handler);
      if (i >= 0) list.splice(i, 1);
    };
  }

  connected(): boolean {
    return !this.peer.destroyed;
  }

  dispose(): void {
    this.peer.destroy();
  }
}
