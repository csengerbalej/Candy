import * as THREE from 'three';
import { PLAYER_COUNT, SIM } from './core/config';
import { stepBudget, Resolution } from './core/Loop';
import { TouchControls, hasTouch } from './input/TouchControls';
import { InputManager } from './input/InputManager';
import { Frontend, type FrontendPhase, type FrontendResult } from './ui/Frontend';
import { PauseMenu, type PauseActions } from './ui/PauseMenu';
import { ResultsScreen } from './ui/ResultsScreen';
import { loadSettings, applySettings, saveSettings, settings, DEFAULTS } from './game/Settings';
import { Session } from './game/Session';
import { loadSelection, saveSelection, type Selection } from './game/Characters';
import { cyclePitch, resetStage, rotateStage, tiltStage, turnStage } from './camera/Stage';
import { openRoom, type RoomTransport } from './net/Room';
import { openPeerRoom, makeCode } from './net/PeerRoom';
import { Latency } from './net/Latency';
import { NetSession } from './net/NetSession';
import { NetBadge } from './ui/NetBadge';
import { Identity } from './net/Identity';
import { Chat } from './ui/Chat';
import { Intro } from './ui/Intro';
import { VillageWorld } from './world/VillageWorld';
import { saveRun, loadRun, clearRun } from './game/SaveGame';
import { DriveScene } from './scenes/DriveScene';
import { HouseScene } from './scenes/HouseScene';
import type { GameScene } from './scenes/GameScene';

/** ?mode=house or ?mode=arena drop straight into one section, for testing. */
const debugMode = new URLSearchParams(location.search).get('mode');
/** Stand-in players for `?mode=...`, used only when nothing is saved. */
const DEBUG_SELECTION: Selection = {
  names: ['BALINT', 'CSENGER'],
  characters: ['werewolf', 'ghost'],
  driverIndex: 0,
};

const app = document.getElementById('app') as HTMLDivElement;

loadSettings();

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
/**
 * Tone mapping, and which one.
 *
 * Without any, every lit surface clips straight to white — that is why a night
 * street once rendered as an overexposed day with a black sky. ACES fixed that
 * but brought its own problem: its toe crushes precisely the shadow-to-midtone
 * range this game lives in, and a Halloween street at night is almost entirely
 * that range. Side by side at a fixed viewpoint, Reinhard keeps the wall
 * planes, the rooflines and the road markings readable where ACES loses them,
 * and the lit windows come back saturated instead of muddy.
 *
 * Reinhard flattens highlights more, which would matter in a bright scene.
 * There are no bright scenes here.
 */
// Per-material clipping, so the house can have its wall tops sliced off
// without touching anything else in the scene.
renderer.localClippingEnabled = true;
renderer.toneMapping = THREE.ReinhardToneMapping;
renderer.toneMappingExposure = 1.25;
app.appendChild(renderer.domElement);
applySettings(renderer);

const input = new InputManager(PLAYER_COUNT);

/**
 * A képernyőre rajzolt vezérlő — CSAK érintőképernyőn.
 *
 * Egérrel nincs értelme, sőt kárt okoz: eltakarná a képet olyan gombokkal,
 * amikre soha nem kattint senki. A menüben is rejtve marad; ott a kártyákra
 * lehet koppintani.
 */
const touch = hasTouch() ? new TouchControls(app) : null;
if (touch) {
  input.touch = touch;
  touch.setVisible(false);
  // A HUD-ot is tudni kell, hogy érintőn vagyunk: a billentyűnevek („jobb
  // Shift") telón nemcsak feleslegesek, hanem takarnak is.
  document.body.dataset.touch = '1';
}

let width = 0;
let height = 0;
function resize(): void {
  width = window.innerWidth;
  height = window.innerHeight;
  renderer.setSize(width, height);
}
window.addEventListener('resize', resize);
resize();

