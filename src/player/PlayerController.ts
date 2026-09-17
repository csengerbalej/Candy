import * as THREE from 'three';
import { stage } from '../camera/Stage';
import { MOVE, HOUSE } from '../core/config';

const MOVE_STUN = HOUSE.stunTime;

/**
 * Box3.intersectsBox counts touching faces as intersecting, so a character
 * walking up to a wall "collides" with zero penetration — and a zero-push
 * resolution leaves them touching forever, ready to be resolved by the next
 * axis instead. That is how standing against a counter teleported a player
 * onto it. Require real overlap.
 */
const TOUCH_EPSILON = 0.002;

/** How high a ledge a character can be lifted onto, rather than blocked by. */
const STEP_HEIGHT = 0.45;

function penetrates(box: THREE.Box3, other: THREE.Box3): boolean {
  return (
    box.max.x - other.min.x > TOUCH_EPSILON &&
    other.max.x - box.min.x > TOUCH_EPSILON &&
    box.max.y - other.min.y > TOUCH_EPSILON &&
    other.max.y - box.min.y > TOUCH_EPSILON &&
    box.max.z - other.min.z > TOUCH_EPSILON &&
    other.max.z - box.min.z > TOUCH_EPSILON
  );
}
import type { PlayerInput } from '../input/InputManager';
import type { Rig, RigState } from '../render/CharacterRig';
import type { CharacterTraits } from '../game/Characters';
import { BlobShadow } from '../render/BlobShadow';

/**
 * One player. Kinematic capsule, axis-separated AABB resolution.
 * Movement is relative to the fixed stage yaw, not to a per-player camera —
 * so "forward" means the same thing in shared view and in split view.
 * That is the whole reason the yaw is a constant.
 */
export class PlayerController {
  /**
   * Belső nézetben van-e EZ a játékos.
   *
   * Nem a kamera dolga, hanem a MOZGÁSÉ: a nézet dönti el, mit jelent az
   * „előre". A jelenet állítja, amikor nézetet váltasz.
   */
  firstPerson = false;

  readonly mesh: THREE.Group;
  /** Authored model, once it arrives. */
  private readonly art = new THREE.Group();
  private rig: Rig | null = null;
  private readonly shadow = new BlobShadow(MOVE.radius * 1.5);
  private readonly greybox = new THREE.Group();
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  private grounded = false;
  /** Jumps still available in the air. Refilled on the ground. */
  private airJumpsLeft = 0;
  /** Seconds since leaving the ground, gating the second jump. */
  private airTime = 0;
  /** One frame's flag, for a puff of effect on the second jump. */
  justDoubleJumped = false;
  private facing = 0;

  /** Candy in hand. Dropped, not lost, when the homeowner catches you. */
  candy = 0;
  /**
   * Character traits (spec §5). Defaults are the neutral character, so the
   * greybox and every probe behave as they did before characters existed.
   */
  traits: CharacterTraits = { speed: 1, noise: 1, stun: 1, candyLoss: 1, passesGates: false };
  /** Seconds of "you have been caught" flailing left. Input is ignored while > 0. */
  stun = 0;
  /** True on the single frame the player touches down — a landing is loud. */
  justLanded = false;
  /** True while sprinting on the ground — footsteps carry. */
  get isLoud(): boolean {
    return (
      this.grounded &&
      this.stun <= 0 &&
      Math.hypot(this.velocity.x, this.velocity.z) > MOVE.walkSpeed * this.traits.speed + 0.5
    );
  }
  /** Standing still enough to lift a candy bowl. */
  get isStill(): boolean {
    return this.grounded && Math.hypot(this.velocity.x, this.velocity.z) < 1.2;
  }

  constructor(
    readonly index: number,
    color: number,
    spawn: THREE.Vector3
  ) {
    this.position.copy(spawn);

    this.mesh = new THREE.Group();
    this.mesh.add(this.art);
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(MOVE.radius, MOVE.height - MOVE.radius * 2, 6, 14),
      new THREE.MeshStandardMaterial({ color, roughness: 0.5 })
    );
    body.position.y = MOVE.height / 2;
    body.castShadow = true;
    this.greybox.add(body);

