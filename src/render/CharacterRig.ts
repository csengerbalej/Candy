import * as THREE from 'three';

export type RigState = 'idle' | 'walk' | 'run' | 'jump' | 'carry' | 'sneak' | 'grab';

/**
 * What the gameplay layer is allowed to know about animation: a state goes in,
 * something moves. Whether that something is a skeleton or a sine wave is an
 * asset detail, and two of the four characters are currently the latter.
 */
export interface Rig {
  play(state: RigState, fade?: number): void;
  setSpeedScale(scale: number): void;
  update(dt: number): void;
}

/** Clip names as they arrive from the authoring tool, mapped to game states. */
export type ClipMap = Partial<Record<RigState, string>>;

const CLIP_FOR: ClipMap = {
  idle: 'Walking',
  walk: 'Walking',
  run: 'run_fast_7_inplace',
  jump: 'Regular_Jump',
  carry: 'Female_Run_Forward_Pick_Up_Right',
};

/**
 * A lakó klipjei.
 *
 * Ugyanarra a mixamorig csontvázra készült, mint a szörnyek, de MÁS a dolga:
 * nem ugrik és nem cipel, hanem járőrözik, lopakodik és üldöz. Ezért nem
 * elég egy közös táblázat — a szereplőt az különbözteti meg, hogy mit csinál,
 * és ez az a hely, ahol ezt ki lehet mondani.
 *
 * Az `idle` itt igazi helyben-járás, nem a járásciklus megállítva: a lakó
 * sosem alszik, csak vár, és ezt látni is kell rajta. A `sneak` a settenkedő
 * guggolás — a gyanakvó állapotoké.
 */
export const HOMEOWNER_CLIPS: ClipMap = {
  idle: 'Idle_5',
  walk: 'Walking',
  run: 'Running',
  sneak: 'Cautious_Crouch_Walk_Forward',
  grab: 'Kick_a_Soccer_Ball',
};

/**
 * Idle has no clip of its own, so it is borrowed from the walk cycle — but
 * carefully.
 *
 * Frame zero of a walk is arms-pinned-to-the-sides, which reads as a melted
 * blob. Playing the cycle slowly instead is worse: a character standing still
 * drifts through mid-stride poses with one leg in the air. The passing pose,
 * a quarter of the way in, is the one frame of a walk where the feet are
 * together and the arms hang naturally — so idle parks there and breathes.
 */
const IDLE_PHASE = 0.25;
const IDLE_SWAY = 0.035;
const IDLE_RATE = 1.1;
// Egyszeri mozdulatok: lejátszódnak és megállnak az utolsó képkockán. A
// `grab` az elkapás — nem állapot, hanem esemény, és egy ciklusba tett esemény
// vagy örökké ismétlődne, vagy félbeszakadna.
const ONCE: Partial<Record<RigState, boolean>> = { jump: true, carry: true, grab: true };

/**
 * Drives one character's skeleton.
 *
 * The game never asks for a clip by name — it asks for a STATE, and the rig
 * decides what that looks like. That indirection is what lets the other three
 * characters arrive later with differently-named clips and no gameplay change.
 */
export class CharacterRig implements Rig {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<RigState, THREE.AnimationAction>();
  private current: RigState | null = null;
  private idleClock = 0;
  /** Igaz, ha az `idle` csak egy kölcsönvett járáspóz, nem saját klip. */
  private readonly frozenIdle: boolean;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], clipFor: ClipMap = CLIP_FOR) {
    this.mixer = new THREE.AnimationMixer(root);

    const byName = new Map(clips.map((c) => [c.name, c]));
    for (const [state, clipName] of Object.entries(clipFor) as Array<[RigState, string]>) {
      const clip = byName.get(clipName);
      if (!clip) continue;
      const action = this.mixer.clipAction(stripRootTranslation(clip));
      if (ONCE[state]) {
        action.setLoop(THREE.LoopOnce, 1);
        action.clampWhenFinished = true;
      }
      this.actions.set(state, action);
    }

    this.frozenIdle = clipFor.idle === clipFor.walk;
    this.play('idle', 0);
  }

  /** Crossfade to a state. Repeating the current state is a no-op. */
  play(state: RigState, fade = 0.18): void {
    if (state === this.current) return;
    const next = this.actions.get(state);
    if (!next) return;

    const previous = this.current ? this.actions.get(this.current) : undefined;
    this.current = state;

    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    // Az `idle` a szörnyeknél a járásciklus EGY megállított póza (lásd
    // IDLE_PHASE), a lakónál viszont saját, helyben járó klip. Ha itt is
    // lefagyasztanánk, a lakó kimerevedne — ami pont azt a benyomást keltené,
    // hogy nem figyel.
    next.timeScale = state === 'idle' && this.frozenIdle ? 0 : 1;
    next.play();

    if (previous && previous !== next) previous.crossFadeTo(next, fade, false);
    else next.fadeIn(fade);
  }

  /** Speeds the walk and run cycles to match how fast the character moves. */
  setSpeedScale(scale: number): void {
    for (const state of ['walk', 'run', 'sneak'] as RigState[]) {
      const action = this.actions.get(state);
      if (action) action.timeScale = scale;
    }
  }

  update(dt: number): void {
    const idle = this.actions.get('idle');
    if (idle && this.frozenIdle && this.current === 'idle') {
      this.idleClock += dt;
      const duration = idle.getClip().duration;
      idle.time =
        (IDLE_PHASE + Math.sin(this.idleClock * IDLE_RATE) * IDLE_SWAY) * duration;
    }
    this.mixer.update(dt);
  }
}

/**
 * Remove horizontal motion from the root bone.
 *
 * These clips carry root motion: the walk cycle slides the hips forward over
 * its length. The game already moves the character through the world, so
 * leaving it in makes the model drift out of its own collision capsule and
 * snap back every loop. Vertical motion stays — that is the bounce.
 */
function stripRootTranslation(clip: THREE.AnimationClip): THREE.AnimationClip {
  const stripped = clip.clone();
  for (const track of stripped.tracks) {
    if (!/\.position$/.test(track.name)) continue;
    if (!/(^|\.)(Hips|hips|mixamorig:Hips)\./.test(`.${track.name}`)) continue;
    const values = track.values as Float32Array;
    for (let i = 0; i < values.length; i += 3) {
      values[i] = 0;
      values[i + 2] = 0;
    }
  }
  return stripped;
}
