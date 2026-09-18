/**
 * A játék hangja.
 *
 * Egyetlen `AudioContext`, mert a böngésző csak néhányat enged, és mindegyik
 * külön hardveres csatornát fog. A hangokat KÉT forrásból vesszük:
 *
 *   · zene — letöltött fájl, streamelve. Egy négymegás mp3-at nincs értelme
 *     dekódolva a memóriában tartani (az negyven megabájtnyi PCM lenne), és a
 *     kezdéshez sem kell megvárni a végét.
 *   · effektek — SZÁMOLVA, nem fájlból. Egy duda két-három szinusz, egy
 *     koccanás egy lecsengő zajlöket: néhány sor kód, nulla bájt, és bármikor
 *     hangolható. Ugyanez letöltött effektekből tíz fájl és fél megabájt.
 *
 * A böngésző csak felhasználói mozdulat után enged hangot. Ezért a kontextus
 * ALVA születik, és az első gombnyomás ébreszti — ez nem hibakezelés, hanem a
 * szabály: egy magától megszólaló oldal bosszantó, és a böngésző pont ezért
 * tiltja.
 */
export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private music: HTMLAudioElement | null = null;
  private muted = false;

  constructor() {
    if (typeof window === 'undefined') return;
    const scope = window as unknown as {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctor = scope.AudioContext ?? scope.webkitAudioContext;
    if (!Ctor) return;

    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.7;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.34;
    this.musicGain.connect(this.master);

    const wake = (): void => {
      void this.ctx?.resume().catch(() => {});
      void this.music?.play().catch(() => {});
    };
    window.addEventListener('keydown', wake);
    window.addEventListener('pointerdown', wake);
  }

  get enabled(): boolean {
    return this.ctx !== null && !this.muted;
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.7;
  }

  /** Zene indítása, hurokban. Ugyanaz a fájl kétszer hívva nem indul újra. */
  playMusic(url: string, volume = 1): void {
    if (!this.ctx || !this.musicGain) return;
    if (this.music && this.music.src.endsWith(url)) return;
    this.stopMusic();

    const element = new Audio(url);
    element.loop = true;
    try {
      const node = this.ctx.createMediaElementSource(element);
      const gain = this.ctx.createGain();
      gain.gain.value = volume;
      node.connect(gain).connect(this.musicGain);
    } catch {
      // Ha a csomópontot nem lehet bekötni, a fájl akkor is szól, csak a
      // közös hangerőszabályzón kívül. Hang nélkül maradni rosszabb.
      element.volume = 0.34 * volume;
    }
    void element.play().catch(() => {});
    this.music = element;
  }

  stopMusic(): void {
    this.music?.pause();
    this.music = null;
  }

  /**
   * A DUDA.
   *
   * Három hang egyszerre, és a lényeg a KÖZÉPSŐ: egy tiszta szinusz sípolás,
   * két egymáshoz közeli hang viszont lüktet — ettől lesz autókürt. A felső
   * felharmonikus adja a rezes élt.
   */
  horn(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(0.42, now + 0.02);
    gain.gain.setValueAtTime(0.42, now + 0.28);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.44);
    gain.connect(this.master);

    for (const [freq, level] of [
      [392, 1],
      [494, 0.85],
      [784, 0.25],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = freq;
      const trim = ctx.createGain();
      trim.gain.value = level * 0.5;
      osc.connect(trim).connect(gain);
      osc.start(now);
      osc.stop(now + 0.46);
    }
  }

  /**
   * GUMICSIKORGÁS — folyamatos, nem löketekben.
   *
   * A kocsinak eddig három hangja volt: motor, duda, koccanás. Drift közben
   * néma maradt, pedig a csúszás az egyetlen olyan dolog a vezetésben, amit a
   * játékos a HANGJÁRÓL szokott megítélni: a kanyar határát a fül méri, nem
   * a szem.
   *
   * Zajforrás sávszűrővel, és a szűrő közepe a csúszással nyílik. Egyetlen,
   * ÖRÖKKÉ FUTÓ forrás, aminek csak a hangereje mozog — mert újraindított
   * zajlöketekből géppuska lenne, nem csikorgás.
   */
  skid(level: number, speed01: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;

    if (!this.skidGain) {
      const seconds = 2;
      const buffer = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;

      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = 1400;
      band.Q.value = 3.4;

      const gain = ctx.createGain();
      gain.gain.value = 0;

      source.connect(band).connect(gain).connect(this.master);
      source.start();
      this.skidBand = band;
      this.skidGain = gain;
    }

    const now = ctx.currentTime;
    // Lassan csúszva halkabb: álló helyzetben pörgetve nem sikolt a gumi.
    const loud = Math.min(1, level) * Math.min(1, speed01 * 2.2) * 0.3;
    this.skidGain.gain.setTargetAtTime(loud, now, 0.05);
    // A csúszás a hangszínt is viszi feljebb — ettől lesz „éle" a hangnak.
    this.skidBand?.frequency.setTargetAtTime(1150 + level * 1250, now, 0.08);
  }

  private skidBand: BiquadFilterNode | null = null;
  private skidGain: GainNode | null = null;

  /** Elnémítja a csikorgást — jelenetváltáskor, szünetben. */
  skidOff(): void {
    if (this.skidGain && this.ctx) {
      this.skidGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.03);
    }
  }

  /**
   * FEGYVERHANG — fajtánként más, és a különbség INFORMÁCIÓ.
   *
   * Egy kétfős pályán a hangból kell megtudnod, mi történt a hátad mögött:
   * a sörétes azt jelenti, hogy valaki KÖZEL van valakihez; a mesterlövész
   * azt, hogy messziről figyelnek; a rakéta azt, hogy futni kell. Ha mind a
   * három ugyanúgy szólna, ez az egész elveszne.
   *
   * Mindhárom ugyanabból a két alkatrészből épül — zajlöket és egy hangolt
   * test —, csak az arányuk és a burkolójuk más:
   *
   *   sörétes      rövid, széles zaj, gyorsan lecsengő mély testtel
   *   mesterlövész pattanás: nagyon rövid, magas, hosszú farokkal
   *   rakéta       sziszegő indítás lefelé csúszó hanggal, mély dörrenéssel
   */
  gun(kind: 'shotgun' | 'sniper' | 'rocket'): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;

    const shape = {
      shotgun: { len: 0.32, cut: 2400, sweep: 260, body: 92, level: 0.55, q: 0.7 },
      sniper: { len: 0.5, cut: 5200, sweep: 1400, body: 220, level: 0.42, q: 3.2 },
      rocket: { len: 0.85, cut: 1200, sweep: 90, body: 48, level: 0.6, q: 1.1 },
    }[kind];

    // --- a zaj ---------------------------------------------------------------
    const length = Math.floor(ctx.sampleRate * shape.len);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // A burkoló a fegyver „személyisége": a sörétes azonnal esik, a
      // mesterlövésznek farka van, a rakéta elnyújtott.
      const fall = kind === 'sniper' ? Math.exp(-t * 9) : Math.exp(-t * (kind === 'rocket' ? 4 : 14));
      data[i] = (Math.random() * 2 - 1) * fall;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = shape.q;
    filter.frequency.setValueAtTime(shape.cut, now);
    // A szűrő LECSÚSZIK: ettől lesz a lövésnek „teste", nem sziszegése.
    filter.frequency.exponentialRampToValueAtTime(shape.sweep, now + shape.len);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(shape.level, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + shape.len);
    noise.connect(filter).connect(gain).connect(this.master);
    noise.start(now);
    noise.stop(now + shape.len);

    // --- a test: egy lecsúszó szinusz ---------------------------------------
    const osc = ctx.createOscillator();
    osc.type = kind === 'sniper' ? 'square' : 'sine';
    osc.frequency.setValueAtTime(shape.body * 3, now);
    osc.frequency.exponentialRampToValueAtTime(shape.body, now + shape.len * 0.6);
    const body = ctx.createGain();
    body.gain.setValueAtTime(shape.level * (kind === 'sniper' ? 0.18 : 0.7), now);
    body.gain.exponentialRampToValueAtTime(0.001, now + shape.len * 0.8);
    osc.connect(body).connect(this.master);
    osc.start(now);
    osc.stop(now + shape.len);
  }

  /** Újratöltés: két kattanás. A második azt mondja, hogy KÉSZ. */
  reloadClick(second = false): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(second ? 1400 : 900, now);
    osc.frequency.exponentialRampToValueAtTime(second ? 700 : 420, now + 0.05);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.18, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    osc.connect(gain).connect(this.master);
    osc.start(now);
    osc.stop(now + 0.08);
  }

  /** Koccanás: rövid zajlöket, mélyre szűrve. Az erő a szűrőt is nyitja. */
  thud(strength: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;

    const length = Math.floor(ctx.sampleRate * 0.25);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
    }

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 220 + strength * 500;
    const gain = ctx.createGain();
    gain.gain.value = Math.min(0.7, 0.2 + strength * 0.5);
    src.connect(filter).connect(gain).connect(this.master);
    src.start(now);
  }

  /**
   * A motor. `null`, ha nincs hangkontextus.
   *
   * A SZÁMOLT változat szól — visszatérve hozzá.
   *
   * Megcsináltam a szakma szerinti megoldást is: nyolc fordulatsávra bontott
   * hurok egy valódi CC0 felvételből, 3,3 félhangos legnagyobb nyújtással,
   * oktávval mélyebb alsó réteggel. A SZÁMOK jobbak lettek — a felvételek
   * textúráját szintézissel tényleg nem lehet utolérni.
   *
   * A felhasználó mégis a számoltat kérte vissza, és ez nem vitatéma: a
   * hang nem mérés kérdése. Egy kis négyhengeres felvétele hiába pontosabb,
   * ha a szintetizált V8 az, ami ehhez a játékhoz illik.
   *
   * A mintás motor MARAD a kódban, a nyolc hurokkal együtt — ha egyszer egy
   * öblösebb forrás kerül elő, egyetlen sor visszakapcsolni.
   */
  startEngine(): Engine | null {
    if (!this.ctx || !this.master) return null;
    return new Engine(this.ctx, this.master);
  }

  /** Cukorka felvéve: rövid, emelkedő csilingelés. */
  pickup(): void {
    const ctx = this.ctx;
    if (!ctx || !this.master || this.muted) return;
    const now = ctx.currentTime;

    [880, 1320].forEach((freq, i) => {
      const at = now + i * 0.07;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.linearRampToValueAtTime(0.25, at + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.22);
      osc.connect(gain).connect(this.master!);
      osc.start(at);
      osc.stop(at + 0.24);
    });
  }
}