    // Nose, so rotation is legible in greybox.
    const nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0xfff1d0, roughness: 0.4 })
    );
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, MOVE.height * 0.72, MOVE.radius + 0.15);
    this.greybox.add(nose);

    this.mesh.add(this.greybox);
    this.mesh.add(this.shadow.mesh);
    this.mesh.position.copy(this.position);
  }

  /**
   * Swap the capsule for the authored character. The collision capsule is
   * unchanged — art never moves the hitbox, so a new character cannot
   * accidentally retune the platforming.
   */
  setArt(model: THREE.Object3D, rig?: Rig): void {
    this.art.clear();
    this.art.add(model);
    this.rig = rig ?? null;
    this.greybox.visible = false;
  }

  /** What the skeleton should be doing, derived from what the body is doing. */
  private get rigState(): RigState {
    if (!this.grounded) return 'jump';
    const speed = Math.hypot(this.velocity.x, this.velocity.z);
    if (speed < 0.8) return 'idle';
    return speed > MOVE.walkSpeed * this.traits.speed + 0.5 ? 'run' : 'walk';
  }

  /** Comedy, not punishment (spec §9, §39): you get launched, you lose candy. */
  applyKnockback(from: THREE.Vector3): void {
    const away = new THREE.Vector3().subVectors(this.position, from).setY(0);
    if (away.lengthSq() < 0.001) away.set(0, 0, 1);
    away.normalize().multiplyScalar(26);
    this.velocity.set(away.x, 13, away.z);
    this.stun = MOVE_STUN * this.traits.stun;
    this.grounded = false;
  }

  update(dt: number, input: PlayerInput, colliders: THREE.Box3[]): void {
    this.justLanded = false;
    this.justDoubleJumped = false;
    const wasGrounded = this.grounded;

    if (this.stun > 0) {
      // Ragdoll-ish: keep gravity and collisions, drop control entirely.
      this.stun -= dt;
      input = { ...input, moveX: 0, moveY: 0, jump: false, jumpHeld: false, sprint: false };
    }

    // Stage-relative basis (yaw only). Reading the LIVE stage yaw rather than
    // the authored constant is what lets the camera turn without the controls
    // going strange: turn the view a quarter and "forward" turns with it.
    //
    // BELSŐ NÉZETBEN viszont MEGFORDUL az egész.
    //
    // A külső nézet szabálya az, hogy „előre = a kamerától elfelé" — ez akkor
    // helyes, ha a kamera MÖGÖTTED van. Belső nézetben a kamera a szemedben
    // ül, tehát ugyanez a szabály hátrafelé küld. Mérve: mind a négy
    // égtájon 180 fokot tévedett a mozgás.
    const cos = Math.cos(stage.yaw);
    const sin = Math.sin(stage.yaw);
    // Belső nézetben az „előre" a NÉZÉS iránya; külsőben a kamerától elfelé.
    // A kettő pontosan egymás ellentéte, tehát egy előjel a különbség.
    const flip = this.firstPerson ? -1 : 1;
    const wishX = (input.moveX * cos - input.moveY * sin) * flip;
    const wishZ = -(input.moveX * sin + input.moveY * cos) * flip;

    const speed = (input.sprint ? MOVE.sprintSpeed : MOVE.walkSpeed) * this.traits.speed;
    const control = this.grounded ? 1 : MOVE.airControl;
    const targetX = wishX * speed;
    const targetZ = wishZ * speed;

    const accel = MOVE.accel * control * dt;
    this.velocity.x = approach(this.velocity.x, targetX, accel);
    this.velocity.z = approach(this.velocity.z, targetZ, accel);

    if (wishX === 0 && wishZ === 0 && this.grounded) {
      const damp = Math.max(0, 1 - MOVE.friction * dt);
      this.velocity.x *= damp;
      this.velocity.z *= damp;
    }

    if (input.jump && this.grounded) {
      this.velocity.y = MOVE.jumpSpeed;
      this.grounded = false;
      this.airJumpsLeft = MOVE.airJumps;
      this.airTime = 0;
    } else if (input.jump && this.airJumpsLeft > 0 && this.airTime >= MOVE.airJumpDelay) {
      // The second jump. Taken from wherever you are in the arc, and it
      // REPLACES the fall rather than adding to it — adding would make a jump
      // taken at the top of the first one enormous and one taken while
      // dropping do nothing, which is the same button doing two different
      // jobs depending on timing nobody can see.
      this.velocity.y = MOVE.doubleJumpSpeed;
      this.airJumpsLeft--;
      this.justDoubleJumped = true;
    }
    this.velocity.y += MOVE.gravity * dt;

    const stepX = this.velocity.x * dt;
    const stepZ = this.velocity.z * dt;
    this.position.x += stepX;
    this.position.z += stepZ;
    this.resolveHorizontal(colliders, Math.hypot(stepX, stepZ));
    this.moveAxis('y', this.velocity.y * dt, colliders);

    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocity.y = 0;
      this.grounded = true;
    }
    if (this.grounded) {
      this.airJumpsLeft = MOVE.airJumps;
      this.airTime = 0;
    } else {
      this.airTime += dt;
    }
    if (this.grounded && !wasGrounded) this.justLanded = true;

    const moving = Math.hypot(this.velocity.x, this.velocity.z) > 0.4;
    if (moving) this.facing = Math.atan2(this.velocity.x, this.velocity.z);

    this.mesh.position.copy(this.position);
    this.mesh.rotation.y = lerpAngle(this.mesh.rotation.y, this.facing, 1 - Math.exp(-14 * dt));
    this.shadow.update(this.position.y);

    if (this.rig) {
      this.rig.play(this.rigState);
      // Match the cycle to the ground speed so the feet stop skating.
      const speed = Math.hypot(this.velocity.x, this.velocity.z);
      this.rig.setSpeedScale(
        THREE.MathUtils.clamp(speed / (MOVE.walkSpeed * this.traits.speed), 0.45, 1.8)
      );
      this.rig.update(dt);
      // Animation already carries the weight shift, so squash only on the
      // knockback — stacking it on a walk cycle reads as a wobble bug.
      const punch = this.stun > 0 ? 1.14 : 1;
      this.mesh.scale.set(1 / Math.sqrt(punch), punch, 1 / Math.sqrt(punch));
    } else {
      // Greybox placeholder: enough to read airtime without a skeleton.
      const stretch = THREE.MathUtils.clamp(1 + this.velocity.y * 0.012, 0.85, 1.18);
      this.mesh.scale.set(1 / Math.sqrt(stretch), stretch, 1 / Math.sqrt(stretch));
    }
  }

  /**
   * Push out along the axis of LEAST penetration.
   *
   * Resolving x and z separately sends a character clipping a corner out of
   * the far side of whatever it touched — and the kitchen's counters are 70
   * units long. Least-penetration is both correct and what lets you slide
   * along a wall while being chased instead of sticking to it.
   */
  private resolveHorizontal(colliders: THREE.Box3[], stepLength: number): void {
    const budget = stepLength + MOVE.radius * 4;

    for (let pass = 0; pass < 2; pass++) {
      let moved = false;

      for (const c of colliders) {
        const box = this.aabb();
        if (!penetrates(box, c)) continue;

        const leftX = box.max.x - c.min.x;
        const rightX = c.max.x - box.min.x;
        const pushX = leftX < rightX ? -leftX : rightX;

        const backZ = box.max.z - c.min.z;
        const frontZ = c.max.z - box.min.z;
        const pushZ = backZ < frontZ ? -backZ : frontZ;

        if (Math.min(Math.abs(pushX), Math.abs(pushZ)) > budget) continue;

        if (Math.abs(pushX) < Math.abs(pushZ)) {
          this.position.x += pushX;
          this.velocity.x = 0;
        } else {
          this.position.z += pushZ;
          this.velocity.z = 0;
        }
        moved = true;
      }

      if (!moved) break;
    }
  }

  private moveAxis(axis: 'x' | 'y' | 'z', delta: number, colliders: THREE.Box3[]): void {
    if (delta === 0) return;
    this.position[axis] += delta;
    const box = this.aabb();

    for (const c of colliders) {
      if (!penetrates(box, c)) continue;

      if (axis === 'y' && delta < 0) {
        // LESZÁLLÁS: az számít, honnan jössz, nem az, milyen magas a doboz.
        //
        // A régi szabály azt mondta: ha a felület egy lépcsőnél magasabbra
        // emelne, az fal — ne szállj rá. Ez összemosott két külön dolgot:
        //
        //   · BELESZALADSZ egy bútorba oldalról — oda tényleg nem szabad
        //     felpattanni, mert az teleportálás lenne;
        //   · RÁESEL fentről — az viszont leszállás, és pont ezért ugrottál.
        //
        // A kettőt a MOZGÁS IRÁNYA különbözteti meg, nem a magasság: ha a
        // talpad a lépés ELŐTT a doboz teteje fölött volt, akkor ráérkezel.
        // A régi szabállyal a lakás bútorainak 89 százalékára nem lehetett
        // felmenni, és a felhasználó joggal kérte, hogy lehessen.
        const feetBefore = box.min.y - delta;
        if (feetBefore < c.max.y - STEP_HEIGHT) continue;
        this.position.y += c.max.y - box.min.y;
        this.grounded = true;
        this.velocity.y = 0;
      } else if (axis === 'y') {
        this.position.y -= box.max.y - c.min.y;
        this.velocity.y = 0;
      } else {
        if (delta > 0) this.position[axis] -= box.max[axis] - c.min[axis];
        else this.position[axis] += c.max[axis] - box.min[axis];
        this.velocity[axis] = 0;
      }
      box.copy(this.aabb());
    }
  }

  private aabb(): THREE.Box3 {
    const r = MOVE.radius;
    return new THREE.Box3(
      new THREE.Vector3(this.position.x - r, this.position.y, this.position.z - r),
      new THREE.Vector3(this.position.x + r, this.position.y + MOVE.height, this.position.z + r)
    );
  }
}

function approach(current: number, target: number, maxDelta: number): number {
  const diff = target - current;
  if (Math.abs(diff) <= maxDelta) return target;
  return current + Math.sign(diff) * maxDelta;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}
