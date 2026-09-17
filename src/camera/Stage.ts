import { CAMERA } from '../core/config';

/**
 * Which way the stage camera faces.
 *
 * The yaw used to be a constant, and the comment next to it said why: a fixed
 * yaw means the controls never change under the players' hands. That is true,
 * and it is also why the house became unreadable — the camera looks one fixed
 * way forever, so half the time you are walking TOWARDS it and cannot see what
 * is ahead of you. A greybox room designed around the camera hides that; a real
 * flat, where you go in every direction, does not.
 *
 * So the yaw moves, but only when the players ask it to, in quarter turns. The
 * movement basis is derived from this same value (see PlayerController), so
 * "up" on the stick is always away from the camera whichever way it points —
 * the controls stay consistent with the SCREEN, which is what a player
 * actually tracks.
 */
export const stage = {
  yaw: CAMERA.yaw,
  pitch: CAMERA.pitch,
  fov: CAMERA.fov,
  /** How far the shared camera may pull back to frame the pair. */
  maxDistance: CAMERA.sharedMaxDistance,
  /** …and how close it may come. */
  minDistance: CAMERA.sharedMinDistance,
  /** Follow distance once the pair has split into two panes. */
  followDistance: CAMERA.followDistance,
  /** …and how much lead a given speed earns. */
  lookAheadPerSpeed: CAMERA.lookAheadPerSpeed,
};

/**
 * How far ahead of the players the shot may sit, in world units.
 *
 * Derived from the lens rather than stored, and from the distance the camera
 * is ACTUALLY at rather than the furthest it may go: a lead sized for the wide
 * shared view is most of a split pane, and would push a player who had wandered
 * off alone straight off the bottom of their own half of the screen.
 */
export function leadLimit(distance: number): number {
  const visible = 2 * distance * Math.tan((stage.fov * Math.PI) / 360);
  return visible * CAMERA.leadShare;
}

/**
 * Választható kameraszögek, laposról a felülnézet felé.
 *
 * Azért választható és nem beállított, mert háromszor hangoltam félre: 19 fok
 * túl lapos (a falak eszik a képet), 54 fok „túl felülnézet", és minden
 * javításom csak egy másik panaszt cserélt az előzőre. A szög ízlés kérdése,
 * az ízlés pedig nem mérhető fejetlen próbával — a játékos viszont egy gomb
 * alatt megtalálja, ami neki jó.
 */
export const PITCH_STEPS = [0.70, 0.95, 1.22, 1.45];

/** Váltás a következő kameraszögre. Visszaadja az újat fokban. */
export function cyclePitch(): number {
  const now = PITCH_STEPS.findIndex((p) => Math.abs(p - stage.pitch) < 0.02);
  stage.pitch = PITCH_STEPS[(now + 1) % PITCH_STEPS.length];
  return Math.round((stage.pitch * 180) / Math.PI);
}

/** Turn the stage a quarter turn. Positive spins the view clockwise. */
export function rotateStage(quarters: number): void {
  stage.yaw += (Math.PI / 2) * quarters;
}

/**
 * A szabadon forgatható kamera határai.
 *
 * A dőlés KORLÁTOS, a fordulás nem. Nem szimmetriából: körbefordulni értelmes
 * kérés, a kamerát a padlóba vagy a fejünk fölé fordítani nem az — lapos
 * szögben a falak eltakarják az egész képet, merőlegesen pedig a karakter egy
 * ponttá lapul, és mindkettő olyan állapot, amiből a játékos nem találja
 * vissza magát. A negyedfordulós lépcső (`PITCH_STEPS`) ezen belül marad, így
 * a T gomb és a nyilak ugyanazt a tartományt járják.
 */
export const PITCH_MIN = 0.45;
export const PITCH_MAX = 1.50;

/** Radián per másodperc, teljes kitérésnél. Kb. 2,3 s egy teljes kör. */
export const TURN_RATE = 2.7;
export const TILT_RATE = 1.2;

/**
 * Folyamatos forgatás a nyilakkal.
 *
 * `dt`-vel szorozva, nem képkockánként fix lépéssel: 144 Hz-en egy
 * képkockánkénti lépés két és félszer olyan gyorsan pörgetné a kamerát, mint
 * 60-on, és a beállítás, ami az egyik gépen jó, a másikon használhatatlan.
 */
export function turnStage(amount: number, dt: number): void {
  if (!amount) return;
  stage.yaw += amount * TURN_RATE * dt;
  // A szög ne nőjön a végtelenbe: több óra játék után a lebegőpontos
  // felbontás a szinusz körül már látható lépcsőt adna.
  const full = Math.PI * 2;
  stage.yaw = ((stage.yaw % full) + full) % full;
}

/** Dőlésszög a fel/le nyilakkal, a korlátokon belül. */
export function tiltStage(amount: number, dt: number): void {
  if (!amount) return;
  stage.pitch = Math.min(PITCH_MAX, Math.max(PITCH_MIN, stage.pitch + amount * TILT_RATE * dt));
}

/** Back to the authored direction, for a new section. */
export function resetStage(): void {
  stage.yaw = CAMERA.yaw;
  stage.pitch = CAMERA.pitch;
  stage.fov = CAMERA.fov;
  stage.maxDistance = CAMERA.sharedMaxDistance;
  stage.minDistance = CAMERA.sharedMinDistance;
  stage.followDistance = CAMERA.followDistance;
  stage.lookAheadPerSpeed = CAMERA.lookAheadPerSpeed;
}

/**
 * A wider, further-back view, for an interior.
 *
 * The players are the size of a mouse in a flat sixty-seven units across, and
 * that is the joke — but at the outdoor lens the camera showed twenty-one
 * units, barely one room, and you could not tell where anything was. Being
 * small is only funny if you can see what you are small NEXT to.
 */
export function setStageLens(lens: {
  pitch: number;
  fov: number;
  minDistance: number;
  maxDistance: number;
  followDistance: number;
}): void {
  stage.pitch = lens.pitch;
  stage.fov = lens.fov;
  stage.minDistance = lens.minDistance;
  stage.maxDistance = lens.maxDistance;
  stage.followDistance = lens.followDistance;
}
