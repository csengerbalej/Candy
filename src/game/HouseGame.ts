import * as THREE from 'three';
import { HOUSE, NOISE, DOG } from '../core/config';
import type { PlayerController } from '../player/PlayerController';
import type { CandySpot, HouseWorld, PrankSpot } from '../world/HouseWorld';
import type { Homeowner } from '../ai/Homeowner';
import type { Dog } from '../ai/Dog';
import type { NoiseSystem } from '../systems/NoiseSystem';
import { sound } from '../audio/Sound';
import type { InputSource } from '../input/InputManager';

const INTERACT_RADIUS = 8;
const PRANK_COOLDOWN = 9;

export interface PlayerStatus {
  prompt: string;
  /** 0..1 while lifting a candy bowl. */
  grabProgress: number;
}

export interface RunStats {
  candy: number;
  pranks: number;
  catches: number;
  nearMisses: number;
  time: number;
  escaped: boolean;
}

/**
 * The rules layer for one house (spec §16–§20).
 *
 * Two hard co-op gates, both deliberate:
 *   1. Lifting a bowl takes 2.6 uninterrupted seconds, standing still, in the
 *      open, on his patrol route. Alone that is a coin flip. With a partner
 *      pulling him away it is a plan.
 *   2. The door needs both players standing in it. Nobody finishes alone.
 */
export class HouseGame {
  readonly stats: RunStats = {
    candy: 0,
    pranks: 0,
    catches: 0,
    nearMisses: 0,
    time: 0,
    escaped: false,
  };

  readonly status: PlayerStatus[] = [
    { prompt: '', grabProgress: 0 },
    { prompt: '', grabProgress: 0 },
  ];

  /** Short-lived line of feedback for the HUD. */
  banner = '';
  private bannerTimer = 0;
  private briefed = false;
  private doorAnnounced = false;
  private exitTimer = 0;
  private readonly grabTimers = [0, 0];
  private readonly nearMissCooldown = [0, 0];
  /** Amíg fut, a kutya nem árul be újra — különben másodpercenként ugatna. */
  private dogTold = 0;

  constructor(
    private readonly house: HouseWorld,
    private readonly homeowner: Homeowner,
    private readonly noise: NoiseSystem,
    /** A kutya, ha ebben a házban van egy. A harapás ugyanitt dől el. */
    private readonly dog: Dog | null = null
  ) {}

  /**
   * Kik vannak TÉNYLEG bent.
   *
   * Az „egy gépen ketten" kivezetésével a második szörny már nem mindig áll
   * valaki keze alatt: egyedül játszva ott áll a bejáratnál és nem mozdul. A
   * co-op kapuk viszont arról szólnak, hogy KÉT szörnynek kell egy helyen
   * lennie — ha az egyiket senki nem tudja odavinni, a kapu nem kihívás,
   * hanem zár kulcs nélkül. Ezért a szabályok ezt a listát nézik, nem a
   * szereplők számát: egyedül a kijárat egy emberre nyílik.
   */
  cast: number[] = [0, 1];

  /** Player names, used in the banner so feedback names a person, not a slot. */
  names: [string, string] = ['P1', 'P2'];
  /** Per-player tallies, for the end-of-run awards. */
  readonly catchesByPlayer: [number, number] = [0, 0];
  readonly pranksByPlayer: [number, number] = [0, 0];

