import { describe, expect, it } from 'vitest';
import { type Card, Rank, Suit } from '@tichu/shared';
import { shouldCallLargeTichu, shouldCallTichu } from './heuristicCalls';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

describe('shouldCallLargeTichu', () => {
  it('calls with 2 or more Aces', () => {
    const hand = [card(Rank.Ace, Suit.Sword), card(Rank.Ace, Suit.Pagoda), card(Rank.Five)];
    expect(shouldCallLargeTichu(hand)).toBe(true);
  });

  it('declines with fewer than 2 Aces', () => {
    const hand = [card(Rank.Ace), card(Rank.Five), card(Rank.King)];
    expect(shouldCallLargeTichu(hand)).toBe(false);
  });
});

describe('shouldCallTichu', () => {
  it('calls with 2+ Aces and a Dragon', () => {
    const hand = [card(Rank.Ace, Suit.Sword), card(Rank.Ace, Suit.Pagoda), card(Rank.Dragon, Suit.Special)];
    expect(shouldCallTichu(hand)).toBe(true);
  });

  it('calls with 2+ Aces and a Phoenix', () => {
    const hand = [card(Rank.Ace, Suit.Sword), card(Rank.Ace, Suit.Pagoda), card(Rank.Phoenix, Suit.Special)];
    expect(shouldCallTichu(hand)).toBe(true);
  });

  it('declines with 2+ Aces but no Dragon or Phoenix', () => {
    const hand = [card(Rank.Ace, Suit.Sword), card(Rank.Ace, Suit.Pagoda), card(Rank.King)];
    expect(shouldCallTichu(hand)).toBe(false);
  });

  it('declines with a Dragon but fewer than 2 Aces', () => {
    const hand = [card(Rank.Ace, Suit.Sword), card(Rank.Dragon, Suit.Special)];
    expect(shouldCallTichu(hand)).toBe(false);
  });
});
