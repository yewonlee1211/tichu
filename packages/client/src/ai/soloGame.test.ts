import type { InferenceSession } from 'onnxruntime-common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type Card, type Combo, type GameState, ComboType, NUM_PLAYERS, PARTNER, Phase, Rank, legalCombos } from '@tichu/shared';
import { HUMAN_SEAT, SoloGame } from './soloGame';

/** Deterministic stub: always prefers the first candidate action (index 0). Real
 * inference never runs in these tests -- this is exactly the seam decideAiMove's
 * own tests exercise directly; here it's only used to drive AI seats forward. */
function stubSession(): InferenceSession {
  return {
    async run(feeds: InferenceSession.FeedsType) {
      const numCandidates = (feeds.action_vectors as { dims: readonly number[] }).dims[0] as number;
      const logits = new Float32Array(numCandidates);
      logits[0] = 1;
      return {
        action_logits: { data: logits } as never,
        state_value: { data: Float32Array.from([0]) } as never,
      };
    },
  } as unknown as InferenceSession;
}

function isDragonSingle(combo: Combo | null): boolean {
  return combo !== null && combo.comboType === ComboType.Single && combo.cards[0]?.rank === Rank.Dragon;
}

function pickDragonRecipient(state: GameState, winner: number): number {
  for (let candidate = 0; candidate < NUM_PLAYERS; candidate += 1) {
    if (candidate === winner || PARTNER[candidate] === winner) continue;
    if (state.finishedOrder.includes(candidate)) continue;
    return candidate;
  }
  throw new Error('no valid Dragon recipient available');
}

/** Drives the human seat exactly like an AI would (always the first legal
 * combo, or pass when leading isn't required) until the round ends. Every
 * `human*` call is asserted to succeed -- a failure here means either this
 * driver or `SoloGame` violated the game's own rules. */
async function playRoundToCompletion(game: SoloGame): Promise<void> {
  const declined = game.decideHumanLargeTichu(false);
  expect(declined.ok).toBe(true);

  const hand = game.getState().hands[HUMAN_SEAT]!;
  const sorted = [...hand].sort((a, b) => a.rank - b.rank);
  const others = [0, 1, 2, 3].filter((p) => p !== HUMAN_SEAT);
  const gifts: Record<number, Card> = {};
  others.forEach((recipient, i) => {
    gifts[recipient] = sorted[i]!;
  });
  const exchanged = await game.submitHumanExchange(gifts);
  expect(exchanged.ok).toBe(true);

  let iterations = 0;
  while (game.getState().phase !== Phase.RoundOver) {
    iterations += 1;
    if (iterations > 200) throw new Error('playRoundToCompletion did not terminate -- likely a real bug');

    const state = game.getState();
    const combos = legalCombos(state, HUMAN_SEAT);
    if (combos.length > 0) {
      const combo = combos[0]!;
      const recipient = isDragonSingle(combo) ? pickDragonRecipient(state, HUMAN_SEAT) : null;
      const result = await game.humanPlayCombo(combo.cards, null, recipient);
      expect(result.ok).toBe(true);
    } else {
      const dragonPending = isDragonSingle(state.currentBest);
      const recipient = dragonPending ? pickDragonRecipient(state, state.lastPlayerToAct!) : null;
      const result = await game.humanPassTurn(recipient);
      expect(result.ok).toBe(true);
    }
  }
}

describe('SoloGame construction', () => {
  it('auto-declines Large Tichu for the three AI seats but leaves the human undecided', () => {
    const game = new SoloGame({ session: stubSession() });

    expect(game.getState().largeTichuCalls).toEqual([null, false, false, false]);
    expect(game.getState().phase).toBe(Phase.LargeTichu);
  });

  it('starts with no cumulative score and the match not over', () => {
    const game = new SoloGame({ session: stubSession() });

    expect(game.getCumulativeScores()).toEqual([0, 0]);
    expect(game.isMatchOver()).toBe(false);
  });
});

describe('SoloGame: Large Tichu and exchange', () => {
  it('moves to the Exchange phase once the human decides, and rejects deciding twice', () => {
    const game = new SoloGame({ session: stubSession() });

    const first = game.decideHumanLargeTichu(false);
    expect(first.ok).toBe(true);
    expect(game.getState().phase).toBe(Phase.Exchange);

    const second = game.decideHumanLargeTichu(true);
    expect(second.ok).toBe(false);
  });

  it('rejects submitting an exchange before the Large Tichu decision', async () => {
    const game = new SoloGame({ session: stubSession() });

    const result = await game.submitHumanExchange({});
    expect(result.ok).toBe(false);
  });

  it('resolves the exchange, redistributes all 56 cards, and returns control once it is the human\'s turn', async () => {
    const game = new SoloGame({ session: stubSession() });
    game.decideHumanLargeTichu(false);

    const hand = game.getState().hands[HUMAN_SEAT]!;
    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    const gifts = { 1: sorted[0]!, 2: sorted[1]!, 3: sorted[2]! };

    const result = await game.submitHumanExchange(gifts);

    expect(result.ok).toBe(true);
    if (result.ok) {
      // Not necessarily every hand still has 14 -- if an AI seat held the
      // exchanged Mahjong, submitHumanExchange already auto-played its lead
      // before returning (advanceAiTurns runs until it's the human's turn).
      const totalCards = result.value.hands.reduce((sum, h) => sum + h.length, 0) + result.value.trickCards.length;
      expect(totalCards).toBe(56);
      expect(result.value.phase).toBe(Phase.Playing);
      expect(result.value.currentPlayer).toBe(HUMAN_SEAT);
    }
  });
});