  update(dt: number, players: PlayerController[], input: InputSource): void {
    if (this.stats.escaped) return;
    this.stats.time += dt;
    this.bannerTimer -= dt;
    if (this.bannerTimer <= 0) this.banner = '';

    // Say what the house is for, once, on the way in — and say it again the
    // moment it is done, because the door the players are standing next to
    // silently changes meaning at that instant.
    if (!this.briefed) {
      this.briefed = true;
      this.say(`SZEREZZETEK ${HOUSE.candyQuota} CUKORKÁT, AZTÁN VISSZA AZ AJTÓHOZ`);
    }
    const doorOpen = this.candyStillNeeded === 0;
    if (doorOpen && !this.doorAnnounced) {
      this.doorAnnounced = true;
      this.say(this.cast.length > 1 ? 'MEGVAN — VISSZA AZ AJTÓHOZ, MINDKETTEN' : 'MEGVAN — VISSZA AZ AJTÓHOZ');
    }

    for (const i of this.cast) {
      const p = players[i];
      const tag = this.names[i];
      const inp = input.get(i);

      this.emitMovementNoise(p, tag);
      this.status[i].prompt = '';
      this.status[i].grabProgress = 0;

      const prank = this.nearestPrank(p.position);
      const candy = this.nearestCandy(p.position);

      // Whichever is actually closer wins the button. Preferring the prank
      // unconditionally meant a candy bowl within eight metres of a prank
      // could never be lifted — the grab timer was reset every frame, with no
      // prompt to explain why.
      const prankReady = !!prank && prank.cooldown <= 0;
      const prankFirst =
        prankReady &&
        (!candy || prank!.position.distanceTo(p.position) <= candy.position.distanceTo(p.position));

      if (prankFirst) {
        this.status[i].prompt = `${prank!.label} — nyomd meg`;
        if (inp.interact) {
          this.pranksByPlayer[i]++;
          this.triggerPrank(prank!, tag);
        }
        this.grabTimers[i] = 0;
      } else if (candy) {
        this.updateGrab(i, dt, p, inp.interactHeld, candy, tag);
      } else {
        this.grabTimers[i] = 0;
      }

      this.checkCatch(i, dt, p);
    }

    this.updateExit(dt, players);
  }

  private emitMovementNoise(p: PlayerController, tag: string): void {
    // A quiet character is quiet here and nowhere else: the AI listens to one
    // system, so the trait has to be applied at the source of the sound.
    if (p.justLanded) this.noise.emit(p.position, NOISE.landRadius * p.traits.noise, `${tag} puffanás`);
    else if (p.isLoud) this.noise.emit(p.position, NOISE.sprintRadius * p.traits.noise, `${tag} léptek`);
  }

  private nearestPrank(at: THREE.Vector3): PrankSpot | null {
    return this.house.prankSpots.find((s) => s.position.distanceTo(at) < INTERACT_RADIUS) ?? null;
  }

  private nearestCandy(at: THREE.Vector3): CandySpot | null {
    return (
      this.house.candySpots.find((c) => !c.taken && c.position.distanceTo(at) < INTERACT_RADIUS) ??
      null
    );
  }

  private triggerPrank(prank: PrankSpot, tag: string): void {
    prank.cooldown = PRANK_COOLDOWN;
    this.stats.pranks++;
    // The whole point: a noise loud enough to reach him from anywhere in the room.
    this.noise.emit(prank.position, NOISE.prankRadius, `${tag} — ${prank.label}`);
    this.say(`${tag} — ${prank.label}`);
  }

  private updateGrab(
    i: number,
    dt: number,
    p: PlayerController,
    held: boolean,
    candy: CandySpot,
    tag: string
  ): void {
    if (!held || !p.isStill || p.stun > 0) {
      this.grabTimers[i] = 0;
      this.status[i].prompt = p.isStill ? 'CUKORKA — tartsd nyomva' : 'CUKORKA — állj meg előbb';
      return;
    }

    this.grabTimers[i] += dt;
    this.status[i].grabProgress = Math.min(1, this.grabTimers[i] / HOUSE.grabTime);
    this.status[i].prompt = 'EMELÉS…';

    if (this.grabTimers[i] >= HOUSE.grabTime) {
      candy.taken = true;
      candy.mesh.visible = false;
      p.candy += candy.value;
      this.stats.candy += candy.value;
      sound.pickup();
      this.grabTimers[i] = 0;
      // Say where that leaves the errand, not just that a bowl moved. Without
      // the count the players have no way to know whether the door is open yet.
      const left = this.candyStillNeeded;
      this.say(
        left > 0
          ? `${tag} megszerezte a cukorkát (+${candy.value}) — még ${left} kell`
          : `${tag} megszerezte a cukorkát (+${candy.value})`
      );
    }
  }

