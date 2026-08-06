import { type Card, NUMERIC_RANKS, Rank, Suit, cardKey } from './cards';

// String values match ai/tichu_env/combinations.py's ComboType member *names*
// (SINGLE, BOMB_QUAD, ...) rather than its lowercase `.value`s, because the
// golden fixtures serialize combos via Python's `.name` -- keeping these
// identical lets fixture JSON compare directly against TS combo objects.
export enum ComboType {
  Single = 'SINGLE',
  Dog = 'DOG',
  Pair = 'PAIR',
  Triple = 'TRIPLE',
  FullHouse = 'FULL_HOUSE',
  Straight = 'STRAIGHT',
  PairStraight = 'PAIR_STRAIGHT',
  BombQuad = 'BOMB_QUAD',
  BombStraightFlush = 'BOMB_STRAIGHT_FLUSH',
}

export const BOMB_TYPES: ReadonlySet<ComboType> = new Set([ComboType.BombQuad, ComboType.BombStraightFlush]);

// Mahjong is lowest, Ace is highest. NUMERIC_RANKS already excludes Mahjong
// (it's one of cards.ts's SPECIAL_RANKS).
export const STRAIGHT_RANKS: readonly Rank[] = [Rank.Mahjong, ...NUMERIC_RANKS];
export const STRAIGHT_RANK_ORDER: ReadonlyMap<Rank, number> = new Map(
  STRAIGHT_RANKS.map((rank, index) => [rank, index]),
);

const UNPAIRABLE_RANKS: ReadonlySet<Rank> = new Set([Rank.Dog, Rank.Dragon]);

export interface Combo {
  readonly comboType: ComboType;
  readonly cards: readonly Card[];
  readonly length: number;
  readonly rankStrength: number;
  readonly isLonePhoenix: boolean;
}

export function identifyCombo(cards: readonly Card[]): Combo | null {
  if (cards.length === 0 || new Set(cards.map(cardKey)).size !== cards.length) {
    return null;
  }
  const n = cards.length;
  if (n === 1) return single(cards[0]!);
  if (n === 2) return pair(cards);
  if (n === 3) return triple(cards);
  if (n === 4) return bombQuad(cards) ?? pairStraight(cards);
  if (n === 5) return straightFlush(cards) ?? straight(cards) ?? fullHouse(cards);
  if (n % 2 === 0) return pairStraight(cards) ?? straightFlush(cards) ?? straight(cards);
  return straightFlush(cards) ?? straight(cards);
}

export function effectiveStrength(combo: Combo, precedingStrength: number | null): number {
  if (combo.isLonePhoenix) {
    return precedingStrength === null ? 0.5 : precedingStrength + 0.5;
  }
  return combo.rankStrength;
}

export function beats(challenger: Combo, current: Combo, currentStrength: number): boolean {
  if (challenger.comboType === ComboType.Dog || current.comboType === ComboType.Dog) {
    return false;
  }
  if (challenger.isLonePhoenix && isDragonSingle(current)) {
    return false;
  }

  const challengerIsBomb = BOMB_TYPES.has(challenger.comboType);
  const currentIsBomb = BOMB_TYPES.has(current.comboType);
  if (challengerIsBomb && !currentIsBomb) return true;
  if (currentIsBomb && !challengerIsBomb) return false;
  if (challengerIsBomb && currentIsBomb) return bombBeats(challenger, current);

  if (challenger.comboType !== current.comboType || challenger.length !== current.length) {
    return false;
  }
  return effectiveStrength(challenger, currentStrength) > currentStrength;
}

function isDragonSingle(combo: Combo): boolean {
  return combo.comboType === ComboType.Single && combo.cards[0]?.rank === Rank.Dragon;
}

function bombBeats(challenger: Combo, current: Combo): boolean {
  if (challenger.comboType === current.comboType) {
    if (challenger.comboType === ComboType.BombStraightFlush && challenger.length !== current.length) {
      return challenger.length > current.length;
    }
    return challenger.rankStrength > current.rankStrength;
  }
  return challenger.comboType === ComboType.BombStraightFlush;
}

function splitPhoenix(cards: readonly Card[]): readonly [Card | null, Card[]] {
  const phoenix = cards.find((c) => c.rank === Rank.Phoenix) ?? null;
  const reals = cards.filter((c) => c.rank !== Rank.Phoenix);
  return [phoenix, reals];
}