// --- frame-rate readout ---------------------------------------------------
const fpsBadge = document.createElement('div');
fpsBadge.className = 'fps';
fpsBadge.hidden = true;
app.appendChild(fpsBadge);
let fpsFrames = 0;
let fpsClock = performance.now();
function tickFps(): void {
  fpsBadge.hidden = !settings.showFps;
  if (!settings.showFps) return;
  fpsFrames++;
  const now = performance.now();
  if (now - fpsClock >= 500) {
    fpsBadge.textContent = `${Math.round((fpsFrames * 1000) / (now - fpsClock))} fps`;
    fpsFrames = 0;
    fpsClock = now;
  }
}

// --- loading card ---------------------------------------------------------
const loader = document.createElement('div');
loader.className = 'loading';
loader.hidden = true;
app.appendChild(loader);
function showLoading(text: string): void {
  loader.textContent = text;
  loader.hidden = false;
}
function hideLoading(): void {
  loader.hidden = true;
}

// --- the run --------------------------------------------------------------
let active: GameScene | null = null;
let session: Session | null = null;

/**
 * A két játékos beszélgetése.
 *
 * A JELENETEKEN KÍVÜL él, mert a beszélgetés nem a vezetéshez vagy a házhoz
 * tartozik, hanem hozzátok: egy üzenet nem tűnhet el attól, hogy közben
 * bementetek egy házba. Ezért itt jön létre, és itt is marad.
 */
let chat: Chat | null = null;
let pause: PauseMenu | null = null;
let stopped = false;
let advancing = false;
let results: ResultsScreen | null = null;

const clock = new THREE.Clock();
let elapsed = 0;
let accumulator = 0;
const resolution = new Resolution(DEFAULTS.resolution);

// Without this, a hot update leaves the previous module's frame loop running
// against a half-built new module.
import.meta.hot?.dispose(() => {
  stopped = true;
});

function takeFrontendPhase(): FrontendPhase {
  try {
    const phase = sessionStorage.getItem('candypocalypse.phase') as FrontendPhase | null;
    sessionStorage.removeItem('candypocalypse.phase');
    if (phase) return phase;
  } catch {
    /* storage disabled */
  }
  return 'menu';
}

/**
 * Leave the current section for the front end.
 *
 * `keepRun` is the whole point. The pause row that sends players to the main
 * menu says "a menet mentve van a ház végénél" and then used to delete the
 * save on the way out — the exact thing its own note promised would not
 * happen. Going to the menu now leaves the night on disk so FOLYTATÁS works;
 * only deliberately starting over clears it.
 */
function restartFrontend(phase: FrontendPhase, keepRun: boolean): void {
  if (!keepRun) clearRun();
  try {
    sessionStorage.removeItem('candypocalypse.selection');
    sessionStorage.setItem('candypocalypse.phase', phase);
    // Names survive a character change: they belong to the people at the
    // keyboard, not to the monsters they picked.
    if (session) {
      sessionStorage.setItem('candypocalypse.names', JSON.stringify(session.selection.names));
    }
  } catch {
    /* storage disabled */
  }
  location.reload();
}

function makePauseMenu(extra: Partial<PauseActions>): PauseMenu {
  const actions: PauseActions = {
    onReselect: () => restartFrontend('characters', false),
    onTitle: () => restartFrontend('menu', true),
    ...extra,
  };
  return new PauseMenu(app, input, actions, () => applySettings(renderer));
}

async function showFrontend(): Promise<FrontendResult> {
  touch?.setVisible(false);
  delete document.body.dataset.playing;
  // A menüben a mutató SOHA nincs elkapva: ott kattintani kell.
  input.lookLock = false;
  if (document.pointerLockElement) document.exitPointerLock();
  const frontend = new Frontend(app, input, takeFrontendPhase());
  frontend.onSettings = () => settingsPanel().toggle();

  let polling = true;
  const poll = (): void => {
    if (!polling) return;
    input.update();
    // A menüben is mérünk: a párosítás itt dől el, tehát itt a leghasznosabb
    // látni a késést — még az indulás előtt.
    latency?.update(1 / 60);
    // While the settings panel is up it owns the input; the menu underneath
    // must not also act on the same button press.
    if (settings_panel?.isOpen) settings_panel.update();
    else frontend.update();
    input.consumeEdges();
    requestAnimationFrame(poll);
  };
  poll();
  const result = await frontend.run();
  polling = false;
  settings_panel?.dispose();
  settings_panel = null;
  return result;
}

