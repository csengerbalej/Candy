import * as THREE from 'three';
import { CAR, RIVAL } from '../core/config';
import type { Car } from '../vehicle/Car';
import type { PlayerInput } from '../input/InputManager';

/**
 * AZ AI ELLENFÉL A VOLÁN MÖGÖTT.
 *
 * Eddig a házban várt rád, mintha odateleportált volna. Most ugyanazt az
 * utat teszi meg, amit te: kocsival jön, teljesíti a küldetést, és csak
 * utána mehet be. Ettől lesz a kinti szakasz is verseny — eddig a város egy
 * magánügy volt, és a tét csak odabent kezdődött.
 *
 * NEM CSAL, és ez ugyanaz a szabály, mint a házban: UGYANAZT a `Car`-t
 * hajtja, ugyanazzal a fizikával, ugyanazokkal a falakkal. Nem „mozog egy
 * útvonalon" — GÁZT AD ÉS KORMÁNYOZ, tehát ugyanúgy megcsúszik a kanyarban
 * és ugyanúgy nekimegy a szegélynek, mint te.
 *
 * Amitől egyáltalán működik: a kormányzás CÉLRA TARTÁS (pure pursuit) — az
 * útvonalon kiszemel egy pontot maga előtt, és arra fordít. A távolabbi
 * pontra nézve simán kanyarodik; a közelebbire nézve kacsázik. A
 * kiszemelt pont ezért a sebességgel nő.
 */
export class RivalDriver {
  /** Az útvonal, amin épp megy. A jelenet tölti fel a világ útkeresőjéből. */
  private path: THREE.Vector3[] = [];
  /** Hányadik pontnál tart. */
  private at = 0;
  /** Amíg fut, tolat: beragadt valahol. */
  private reversing = 0;
  /** Mióta nem haladt. Ebből lesz a tolatás. */
  private stuck = 0;
  private lastAt = new THREE.Vector3();

  constructor(private readonly random: () => number = Math.random) {}

  /** Új útvonal. Az előzőt eldobja. */
  follow(points: readonly THREE.Vector3[]): void {
    this.path = points.map((p) => p.clone());
    this.at = 0;
  }

  /** Hátravan-e még út. */
  get busy(): boolean {
    return this.at < this.path.length;
  }

  /** A célpont, ahová tart. `null`, ha nincs útvonala. */
  get goal(): THREE.Vector3 | null {
    return this.path.length ? this.path[this.path.length - 1] : null;
  }

  /**
   * Egy képkockányi vezetés.
   *
   * @returns A bemenet, amit a jelenet a `Car.update`-nek ad — pontosan úgy,
   * mintha egy ember nyomná a gombokat.
   */
  drive(dt: number, car: Car): PlayerInput {
    const input: PlayerInput = {
      moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false,
      interact: false, interactHeld: false, pause: false, usingGamepad: false, nitro: false,
    };
    if (!this.busy) return input;

    // BERAGADÁS: ha alig haladt, előbb-utóbb tolatni kell. Enélkül egy
    // szegélynek fordulva örökre ott maradna gázt adva — és pont ez a
    // leggyakoribb látvány egy rosszul megírt AI sofőrnél.
    const moved = car.position.distanceTo(this.lastAt);
    this.lastAt.copy(car.position);
    this.stuck = moved < 0.05 ? this.stuck + dt : 0;
    if (this.stuck > 1.2) {
      this.reversing = 1.1;
      this.stuck = 0;
    }
    if (this.reversing > 0) {
      this.reversing -= dt;
      input.moveY = -1;
      // Tolatás közben ELLENKEZŐ kormány: így fordul ki a sarokból, nem
      // csak hátrál egyenesen bele újra.
      input.moveX = this.lastSteer > 0 ? -1 : 1;
      return input;
    }

    // A CÉLPONT: az útvonalon egy pont annyival előrébb, amennyit a
    // sebességnél értelmes előre nézni.
    const lookAhead = 6 + (Math.abs(car.speed) / CAR.maxSpeed) * 16;
    while (this.at < this.path.length - 1 && car.position.distanceTo(this.path[this.at]) < lookAhead) {
      this.at++;
    }
    const target = this.path[this.at];
    const toTarget = target.clone().sub(car.position);
    toTarget.y = 0;
    const distance = toTarget.length();
    if (this.at >= this.path.length - 1 && distance < 4) {
      this.at = this.path.length; // megérkezett
      return input;
    }

    // KORMÁNY: a célpont irányszöge a kocsi orrához képest.
    const want = Math.atan2(toTarget.x, toTarget.z);
    let delta = want - car.heading;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    // A kormány jele fordított: a `Car` a `moveX`-et ellentétesen értelmezi
    // (lásd `CAR.steerInvert`), és ezt egy helyen kell helyre tenni.
    const steer = THREE.MathUtils.clamp(-delta * 1.8, -1, 1);
    this.lastSteer = steer;
    input.moveX = steer;

    // GÁZ: éles kanyar előtt lassít. Egy AI, ami padlógázzal megy a
    // kereszteződésbe, nem versenyző, hanem baleset — és a szegélynek
    // csapódva úgyis lassabb lesz nálad.
    const sharp = Math.min(1, Math.abs(delta) / 0.9);
    let wantSpeed = CAR.maxSpeed * (1 - sharp * 0.72) * RIVAL.driveSkill;

    // FÉKEZÉS A CÉL ELŐTT.
    //
    // Enélkül az AI harminc egység/másodperccel ért a célhoz, „megérkezett"-et
    // mondott, és ötven egységgel TÚLSZALADT rajta kigurulva — mérve 209-nél
    // állt meg egy 160-as célnál. Egy sofőr, aki nem fékez, nem érkezik meg,
    // csak elhalad.
    //
    // A kívánt sebesség az utolsó ponthoz közeledve a TÁVOLSÁGGAL arányos:
    // húsz egységre tizenegy, öt egységre három. Ez ugyanaz a szabály, amit
    // az ember is használ, csak kimondva.
    if (this.at >= this.path.length - 1) {
      wantSpeed = Math.min(wantSpeed, distance * 0.55);
    }

    // A fék ERŐSEBB, ha nagyon gyorsak vagyunk a kívánthoz képest: egy
    // állandó gyenge fék a nagy sebességet sosem hozná le időben.
    const tul = car.speed - wantSpeed;
    input.moveY = tul < 0 ? 1 : tul > 4 ? -1 : -0.35;
    // Kéziféket csak nagyon éles kanyarban húz, és nem mindig: ettől lesz
    // emberszerű, nem gépies.
    input.sprint = sharp > 0.85 && this.random() < 0.15;

    return input;
  }

  private lastSteer = 0;
}
