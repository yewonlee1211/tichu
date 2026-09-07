import { describe, expect, it } from 'vitest';
import { type Card, ComboType, identifyCombo, Phase, type PlayerView, Rank, Suit } from '@tichu/shared';
import {
  hasWishFulfillingPlay,
  isAmongLegalCombos,
  isClosingPass,
  isDragonSingle,
  isPlayableTichuState,
  legalCombosForView,
  validDragonRecipients,
} from './legalPlay';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

function baseView(overrides: Partial<PlayerView>): PlayerView {
  return {
    viewerSeat: 0,
    hand: [],
    handSizes: [14, 14, 14, 14],
    trickCards: [],
    collectedPoints: [0, 0, 0, 0],
    phase: Phase.Playing,
    currentPlayer: 0,
    trickLeader: 0,
    currentBest: null,
    currentStrength: 0,
    lastPlayerToAct: null,
    finishedOrder: [],
    tichuCalls: [false, false, false, false],
    largeTichuCalls: [null, null, null, null],
    mahjongWish: null,
    passesInARow: 0,
    cumulativeScores: [0, 0],
    ...overrides,
  };
}

describe('legalCombosForView', () => {
  it('returns combos built only from the viewer own hand when leading', () => {
    const hand = [card(Rank.Five), card(Rank.Five, Suit.Jade), card(Rank.King)];
    const view = baseView({ viewerSeat: 0, hand, trickLeader: 0, currentPlayer: 0, currentBest: null });

    const legal = legalCombosForView(view);

    expect(legal.length).toBeGreaterThan(0);
    for (const combo of legal) {
      for (const c of combo.cards) {
        expect(hand.some((h) => h.rank === c.rank && h.suit === c.suit)).toBe(true);
      }
    }
  });

  it('restricts to bombs only when it is not the viewer turn and a trick is open', () => {
    const bomb = [Suit.Sword, Suit.Pagoda, Suit.Jade, Suit.Star].map((s) => card(Rank.Seven, s));
    const hand = [...bomb, card(Rank.Three)];
    const currentBest = identifyCombo([card(Rank.King)])!;
    const view = baseView({
      viewerSeat: 0,
      hand,
      trickLeader: 1,
      currentPlayer: 2,
      currentBest,
      currentStrength: 13,
    });

    const legal = legalCombosForView(view);

    expect(legal.every((c) => c.comboType === ComboType.BombQuad || c.comboType === ComboType.BombStraightFlush)).toBe(
      true,
    );
    expect(legal.length).toBe(1);
  });

  it('returns nothing when leading is required but the viewer is not the trick leader', () => {
    const view = baseView({ viewerSeat: 0, hand: [card(Rank.Ace)], trickLeader: 1, currentPlayer: 1, currentBest: null });

    expect(legalCombosForView(view)).toEqual([]);
  });
});

describe('isDragonSingle', () => {
  it('is true only for a lone Dragon single', () => {
    expect(isDragonSingle(identifyCombo([card(Rank.Dragon, Suit.Special)]))).toBe(true);
    expect(isDragonSingle(identifyCombo([card(Rank.King)]))).toBe(false);
    expect(isDragonSingle(null)).toBe(false);
  });
});

describe('isAmongLegalCombos', () => {
  it('matches a combo regardless of card order', () => {
    const legal = [identifyCombo([card(Rank.Five), card(Rank.Five, Suit.Jade)])!];
    expect(isAmongLegalCombos([card(Rank.Five, Suit.Jade), card(Rank.Five)], legal)).toBe(true);
    expect(isAmongLegalCombos([card(Rank.Six)], legal)).toBe(false);
  });
});

describe('hasWishFulfillingPlay', () => {
  it('is false when there is no outstanding wish', () => {
    expect(hasWishFulfillingPlay(null, [identifyCombo([card(Rank.Nine)])!])).toBe(false);
  });

  it('is true only when a legal combo contains the wished rank', () => {
    const legal = [identifyCombo([card(Rank.Nine)])!, identifyCombo([card(Rank.King)])!];
    expect(hasWishFulfillingPlay(Rank.King, legal)).toBe(true);
    expect(hasWishFulfillingPlay(Rank.Queen, legal)).toBe(false);
  });
});

describe('validDragonRecipients', () => {
  it('excludes the winner, their partner, and finished players', () => {
    // seat 0 wins; partner is seat 2 (PARTNER = {0:2,1:3,2:0,3:1}); seat 3 already finished.
    expect(validDragonRecipients(0, [3])).toEqual([1]);
  });

  it('allows any non-partner opponent still in the round', () => {
    expect(validDragonRecipients(1, [])).toEqual([0, 2]);
  });
});

describe('isClosingPass', () => {
  const dragonBest = identifyCombo([card(Rank.Dragon, Suit.Special)])!;

  it('is false with no open trick', () => {
    expect(isClosingPass(null, null, [], 0)).toBe(false);
  });

  it('is false for a pass that still leaves other active players yet to pass, with all 4 seats active', () => {
    // winner (lastPlayerToAct) is still active -> needs 3 passes total; this would only be the 1st
    expect(isClosingPass(dragonBest, 1, [], 0)).toBe(false);
    // this would be the 2nd of the needed 3
    expect(isClosingPass(dragonBest, 1, [], 1)).toBe(false);
  });

  it('is true for the pass that reaches the needed count, with all 4 seats active', () => {
    expect(isClosingPass(dragonBest, 1, [], 2)).toBe(true);
  });

  it('needs one fewer pass once a seat has already finished the round', () => {
    // 3 active seats, winner still active -> needs 2 passes total
    expect(isClosingPass(dragonBest, 1, [3], 0)).toBe(false);
    expect(isClosingPass(dragonBest, 1, [3], 1)).toBe(true);
  });

  it('needs a pass from every remaining active seat when the winner themself already finished', () => {
    // winner (seat 1) already went out; 3 active seats remain, all of whom must pass
    expect(isClosingPass(dragonBest, 1, [1], 1)).toBe(false);
    expect(isClosingPass(dragonBest, 1, [1], 2)).toBe(true);
  });
});

describe('isPlayableTichuState', () => {
  it('requires a full 14-card hand, the right phase, and no prior call', () => {
    expect(isPlayableTichuState(Phase.Playing, 14, false)).toBe(true);
    expect(isPlayableTichuState(Phase.Playing, 13, false)).toBe(false);
    expect(isPlayableTichuState(Phase.Playing, 14, true)).toBe(false);
    expect(isPlayableTichuState(Phase.LargeTichu, 8, false)).toBe(false);
    expect(isPlayableTichuState(Phase.Exchange, 14, false)).toBe(true);
  });
});
