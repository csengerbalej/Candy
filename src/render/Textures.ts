import * as THREE from 'three';
import { canDraw } from './headless';

/**
 * Procedural surface textures, drawn on a canvas at load time.
 *
 * The kitchen was fifteen flat-coloured boxes. At monster scale that is worse
 * than it sounds: the whole joke is that the players are tiny, and a surface
 * with no grain, no seam and no repeat gives the eye nothing to measure them
 * against — a 60-unit counter and a 6-unit box look identical from the front.
 * Texture here is not decoration, it is the scale cue.
 *
 * Everything is generated rather than downloaded: it costs no bytes in the
 * published build, it stays consistent with the palette, and the repeat can be
 * tuned per surface against the authored unit grid instead of against whatever
 * a photo happened to be shot at.
 */

/** Deterministic noise, so a rebuild does not reshuffle the grain. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

type Draw = (ctx: CanvasRenderingContext2D, size: number) => void;

const cache = new Map<string, THREE.Texture | null>();

/**
 * Draw once, share everywhere.
 *
 * Returns null with no DOM: the headless probes build a HouseInterior, and a
 * probe that ABORTS on a missing canvas is worse than one that fails, because
 * every assertion after it is silently lost. Callers must omit the map key
 * entirely rather than passing null — three.js treats `map: null` as "no map"
 * but `map: undefined` as "leave it alone", and only the former is what we
 * want for a material that also has a colour.
 */
function make(key: string, size: number, draw: Draw, repeat: number): THREE.Texture | null {
  const cached = cache.get(key);
  if (cached !== undefined) return cached;
  if (!canDraw()) {
    cache.set(key, null);
    return null;
  }
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeat, repeat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  cache.set(key, texture);
  return texture;
}

