import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { PlayerController } from '../src/player/PlayerController';
import { PITCH_MAX, PITCH_MIN, resetStage, stage, tiltStage, turnStage } from '../src/camera/Stage';
import { InputManager } from '../src/input/InputManager';
import { retarget } from '../src/render/CharacterRig';

/**
 * Headless probe for the edge-latch (bug found in review).
 *
 * The rule: a press is delivered exactly once, no matter how many times
 * `update()` runs before something consumes it. The old code recomputed the
 * edge from held-vs-previous every frame, so any frame that ran no simulation
 * substep threw the press away — and on a 144 Hz display two frames in three
 * run none.
 *
 * Run: npm run probe:input
 */

// Minimal DOM stub: the manager only needs to register listeners and read pads.
const listeners = new Map<string, (e: { code: string; preventDefault(): void }) => void>();
const g = globalThis as unknown as Record<string, unknown>;
g.window = {
  addEventListener: (type: string, fn: (e: never) => void) => listeners.set(type, fn as never),
};
g.document = { activeElement: null };
// Node 24 defines `navigator` as a getter-only global, so it has to be
// redefined rather than assigned.
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: { getGamepads: () => [] },
});

const press = (code: string) => listeners.get('keydown')?.({ code, preventDefault() {} });
const release = (code: string) => listeners.get('keyup')?.({ code, preventDefault() {} });

function line(label: string, pass: boolean, detail: string): boolean {
  console.log(`${pass ? 'OK  ' : 'HIBA'}  ${label.padEnd(46)} ${detail}`);
  return pass;
}

let ok = true;

// --- 1. A press survives frames that consume nothing ----------------------
{
  const input = new InputManager(2);
  press('KeyE');
  // Three render-only frames, as on a high-refresh display.
  input.update();
  input.update();
  input.update();
  ok = line('a lenyomás túléli a szimuláció nélküli képkockákat', input.get(0).interact, 'megmaradt') && ok;
}

// --- 2. It is delivered exactly once --------------------------------------
{
  const input = new InputManager(2);
  press('Space');
  input.update();
  const first = input.get(0).jump;
  input.consumeEdges();
  input.update();
  const second = input.get(0).jump;
  ok = line('egy lenyomás pontosan egyszer szól', first && !second, `első=${first} második=${second}`) && ok;
}

// --- 3. Holding does not repeat -------------------------------------------
{
  const input = new InputManager(2);
  press('KeyE');
  input.update();
  input.consumeEdges();
  let repeats = 0;
  for (let i = 0; i < 30; i++) {
    input.update();
    if (input.get(0).interact) repeats++;
    input.consumeEdges();
  }
  ok = line('nyomva tartás nem ismétel', repeats === 0, `${repeats} ismétlés 30 képkocka alatt`) && ok;
}

// --- 4. Release then press again is a second press -------------------------
{
  const input = new InputManager(2);
  press('KeyE');
  input.update();
  input.consumeEdges();
  release('KeyE');
  input.update();
  input.consumeEdges();
  press('KeyE');
  input.update();
  ok = line('elengedés után újra nyomható', input.get(0).interact, 'második lenyomás megjött') && ok;
}

// --- 5. Players are independent -------------------------------------------
{
  const input = new InputManager(2);
  press('Enter'); // player two's jump
  input.update();
  const p1 = input.get(0).jump;
  const p2 = input.get(1).jump;
  ok = line('a két játékos gombja nem keveredik', !p1 && p2, `P1=${p1} P2=${p2}`) && ok;
}


