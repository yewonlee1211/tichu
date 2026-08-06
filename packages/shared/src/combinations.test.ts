import { describe, expect, it } from 'vitest';
import { type Card, Rank, Suit } from './cards';
import { ComboType, beats, effectiveStrength, identifyCombo } from './combinations';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

function special(rank: Rank): Card {
  return { rank, suit: Suit.Special };
}

describe('identifyCombo: singles', () => {
  it('identifies an ordinary single by its rank value', () => {
    const combo = identifyCombo([card(Rank.King)]);

    expect(combo).toEqual({
      comboType: ComboType.Single,
      cards: [card(Rank.King)],
      length: 1,
      rankStrength: Rank.King,
      isLonePhoenix: false,
    });
  });

  it('identifies the Dog as its own combo type with zero strength', () => {
    const combo = identifyCombo([special(Rank.Dog)]);

    expect(combo?.comboType).toBe(ComboType.Dog);
    expect(combo?.rankStrength).toBe(0);
  });

  it('identifies a lone Phoenix single with strength 0.5 and the lone-phoenix flag', () => {
    const combo = identifyCombo([special(Rank.Phoenix)]);

    expect(combo?.comboType).toBe(ComboType.Single);
    expect(combo?.rankStrength).toBe(0.5);
    expect(combo?.isLonePhoenix).toBe(true);
  });
});

describe('identifyCombo: pairs / triples / bombs', () => {
  it('identifies an ordinary pair', () => {
    const combo = identifyCombo([card(Rank.Nine, Suit.Sword), card(Rank.Nine, Suit.Jade)]);

    expect(combo?.comboType).toBe(ComboType.Pair);
    expect(combo?.rankStrength).toBe(Rank.Nine);
  });

  it('lets the Phoenix complete a pair, taking the real card rank as strength', () => {
    const combo = identifyCombo([card(Rank.Nine, Suit.Sword), special(Rank.Phoenix)]);

    expect(combo?.comboType).toBe(ComboType.Pair);
    expect(combo?.rankStrength).toBe(Rank.Nine);
    expect(combo?.isLonePhoenix).toBe(false);
  });

  it('rejects a pair of Dogs or Dragons (unpairable ranks)', () => {
    expect(identifyCombo([special(Rank.Dragon), special(Rank.Dragon)])).toBeNull();
  });

  it('rejects the Phoenix pairing with the Mahjong', () => {
    expect(identifyCombo([special(Rank.Mahjong), special(Rank.Phoenix)])).toBeNull();
  });

  it('identifies a same-rank quad as a bomb', () => {
    const quad = [Suit.Sword, Suit.Pagoda, Suit.Jade, Suit.Star].map((s) => card(Rank.Seven, s));

    const combo = identifyCombo(quad);

    expect(combo?.comboType).toBe(ComboType.BombQuad);
    expect(combo?.rankStrength).toBe(Rank.Seven);
  });

  it('rejects duplicate physical cards in the same combo', () => {
    expect(identifyCombo([card(Rank.Five), card(Rank.Five)])).toBeNull();
  });
});

describe('identifyCombo: full house', () => {
  it('identifies a full house and takes the triple rank as strength', () => {
    const cards = [
      card(Rank.Three, Suit.Sword),
      card(Rank.Three, Suit.Jade),
      card(Rank.Three, Suit.Star),
      card(Rank.Eight, Suit.Sword),
      card(Rank.Eight, Suit.Jade),
    ];

    const combo = identifyCombo(cards);

    expect(combo?.comboType).toBe(ComboType.FullHouse);
    expect(combo?.rankStrength).toBe(Rank.Three);
  });

  it('lets the Phoenix complete the pair side of an already-real triple', () => {
    const cards = [
      card(Rank.Three, Suit.Sword),
      card(Rank.Three, Suit.Jade),
      card(Rank.Three, Suit.Star),
      card(Rank.Eight, Suit.Sword),
      special(Rank.Phoenix),
    ];

    const combo = identifyCombo(cards);

    expect(combo?.comboType).toBe(ComboType.FullHouse);
    expect(combo?.rankStrength).toBe(Rank.Three);
  });

  it('resolves a Phoenix + two pairs ambiguity toward the higher-ranked triple', () => {
    const cards = [
      card(Rank.Three, Suit.Sword),
      card(Rank.Three, Suit.Jade),
      card(Rank.Eight, Suit.Sword),
      card(Rank.Eight, Suit.Jade),
      special(Rank.Phoenix),
    ];

    const combo = identifyCombo(cards);

    expect(combo?.rankStrength).toBe(Rank.Eight);
  });
});

describe('identifyCombo: straights', () => {
  it('identifies a plain 5-card straight, strength at the top card', () => {
    const cards = [
      card(Rank.Three, Suit.Sword),
      card(Rank.Four, Suit.Jade),
      card(Rank.Five, Suit.Sword),
      card(Rank.Six, Suit.Jade),
      card(Rank.Seven, Suit.Sword),
    ];

    const combo = identifyCombo(cards);

    expect(combo?.comboType).toBe(ComboType.Straight);
    expect(combo?.rankStrength).toBe(Rank.Seven);
  });

  it('lets the Phoenix fill an internal gap', () => {
    const cards = [card(Rank.Three), card(Rank.Four), special(Rank.Phoenix), card(Rank.Six), card(Rank.Seven)];

    const combo = identifyCombo(cards);

    expect(combo?.comboType).toBe(ComboType.Straight);
    expect(combo?.rankStrength).toBe(Rank.Seven);
  });

  it('lets the Phoenix extend a contiguous run upward, capped at Ace', () => {
    const cards = [card(Rank.Jack), card(Rank.Queen), card(Rank.King), card(Rank.Ace), special(Rank.Phoenix)];

    const combo = identifyCombo(cards);

    expect(combo?.rankStrength).toBe(Rank.Ace);
  });

  it('rejects a straight shorter than 5 cards', () => {
    expect(identifyCombo([card(Rank.Three), card(Rank.Four), card(Rank.Five)])).toBeNull();
  });

  it('rejects the Dog or Dragon inside a straight', () => {
    const cards = [special(Rank.Dog), card(Rank.Four), card(Rank.Five), card(Rank.Six), card(Rank.Seven)];

    expect(identifyCombo(cards)).toBeNull();
  });
});

