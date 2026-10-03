import { describe, expect, it } from 'vitest';
import bombInterruptFixture from './goldenFixtures/bomb_interrupt.json';
import doubleOutFixture from './goldenFixtures/double_out.json';
import grandTichuFixture from './goldenFixtures/grand_tichu.json';
import lastCardHandoverFixture from './goldenFixtures/last_card_handover.json';
import normalRoundFixture from './goldenFixtures/normal_round.json';
import tichuCallDecisionFixture from './goldenFixtures/tichu_call_decision.json';
import { cardFromFixture, cardsFromFixture, stateFromFixture } from './goldenFixtures/decode';
import { type Card, Rank, Suit } from './cards';
import { ComboType, identifyCombo } from './combinations';
import {
  DEFAULT_TARGET_SCORE,
  type GameState,
  NUM_PLAYERS,
  Phase,
  callTichu,
  dealNewRound,
  decideLargeTichu,
  decideTichu,
  exchangeCards,
  isAwaitingTichuDecision,
  legalCombos,
  passTurn,
  playCombo,
} from './gameState';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

function special(rank: Rank): Card {
  return { rank, suit: Suit.Special };
}

function makePlayingState(hands: Partial<Record<number, Card[]>>, overrides: Partial<GameState> = {}): GameState {
  const base: GameState = {
    hands: Array.from({ length: NUM_PLAYERS }, (_, i) => hands[i] ?? []),
    pendingFinalCards: Array.from({ length: NUM_PLAYERS }, () => []),
    phase: Phase.Playing,
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
    teamScores: [0, 0],
    targetScore: DEFAULT_TARGET_SCORE,
  };
  return { ...base, ...overrides };
}

function expectOk<T>(result: { ok: boolean; value?: T; error?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.value as T;
}

/** Python's `decide_large_tichu` bumps `current_player` to the next
 * undecided seat as a side effect (self-play needs it to sequence the
 * decision one seat at a time); TS's `decideLargeTichu` deliberately does
 * NOT (see its doc comment -- multiplayer lets all four seats decide
 * simultaneously, and mutating `currentPlayer` here would make `Seats.tsx`
 * highlight a misleading "active seat" during that phase). So a fixture
 * snapshot taken right after a sequence of `decide_large_tichu` calls always
 * has this one field diverge from TS's equivalent state; this patches the
 * fixture to the value TS actually produces (dealNewRound's initial
 * currentPlayer, since nothing has touched it yet) before comparing
 * everything else. */
function withUnaffectedCurrentPlayer(fixture: unknown): GameState {
  return { ...stateFromFixture(fixture as never), currentPlayer: 0 };
}

// ---------------------------------------------------------------------------
// Golden-fixture cross-validation against ai/tichu_env
// ---------------------------------------------------------------------------

describe('golden fixtures: normal_round', () => {
  it('matches Python end to end: deal -> large tichu declines -> exchange -> one trick', () => {
    // Python's shuffle algorithm isn't reproducible in JS, so instead of
    // seeding an RNG we reconstruct the exact dealt deck order from the
    // fixture's hands+pending split (deal_new_round just slices a
    // contiguous shuffled deck) and feed that straight into dealNewRound.
    const deck = [0, 1, 2, 3].flatMap((i) => [
      ...cardsFromFixture(normalRoundFixture.dealtState.hands[i] as never),
      ...cardsFromFixture(normalRoundFixture.dealtState.pendingFinalCards[i] as never),
    ]);

    let state = dealNewRound(deck);
    expect(state).toEqual(stateFromFixture(normalRoundFixture.dealtState as never));

    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      state = expectOk(decideLargeTichu(state, player, false));
    }
    expect(state).toEqual(withUnaffectedCurrentPlayer(normalRoundFixture.afterLargeTichuState));

    const gifts: Record<number, Record<number, Card>> = {};
    for (let giver = 0; giver < NUM_PLAYERS; giver += 1) {
      const hand = [...state.hands[giver]!].sort((a, b) => a.rank - b.rank);
      const others = [0, 1, 2, 3].filter((p) => p !== giver);
      gifts[giver] = Object.fromEntries(others.map((recipient, i) => [recipient, hand[i]!]));
    }
    state = expectOk(exchangeCards(state, gifts));
    expect(state).toEqual(stateFromFixture(normalRoundFixture.afterExchangeState as never));
    expect(state.currentPlayer).toBe(normalRoundFixture.leader);

    state = expectOk(decideTichu(state, state.currentPlayer, false));
    expect(state).toEqual(stateFromFixture(normalRoundFixture.afterTichuDecisionState as never));

    const leadCard = cardFromFixture(normalRoundFixture.leadCard as never);
    state = expectOk(playCombo(state, state.currentPlayer, [leadCard]));
    expect(state).toEqual(stateFromFixture(normalRoundFixture.afterLeadState as never));

    for (let i = 0; i < NUM_PLAYERS - 1; i += 1) {
      state = expectOk(passTurn(state, state.currentPlayer));
    }
    expect(state).toEqual(stateFromFixture(normalRoundFixture.afterTrickState as never));
  });
});