// --- Jumping ----------------------------------------------------------------
{
  // Two things to hold. The jump has to actually reach the furniture — it used
  // to top out at 1.56 units, under a monster's own height and below every
  // piece of furniture in the flat, so there was nothing in a house full of
  // climbable things that you could climb. And the second jump has to BE a
  // second jump: one in the air, refilled by landing and by nothing else.
  const pad = (jump: boolean) =>
    ({ moveX: 0, moveY: 0, jump, interact: false, sprint: false, interactHeld: false }) as never;

  const apexOf = (takeSecond: boolean): number => {
    const player = new PlayerController(0, 0xffffff, new THREE.Vector3(0, 0, 0));
    // One frame to land: a fresh controller has not touched the ground yet.
    player.update(1 / 60, pad(false), [], 0);
    player.update(1 / 60, pad(true), [], 0);
    let peak = 0;
    let fired = false;
    for (let f = 0; f < 400; f++) {
      // Take the second jump once the first has stopped rising.
      const atApex = takeSecond && !fired && f > 3 && player.position.y < peak;
      player.update(1 / 60, pad(atApex), [], 0);
      if (atApex) fired = true;
      peak = Math.max(peak, player.position.y);
      if (f > 5 && player.position.y <= 0) break;
    }
    return peak;
  };

  const single = apexOf(false);
  const double = apexOf(true);

  // Holding the button down must not be a staircase.
  const greedy = new PlayerController(0, 0xffffff, new THREE.Vector3(0, 0, 0));
  greedy.update(1 / 60, pad(false), [], 0);
  let highest = 0;
  for (let f = 0; f < 400; f++) {
    greedy.update(1 / 60, pad(true), [], 0);
    highest = Math.max(highest, greedy.position.y);
    if (f > 5 && greedy.position.y <= 0) break;
  }

  ok = line('az ugrás felér a bútorra', single > 2.9,
    `${single.toFixed(2)} egység (a kanapé 2.9)`) && ok;
  ok = line('a dupla ugrás magasabbra visz', double > single * 1.4,
    `${double.toFixed(2)} egység a szimpla ${single.toFixed(2)} helyett`) && ok;
  ok = line('nyomva tartva sem lehet feljebb mászni', highest <= double + 0.05,
    `${highest.toFixed(2)} egység, nem több mint ${double.toFixed(2)}`) && ok;

  // --- MEG IS LEHET ÁLLNI A TETEJÉN -----------------------------------------
  //
  // Felugrani kevés: a szörnynek MEG kell állnia a bútoron. A régi
  // leszállási szabály ezt tiltotta („bármi, ami egy lépcsőnél magasabbra
  // emelne, fal"), és ezzel összemosta a beleszaladást a ráeséssel. A
  // lakásban ettől a bútorok 89 százaléka elérhetetlen volt.
  const table = new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 5, 4));
  const jumper = new PlayerController(0, 0xffffff, new THREE.Vector3(0, 0, 14));
  const toward: PlayerInput = {
    moveX: 0, moveY: 1, jump: false, jumpHeld: false, sprint: false,
    interact: false, interactHeld: false, pause: false, usingGamepad: false,
  };
  // Nekifut, és MENET KÖZBEN ugrik, nem az asztalnak feszülve.
  //
  // Elsőre egyetlen ugrást időzítettem, és a szörny addigra már odaért: az
  // asztal oldalának nyomódva ugrott egyet helyben, majd vissza a földre. Ez
  // nem a leszállást mérte, hanem a tesztem időzítését. Rendszeres
  // ugrásokkal az egyik biztosan a megfelelő távolságból indul.
  // Amit mérni kell, az nem a VÉGSŐ magasság, hanem hogy MEDDIG áll a
  // tetején. Egy ugrás csúcsán is 5 fölött van a szörny — az még nem állás.
  // Ezért csak a földről ugrik (fent már nem), és számoljuk a képkockákat,
  // amiket az asztal lapján tölt.
  let onTop = 0;
  for (let f = 0; f < 360; f++) {
    const step = { ...toward, jump: f % 45 === 10 && jumper.position.y < 1 };
    jumper.update(1 / 60, step as never, [table]);
    if (Math.abs(jumper.position.y - 5) < 0.25) onTop++;
  }
  ok = line('meg lehet állni a bútor tetején', onTop > 30,
    `${onTop} képkockán át állt az asztal lapján (${(onTop / 60).toFixed(1)} mp)`) && ok;

  // ...de a FAL továbbra is fal. A lakás falai 17 egység magasak, és a két
  // ugrás együtt 12,3-ra visz: nem véletlen, hanem tervezett távolság.
  const wall = new THREE.Box3(new THREE.Vector3(-4, 0, -4), new THREE.Vector3(4, 17, 4));
  const blocked = new PlayerController(0, 0xffffff, new THREE.Vector3(0, 0, 14));
  let topped = false;
  for (let f = 0; f < 360; f++) {
    // Dupla ugrás is: az sem vihet fel a falra.
    const step = { ...toward, jump: f % 45 === 10 || f % 45 === 28 };
    blocked.update(1 / 60, step as never, [wall]);
    if (blocked.position.y > 16) topped = true;
  }
  ok = line('a falra nem lehet felállni', !topped,
    `a legmagasabb pont ${blocked.position.y.toFixed(1)}, a fal 17`) && ok;

  // És nem is lehet ÁTMENNI rajta.
  const through = blocked.position.z < -4 + 1.5;
  ok = line('a falon nem lehet átmenni', !through,
    `z = ${blocked.position.z.toFixed(1)}, a fal −4-nél kezdődik`) && ok;
}