/** Egyetlen példány: a böngésző csak néhány hangkontextust enged. */
export const sound = new Sound();

/**
 * A MOTOR.
 *
 * Első nekifutásra oszcillátorokat raktam egymásra a gyújtásfrekvencia
 * felharmonikusain. A felhasználó szava rá: „nem túl élethű" — és igaza volt.
 * Az úgy egy zúgó orgona, mert egy motor NEM folyamatos hang.
 *
 * Amiből valójában áll:
 *
 *   1. LÖKÉSSOROZAT. Minden gyújtás egy külön ütés — egy éles, lecsengő
 *      zajlöket plusz egy mély dobbanás. A hang ezeknek a sorozata, nem egy
 *      kitartott hullám. Ezért a forrás egy hurkolt PUFFER, amiben egy
 *      lökéssorozat van, és a fordulatot a LEJÁTSZÁSI SEBESSÉG adja.
 *
 *   2. RÖGZÍTETT REZONANCIÁK. A kipufogó egy cső: mindig ugyanazokon a
 *      frekvenciákon szól, akármilyen fordulaton jár a motor. Pont mint az
 *      emberi hang — a hangmagasság mozog, a formánsok maradnak. Ezért a
 *      sávszűrők a forrás UTÁN vannak, fix frekvencián: a lejátszási sebesség
 *      nem viszi őket magával.
 *
 *   3. SZABÁLYTALANSÁG. A pufferben minden lökés kicsit máskor és máshogy
 *      szól. Tökéletesen egyenletes lökések tiszta hangot adnak ki — az megint
 *      síp lenne, nem motor.
 *
 *   4. TORZÍTÁS TERHELÉS ALATT. A reccsenés nem hangosabb hang, hanem TÖRTEBB:
 *      a hullám teteje levágódik. Ez adja az M4 rezes élét.
 *
 * Sorhatos: négyütemű hathengeres fordulatonként háromszor gyújt.
 */
/**
 * Egy motor jellemrajza.
 *
 * Nem hangolási beállítások gyűjteménye: a `pattern` mezőben a motor
 * GYÚJTÁSRENDJE van, és az dönti el, milyen családba tartozik. Két motor,
 * aminek minden más paramétere egyezik, de más a gyújtásrendje, két
 * különböző hangszer.
 */
export interface EngineProfile {
  /** Alapjárat és vörös tartomány, fordulat/perc. */
  idle: number;
  redline: number;
  /**
   * Hol gyújtanak a hengerek EGY fordulaton belül (0..1), és milyen erősen.
   *
   * Itt dől el a karakter. Egy síksíkú (flat-plane) motor gyújtásai
   * egyenletesek — abból lesz a Ferrari-sikoly. Egy KERESZTSÍKÚ amerikai V8
   * gyújtásai egyenetlenül oszlanak el, mert a 90 fokos forgattyú miatt a két
   * hengersor lüktetése nem esik egybe: 180-180-270-90 fok. Ez az
   * egyenetlenség maga a dörmögés — nem effekt, hanem geometria.
   */
  pattern: Array<[number, number]>;
  /** A kipufogó rezonanciái: frekvencia, jósági tényező, hangerő. */
  formants: Array<[number, number, number]>;
  /** A cső hossza ezredmásodpercben. Hosszabb = öblösebb. */
  pipeMs: number;
  /** A gyújtás mély nyomáshullámának frekvenciája és lecsengése. */
  thumpHz: number;
  thumpDecay: number;
  /**
   * ALAPJÁRATI gyújtáskép — külön a menetitől.
   *
   * Nem hangerő kérdése: alapjáraton a hengerek közti különbség ARÁNYOSAN
   * sokkal nagyobb, mert kevés a befecskendezett üzemanyag és a motor a
   * saját tehetetlenségén él. Ettől lötyög az alapjárat, és ettől ismerni
   * meg egy nagy V8-at állóhelyzetben is. Ugyanazzal a mintával halkítva
   * csak egy halk menethang lenne.
   */
  idlePattern: Array<[number, number]>;
  idleThumpDecay: number;
}

