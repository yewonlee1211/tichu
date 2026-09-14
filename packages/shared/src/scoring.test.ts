import { describe, expect, it } from 'vitest';
import doubleOutFixture from './goldenFixtures/double_out.json';
import grandTichuFixture from './goldenFixtures/grand_tichu.json';
import lastCardHandoverFixture from './goldenFixtures/last_card_handover.json';
import { stateFromFixture } from './goldenFixtures/decode';
import { type Card, Rank, Suit } from './cards';
import { type GameState, NUM_PLAYERS, Phase } from './gameState';
import { DEFAULT_TARGET_SCORE, DOUBLE_WIN_BONUS, TICHU_BONUS, isGameOver, scoreRound } from './scoring';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

function makeRoundOverState(overrides: Partial<GameState>): GameState {
  const base: GameState = {
    hands: Array.from({ length: NUM_PLAYERS }, () => []),
    pendingFinalCards: Array.from({ length: NUM_PLAYERS }, () => []),
    phase: Phase.RoundOver,
    currentPlayer: 0,
    trickLeader: 0,
    trickCards: [],
    currentBest: null,
    currentStrength: 0.0,
    lastPlayerToAct: null,
    passesInARow: 0,
    finishedOrder: [],
    collectedTricks: Array.from({ length: NUM_PLAYERS }, () => []),
    largeTichuCalls: [false, false, false, false],
    tichuCalls: [false, false, false, false],
    mahjongWish: null,
    receivedFrom: Array.from({ length: NUM_PLAYERS }, () => ({})),
    tichuDecided: [false, false, false, false],
  };
  return { ...base, ...overrides };
}

function expectOk<T>(result: { ok: boolean; value?: T; error?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.value as T;
}

describe('golden fixtures: scoreRound', () => {
  it('matches Python for a double win with a stacked Tichu bonus', () => {
    const state = stateFromFixture(doubleOutFixture.afterPlayState as never);

    const deltas = expectOk(scoreRound(state));

    expect(deltas).toEqual([doubleOutFixture.teamScoreDeltas.team0, doubleOutFixture.teamScoreDeltas.team1]);
  });

  it('matches Python for a last-card handover to the opposing team', () => {
    const state = stateFromFixture(lastCardHandoverFixture.afterPlayState as never);

    const deltas = expectOk(scoreRound(state));

    expect(deltas).toEqual([
      lastCardHandoverFixture.teamScoreDeltas.team0,
      lastCardHandoverFixture.teamScoreDeltas.team1,
    ]);
  });

  it('matches Python for a successful Grand Tichu call', () => {
    const state = stateFromFixture(grandTichuFixture.finishedState as never);

    const deltas = expectOk(scoreRound(state));

    expect(deltas).toEqual([grandTichuFixture.teamScoreDeltas.team0, grandTichuFixture.teamScoreDeltas.team1]);
  });
});

describe('scoreRound: preconditions', () => {
  it('rejects a round that has not ended', () => {
    const state = makeRoundOverState({ phase: Phase.Playing, finishedOrder: [0, 1, 2] });

    expect(scoreRound(state).ok).toBe(false);
  });

  it('rejects fewer than 2 finishers', () => {
    const state = makeRoundOverState({ finishedOrder: [0] });

    expect(scoreRound(state).ok).toBe(false);
  });

  it('rejects exactly 2 finishers who are not partners (not a real double win)', () => {
    // Seats 0 and 1 are on opposing teams -- 2 finishers here is invalid,
    // the round must continue to a 3rd finisher.
    const state = makeRoundOverState({ finishedOrder: [0, 1] });

    expect(scoreRound(state).ok).toBe(false);
  });
});

describe('scoreRound: double win', () => {
  it('awards only the double-win bonus, ignoring collected trick points', () => {
    const state = makeRoundOverState({
      finishedOrder: [0, 2],
      collectedTricks: [[card(Rank.King)], [], [card(Rank.Ten)], []],
    });

    const deltas = expectOk(scoreRound(state));

    expect(deltas).toEqual([DOUBLE_WIN_BONUS, 0]);
  });
});

describe('scoreRound: Tichu bonus', () => {
  it('penalizes a Tichu call from a player who did not finish first', () => {
    const state = makeRoundOverState({
      finishedOrder: [1, 0, 2],
      tichuCalls: [true, false, false, false],
      collectedTricks: [[], [], [], []],
      hands: [[], [], [], []],
    });

    const deltas = expectOk(scoreRound(state));

    expect(deltas[0]).toBe(-TICHU_BONUS);
  });
});

describe('isGameOver', () => {
  it('is false while both teams are under the target score', () => {
    expect(isGameOver([500, 600])).toBe(false);
  });

  it('is true once either team reaches the default target score', () => {
    expect(isGameOver([DEFAULT_TARGET_SCORE, 0])).toBe(true);
  });

  it('honors a custom target score', () => {
    expect(isGameOver([50, 0], 50)).toBe(true);
    expect(isGameOver([49, 0], 50)).toBe(false);
  });
});