// --- A játék eleje rövid ----------------------------------------------------
{
  // A felhasználó szava: „túl bonyi". Öt képernyő volt a játékig, és kettő
  // közülük ceremónia: a szerepválasztó olyat döntött el, amit az R menet
  // közben bármikor felülír, az eligazítás pedig négy bekezdés szabály —
  // mind olyan, amit a játék a HELYÉN kiír, amikor számít.
  //
  // Ez a teszt a FÁJLT nézi, mert a képernyők számát nem lehet fejetlenül
  // végigkattintani: a fázisok felsorolása maga a folyamat.
  const source = readFileSync('src/ui/Frontend.ts', 'utf8');
  // `line` a jelentő függvény neve — a forrássort másképp kell hívni.
  const phaseLine = source.split('\n').find((row) => row.startsWith('type Phase =')) ?? '';
  const phases = [...phaseLine.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);

  // A 'done' nem képernyő, hanem a kilépés.
  const screens = phases.filter((p) => p !== 'done');
  const gone = ['roles', 'brief'].filter((p) => phases.includes(p));

  ok = line(
    'a játékig legfeljebb három képernyő vezet',
    screens.length <= 3 && gone.length === 0,
    `${screens.length} képernyő: ${screens.join(' → ')}${gone.length ? ` — még bent: ${gone.join(', ')}` : ''}`
  ) && ok;

  // Az INTRÓ a választás után jön, és át kell tudni ugorni.
  //
  // Nem hangulat kérdése: egy át nem ugorható felütés a második játéknál már
  // akadály, és pont az a fajta részlet, amitől az emberek nem indítják újra
  // a játékot. A fázisok száma ezért sem nő — az intró nem képernyő, amit ki
  // kell tölteni, hanem egy beúszó szöveg, amit bármelyik gomb elvisz.
  const intro = readFileSync('src/ui/Intro.ts', 'utf8');
  const skippable = intro.includes("addEventListener('keydown', this.onSkip)") &&
    intro.includes("addEventListener('click', this.onSkip)");
  ok = line('az intrót bármelyik gomb elviszi', skippable,
    skippable ? 'billentyű és kattintás is' : 'nem lehet átugrani') && ok;

  // ...és a VÁLASZTÁS UTÁN fut, nem a menü közben.
  const mainSource = readFileSync('src/main.ts', 'utf8');
  const afterPick = mainSource.indexOf('saveSelection(selection)') < mainSource.indexOf('new Intro(app)');
  ok = line('az intró a karakterválasztás után jön', afterPick,
    afterPick ? 'a választás már megvan, amikor elindul' : 'két kérdés közé ékelve') && ok;

  // És amit a kivett szerepválasztó mondott, azt valakinek el kell mondania.
  const tellsWhoDrives = source.includes('vezet elsőnek');
  ok = line(
    'a karakterválasztó megmondja, ki vezet',
    tellsWhoDrives,
    tellsWhoDrives ? 'ott van a lábjegyzetben, az R-rel együtt' : 'sehol nincs kiírva'
  ) && ok;
}