/**
 * Sorhatos, feltöltve (BMW M4).
 *
 * Fordulatonként három, EGYENLETES gyújtás. Tiszta, magas, rezes — a
 * hengerek közti apró eltérés adja az élet.
 */
export const INLINE_SIX: EngineProfile = {
  idle: 820,
  redline: 7400,
  pattern: [
    [0 / 3, 1.0],
    [1 / 3, 0.9],
    [2 / 3, 1.07],
  ],
  formants: [
    [64, 9, 1.4],
    [148, 7, 0.95],
    [390, 5, 0.34],
    [1050, 4, 0.14],
  ],
  pipeMs: 11,
  thumpHz: 54,
  thumpDecay: 30,
  idlePattern: [
    [0 / 3, 1.15],
    [1 / 3, 0.78],
    [2 / 3, 1.05],
  ],
  idleThumpDecay: 19,
};

/**
 * Keresztsíkú V8, kompresszorral (Corvette Z06).
 *
 * Fordulatonként négy gyújtás, de NEM egyenletesen: a 90 fokos forgattyú
 * miatt a lüktetés 180-180-270-90 fokos osztásban érkezik. Ez az, amitől
 * egy amerikai V8 dörmög és nem sikolt — ugyanez a motor síksíkú
 * forgattyúval Ferrari-hangot adna.
 *
 * Minden más ebből következik: alacsonyabb vörös tartomány, mélyebb
 * rezonanciák, hosszabb cső, lomhábban csengő nyomáshullám.
 */
export const CROSSPLANE_V8: EngineProfile = {
  idle: 680,
  redline: 6500,
  pattern: [
    [0.0, 1.15],
    [0.25, 0.82],
    [0.5, 1.0],
    [0.875, 0.9],
  ],
  formants: [
    [48, 10, 1.6],
    [112, 8, 1.1],
    // Egy SZÉLES középső rezonancia a reszelősséghez: alacsony jósági
    // tényezővel nem cseng, hanem egy egész sávot emel meg — ott, ahol a
    // fül a „rekedt" hangot hallja.
    [330, 1.6, 0.6],
    [760, 4, 0.1],
  ],
  pipeMs: 16,
  thumpHz: 41,
  thumpDecay: 21,
  // Alapjáraton a keresztsíkú V8 lötyögése a legerősebb: az egyenetlen
  // osztáshoz egyenetlen erő is társul, és a lecsengés hosszabb — ettől
  // dobol, nem duruzsol.
  idlePattern: [
    [0.0, 1.35],
    [0.25, 0.62],
    [0.5, 1.12],
    [0.875, 0.68],
  ],
  idleThumpDecay: 13,
};

/**
 * Hol vált az alapjárati hangkép a menetire.
 *
 * Fordulatban, nem sebességben: állva felbőgetve is a menethang a helyes,
 * mert a motor tényleg úgy szól. A sáv széles, hogy az átúszás ne legyen
 * hallható pillanat.
 */
const THREE_STATE_LOW = 1150;
const THREE_STATE_HIGH = 2400;

export class Engine {
  private readonly source: AudioBufferSourceNode;
  /** Külön forrás az ALAPJÁRATNAK, saját gyújtásképpel. */
  private readonly idleSource: AudioBufferSourceNode;
  private readonly idleGain: GainNode;
  private readonly driveGain: GainNode;
  /** Az ELINDULÁS külön rétege: mély nyomaték, csak alacsony fordulaton. */
  private readonly launch: BiquadFilterNode;
  private readonly launchGain: GainNode;
  private lastSpeed = 0;
  private readonly shaper: WaveShaperNode;
  private readonly bands: BiquadFilterNode[] = [];
  private readonly bandGains: GainNode[] = [];
  private readonly tone: BiquadFilterNode;
  private readonly noiseGain: GainNode;
  private readonly out: GainNode;
  private rpm = 700;
  /** Váltás közbeni nyomatékkimaradás hátralévő ideje. */
  private shiftCut = 0;
  /** 1 közvetlenül váltás után, és nullára cseng le, ahogy a motor újra nekifeszül. */
  private rebuild = 0;
  private lastGear = 0;
  /** Mennyire van felpörögve a turbó: nyomás nem épül azonnal. */
  private spool = 0;
  /** A turbó sípja: a fordulattal és a terheléssel emelkedik. */
  private readonly turbo: OscillatorNode;
  private readonly turboGain: GainNode;
  /** A gáz előző állása — a levételt ebből ismerjük fel. */
  private lastThrottle = 0;
  /** Meddig pattog még a kipufogó gázelvételkor. */
  private popLeft = 0;
  /** A fordulatkorlátozó szaggatásának fázisa. */
  private limiter = 0;
  /** A vörösben kalapál-e épp — a HUD-nak és a mérésnek. */
  onLimiter = false;

  /**
   * NINCS SEBESSÉGVÁLTÓ.
   *
   * Volt, és rossz volt. Öt fokozattal a 0–120 gyorsulás alatt négyszer
   * váltott a hang, hárommal kétszer — és a felhasználó mindkettőre azt
   * mondta, hogy nem így emelkedik egy autó hangja. Igaza van abban, ami
   * itt számít: egy JÁTÉKBAN a hang dolga az, hogy megmondja, milyen
   * gyorsan mész. A váltás ezt minden alkalommal ELVÁGJA — a fordulat
   * visszaesik, miközben a sebesség tovább nő, tehát a hang pont az
   * ellenkezőjét mondja, mint ami történik.
   *
   * Ezért a fordulat most EGYENESEN a sebességet követi, végig. A kitevő
   * teszi, hogy alacsony sebességen érezhetőbb legyen a változás: ott a
   * szem kevesebb támpontot ad, tehát a hangnak kell dolgoznia.
   */
  /**
   * Hol ér a fordulat a VÖRÖSBE, a végsebesség hányadánál.
   *
   * Pontosan 1,0 volt, és emiatt a limiter gyakorlatilag soha nem szólalt
   * meg: a légellenállás miatt a kocsi ASZIMPTOTIKUSAN közelíti a
   * végsebességet, tehát a 98,5%-os küszöböt csak elméletben érte el. A
   * hang a maxon egyszerűen „beállt", ami géphangzás — egy igazi autó a
   * végsebességén a limiteren kalapál.
   *
   * 0,94: a legfelső hat százalék sebesség végig a vörösben van, tehát
   * amikor kinyomod, tényleg hallod, hogy nincs feljebb.
   */
  private static readonly REDLINE_AT = 0.94;

  private static rpmFor(v: number, maxSpeed: number, idle: number, redline: number): number {
    const t = Math.min(1, v / (Math.max(0.001, maxSpeed) * Engine.REDLINE_AT));
    return idle + (redline - idle) * Math.pow(Math.min(1, t), 0.78);
  }

  /**
   * KÉT VÁLTÁS az egész gyorsulás alatt — nem több.
   *
   * Öt fokozattal a hang négyszer vágódott el, hárommal kétszer, és egyikre
   * sem mondta a felhasználó, hogy jó. A baj nem a váltás volt, hanem a
   * SŰRŰSÉGE: ami másodpercenként megtörténik, az nem esemény, hanem zaj.
   *
   * Két váltás viszont dramaturgia. Mindkettő után a motor HANGOSABBAN húz,
   * mint előtte — a valóságban ez fordítva van (a magasabb fokozat
   * halkabb), de itt a hang a sebességről szól, és a sebesség nő. A
   * túlzás szándékos.
   */
  private static readonly SHIFTS = [0.36, 0.68];
  static readonly SHIFT_GAIN = [1, 1.18, 1.38];

