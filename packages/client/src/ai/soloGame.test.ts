import type { InferenceSession } from 'onnxruntime-common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type Card,
  type Combo,
  type GameState,
  ComboType,
  NUM_PLAYERS,
  PARTNER,
  Phase,
  Rank,
  Suit,
  createDeck,
  dealNewRound,
  identifyCombo,
  legalCombos,
  passTurn,
  playCombo,
} from '@tichu/shared';
import { HUMAN_SEAT, SoloGame } from './soloGame';

function mustOkValue<T>(result: { ok: boolean; value?: T; error?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.value as T;
}

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
  it('auto-decides Large Tichu for the three AI seats (heuristic, by hand strength) but leaves the human undecided', () => {
    // createDeck()'s canonical order deals seats 1-3 zero Aces by default
    // (see cards.ts's suit-major ordering); swap two Aces into seat 1's
    // 8-card hand specifically so this test can assert the heuristic
    // actually varies with hand quality, not just always declining.
    const deck = [...createDeck()];
    [deck[14], deck[12]] = [deck[12]!, deck[14]!];
    [deck[15], deck[25]] = [deck[25]!, deck[15]!];

    const game = new SoloGame({ session: stubSession(), deck });

    expect(game.getState().largeTichuCalls).toEqual([null, true, false, false]);
    expect(game.getState().phase).toBe(Phase.LargeTichu);
  });

  it('starts with no cumulative score and the match not over', () => {
    const game = new SoloGame({ session: stubSession() });

    expect(game.getCumulativeScores()).toEqual([0, 0]);
    expect(game.isMatchOver()).toBe(false);
  });
});

describe('SoloGame: resuming from a saved snapshot', () => {
  it('uses the resumed state and cumulative scores as-is, instead of dealing a fresh round', () => {
    const dealt = dealNewRound(createDeck());
    const resumedState: GameState = { ...dealt, phase: Phase.Playing, currentPlayer: 2, trickLeader: 2 };

    const game = new SoloGame({ session: stubSession(), resumeFrom: { state: resumedState, cumulativeScores: [180, 240] } });

    expect(game.getState()).toEqual(resumedState);
    expect(game.getCumulativeScores()).toEqual([180, 240]);
  });

  it('restores round history from resumeFrom, or defaults to empty when omitted', () => {
    const dealt = dealNewRound(createDeck());
    const resumedState: GameState = { ...dealt, phase: Phase.Playing, currentPlayer: 2, trickLeader: 2 };

    const withHistory = new SoloGame({
      session: stubSession(),
      resumeFrom: { state: resumedState, cumulativeScores: [65, 135], roundHistory: [[40, 60], [25, 75]] },
    });
    expect(withHistory.getRoundHistory()).toEqual([
      [40, 60],
      [25, 75],
    ]);

    const withoutHistory = new SoloGame({
      session: stubSession(),
      resumeFrom: { state: resumedState, cumulativeScores: [0, 0] },
    });
    expect(withoutHistory.getRoundHistory()).toEqual([]);
  });

  it('does not re-decide Large Tichu for the AI seats -- the resumed state is used verbatim', () => {
    const dealt = dealNewRound(createDeck());
    // Still mid-decision for every seat, unlike what a fresh deal + this
    // class's own autoDecideAiLargeTichu() would produce.
    const resumedState: GameState = { ...dealt, largeTichuCalls: [null, null, null, null] };

    const game = new SoloGame({ session: stubSession(), resumeFrom: { state: resumedState, cumulativeScores: [0, 0] } });

    expect(game.getState().largeTichuCalls).toEqual([null, null, null, null]);
  });

  it('can resume mid-Exchange and still successfully submit the human exchange', async () => {
    const dealt = dealNewRound(createDeck());
    const afterLargeTichu: GameState = {
      ...dealt,
      phase: Phase.Exchange,
      largeTichuCalls: [false, false, false, false],
    };

    const game = new SoloGame({ session: stubSession(), resumeFrom: { state: afterLargeTichu, cumulativeScores: [0, 0] } });

    const hand = game.getState().hands[HUMAN_SEAT]!;
    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    const result = await game.submitHumanExchange({ 1: sorted[0]!, 2: sorted[1]!, 3: sorted[2]! });

    expect(result.ok).toBe(true);
  });

  it('never touches the session by itself -- construction stays synchronous and side-effect-free', () => {
    // This matters beyond style: React 18 StrictMode double-invokes useState
    // initializers in dev, so a constructor that kicked off async work would
    // fire two concurrent decideAiMove calls against the same shared
    // onnxruntime-web session and crash it ("Session already started").
    const dealt = dealNewRound(createDeck());
    const resumedState: GameState = { ...dealt, phase: Phase.Playing, currentPlayer: 3, trickLeader: 3, currentBest: null };
    const onTurnResolved = vi.fn();

    new SoloGame({ session: stubSession(), resumeFrom: { state: resumedState, cumulativeScores: [0, 0] }, onTurnResolved });

    expect(onTurnResolved).not.toHaveBeenCalled();
  });

  it('resumePendingAiTurnIfNeeded drains a pending AI turn, instead of the game stalling forever waiting for a human action that will never come', async () => {
    // Bug: resuming mid-round while an AI seat was up left the game
    // permanently stuck -- every other entry point (submitHumanExchange,
    // humanPlayCombo, humanPassTurn) only ever drains AI turns as a
    // *reaction* to a human action, and none of those come if it isn't the
    // human's turn to begin with. The caller (SoloGamePage) is expected to
    // invoke this once, right after construction.
    const dealt = dealNewRound(createDeck());
    const resumedState: GameState = { ...dealt, phase: Phase.Playing, currentPlayer: 3, trickLeader: 3, currentBest: null };
    const game = new SoloGame({ session: stubSession(), resumeFrom: { state: resumedState, cumulativeScores: [0, 0] } });

    await game.resumePendingAiTurnIfNeeded();

    expect(game.getState().currentPlayer).not.toBe(3);
  });

  it('resumePendingAiTurnIfNeeded is a no-op when it is already the human\'s turn', async () => {
    const dealt = dealNewRound(createDeck());
    const resumedState: GameState = { ...dealt, phase: Phase.Playing, currentPlayer: HUMAN_SEAT, trickLeader: HUMAN_SEAT };
    const game = new SoloGame({ session: stubSession(), resumeFrom: { state: resumedState, cumulativeScores: [0, 0] } });

    await game.resumePendingAiTurnIfNeeded();

    expect(game.getState()).toEqual(resumedState);
  });
});

