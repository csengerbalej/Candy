import * as THREE from 'three';

export type ChallengeKind = 'GYUJTES' | 'IDOFUTAM' | 'TISZTA';

/**
 * A ház ÁRA.
 *
 * A város eddig folyosó volt: rátaláltál a narancsszínű foltra, megálltál,
 * kiszálltál. Ami közben történt — az elütött szörnyecskék, a kitérők — nem
 * számított semmit, mert a ház úgyis kinyílt.
 *
 * Mostantól a parkoló ZÁRVA van, amíg egy kinti feladatot le nem raktok. A
 * feladat nem díszlet és nem új rendszer: mindhárom fajta abból méri a
 * teljesítményt, ami eddig is történt a városban — a cukorkából, a
 * sebességből, az elütésekből. Csak eddig senki nem kérdezte meg.
 *
 * Házanként MÁS, és nem véletlen: a sorszámból jön, tehát ugyanaz a ház
 * ugyanazt kéri minden éjszaka. Egy játék, amiben a tudás számít, jobb
 * annál, amiben minden ajtó mögött lottó van.
 */
export class Challenge {
  readonly kind: ChallengeKind;
  /** Mennyi kell összesen. */
  readonly goal: number;
  /** Mennyi van meg. */
  progress = 0;
  done = false;

  /** Az időfutam kapui, ha ez olyan. Világító karikák az úton. */
  readonly gates: THREE.Vector3[] = [];
  /** A soron következő kapu; csak sorrendben lehet átmenni rajtuk. */
  gateIndex = 0;
  /** Mennyi idő maradt az időfutamból. Amíg el nem indul, a teljes keret. */
  timeLeft = 0;
  private running = false;

  /** Ennyire kell megközelíteni egy kaput. */
  static readonly GATE_REACH = 9;

  /**
   * @param index Hányadik ház ez. Ebből jön a fajta és a nehézség.
   */
  constructor(index: number, gates: THREE.Vector3[] = []) {
    const kinds: ChallengeKind[] = ['GYUJTES', 'IDOFUTAM', 'TISZTA'];
    this.kind = kinds[index % kinds.length];

    switch (this.kind) {
      case 'GYUJTES':
        // Három cukorka az utcáról. Hétből három: nem kell az egész várost
        // átfésülni, de egy egyenes úton sem jön össze magától.
        this.goal = 3;
        break;
      case 'IDOFUTAM':
        // Három kapu. Az idő a TÁVOLSÁGBÓL jön, nem beírt számból: a kapuk
        // a városban bárhol lehetnek, és egy fix harminc másodperc az egyik
        // elrendezésnél sétagalopp, a másiknál teljesíthetetlen.
        this.goal = Math.max(1, gates.length);
        this.gates.push(...gates);
        this.timeLeft = this.budget();
        break;
      case 'TISZTA':
      default:
        // Ennyi métert kell megtenni úgy, hogy egyetlen szörnyecskét sem
        // ütsz el. Egy elütés nullázza — a büntetés nem pont, hanem idő.
        this.goal = 420;
        break;
    }
  }

  /**
   * Mennyi idő jár az időfutamra.
   *
   * A kapuk közti út hossza osztva egy TARTHATÓ tempóval — nem a
   * végsebességgel, mert a végsebesség egyenesben van, a kapuk meg nem
   * egyenesben. Plusz egy indulási ráadás, mert a rajtnál állsz.
   */
  private budget(): number {
    // A keret a HÁTRALÉVŐ szakaszokra szól. A rajtkapuig tartó út nem a
    // futam része, tehát nem is számol bele.
    let path = 0;
    for (let i = Math.max(1, this.gateIndex); i < this.gates.length; i++) {
      path += this.gates[i - 1].distanceTo(this.gates[i]);
    }
    // 17 egység/mp: a végsebesség fele. Egy kapukból álló útvonalon ennyit
    // lehet tartani anélkül, hogy tökéletesen vezetnél.
    return path / 17 + 9;
  }

