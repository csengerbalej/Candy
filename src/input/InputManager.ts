/**
 * Two players, always. There is no such thing as "the input" in this codebase.
 * Keyboard is the fallback so one person can still test both halves;
 * a connected gamepad transparently takes over that player's slot.
 */

export interface PlayerInput {
  moveX: number; // -1 left .. +1 right
  moveY: number; // -1 back .. +1 forward
  jump: boolean; // edge-triggered
  jumpHeld: boolean;
  sprint: boolean;
  interact: boolean; // edge-triggered
  interactHeld: boolean;
  /** Start / Options. Edge-triggered. Opens the pause menu. */
  pause: boolean;
  /** Nitro — nyomva tartva szol, amig van a tartalyban. */
  nitro: boolean;
  usingGamepad: boolean;
}

/**
 * Amit a szabalyok a bemenettol varnak.
 *
 * Azert interfesz, mert a HALOZATI jatekban a tarsam gombjai nem ezen a gepen
 * vannak: a gazda gepen a tavoli jatekos bemenete a szobabol erkezik, nem
 * billentyuzetrol. A szabalyoknak viszont tokmindegy, honnan jon — csak azt
 * kell tudniuk, meg van-e nyomva.
 */
export interface InputSource {
  get(playerIndex: number): PlayerInput;
}

import type { TouchControls } from './TouchControls';

const DEADZONE = 0.22;

interface KeyMap {
  up: string[];
  down: string[];
  left: string[];
  right: string[];
  jump: string[];
  sprint: string[];
  interact: string[];
  nitro: string[];
}

/**
 * Melyik sorszamu jatekos ul ENNEL a gepnel.
 *
 * Halozatban a vendeg a JATEKOS 2, de a billentyuzete akkor is az elso
 * kiosztas. A jelenetek allitjak be, amikor kiderul a szerep.
 */
const KEYMAPS: KeyMap[] = [
  {
    up: ['KeyW'],
    down: ['KeyS'],
    left: ['KeyA'],
    right: ['KeyD'],
    jump: ['Space'],
    // A JOBB SHIFT IS FUTTAT. A bal alatt a bal kéz a WASD-on van, és a
    // kisujjal nyomva tartani a futást egy hosszú folyosón kényelmetlen —
    // a jobb kéz viszont a kamerán (nyilak) amúgy is ott van mellette.
    // Mindkettő él: nem elvenni kell egy megszokást, hanem adni mellé.
    sprint: ['ShiftRight', 'ShiftLeft'],
    interact: ['KeyE'],
    nitro: ['KeyF'],
  },
  // A masodik jatekos MAR NEM EGY GEPEN ul, hanem egy masik eszkozon — ott o
  // az elso. Ezert a nyilak itt felszabadultak, es a KAMERAT forgatjak (lasd
  // `look()`). A gombok maradnak: aki egy gepen ket kontrollerrel probalna,
  // annak a masodik pad tovabbra is a masodik szornyet mozgatja.
  {
    up: [],
    down: [],
    left: [],
    right: [],
    jump: ['Enter', 'NumpadEnter', 'Numpad0'],
    sprint: ['ShiftRight', 'NumpadAdd'],
    interact: ['Slash', 'ControlRight', 'Numpad1'],
    nitro: ['Numpad3', 'Period'],
  },
];

/** A nyilak: a kamera, nem egy jatekos. */
const LOOK_KEYS = {
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
} as const;

/** True while the player is typing into a form field rather than playing. */
function isTyping(): boolean {
  const el = document.activeElement;
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
}

function applyDeadzone(v: number): number {
  if (Math.abs(v) < DEADZONE) return 0;
  const sign = Math.sign(v);
  return sign * ((Math.abs(v) - DEADZONE) / (1 - DEADZONE));
}

export class InputManager {
  /**
   * Melyik sorszamu jatekos ul ENNEL a gepnel — az o slotja kapja az elso
   * (WASD-os) kiosztast. A jelenetek allitjak, amikor kiderul a halozati
   * szerep; egyedul jatszva marad a nulla.
   */
  localIndex: 0 | 1 = 0;

