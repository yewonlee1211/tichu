import { describe, expect, it } from 'vitest';
import { type Card, ComboType, identifyCombo, Rank, Suit } from '@tichu/shared';
import { comboDescription } from './cardDisplay';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

describe('comboDescription', () => {
  it('describes a single by its rank', () => {
    expect(comboDescription(identifyCombo([card(Rank.Five)])!)).toBe('싱글 5');
  });

  it('describes a pair/triple by their shared rank', () => {
    expect(comboDescription(identifyCombo([card(Rank.King), card(Rank.King, Suit.Jade)])!)).toBe('페어 K');
    expect(
      comboDescription(identifyCombo([card(Rank.Seven), card(Rank.Seven, Suit.Jade), card(Rank.Seven, Suit.Pagoda)])!),
    ).toBe('트리플 7');
  });

  it('describes a straight by its top card', () => {
    // mixed suits -- same-suit would identify as a bomb (straight flush) instead
    const straight = identifyCombo([
      card(Rank.Three),
      card(Rank.Four, Suit.Jade),
      card(Rank.Five),
      card(Rank.Six, Suit.Jade),
      card(Rank.Seven),
    ])!;
    expect(comboDescription(straight)).toBe('스트레이트 7');
  });

  it('describes a lone Phoenix single as such, not as rank 0.5', () => {
    expect(comboDescription(identifyCombo([card(Rank.Phoenix, Suit.Special)])!)).toBe('싱글 봉황');
  });

  it('describes the Dog with no rank suffix', () => {
    expect(comboDescription({ comboType: ComboType.Dog, cards: [card(Rank.Dog, Suit.Special)], length: 1, rankStrength: 0, isLonePhoenix: false })).toBe(
      '개',
    );
  });
});