  /** Hányadik fokozatban vagyunk a sebesség alapján. */
  /**
   * @param current Melyik fokozatban vagyunk MOST. A hiszterézishez kell.
   *
   * Hiszterézis nélkül a váltáspont egy éles küszöb: aki pont annál a
   * sebességnél cirkál, annál a fokozat képkockánként oda-vissza ugrál, és a
   * lefúvatás másodpercenként hatvanszor szólal meg. Visszaváltani csak
   * három százalékkal lejjebb lehet, mint felváltani.
   */
  static gearAt(v: number, maxSpeed: number, current = 0): number {
    const t = v / Math.max(0.001, maxSpeed);
    let gear = 0;
    while (gear < Engine.SHIFTS.length && t > Engine.SHIFTS[gear]) gear++;
    if (gear === current - 1 && t > Engine.SHIFTS[gear] - 0.03) return current;
    return gear;
  }
  /** A puffer alap-FORDULATSZÁMA (ford/mp). A lejátszási sebesség ehhez arányosít. */
  private static readonly BASE_REV = 20;

  /**
   * A kipufogó rezonanciái. Fix frekvenciák — ezek NEM mozognak a
   * fordulattal, és pont ettől hangzik csőnek és nem szintetizátornak.
   */


  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode,
    private readonly profile: EngineProfile = CROSSPLANE_V8
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    // A hangszín-szűrő a lánc VÉGÉN: gázra nyílik, alapjáraton tompít.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 700;
    this.tone.Q.value = 0.7;

    // A CSŐ: rövid késleltetés visszacsatolással. A hang visszaverődik a
    // cső végéről, és önmagával találkozik — ez az öblösség forrása.
    //
    // A visszacsatolt ág TOMPÍTVA megy vissza: egy valódi cső a magas
    // hangokat nyeli el jobban, és csillapítás nélkül a kör begerjedne.
    const delay = ctx.createDelay(0.1);
    delay.delayTime.value = profile.pipeMs / 1000;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.52;
    const damp = ctx.createBiquadFilter();
    damp.type = 'lowpass';
    damp.frequency.value = 900;
    delay.connect(damp).connect(feedback).connect(delay);

    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    delay.connect(wet).connect(this.out);

    this.tone.connect(delay);
    this.tone.connect(this.out);

    // Rezonanciák párhuzamosan, mindegyik saját hangerővel.
    for (const [freq, q, level] of profile.formants) {
      const band = ctx.createBiquadFilter();
      band.type = 'bandpass';
      band.frequency.value = freq;
      band.Q.value = q;
      const gain = ctx.createGain();
      gain.gain.value = level;
      band.connect(gain).connect(this.tone);
      this.bands.push(band);
      this.bandGains.push(gain);
    }

    // Torzító: terhelés alatt vágja a hullám tetejét.
    this.shaper = ctx.createWaveShaper();
    this.shaper.curve = Engine.curve(0.2);
    for (const band of this.bands) this.shaper.connect(band);

    // Két forrás, két gyújtáskép, közös kipufogó. A hangképük különbözik, a
    // csövük nem — egy autó van, nem kettő.
    this.driveGain = ctx.createGain();
    this.driveGain.gain.value = 0;
    this.driveGain.connect(this.shaper);

    this.idleGain = ctx.createGain();
    this.idleGain.gain.value = 1;
    this.idleGain.connect(this.shaper);

    this.source = ctx.createBufferSource();
    this.source.buffer = Engine.pulseTrain(ctx, profile, false);
    this.source.loop = true;
    this.source.connect(this.driveGain);
    this.source.start();

    this.idleSource = ctx.createBufferSource();
    this.idleSource.buffer = Engine.pulseTrain(ctx, profile, true);
    this.idleSource.loop = true;
    this.idleSource.connect(this.idleGain);
    this.idleSource.start();

    // AZ ELINDULÁS rétege: egy keskeny mélykiemelés, ami csak akkor szól,
    // amikor a kocsi teljes gázzal, alacsony fordulaton húz. Ez a
    // nyomatékérzet — az a mély morgás, amit egy nagy motor elinduláskor ad,
    // és ami menet közben eltűnik.
    this.launch = ctx.createBiquadFilter();
    this.launch.type = 'peaking';
    this.launch.frequency.value = 72;
    this.launch.Q.value = 1.1;
    this.launch.gain.value = 0;
    this.launchGain = ctx.createGain();
    this.launchGain.gain.value = 1;
    this.tone.connect(this.launch).connect(this.launchGain).connect(this.out);

    // Szívászaj: külön réteg, a gáztól függ. Ez a turbó és a levegő.
    const noiseLength = ctx.sampleRate * 2;
    const noiseBuffer = ctx.createBuffer(1, noiseLength, ctx.sampleRate);
    const noise = noiseBuffer.getChannelData(0);
    for (let i = 0; i < noiseLength; i++) noise[i] = Math.random() * 2 - 1;
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer;
    hiss.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.9;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    hiss.connect(band).connect(this.noiseGain).connect(this.out);
    hiss.start();