// --- Egy eszköz, egy játékos ------------------------------------------------
{
  // Az „egy gépen ketten" kikerült a játékból. Nem szűkítés volt: osztott kép,
  // két billentyűkiosztás egy klaviatúrán és Tab-bal váltogatott szörnyek —
  // egy HARMADIK játék, ami külön hangolást kívánt, és amiért senki nem
  // játszotta. Ami maradt: ezen a gépen pontosan egy szörny megy gombról.
  const one = new InputManager(2);
  one.soloActive = 0;
  one.update(0);

  const idle = one.get(1);
  const quiet =
    idle.moveX === 0 && idle.moveY === 0 && !idle.jump && !idle.interact && !idle.sprint;
  ok = line('a másik szörny nem megy erről a gépről', quiet, 'a bemenete üres') && ok;

  // A Tab-váltásnak NYOMA sem maradhat: egy félig kivezetett mód rosszabb,
  // mint bármelyik a kettő közül — a HUD még hirdeti, a gomb már nem szól.
  const stillSwaps =
    'swapSolo' in (one as unknown as Record<string, unknown>) ||
    readFileSync('src/main.ts', 'utf8').includes('swapSolo') ||
    readFileSync('src/ui/Hud.ts', 'utf8').includes('Tab');
  ok = line('a Tab-váltás mindenhonnan eltűnt', !stillSwaps,
    stillSwaps ? 'valahol még ott van' : 'se bemenet, se billentyű, se HUD') && ok;

  // A nyilak MÁST csinálnak: a kamerát forgatják, nem a második szörnyet. Ha
  // mindkettőt tennék, a körbenézés közben a társam szörnye elindulna — ezért
  // a kiosztásban egyetlen mozgásgomb sem lehet nyíl.
  const inputSource = readFileSync('src/input/InputManager.ts', 'utf8');
  const keymaps = inputSource.slice(
    inputSource.indexOf('const KEYMAPS'),
    inputSource.indexOf('const LOOK_KEYS')
  );
  const arrowsFree = !/(up|down|left|right):\s*\[[^\]]*Arrow/.test(keymaps);
  const lookReadsArrows = inputSource.includes('LOOK_KEYS') && inputSource.includes('look()');
  ok = line('a nyilak a kameráé, nem egy szörnyé', arrowsFree && lookReadsArrows,
    arrowsFree ? 'egy mozgásgomb sem nyíl' : 'valamelyik kiosztás még nyilat mozgat') && ok;
}

// --- A páros kapuk ----------------------------------------------------------
{
  // A kapuk arról szólnak, hogy KÉT SZÖRNYNEK kell egy helyen lennie. Amíg
  // két ember ült egy gépnél, ez egyedül is teljesíthető volt — felváltva.
  // Most nem: a második szörny mögött nincs senki, tehát egy kapu, ami őt
  // várja, nem kihívás, hanem zár kulcs nélkül.
  //
  // Ezért a szabályok egy LISTÁT néznek (`cast`), nem a szereplők számát: ha
  // van társ, a kapu kettőt kér, ha nincs, egyet. A teszt mindkét felét
  // őrzi — a lazítást is, meg azt is, hogy társsal nem lazul.
  const houseSource = readFileSync('src/game/HouseGame.ts', 'utf8');
  const driveSource = readFileSync('src/game/DriveGame.ts', 'utf8');

  const gatesUseCast =
    houseSource.includes('inZone.length === playing.length') &&
    houseSource.includes('this.cast.map((i) => players[i])') &&
    driveSource.includes('this.cast.every((i) => this.outOfCar[i])');
  ok = line('a kapuk a tényleges szereplőket nézik', gatesUseCast,
    gatesUseCast ? 'ház és kocsi is a cast listából dolgozik' : 'valahol még fix kettő a feltétel') && ok;

  // Alapból ketten vannak — a lazítás csak akkor jár, ha a jelenet KÉRI.
  const defaultsToPair =
    houseSource.includes('cast: number[] = [0, 1]') &&
    driveSource.includes('cast: number[] = [0, 1]');
  ok = line('társsal a kapu változatlanul kettőt kér', defaultsToPair,
    'az alapértelmezés mindkét szörny') && ok;
}

