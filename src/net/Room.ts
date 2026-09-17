/**
 * A szoba: aki épp nyitva tartja ugyanezt az oldalt.
 *
 * A kiadott oldal kap egy valós idejű csatornát a futtatókörnyezettől. Két
 * karja van, és a kettő NEM cserélhető fel:
 *
 *   presence — a SAJÁT állapotod, abszolút értékkel, másodpercenként ~30-szor
 *              összevonva elküldve. Ide megy minden, ami folyamatosan
 *              változik: hol áll az autó, merre néz, hol vannak a szörnyek.
 *              Az újonnan érkező is megkapja, és távozáskor magától eltűnik.
 *
 *   emit/on  — pillanatok. Nem tárolódik, nem játszódik le újra, és el is
 *              veszhet. Ide megy az, ami MEGTÖRTÉNIK: felvették a cukorkát,
 *              elsült a csíny, kiszálltak a kocsiból.
 *
 * Amit ebből a játéknak tudnia kell: mivel az esemény elveszhet, semmilyen
 * SZÁMLÁLÓT nem szabad eseményekből összerakni. Aki a világot szimulálja, az
 * a teljes állapotot is kiteszi presence-be — az esemény csak siettet.
 */

export interface RoomPeer {
  /** Egy megnyitott oldal azonosítója. Két fül ugyanattól az embertől: két peer. */
  peer: string;
  isMe: boolean;
  kind: 'viewer' | 'agent';
  presence: Readonly<Record<string, unknown>>;
}

/**
 * Amit a játék a csatornától vár.
 *
 * Azért interfész, és nem közvetlen hívások, mert a valódi csatorna CSAK a
 * kiadott oldalon létezik — fejlesztői szerveren nincs, tehát a protokollt
 * ott nem lehetne kipróbálni. Egy hurok-átvitellel viszont fejetlen próbában
 * is végigjátszható, és pont az a rész lesz mérhető, ami a legkönnyebben
 * romlik el: ki a gazda, ki melyik szörny, mi történik újracsatlakozáskor.
 */
export interface RoomTransport {
  peers(): readonly RoomPeer[];
  onPeers(handler: (peers: readonly RoomPeer[]) => void): () => void;
  presence(patch: Record<string, unknown>): void;
  emit(topic: string, data?: unknown): void;
  on(topic: string, handler: (msg: { peer: string; isMe: boolean; data?: unknown }) => void): () => void;
  connected(): boolean;
}

/** A futtatókörnyezet csatornája, ha van. `null`, ha ez a nézet nem tud csatlakozni. */
export async function openRoom(): Promise<RoomTransport | null> {
  const claude = (globalThis as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (!claude?.use) return null;
  const room = (await claude.use('room')) as {
    peers(): readonly RoomPeer[];
    onPeers(h: (c: { peers: readonly RoomPeer[] }) => void, e?: (x: unknown) => void): () => void;
    presence(p: Record<string, unknown>): Promise<void>;
    emit(t: string, d?: unknown): Promise<void>;
    on(t: string, h: (m: { peer: string; isMe: boolean; data?: unknown }) => void, e?: (x: unknown) => void): () => void;
    connected(): boolean;
  } | null;
  if (!room) return null;

  return {
    peers: () => room.peers(),
    onPeers: (handler) => room.onPeers((change) => handler(change.peers)),
    // A hívások ígéretet adnak vissza, de a játékhurok nem vár rájuk: egy
    // elveszett képkockányi állapotot a következő úgyis felülír.
    presence: (patch) => void room.presence(patch).catch(() => {}),
    emit: (topic, data) => void room.emit(topic, data).catch(() => {}),
    on: (topic, handler) => room.on(topic, handler),
    connected: () => room.connected(),
  };
}

/**
 * Két „eszköz" egy folyamaton belül, próbához.
 *
 * Nem utánozza a késleltetést és nem dob el üzenetet — nem is ez a dolga. Azt
 * méri, hogy a PROTOKOLL helyes-e: ki lesz a gazda, ki melyik szörnyet
 * irányítja, és mi történik, ha valaki kilép vagy visszajön.
 */
export class Loopback {
  private readonly members: LoopbackPeer[] = [];

  join(peer: string): RoomTransport {
    const member = new LoopbackPeer(peer, this);
    this.members.push(member);
    this.announce();
    return member;
  }

  leave(peer: string): void {
    const index = this.members.findIndex((m) => m.id === peer);
    if (index >= 0) this.members.splice(index, 1);
    this.announce();
  }

  send(topic: string, from: string, data?: unknown): void {
    for (const member of this.members) member.receive(topic, from, data);
  }

  announce(): void {
    for (const member of this.members) member.refresh(this.members);
  }
}

class LoopbackPeer implements RoomTransport {
  private own: Record<string, unknown> = {};
  private readonly peerHandlers: Array<(peers: readonly RoomPeer[]) => void> = [];
  private readonly topicHandlers = new Map<
    string,
    Array<(msg: { peer: string; isMe: boolean; data?: unknown }) => void>
  >();

  constructor(
    readonly id: string,
    private readonly room: Loopback
  ) {}

  peers(): readonly RoomPeer[] {
    return this.snapshot;
  }

  private snapshot: readonly RoomPeer[] = [];

  refresh(members: LoopbackPeer[]): void {
    this.snapshot = members.map((m) => ({
      peer: m.id,
      isMe: m.id === this.id,
      kind: 'viewer' as const,
      presence: m.own,
    }));
    for (const handler of this.peerHandlers) handler(this.snapshot);
  }

  onPeers(handler: (peers: readonly RoomPeer[]) => void): () => void {
    this.peerHandlers.push(handler);
    handler(this.snapshot);
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
    this.room.announce();
  }

  emit(topic: string, data?: unknown): void {
    this.room.send(topic, this.id, data);
  }

  receive(topic: string, from: string, data?: unknown): void {
    for (const handler of this.topicHandlers.get(topic) ?? []) {
      handler({ peer: from, isMe: from === this.id, data });
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
    return true;
  }
}
