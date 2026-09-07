import { type Card, cardKey, type Combo, ComboType, Rank, Suit } from '@tichu/shared';

const RANK_LABELS: Readonly<Record<Rank, string>> = {
  [Rank.Dog]: '개',
  [Rank.Mahjong]: '1',
  [Rank.Two]: '2',
  [Rank.Three]: '3',
  [Rank.Four]: '4',
  [Rank.Five]: '5',
  [Rank.Six]: '6',
  [Rank.Seven]: '7',
  [Rank.Eight]: '8',
  [Rank.Nine]: '9',
  [Rank.Ten]: '10',
  [Rank.Jack]: 'J',
  [Rank.Queen]: 'Q',
  [Rank.King]: 'K',
  [Rank.Ace]: 'A',
  [Rank.Phoenix]: '봉황',
  [Rank.Dragon]: '용',
};

const SUIT_SYMBOLS: Readonly<Record<Suit, string>> = {
  [Suit.Sword]: '⚔',
  [Suit.Pagoda]: '⛩',
  [Suit.Jade]: '♠',
  [Suit.Star]: '★',
  [Suit.Special]: '',
};

export const COMBO_TYPE_LABELS: Readonly<Record<ComboType, string>> = {
  [ComboType.Single]: '싱글',
  [ComboType.Dog]: '개',
  [ComboType.Pair]: '페어',
  [ComboType.Triple]: '트리플',
  [ComboType.FullHouse]: '풀하우스',
  [ComboType.Straight]: '스트레이트',
  [ComboType.PairStraight]: '연속 페어',
  [ComboType.BombQuad]: '봄(포카드)',
  [ComboType.BombStraightFlush]: '봄(스트레이트 플러시)',
};

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank];
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

export function cardLabel(card: Card): string {
  const suit = suitSymbol(card.suit);
  return suit === '' ? rankLabel(card.rank) : `${rankLabel(card.rank)}${suit}`;
}

/** A short combo-type-plus-rank description, e.g. "싱글 5", "페어 K", "스트레이트 A"
 * (straights/pair-straights/bomb-straight-flushes use their top card).
 * `Combo.rankStrength` already carries exactly this representative rank for
 * every combo type except a lone-Phoenix single (which plays as rank 0.5, not
 * a real `Rank`). */
export function comboDescription(combo: Combo): string {
  const typeLabel = COMBO_TYPE_LABELS[combo.comboType];
  if (combo.comboType === ComboType.Dog) return typeLabel;
  if (combo.isLonePhoenix) return `${typeLabel} ${rankLabel(Rank.Phoenix)}`;
  return `${typeLabel} ${rankLabel(combo.rankStrength as Rank)}`;
}

export { cardKey };

/** Ascending by rank for stable, readable hand display; ties broken by suit
 * so repeated ranks (pairs/triples) sit together deterministically. */
export function sortHand(cards: readonly Card[]): readonly Card[] {
  return [...cards].sort((a, b) => a.rank - b.rank || a.suit.localeCompare(b.suit));
}