describe('golden fixtures: bomb_interrupt', () => {
  it('matches Python: an out-of-turn bomb interrupts the trick', () => {
    let state = stateFromFixture(bombInterruptFixture.beforeState as never);

    state = expectOk(playCombo(state, 0, [card(Rank.Five)]));
    expect(state).toEqual(stateFromFixture(bombInterruptFixture.afterOpenState as never));

    const legalForPlayer2 = legalCombos(state, 2);
    expect(legalForPlayer2).toHaveLength(bombInterruptFixture.legalActionsForPlayer2BeforeBomb.length);
    expect(legalForPlayer2[0]?.comboType).toBe(ComboType.BombQuad);

    const bomb = cardsFromFixture(bombInterruptFixture.bombCards as never);
    state = expectOk(playCombo(state, 2, bomb));
    expect(state).toEqual(stateFromFixture(bombInterruptFixture.afterBombState as never));
  });
});

describe('golden fixtures: double_out', () => {
  it('matches Python: a double win ends the round immediately', () => {
    const state = stateFromFixture(doubleOutFixture.beforeState as never);

    const resolved = expectOk(playCombo(state, 3, [card(Rank.Nine)]));

    expect(resolved).toEqual(stateFromFixture(doubleOutFixture.afterPlayState as never));
  });
});

describe('golden fixtures: last_card_handover', () => {
  it('matches Python: the 3rd finisher ends the round and collects the pending trick', () => {
    const state = stateFromFixture(lastCardHandoverFixture.beforeState as never);

    const resolved = expectOk(playCombo(state, 2, [card(Rank.Six)]));

    expect(resolved).toEqual(stateFromFixture(lastCardHandoverFixture.afterPlayState as never));
  });
});

describe('golden fixtures: grand_tichu', () => {
  it('matches Python: a Grand Tichu call reveals the final 6 once everyone decides', () => {
    const deck = [0, 1, 2, 3].flatMap((i) => [
      ...cardsFromFixture(grandTichuFixture.dealtState.hands[i] as never),
      ...cardsFromFixture(grandTichuFixture.dealtState.pendingFinalCards[i] as never),
    ]);

    let state = dealNewRound(deck);
    expect(state).toEqual(stateFromFixture(grandTichuFixture.dealtState as never));

    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      state = expectOk(decideLargeTichu(state, player, player === 0));
    }
    expect(state).toEqual(withUnaffectedCurrentPlayer(grandTichuFixture.afterLargeTichuState));
  });
});