  /**
   * A képernyőre rajzolt vezérlő, ha érintőképernyőn vagyunk.
   *
   * A HELYI játékosé, mindig: a társ gombjai a másik telefonon vannak. Ezért
   * nem kiosztás, hanem harmadik forrás a billentyűzet és a pad mellé — és a
   * három közül az nyer, amelyiket épp használják.
   */
  touch: TouchControls | null = null;

  /**
   * A beszélgetés gombjai.
   *
   * Nem a `PlayerInput` része, és ez szándékos: az a szörny bemenete, amit a
   * hálózat át is küld a társnak. Hogy én épp gépelni akarok, az nem az ő
   * dolga — és a sávszélességre költeni rá pazarlás.
   */
  private chatOpen = false;
  private quickSlot = -1;

  /**
   * A LÖVÉS.
   *
   * Nem a `PlayerInput` része, ugyanabból az okból, amiért a beszélgetés sem:
   * a lövés a HELYI játékos tette, és a hálózaton nem a gombnyomás megy át,
   * hanem az eredménye (ki lőtt, honnan, merre). Egy átküldött gombnyomásból
   * a másik gép egy MÁSIK lövést számolna ki, a saját fél képkockányit
   * csúszott állapotából.
   */
  private firePressed = false;

  /**
   * TÁVCSŐ: nyomva tartott jobb egérgomb, vagy a jobb Shift.
   *
   * Nem él (egyszeri), hanem TARTOTT állapot: a távcső addig van fent, amíg
   * tartod. Egy kapcsolós távcső a legrosszabb pillanatban maradna bent —
   * amikor menekülni kell, és a fél képernyő egy cső belseje.
   */
  private scopeHeld = false;
  /** A húzásos körülnézés állapota (ha a mutató nincs elkapva). */
  private dragging = false;
  private dragX = 0;
  private dragY = 0;

  /** Húzás kezdete. Az egyetlen mousedown-kezelő hívja. */
  private dragFrom(x: number, y: number): void {
    this.dragging = true;
    this.dragX = x;
    this.dragY = y;
  }

  get scoping(): boolean {
    return this.scopeHeld || this.held.has('ShiftRight') || !!this.touch?.state.scope;
  }

  /**
   * ÚJRAÉLEDÉS (R).
   *
   * Nem kényelmi gomb: a sarokba szorított játékosnak kell egy KIÚT, ami nem
   * az „ülj és várj". Az ára viszont valódi — ami a kezedben van, ottmarad a
   * földön az ellenfélnek.
   */
  private respawnPressed = false;

  /** Igaz egyszer, ha az újraéledést kérték. */
  consumeRespawn(): boolean {
    const hit = this.respawnPressed;
    this.respawnPressed = false;
    return hit;
  }

  /** Igaz egyszer, ha lőttek. */
  consumeFire(): boolean {
    if (this.touch?.consumeFire()) this.firePressed = true;
    const hit = this.firePressed;
    this.firePressed = false;
    return hit;
  }

  /** Igaz EGYSZER, ha megnyomtad a beszélgetés gombját. */
  consumeChat(): boolean {
    if (this.touch?.consumeChat()) this.chatOpen = true;
    const hit = this.chatOpen;
    this.chatOpen = false;
    return hit;
  }

  /** A megnyomott gyorsüzenet sorszáma, vagy −1. Egyszer adja vissza. */
  consumeQuick(): number {
    const slot = this.quickSlot;
    this.quickSlot = -1;
    return slot;
  }

  /**
   * Kérhetjük-e a mutató elkapását.
   *
   * A menüben NEM: ott kattintani kell a kártyákra, és egy elkapott mutatóval
   * nincs mire kattintani. A jelenetek kapcsolják be.
   */
  lookLock = false;
  /** Elkapva van-e most a mutató. */
  private locked = false;

  /** Igaz, ha a nézés épp az elkapott mutatóról jön — a HUD ezt jelzi ki. */
  get pointerLocked(): boolean {
    return this.locked;
  }

  /** Az egérhúzás rátája képpont/mp-ben, és mikor volt friss. Lásd `look()`. */
  private mouseX = 0;
  private mouseY = 0;
  private mouseAt = 0;

