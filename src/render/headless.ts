/**
 * Is there a real DOM to draw into?
 *
 * Not the same question as "is `document` defined". The headless probes define
 * a stub `document` so the input manager has somewhere to hang its listeners,
 * and a guard that only checks for the global sails straight past it and dies
 * on `createElement is not a function`. Ask for the thing that is actually
 * about to be used.
 */
export function canDraw(): boolean {
  return typeof document !== 'undefined' && typeof document.createElement === 'function';
}
