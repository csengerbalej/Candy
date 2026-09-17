import type { Selection } from './Characters';

export type SessionPhase = 'drive' | 'house' | 'results';

export interface SessionStats {
  candy: number;
  housesVisited: number;
  pranks: number;
  catches: number;
  escapes: number;
  crittersHit: number;
  nearMisses: number;
  crashes: number;
  drivingScore: number;
  /** Seconds of the whole run. */
  time: number;
  /** Per player, for the end-of-run awards. */
  candyByPlayer: [number, number];
  catchesByPlayer: [number, number];
  pranksByPlayer: [number, number];
  secondsDriving: [number, number];
}

/** How many houses make a run. Short on purpose until there is more variety. */
export const HOUSES_PER_RUN = 3;

/**
 * One night, across all its sections.
 *
 * The drive and the house used to be separate page loads, which meant the candy
 * you stole was thrown away every time you got back in the car. This object is
 * what survives a section change: it owns the run, and the scenes are things
 * that happen to it.
 */
/** The house the night opens on: the one with a real interior behind its door. */
export const FIRST_HOUSE_ID = 0;

export class Session {
  phase: SessionPhase = 'drive';

  /**
   * FOGÓ mód: versengés, nem együttműködés.
   *
   * A házban ilyenkor a felvett cukorka a KÉZBE kerül, a saját sarokba kell
   * vinni, és lövésre kiesik; egyedül játszva egy AI ellenfél is beül. A
   * kooperatív mód érintetlen marad — két külön szabálykészlet egy
   * kapcsolóval, nem két játék.
   */
  fogo = false;
  readonly stats: SessionStats = {
    candy: 0,
    housesVisited: 0,
    pranks: 0,
    catches: 0,
    escapes: 0,
    crittersHit: 0,
    nearMisses: 0,
    crashes: 0,
    drivingScore: 0,
    time: 0,
    candyByPlayer: [0, 0],
    catchesByPlayer: [0, 0],
    pranksByPlayer: [0, 0],
    secondsDriving: [0, 0],
  };

  /** Which house the navigator is currently sending them to. */
  targetHouseId = 0;
  /** Houses already done, so a run never repeats one. */
  readonly visited = new Set<number>();
  /** Set while the house section runs, for its title card. */
  currentHouseName = '';

  driverIndex: 0 | 1;

  constructor(readonly selection: Selection) {
    this.driverIndex = selection.driverIndex;
  }

  get isLastHouse(): boolean {
    return this.stats.housesVisited >= HOUSES_PER_RUN - 1;
  }

  get housesLeft(): number {
    return Math.max(0, HOUSES_PER_RUN - this.stats.housesVisited);
  }

  /** Pick the next destination, never one already done. */
  /**
   * Which house next.
   *
   * The FIRST house of the night is never random: it is house 0, the one on
   * the corner nearest where the jeep starts. That is the house whose interior
   * is actually built — a real flat rather than the greybox — and sending the
   * players somewhere else first would open the night on the one house that
   * does not exist yet. After that it is whatever has not been done.
   */
  chooseTarget(houseIds: number[]): number {
    if (this.visited.size === 0 && houseIds.includes(FIRST_HOUSE_ID)) {
      this.targetHouseId = FIRST_HOUSE_ID;
      return this.targetHouseId;
    }
    const remaining = houseIds.filter((id) => !this.visited.has(id));
    const pool = remaining.length > 0 ? remaining : houseIds;
    this.targetHouseId = pool[Math.floor(Math.random() * pool.length)];
    return this.targetHouseId;
  }

  swapRoles(): void {
    this.driverIndex = this.driverIndex === 0 ? 1 : 0;
  }

  nameOf(player: number): string {
    return this.selection.names[player] ?? `P${player + 1}`;
  }
}