    // A TURBÓ. Egy vékony síp, ami a fordulattal emelkedik — ez az a hang,
    // amiről egy feltöltött motort meg lehet ismerni. Halk: ha kihallatszik,
    // játékgépnek hangzik.
    this.turbo = ctx.createOscillator();
    this.turbo.type = 'sine';
    this.turbo.frequency.value = 2000;
    this.turboGain = ctx.createGain();
    this.turboGain.gain.value = 0;
    this.turbo.connect(this.turboGain).connect(this.out);
    this.turbo.start();
  }

  /**
   * LEFÚVATÁS: a felesleges töltőnyomás kiszökése.
   *
   * Zaj, gyors felfutással és lassabb lecsengéssel, sávszűrve — a „pssh".
   * Nem a kipufogón megy ki, hanem a szívóoldalon, ezért NEM a
   * rezonanciákon keresztül szól, hanem közvetlenül: máshonnan jön, mint a
   * motorhang, és pont ettől hallatszik külön dolognak.
   */
  private blowOff(level: number): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.45);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // Gyorsan nyit, lassan záródik — ahogy egy szelep.
      data[i] = (Math.random() * 2 - 1) * Math.min(1, t * 22) * Math.pow(1 - t, 1.6);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2600;
    band.Q.value = 0.8;
    const gain = ctx.createGain();
    gain.gain.value = level * 0.22;
    src.connect(band).connect(gain).connect(this.out);
    src.start(now);
  }

  /**
   * Kipufogópukkanás.
   *
   * Gázelvételkor a hengerbe jutott, el nem égett keverék a forró
   * kipufogóban ég el — innen a durranás. Ez az egyik legjellegzetesebb
   * hangja egy feltöltött sportmotornak, és pontosan akkor szól, amikor a
   * játékos leveszi a gázt: vagyis KÖVETI a vezetést, nem díszít.
   */
  private pop(level: number): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.09);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 2.2);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.value = level;
    // A pukkanás is a KIPUFOGÓN megy ki: ugyanazokon a rezonanciákon.
    src.connect(gain);
    for (const band of this.bands) gain.connect(band);
    src.start(now);
  }

  /**
   * Egy másodpercnyi lökéssorozat.
   *
   * Minden lökés: éles zajtüske (a robbanás) + mély lecsengő szinusz (a
   * nyomáshullám). A két összetevő aránya a fontos — csak zajjal sziszeg,
   * csak szinusszal búg.
   */
  private static pulseTrain(
    ctx: AudioContext,
    profile: EngineProfile,
    idle: boolean
  ): AudioBuffer {
    const rate = ctx.sampleRate;
    const buffer = ctx.createBuffer(1, rate, rate);
    const data = buffer.getChannelData(0);
    // Egy FORDULAT hossza mintában. A lökések ezen belül a gyújtásrend
    // szerint oszlanak el — ez a döntő különbség a motorcsaládok között.
    const rev = rate / Engine.BASE_REV;

    let seed = 12345;
    const rnd = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (let r = 0; r < Engine.BASE_REV; r++) {
      const pattern = idle ? profile.idlePattern : profile.pattern;
      const decay = idle ? profile.idleThumpDecay : profile.thumpDecay;
      for (const [at, weight] of pattern) {
        // Szabálytalanság: a gyújtás nem órajel. Néhány ezrelék eltérés
        // időben és erőben elég, hogy ne tiszta hang legyen belőle.
        const jitter = (rnd() - 0.5) * rev * 0.012;
        const strength = (0.88 + rnd() * 0.2) * weight;
        const start = Math.floor((r + at) * rev + jitter);
        const length = Math.floor(rev * 0.5);

        for (let i = 0; i < length; i++) {
          const index = (start + i) % rate;
          const t = i / rate;
          // A zajtüske nagyon gyorsan cseng le: ez a robbanás éle.
          // A REKEDTSÉG forrása, és sokkal hangosabb, mint elsőre volt.
          //
          // Egy motor reszelős hangja nem folyamatos sziszegés, hanem a
          // gyújtásokkal EGYÜTT lüktető zaj: minden robbanás egy adag
          // levegőt lök ki. Állandó sávszűrt zajjal ezt nem lehet pótolni —
          // az sípol vagy susog, de nem reszel, mert nincs ritmusa.
          //
          // A lecsengés is lassabb (900 → 260): egy gyors tüske kattanás,
          // egy hosszabb zajlöket viszont pöfögés.
          const crack = (rnd() * 2 - 1) * Math.exp(-t * 260);
          // A mély nyomáshullám a csőben. Ennek a frekvenciája és lecsengése
          // a motor jellemrajzából jön: egy V8 lomhábban és mélyebben dobban.
          const thump =
            Math.sin(t * Math.PI * 2 * profile.thumpHz) * Math.exp(-t * decay);
          // Alapjáraton kevesebb a reszelős zaj és több a dobbanás: nincs
          // mit reszelni, ha alig áramlik levegő.
          const rasp = idle ? 0.35 : 0.85;
          data[index] += (crack * rasp + thump * 0.9) * strength;
        }
      }
    }

    // Normalizálás, hogy a torzító mindig ugyanabból a szintből dolgozzon.
    let peak = 0;
    for (let i = 0; i < rate; i++) peak = Math.max(peak, Math.abs(data[i]));
    if (peak > 0) for (let i = 0; i < rate; i++) data[i] /= peak;
    return buffer;
  }

  /** Lágy vágás. Nagyobb `drive` = törtebb hullám = rezesebb hang. */
  private static curve(drive: number): Float32Array<ArrayBuffer> {
    const n = 1024;
    const curve = new Float32Array(new ArrayBuffer(n * 4));
    const k = 1 + drive * 28;
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = Math.tanh(x * k) / Math.tanh(k);
    }
    return curve;
  }

  /**
   * @param speed    a kocsi sebessége (m/s, előjeles)
   * @param maxSpeed a végsebesség
   * @param throttle 0..1, mennyire nyomja a gázt
   */
  update(speed: number, maxSpeed: number, throttle: number, dt: number): void {
    const v = Math.abs(speed);

    // Melyik fokozat. A váltás pontján a fordulat VISSZAESIK — ez a hallható
    // lépcső, amitől sebességváltós autónak hangzik, nem villanymotornak.
    // A VÁLTÁS pillanata: rövid nyomatékkimaradás. A fordulat NEM esik
    // vissza — az vágná el az emelkedést, amit az imént szüntettünk meg —,
    // csak a hang csuklik meg egy pillanatra, ahogy a nyomaték kimarad.
    const gear = Engine.gearAt(v, maxSpeed, this.lastGear);
    if (gear !== this.lastGear) {
      if (gear > this.lastGear) {
        this.shiftCut = 0.14;
        // Váltáskor a fojtószelep egy pillanatra zár, és a töltőnyomásnak
        // ki kell szöknie valahol. Ez a hang köti össze a két fokozatot.
        this.blowOff(0.52);
        this.spool *= 0.4;
        // ÚJRA FELHÚZ. A váltás eddig csak megcsuklott, aztán ugyanott
        // folytatta — a fokozat „elfogyása" nem volt hallható esemény.
        //
        // A fordulat most sem esik vissza (azt kétszer is elutasítottad, és
        // igazad volt: közben a sebesség nő, tehát a lefelé csúszó hang az
        // ellenkezőjét mondaná, mint ami történik). Helyette a TERHELÉS esik
        // ki egy pillanatra és épül vissza: a motor kifújja magát, aztán
        // újra nekifeszül. Ugyanaz a dramaturgia, ellentétes irányú hiba
        // nélkül.
        this.rebuild = 1;
      }
      this.lastGear = gear;
    }
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    // Nyolcadmásodperces kimaradás, aztán háromnegyed másodperc visszaépülés.
    this.rebuild = Math.max(0, this.rebuild - dt / 0.75);

    const rolling = v > 0.25;
    const target = rolling
      ? Engine.rpmFor(v, maxSpeed, this.profile.idle, this.profile.redline)
      // Állva a gáz 3400 fordulatig visz. Volt 1400, és az kevés volt: a
      // pukkanások 3200 fölött indulnak, tehát egy gázfröccs sosem csattant.
      // Most a bőgetés végigmegy a teljes jeleneten — felpörög, kipufog,
      // visszaesik.
      : this.profile.idle + throttle * 3400;
    // Felfutás gyorsabb, mint a visszaesés: egy motor beleugrik a gázba, és
    // lassabban ereszkedik vissza.
    const rate = target > this.rpm ? 7 : 3.2;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-rate * dt));

    const now = this.ctx.currentTime;
    // A lejátszási sebesség a FORDULATOT követi, nem a gyújtásfrekvenciát: a
    // gyújtásrend már bele van sütve a pufferbe. Mindkét réteg ugyanarra a
    // fordulatra jár — csak a hangképük más.
    const speedRatio = this.rpm / 60 / Engine.BASE_REV;
    this.source.playbackRate.setTargetAtTime(speedRatio, now, 0.03);
    this.idleSource.playbackRate.setTargetAtTime(speedRatio, now, 0.03);

    // --- HÁROM ÁLLAPOT ------------------------------------------------------
    //
    // Nem három hangfájl, hanem három RÉTEG, amik átúsznak egymásba. Kemény
    // váltással hallható lenne a pillanat, amikor a játék „átkapcsol" — és
    // pont az árulná el, hogy nem egy motor szól.
    //
    //   ÁLLÓ         a lötyögő alapjárati gyújtáskép, mély, reszelés nélkül
    //   ELINDULÁS    teljes gáz alacsony fordulaton: mélykiemelés, nyomaték
    //   MENET        a rendes gyújtáskép, reszelősen, a fordulattal emelkedve
    //
    // A határok a fordulatból és a terhelésből jönnek, nem a sebességből:
    // állva felbőgetve is a menethang szól, ahogy kell.
    const blend = Math.min(
      1,
      Math.max(0, (this.rpm - THREE_STATE_LOW) / (THREE_STATE_HIGH - THREE_STATE_LOW))
    );
    this.driveGain.gain.setTargetAtTime(blend, now, 0.12);
    this.idleGain.gain.setTargetAtTime(1 - blend * 0.85, now, 0.12);

    // Az elindulás: teljes gáz, alacsony fordulat, és a kocsi TÉNYLEG gyorsul.
    // A harmadik feltétel nélkül a fal felé nyomott gáz is így szólna.
    const accelerating = v > this.lastSpeed + 0.01;
    this.lastSpeed = v;
    const pulling =
      throttle > 0.55 && accelerating && this.rpm < this.profile.redline * 0.55 ? 1 : 0;
    this.launch.gain.setTargetAtTime(pulling * 9 * (1 - blend * 0.5), now, 0.15);

    const load = Math.min(1, throttle * 0.75 + (v / maxSpeed) * 0.45);
    // Erősebb torzítás: a rekedtség másik fele. A hullám teteje levágódik,
    // és a keletkező páratlan felharmonikusok adják a reszelős élt.
    this.shaper.curve = Engine.curve(0.3 + load * 0.75);
    // A hangszínszűrő alsó vége is lejjebb: alapjáraton tompább, telítettebb.
    this.tone.frequency.setTargetAtTime(380 + load * 3800 + this.rpm * 0.3, now, 0.05);
    // Az ÁLLANDÓ sziszegés is vissza: a zaj most a lökésekben van, ahol a
    // helye. Ami itt marad, az a szívás alapzöreje, nem a karakter.
    this.noiseGain.gain.setTargetAtTime(0.006 + load * 0.016, now, 0.09);

    // A turbó sípja a fordulattal emelkedik, a hangereje a terheléssel. A
    // kettő nem ugyanaz: alapjáraton is pörög, csak nem hallani.
    // A TURBÓ — de csak OTT, AHOL VALÓBAN VAN.
    //
    // Elsőre végig szólt, és a felhasználó joggal mondta, hogy „ne fütyüljön
    // annyit": egy folyamatos szinusz nem tartozik a motorhoz, hanem RAJTA
    // ül. Aztán majdnem kivettem — az meg túl kevés lett.
    //
    // A helyes válasz nem hangerő, hanem IDŐZÍTÉS. Egy turbó két pillanatban
    // hallatszik, és csak akkor:
    //
    //   · FELPÖRGÉS — gáz alatt, a fordulattal emelkedve. Ez a sípolás, és
    //     minél tovább tart a húzás, annál erősebb: a töltőnyomás épül.
    //   · LEFÚVATÁS — amikor a gáz elmegy (váltás, levétel), a felesleges
    //     nyomás kiszökik. Ez a „pssh", és ez az, amitől feltöltöttnek
    //     hangzik egy autó.
    //
    // Gurulás közben, gáz nélkül néma, ahogy kell.
    this.spool += ((throttle > 0.5 && rolling ? 1 : 0) - this.spool) * (1 - Math.exp(-1.6 * dt));
    this.turbo.frequency.setTargetAtTime(520 + this.rpm * 0.42, now, 0.1);
    this.turboGain.gain.setTargetAtTime(this.spool * load * 0.055, now, 0.1);

    // GÁZELVÉTEL: lefúvatás és pukkanás. Csak magas fordulatról — alacsonyan
    // nincs miből.
    const lifted = this.lastThrottle > 0.6 && throttle < 0.2;
    if (lifted && this.rpm > 3200) {
      this.pop(0.5);
      this.popLeft = 0.55;
      this.blowOff(0.55);
    }
    this.lastThrottle = throttle;

    // A pukkanások VÉLETLENSZERŰEN jönnek még egy darabig: egy szabályos
    // sorozat géppuskának hangzik, nem kipufogónak.
    if (this.popLeft > 0) {
      this.popLeft -= dt;
      if (Math.random() < dt * 9) this.pop(0.18 + Math.random() * 0.22);
    }

    // FORDULATKORLÁTOZÓ.
    //
    // A vörös tartomány tetején a vezérlés elveszi a gyújtást, és a motor
    // SZAGGAT — ez az egyik legjellegzetesebb hangja egy sportautónak, és
    // egyben az egyetlen visszajelzés arról, hogy nincs feljebb. Enélkül a
    // hang egyszerűen „beáll" a végsebességen, ami géphangzás.
    //
    // A szaggatás gyors (kb. 22 Hz) és nem teljes: a nyomaték nem tűnik el,
    // csak megcsuklik.
    let limit = 1;
    this.onLimiter = this.rpm > this.profile.redline * 0.975 && throttle > 0.35;
    if (this.onLimiter) {
      // Gyorsabb és keményebb, mint volt.
      //
      // Huszonkét radián/mp az 3,5 Hz — az nem szaggatás, az lüktetés. Egy
      // valódi gyújtáselvétel másodpercenként tíz-tizenöt alkalommal vág be
      // és ki, és a vágás MÉLY: a nyomaték tényleg eltűnik egy pillanatra,
      // nem csak halkul. Ez a kettő adja azt a „köpköd, kalapál" hangot,
      // ami a végsebességet megkülönbözteti a gyorsulástól.
      this.limiter += dt * 84;
      const cut = Math.sin(this.limiter);
      limit = cut > 0.15 ? 1 : 0.1;
      // ...és a fordulat KICSIT megroggyan a vágás alatt. Enélkül a hangerő
      // ugrál, a hangmagasság viszont kőmereven áll, és az géphangzásnak
      // hallatszik, nem motornak.
      //
      // A szám először 8400 fordulat/MÁSODPERC volt — több, mint a teljes
      // vörös tartomány —, és az nem roggyanás, hanem rángatás: a hang
      // végsebességen fel-le söpört, ami ismételt VÁLTÁSNAK hallatszott.
      // Háromszázötven: érezhető, de nem hagyja el a vörös tartományt.
      if (cut <= 0.15) {
        this.rpm = Math.max(this.profile.redline * 0.955, this.rpm - 350 * dt);
      }
    }

    // MOTORFÉK: gázelvételkor a hang nemcsak tompul, hanem VÉKONYODIK is. A
    // szűrő önmagában csak sötétebbé tenné, ugyanolyan hangosan — pedig egy
    // gázról levett motor érezhetően halkabb, miközben még magasan jár.
    const coasting = throttle < 0.15 && rolling ? 0.62 : 1;


    // A váltás utáni visszaépülés: a terhelés nulláról nő vissza, tehát a
    // hang a váltás után ÉRZÉKELHETŐEN erősödik. Ez az, ami a „elfogyott a
    // fokozat, most újra nekimegy" érzést adja.
    const swell = 1 - this.rebuild * 0.42;
    this.out.gain.setTargetAtTime(
      (0.14 + load * 0.2) *
        limit *
        swell *
        coasting *
        Engine.SHIFT_GAIN[Math.min(gear, Engine.SHIFT_GAIN.length - 1)] *
        (this.shiftCut > 0 ? 0.3 : 1),
      now,
      limit < 1 || this.shiftCut > 0 ? 0.008 : 0.06
    );
  }

  stop(): void {
    try {
      this.turbo.stop();
      this.source.stop();
      this.idleSource.stop();
    } catch {
      // Már leállt; nincs teendő.
    }
    this.out.disconnect();
  }
}