let settings_panel: PauseMenu | null = null;
function settingsPanel(): PauseMenu {
  if (!settings_panel) {
    settings_panel = new PauseMenu(
      app,
      input,
      {
        onReselect: () => undefined,
        onTitle: () => undefined,
      },
      () => applySettings(renderer),
      'settings'
    );
  }
  return settings_panel;
}

/**
 * Swap the active section.
 *
 * Disposing before building matters: each scene owns DOM as well as objects,
 * and two HUDs stacked on top of each other is the first thing that happens
 * if the order is reversed.
 */
/** Fejlesztői fogódzó: a futó jelenet a konzolból elérhető. */
function exposeForDebug(): void {
  if (!import.meta.env.DEV) return;
  (window as unknown as Record<string, unknown>).__cp = { session, active, input, renderer };
}

async function enter(next: 'drive' | 'house'): Promise<void> {
  if (!session) return;
  active?.dispose();
  active = null;
  pause?.dispose();
  // Each section starts facing the way it was authored to be entered from.
  resetStage();

  if (next === 'drive') {
    showLoading('A VÁROS BETÖLTÉSE…');
    active = await DriveScene.create(renderer, input, session, app);
    exposeForDebug();
    hideLoading();
  } else {
    active = await HouseScene.create(renderer, input, session, app);
  }
  pause = makePauseMenu(active.pauseActions());
  session.phase = next;
  accumulator = 0;

  if (import.meta.env.DEV) {
    (window as unknown as Record<string, unknown>).__cp = { session, active, input, renderer };
  }
}

async function runSession(selection: Selection, ready?: () => void): Promise<void> {
  session = new Session(selection);
  await enter('drive');
  // A jelenet áll: mostantól van mit mutatni az intró sötét lapja alatt.
  ready?.();
  // Saved immediately, so even a reload during the first drive resumes the
  // night the players are actually in.
  saveRun(session);
}

/** One section ended; decide what comes next. */
async function advance(): Promise<void> {
  if (!session || !active) return;

  if (session.phase === 'drive') {
    await enter('house');
    return;
  }

  // The house is over. One more, or the night is done.
  const last = session.isLastHouse;
  active.dispose();
  active = null;
  pause?.dispose();
  pause = null;

  if (!last) {
    // A section boundary is the only safe place to save: mid-chase is not a
    // resumable moment (spec §29).
    saveRun(session);
    await enter('drive');
    return;
  }

  clearRun();
  session.phase = 'results';

  // Driven by the one frame loop, not a second one. Two loops both calling
  // input.update() meant whichever ran first ate every button edge, and the
  // results screen — being the one registered second — could never be confirmed.
  results = new ResultsScreen(app, session, input);
  const again = await results.run();
  results = null;

  if (again) await runSession(session.selection);
  else restartFrontend('menu', false);
}