function countByRank(cards: readonly Card[]): Map<Rank, number> {
  const counts = new Map<Rank, number>();
  for (const card of cards) {
    counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1);
  }
  return counts;
}

function single(card: Card): Combo {
  if (card.rank === Rank.Dog) {
    return { comboType: ComboType.Dog, cards: [card], length: 1, rankStrength: 0.0, isLonePhoenix: false };
  }
  if (card.rank === Rank.Phoenix) {
    return { comboType: ComboType.Single, cards: [card], length: 1, rankStrength: 0.5, isLonePhoenix: true };
  }
  return { comboType: ComboType.Single, cards: [card], length: 1, rankStrength: card.rank, isLonePhoenix: false };
}

function pair(cards: readonly Card[]): Combo | null {
  const [phoenix, reals] = splitPhoenix(cards);
  if (phoenix !== null) {
    if (reals.length !== 1 || UNPAIRABLE_RANKS.has(reals[0]!.rank) || reals[0]!.rank === Rank.Mahjong) {
      return null;
    }
    return { comboType: ComboType.Pair, cards, length: 2, rankStrength: reals[0]!.rank, isLonePhoenix: false };
  }
  const ranks = new Set(cards.map((c) => c.rank));
  if (ranks.size !== 1) return null;
  const rank = cards[0]!.rank;
  if (UNPAIRABLE_RANKS.has(rank)) return null;
  return { comboType: ComboType.Pair, cards, length: 2, rankStrength: rank, isLonePhoenix: false };
}

function triple(cards: readonly Card[]): Combo | null {
  const [phoenix, reals] = splitPhoenix(cards);
  if (phoenix !== null) {
    if (reals.length !== 2) return null;
    const ranks = new Set(reals.map((c) => c.rank));
    if (ranks.size !== 1) return null;
    const rank = reals[0]!.rank;
    if (UNPAIRABLE_RANKS.has(rank) || rank === Rank.Mahjong) return null;
    return { comboType: ComboType.Triple, cards, length: 3, rankStrength: rank, isLonePhoenix: false };
  }
  const ranks = new Set(cards.map((c) => c.rank));
  if (ranks.size !== 1) return null;
  const rank = cards[0]!.rank;
  if (UNPAIRABLE_RANKS.has(rank)) return null;
  return { comboType: ComboType.Triple, cards, length: 3, rankStrength: rank, isLonePhoenix: false };
}

function bombQuad(cards: readonly Card[]): Combo | null {
  if (cards.some((c) => c.rank === Rank.Phoenix)) return null;
  const ranks = new Set(cards.map((c) => c.rank));
  if (ranks.size !== 1) return null;
  const rank = cards[0]!.rank;
  if (UNPAIRABLE_RANKS.has(rank) || rank === Rank.Mahjong) return null;
  return { comboType: ComboType.BombQuad, cards, length: 4, rankStrength: rank, isLonePhoenix: false };
}

function fullHouse(cards: readonly Card[]): Combo | null {
  const [phoenix, reals] = splitPhoenix(cards);
  const counts = countByRank(reals);
  for (const rank of counts.keys()) {
    if (UNPAIRABLE_RANKS.has(rank) || rank === Rank.Mahjong) return null;
  }

  if (phoenix === null) {
    const values = [...counts.values()].sort((a, b) => a - b);
    if (values.length !== 2 || values[0] !== 2 || values[1] !== 3) return null;
    const tripleRank = [...counts.entries()].find(([, count]) => count === 3)![0];
    return { comboType: ComboType.FullHouse, cards, length: 5, rankStrength: tripleRank, isLonePhoenix: false };
  }

  if (reals.length !== 4) return null;
  const values = [...counts.values()].sort((a, b) => a - b);
  if (values.length === 2 && values[0] === 1 && values[1] === 3) {
    const tripleRank = [...counts.entries()].find(([, count]) => count === 3)![0];
    return { comboType: ComboType.FullHouse, cards, length: 5, rankStrength: tripleRank, isLonePhoenix: false };
  }
  if (values.length === 2 && values[0] === 2 && values[1] === 2) {
    // Ambiguous which pair the Phoenix completes into a triple; the real
    // rules require the player to declare this. Simplification (matches
    // combinations.py): complete the higher-ranked pair.
    const tripleRank = [...counts.keys()].reduce((max, rank) => (rank > max ? rank : max));
    return { comboType: ComboType.FullHouse, cards, length: 5, rankStrength: tripleRank, isLonePhoenix: false };
  }
  return null;
}