/** Speckle a tile with fine grain, without breaking its edges. */
function grain(ctx: CanvasRenderingContext2D, size: number, seed: number, amount: number): void {
  const random = rng(seed);
  for (let i = 0; i < size * size * 0.08; i++) {
    const x = random() * size;
    const y = random() * size;
    const a = random() * amount;
    ctx.fillStyle = random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a * 1.4})`;
    ctx.fillRect(x, y, 1, 1);
  }
}

/**
 * Chequered lino, two tiles across the texture.
 *
 * Two rather than one so the repeat is even at any scale — an odd count makes
 * the pattern shift by half a tile at every seam.
 */
export function linoFloor(): THREE.Texture | null {
  return make('lino', 256, (ctx, size) => {
    const half = size / 2;
    for (let ty = 0; ty < 2; ty++) {
      for (let tx = 0; tx < 2; tx++) {
        ctx.fillStyle = (tx + ty) % 2 === 0 ? '#241a44' : '#1b1435';
        ctx.fillRect(tx * half, ty * half, half, half);
      }
    }
    grain(ctx, size, 7, 0.1);
    // Grout, drawn last so the speckle does not cross it.
    ctx.strokeStyle = 'rgba(10,7,22,0.85)';
    ctx.lineWidth = 3;
    for (let i = 0; i <= 2; i++) {
      ctx.beginPath();
      ctx.moveTo(i * half, 0);
      ctx.lineTo(i * half, size);
      ctx.moveTo(0, i * half);
      ctx.lineTo(size, i * half);
      ctx.stroke();
    }
    // A worn highlight along one edge of each tile: flat grout reads as a
    // drawn grid rather than as a gap between two solid things.
    ctx.strokeStyle = 'rgba(150,130,210,0.18)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 2; i++) {
      ctx.strokeRect(i * half + 3, 3, half - 6, half - 6);
    }
  }, 5);
}

/** Striped wallpaper with a faint repeating motif. */
export function wallpaper(): THREE.Texture | null {
  return make('wallpaper', 256, (ctx, size) => {
    ctx.fillStyle = '#231a42';
    ctx.fillRect(0, 0, size, size);
    const stripe = size / 8;
    for (let i = 0; i < 8; i += 2) {
      ctx.fillStyle = 'rgba(58,44,100,0.55)';
      ctx.fillRect(i * stripe, 0, stripe, size);
    }
    // Motif: a small diamond every other stripe, offset row to row.
    ctx.fillStyle = 'rgba(120,96,190,0.20)';
    for (let row = 0; row < 8; row++) {
      for (let col = 0; col < 4; col++) {
        const cx = col * stripe * 2 + stripe + (row % 2 ? stripe : 0);
        const cy = row * (size / 8) + size / 16;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + 5, cy);
        ctx.lineTo(cx, cy + 5);
        ctx.lineTo(cx - 5, cy);
        ctx.fill();
      }
    }
    grain(ctx, size, 19, 0.07);
  }, 3);
}

/** Painted cabinet doors: panel frames with a wood grain under the paint. */
export function cabinet(): THREE.Texture | null {
  return make('cabinet', 256, (ctx, size) => {
    ctx.fillStyle = '#2e2450';
    ctx.fillRect(0, 0, size, size);
    // Grain: long wavering strokes along one axis.
    const random = rng(41);
    for (let i = 0; i < 90; i++) {
      const y = random() * size;
      ctx.strokeStyle = `rgba(${random() < 0.5 ? '18,12,36' : '76,62,124'},${0.06 + random() * 0.1})`;
      ctx.lineWidth = 0.5 + random() * 1.5;
      ctx.beginPath();
      ctx.moveTo(0, y);
      for (let x = 0; x <= size; x += 16) {
        ctx.lineTo(x, y + Math.sin((x / size) * Math.PI * 2 + i) * 2);
      }
      ctx.stroke();
    }
    // Two door panels, so a long counter reads as a row of cupboards.
    for (let i = 0; i < 2; i++) {
      const x = i * (size / 2);
      ctx.strokeStyle = 'rgba(12,8,26,0.7)';
      ctx.lineWidth = 3;
      ctx.strokeRect(x + 14, 14, size / 2 - 28, size - 28);
      ctx.strokeStyle = 'rgba(132,110,200,0.22)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(x + 18, 18, size / 2 - 36, size - 36);
    }
  }, 2);
}

/** Speckled stone worktop. */
export function worktop(): THREE.Texture | null {
  return make('worktop', 256, (ctx, size) => {
    ctx.fillStyle = '#39305c';
    ctx.fillRect(0, 0, size, size);
    const random = rng(88);
    for (let i = 0; i < 1400; i++) {
      const x = random() * size;
      const y = random() * size;
      const r = 0.6 + random() * 1.8;
      const shade = random();
      ctx.fillStyle =
        shade < 0.35 ? 'rgba(14,10,30,0.55)' : shade < 0.8 ? 'rgba(150,132,210,0.22)' : 'rgba(226,210,255,0.3)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 3);
}

/** Brushed metal, streaked vertically — reads as a fridge door. */
export function brushedMetal(): THREE.Texture | null {
  return make('metal', 256, (ctx, size) => {
    ctx.fillStyle = '#453a6e';
    ctx.fillRect(0, 0, size, size);
    const random = rng(123);
    for (let x = 0; x < size; x++) {
      const a = 0.04 + random() * 0.12;
      ctx.fillStyle = random() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
      ctx.fillRect(x, 0, 1, size);
    }
    // A soft vertical highlight, so a big flat door catches the light
    // somewhere rather than reading as one even slab.
    const gradient = ctx.createLinearGradient(0, 0, size, 0);
    gradient.addColorStop(0, 'rgba(0,0,0,0.25)');
    gradient.addColorStop(0.35, 'rgba(255,255,255,0.12)');
    gradient.addColorStop(1, 'rgba(0,0,0,0.3)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }, 1);
}

/** Cracked outdoor asphalt for the town's horizon plane. */
export function asphalt(): THREE.Texture | null {
  return make('asphalt', 256, (ctx, size) => {
    ctx.fillStyle = '#16102c';
    ctx.fillRect(0, 0, size, size);
    grain(ctx, size, 5, 0.12);
    const random = rng(64);
    for (let i = 0; i < 14; i++) {
      ctx.strokeStyle = `rgba(8,5,18,${0.3 + random() * 0.3})`;
      ctx.lineWidth = 0.5 + random();
      ctx.beginPath();
      let x = random() * size;
      let y = random() * size;
      ctx.moveTo(x, y);
      for (let s = 0; s < 6; s++) {
        x += (random() - 0.5) * 40;
        y += (random() - 0.5) * 40;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }, 40);
}

/**
 * Build a material with a texture if one could be made, and without if not.
 *
 * The colour is kept alongside the map on purpose: it survives headlessly, and
 * it lets one generated texture serve several surfaces at different tints.
 */
export function textured(
  texture: THREE.Texture | null,
  options: THREE.MeshStandardMaterialParameters
): THREE.MeshStandardMaterial {
  const params: THREE.MeshStandardMaterialParameters = { ...options };
  if (texture) params.map = texture;
  return new THREE.MeshStandardMaterial(params);
}

/**
 * Give a box its own copy of a texture, scaled to the face it covers.
 *
 * A shared texture on boxes of wildly different sizes stretches the pattern:
 * the 70-unit counter and the 8-unit chair would show the same number of
 * cabinet doors. Cloning is cheap — the image is shared, only the repeat
 * differs.
 */
export function fitToBox(
  material: THREE.MeshStandardMaterial,
  width: number,
  height: number,
  unitsPerTile: number
): void {
  if (!material.map) return;
  const map = material.map.clone();
  map.needsUpdate = true;
  map.repeat.set(Math.max(1, Math.round(width / unitsPerTile)), Math.max(1, Math.round(height / unitsPerTile)));
  material.map = map;
}