// --- the single frame loop ------------------------------------------------
function frame(): void {
  if (stopped) return;
  requestAnimationFrame(frame);

  const frameTime = Math.min(clock.getDelta(), 0.25);
  // A késésmérés a KÉPKOCKA hurokban fut, nem a szimulációéban: azt méri,
  // milyen gyorsan ér át egy állapot, és ez nem a szimuláció dolga.
  latency?.update(frameTime);
  // Játék közben látszik a vezérlő; a menü a saját ágán elrejti.
  touch?.setVisible(true);
  if (touch) document.body.dataset.playing = '1';
  input.update();
  tickFps();

  // A nyilas kamera a KÉPKOCKA hurokban fut, nem a szimulációéban.
  //
  // Azért ott, mert a körbenézés nem a világ állapota: a szimuláció fix
  // lépésekben jár, és egy 144 Hz-es kijelzőn három képkockából kettő nem
  // futtat lépést — a kamera akkor minden harmadik képen mozdulna, ami nem
  // lassú forgatásnak látszik, hanem akadozásnak. Itt viszont minden
  // rajzoláshoz jut egy adag, a `frameTime` pedig a valódi eltelt idő.
  // EGY ESZKÖZ = EGY JÁTÉKOS. Ez már nem választás, hanem a játék alakja: a
  // társ egy másik eszközön ül, tehát ezen a gépen pontosan egy szörny van,
  // amit gomb mozgat. Hogy melyik, azt a szoba dönti el, és a szoba menet
  // közben is változhat (a társ belép, kilép) — ezért itt frissül, nem
  // egyszer az induláskor.
  input.soloActive = net.current.paired ? net.current.playerIndex : 0;
  // A CHAT csak kétfős módban él, és csak akkor, ha van kinek üzenni.
  if (chat) {
    chat.update(frameTime);
    // A gépelés ALATT a játék nem kap gombot — az `InputManager` a
    // szövegmezőt amúgy is kihagyja, ez csak a megnyitást zárja.
    if (!chat.typing && net.current.paired && active && !pause?.isOpen) {
      if (input.consumeChat()) chat.open();
      const quick = input.consumeQuick();
      if (quick >= 0) chat.quick(quick);
    }
  }
  // ...és a BILLENTYŰZET is az övé. Enélkül a második eszközön ülő játékos a
  // KEYMAPS[1]-et olvasta, amiből a mozgás pont akkor tűnt el, amikor az „egy
  // gépen ketten" mód kikerült: WASD-ot nyomott, és nem indult el a kocsi.
  input.localIndex = net.current.paired ? net.current.playerIndex : 0;
  // A név és a karakter is csak akkor kerül át, ha van kinek: a társ a saját
  // gépén választ, és a választása bármikor megérkezhet — akár a ház közepén,
  // ha újratöltötte az oldalt.
  if (session) identity?.sync(session.selection);

  if (active && !pause?.isOpen && !results) {
    const look = input.look();
    if (active.look) active.look(look.x, look.y, frameTime);
    else {
      turnStage(look.x, frameTime);
      tiltStage(look.y, frameTime);
    }
  }

  // A gamepad's Start button opens the pause menu, the same as Escape.
  if (input.consumePause() && pause && !results) pause.toggle();

  if (results) {
    results.update();
    input.consumeEdges();
    return;
  }

  if (!active) return;

  if (pause?.isOpen) {
    pause.update();
    input.consumeEdges();
    accumulator = 0;
    active.render(frameTime, width, height);
    return;
  }

  const budget = stepBudget(accumulator, frameTime);
  accumulator = budget.rest;
  for (let i = 0; i < budget.steps; i++) {
    elapsed += SIM.step;
    if (session) session.stats.time += SIM.step;
    active.update(SIM.step, elapsed);
    input.consumeEdges();
  }

  // A felbontás a MÉRT képkockaidőből követi a gépet. A beállítás marad a
  // plafon; ez csak akkor tér el tőle, ha a játék tényleg nem fér bele.
  resolution.setCeiling(settings.resolution);
  if (resolution.sample(frameTime)) renderer.setPixelRatio(Math.min(window.devicePixelRatio, resolution.value));

  active.render(frameTime, width, height);

  // `finished` stays true until the swap completes, so guard against kicking
  // off a second transition on the very next frame.
  if (active.finished && !advancing) {
    advancing = true;
    void advance().finally(() => {
      advancing = false;
    });
  }
}

