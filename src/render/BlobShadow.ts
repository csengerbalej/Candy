import * as THREE from 'three';
import { canDraw } from './headless';

let texture: THREE.Texture | null = null;

/**
 * A soft ellipse under a character.
 *
 * Real shadow maps in this scene are cast by one dim moon through a window, so
 * a character standing in the middle of the room has nothing tying it to the
 * floor and reads as floating. A blob shadow is the oldest trick there is and
 * it is still the right one: it always exists, it costs nothing, and it fades
 * as the character leaves the ground, which is also the jump's best cue.
 */
function shadowTexture(): THREE.Texture | null {
  if (texture) return texture;
  // Headless probes construct PlayerController, which owns one of these. A
  // canvas is not available there, and a probe that ABORTS is worse than one
  // that fails: it silently drops every assertion after it.
  if (!canDraw()) return null;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(0,0,0,0.55)');
  gradient.addColorStop(0.45, 'rgba(0,0,0,0.30)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class BlobShadow {
  readonly mesh: THREE.Mesh;

  constructor(private readonly radius: number) {
    const map = shadowTexture();
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        // three warns on an explicit `undefined`, so the key is omitted
        // entirely when there is no canvas to draw the gradient on.
        ...(map ? { map } : {}),
        transparent: true,
        depthWrite: false,
        // It lies on the floor by definition; never let it fight for depth.
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
      })
    );
    this.mesh.rotation.x = -Math.PI / 2;
    this.mesh.renderOrder = 1;
  }

  /**
   * `height` is how far the character is above the ground. The shadow shrinks
   * and fades with it, which is what sells the jump.
   */
  update(height: number): void {
    const lift = THREE.MathUtils.clamp(height, 0, 3);
    const shrink = 1 - lift * 0.22;
    this.mesh.scale.setScalar(this.radius * 2 * Math.max(0.35, shrink));
    (this.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - lift * 0.3);
    this.mesh.position.y = -height + 0.03;
  }
}
