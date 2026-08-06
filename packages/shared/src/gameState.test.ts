import { describe, expect, it } from 'vitest';
import bombInterruptFixture from './goldenFixtures/bomb_interrupt.json';
import doubleOutFixture from './goldenFixtures/double_out.json';
import grandTichuFixture from './goldenFixtures/grand_tichu.json';
import lastCardHandoverFixture from './goldenFixtures/last_card_handover.json';
import normalRoundFixture from './goldenFixtures/normal_round.json';
import { cardFromFixture, cardsFromFixture, stateFromFixture } from './goldenFixtures/decode';
import { type Card, Rank, Suit } from './cards';
import { ComboType, identifyCombo } from './combinations';
import {
  type GameState,
  NUM_PLAYERS,
  Phase,
  callTichu,
  dealNewRound,
  decideLargeTichu,
  exchangeCards,
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
  };
  return { ...base, ...overrides };
}

function expectOk<T>(result: { ok: boolean; value?: T; error?: string }): T {
  if (!result.ok) throw new Error(`expected ok, got error: ${result.error}`);
  return result.value as T;
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
    expect(state).toEqual(stateFromFixture(normalRoundFixture.afterLargeTichuState as never));

    const gifts: Record<number, Record<number, Card>> = {};
    for (let giver = 0; giver < NUM_PLAYERS; giver += 1) {
      const hand = [...state.hands[giver]!].sort((a, b) => a.rank - b.rank);
      const others = [0, 1, 2, 3].filter((p) => p !== giver);
      gifts[giver] = Object.fromEntries(others.map((recipient, i) => [recipient, hand[i]!]));
    }
    state = expectOk(exchangeCards(state, gifts));
    expect(state).toEqual(stateFromFixture(normalRoundFixture.afterExchangeState as never));
    expect(state.currentPlayer).toBe(normalRoundFixture.leader);

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
    expect(state).toEqual(stateFromFixture(grandTichuFixture.afterLargeTichuState as never));
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