// --- A kamera körbefordul ---------------------------------------------------
{
  // A felhasználó kérése szó szerint: „a házban is és a városban is legyen a
  // nyilakkal irányítható 360 fokos mozgatható kamera". A 360 a mérhető rész:
  // a fordulásnak nem lehet ütközője, a dőlésnek viszont kell — egy padlóba
  // fordított kamerából a játékos nem talál vissza.
  resetStage();
  const from = stage.yaw;
  // Egy teljes kör, egy másodperces képkockákkal — a szög modulóval tér vissza.
  let turned = 0;
  for (let i = 0; i < 200; i++) {
    const before = stage.yaw;
    turnStage(1, 1 / 60);
    let d = stage.yaw - before;
    if (d < -Math.PI) d += Math.PI * 2;
    turned += d;
  }
  const fullCircle = turned > Math.PI * 2;
  ok = line('a kamera körbefordul', fullCircle,
    `${((turned * 180) / Math.PI).toFixed(0)} fok 200 képkocka alatt, ütköző nélkül`) && ok;

  // És visszatalál: a szög nem nő a végtelenbe.
  const bounded = stage.yaw >= 0 && stage.yaw < Math.PI * 2 + 0.001;
  ok = line('a fordulás szöge korlátos marad', bounded, `${stage.yaw.toFixed(2)} rad`) && ok;

  resetStage();
  for (let i = 0; i < 600; i++) tiltStage(1, 1 / 60);
  const topStop = stage.pitch <= PITCH_MAX + 1e-6;
  for (let i = 0; i < 1200; i++) tiltStage(-1, 1 / 60);
  const bottomStop = stage.pitch >= PITCH_MIN - 1e-6;
  ok = line('a dőlés viszont ütközőbe fut', topStop && bottomStop,
    `${PITCH_MIN} .. ${PITCH_MAX} rad között marad`) && ok;

  // A képkocka-idővel skálázódik, különben 144 Hz-en két és félszer pörögne.
  resetStage();
  turnStage(1, 1 / 60);
  const slow = stage.yaw;
  resetStage();
  for (let i = 0; i < 2; i++) turnStage(1, 1 / 120);
  const fast = stage.yaw;
  ok = line('a forgatás nem a képfrissítéstől függ', Math.abs(slow - fast) < 1e-6,
    'ugyanaz a szög 60 és 144 Hz-en') && ok;

  resetStage();
}


// --- Az intró tényleg kiír valamit -------------------------------------------
{
  // A felhasználó egy FEKETE KÉPERNYŐT látott, szöveg nélkül. Az ok nem a
  // szöveg volt, hanem hogy azonnal átugrott: a karakterválasztót egy
  // gombnyomással zárja le az ember, és ha egy pillanattal tovább tartja, a
  // billentyűismétlés már az intróra érkezik.
  //
  // Ez a próba azt méri, ami ebből tanulság: az intró (1) ír, és (2) nem
  // ugorható át azonnal. Egy DOM-utánzat elég hozzá — a szöveg attól még
  // szöveg, hogy nincs böngésző.
  class FakeNode {
    className = '';
    textContent = '';
    readonly children: FakeNode[] = [];
    readonly classes = new Set<string>();
    readonly classList = { add: (c: string) => this.classes.add(c) };
    appendChild(child: FakeNode) { this.children.push(child); return child; }
    remove() {}
    addEventListener() {}
    get text(): string {
      return this.children.map((c) => c.textContent + c.text).join('');
    }
  }

  const listeners: Array<() => void> = [];
  const timers: Array<() => void> = [];
  const globals = globalThis as Record<string, unknown>;
  const savedDocument = globals.document;
  const savedWindow = globals.window;

  globals.document = { createElement: () => new FakeNode() };
  globals.window = {
    // Azonnal lefutó időzítő: az intró tizenöt másodperce így egy pillanat.
    setTimeout: (fn: () => void) => { timers.push(fn); return timers.length; },
    clearTimeout: () => {},
    addEventListener: (_: string, fn: () => void) => listeners.push(fn),
    removeEventListener: () => {},
  };

  const { Intro } = await import('../src/ui/Intro');
  const parent = new FakeNode();
  const intro = new Intro(parent as never);
  const finished = intro.run();

  // Először: egy AZONNALI gombnyomás NE vigye el.
  for (const fn of [...listeners]) fn();
  let pumped = 0;
  while (timers.length && pumped < 5000) {
    const fn = timers.shift()!;
    fn();
    pumped++;
    await Promise.resolve();
  }
  await finished;

  const written = (parent as unknown as FakeNode).text;
  globals.document = savedDocument;
  globals.window = savedWindow;

  ok = line('az intró tényleg kiírja a szöveget', written.includes('befőttesüvegbe'),
    written.length ? `${written.length} karakter jelent meg` : 'NEM ÍRT KI SEMMIT') && ok;
  ok = line('a még nyomva tartott gomb nem viszi el', written.length > 100,
    `${written.length} karakter, nem nulla`) && ok;
}


