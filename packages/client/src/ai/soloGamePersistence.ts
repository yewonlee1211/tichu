import type { GameState } from '@tichu/shared';

const STORAGE_KEY = 'tichu:soloGameSnapshot';

export interface SoloGameSnapshot {
  readonly state: GameState;
  readonly cumulativeScores: readonly [number, number];
  /** Each completed round's own score, for the "점수 내역" history view.
   * Optional so a snapshot saved before this field existed still loads --
   * treated as "no history yet" rather than a corrupt/unusable snapshot. */
  readonly roundHistory?: readonly (readonly [number, number])[];
}

/** Not a full schema validation -- just enough to reject `null`/garbage/a
 * stale shape from an old app version, so a corrupt snapshot means "nothing
 * to resume" instead of a crash while reconstructing the game. */
function isPlausibleSnapshot(value: unknown): value is SoloGameSnapshot {
  if (typeof value !== 'object' || value === null) return false;
  const { state, cumulativeScores, roundHistory } = value as Record<string, unknown>;
  if (typeof state !== 'object' || state === null) return false;
  if (!Array.isArray((state as Record<string, unknown>).hands)) return false;
  if (!Array.isArray(cumulativeScores) || cumulativeScores.length !== 2) return false;
  if (roundHistory !== undefined && !Array.isArray(roundHistory)) return false;
  return true;
}

/** Best-effort local persistence for solo-AI progress, so a page refresh
 * doesn't silently discard an in-progress game. `GameState` is plain data
 * (enums are string/number-valued, no functions/Map/Set), so a round-trip
 * through JSON is exact. localStorage may be unavailable (private browsing)
 * or hold data from an incompatible past schema -- neither case should
 * crash the app, it just means there's nothing (or nothing usable) to
 * resume. */
export function saveSoloGameSnapshot(snapshot: SoloGameSnapshot): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // Best-effort only -- see module doc comment.
  }
}

export function loadSoloGameSnapshot(): SoloGameSnapshot | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isPlausibleSnapshot(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function clearSoloGameSnapshot(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Best-effort only -- see module doc comment.
  }
}

/** Whether there's a game to resume -- used at app boot to decide whether to
 * route straight into the solo-AI flow (which then loads the actual
 * snapshot itself once the model is ready) instead of the home screen. */
export function hasSoloGameSnapshot(): boolean {
  return loadSoloGameSnapshot() !== null;
}
