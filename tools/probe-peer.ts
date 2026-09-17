import { PeerLink, makeCode } from '../src/net/PeerRoom';
import { NetSession } from '../src/net/NetSession';

/**
 * A fiók nélküli szoba próbája.
 *
 * Miért kell: a 2 fős mód eddig a futtatókörnyezet szobáján ment, az pedig
 * CSAK azonos Claude-szervezetből engedi be a társat — egy külön fiókkal
 * létrehozott teszt felhasználó némán kimaradt. A pótlás WebRTC, de azt egy
 * fejetlen próbában nem lehet felhívni: nincs böngésző, nincs jelzőszerver.
 *
 * Amit viszont MÉRNI lehet — és ami a legkönnyebben romlik el —, az a
 * protokoll a kapcsolat FELETT: átmegy-e a jelenlét, megkapja-e az újonnan
 * érkező a már meglévő állapotot, visszakapja-e a saját üzenetét a küldő
 * (enélkül a chat nem mutatná, amit én írtam), és ugyanazt a gazda/vendég
 * szerepet adja-e a két gép, mint a futtatókörnyezet szobája.
 *
 * Ezért a kapcsolat helyére egy huzal kerül: ugyanazok a hívások, csak a
 * hálózat nélkül.
 */

let ok = true;
function line(name: string, pass: boolean, detail = ''): boolean {
  console.log(`${pass ? 'OK   ' : 'BUKO '} ${name}${detail ? ' — ' + detail : ''}`);
  if (!pass) ok = false;
  return pass;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Egy adatkapcsolat két vége, hálózat nélkül. */
function wirePair(idA: string, idB: string) {
  const handlers = (o: any) => o.h as Map<string, Function[]>;
  const make = (peer: string) => {
    const conn: any = {
      peer,
      open: false,
      h: new Map<string, Function[]>(),
      on(ev: string, cb: Function) {
        const list = handlers(conn).get(ev) ?? [];
        list.push(cb);
        handlers(conn).set(ev, list);
      },
      fire(ev: string, arg?: unknown) {
        for (const cb of handlers(conn).get(ev) ?? []) cb(arg);
      },
      send(msg: unknown) {
        conn.other.fire('data', JSON.parse(JSON.stringify(msg)));
      },
    };
    return conn;
  };
  const a = make(idB); // A oldalán a kapcsolat a MÁSIK felet nevezi meg
  const b = make(idA);
  a.other = b;
  b.other = a;
  return { a, b };
}

function fakePeer(id: string) {
  const peer: any = { id, destroyed: false, h: new Map<string, Function[]>() };
  peer.on = (ev: string, cb: Function) => {
    const list = peer.h.get(ev) ?? [];
    list.push(cb);
    peer.h.set(ev, list);
  };
  peer.fire = (ev: string, arg?: unknown) => {
    for (const cb of peer.h.get(ev) ?? []) cb(arg);
  };
  peer.destroy = () => (peer.destroyed = true);
  return peer;
}

// A gazda a kódot foglalja le, a vendég azonosítója abból nő ki — így a
// SORREND (amiből a szerep lesz) betűrendben is a gazdát hozza előre.
const code = 'ABCD';
const hostId = 'candypoc-' + code;
const guestId = 'candypoc-' + code + '-g' + makeCode().toLowerCase();

const hostPeer = fakePeer(hostId);
const guestPeer = fakePeer(guestId);
const host = new PeerLink(hostPeer as any, code, true);
const guest = new PeerLink(guestPeer as any, code, false);

line('a gazda kódja betűrendben előrébb van', hostId < guestId, `${hostId} < ${guestId}`);

// A gazda még egyedül van.
line('társ nélkül egy peer látszik', host.peers().length === 1, `${host.peers().length}`);

// A gazda kitesz magáról valamit, MIELŐTT a vendég megérkezne. Ez a tipikus
// sorrend: a szobát nyitó ember már a menüben áll, amikor a másik rákattint.
host.presence({ dev: 'gep-A', name: 'BALÁZS' });

// Most bekötjük a kapcsolatot mindkét oldalon.
const { a, b } = wirePair(hostId, guestId);
(hostPeer as any).fire('connection', a);
(guestPeer as any).fire('connection', b);
a.open = true;
b.open = true;
a.fire('open');
b.fire('open');

line('mindkét oldal két peert lát', host.peers().length === 2 && guest.peers().length === 2,
  `gazda ${host.peers().length}, vendég ${guest.peers().length}`);

const seen = guest.peers().find((p) => !p.isMe)?.presence as Record<string, unknown> | undefined;
line('az érkező megkapja a MÁR kitett jelenlétet', seen?.name === 'BALÁZS', JSON.stringify(seen));

// Jelenlét a másik irányba is.
guest.presence({ dev: 'gep-B', name: 'TESZT' });
const back = host.peers().find((p) => !p.isMe)?.presence as Record<string, unknown> | undefined;
line('a jelenlét visszafelé is átmegy', back?.name === 'TESZT', JSON.stringify(back));

// Pillanatok: a chat mindkét oldalon látszik, a KÜLDŐÉ is.
const atGuest: string[] = [];
const atHost: string[] = [];
guest.on('chat', (m) => atGuest.push(`${m.isMe ? 'en' : 'tars'}:${String(m.data)}`));
host.on('chat', (m) => atHost.push(`${m.isMe ? 'en' : 'tars'}:${String(m.data)}`));
host.emit('chat', 'szia');
line('a küldő is látja a saját üzenetét', atHost.join() === 'en:szia', atHost.join());
line('a társ is megkapja', atGuest.join() === 'tars:szia', atGuest.join());

// A szerep: ugyanaz, mint a futtatókörnyezet szobájánál — a kisebb
// azonosító a gazda, és egy eszköz egy játékos.
const sessionHost = new NetSession(host, 'gep-A');
const sessionGuest = new NetSession(guest, 'gep-B');
line('a gazda gazda, a vendég vendég',
  sessionHost.current.role === 'host' && sessionGuest.current.role === 'guest',
  `${sessionHost.current.role} / ${sessionGuest.current.role}`);
line('mindkettő párban van és külön szörnyet kap',
  sessionHost.current.paired && sessionGuest.current.paired &&
  sessionHost.current.playerIndex === 0 && sessionGuest.current.playerIndex === 1,
  `${sessionHost.current.playerIndex} / ${sessionGuest.current.playerIndex}`);

// Kilépés: a szoba nem szűnik meg, csak egyedül maradunk — és a jelenléte
// is eltűnik, különben egy kilépett társ örökre „ott ülne".
a.fire('close');
line('kilépés után egyedül maradunk', host.peers().length === 1, `${host.peers().length}`);
line('a kilépett társ jelenléte nem ragad be',
  host.peers().every((p) => p.isMe), '');

console.log(ok ? 'MIND OK — a fiók nélküli szoba protokollja áll' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