/**
 * KÖRÜLNÉZÉS EGÉRREL.
 *
 * A kamerát eddig csak a nyilak és a kontroller jobb karja forgatta. Aki
 * egérrel ül le — és a legtöbben úgy ülnek le —, annak a kamera
 * mozdíthatatlan volt: a nyilakhoz el kell venni a kezet a WASD mellől.
 *
 * Három dolgot mérünk, és mind a három olyan, ami csendben romlik el:
 *   · a képen húzva fordul,
 *   · a húzás vége UTÁN megáll (különben az utolsó mozdulat örökké pörögne),
 *   · a képen KÍVÜL (egy menügombon) kattintva nem fordul.
 */
{
  const man = new InputManager(2);
  const canvas = { tagName: 'CANVAS' };
  const button = { tagName: 'BUTTON' };
  const down = (target: unknown) =>
    listeners.get('mousedown')?.({ button: 0, target, clientX: 100, clientY: 100 } as never);
  const move = (x: number, y: number) =>
    listeners.get('mousemove')?.({ clientX: x, clientY: y } as never);
  const up = () => listeners.get('mouseup')?.({} as never);

  down(canvas);
  move(160, 100); // 60 képpont jobbra
  const turning = man.look();
  // Az IRÁNYT mérjük, nem a nagyságot: a ráta valós időből számol
  // (képpont/másodperc), és a próbák láncban futva más gépterhelés mellett
  // más időközt látnak — egy küszöbszám itt nem a kódot mérné, hanem azt,
  // mennyire volt elfoglalva a gép. Egyszer már megbukott ettől.
  ok = line('egérhúzásra jobbra fordul', turning.x > 0, `x = ${turning.x.toFixed(2)}`) && ok;

  down(canvas);
  move(40, 100); // balra
  ok = line('balra húzva balra fordul', man.look().x < 0, `x = ${man.look().x.toFixed(2)}`) && ok;

  down(canvas);
  move(100, 160); // lefelé húzás = lefelé nézés
  const tilting = man.look();
  ok = line('lefelé húzva lefelé néz', tilting.y < 0, `y = ${tilting.y.toFixed(2)}`) && ok;

  up();
  ok = line('elengedve megáll', man.look().x === 0 && man.look().y === 0, 'x = 0, y = 0') && ok;

  // Menügombon lenyomva: nem kamera. Enélkül egy „ÚJ JÁTÉK" kattintás
  // félrerántaná a képet.
  down(button);
  move(300, 100);
  ok = line('menügombon húzva nem fordul', man.look().x === 0, `x = ${man.look().x}`) && ok;
}