/**
 * MINTA-ALAPÚ MOTOR.
 *
 * A szintézis sokáig jó szolgálatot tett, de a felhasználó hozott egy valódi
 * felvételt, és annak a textúráját szintézissel nem lehet utolérni: a
 * hengerfalak zöreje, a szíjhajtás, a levegő örvénylése — ezek nem
 * modellezhetők, csak felvehetők.
 *
 * Amiért mégsem elég EGY felvétel: a fordulattal együtt a hangmagasságnak is
 * változnia kell, és egyetlen hurkot öt-hatszorosra felhangolva szúnyog lesz
 * belőle. A megoldás a szakma alapmódszere: több, KÜLÖNBÖZŐ fordulaton
 * rögzített hurok, amik között a motor fordulata szerint úszunk át, és
 * mindegyiket csak egy keveset kell hangolni.
 *
 * A három hurok ugyanabból a felpörgős felvételből van kivágva
 * (tools/engine-slice.mjs), mert több fordulatsávra bontott motorkészletet
 * ingyen nem lehet letölteni — egy felpörgés viszont magában hordozza az
 * egészet.
 */
interface Layer {
  rpm: number;
  url: string;
  source: AudioBufferSourceNode | null;
  gain: GainNode | null;
  /** A fél sebességgel járó másolat: az oktávval mélyebb dörmögés. */
  sub: AudioBufferSourceNode | null;
  subGain: GainNode | null;
}