  private checkCatch(i: number, dt: number, p: PlayerController): void {
    this.nearMissCooldown[i] = Math.max(0, this.nearMissCooldown[i] - dt);
    const d = p.position.distanceTo(this.homeowner.position);

    if (d < HOUSE.catchRadius && p.stun <= 0 && !this.homeowner.recovering) {
      p.applyKnockback(this.homeowner.position);
      // A mozdulat ONNAN indul, ahol az elkapás tényleg eldől. Ha a lakó maga
      // találgatná a távolságból, ugyanaz a döntés kétszer születne meg, és a
      // kettő elcsúszhatna egymástól.
      this.homeowner.playCatch();
      sound.thud(0.8);
      const lost = Math.min(p.candy, Math.round(HOUSE.candyLostOnCatch * p.traits.candyLoss));
      p.candy -= lost;
      this.stats.candy -= lost;
      this.stats.catches++;
      this.catchesByPlayer[i]++;
      this.say(`${this.names[i]} lebukott! −${lost} cukorka`);
      return;
    }

    // --- A kutya NEM HARAP: BEÁRUL. ---------------------------------------
    //
    // Egy második üldöző, ami maga is elkap, csak egy gyorsabb lakó lenne. A
    // kutya ehelyett megtalál és KIABÁL — a büntetés nem azonnal jön, hanem
    // közeledik, és van pár másodperced eltűnni, mielőtt a gazdája ideér.
    //
    // Nem veszítesz cukorkát tőle. Az árat a lakó szedi be, ha odaér.
    if (this.dog && p.stun <= 0 && this.dogTold <= 0) {
      if (p.position.distanceTo(this.dog.position) < DOG.biteRadius) {
        this.dog.found(this.noise);
        this.dogTold = DOG.barkCooldown;
        this.say(`${this.names[i]} MEGTALÁLTA A KUTYA — hívja a gazdit!`);
      }
    }
    this.dogTold = Math.max(0, this.dogTold - dt);

    // "MAJDNEM" — the award in spec §31, earned right here.
    if (
      d < HOUSE.catchRadius * 2.6 &&
      this.homeowner.state === 'CHASE' &&
      this.nearMissCooldown[i] <= 0
    ) {
      this.stats.nearMisses++;
      this.nearMissCooldown[i] = 2;
    }
  }

  /** Sweets still needed before the front door is a way out. */
  get candyStillNeeded(): number {
    return Math.max(0, HOUSE.candyQuota - this.candyTaken);
  }

  /** How many bowls have been lifted, of the ones this house has. */
  get candyTaken(): number {
    return this.house.candySpots.filter((c) => c.taken).length;
  }

  private updateExit(dt: number, players: PlayerController[]): void {
    const playing = this.cast.map((i) => players[i]);
    const inZone = playing.filter(
      (p) => p.position.distanceTo(this.house.exitZone) < this.house.exitRadius
    );

    // The way out is the way you came in, which means both players are
    // standing in the exit zone the moment the house starts. Without an
    // errand to do first the section ended before it began — you walked in and
    // were immediately told you had escaped.
    const needed = this.candyStillNeeded;
    if (needed > 0) {
      this.exitTimer = 0;
      for (const p of inZone) {
        this.status[p.index].prompt = `MÉG ${needed} CUKORKA KELL`;
      }
      return;
    }

    if (inZone.length === playing.length) {
      this.exitTimer += dt;
      if (this.exitTimer >= HOUSE.exitHoldTime) {
        this.stats.escaped = true;
        this.say('KIJUTOTTATOK!');
      }
    } else {
      this.exitTimer = 0;
      if (inZone.length === 1) this.status[inZone[0].index].prompt = 'VÁRD MEG A TÁRSAD';
    }
  }

  get exitProgress(): number {
    return Math.min(1, this.exitTimer / HOUSE.exitHoldTime);
  }

  private say(text: string): void {
    this.banner = text;
    this.bannerTimer = 2.6;
  }
}
