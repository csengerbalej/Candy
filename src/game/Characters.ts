/**
 * The four playable monsters (spec §5).
 *
 * Balance rule from the spec: no character may be the obvious pick. Each trait
 * below is therefore paid for somewhere else — the vampire is fast but loses
 * candy easily, the zombie shrugs off being caught but is slow and loud.
 *
 * Three of the four share one 28-bone skeleton, so a single clip pack animates
 * all of them — the zombie was sculpted without a rig and had the werewolf's
 * skeleton transferred onto it (tools/rig-transfer.py). The ghost is animated
 * in code, which is both a limitation of its mesh and the right answer for it.
 */
export type CharacterId = 'werewolf' | 'vampire' | 'ghost' | 'zombie';
export type MotionKind = 'skeletal' | 'float' | 'shamble';

export interface CharacterTraits {
  /** Multiplies walk and sprint speed. */
  speed: number;
  /** Multiplies the radius of the noise this character makes. Lower is sneakier. */
  noise: number;
  /** Multiplies how long a catch stuns you. */
  stun: number;
  /** Multiplies the candy a catch costs you. */
  candyLoss: number;
  /** Passes through vent grilles and other gaps the others cannot. */
  passesGates: boolean;
}

export interface CharacterDef {
  id: CharacterId;
  name: string;
  ability: string;
  cost: string;
  color: number;
  model: string;
  /** Álló portré a választóképernyőre; lásd tools/portraits.py. */
  portrait: string;
  /** Extra clip pack, shared by every character on the same skeleton. */
  clips?: string;
  motion: MotionKind;
  height: number;
  yaw: number;
  traits: CharacterTraits;
}

const SHARED_CLIPS = 'models/werewolf.clips.json';

export const CHARACTERS: Record<CharacterId, CharacterDef> = {
  werewolf: {
    id: 'werewolf',
    name: 'VÉRFARKAS',
    ability: 'Erős — a lebukás kevésbé viseli meg',
    cost: 'Cserébe zajos: messzebbről meghallják',
    color: 0xff7a29,
    model: 'models/werewolf.json',
    portrait: 'art/monsters/werewolf.webp',
    clips: SHARED_CLIPS,
    motion: 'skeletal',
    height: 1.7,
    yaw: 0,
    traits: { speed: 1, noise: 1.2, stun: 0.75, candyLoss: 0.7, passesGates: false },
  },
  vampire: {
    id: 'vampire',
    name: 'VÁMPÍR',
    ability: 'Gyors és halk — a legjobb csaliként',
    cost: 'Cserébe törékeny: elkapva sok cukorkát veszít',
    color: 0xc45cff,
    model: 'models/vampire.json',
    portrait: 'art/monsters/vampire.webp',
    clips: SHARED_CLIPS,
    motion: 'skeletal',
    height: 1.62,
    yaw: 0,
    traits: { speed: 1.18, noise: 0.65, stun: 1, candyLoss: 1.5, passesGates: false },
  },
  ghost: {
    id: 'ghost',
    name: 'SZELLEM',
    ability: 'Átlebeg a szellőzőrácsokon — saját útvonalai vannak',
    cost: 'Cserébe lassú, és nem tud gyorsan menekülni',
    color: 0x7ad7ff,
    model: 'models/ghost.json',
    portrait: 'art/monsters/ghost.webp',
    // No skeleton on purpose. This sculpt is a floating wisp with a long
    // trailing tail and no legs, so a biped walk cycle has nothing to drive.
    // Bob, lean and drift is what a ghost's animation actually is.
    motion: 'float',
    // Sized smaller than the others on purpose: the sculpt's trailing tail is
    // twice as long as its body is tall, so matching heights would give the
    // ghost three times everyone else's floor footprint.
    height: 1.2,
    yaw: 0,
    traits: { speed: 0.85, noise: 0.45, stun: 1, candyLoss: 1, passesGates: true },
  },
  zombie: {
    id: 'zombie',
    name: 'ZOMBI',
    ability: 'Alig hatja meg, ha elkapják — azonnal talpra áll',
    cost: 'Cserébe a leglassabb, és csoszog',
    color: 0x6ef0a0,
    model: 'models/zombie.json',
    portrait: 'art/monsters/zombie.webp',
    clips: SHARED_CLIPS,
    motion: 'skeletal',
    height: 1.72,
    yaw: 0,
    traits: { speed: 0.82, noise: 1.1, stun: 0.4, candyLoss: 0.5, passesGates: false },
  },
};

export const CHARACTER_ORDER: CharacterId[] = ['werewolf', 'vampire', 'ghost', 'zombie'];

export type RoleId = 'driver' | 'navigator';

export interface Selection {
  /**
   * FOGÓ mód: versengés a kooperáció helyett.
   *
   * A választásban él, nem külön beállításban: a mód a ház szabályait írja
   * át, tehát a futam elején dől el, és utána nem változhat — egy félidőben
   * átkapcsolt szabálykészlet csak vitát szülne.
   */
  fogo?: boolean;
  /**
   * KÍSÉRTETHÁZ mód: a harmadik játékmód.
   *
   * Ugyanott dől el, ugyanabból az okból: a ház szabályait írja át. Sötét,
   * szörnyek, egy lámpa kettőtökre — és meg lehet halni.
   */
  haunt?: boolean;
  /** What the players called themselves, for the HUD and the end-of-run awards. */
  names: [string, string];
  characters: [CharacterId, CharacterId];
  /** Index of the player who drives; the other navigates. */
  driverIndex: 0 | 1;
  /**
   * Egyedül játszik-e valaki.
   *
   * Nem külön játékmód, hanem egy kapcsoló: a co-op feltételek — együtt
   * kiszállni, együtt kijutni — változatlanul élnek, csak a két szörnyet
   * felváltva irányítja ugyanaz az ember. A terv arról szól, hogy KÉT
   * szörnynek kell ott lennie, nem arról, hogy két embernek.
   */
  solo?: boolean;
}

const STORAGE_KEY = 'candypocalypse.selection';

/**
 * The drive and house sections are separate page loads for now, so the choice
 * has to survive one. sessionStorage is the smallest thing that does that, and
 * it is the seed of the save system the spec asks for in §29.
 */
export function saveSelection(selection: Selection): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(selection));
  } catch {
    // Private browsing, or storage disabled. The game still runs; the choice
    // just resets at the next section.
  }
}

export function loadSelection(): Selection | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Selection;
    if (!parsed?.characters?.every((id) => id in CHARACTERS)) return null;
    if (!Array.isArray(parsed.names)) parsed.names = ['P1', 'P2'];
    return parsed;
  } catch {
    return null;
  }
}
