import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeck, dealNewRound } from '@tichu/shared';
import { clearSoloGameSnapshot, hasSoloGameSnapshot, loadSoloGameSnapshot, saveSoloGameSnapshot } from './soloGamePersistence';

afterEach(() => {
  window.localStorage.clear();
});

describe('soloGamePersistence', () => {
  it('round-trips a snapshot exactly through save/load', () => {
    const state = dealNewRound(createDeck());
    const snapshot = { state, cumulativeScores: [120, 340] as const };

    saveSoloGameSnapshot(snapshot);

    expect(loadSoloGameSnapshot()).toEqual(snapshot);
    expect(hasSoloGameSnapshot()).toBe(true);
  });

  it('round-trips roundHistory too', () => {
    const state = dealNewRound(createDeck());
    const snapshot = { state, cumulativeScores: [65, 135] as const, roundHistory: [[40, 60], [25, 75]] as const };

    saveSoloGameSnapshot(snapshot);

    expect(loadSoloGameSnapshot()).toEqual(snapshot);
  });

  it('accepts a snapshot with no roundHistory field at all (from before it existed)', () => {
    const state = dealNewRound(createDeck());
    // Deliberately not using saveSoloGameSnapshot -- simulates a snapshot
    // written by an older app version that never had this field.
    window.localStorage.setItem('tichu:soloGameSnapshot', JSON.stringify({ state, cumulativeScores: [0, 0] }));

    const loaded = loadSoloGameSnapshot();
    expect(loaded).not.toBeNull();
    expect(loaded!.roundHistory).toBeUndefined();
  });

  it('returns null when nothing has been saved', () => {
    expect(loadSoloGameSnapshot()).toBeNull();
    expect(hasSoloGameSnapshot()).toBe(false);
  });

  it('removes the snapshot on clear', () => {
    saveSoloGameSnapshot({ state: dealNewRound(createDeck()), cumulativeScores: [0, 0] });
    clearSoloGameSnapshot();

    expect(loadSoloGameSnapshot()).toBeNull();
  });

  it('treats garbage/incompatible-shape data as no snapshot, rather than throwing', () => {
    window.localStorage.setItem('tichu:soloGameSnapshot', JSON.stringify({ notAGameState: true }));
    expect(loadSoloGameSnapshot()).toBeNull();

    window.localStorage.setItem('tichu:soloGameSnapshot', 'not even json');
    expect(loadSoloGameSnapshot()).toBeNull();
  });

  it('is best-effort when localStorage throws (e.g. private browsing)', () => {
    const getItemSpy = vi.spyOn(window.localStorage.__proto__ as Storage, 'getItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });
    const setItemSpy = vi.spyOn(window.localStorage.__proto__ as Storage, 'setItem').mockImplementation(() => {
      throw new Error('storage disabled');
    });

    expect(() => saveSoloGameSnapshot({ state: dealNewRound(createDeck()), cumulativeScores: [0, 0] })).not.toThrow();
    expect(loadSoloGameSnapshot()).toBeNull();

    getItemSpy.mockRestore();
    setItemSpy.mockRestore();
  });
});