  private readonly held = new Set<string>();
  private readonly prevJump: boolean[];
  private readonly prevInteract: boolean[];
  /**
   * Edges live here until something consumes them.
   *
   * They used to be recomputed every frame from held-vs-previous, which threw
   * the press away whenever the frame ran no simulation substep — and on a
   * 144 Hz display two frames in three run none, so two presses in three
   * vanished. A latch is the difference between "the jump button is unreliable"
   * and a jump button.
   */
  private readonly pendingJump: boolean[];
  private readonly pendingInteract: boolean[];
  private readonly prevPause: boolean[];
  private readonly pendingPause: boolean[];
  private readonly states: PlayerInput[];

  constructor(private readonly playerCount: number) {
    this.prevJump = new Array(playerCount).fill(false);
    this.prevInteract = new Array(playerCount).fill(false);
    this.pendingJump = new Array(playerCount).fill(false);
    this.pendingInteract = new Array(playerCount).fill(false);
    this.prevPause = new Array(playerCount).fill(false);
    this.pendingPause = new Array(playerCount).fill(false);
    this.states = Array.from({ length: playerCount }, () => ({
      moveX: 0,
      moveY: 0,
      jump: false,
      jumpHeld: false,
      sprint: false,
      interact: false,
      interactHeld: false,
      pause: false,
      usingGamepad: false,
      nitro: false,
    }));

    window.addEventListener('keydown', (e) => {
      // While a text field has focus the keyboard belongs to it: swallowing
      // Space there would make it impossible to type a name with a space in it.
      if (isTyping()) return;
      // A beszélgetés gombjai AZONNAL érvényesülnek, nem a képkocka-hurokban:
      // egy megnyitás nem veszhet el attól, hogy épp nem futott szimuláció.
      if (e.code === 'KeyT') this.chatOpen = true;
      // A lövés billentyűje ugyanebben a kezelőben él, nem egy másodikban.
      // Nemcsak takarékosságból: a fejetlen próba DOM-tokja TÍPUSONKÉNT EGY
      // kezelőt tart, tehát a második `keydown` némán felülírta volna az
      // elsőt — és ettől a teljes billentyűzet elnémult a mérésekben, úgy,
      // hogy a játékban működött.
      if (e.code === 'ControlLeft') this.firePressed = true;
      if (e.code === 'KeyR') this.respawnPressed = true;
      const quick = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
      if (quick >= 0) this.quickSlot = quick;
      this.held.add(e.code);
      // Stop the page from scrolling out from under the game.
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));

    // LŐGOMB: bal egérgomb a képen, vagy Ctrl. Az egérgomb azért a képre van
    // kötve, mert a menügombokra kattintás nem lövés — ugyanaz a szűrés, mint
    // a kamerahúzásnál.
    // EGYETLEN mousedown-kezelő, három feladattal.
    //
    // Nem takarékosság: a fejetlen próba DOM-tokja TÍPUSONKÉNT EGY kezelőt
    // tart, tehát a második `mousedown` némán felülírná az elsőt — a
    // játékban működne, a mérésben elnémulna az egér. Ez a hiba egyszer már
    // megtörtént a billentyűzettel.
    window.addEventListener('mousedown', (e) => {
      if (e.button === 2) {
        this.scopeHeld = true;
        return;
      }
      if (e.button !== 0) return;
      if ((e.target as HTMLElement)?.tagName !== 'CANVAS') return;
      wantLock(e);
      // A húzásos körülnézés kezdete (ha nincs elkapva a mutató).
      this.dragFrom(e.clientX, e.clientY);
      // AZ ELSŐ KATTINTÁS CÉLZÁSRA VÁLT, NEM LŐ.
      //
      // Ugyanaz a kattintás kéri el a mutatót, amivel a játékos „belép" a
      // belső nézetbe. Ha ez egyben lövés is lenne, minden egyes
      // visszakapcsolás egy elpazarolt lövéssel járna — és pont akkor, amikor
      // a játékos még nem is céloz sehova.
      if (this.lookLock && !this.locked) return;
      this.firePressed = true;
    });


    // SZABAD NÉZÉS: a mutató elkapása (pointer lock).
    //
    // Belső nézetben a nyilakkal célozni olyan, mint kormánykerék helyett
    // irányjelzővel vezetni. Elkapott mutatóval viszont a touchpad MOZDULATA
    // maga a nézés — nem kell húzni, nincs képernyőszél, és a célzás
    // ugyanolyan pontos, mint bármelyik FPS-ben.
    //
    // A kattintás kéri el, az Esc adja vissza — ez a böngésző szabálya, nem
    // a miénk, és nem is kerülhető meg. Ezért a szünet menü Esc-je elkapott
    // mutató mellett ELŐSZÖR a mutatót engedi el; a másodikra nyílik meg.
    const wantLock = (e: MouseEvent): void => {
      const canvas = e.target as HTMLElement | null;
      if (canvas?.tagName !== 'CANVAS') return;
      if (document.pointerLockElement === canvas) return;
      if (!this.lookLock) return;
      void (canvas as HTMLCanvasElement).requestPointerLock?.();
    };
    // A jobb gomb helyi menüje a játék közben csak útban van.
    window.addEventListener('contextmenu', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'CANVAS') e.preventDefault();
    });
    // A fejetlen próbában a `document` egy tok, amiben nincs eseménykezelő.
    // A bemenet nem feltételezhet teljes böngészőt: a mérés ugyanazt a kódot
    // futtatja, amit a játék, és egy hiányzó függvény ott az EGÉSZ próbát
    // megállítja — mérve 374 állításból 136 maradt.
    document.addEventListener?.('pointerlockchange', () => {
      this.locked = !!document.pointerLockElement;
    });

    // KÖRÜLNÉZÉS EGÉRREL: húzás a képen.
    //
    // Eddig csak a nyilak és a kontroller jobb karja forgatott. Egérrel
    // játszva a kamera mozdíthatatlan volt — a legtöbb ember pedig egérrel
    // ül le, és a nyilakhoz el kell venni a kezét a WASD mellől.
    //
    // A ráta ugyanaz a mértékegység, mint az érintésnél (képpont/mp), tehát
    // a két eszköz ugyanolyan gyorsan fordít, és nem kell külön hangolni.
    let lastT = 0;
    // (A húzás kezdete a fenti EGYETLEN mousedown-kezelőben van: lásd ott.)
    window.addEventListener('mousemove', (e) => {
      // BELSŐ NÉZETBEN A KURZORT KÖVETJÜK, húzás nélkül.
      //
      // A böngésző a mutató elkapását csak KATTINTÁS után engedi — ez az ő
      // szabálya, nem a miénk. Addig viszont nem kell tétlenül állni: belső
      // nézetben minden egérmozdulat nézés, gomb nélkül. A kattintás utáni
      // elkapás így már csak ráadás (nem ütközik a képernyő szélébe), nem
      // feltétel.
      if (this.locked || this.lookLock) {
        const now = performance.now();
        const dt = Math.max(8, now - lastT) / 1000;
        this.mouseX = e.movementX / dt;
        this.mouseY = e.movementY / dt;
        lastT = now;
        this.mouseAt = now;
        return;
      }
      if (!this.dragging) return;
      const now = performance.now();
      const dt = Math.max(8, now - lastT) / 1000;
      this.mouseX = (e.clientX - this.dragX) / dt;
      this.mouseY = (e.clientY - this.dragY) / dt;
      this.dragX = e.clientX;
      this.dragY = e.clientY;
      lastT = now;
      this.mouseAt = now;
    });
    const drop = () => {
      this.dragging = false;
      this.mouseX = 0;
      this.mouseY = 0;
    };
    window.addEventListener('mouseup', (e) => {
      if (e.button === 2) this.scopeHeld = false;
      drop();
    });
    window.addEventListener('mouseleave', drop);
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Call once per frame, before anything reads get(). */
  update(): void {
    const pads = navigator.getGamepads?.() ?? [];

    for (let i = 0; i < this.playerCount; i++) {
      const s = this.states[i];
      const pad = pads[i] ?? null;

      let moveX = 0;
      let moveY = 0;
      let jumpHeld = false;
      let sprint = false;
      let interactHeld = false;
      let pauseHeld = false;
      let nitro = false;
      let usingGamepad = false;

      if (pad && pad.connected) {
        const ax = applyDeadzone(pad.axes[0] ?? 0);
        const ay = applyDeadzone(pad.axes[1] ?? 0);
        const dpad = {
          up: pad.buttons[12]?.pressed ?? false,
          down: pad.buttons[13]?.pressed ?? false,
          left: pad.buttons[14]?.pressed ?? false,
          right: pad.buttons[15]?.pressed ?? false,
        };
        moveX = ax + (dpad.right ? 1 : 0) - (dpad.left ? 1 : 0);
        moveY = -ay + (dpad.up ? 1 : 0) - (dpad.down ? 1 : 0);
        jumpHeld = pad.buttons[0]?.pressed ?? false;
        interactHeld = pad.buttons[2]?.pressed ?? false;
        // Start (9) and Select/Share (8). Without this, a pair on two pads with
        // the keyboard out of reach cannot pause, cannot change a setting and
        // cannot quit — the only verb in the game unreachable from a pad.
        pauseHeld = (pad.buttons[9]?.pressed ?? false) || (pad.buttons[8]?.pressed ?? false);
        sprint = (pad.buttons[6]?.value ?? 0) > 0.5 || (pad.buttons[10]?.pressed ?? false);
        // A jobb felso gomb (RB): a padon ez esik kezre gyorsulas kozben.
        nitro = pad.buttons[5]?.pressed ?? false;
        usingGamepad = moveX !== 0 || moveY !== 0 || jumpHeld || sprint || interactHeld;
      }

      // AZ ÉRINTŐVEZÉRLŐ a helyi játékosé, és megelőzi a billentyűzetet: ha
      // az ujj a boton van, nem kell azt is figyelni, nyomva maradt-e egy
      // billentyű valahol.
      const touch = i === this.localIndex ? this.touch : null;
      const touching =
        !!touch &&
        (touch.state.moveX !== 0 || touch.state.moveY !== 0 || touch.state.jumpHeld ||
          touch.state.interactHeld || touch.state.nitro);

      if (touching && touch) {
        moveX = touch.state.moveX;
        moveY = touch.state.moveY;
        jumpHeld = touch.state.jumpHeld;
        interactHeld = touch.state.interactHeld;
        nitro = touch.state.nitro;
        sprint = touch.state.sprint;
      } else if (!usingGamepad) {
        // A BILLENTYUZET MINDIG A HELYI JATEKOSE, barmi is a sorszama.
        //
        // Ez okozta, hogy a masodik eszkozon ulo jatekosnak nem mozdult a
        // kocsi: halozatban o a JATEKOS 2, tehat a kodja a KEYMAPS[1]-et
        // olvasta — abbol viszont pont a mozgas tunt el, amikor az „egy
        // gepen ketten" mod kikerult. WASD-ot nyomott, es semmi nem tortent.
        const km = KEYMAPS[i === this.localIndex ? 0 : 1];
        const down = (codes: string[]) => codes.some((c) => this.held.has(c));
        moveX = (down(km.right) ? 1 : 0) - (down(km.left) ? 1 : 0);
        moveY = (down(km.up) ? 1 : 0) - (down(km.down) ? 1 : 0);
        jumpHeld = down(km.jump);
        sprint = down(km.sprint);
        interactHeld = down(km.interact);
        nitro = down(km.nitro);
      }

      const len = Math.hypot(moveX, moveY);
      if (len > 1) {
        moveX /= len;
        moveY /= len;
      }

      s.moveX = moveX;
      s.moveY = moveY;
      s.sprint = sprint;
      s.nitro = nitro;
      s.jumpHeld = jumpHeld;
      // A szünet gomb a képernyőről ÉLKÉNT jön (egyszer igaz), nem tartott
      // állapotként — ezért közvetlenül a várólistára kerül.
      if (touch?.consumePause()) this.pendingPause[i] = true;
      if (pauseHeld && !this.prevPause[i]) this.pendingPause[i] = true;
      this.prevPause[i] = pauseHeld;

      if (jumpHeld && !this.prevJump[i]) this.pendingJump[i] = true;
      if (interactHeld && !this.prevInteract[i]) this.pendingInteract[i] = true;

      s.pause = this.pendingPause[i];
      s.jump = this.pendingJump[i];
      s.interact = this.pendingInteract[i];
      s.interactHeld = interactHeld;
      s.usingGamepad = usingGamepad;
      this.prevJump[i] = jumpHeld;
      this.prevInteract[i] = interactHeld;
    }
  }

  /**
   * Egyszemélyes mód: melyik szörnyet irányítja az egyetlen játékos.
   *
   * `null` a kétfős játék — mindkét szörny a saját gombjairól megy. Ha be van
   * állítva, a MÁSIK szörny egy üres bemenetet kap: nem áll ellen, nem
   * mozdul, és minden páros feltétel (együtt kiszállni, együtt kijutni)
   * változatlanul érvényes — csak épp egymás után teljesíted őket.
   *
   * Ez a legolcsóbb egyszemélyes mód, ami a játék tervét nem írja át: a
   * co-op kapuk maradnak, mert azok arról szólnak, hogy KÉT szörnynek kell
   * ott lennie, nem arról, hogy két embernek.
   */
  soloActive: number | null = null;

  get(playerIndex: number): PlayerInput {
    if (this.soloActive !== null && playerIndex !== this.soloActive) {
      return InputManager.IDLE;
    }
    return this.states[playerIndex];
  }

  /**
   * Merre forgatja a jatekos a kamerat, most, ebben a pillanatban.
   *
   * Kulon all a `PlayerInput`-tol, es szandekosan: a kamera nem a szorny
   * bemenete. Ha a `moveX`-be kerulne, akkor egy halozati jatekban a tarsam
   * gepere is atmenne, hogy en epp korbenezek — ami nem az o dolga, es a
   * savszelesseget is arra kolteni, ami senki mast nem erdekel, pazarlas.
   *
   * `x` a fordulas (jobbra pozitiv), `y` a doles (fel pozitiv). Mindketto
   * -1..1, tehat a hivo `dt`-vel szorozza.
   */
  look(): { x: number; y: number } {
    let x =
      (this.held.has(LOOK_KEYS.right) ? 1 : 0) - (this.held.has(LOOK_KEYS.left) ? 1 : 0);
    let y = (this.held.has(LOOK_KEYS.up) ? 1 : 0) - (this.held.has(LOOK_KEYS.down) ? 1 : 0);

    // A jobb analog kar ugyanezt teszi. A 2-es es 3-as tengely a szabvanyos
    // kioszras szerinti jobb kar; ha a pad mast ad, a holtsav ugyis elnyeli.
    const pad = (navigator.getGamepads?.() ?? [])[0];
    if (pad?.connected) {
      const rx = applyDeadzone(pad.axes[2] ?? 0);
      const ry = applyDeadzone(pad.axes[3] ?? 0);
      if (rx) x = rx;
      if (ry) y = -ry;
    }

    // EGÉR: húzás a képen. 900 képpont/mp a teljes kitérés — ugyanaz a
    // skála, mint az érintésnél.
    if (performance.now() - this.mouseAt <= 90) {
      const k = 1 / 900;
      const mx = Math.max(-1, Math.min(1, this.mouseX * k));
      const my = Math.max(-1, Math.min(1, -this.mouseY * k));
      if (mx) x = mx;
      if (my) y = my;
    }

    // ÉRINTÉS: húzás ott, ahol nincs gomb.
    const t = this.touch?.look();
    if (t && (t.x || t.y)) {
      x = t.x;
      y = t.y;
    }

    return { x, y };
  }

  /** A nem irányított szörny bemenete: áll és nem csinál semmit. */
  private static readonly IDLE: PlayerInput = {
    moveX: 0,
    moveY: 0,
    jump: false,
    jumpHeld: false,
    interact: false,
    interactHeld: false,
    sprint: false,
    usingGamepad: false,
    pause: false,
    nitro: false,
  };

  /**
   * Clear the edge-triggered flags. With a fixed timestep a single frame can
   * run several simulation steps, and an un-consumed edge would fire a jump or
   * a prank once per step — so the loop calls this after the first step.
   */
  consumeEdges(): void {
    for (let i = 0; i < this.states.length; i++) {
      this.states[i].jump = false;
      this.states[i].interact = false;
      this.pendingJump[i] = false;
      this.pendingInteract[i] = false;
    }
  }

  /** Pause is consumed separately: it is read outside the simulation loop. */
  consumePause(): boolean {
    let pressed = false;
    for (let i = 0; i < this.states.length; i++) {
      if (this.pendingPause[i]) pressed = true;
      this.states[i].pause = false;
      this.pendingPause[i] = false;
    }
    return pressed;
  }
}
