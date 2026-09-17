import { Loopback } from '../src/net/Room';
import { NetSession } from '../src/net/NetSession';
import * as THREE from 'three';
import { HouseLink } from '../src/net/HouseLink';
import type { PlayerInput } from '../src/input/InputManager';

const QUIET: PlayerInput = {
  moveX: 0, moveY: 0, jump: false, jumpHeld: false,
  interact: false, interactHeld: false, sprint: false, usingGamepad: false, pause: false,
};

/* eslint-disable @typescript-eslint/no-explicit-any */
function stubPlayer(index: number): any {
  return { index, position: new THREE.Vector3(), mesh: { position: new THREE.Vector3(), rotation: { y: 0 } } };
}
function stubHomeowner(): any {
  return { position: new THREE.Vector3(), group: { position: new THREE.Vector3(), rotation: { y: 0 } }, state: 'PATROL' };
}
function stubWorld(): any {
  return { candySpots: [] };
}
function stubGame(): any {
  return { stats: { escaped: false, candy: 0 } };
}

/**
 * Külön eszközről ugyanaz a játék — a protokoll próbája.
 *
 * A valódi csatorna CSAK a kiadott oldalon létezik: fejlesztői szerveren
 * nincs, tehát ott egyetlen sort sem lehetne kipróbálni belőle. Ez a próba
 * ezért nem a csatornát méri, hanem azt, ami a legkönnyebben romlik el és a
 * legdrágábban derül ki: ki lesz a gazda, ki melyik szörnyet kapja, és mi
 * történik, ha valaki kilép vagy visszajön.
 *
 * A kulcs, amiért ez egyáltalán mérhető: mindhárom kérdésre a két eszköz
 * FÜGGETLENÜL válaszol, üzenetváltás nélkül — a peer-azonosítók sorrendjéből.
 * Ha megegyezniük kellene róla, maga a megegyezés is elveszhetne.
 *
 * Futtatás: npm run probe:net
 */
