import * as THREE from 'three';
import { NOISE } from '../core/config';

export interface NoiseEvent {
  position: THREE.Vector3;
  radius: number;
  /** Who made it — so the HUD can say who just gave the game away. */
  source: string;
  ttl: number;
}

/**
 * Sound is the shared currency of this game: it is how one player reaches
 * across the room and moves the other player's problem. Everything that makes
 * noise goes through here so the AI has exactly one thing to listen to.
 */
export class NoiseSystem {
  readonly events: NoiseEvent[] = [];

  emit(position: THREE.Vector3, radius: number, source: string): void {
    this.events.push({ position: position.clone(), radius, source, ttl: NOISE.eventLifetime });
  }

  update(dt: number): void {
    for (let i = this.events.length - 1; i >= 0; i--) {
      this.events[i].ttl -= dt;
      if (this.events[i].ttl <= 0) this.events.splice(i, 1);
    }
  }

  /** Loudest noise audible from `listener`, or null. */
  heardAt(listener: THREE.Vector3): NoiseEvent | null {
    let best: NoiseEvent | null = null;
    for (const e of this.events) {
      if (listener.distanceTo(e.position) > e.radius) continue;
      if (!best || e.radius > best.radius) best = e;
    }
    return best;
  }
}
