import * as THREE from 'three';
import { SPLIT, CAR } from '../core/config';
import { setOutlinesVisible } from '../render/Toon';

export type SplitSensitivity = 'tight' | 'normal' | 'loose';

export interface Settings {
  splitOrientation: 'horizontal' | 'vertical';
  splitSensitivity: SplitSensitivity;
  shadows: boolean;
  outlines: boolean;
  /**
   * Cap on devicePixelRatio.
   *
   * It defaults to the display's own density. Capping at 1 on a 2× screen
   * renders at a quarter of the pixels and lets the browser upscale, which is
   * exactly the soft, chewed-looking edges that made the characters look like
   * melted versions of themselves.
   */
  resolution: number;
  showFps: boolean;
  invertSteering: boolean;
}

export const DEFAULTS: Settings = {
  splitOrientation: 'horizontal',
  splitSensitivity: 'normal',
  shadows: true,
  outlines: true,
  resolution: 2,
  showFps: false,
  invertSteering: false,
};

/** How far apart the players may drift before the screen divides, by preset. */
const SENSITIVITY: Record<SplitSensitivity, { merge: number; split: number }> = {
  tight: { merge: 9, split: 17 },
  normal: { merge: 14, split: 26 },
  loose: { merge: 22, split: 40 },
};

const STORAGE_KEY = 'candypocalypse.settings';

export const settings: Settings = { ...DEFAULTS };

export function loadSettings(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    Object.assign(settings, { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Settings>) });
  } catch {
    // Storage disabled: defaults are perfectly playable.
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Nothing to do; the session keeps the change in memory either way.
  }
}

/**
 * Push the current settings into the systems that care.
 *
 * Settings are only real if they take effect the moment they change — a menu
 * that needs a restart to apply a toggle teaches players not to trust it. So
 * every entry here writes straight into the live renderer, the live split
 * thresholds, or the live materials.
 */
export function applySettings(renderer: THREE.WebGLRenderer): void {
  SPLIT.orientation = settings.splitOrientation;
  SPLIT.mergeDistance = SENSITIVITY[settings.splitSensitivity].merge;
  SPLIT.splitDistance = SENSITIVITY[settings.splitSensitivity].split;

  renderer.shadowMap.enabled = settings.shadows;
  renderer.shadowMap.needsUpdate = true;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.resolution));

  setOutlinesVisible(settings.outlines);

  CAR.steerInvert = settings.invertSteering ? -1 : 1;
}
