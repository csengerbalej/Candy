export type Verb = 'move' | 'jump' | 'sprint' | 'action' | 'steer' | 'brake';

interface Binding {
  keyboard: string;
  gamepad: string;
}

/**
 * What a button is called, for the player holding it.
 *
 * Two players on one machine can be on different devices, so a legend that
 * says "press E" is wrong for half the room. Everything the HUD shows about
 * controls goes through here, keyed by player and by what they are actually
 * holding.
 */
const BINDINGS: Record<Verb, [Binding, Binding]> = {
  move: [
    { keyboard: 'W A S D', gamepad: 'bal kar' },
    { keyboard: '↑ ↓ ← →', gamepad: 'bal kar' },
  ],
  steer: [
    { keyboard: 'A / D', gamepad: 'bal kar' },
    { keyboard: '← / →', gamepad: 'bal kar' },
  ],
  brake: [
    { keyboard: 'S', gamepad: 'kar hátra' },
    { keyboard: '↓', gamepad: 'kar hátra' },
  ],
  jump: [
    { keyboard: 'Space', gamepad: 'A' },
    { keyboard: 'Enter', gamepad: 'A' },
  ],
  sprint: [
    { keyboard: 'Shift', gamepad: 'L3' },
    { keyboard: 'jobb Shift', gamepad: 'L3' },
  ],
  action: [
    { keyboard: 'E', gamepad: 'X' },
    { keyboard: '/', gamepad: 'X' },
  ],
};

export function keyFor(verb: Verb, player: number, usingGamepad: boolean): string {
  const binding = BINDINGS[verb][player === 0 ? 0 : 1];
  return usingGamepad ? binding.gamepad : binding.keyboard;
}

/** `<kbd>E</kbd> CUKORKA` — the key first, because that is what they look for. */
export function hint(verb: Verb, player: number, usingGamepad: boolean, label: string): string {
  return `<kbd>${keyFor(verb, player, usingGamepad)}</kbd>${label}`;
}