  /**
   * A KÖVETKEZŐ KAPU, ha van ilyen.
   *
   * Az irányjelző ezt követi. Egy időfutam, amiben meg kell találni a
   * kapukat, nem ügyességi feladat, hanem bújócska — és négyszázötven egység
   * széles városban reménytelen.
   */
  get nextGate(): THREE.Vector3 | null {
    if (this.done || this.kind !== 'IDOFUTAM') return null;
    return this.gates[this.gateIndex] ?? null;
  }

  /** A hátralévő kapuk, sorrendben. A térkép ezeket rajzolja. */
  get remainingGates(): THREE.Vector3[] {
    if (this.done || this.kind !== 'IDOFUTAM') return [];
    return this.gates.slice(this.gateIndex);
  }

  /** Emberi szöveg a HUD-nak. */
  get label(): string {
    switch (this.kind) {
      case 'GYUJTES':
        return `SZEDJ FEL ${this.goal} CUKORKÁT — ${this.progress}/${this.goal}`;
      case 'IDOFUTAM':
        return this.running
          ? `HAJTS ÁT A ${this.goal} KAPUN — ${this.progress}/${this.goal} · ${this.timeLeft.toFixed(1)}s`
          : 'HAJTS ÁT A RAJTKAPUN — az óra ott indul';
      default:
        return `${this.goal} MÉTER ELÜTÉS NÉLKÜL — ${Math.floor(this.progress)}/${this.goal}`;
    }
  }

  /** Amit a teljesítéskor mondunk. */
  get cleared(): string {
    return 'A HÁZ NYITVA — irány a parkoló';
  }

  /** Egy felszedett utcai cukorka. */
  tookCandy(count: number): void {
    if (this.done || this.kind !== 'GYUJTES') return;
    this.progress += count;
    if (this.progress >= this.goal) this.finish();
  }

  /** Elütött egy szörnyecskét. */
  hitCritter(): void {
    if (this.done || this.kind !== 'TISZTA') return;
    this.progress = 0;
  }

  /**
   * Egy képkocka a városban.
   *
   * @param travelled Mennyit haladt a kocsi ebben a lépésben.
   */
  update(dt: number, travelled: number, car: THREE.Vector3): void {
    if (this.done) return;

    if (this.kind === 'TISZTA') {
      this.progress += travelled;
      if (this.progress >= this.goal) this.finish();
      return;
    }

    if (this.kind !== 'IDOFUTAM') return;

    // AZ ÓRA A RAJTKAPUNÁL INDUL, nem az elinduláskor.
    //
    // Eddig az első mozdulatnál elkezdett fogyni — csakhogy az első kapu a
    // város másik végében is lehet, és az odaút nem a futam része. Aki
    // messziről indult, már üres órával ért az első kapuhoz.
    //
    // Az első kapu tehát RAJT: átmenni rajta nem fogyaszt időt, onnantól
    // viszont ketyeg.
    const next = this.gates[this.gateIndex];
    if (!this.running) {
      if (!next || car.distanceTo(next) >= Challenge.GATE_REACH) return;
      this.running = true;
      this.gateIndex++;
      this.progress++;
      this.timeLeft = this.budget();
      if (this.progress >= this.goal) this.finish();
      return;
    }

    this.timeLeft -= dt;
    if (this.timeLeft <= 0) {
      // Nem bukás, hanem ÚJRA. Egy elrontott időfutam, ami véget vet az
      // estének, sokkal rosszabb, mint egy, amit meg lehet ismételni.
      this.timeLeft = this.budget();
      this.gateIndex = 0;
      this.progress = 0;
      this.running = false;
      return;
    }

    const gate = this.gates[this.gateIndex];
    if (!gate) return;
    if (car.distanceTo(gate) < Challenge.GATE_REACH) {
      this.gateIndex++;
      this.progress++;
      if (this.progress >= this.goal) this.finish();
    }
  }

  private finish(): void {
    this.done = true;
    this.progress = this.goal;
  }
}