function straight(cards: readonly Card[]): Combo | null {
  const [phoenix, reals] = splitPhoenix(cards);
  if (reals.some((c) => UNPAIRABLE_RANKS.has(c.rank))) return null;
  const realRanks = reals.map((c) => c.rank);
  if (new Set(realRanks).size !== realRanks.length) return null;

  const n = cards.length;
  const positions = realRanks.map((r) => STRAIGHT_RANK_ORDER.get(r)!).sort((a, b) => a - b);

  if (phoenix === null) {
    if (positions.length !== n || positions[positions.length - 1]! - positions[0]! !== n - 1) return null;
    return {
      comboType: ComboType.Straight,
      cards,
      length: n,
      rankStrength: STRAIGHT_RANKS[positions[positions.length - 1]!]!,
      isLonePhoenix: false,
    };
  }

  if (positions.length !== n - 1) return null;
  const span = positions[positions.length - 1]! - positions[0]!;
  if (span === n - 1) {
    return {
      comboType: ComboType.Straight,
      cards,
      length: n,
      rankStrength: STRAIGHT_RANKS[positions[positions.length - 1]!]!,
      isLonePhoenix: false,
    };
  }
  if (span === n - 2) {
    const last = positions[positions.length - 1]!;
    const topIndex = last + 1 < STRAIGHT_RANKS.length ? last + 1 : last;
    return { comboType: ComboType.Straight, cards, length: n, rankStrength: STRAIGHT_RANKS[topIndex]!, isLonePhoenix: false };
  }
  return null;
}

function pairStraight(cards: readonly Card[]): Combo | null {
  const n = cards.length;
  if (n < 4) return null;
  const numPairs = n / 2;
  const [phoenix, reals] = splitPhoenix(cards);
  if (reals.some((c) => UNPAIRABLE_RANKS.has(c.rank) || c.rank === Rank.Mahjong)) return null;
  const counts = countByRank(reals);

  if (phoenix === null) {
    if (reals.length !== n || counts.size !== numPairs || [...counts.values()].some((c) => c !== 2)) {
      return null;
    }
    const positions = [...counts.keys()].map((r) => STRAIGHT_RANK_ORDER.get(r)!).sort((a, b) => a - b);
    if (positions[positions.length - 1]! - positions[0]! !== numPairs - 1) return null;
    return {
      comboType: ComboType.PairStraight,
      cards,
      length: n,
      rankStrength: STRAIGHT_RANKS[positions[positions.length - 1]!]!,
      isLonePhoenix: false,
    };
  }

  if (reals.length !== n - 1) return null;
  const singles = [...counts.entries()].filter(([, count]) => count === 1).map(([rank]) => rank);
  const doubles = [...counts.entries()].filter(([, count]) => count === 2).map(([rank]) => rank);
  if (singles.length !== 1 || doubles.length !== numPairs - 1 || [...counts.values()].some((c) => c !== 1 && c !== 2)) {
    return null;
  }
  const positions = [...doubles, ...singles].map((r) => STRAIGHT_RANK_ORDER.get(r)!).sort((a, b) => a - b);
  if (positions[positions.length - 1]! - positions[0]! !== numPairs - 1) return null;
  return {
    comboType: ComboType.PairStraight,
    cards,
    length: n,
    rankStrength: STRAIGHT_RANKS[positions[positions.length - 1]!]!,
    isLonePhoenix: false,
  };
}

function straightFlush(cards: readonly Card[]): Combo | null {
  if (cards.some((c) => c.suit === Suit.Special)) return null;
  const suits = new Set(cards.map((c) => c.suit));
  if (suits.size !== 1) return null;
  const ranks = cards.map((c) => c.rank);
  if (new Set(ranks).size !== ranks.length) return null;
  const positions = ranks.map((r) => STRAIGHT_RANK_ORDER.get(r)!).sort((a, b) => a - b);
  if (positions[positions.length - 1]! - positions[0]! !== cards.length - 1) return null;
  return {
    comboType: ComboType.BombStraightFlush,
    cards,
    length: cards.length,
    rankStrength: STRAIGHT_RANKS[positions[positions.length - 1]!]!,
    isLonePhoenix: false,
  };
}
