import { CHARACTERS, type Selection } from './Characters';
import { Session, type SessionStats } from './Session';

const STORAGE_KEY = 'candypocalypse.save';
const VERSION = 1;

interface SaveFile {
  version: number;
  savedAt: number;
  selection: Selection;
  stats: SessionStats;
  visited: number[];
  driverIndex: 0 | 1;
}

/**
 * A night in progress, on disk (spec §29).
 *
 * Saving happens at section boundaries only — between a house and the next
 * drive. Mid-chase is not a resumable moment: restoring a player halfway
 * through being caught would be worse than replaying the house.
 */
export function saveRun(session: Session): void {
  const file: SaveFile = {
    version: VERSION,
    savedAt: Date.now(),
    selection: session.selection,
    stats: session.stats,
    visited: [...session.visited],
    driverIndex: session.driverIndex,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(file));
  } catch {
    // Storage disabled: the run still finishes, it just cannot be resumed.
  }
}

export function clearRun(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nothing to clear */
  }
}

/** A short description for the continue entry, or null when there is no save. */
export function describeSave(): { label: string; detail: string } | null {
  const file = readSave();
  if (!file) return null;
  const names = file.selection.names.join(' és ');
  const monsters = file.selection.characters.map((id) => CHARACTERS[id].name).join(' + ');
  return {
    label: `${names} — ${file.stats.housesVisited}. ház után`,
    detail: `${monsters} · 🍬 ${file.stats.candy}`,
  };
}

export function loadRun(): Session | null {
  const file = readSave();
  if (!file) return null;

  const session = new Session(file.selection);
  Object.assign(session.stats, file.stats);
  for (const id of file.visited) session.visited.add(id);
  session.driverIndex = file.driverIndex;
  return session;
}

function readSave(): SaveFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const file = JSON.parse(raw) as SaveFile;
    // A save from an older build describes a game that no longer exists.
    if (file.version !== VERSION) return null;
    if (!file.selection?.characters?.every((id) => id in CHARACTERS)) return null;
    return file;
  } catch {
    return null;
  }
}
