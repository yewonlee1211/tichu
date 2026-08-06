export enum Suit {
  Sword = 'sword',
  Pagoda = 'pagoda',
  Jade = 'jade',
  Star = 'star',
  Special = 'special',
}

// Values mirror ai/tichu_env/cards.py's Rank exactly -- combinations.ts and
// scoring.ts rely on these integers directly (rank.value comparisons,
// strength arithmetic), so they must stay numerically identical to the
// Python source of truth, not just ordered the same way.
export enum Rank {
  Dog = 0,
  Mahjong = 1,
  Two = 2,
  Three = 3,
  Four = 4,
  Five = 5,
  Six = 6,
  Seven = 7,
  Eight = 8,
  Nine = 9,
  Ten = 10,
  Jack = 11,
  Queen = 12,
  King = 13,
  Ace = 14,
  Phoenix = 15,
  Dragon = 16,
}

export const SPECIAL_RANKS: ReadonlySet<Rank> = new Set([Rank.Dog, Rank.Mahjong, Rank.Phoenix, Rank.Dragon]);

// Ascending order, Mahjong excluded (it is one of SPECIAL_RANKS) -- matches
// ai/tichu_env/cards.py's NUMERIC_RANKS.
export const NUMERIC_RANKS: readonly Rank[] = [
  Rank.Two,
  Rank.Three,
  Rank.Four,
  Rank.Five,
  Rank.Six,
  Rank.Seven,
  Rank.Eight,
  Rank.Nine,
  Rank.Ten,
  Rank.Jack,
  Rank.Queen,
  Rank.King,
  Rank.Ace,
];

const POINT_VALUES: ReadonlyMap<Rank, number> = new Map([
  [Rank.Five, 5],
  [Rank.Ten, 10],
  [Rank.King, 10],
  [Rank.Dragon, 25],
  [Rank.Phoenix, -25],
]);

export interface Card {
  readonly rank: Rank;
  readonly suit: Suit;
}

export function isSpecial(card: Card): boolean {
  return SPECIAL_RANKS.has(card.rank);
}

export function pointValue(card: Card): number {
  return POINT_VALUES.get(card.rank) ?? 0;
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}

// Canonical string key for Card identity in Set/Map -- JS Set/Map compare
// objects by reference, so anywhere Python relies on Card being hashable
// (frozenset dedup, dict keys, `card not in hand`) needs this instead.
export function cardKey(card: Card): string {
  return `${card.rank}:${card.suit}`;
}

export function containsCard(cards: readonly Card[], card: Card): boolean {
  return cards.some((c) => cardsEqual(c, card));
}

export function withoutCards(hand: readonly Card[], toRemove: readonly Card[]): readonly Card[] {
  const removeKeys = new Set(toRemove.map(cardKey));
  return hand.filter((c) => !removeKeys.has(cardKey(c)));
}

const NORMAL_SUITS: readonly Suit[] = [Suit.Sword, Suit.Pagoda, Suit.Jade, Suit.Star];
const SPECIAL_RANK_ORDER: readonly Rank[] = [Rank.Dog, Rank.Mahjong, Rank.Phoenix, Rank.Dragon];

// Order matters: encoding.ts's card bitmask index is derived from this exact
// sequence (suit-major for normal cards, then the four specials), matching
// ai/tichu_env/legal_moves.py's CARD_ORDER so golden-fixture vectors line up.
export function createDeck(): readonly Card[] {
  const normalCards: Card[] = [];
  for (const suit of NORMAL_SUITS) {
    for (const rank of NUMERIC_RANKS) {
      normalCards.push({ rank, suit });
    }
  }
  const specialCards: Card[] = SPECIAL_RANK_ORDER.map((rank) => ({ rank, suit: Suit.Special }));
  return [...normalCards, ...specialCards];
}

function shuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = shuffled[i]!;
    shuffled[i] = shuffled[j]!;
    shuffled[j] = temp;
  }
  return shuffled;
}

// No seeded-RNG parity with Python's random.Random is attempted here (Python's
// Mersenne Twister sequence isn't reproducible from JS) -- callers that need
// determinism (tests, golden fixtures) should build/pass an explicit deck
// instead of relying on this shuffle.
export function shuffledDeck(): Card[] {
  return shuffle(createDeck());
}