describe('golden fixtures: tichu_call_decision', () => {
  it('matches Python: mixed large-Tichu calls, exchange, then the (small) Tichu decision window', () => {
    const deck = [0, 1, 2, 3].flatMap((i) => [
      ...cardsFromFixture(tichuCallDecisionFixture.dealtState.hands[i] as never),
      ...cardsFromFixture(tichuCallDecisionFixture.dealtState.pendingFinalCards[i] as never),
    ]);
    const calls = [false, true, true, false];

    let state = dealNewRound(deck);
    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      state = expectOk(decideLargeTichu(state, player, calls[player]!));
    }
    expect(state).toEqual(withUnaffectedCurrentPlayer(tichuCallDecisionFixture.afterLargeTichuState));

    const gifts: Record<number, Record<number, Card>> = {};
    for (let giver = 0; giver < NUM_PLAYERS; giver += 1) {
      const hand = [...state.hands[giver]!].sort((a, b) => a.rank - b.rank);
      const others = [0, 1, 2, 3].filter((p) => p !== giver);
      gifts[giver] = Object.fromEntries(others.map((recipient, i) => [recipient, hand[i]!]));
    }
    state = expectOk(exchangeCards(state, gifts));
    expect(state).toEqual(stateFromFixture(tichuCallDecisionFixture.afterExchangeState as never));

    const leader = state.currentPlayer;
    // `other` must also have declined Grand Tichu (calls[other] === false) --
    // a seat that called Grand Tichu has its (small) Tichu decision
    // auto-resolved by decideLargeTichu, so isAwaitingTichuDecision would
    // already be false for them (see gameState.ts's "Grand Tichu supersedes
    // (small) Tichu" rule), which isn't what this test is exercising.
    const other = calls.findIndex((called, seat) => called === false && seat !== leader);
    expect(leader).toBe(tichuCallDecisionFixture.leader);
    expect(isAwaitingTichuDecision(state, leader)).toBe(tichuCallDecisionFixture.awaitingBeforeDecision);
    // isAwaitingTichuDecision doesn't itself gate by turn order (it's purely
    // "still holds 14 cards and hasn't decided yet"), so it's also true for
    // `other` -- only decideTichu enforces that it must be `other`'s turn.
    expect(isAwaitingTichuDecision(state, other)).toBe(true);
    expect(decideTichu(state, other, false).ok).toBe(false);

    state = expectOk(decideTichu(state, leader, true));
    expect(state).toEqual(stateFromFixture(tichuCallDecisionFixture.afterTichuDecisionState as never));
    expect(isAwaitingTichuDecision(state, leader)).toBe(tichuCallDecisionFixture.awaitingAfterDecision);
    expect(decideTichu(state, leader, false).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Dealing / large tichu / exchange
// ---------------------------------------------------------------------------

describe('dealNewRound', () => {
  it('gives each player 8 cards and holds 6 in reserve, using all 56 unique cards', () => {
    const state = dealNewRound();

    expect(state.hands.every((h) => h.length === 8)).toBe(true);
    expect(state.pendingFinalCards.every((h) => h.length === 6)).toBe(true);
    const all = [...state.hands.flat(), ...state.pendingFinalCards.flat()];
    expect(all).toHaveLength(56);
  });
});

describe('decideLargeTichu', () => {
  it('reveals the final 6 cards once everyone has decided', () => {
    let state = dealNewRound();
    for (let player = 0; player < 3; player += 1) {
      state = expectOk(decideLargeTichu(state, player, false));
      expect(state.phase).toBe(Phase.LargeTichu);
    }
    state = expectOk(decideLargeTichu(state, 3, true));

    expect(state.phase).toBe(Phase.Exchange);
    expect(state.hands.every((h) => h.length === 14)).toBe(true);
    expect(state.largeTichuCalls).toEqual([false, false, false, true]);
  });

  it('rejects deciding twice', () => {
    let state = dealNewRound();
    state = expectOk(decideLargeTichu(state, 0, false));

    expect(decideLargeTichu(state, 0, true).ok).toBe(false);
  });
});

describe('callTichu', () => {
  it('requires still holding all 14 cards', () => {
    let state = dealNewRound();
    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      state = expectOk(decideLargeTichu(state, player, false));
    }

    const result = callTichu(state, 0);

    expect(expectOk(result).tichuCalls[0]).toBe(true);
  });

  it('is rejected before the final deal', () => {
    const state = dealNewRound();

    expect(callTichu(state, 0).ok).toBe(false);
  });
});

describe('isAwaitingTichuDecision / decideTichu', () => {
  it('is false before Playing and once a hand has dropped below 14 cards', () => {
    const state = makePlayingState({ 0: [card(Rank.Five)] }, { currentPlayer: 0 });
    expect(isAwaitingTichuDecision(state, 0)).toBe(false);

    const exchangePhaseState = makePlayingState({}, { phase: Phase.Exchange });
    expect(isAwaitingTichuDecision(exchangePhaseState, 0)).toBe(false);
  });

  it('is true only for the current player still holding all 14 cards, and decideTichu resolves it', () => {
    const fourteen = Array.from({ length: 14 }, () => card(Rank.Five));
    const state = makePlayingState({ 0: fourteen, 1: fourteen }, { currentPlayer: 0 });

    expect(isAwaitingTichuDecision(state, 0)).toBe(true);
    expect(isAwaitingTichuDecision(state, 1)).toBe(true);
    expect(decideTichu(state, 1, false).ok).toBe(false); // not seat 1's turn

    const decided = expectOk(decideTichu(state, 0, true));
    expect(decided.tichuDecided[0]).toBe(true);
    expect(decided.tichuCalls[0]).toBe(true);
    expect(isAwaitingTichuDecision(decided, 0)).toBe(false);
    expect(decideTichu(decided, 0, false).ok).toBe(false); // already decided
  });
});

describe('exchangeCards', () => {
  it('rejects giving the same physical card to more than one recipient', () => {
    let state = dealNewRound();
    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      state = expectOk(decideLargeTichu(state, player, false));
    }
    const sameCard = state.hands[0]![0]!;
    const gifts = { 0: { 1: sameCard, 2: sameCard, 3: sameCard } };

    expect(exchangeCards(state, gifts).ok).toBe(false);
  });

  it('rejects a giver missing a recipient', () => {
    let state = dealNewRound();
    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      state = expectOk(decideLargeTichu(state, player, false));
    }
    const hand = state.hands[0]!;
    const gifts = { 0: { 1: hand[0]!, 2: hand[1]! } };

    expect(exchangeCards(state, gifts).ok).toBe(false);
  });

  it('records who gave each recipient which card in receivedFrom', () => {
    let state = dealNewRound();
    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      state = expectOk(decideLargeTichu(state, player, false));
    }
    const gifts: Record<number, Record<number, Card>> = {};
    for (let giver = 0; giver < NUM_PLAYERS; giver += 1) {
      const hand = state.hands[giver]!;
      const others = [0, 1, 2, 3].filter((p) => p !== giver);
      gifts[giver] = Object.fromEntries(others.map((recipient, i) => [recipient, hand[i]!]));
    }

    const result = expectOk(exchangeCards(state, gifts));

    for (let recipient = 0; recipient < NUM_PLAYERS; recipient += 1) {
      for (const giver of [0, 1, 2, 3].filter((p) => p !== recipient)) {
        expect(result.receivedFrom[recipient]![giver]).toEqual(gifts[giver]![recipient]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Turn order / bomb interrupts / Dog
// ---------------------------------------------------------------------------

describe('playCombo: turn order', () => {
  it('rejects playing out of turn for a non-bomb', () => {
    const state = makePlayingState({ 0: [card(Rank.Five)], 1: [card(Rank.Six)] }, { currentPlayer: 0 });

    expect(playCombo(state, 1, [card(Rank.Six)]).ok).toBe(false);
  });

  it('rejects a bomb seizing the lead out of turn', () => {
    const quad = [Suit.Sword, Suit.Pagoda, Suit.Jade, Suit.Star].map((s) => card(Rank.Seven, s));
    const state = makePlayingState({ 0: [card(Rank.Five)], 2: quad }, { currentPlayer: 0, trickLeader: 0 });

    expect(playCombo(state, 2, quad).ok).toBe(false);
  });

  it('excludes a non-turn player without a bomb from legalCombos', () => {
    const state0 = makePlayingState(
      { 0: [card(Rank.Five)], 1: [card(Rank.Nine)], 2: [card(Rank.King)] },
      { currentPlayer: 0, trickLeader: 0 },
    );
    const state = expectOk(playCombo(state0, 0, [card(Rank.Five)]));

    expect(legalCombos(state, 2)).toEqual([]);
  });
});

describe('playCombo: the Dog', () => {
  it('can only open a trick', () => {
    const state0 = makePlayingState({ 0: [card(Rank.Five)], 1: [special(Rank.Dog)] }, { currentPlayer: 0 });
    const state = expectOk(playCombo(state0, 0, [card(Rank.Five)]));

    expect(playCombo(state, 1, [special(Rank.Dog)]).ok).toBe(false);
  });

  it('passes the lead to the player\'s partner', () => {
    const state0 = makePlayingState({ 0: [special(Rank.Dog)], 2: [card(Rank.Three)] }, { currentPlayer: 0 });

    const state = expectOk(playCombo(state0, 0, [special(Rank.Dog)]));

    expect(state.trickLeader).toBe(2);
    expect(state.currentPlayer).toBe(2);
    expect(state.currentBest).toBeNull();
  });

  it('falls back to the next active seat when the partner already finished', () => {
    const state0 = makePlayingState(
      { 0: [special(Rank.Dog)], 1: [card(Rank.Three)], 3: [card(Rank.Four)] },
      { currentPlayer: 0, finishedOrder: [2] },
    );

    const state = expectOk(playCombo(state0, 0, [special(Rank.Dog)]));

    expect(state.trickLeader).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Mahjong wish
// ---------------------------------------------------------------------------

describe('mahjong wish', () => {
  it('can be set by the Mahjong lead', () => {
    const state0 = makePlayingState({ 0: [special(Rank.Mahjong)], 1: [card(Rank.Nine)] }, { currentPlayer: 0 });

    const state = expectOk(playCombo(state0, 0, [special(Rank.Mahjong)], Rank.Nine));

    expect(state.mahjongWish).toBe(Rank.Nine);
  });

  it('forces breaking a triple into a single when it is the only fulfilling play', () => {
    const tripleNine = [Suit.Sword, Suit.Pagoda, Suit.Jade].map((s) => card(Rank.Nine, s));
    const state = makePlayingState(
      { 1: [...tripleNine, card(Rank.Three)] },
      { currentPlayer: 1, trickLeader: 1, mahjongWish: Rank.Nine },
    );

    expect(playCombo(state, 1, [card(Rank.Three)]).ok).toBe(false);

    const resolved = expectOk(playCombo(state, 1, [tripleNine[0]!]));
    expect(resolved.mahjongWish).toBeNull();
  });

  it('blocks passing when a fulfilling play exists', () => {
    const state0 = makePlayingState(
      { 0: [card(Rank.Five)], 1: [card(Rank.Nine)] },
      { currentPlayer: 0, trickLeader: 0, mahjongWish: Rank.Nine },
    );
    const state = expectOk(playCombo(state0, 0, [card(Rank.Five)]));

    expect(passTurn(state, 1).ok).toBe(false);

    const resolved = expectOk(playCombo(state, 1, [card(Rank.Nine)]));
    expect(resolved.mahjongWish).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Trick resolution / passing / Dragon
// ---------------------------------------------------------------------------

describe('passTurn', () => {
  it('resolves the trick to the winner once everyone else has passed', () => {
    const state0 = makePlayingState({ 0: [card(Rank.Five)] }, { currentPlayer: 0, trickLeader: 0 });
    let state = expectOk(playCombo(state0, 0, [card(Rank.Five)]));
    state = expectOk(passTurn(state, 1));
    state = expectOk(passTurn(state, 2));
    state = expectOk(passTurn(state, 3));

    expect(state.collectedTricks[0]).toEqual([card(Rank.Five)]);
    expect(state.currentBest).toBeNull();
  });

  it('requires a recipient to be chosen when the Dragon wins', () => {
    const state0 = makePlayingState({ 0: [special(Rank.Dragon)] }, { currentPlayer: 0, trickLeader: 0 });
    let state = expectOk(playCombo(state0, 0, [special(Rank.Dragon)]));
    state = expectOk(passTurn(state, 1));
    state = expectOk(passTurn(state, 2));

    expect(passTurn(state, 3).ok).toBe(false);

    const resolved = expectOk(passTurn(state, 3, 1));
    expect(resolved.collectedTricks[1]).toEqual([special(Rank.Dragon)]);
  });

  it("rejects giving the Dragon trick to the winner's own partner", () => {
    const state0 = makePlayingState({ 0: [special(Rank.Dragon)] }, { currentPlayer: 0, trickLeader: 0 });
    let state = expectOk(playCombo(state0, 0, [special(Rank.Dragon)]));
    state = expectOk(passTurn(state, 1));
    state = expectOk(passTurn(state, 2));

    expect(passTurn(state, 3, 2).ok).toBe(false);
  });

  it('hands the lead to the next active seat in turn order -- not the winner\'s partner -- when the trick winner went out on their winning play', () => {
    // Bug: this fallback used to reuse `nextLeaderAfterDog` (partner first),
    // conflating the Dog's own distinct "always hands the lead to your
    // partner" rule with the unrelated case of a trick winner simply running
    // out of cards. Per the corrected `ai/RULES.md` (5.10), a finished trick
    // winner is skipped just like any other finished seat -- the lead goes to
    // whoever is next in seat order, not necessarily the winner's partner.
    const state0 = makePlayingState({ 0: [card(Rank.Five)] }, { currentPlayer: 0, trickLeader: 0 });
    let state = expectOk(playCombo(state0, 0, [card(Rank.Five)]));
    state = expectOk(passTurn(state, 1));
    state = expectOk(passTurn(state, 2));
    state = expectOk(passTurn(state, 3));

    expect(state.collectedTricks[0]).toEqual([card(Rank.Five)]);
    // Seat 0 (the winner) is already out; seat 2 is their partner but is NOT
    // next in turn order -- seat 1 is, and nobody else has finished, so the
    // lead goes to seat 1.
    expect(state.trickLeader).toBe(1);
    expect(state.currentPlayer).toBe(1);
  });

  it("falls back to the winner's own next-in-order successor, not their partner, even when someone else had already finished before this trick", () => {
    // Distinguishes the fix from a coincidence: seat 3 (not the winner's
    // partner) is already out here, so the old (buggy) logic would still
    // have handed the lead to the winner's partner (seat 2, via
    // `nextLeaderAfterDog`, since seat 2 itself hasn't finished). The
    // corrected fallback starts from the winner (seat 0) directly and skips
    // only actually-finished seats, landing on seat 1.
    const state0 = makePlayingState(
      { 0: [card(Rank.Five)], 3: [] },
      { currentPlayer: 0, trickLeader: 0, finishedOrder: [3] },
    );
    let state = expectOk(playCombo(state0, 0, [card(Rank.Five)]));
    state = expectOk(passTurn(state, 1));
    state = expectOk(passTurn(state, 2));

    expect(state.trickLeader).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Legal move enumeration
// ---------------------------------------------------------------------------

describe('legalCombos', () => {
  it('includes every valid combo type when leading', () => {
    const state = makePlayingState(
      { 0: [card(Rank.Five), card(Rank.Five, Suit.Jade)] },
      { currentPlayer: 0, trickLeader: 0 },
    );

    const types = new Set(legalCombos(state, 0).map((c) => c.comboType));

    expect(types.has(ComboType.Single)).toBe(true);
    expect(types.has(ComboType.Pair)).toBe(true);
  });

  it('excludes combos that do not beat the current trick when following', () => {
    const leadState = makePlayingState(
      { 0: [card(Rank.Seven)], 1: [card(Rank.Four), card(Rank.Nine)] },
      { currentPlayer: 0, trickLeader: 0 },
    );
    const state = expectOk(playCombo(leadState, 0, [card(Rank.Seven)]));

    const combos = legalCombos(state, 1);

    expect(combos.every((c) => c.rankStrength > Rank.Seven)).toBe(true);
  });
});

describe('identifyCombo smoke test (cross-module sanity)', () => {
  it('is used consistently by playCombo for validation', () => {
    expect(identifyCombo([card(Rank.Five), card(Rank.Six)])).toBeNull();
  });
});

describe('legalCombos: outstanding Mahjong wish narrows the candidate list', () => {
  it('leading with the Mahjong and wishing for a rank still in hand succeeds (the wish is not yet active for this play)', () => {
    const hand0 = [special(Rank.Mahjong), card(Rank.King), card(Rank.Three)];
    const state = makePlayingState(
      { 0: hand0, 1: [card(Rank.Four)], 2: [card(Rank.Five)], 3: [card(Rank.Six)] },
      { currentPlayer: 0, trickLeader: 0 },
    );

    const result = playCombo(state, 0, [special(Rank.Mahjong)], Rank.King, null);

    expect(result.ok).toBe(true);
  });

  it('narrows a player\'s legal combos to only the wish-fulfilling ones once a wish is outstanding and they can fulfill it', () => {
    // Bug: legalCombos previously ignored an outstanding wish entirely, so a
    // caller that treats it as "the candidates to pick from" (the client's
    // play UI, and the AI's encodeLegalActions) could offer/pick a combo that
    // playCombo would then reject -- for the AI, that rejection is a thrown
    // exception (SoloGame's `mustOk`), which froze the whole game.
    const hand1 = [card(Rank.King), card(Rank.Three), card(Rank.Four)];
    const state = makePlayingState(
      { 0: [], 1: hand1, 2: [], 3: [] },
      { currentPlayer: 1, trickLeader: 1, currentBest: null, mahjongWish: Rank.King },
    );

    const combos = legalCombos(state, 1);

    expect(combos.length).toBeGreaterThan(0);
    expect(combos.every((c) => c.cards.some((card) => card.rank === Rank.King))).toBe(true);
  });

  it('falls back to the full legal combo list when the player cannot fulfill the wish at all', () => {
    const hand1 = [card(Rank.Three), card(Rank.Four)];
    const state = makePlayingState(
      { 0: [], 1: hand1, 2: [], 3: [] },
      { currentPlayer: 1, trickLeader: 1, currentBest: null, mahjongWish: Rank.King },
    );

    const combos = legalCombos(state, 1);

    expect(combos.length).toBe(2);
    expect(combos.some((c) => c.cards[0]?.rank === Rank.Three)).toBe(true);
    expect(combos.some((c) => c.cards[0]?.rank === Rank.Four)).toBe(true);
  });

  it('rejects a lead that ignores an outstanding, fulfillable wish even from the original wisher', () => {
    // Simulates: I lead Mahjong+wish(King), keep the King, everyone else
    // passes (the trick comes back to me as leader again), then I try to
    // lead something that does not include the King even though I could.
    const hand0 = [card(Rank.King), card(Rank.Three), card(Rank.Four)];
    const state = makePlayingState(
      { 0: hand0, 1: [], 2: [], 3: [] },
      { currentPlayer: 0, trickLeader: 0, currentBest: null, mahjongWish: Rank.King },
    );

    const result = playCombo(state, 0, [card(Rank.Three)], null, null);

    expect(result.ok).toBe(false);
  });
});
