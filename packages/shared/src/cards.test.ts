import { describe, expect, it } from 'vitest';
import {
  type Card,
  NUMERIC_RANKS,
  Rank,
  SPECIAL_RANKS,
  Suit,
  cardKey,
  cardsEqual,
  containsCard,
  createDeck,
  isSpecial,
  pointValue,
  shuffledDeck,
  withoutCards,
} from './cards';

describe('SPECIAL_RANKS / NUMERIC_RANKS', () => {
  it('classifies exactly Dog, Mahjong, Phoenix, Dragon as special', () => {
    expect(SPECIAL_RANKS.size).toBe(4);
    expect(SPECIAL_RANKS.has(Rank.Dog)).toBe(true);
    expect(SPECIAL_RANKS.has(Rank.Mahjong)).toBe(true);
    expect(SPECIAL_RANKS.has(Rank.Phoenix)).toBe(true);
    expect(SPECIAL_RANKS.has(Rank.Dragon)).toBe(true);
  });

  it('lists the 13 numeric ranks from Two to Ace in ascending order', () => {
    expect(NUMERIC_RANKS).toHaveLength(13);
    expect(NUMERIC_RANKS[0]).toBe(Rank.Two);
    expect(NUMERIC_RANKS[NUMERIC_RANKS.length - 1]).toBe(Rank.Ace);
    expect(NUMERIC_RANKS.some((r) => SPECIAL_RANKS.has(r))).toBe(false);
  });
});

describe('isSpecial / pointValue', () => {
  it('flags special-rank cards regardless of suit', () => {
    expect(isSpecial({ rank: Rank.Dragon, suit: Suit.Special })).toBe(true);
    expect(isSpecial({ rank: Rank.Five, suit: Suit.Sword })).toBe(false);
  });

  it('returns the correct point value for scoring-relevant ranks', () => {
    expect(pointValue({ rank: Rank.Five, suit: Suit.Sword })).toBe(5);
    expect(pointValue({ rank: Rank.Ten, suit: Suit.Sword })).toBe(10);
    expect(pointValue({ rank: Rank.King, suit: Suit.Sword })).toBe(10);
    expect(pointValue({ rank: Rank.Dragon, suit: Suit.Special })).toBe(25);
    expect(pointValue({ rank: Rank.Phoenix, suit: Suit.Special })).toBe(-25);
  });

  it('returns 0 for ranks with no point value', () => {
    expect(pointValue({ rank: Rank.Seven, suit: Suit.Jade })).toBe(0);
    expect(pointValue({ rank: Rank.Mahjong, suit: Suit.Special })).toBe(0);
  });
});

describe('cardsEqual / cardKey / containsCard / withoutCards', () => {
  const five: Card = { rank: Rank.Five, suit: Suit.Sword };
  const fiveCopy: Card = { rank: Rank.Five, suit: Suit.Sword };
  const fiveOtherSuit: Card = { rank: Rank.Five, suit: Suit.Jade };

  it('treats two distinct objects with the same rank/suit as equal', () => {
    expect(cardsEqual(five, fiveCopy)).toBe(true);
    expect(cardsEqual(five, fiveOtherSuit)).toBe(false);
  });

  it('gives structurally-equal cards the same key', () => {
    expect(cardKey(five)).toBe(cardKey(fiveCopy));
    expect(cardKey(five)).not.toBe(cardKey(fiveOtherSuit));
  });

  it('finds a structurally-equal card even when it is a different object', () => {
    expect(containsCard([fiveOtherSuit, fiveCopy], five)).toBe(true);
    expect(containsCard([fiveOtherSuit], five)).toBe(false);
  });

  it('removes only the structurally-equal cards, keeping the rest', () => {
    const hand = [five, fiveOtherSuit, { rank: Rank.Six, suit: Suit.Sword }];

    const remaining = withoutCards(hand, [fiveCopy]);

    expect(remaining).toHaveLength(2);
    expect(containsCard(remaining, five)).toBe(false);
    expect(containsCard(remaining, fiveOtherSuit)).toBe(true);
  });
});

describe('createDeck', () => {
  it('has 56 unique cards', () => {
    const deck = createDeck();

    expect(deck).toHaveLength(56);
    expect(new Set(deck.map(cardKey)).size).toBe(56);
  });

  it('orders suit-major for normal cards, then the four specials', () => {
    const deck = createDeck();

    expect(deck[0]).toEqual({ rank: Rank.Two, suit: Suit.Sword });
    expect(deck[12]).toEqual({ rank: Rank.Ace, suit: Suit.Sword });
    expect(deck[13]).toEqual({ rank: Rank.Two, suit: Suit.Pagoda });
    expect(deck[51]).toEqual({ rank: Rank.Ace, suit: Suit.Star });
    expect(deck.slice(52)).toEqual([
      { rank: Rank.Dog, suit: Suit.Special },
      { rank: Rank.Mahjong, suit: Suit.Special },
      { rank: Rank.Phoenix, suit: Suit.Special },
      { rank: Rank.Dragon, suit: Suit.Special },
    ]);
  });
});

describe('shuffledDeck', () => {
  it('contains the same 56 cards as createDeck, just reordered', () => {
    const shuffled = shuffledDeck();

    expect(shuffled).toHaveLength(56);
    expect(new Set(shuffled.map(cardKey))).toEqual(new Set(createDeck().map(cardKey)));
  });
});