// A/B for the §22 question, kept as a hotkey as well as a setting.
window.addEventListener('keydown', (e) => {
  const el = document.activeElement;
  // Without this guard, anyone whose name contains an "o" — Robi, Dorottya,
  // Zoli — silently flipped the split orientation while typing it.
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;

  if (e.code === 'KeyO') {
    // Written through the settings, so the next settings change does not
    // quietly revert it.
    settings.splitOrientation = settings.splitOrientation === 'horizontal' ? 'vertical' : 'horizontal';
    saveSettings();
    applySettings(renderer);
  }

  // The roles screen promises this, and until now nothing listened for it.
  // Szerepcsere csak akkor, ha VAN kivel cserélni. Egyedül a csere annyit
  // tenne, hogy a kocsiban senki nem marad a volánnál.
  if (e.code === 'KeyR' && session && session.phase === 'drive' && net.current.paired) {
    session.swapRoles();
  }

  // Turn the stage. The camera used to face one fixed direction for the whole
  // game, which is fine in a room built around it and useless in a flat you
  // walk across in every direction — half the time you are walking towards the
  // camera with the wall you are about to hit hidden behind your own back.
  // Q turns the view a quarter at a time — press it again to keep going round.
  // The movement basis turns with it, so the controls stay consistent with
  // what is on screen rather than with the world.
  if (e.code === 'KeyQ') rotateStage(-1);

  // T: kameraszög. Nem beállítás, hanem VÁLASZTÁS — háromszor hangoltam félre
  // ezt a számot, és a szög ízlés kérdése, amit fejetlen próbával nem lehet
  // eldönteni. A falak rajzolt magassága automatikusan követi.
  // NÉZETVÁLTÁS a házban: belső és külső között.
  if (e.code === 'KeyC' && active?.toggleFirstPerson) {
    active.toggleFirstPerson();
  }

  // A kameraszög a C-vel VETÉLKEDETT a T-vel, és a T-t közben a beszélgetés
  // is elvitte: egy T leütés megnyitotta a chatet ÉS elfordította a kamerát.
  // Két külön dolog, két külön gomb — a szög mostantól V.
  if (e.code === 'KeyV' && active?.setCameraPitch) {
    const degrees = cyclePitch();
    active.setCameraPitch(degrees);
  }
});

/**
 * A szoba: ha ketten külön eszközről nyitják meg ugyanezt az oldalt, itt
 * találkoznak. Ha nincs — fejlesztői szerveren nincs, és egy nézet sem
 * mindig tud csatlakozni —, a `NetSession(null)` ág egy gépes játékot ad,
 * ami pontosan az eddigi viselkedés. A hálózat tehát sosem feltétel, csak
 * lehetőség: ami nélküle működött, azzal is működik.
 */
export let net = new NetSession(null);

/**
 * A jelzo mar a szoba elott letrejon, es „EGY GEPEN"-t mutat. Ez szandekos:
 * ha a csatlakozas nem sikerul, az igy KULONBSEG lesz, nem hallgatas — a
 * jelzo hianya ugyanis nem mondana meg, hogy nem volt szoba, vagy hogy a
 * kod sem futott le.
 */
const netBadge = new NetBadge(app);
netBadge.watch(net);

/**
 * A szoba KÓDJA, ha nem a futtatókörnyezetén megyünk.
 *
 * A címsor végén él (`#j=ABCD`), mert így a meghívás maga a link: a társnak
 * nincs mit begépelnie, és nekünk nincs mit tárolnunk. Ha nincs benne kód,
 * gyártunk egyet és VISSZAÍRJUK — enélkül minden újratöltés új szobát
 * nyitna, és a már elküldött link holnap üresbe vezetne.
 */
