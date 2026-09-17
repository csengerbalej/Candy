import * as THREE from 'three';
import type { Rig, RigState } from './CharacterRig';

/**
 * Motion for characters that arrived without a skeleton.
 *
 * This is not a placeholder in the apologetic sense. A ghost has no legs, so a
 * walk cycle would be wrong for it even if one existed — bob, tilt and drift
 * IS its correct animation. The zombie is a different story: it is a biped
 * being faked, and it should be rigged when there is time.
 */
export class ProceduralRig implements Rig {
  private state: RigState = 'idle';
  private speedScale = 1;
  private time = 0;
  private readonly baseY: number;

  constructor(
    private readonly art: THREE.Object3D,
    private readonly kind: 'float' | 'shamble'
  ) {
    this.baseY = art.position.y;
  }

  play(state: RigState): void {
    this.state = state;
  }

  setSpeedScale(scale: number): void {
    this.speedScale = scale;
  }

  update(dt: number): void {
    const moving = this.state === 'walk' || this.state === 'run';
    this.time += dt * (moving ? this.speedScale : 0.55);

    if (this.kind === 'float') {
      // Slow vertical drift, a lazy yaw wobble, and a lean in the direction of
      // travel. No contact with the ground at any point — that is the read.
      const bob = Math.sin(this.time * 2.1) * 0.12;
      this.art.position.y = this.baseY + 0.22 + bob;
      this.art.rotation.z = Math.sin(this.time * 1.3) * 0.07;
      this.art.rotation.x = moving ? -0.16 : Math.sin(this.time * 0.9) * 0.03;
      return;
    }

    // Shamble: an asymmetric bob is what makes a walk read as a limp — one
    // heavy step, one light one, which a plain sine cannot express.
    const step = Math.sin(this.time * 5.2);
    const limp = step > 0 ? step : step * 0.35;
    this.art.position.y = this.baseY + Math.abs(limp) * 0.1;
    this.art.rotation.z = limp * 0.13;
    this.art.rotation.x = (moving ? -0.1 : -0.04) + Math.abs(limp) * 0.04;

    if (this.state === 'jump') {
      this.art.rotation.x = -0.3;
      this.art.position.y = this.baseY + 0.1;
    }
  }
}
