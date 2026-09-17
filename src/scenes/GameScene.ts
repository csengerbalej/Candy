import type * as THREE from 'three';
import type { PauseActions } from '../ui/PauseMenu';

/**
 * One playable section of a night.
 *
 * The contract is deliberately small: simulate on a fixed step, draw on a
 * variable one, and clean up completely. `dispose` matters more than it looks —
 * each scene owns DOM (HUDs, canvases) as well as objects, and a section change
 * that leaves either behind stacks two HUDs on top of each other.
 */
export interface GameScene {
  readonly scene: THREE.Scene;
  /** Fixed-step simulation. */
  update(step: number, elapsed: number): void;
  /** Variable-step presentation and drawing. */
  render(frameTime: number, width: number, height: number): void;
  /** Extra rows this section contributes to the pause menu. */
  pauseActions(): Partial<PauseActions>;
  /**
   * A kameraszög megváltozott (T gomb). Csak az a szakasz valósítja meg,
   * amelyiknek számít: odabent a falak rajzolt magassága függ tőle.
   */
  setCameraPitch?(degrees: number): void;
  /**
   * A játékos körülnéz (nyilak / jobb analóg kar).
   *
   * Azért a SZAKASZ kapja meg, és nem a közös `stage`, mert a két szakasz
   * kamerája más állat: odabent egy szobát keretező, forgatható színpad van,
   * kint egy autót üldöző kamera. Ugyanaz a bemenet, két különböző válasz —
   * és ha a közös színpadot forgatná vezetés közben, a ház egy véletlenszerű
   * szögben nyílna ki.
   *
   * `x` a fordulás, `y` a dőlés, mindkettő -1..1; `dt` a képkocka ideje.
   */
  look?(x: number, y: number, dt: number): void;
  /** Set when the section is over and the session should move on. */
  readonly finished: boolean;
  dispose(): void;
}