describe('identifyCombo: pair straights and straight flushes', () => {
  it('identifies a pair straight, strength at the top pair', () => {
    const cards = [
      card(Rank.Three, Suit.Sword),
      card(Rank.Three, Suit.Jade),
      card(Rank.Four, Suit.Sword),
      card(Rank.Four, Suit.Jade),
      card(Rank.Five, Suit.Sword),
      card(Rank.Five, Suit.Jade),
    ];

    const combo = identifyCombo(cards);

    expect(combo?.comboType).toBe(ComboType.PairStraight);
    expect(combo?.rankStrength).toBe(Rank.Five);
  });

  it('lets the Phoenix complete one pair of a pair straight', () => {
    const cards = [
      card(Rank.Three, Suit.Sword),
      card(Rank.Three, Suit.Jade),
      card(Rank.Four, Suit.Sword),
      special(Rank.Phoenix),
      card(Rank.Five, Suit.Sword),
      card(Rank.Five, Suit.Jade),
    ];

    const combo = identifyCombo(cards);

    expect(combo?.comboType).toBe(ComboType.PairStraight);
    expect(combo?.rankStrength).toBe(Rank.Five);
  });

  it('identifies a same-suit straight as a straight-flush bomb', () => {
    const cards = [Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven].map((r) => card(r, Suit.Jade));

    const combo = identifyCombo(cards);

    expect(combo?.comboType).toBe(ComboType.BombStraightFlush);
  });

  it('rejects the Phoenix inside a straight flush (specials disqualify it)', () => {
    const cards = [card(Rank.Three, Suit.Jade), card(Rank.Four, Suit.Jade), card(Rank.Five, Suit.Jade), card(Rank.Six, Suit.Jade), special(Rank.Phoenix)];

    expect(identifyCombo(cards)?.comboType).not.toBe(ComboType.BombStraightFlush);
  });
});

describe('effectiveStrength', () => {
  it('gives a lone Phoenix opening a trick strength 0.5', () => {
    const phoenix = identifyCombo([special(Rank.Phoenix)])!;

    expect(effectiveStrength(phoenix, null)).toBe(0.5);
  });

  it('gives a lone Phoenix following strength half a point above what it beats', () => {
    const phoenix = identifyCombo([special(Rank.Phoenix)])!;

    expect(effectiveStrength(phoenix, 7.0)).toBe(7.5);
  });

  it('uses the fixed rank strength for every other combo, ignoring preceding strength', () => {
    const single = identifyCombo([card(Rank.King)])!;

    expect(effectiveStrength(single, 3.0)).toBe(Rank.King);
  });
});

describe('beats', () => {
  it('lets a higher single of the same length beat a lower one', () => {
    const current = identifyCombo([card(Rank.Seven)])!;
    const challenger = identifyCombo([card(Rank.King)])!;

    expect(beats(challenger, current, 7)).toBe(true);
    expect(beats(current, challenger, Rank.King)).toBe(false);
  });

  it('never lets the Dog beat anything or be beaten', () => {
    const dog = identifyCombo([special(Rank.Dog)])!;
    const five = identifyCombo([card(Rank.Five)])!;

    expect(beats(dog, five, 5)).toBe(false);
    expect(beats(five, dog, 0)).toBe(false);
  });

  it('lets any bomb beat a non-bomb combo of any type', () => {
    const quad = identifyCombo([Suit.Sword, Suit.Pagoda, Suit.Jade, Suit.Star].map((s) => card(Rank.Seven, s)))!;
    const straight = identifyCombo([
      card(Rank.Ten, Suit.Sword),
      card(Rank.Jack, Suit.Jade),
      card(Rank.Queen, Suit.Sword),
      card(Rank.King, Suit.Jade),
      card(Rank.Ace, Suit.Sword),
    ])!;

    expect(beats(quad, straight, Rank.Ace)).toBe(true);
  });

  it('lets a straight flush beat a quad bomb regardless of rank', () => {
    const quad = identifyCombo([Suit.Sword, Suit.Pagoda, Suit.Jade, Suit.Star].map((s) => card(Rank.Ace, s)))!;
    const flush = identifyCombo([Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven].map((r) => card(r, Suit.Jade)))!;

    expect(beats(flush, quad, Rank.Ace)).toBe(true);
  });

  it('requires a longer straight flush to beat a shorter one of higher rank', () => {
    const shortHigh = identifyCombo([Rank.Jack, Rank.Queen, Rank.King, Rank.Ace, Rank.Ten].map((r) => card(r, Suit.Jade)))!;
    const longLow = identifyCombo(
      [Rank.Three, Rank.Four, Rank.Five, Rank.Six, Rank.Seven, Rank.Eight].map((r) => card(r, Suit.Star)),
    )!;

    expect(beats(longLow, shortHigh, shortHigh.rankStrength)).toBe(true);
    expect(beats(shortHigh, longLow, longLow.rankStrength)).toBe(false);
  });

  it('never lets the Phoenix single beat a lone Dragon', () => {
    const dragon = identifyCombo([special(Rank.Dragon)])!;
    const phoenix = identifyCombo([special(Rank.Phoenix)])!;

    expect(beats(phoenix, dragon, Rank.Dragon)).toBe(false);
  });
});