export class SampledEngine {
  /**
   * NYOLC FOK, nem három.
   *
   * A három hurok 2490–5760 fordulatot fedett le, a motornak viszont 680-tól
   * 6500-ig kell szólnia — vagyis a szélein a felvételt három-négyszeresére
   * kellett húzni, és ott műanyag lett. A szakma szabálya: egy hurkot
   * legfeljebb pár félhanggal szabad elhangolni.
   *
   * Ez a létra egy CC0 felvételből készül (Renault 19, motortérből, 82
   * másodperc — tools/engine-ladder.mjs), és nem kézzel választott
   * időpontokból: a vágó végigméri a felvételt, megkeresi a STABIL ablakokat,
   * és minden célfordulathoz a hozzá legközelebbit választja. A fokok
   * MÉRTANI sorban állnak, mert a fül a hangmagasságot arányban hallja.
   *
   * Mérve: a legnagyobb nyújtás két szomszédos fok között 1,21× — 3,3
   * félhang. Korábban ez 1,97× volt, azaz 11,6 félhang, majdnem egy oktáv.
   */
  private readonly layers: Layer[] = [
    { rpm: 2085, url: 'audio/eng-b0.wav', source: null, gain: null, sub: null, subGain: null },
    { rpm: 2483, url: 'audio/eng-b1.wav', source: null, gain: null, sub: null, subGain: null },
    { rpm: 2888, url: 'audio/eng-b2.wav', source: null, gain: null, sub: null, subGain: null },
    { rpm: 3495, url: 'audio/eng-b3.wav', source: null, gain: null, sub: null, subGain: null },
    { rpm: 4178, url: 'audio/eng-b4.wav', source: null, gain: null, sub: null, subGain: null },
    { rpm: 4935, url: 'audio/eng-b5.wav', source: null, gain: null, sub: null, subGain: null },
    { rpm: 5970, url: 'audio/eng-b6.wav', source: null, gain: null, sub: null, subGain: null },
    { rpm: 6975, url: 'audio/eng-b7.wav', source: null, gain: null, sub: null, subGain: null },
  ];

  private readonly out: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly chest: BiquadFilterNode;
  private readonly body: BiquadFilterNode;
  private rpm = 700;
  private lastSpeed = 0;
  private ready = false;
  private limiter = 0;
  private lastGear = 0;
  private shiftCut = 0;
  private rebuild = 0;
  /** A vörösben kalapál-e épp. */
  onLimiter = false;


  private static readonly IDLE = 680;
  private static readonly REDLINE = 6500;

  constructor(
    private readonly ctx: AudioContext,
    destination: AudioNode
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = 0;
    this.out.connect(destination);

    // Egy közös hangszínszűrő a rétegek UTÁN: gázra nyílik. A felvételen a
    // terhelés adott, a játékban viszont változik — ez adja vissza a
    // különbséget a húzás és a gurulás között.
    this.tone = ctx.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 2200;
    this.tone.Q.value = 0.6;

    // Mélykiemelés a fő ágon: a kipufogó testessége. Nem ez adja az
    // öblösséget (azt a sub-réteg adja), de enélkül a mély ág lóg a levegőben.
    this.chest = ctx.createBiquadFilter();
    this.chest.type = 'lowshelf';
    this.chest.frequency.value = 180;
    this.chest.gain.value = 7;
    this.tone.connect(this.chest).connect(this.out);

    // A MÉLY ÁG külön útja: aluláteresztő, hogy az oktávval lejjebb játszott
    // másolatból tényleg csak a dörmögés jöjjön át, a felharmonikusai ne
    // kettőzzék meg a fő hangot.
    this.body = ctx.createBiquadFilter();
    this.body.type = 'lowpass';
    this.body.frequency.value = 340;
    this.body.Q.value = 0.9;
    this.body.connect(this.out);

    void this.load();
  }

  private async load(): Promise<void> {
    try {
      await Promise.all(
        this.layers.map(async (layer) => {
          const response = await fetch(layer.url);
          const buffer = await this.ctx.decodeAudioData(await response.arrayBuffer());
          const source = this.ctx.createBufferSource();
          source.buffer = buffer;
          source.loop = true;
          const gain = this.ctx.createGain();
          gain.gain.value = 0;
          source.connect(gain).connect(this.tone);
          source.start();
          layer.source = source;
          layer.gain = gain;

          // AZ OKTÁVVAL MÉLYEBB MÁSOLAT — ettől lesz öblös.
          //
          // A felvétel egy kis négyhengeresé: hiába tökéletes a létra, az a
          // motor egyszerűen nem mély. Öblösséget nem lehet szűrővel
          // előállítani abból, ami nincs benne — de EGY OKTÁVVAL LEJJEBB
          // játszva ugyanaz a hurok pontosan azt adja, ami hiányzik: a
          // nagyobb lökettérfogat lassabb, mélyebb lüktetését.
          //
          // Ez nem trükk: a hangtervezésben bevett fogás, és azért működik,
          // mert a mélyebb példány FÁZISBAN van az eredetivel — ugyanaz a
          // gyújtásrend, fele annyiszor. Külön szűrőn megy, hogy csak a
          // mélye jöjjön át, és ne kettőzze meg a felharmonikusokat.
          const sub = this.ctx.createBufferSource();
          sub.buffer = buffer;
          sub.loop = true;
          const subGain = this.ctx.createGain();
          subGain.gain.value = 0;
          sub.connect(subGain).connect(this.body);
          sub.start();
          layer.sub = sub;
          layer.subGain = subGain;
        })
      );
      this.ready = true;
    } catch (error) {
      console.warn('motorhangok nem töltöttek be', error);
    }
  }