describe('SoloGame: onTurnResolved reports the human\'s own turn, not just AI turns', () => {
  // Bug: humanPlayCombo/humanPassTurn used to apply the human's own reducer
  // call, then immediately start draining AI turns, without ever reporting
  // the state in between. The very first state a caller could observe was
  // whatever the human's play/pass PLUS every subsequent AI turn added up
  // to -- so a UI feature built on "diff consecutive states to announce who
  // did what" (useActionAnnouncement.ts) always misattributed the human's
  // own action to whichever AI acted last, and a bare pass was invisible
  // entirely if any AI action followed it in the same batch.
  it('reports the human\'s own play as its own state, before any AI turn that follows it', async () => {
    const dealt = dealNewRound(createDeck());
    const resumedState: GameState = { ...dealt, phase: Phase.Playing, currentPlayer: HUMAN_SEAT, trickLeader: HUMAN_SEAT, currentBest: null };
    const states: GameState[] = [];
    const game = new SoloGame({
      session: stubSession(),
      resumeFrom: { state: resumedState, cumulativeScores: [0, 0] },
      onTurnResolved: (s) => states.push(s),
    });

    const hand = game.getState().hands[HUMAN_SEAT]!;
    const lowestCard = [...hand].sort((a, b) => a.rank - b.rank)[0]!;
    // The exact state the shared reducer produces for *only* this one play,
    // computed independently of SoloGame -- the strongest possible check
    // that the first reported state is this and nothing more (no AI turns
    // folded in yet).
    const expectedFirstState = mustOkValue(playCombo(resumedState, HUMAN_SEAT, [lowestCard]));

    const result = await game.humanPlayCombo([lowestCard]);

    expect(result.ok).toBe(true);
    expect(states.length).toBeGreaterThan(0);
    expect(states[0]).toEqual(expectedFirstState);
  });

  it('reports the human\'s own pass as its own state, before any AI turn that follows it', async () => {
    const dealt = dealNewRound(createDeck());
    const king = identifyCombo([{ rank: Rank.King, suit: Suit.Sword }])!;
    const resumedState: GameState = {
      ...dealt,
      phase: Phase.Playing,
      currentPlayer: HUMAN_SEAT,
      trickLeader: 1,
      currentBest: king,
      currentStrength: king.rankStrength,
      lastPlayerToAct: 1,
    };
    const states: GameState[] = [];
    const game = new SoloGame({
      session: stubSession(),
      resumeFrom: { state: resumedState, cumulativeScores: [0, 0] },
      onTurnResolved: (s) => states.push(s),
    });
    // Same reasoning as the play test above -- compare against exactly what
    // the shared reducer produces for *only* this one pass. In this
    // scenario the next-to-act AI seat (1) also happens to have nothing
    // that beats the King and passes too, which leaves `lastPlayerToAct`
    // unchanged either way -- so this exact-state comparison (rather than
    // checking individual fields) is what actually catches the bug where
    // the human's pass never got reported as its own state at all.
    const expectedFirstState = mustOkValue(passTurn(resumedState, HUMAN_SEAT));

    const result = await game.humanPassTurn();

    expect(result.ok).toBe(true);
    expect(states.length).toBeGreaterThan(0);
    expect(states[0]).toEqual(expectedFirstState);
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

  it('reports which AI seat gave the human which card via onExchangeReceived, for the post-exchange toast', async () => {
    let received: Record<number, Card> | null = null;
    const game = new SoloGame({ session: stubSession(), onExchangeReceived: (r) => (received = r) });
    game.decideHumanLargeTichu(false);

    const preExchangeHumanKeys = new Set(game.getState().hands[HUMAN_SEAT]!.map((c) => `${c.rank}-${c.suit}`));
    const hand = game.getState().hands[HUMAN_SEAT]!;
    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    const gifts = { 1: sorted[0]!, 2: sorted[1]!, 3: sorted[2]! };

    expect(received).toBeNull();

    const result = await game.submitHumanExchange(gifts);
    expect(result.ok).toBe(true);

    expect(received).not.toBeNull();
    expect(Object.keys(received!).sort()).toEqual(['1', '2', '3']);
    // Every received card was NOT already in the human's hand before the
    // exchange -- it genuinely came from an AI seat's own hand.
    for (const card of Object.values(received!)) {
      expect(preExchangeHumanKeys.has(`${card.rank}-${card.suit}`)).toBe(false);
    }
  });

  it('fires onExchangeReceived immediately, before the first AI turn even reaches its awaitAdvance gate', async () => {
    // Force seat 1 to lead post-exchange (see the pacing describe block
    // below for why this must be pinned rather than left to a random deal),
    // so there is at least one AI turn for onExchangeReceived to need to
    // race against.
    const deck = [...createDeck()];
    const mahjongIndex = deck.findIndex((c) => c.rank === Rank.Mahjong);
    const [mahjong] = deck.splice(mahjongIndex, 1);
    deck.unshift(mahjong!);

    let receivedAt: 'not yet' | 'received' = 'not yet';
    const game = new SoloGame({
      session: stubSession(),
      deck,
      // Never resolves -- if onExchangeReceived fired late (e.g. after the
      // exchange step started draining AI turns), it would never fire at
      // all in this test, since seat 1's turn would be stuck on this gate
      // forever. Its absence would show up as `receivedAt` staying 'not yet'.
      awaitAdvance: () => new Promise<void>(() => {}),
      onExchangeReceived: () => {
        receivedAt = 'received';
      },
    });
    game.decideHumanLargeTichu(false);

    const hand = game.getState().hands[HUMAN_SEAT]!;
    const others = hand.filter((c) => c.rank !== Rank.Mahjong).sort((a, b) => a.rank - b.rank);
    // Deliberately not awaited -- onExchangeReceived must already have fired
    // synchronously within the exchange step, before this call even yields
    // to the first AI turn's (permanently pending) awaitAdvance gate.
    void game.submitHumanExchange({ 1: mahjong!, 2: others[0]!, 3: others[1]! });

    expect(receivedAt).toBe('received');
  });

  it('reports the Exchange -> Playing transition itself via onTurnResolved, before the first AI turn plays anything -- otherwise a caller can never tell an AI led the very first trick of the round', async () => {
    // Bug: when an AI seat (not the human) held the Mahjong and led the
    // first trick right after the exchange, `submitHumanExchange` jumped
    // straight from "Exchange" to "Playing, with that AI's card already
    // played" in a single reported state -- there was no intermediate
    // "Playing, nobody has played yet" state for `useActionAnnouncement.ts`'s
    // diff (which requires both sides of a comparison to already be
    // Phase.Playing) to detect the play against. The leading play never got
    // announced, and the center display stayed blank until someone's next
    // real play (not just a pass) happened to reset the baseline.
    const deck = [...createDeck()];
    const mahjongIndex = deck.findIndex((c) => c.rank === Rank.Mahjong);
    const [mahjong] = deck.splice(mahjongIndex, 1);
    deck.unshift(mahjong!);

    const states: GameState[] = [];
    const game = new SoloGame({
      session: stubSession(),
      deck,
      // Never resolves -- freezes the game right after the exchange
      // resolves, before seat 1's own leading play actually runs, so the
      // in-between moment can be inspected directly.
      awaitAdvance: () => new Promise<void>(() => {}),
      onTurnResolved: (s) => states.push(s),
    });
    game.decideHumanLargeTichu(false);

    const hand = game.getState().hands[HUMAN_SEAT]!;
    const mahjongCard = hand.find((c) => c.rank === Rank.Mahjong)!;
    const others = hand.filter((c) => c.rank !== Rank.Mahjong).sort((a, b) => a.rank - b.rank);

    void game.submitHumanExchange({ 1: mahjongCard, 2: others[0]!, 3: others[1]! });

    const preLeadState = game.getState();
    expect(preLeadState.phase).toBe(Phase.Playing);
    expect(preLeadState.currentBest).toBeNull();
    expect(preLeadState.currentPlayer).toBe(1);

    expect(states).toEqual([preLeadState]);
  });
});

describe("SoloGame: AI auto-exchange mirrors ai/tichu_env/env.py's _auto_exchange heuristic", () => {
  // Bug: this used to be "sort hand ascending, give the 3 lowest cards to the
  // other 3 seats in seat order" -- an old, simpler rule that predates the
  // Python engine's actual heuristic (partner gets the giver's best card,
  // opponents get the two lowest, with Large Tichu/Dog special-casing --
  // ai/tichu_env/env.py's `_auto_exchange`). The deployed model was trained
  // against the *real* Python heuristic, so a client that auto-exchanges
  // differently than what the model actually saw during self-play produces
  // exchanges the model never learned to play around.
  //
  // Builds a full, valid 4-hand deal (56 unique cards, no collisions) where
  // `giverSeat`'s hand is exactly `giverCards` (padded to 14 with arbitrary
  // filler from the rest of the deck) and the other three seats split
  // whatever's left. Jumps straight to Phase.Exchange via resumeFrom, the
  // same pattern the "can resume mid-Exchange" test above uses, so neither
  // Large Tichu nor the normal deal/8-then-6-card split has to be replayed.
  function buildExchangeState(
    giverSeat: number,
    giverCards: readonly Card[],
    largeTichuCalls: readonly (boolean | null)[] = [false, false, false, false],
  ): GameState {
    const isSameCard = (a: Card, b: Card) => a.rank === b.rank && a.suit === b.suit;
    const rest = createDeck().filter((c) => !giverCards.some((g) => isSameCard(g, c)));
    const fillerCount = 14 - giverCards.length;
    const giverHand = [...giverCards, ...rest.slice(0, fillerCount)];
    const leftover = rest.slice(fillerCount);

    const hands: Card[][] = [[], [], [], []];
    hands[giverSeat] = giverHand;
    [0, 1, 2, 3]
      .filter((seat) => seat !== giverSeat)
      .forEach((seat, i) => {
        hands[seat] = leftover.slice(i * 14, i * 14 + 14);
      });

    const dealt = dealNewRound(createDeck());
    return { ...dealt, hands, phase: Phase.Exchange, largeTichuCalls };
  }

  /** Submits a throwaway-but-valid human exchange -- the human's own gifts
   * don't matter for these tests, only what the AI giver under test sends
   * back (captured via each test's own `onExchangeReceived` callback). */
  async function submitThrowawayHumanExchange(game: SoloGame): Promise<void> {
    const hand = game.getState().hands[HUMAN_SEAT]!;
    const sorted = [...hand].sort((a, b) => a.rank - b.rank);
    const result = await game.submitHumanExchange({ 1: sorted[0]!, 2: sorted[1]!, 3: sorted[2]! });
    expect(result.ok).toBe(true);
  }

  it("gives the partner the giver's best card (Phoenix preferred) when the giver didn't call Large Tichu -- not a low card", async () => {
    // Seat 2's partner is the human (PARTNER[2] === 0), so the human directly
    // observes what seat 2 sends its partner. Under the old (buggy) "lowest 3
    // cards to the other 3 seats in order" rule, the human (first in seat
    // order among seat 2's other players) would have received seat 2's
    // *lowest* card instead.
    const pagodaRanks: Card[] = [
      Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
      Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen,
    ].map((rank) => ({ rank, suit: Suit.Pagoda }));
    const giverCards: Card[] = [{ rank: Rank.Phoenix, suit: Suit.Special }, { rank: Rank.Ace, suit: Suit.Sword }, ...pagodaRanks];

    let received: Record<number, Card> | null = null;
    const game = new SoloGame({
      session: stubSession(),
      onExchangeReceived: (r) => (received = r),
      resumeFrom: { state: buildExchangeState(2, giverCards), cumulativeScores: [0, 0] },
    });
    await submitThrowawayHumanExchange(game);

    expect(received).not.toBeNull();
    expect(received![2]!.rank).toBe(Rank.Phoenix);
  });

  it('gives the partner a low card instead when the giver DID call Large Tichu -- keeping their own strength', async () => {
    const pagodaRanks: Card[] = [
      Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven, Rank.Eight,
      Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King,
    ].map((rank) => ({ rank, suit: Suit.Pagoda }));
    const giverCards: Card[] = [
      { rank: Rank.Phoenix, suit: Suit.Special },
      { rank: Rank.Two, suit: Suit.Pagoda },
      ...pagodaRanks,
    ];

    let received: Record<number, Card> | null = null;
    const game = new SoloGame({
      session: stubSession(),
      onExchangeReceived: (r) => (received = r),
      resumeFrom: { state: buildExchangeState(2, giverCards, [false, false, true, false]), cumulativeScores: [0, 0] },
    });
    await submitThrowawayHumanExchange(game);

    expect(received).not.toBeNull();
    expect(received![2]!.rank).toBe(Rank.Two);
    expect(received![2]!.rank).not.toBe(Rank.Phoenix);
  });

  it('keeps the Dog with the giver (gives it to nobody) when the PARTNER called Large Tichu, instead of handing it to an opponent', async () => {
    // Seat 1's partner is seat 3 (PARTNER[1] === 3); the human is one of seat
    // 1's two opponents. Under the old (buggy) rule the Dog -- rank 0, always
    // the globally lowest card -- would have been the very first of the "3
    // lowest cards" and gone straight to the human. The correct rule instead
    // has seat 1 keep it (since seat 1's partner will lead with it later).
    const pagodaRanks: Card[] = [
      Rank.Two, Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven,
      Rank.Eight, Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen,
    ].map((rank) => ({ rank, suit: Suit.Pagoda }));
    const giverCards: Card[] = [
      { rank: Rank.Dog, suit: Suit.Special },
      { rank: Rank.Ace, suit: Suit.Sword },
      { rank: Rank.King, suit: Suit.Sword },
      ...pagodaRanks,
    ];

    let received: Record<number, Card> | null = null;
    const game = new SoloGame({
      session: stubSession(),
      onExchangeReceived: (r) => (received = r),
      resumeFrom: { state: buildExchangeState(1, giverCards, [false, false, false, true]), cumulativeScores: [0, 0] },
    });
    await submitThrowawayHumanExchange(game);

    expect(received).not.toBeNull();
    expect(received![1]!.rank).toBe(Rank.Two);
    expect(received![1]!.rank).not.toBe(Rank.Dog);
  });

  it('gives the Dog straight to the partner when the giver called Large Tichu', async () => {
    const pagodaRanks: Card[] = [
      Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven, Rank.Eight,
      Rank.Nine, Rank.Ten, Rank.Jack, Rank.Queen, Rank.King,
    ].map((rank) => ({ rank, suit: Suit.Pagoda }));
    const giverCards: Card[] = [{ rank: Rank.Dog, suit: Suit.Special }, ...pagodaRanks, { rank: Rank.Ace, suit: Suit.Sword }, { rank: Rank.Ace, suit: Suit.Pagoda }];

    let received: Record<number, Card> | null = null;
    const game = new SoloGame({
      session: stubSession(),
      onExchangeReceived: (r) => (received = r),
      resumeFrom: { state: buildExchangeState(2, giverCards, [false, false, true, false]), cumulativeScores: [0, 0] },
    });
    await submitThrowawayHumanExchange(game);

    expect(received).not.toBeNull();
    expect(received![2]!.rank).toBe(Rank.Dog);
  });
});

describe('SoloGame: AI turn pacing', () => {
  // A random deal would sometimes hand the human the Mahjong and let them
  // lead first, needing zero AI turns before returning control -- which
  // would make both tests below flaky depending on the draw (no onTurnResolved
  // calls, or the exchange resolving before ever touching awaitAdvance).
  // Forcing the human to hold the Mahjong and then gift it away to seat 1
  // guarantees seat 1 leads, so at least one AI turn (and its gate) always
  // happens.
  function deckWithHumanMahjongFirst(): Card[] {
    const deck = [...createDeck()];
    const mahjongIndex = deck.findIndex((c) => c.rank === Rank.Mahjong);
    const [mahjong] = deck.splice(mahjongIndex, 1);
    deck.unshift(mahjong!);
    return deck;
  }

  function giveMahjongToSeat1(game: SoloGame): Record<number, Card> {
    const hand = game.getState().hands[HUMAN_SEAT]!;
    const mahjong = hand.find((c) => c.rank === Rank.Mahjong)!;
    const others = hand.filter((c) => c.rank !== Rank.Mahjong).sort((a, b) => a.rank - b.rank);
    return { 1: mahjong, 2: others[0]!, 3: others[1]! };
  }

  it('reports each AI turn via onTurnResolved as it happens, ending on the same state the call resolves with', async () => {
    const states: GameState[] = [];
    const game = new SoloGame({ session: stubSession(), deck: deckWithHumanMahjongFirst(), onTurnResolved: (s) => states.push(s) });
    game.decideHumanLargeTichu(false);

    const result = await game.submitHumanExchange(giveMahjongToSeat1(game));

    expect(result.ok).toBe(true);
    expect(states.length).toBeGreaterThan(0);
    if (result.ok) {
      expect(states[states.length - 1]).toEqual(result.value);
    }
  });

  it('waits for awaitAdvance to resolve before each AI turn, instead of draining them all instantly', async () => {
    // Manual gate standing in for the real app's "wait for a screen tap":
    // `wait()` is what SoloGame awaits before each AI turn: `isWaiting`
    // reports whether it's currently blocked there, and `release()` is the
    // test's equivalent of the player's tap.
    let resolveWait: (() => void) | null = null;
    const gate = {
      wait: () => new Promise<void>((resolve) => (resolveWait = resolve)),
      get isWaiting() {
        return resolveWait !== null;
      },
      release: () => {
        const resolve = resolveWait;
        resolveWait = null;
        resolve?.();
      },
    };

    const game = new SoloGame({ session: stubSession(), awaitAdvance: gate.wait, deck: deckWithHumanMahjongFirst() });
    game.decideHumanLargeTichu(false);

    let resolved = false;
    const pending = game.submitHumanExchange(giveMahjongToSeat1(game)).then((r) => {
      resolved = true;
      return r;
    });

    // Seat 1's forced turn should be blocked on the gate, not resolved yet.
    await vi.waitFor(() => expect(gate.isWaiting).toBe(true));
    expect(resolved).toBe(false);

    // Release the gate for however many AI turns are needed until it's the
    // human's turn again -- waiting for either the gate to re-arm (another AI
    // turn follows) or the whole call to resolve (it was the last one).
    while (!resolved) {
      gate.release();
      await vi.waitFor(() => expect(gate.isWaiting || resolved).toBe(true));
    }

    const result = await pending;
    expect(result.ok).toBe(true);
  });
});

describe('SoloGame: (small) Tichu call decision for AI seats', () => {
  function deckWithHumanMahjongFirst(): Card[] {
    const deck = [...createDeck()];
    const mahjongIndex = deck.findIndex((c) => c.rank === Rank.Mahjong);
    const [mahjong] = deck.splice(mahjongIndex, 1);
    deck.unshift(mahjong!);
    return deck;
  }

  function giveMahjongToSeat1(game: SoloGame): Record<number, Card> {
    const hand = game.getState().hands[HUMAN_SEAT]!;
    const mahjong = hand.find((c) => c.rank === Rank.Mahjong)!;
    const others = hand.filter((c) => c.rank !== Rank.Mahjong).sort((a, b) => a.rank - b.rank);
    return { 1: mahjong, 2: others[0]!, 3: others[1]! };
  }

  it("resolves the AI leader's (small) Tichu decision (heuristic, never the model) before its leading play, instead of looping forever on it", async () => {
    const game = new SoloGame({ session: stubSession(), deck: deckWithHumanMahjongFirst() });
    game.decideHumanLargeTichu(false);

    const result = await game.submitHumanExchange(giveMahjongToSeat1(game));

    expect(result.ok).toBe(true);
    // Seat 1 led (forced via the Mahjong gift above) and, by the time control
    // returns here, must have already resolved past its own tichu decision
    // window -- otherwise isAwaitingTichuDecision would still be gating it
    // and it could never have made its leading play at all.
    expect(game.getState().tichuDecided[1]).toBe(true);
    expect(game.getState().phase).toBe(Phase.Playing);
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

  it('scores the round immediately once it ends, before finishRoundAndDeal is ever called', async () => {
    // Regression test: the round-over screen reads getCumulativeScores()/
    // getRoundHistory() as soon as it renders, which is before the human
    // clicks "다음 라운드" (finishRoundAndDeal). Scoring must not be deferred
    // until that click, or the screen shows stale totals missing the round
    // that just ended.
    const game = new SoloGame({ session: stubSession() });
    expect(game.getCumulativeScores()).toEqual([0, 0]);

    await playRoundToCompletion(game);

    // Not asserting scores[0] + scores[1] > 0 here: a team's total can
    // legitimately net to exactly 0 (e.g. a failed (small) Tichu call's -100
    // penalty exactly cancelling that team's card points), so it isn't a real
    // invariant -- an unscored round (still [0, 0] initial state) is instead
    // distinguished below by roundHistory staying empty rather than [scores].
    const scores = game.getCumulativeScores();
    expect(game.getRoundHistory()).toEqual([scores]);
  });

  it('finishRoundAndDeal deals a fresh round without re-scoring the one that just ended', async () => {
    const game = new SoloGame({ session: stubSession() });
    await playRoundToCompletion(game);

    const scoresBeforeDeal = game.getCumulativeScores();
    const historyBeforeDeal = game.getRoundHistory();

    const nextState = game.finishRoundAndDeal();

    expect(game.getCumulativeScores()).toEqual(scoresBeforeDeal);
    expect(game.getRoundHistory()).toEqual(historyBeforeDeal);
    expect(nextState.phase).toBe(Phase.LargeTichu);
    // Only the human (seat 0) stays undecided -- AI seats' actual true/false
    // values depend on the (unseeded) fresh deal's hand strength, decided by
    // heuristicCalls.ts, so this doesn't pin exact values.
    expect(nextState.largeTichuCalls[HUMAN_SEAT]).toBe(null);
    expect(nextState.largeTichuCalls.filter((c) => c !== null)).toHaveLength(3);
  });

  it('records each round\'s own score in getRoundHistory, separate from the running cumulative total', async () => {
    const game = new SoloGame({ session: stubSession() });
    expect(game.getRoundHistory()).toEqual([]);

    await playRoundToCompletion(game);
    game.finishRoundAndDeal();

    const history = game.getRoundHistory();
    expect(history.length).toBe(1);
    expect(game.getCumulativeScores()).toEqual(history[0]);

    await playRoundToCompletion(game);
    game.finishRoundAndDeal();

    // A second completed round appends, it doesn't replace -- and the running
    // total is exactly the sum of both rounds' own scores.
    const historyAfterTwo = game.getRoundHistory();
    expect(historyAfterTwo.length).toBe(2);
    expect(historyAfterTwo[0]).toEqual(history[0]);
    const summedTotals: [number, number] = [
      historyAfterTwo[0]![0] + historyAfterTwo[1]![0],
      historyAfterTwo[0]![1] + historyAfterTwo[1]![1],
    ];
    expect(game.getCumulativeScores()).toEqual(summedTotals);
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

describe('SoloGame: a Dragon trick recipient is decided by whoever actually won it, not whoever\'s pass happens to close it', () => {
  // Bug: `playCombo`'s `dragonRecipient` argument is only actually applied
  // by the shared reducer when that very play also ends the round (see
  // `resolveTrickRecipient` in packages/shared/src/gameState.ts) -- for the
  // far more common case where the trick stays open, the decision used to
  // just be silently discarded, and whoever's *pass* later closed the trick
  // either got auto-decided for (soloGame.ts's old `autoDragonRecipient` at
  // close time) or wrongly prompted (usePlayFlow.ts) instead of the real
  // winner. These two tests cover both directions.
  const baseState = (overrides: Partial<GameState>): GameState => ({
    hands: [[], [], [], []],
    pendingFinalCards: [[], [], [], []],
    phase: Phase.Playing,
    currentPlayer: 0,
    trickLeader: 0,
    trickCards: [],
    currentBest: null,
    currentStrength: 0,
    lastPlayerToAct: null,
    passesInARow: 0,
    finishedOrder: [],
    collectedTricks: [[], [], [], []],
    largeTichuCalls: [false, false, false, false],
    tichuCalls: [false, false, false, false],
    mahjongWish: null,
    receivedFrom: [{}, {}, {}, {}],
    tichuDecided: [true, true, true, true],
    ...overrides,
  });

  it('the human\'s own choice survives to the actual close, even though an AI pass is what closes it', async () => {
    const dragon: Card = { rank: Rank.Dragon, suit: Suit.Special };
    const nine: Card = { rank: Rank.Nine, suit: Suit.Sword };
    const base = baseState({
      currentPlayer: 3,
      trickLeader: 3,
      hands: [
        [dragon, { rank: Rank.Three, suit: Suit.Sword }],
        [{ rank: Rank.Five, suit: Suit.Sword }],
        [{ rank: Rank.Six, suit: Suit.Sword }],
        [nine, { rank: Rank.King, suit: Suit.Sword }],
      ],
    });
    const afterLead = mustOkValue(playCombo(base, 3, [nine]));
    const game = new SoloGame({ session: stubSession(), resumeFrom: { state: afterLead, cumulativeScores: [0, 0] } });

    // Seat 3 excluded (self) and seat 1 (its partner) from the human's
    // recipient options -- the human deliberately picks seat 3 here because
    // it's *different* from what the old auto-decide fallback would have
    // picked (seat 1, the first eligible seat in ascending order), so a
    // regression back to that fallback is unambiguously observable below.
    const result = await game.humanPlayCombo([dragon], null, 3);

    expect(result.ok).toBe(true);
    const finalState = game.getState();
    expect(finalState.currentPlayer).toBe(HUMAN_SEAT);
    // Seat 3 (the human's actual choice) got the trick...
    expect(finalState.collectedTricks[3]).toEqual([nine, dragon]);
    // ...not seat 1, which is what the old close-time auto-decide fallback
    // would have produced regardless of what the human chose.
    expect(finalState.collectedTricks[1]).toEqual([]);
  });

  it('an AI\'s own auto-decided choice survives to the actual close, even when the human\'s pass closes it -- and the human\'s own (wrong) argument is ignored', async () => {
    const dragon: Card = { rank: Rank.Dragon, suit: Suit.Special };
    const base = baseState({
      currentPlayer: 1,
      trickLeader: 1,
      hands: [
        [{ rank: Rank.Ten, suit: Suit.Sword }],
        [dragon],
        [{ rank: Rank.Five, suit: Suit.Sword }],
        [{ rank: Rank.Six, suit: Suit.Sword }],
      ],
    });
    const game = new SoloGame({ session: stubSession(), resumeFrom: { state: base, cumulativeScores: [0, 0] } });

    // Seat 1's only card is the Dragon -- it's their only legal opening
    // move, so the stub session (always picks candidate index 0) is
    // guaranteed to pick it. Winner is seat 1; auto-decide (first eligible
    // seat, excluding self and partner seat 3) lands on seat 0 -- the human.
    await game.resumePendingAiTurnIfNeeded();
    expect(game.getState().currentPlayer).toBe(HUMAN_SEAT);
    expect(game.getState().currentBest).not.toBeNull();

    // The human's own pass closes the trick. Deliberately pass a *different*
    // seat (2) as the argument -- if the engine wrongly used this argument
    // instead of the cached decision, the assertions below would catch it.
    const result = await game.humanPassTurn(2);

    expect(result.ok).toBe(true);
    const finalState = game.getState();
    expect(finalState.collectedTricks[0]).toEqual([dragon]);
    expect(finalState.collectedTricks[2]).toEqual([]);
  });
});