/**
 * BELSŐ NÉZET: arra megy, amerre néz.
 *
 * A külső nézet szabálya az, hogy „előre = a kamerától elfelé" — ez akkor
 * helyes, ha a kamera mögötted van. Belső nézetben a kamera a szemedben ül,
 * tehát ugyanez a szabály HÁTRAFELÉ küld. Élőben mérve mind a négy égtájon
 * 180 fokot tévedett a mozgás, ezért a próba nem a kódot ismétli, hanem a
 * KÖVETKEZMÉNYT méri: merre mozdul a test a nézéshez képest.
 *
 * Fal nélkül mérünk: falba csúszva a test oldalra siklik, és akkor nem az
 * irányítást mérnénk, hanem az ütközést.
 */
{
  const forward = {
    moveX: 0, moveY: 1, jump: false, jumpHeld: false, sprint: false,
    interact: false, interactHeld: false, pause: false, usingGamepad: false, nitro: false,
  };
  const walk = (fp: boolean, yaw: number): number => {
    stage.yaw = yaw;
    const p = new PlayerController(0, 0xffffff, new THREE.Vector3(0, 0, 0));
    p.firstPerson = fp;
    const from = p.position.clone();
    for (let f = 0; f < 60; f++) p.update(1 / 60, forward, [], 0);
    const d = p.position.clone().sub(from);
    let off = Math.atan2(d.x, d.z) - yaw;
    while (off > Math.PI) off -= Math.PI * 2;
    while (off < -Math.PI) off += Math.PI * 2;
    return Math.abs((off * 180) / Math.PI);
  };

  const fpOff = [0, 1.1, 2.4, -1.9].map((y) => walk(true, y));
  ok = line('belső nézetben arra megy, amerre néz',
    Math.max(...fpOff) < 2,
    `legnagyobb eltérés ${Math.max(...fpOff).toFixed(1)}°`) && ok;

  const tpOff = [0, 1.1, 2.4, -1.9].map((y) => walk(false, y));
  ok = line('külső nézetben a kamerától elfelé megy',
    Math.min(...tpOff) > 178,
    `legkisebb eltérés ${Math.min(...tpOff).toFixed(0)}° (180 a helyes)`) && ok;

  resetStage();
}


/**
 * A T-PÓZ OKA: a klip olyan csontot címzett, ami nem létezik.
 *
 * A lakó animációja LEFUTOTT — a művelet súlya 1,0 volt, a keverő órája
 * ketyegett —, és közben nulla csontot mozgatott. A sávok
 * `mixamorigHead_1`-et címezték, a csontváz csontja viszont `mixamorigHead`.
 * Az `_1` utótagot a betöltő teszi hozzá, amikor a klipfájlban ütközik egy
 * név; a régi kettőspontos `mixamorig:Head` alakot ugyanígy átírja. A keverő
 * az ismeretlen nevet NÉMÁN elnyeli: se hiba, se figyelmeztetés, csak egy
 * T-pózban álló ember.
 *
 * Ezért a próba nem azt kérdezi, „lejátszódik-e", hanem hogy HÁNY SÁV TALÁL
 * valódi csontot.
 */
{
  const bones = new Set(['mixamorigHips', 'mixamorigHead', 'mixamorigSpine1', 'Hips', 'Spine02']);
  const track = (name: string): THREE.KeyframeTrack =>
    new THREE.QuaternionKeyframeTrack(name, [0, 1], [0, 0, 0, 1, 0, 0, 0, 1]);

  const tally = { hit: 0, miss: 0 };
  const clip = new THREE.AnimationClip('proba', 1, [
    track('mixamorigHead_1.quaternion'),      // a betöltő utótagja
    track('mixamorig:Hips.quaternion'),       // a régi kettőspontos alak
    track('mixamorigSpine1.quaternion'),      // már jó név
    track('Hips.quaternion'),                 // a szörnyek csontváza
    track('nincs_ilyen_csont.quaternion'),    // tényleg nincs
  ]);
  const fixed = retarget(clip, bones, tally);
  const names = fixed.tracks.map((t) => t.name.split('.')[0]);

  ok = line('az _1 utótagos név csontra talál', names.includes('mixamorigHead'),
    names.join(', ')) && ok;
  ok = line('a kettőspontos név is csontra talál', names.includes('mixamorigHips'), '') && ok;
  ok = line('a már jó nevet nem rontja el',
    names.includes('mixamorigSpine1') && names.includes('Hips'), '') && ok;
  ok = line('a sehová nem kötő sáv kiesik', fixed.tracks.length === 4 && tally.miss === 1,
    `${tally.hit} kötött, ${tally.miss} elveszett`) && ok;
}

console.log('');
console.log(ok ? 'MIND OK — az irányítás rendben' : 'VAN BUKÓ TESZT');
process.exit(ok ? 0 : 1);