  update(speed: number, maxSpeed: number, throttle: number, dt: number): void {
    const v = Math.abs(speed);

    const rolling = v > 0.25;
    // Fokozatok nélkül, ugyanúgy, mint a szintetizált motornál.
    const t = Math.min(1, v / Math.max(0.001, maxSpeed));
    const target = rolling
      ? SampledEngine.IDLE +
        (SampledEngine.REDLINE - SampledEngine.IDLE) *
          Math.pow(Math.min(1, t / 0.94), 0.78)
      : SampledEngine.IDLE + throttle * 3400;
    const rate = target > this.rpm ? 7 : 3.2;
    this.rpm += (target - this.rpm) * (1 - Math.exp(-rate * dt));

    if (!this.ready) return;
    const now = this.ctx.currentTime;

    // --- ÁTÚSZÁS ------------------------------------------------------------
    //
    // Minden réteg annál hangosabb, minél közelebb van a saját fordulata a
    // mostanihoz. A súly a hangmagasság-eltérés OKTÁVBAN mért nagyságából
    // jön, nem a fordulat különbségéből: a fül logaritmikusan hall, tehát
    // 1000 és 2000 között ugyanakkora a távolság, mint 3000 és 6000 között.
    let total = 0;
    let nearest = 0;
    let nearestOct = Infinity;
    const weights = this.layers.map((layer, i) => {
      const octaves = Math.abs(Math.log2(this.rpm / layer.rpm));
      if (octaves < nearestOct) { nearestOct = octaves; nearest = i; }
      // A SZÉLESSÉG a fokok sűrűségéhez tartozik.
      //
      // 0,42 oktáv három fokhoz volt hangolva, amik közt egy-egy oktáv volt.
      // Nyolc foknál a szomszédok 0,28 oktávra vannak — ugyanezzel a
      // szélességgel négy réteg szólna egyszerre, és négy egymáshoz képest
      // elhangolt másolat nem gazdagabb, hanem sáros. 0,22: gyakorlatilag
      // két szomszédos fok úszik át, ahogy kell.
      const w = Math.exp(-Math.pow(octaves / 0.22, 2));
      total += w;
      return w;
    });

    // A SÚLYOK ÖSSZEGE alapjáraton elenyésző.
    //
    // A legalsó fok 2100 fordulatnál van, az alapjárat 680 — másfél oktáv
    // távolság, ahol a haranggörbe már 1e-24 körül jár. Az összegre tett
    // 1e-6-os alsó korlát ilyenkor nem véd, hanem ÖL: a normalizálás után a
    // legközelebbi réteg hangereje 1,79e-18 lett, vagyis a motor álló
    // helyzetben NÉMA volt. Ezért: ha nincs érdemi súly, a legközelebbi fok
    // szól teljes hangerőn. Nyújtva, de szól.
    if (total < 1e-3) {
      for (let i = 0; i < weights.length; i++) weights[i] = i === nearest ? 1 : 0;
      total = 1;
    }

    this.layers.forEach((layer, i) => {
      if (!layer.gain || !layer.source) return;
      // A hangmagasságot a saját fordulatához képest hangoljuk. Mivel a
      // legközelebbi réteg a leghangosabb, ez sosem lesz több pár
      // félhangnál — épp ezért nem nyávog.
      const ratio = this.rpm / layer.rpm;
      layer.source.playbackRate.setTargetAtTime(ratio, now, 0.04);
      const w = weights[i] / total;
      layer.gain.gain.setTargetAtTime(w * 0.9, now, 0.08);

      if (layer.sub && layer.subGain) {
        // Fél sebesség = egy oktávval lejjebb, ugyanabban a fázisban.
        layer.sub.playbackRate.setTargetAtTime(ratio * 0.5, now, 0.04);
        // Alul erősebb, felül visszavesz: alacsony fordulaton a dörmögés a
        // fél hang, a vörösben viszont a sivítás a lényeg, és ott egy erős
        // mély réteg csak sarat csinálna.
        const depth = 0.62 - Math.min(0.42, (this.rpm / SampledEngine.REDLINE) * 0.42);
        layer.subGain.gain.setTargetAtTime(w * depth, now, 0.08);
      }
    });

    const accelerating = v > this.lastSpeed + 0.01;
    this.lastSpeed = v;
    const load = Math.min(1, throttle * 0.75 + (v / maxSpeed) * 0.45);
    // Gázelvételkor a hang tompul ÉS halkul: a felvétel mindig teljes
    // terhelésen szól, tehát a gurulást nekünk kell előállítani.
    const coasting = throttle < 0.15 && rolling ? 0.55 : 1;
    void accelerating;

    // --- A VÖRÖS TARTOMÁNY --------------------------------------------------
    //
    // Ugyanaz a jelenség, mint a számolt motornál, és ugyanazért: a
    // végsebességen a vezérlés elveszi a gyújtást, és a motor SZAGGAT. Ez az
    // egyetlen visszajelzés arról, hogy nincs feljebb — enélkül a hang
    // egyszerűen „beáll", ami géphangzás.
    let limit = 1;
    this.onLimiter = this.rpm > SampledEngine.REDLINE * 0.975 && throttle > 0.35;
    if (this.onLimiter) {
      this.limiter += dt * 84;
      limit = Math.sin(this.limiter) > 0.15 ? 1 : 0.1;
      if (limit < 1) this.rpm = Math.max(SampledEngine.REDLINE * 0.955, this.rpm - 350 * dt);
    }

    // --- A VÁLTÁS -----------------------------------------------------------
    //
    // A fordulat NEM esik vissza — ezt a felhasználó kétszer is elutasította,
    // és igaza volt: közben a sebesség nő, tehát a lefelé csúszó hang az
    // ellenkezőjét mondaná. Helyette a terhelés esik ki egy pillanatra, és
    // háromnegyed másodperc alatt épül vissza.
    const gear = Engine.gearAt(v, maxSpeed, this.lastGear);
    if (gear > this.lastGear) {
      this.shiftCut = 0.14;
      this.rebuild = 1;
    }
    this.lastGear = gear;
    this.shiftCut = Math.max(0, this.shiftCut - dt);
    this.rebuild = Math.max(0, this.rebuild - dt / 0.75);
    const swell = 1 - this.rebuild * 0.42;

    this.tone.frequency.setTargetAtTime(900 + load * 6000, now, 0.06);
    this.out.gain.setTargetAtTime(
      (0.18 + load * 0.3) * coasting * limit * swell *
        Engine.SHIFT_GAIN[Math.min(gear, Engine.SHIFT_GAIN.length - 1)] *
        (this.shiftCut > 0 ? 0.3 : 1),
      now,
      limit < 1 || this.shiftCut > 0 ? 0.008 : 0.06
    );
  }

  stop(): void {
    for (const layer of this.layers) {
      try {
        layer.sub?.stop();
        layer.source?.stop();
      } catch {
        // Már leállt.
      }
    }
    this.out.disconnect();
  }
}