function roomCode(): string {
  const found = /[#&]j=([A-Za-z]{4})/.exec(location.hash);
  if (found) return found[1].toUpperCase();
  const fresh = makeCode();
  try {
    history.replaceState(null, '', location.pathname + location.search + '#j=' + fresh);
  } catch {
    // Ha a címsort nem írhatjuk (fájlból nyitva), a kód akkor is él, csak
    // kézzel kell továbbadni. A jelző kiírja.
  }
  return fresh;
}

function adopt(room: RoomTransport): void {
  net = new NetSession(room);
  netRoom = room;
  latency = new Latency(room);
  netBadge.watchLatency(latency);
  identity = new Identity(room, net);
  netBadge.watch(net);
  // A beszélgetés akkor születik, amikor a szoba megnyílik. Egyedül
  // játszva sosem — nincs kivel.
  chat = new Chat(app, room, 'ÉN');
}

void openRoom()
  .then(async (room) => {
    if (room) {
      adopt(room);
      return;
    }
    // Nincs futtatókörnyezeti szoba (saját tárhelyről nyitva), vagy a másik
    // fél nem ugyanabból a Claude-szervezetből jön. Ilyenkor a két böngésző
    // közvetlenül beszél egymással.
    const peer = await openPeerRoom(roomCode());
    if (!peer) return;
    netBadge.invite(peer.code);
    adopt(peer);
  })
  .catch(() => {});

export let netRoom: RoomTransport | null = null;
/** A késésmérő. A jelző írja ki, a képkocka-hurok hajtja. */
export let latency: Latency | null = null;
let identity: Identity | null = null;

void start();

async function start(): Promise<void> {
  // The game always opens on the title screen.
  //
  // It used to resume a saved night on its own, straight into the drive, which
  // meant anyone who had played before never saw the name entry or the
  // character select again — the front of the game became unreachable by
  // playing it. The save is not lost: the title screen offers FOLYTATÁS when
  // there is one, and the loop below picks it up. Continuing is now something
  // the players choose rather than something that happens to them.

  // `?mode=...` is for looking at one scene, so it skips the menus entirely
  // rather than making you type two names and pick two characters to reach the
  // thing you wanted to check. Any saved selection is reused so the debug view
  // shows the same monsters you last played as.
  let selection: Selection | null = debugMode ? loadSelection() ?? DEBUG_SELECTION : null;
  while (!selection) {
    const result = await showFrontend();
    if (result.kind === 'new') {
      selection = result.selection;
      break;
    }
    // "Continue" was picked; if the save vanished in between, fall back to the
    // menu rather than casting a menu result into a Selection and crashing.
    const resumed = loadRun();
    if (resumed) {
      session = resumed;
      saveSelection(resumed.selection);
      await enter('drive');
      frame();
      return;
    }
  }

  saveSelection(selection);

  // Az intró a VÁLASZTÁS UTÁN jön, és ez a sorrend szándékos: a menü
  // kérdéseket tesz fel (ki vagy, kit választasz), az intró pedig elmondja,
  // miért indulunk el. Két kérdés közé ékelve az ember átkattint rajta.
  // Folytatásnál nincs: aki egy félbehagyott éjszakát vesz fel, annak a
  // felütést már elmondtuk.
  //
  // A falu betöltése KÖZBEN fut, nem utána. A modell tizenkét megabájt: ha az
  // intró végén kezdenénk, a játékos a szöveg után megint fekete képernyőt
  // kapna — ami pontosan az a hiba, amit az intrónak el kellene takarnia.
  // A modellbetöltő gyorsítótáraz, tehát a jelenet felépítése utána már a
  // kész adatból dolgozik.
  const intro = new Intro(app);
  const warm = VillageWorld.load().catch(() => {});
  await Promise.all([intro.run(), warm]);

  if (debugMode === 'house') {
    session = new Session(selection);
    session.currentHouseName = 'TESZTHÁZ';
    active = await HouseScene.create(renderer, input, session, app);
    pause = makePauseMenu(active.pauseActions());
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__cp = { session, active, input, renderer };
    }
    intro.dismiss();
  } else {
    try {
      await runSession(selection, () => intro.dismiss());
    } finally {
      // Biztosíték: ha a jelenet felépítése elhasal, a sötét lap akkor sem
      // maradhat a képen. Egy hibaüzenet, amit senki nem lát, mert fekete a
      // képernyő, kétszeres hiba.
      intro.dismiss();
    }
  }

  frame();
}