describe('SoloGame: full round', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        throw new Error('SoloGame must never make a network call');
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    globalThis.fetch = originalFetch;
  });

  it('completes an entire round with zero network calls', async () => {
    const game = new SoloGame({ session: stubSession() });

    await playRoundToCompletion(game);

    expect(game.getState().phase).toBe(Phase.RoundOver);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('after the human finishes, AI seats keep playing without further human input', async () => {
    // Not asserted directly here (no seam to force the human to finish first with
    // a random deal), but playRoundToCompletion's own 200-iteration guard would
    // fail loudly if advanceAiTurns ever stalled waiting on a finished human seat.
    const game = new SoloGame({ session: stubSession() });
    await playRoundToCompletion(game);
    expect(game.getState().finishedOrder.length).toBeGreaterThanOrEqual(2);
  });

  it('finishRoundAndDeal scores the round and deals a fresh one', async () => {
    const game = new SoloGame({ session: stubSession() });
    await playRoundToCompletion(game);

    const before = game.getCumulativeScores();
    const nextState = game.finishRoundAndDeal();

    const after = game.getCumulativeScores();
    expect(after[0] + after[1]).toBeGreaterThanOrEqual(before[0] + before[1]);
    expect(nextState.phase).toBe(Phase.LargeTichu);
    expect(nextState.largeTichuCalls).toEqual([null, false, false, false]);
  });
});

describe('SoloGame: human trick play validation', () => {
  it('rejects an illegal card play with a Result error instead of throwing', async () => {
    const game = new SoloGame({ session: stubSession() });
    game.decideHumanLargeTichu(false);
    const hand = game.getState().hands[HUMAN_SEAT]!;
    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    await game.submitHumanExchange({ 1: sorted[0]!, 2: sorted[1]!, 3: sorted[2]! });

    const state = game.getState();
    expect(state.currentPlayer).toBe(HUMAN_SEAT);
    // Two cards of deliberately different, non-Phoenix ranks: identifyCombo only
    // recognizes a 2-card set as a Pair when both share a rank (or one is the
    // Phoenix pairing with a real card), neither of which holds here -- so this
    // is guaranteed not to be a legal combo, regardless of how the deck shuffled.
    const nonPhoenix = [...state.hands[HUMAN_SEAT]!].sort((a, b) => a.rank - b.rank).filter((c) => c.rank !== Rank.Phoenix);
    const second = nonPhoenix.find((c) => c.rank !== nonPhoenix[0]!.rank)!;
    const notACombo = [nonPhoenix[0]!, second];

    const result = await game.humanPlayCombo(notACombo);
    expect(result.ok).toBe(false);
  });

  it('rejects calling Tichu after 14 cards have been reduced by a play', async () => {
    const game = new SoloGame({ session: stubSession() });
    game.decideHumanLargeTichu(false);
    const hand = game.getState().hands[HUMAN_SEAT]!;
    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    await game.submitHumanExchange({ 1: sorted[0]!, 2: sorted[1]!, 3: sorted[2]! });

    // Play (or pass through, for a following seat with no beating combo) until
    // the human actually gets to play a card and their hand drops below 14 --
    // right after the exchange, the human might be following rather than
    // leading, so a single combos[0] pick isn't guaranteed to exist yet.
    let iterations = 0;
    while (game.getState().hands[HUMAN_SEAT]!.length === 14) {
      iterations += 1;
      if (iterations > 50) throw new Error('human never got a chance to play a card');

      const state = game.getState();
      expect(state.currentPlayer).toBe(HUMAN_SEAT);
      const combos = legalCombos(state, HUMAN_SEAT);
      if (combos.length > 0) {
        const combo = combos[0]!;
        const recipient = isDragonSingle(combo) ? pickDragonRecipient(state, HUMAN_SEAT) : null;
        await game.humanPlayCombo(combo.cards, null, recipient);
      } else {
        const recipient = isDragonSingle(state.currentBest) ? pickDragonRecipient(state, state.lastPlayerToAct!) : null;
        await game.humanPassTurn(recipient);
      }
    }

    const result = game.humanCallTichu();
    expect(result.ok).toBe(false);
  });
});