function line(label: string, pass: boolean, detail: string): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(44)} ${detail}`);
  return pass;
}

let ok = true;

// --- 1. Egyedül: gazda, és tudja, hogy nincs társ ---------------------------
{
  const room = new Loopback();
  const a = new NetSession(room.join('m2'), 'dev-m2');
  ok = line('egyedül gazda, de nincs párja', a.current.role === 'host' && !a.current.paired,
    `szerep ${a.current.role}, párban: ${a.current.paired}`) && ok;
}

// --- 2. Ketten: a kisebb azonosító a gazda, MINDKÉT gépen ugyanúgy ----------
{
  const room = new Loopback();
  const later = new NetSession(room.join('m9'), 'dev-m9');
  const earlier = new NetSession(room.join('m2'), 'dev-m2');

  const agree =
    earlier.current.role === 'host' &&
    later.current.role === 'guest' &&
    earlier.current.playerIndex === 0 &&
    later.current.playerIndex === 1;

  ok = line('a két eszköz ugyanazt gondolja a szerepekről', agree,
    `m2: ${earlier.current.role}/${earlier.current.playerIndex}, m9: ${later.current.role}/${later.current.playerIndex}`) && ok;

  ok = line('mindketten tudják, hogy párban vannak',
    earlier.current.paired && later.current.paired,
    `${earlier.current.count} fő`) && ok;
}

// --- 3. A csatlakozás SORRENDJE nem számít ----------------------------------
{
  // Ugyanaz a két azonosító, fordított belépési sorrend: a szerepeknek
  // ugyanannak kell lenniük. Ha nem, akkor a szerep attól függne, ki
  // kattintott előbb — és két gép ezt sosem látja egyformán.
  const room = new Loopback();
  const first = new NetSession(room.join('m2'), 'dev-m2');
  const second = new NetSession(room.join('m9'), 'dev-m9');
  ok = line('a belépési sorrend nem befolyásolja a szerepeket',
    first.current.role === 'host' && second.current.role === 'guest',
    `m2 ${first.current.role}, m9 ${second.current.role}`) && ok;
}

// --- 4. Ha a gazda kilép, a másik veszi át ----------------------------------
{
  const room = new Loopback();
  room.join('m2');
  const guest = new NetSession(room.join('m9'), 'dev-m9');
  const before = guest.current.role;
  room.leave('m2');
  const after = guest.current.role;
  ok = line('a gazda kilépésekor a másik átveszi', before === 'guest' && after === 'host',
    `${before} → ${after}`) && ok;
}

// --- 5. Harmadik néző nem veszi el a szerepet -------------------------------
{
  const room = new Loopback();
  const host = new NetSession(room.join('m1'), 'dev-m1');
  const guest = new NetSession(room.join('m5'), 'dev-m5');
  const watcher = new NetSession(room.join('m9'), 'dev-m9');
  ok = line('a harmadik néző nem lesz játékos',
    host.current.paired && guest.current.paired && !watcher.current.paired,
    `${watcher.current.count} fő, a néző párban: ${watcher.current.paired}`) && ok;
}

// --- 6. Csatorna nélkül is működik ------------------------------------------
{
  // A kiadott oldalon kívül — vagy ha a nézet nem tud csatlakozni — nincs
  // szoba. A játéknak ilyenkor is el kell indulnia, egy gépen.
  const alone = new NetSession(null);
  ok = line('csatorna nélkül is elindul, egy gépen',
    alone.current.role === 'host' && !alone.current.paired && !alone.current.online,
    'a szoba hiánya nem hiba, hanem az alapeset') && ok;
}


// --- 7. A ház két gépen: a HouseLink ----------------------------------------
{
  // Amit itt mérni érdemes, az nem a „megjött-e a csomag" — a hurok-átvitel
  // úgyis mindent kézbesít. Hanem a három döntés, ami a valódi hálózaton a
  // legdrágábban derülne ki:
  //
  //   · a vendég gépe a TÁRS szörnyét mozgatja a kapott helyre, nem a sajátját;
  //   · a HASZNÁLAT gomb FELFUTÓ ÉLE a lenyomva-tartás változásából jön, és
  //     pontosan egyszer szól — ha eseményként küldenénk, egy elveszett
  //     csomag egy elmaradt cukorka lenne;
  //   · a lakó helyét CSAK a gazda írja; a vendég soha.
  const room = new Loopback();
  const hostRoom = room.join('a-host');
  const guestRoom = room.join('b-guest');

  const hostLink = new HouseLink(hostRoom, true, 0);
  const guestLink = new HouseLink(guestRoom, false, 1);

  const players = () => [stubPlayer(0), stubPlayer(1)];
  const hostPlayers = players();
  const guestPlayers = players();
  const homeowner = stubHomeowner();
  const world = stubWorld();
  const game = stubGame();

  // A vendég odaáll valahova, és lenyomja a HASZNÁLAT gombot.
  guestPlayers[1].position.set(12, 0, -7);
  for (let i = 0; i < 40; i++) {
    guestLink.publish(
      guestPlayers,
      { ...QUIET, interactHeld: true },
      homeowner,
      world,
      game,
      { name: 'VENDÉG', character: 'ghost' }
    );
    hostLink.apply(hostRoom.peers(), hostPlayers, homeowner, world, game);
  }

  const moved = hostPlayers[1].position.distanceTo(guestPlayers[1].position) < 1;
  const untouched = hostPlayers[0].position.length() === 0;
  ok = line('a gazda a TÁRS szörnyét mozgatja', moved && untouched,
    `a társ odaért, a sajátunk maradt (${hostPlayers[0].position.length().toFixed(2)})`) && ok;

  // A felfutó él: negyven csomagnyi nyomva tartás EGY lenyomás.
  const edges = hostLink.source({ get: () => QUIET }).get(1);
  ok = line('a nyomva tartás egyszer szól', !edges.interact && edges.interactHeld,
    'a negyvenedik csomag már nem él, csak tartás') && ok;

  // Elengedés után újra nyomható.
  guestLink.publish(guestPlayers, { ...QUIET, interactHeld: false }, homeowner, world, game,
    { name: 'VENDÉG', character: 'ghost' });
  hostLink.apply(hostRoom.peers(), hostPlayers, homeowner, world, game);
  guestLink.publish(guestPlayers, { ...QUIET, interactHeld: true }, homeowner, world, game,
    { name: 'VENDÉG', character: 'ghost' });
  hostLink.apply(hostRoom.peers(), hostPlayers, homeowner, world, game);
  ok = line('elengedés után újra szól', hostLink.source({ get: () => QUIET }).get(1).interact,
    'a második lenyomás megjött') && ok;

  // A neve és a karaktere is átjön — enélkül mindkét képernyőn az
  // alapértelmezett második szörny szaladgálna, más néven.
  ok = line('a társ neve és karaktere átjön',
    hostLink.remoteName === 'VENDÉG' && hostLink.remoteCharacter === 'ghost',
    `${hostLink.remoteName} / ${hostLink.remoteCharacter}`) && ok;

  // A lakót csak a gazda írja: a vendég kiadványában nincs is benne.
  const guestPresence = guestRoom.peers().find((p) => p.isMe)?.presence as Record<string, unknown>;
  ok = line('a lakót csak a gazda teszi ki', guestPresence?.ho === undefined,
    'a vendég jelenlétében nincs lakó — nem is lehetne két zseblámpa') && ok;
}

console.log('');
{
  // EGY ESZKÖZ = EGY JÁTÉKOS, akkor is, ha valaki két fülön nyitja meg.
  //
  // Ez élesben elő is jött: a HUD azt írta, „2 eszköz · te vagy a 2. szörny",
  // és onnantól a billentyűzet a navigátort mozgatta, nem a kocsit. Két fül
  // két peer, tehát a peer-azonosító önmagában nem elég — a készülék kell.
  const room = new Loopback();
  const tabA = new NetSession(room.join('m2'), 'ugyanaz-a-gep');
  const tabB = new NetSession(room.join('m9'), 'ugyanaz-a-gep');

  ok = line(
    'egy eszköz két füle nem lesz két játékos',
    !tabA.current.paired && !tabB.current.paired && tabA.current.count === 1,
    `az első fül: ${tabA.current.count} fő, párban: ${tabA.current.paired}; a második: párban ${tabB.current.paired}`
  ) && ok;

  // ...és a második fül nem veszi el a valódi társ helyét: ha egy MÁSIK gép
  // belép, ő lesz a 2. szörny.
  const other = new NetSession(room.join('m5'), 'masik-gep');
  ok = line(
    'a valódi társ kapja a második helyet',
    tabA.current.paired && other.current.paired && other.current.playerIndex === 1,
    `a másik gép sorszáma ${other.current.playerIndex}, a fülek: ${tabA.current.playerIndex}/${tabB.current.playerIndex}`
  ) && ok;
}

console.log(ok ? 'MIND OK — a hálózati protokoll stabil' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
