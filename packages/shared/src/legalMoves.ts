import { type Card, Rank } from './cards';
import { STRAIGHT_RANKS, STRAIGHT_RANK_ORDER } from './combinations';

const NON_GROUPABLE: ReadonlySet<Rank> = new Set([Rank.Dog, Rank.Dragon]);

/** Card-subsets of `hand` worth checking with identifyCombo.
 *
 * A brute-force scan of every subset of a 14-card hand is 2**14 candidates,
 * far too slow for self-play. This builds candidates directly from the
 * hand's rank/suit structure instead -- singles, rank-groupings for
 * pairs/triples/quads/full houses, and consecutive-rank runs for
 * straights/pair-straights/straight flushes -- mirroring
 * ai/tichu_env/legal_moves.py exactly. identifyCombo/beats remain the
 * single source of truth for what is actually legal. */
export function candidateCardSets(hand: readonly Card[]): Card[][] {
  const candidates: Card[][] = hand.map((c) => [c]);
  candidates.push(...sameRankCandidates(hand));
  candidates.push(...fullHouseCandidates(hand));
  candidates.push(...straightCandidates(hand));
  candidates.push(...pairStraightCandidates(hand));
  return candidates;
}

function splitPhoenix(hand: readonly Card[]): readonly [Card | null, Card[]] {
  const phoenix = hand.find((c) => c.rank === Rank.Phoenix) ?? null;
  const reals = hand.filter((c) => c.rank !== Rank.Phoenix);
  return [phoenix, reals];
}

function groupByRank(cards: readonly Card[], exclude: ReadonlySet<Rank>): Map<Rank, Card[]> {
  const groups = new Map<Rank, Card[]>();
  for (const card of cards) {
    if (exclude.has(card.rank)) continue;
    const list = groups.get(card.rank);
    if (list) list.push(card);
    else groups.set(card.rank, [card]);
  }
  return groups;
}

function combinationsOf<T>(items: readonly T[], size: number): T[][] {
  if (size === 0) return [[]];
  if (items.length < size) return [];
  const [first, ...rest] = items;
  const withFirst = combinationsOf(rest, size - 1).map((c) => [first as T, ...c]);
  const withoutFirst = combinationsOf(rest, size);
  return [...withFirst, ...withoutFirst];
}

function cartesianProduct<T>(arrays: readonly (readonly T[])[]): T[][] {
  return arrays.reduce<T[][]>((acc, arr) => acc.flatMap((prefix) => arr.map((item) => [...prefix, item])), [[]]);
}

function sameRankCandidates(hand: readonly Card[]): Card[][] {
  const [phoenix, reals] = splitPhoenix(hand);
  const byRank = groupByRank(reals, new Set());

  const candidates: Card[][] = [];
  for (const [rank, cards] of byRank) {
    if (NON_GROUPABLE.has(rank)) continue;
    for (const size of [2, 3, 4]) {
      if (cards.length >= size) candidates.push(...combinationsOf(cards, size));
    }
    if (phoenix !== null && rank !== Rank.Mahjong) {
      for (const c of cards) candidates.push([c, phoenix]);
      if (cards.length >= 2) {
        for (const pair of combinationsOf(cards, 2)) candidates.push([...pair, phoenix]);
      }
    }
  }
  return candidates;
}

function fullHouseCandidates(hand: readonly Card[]): Card[][] {
  const sameRank = sameRankCandidates(hand);
  const triples = sameRank.filter((c) => c.length === 3);
  const pairs = sameRank.filter((c) => c.length === 2);

  const candidates: Card[][] = [];
  for (const triple of triples) {
    const tripleRanks = new Set(triple.filter((c) => c.rank !== Rank.Phoenix).map((c) => c.rank));
    const tripleUsesPhoenix = triple.some((c) => c.rank === Rank.Phoenix);
    for (const pair of pairs) {
      const pairRanks = new Set(pair.filter((c) => c.rank !== Rank.Phoenix).map((c) => c.rank));
      if ([...pairRanks].some((r) => tripleRanks.has(r))) continue;
      const pairUsesPhoenix = pair.some((c) => c.rank === Rank.Phoenix);
      if (tripleUsesPhoenix && pairUsesPhoenix) continue;
      candidates.push([...triple, ...pair]);
    }
  }
  return candidates;
}

function cardChoices(ranks: readonly Rank[], rankToCards: ReadonlyMap<Rank, Card[]>): Card[][] {
  return cartesianProduct(ranks.map((r) => rankToCards.get(r)!));
}

function straightCandidates(hand: readonly Card[]): Card[][] {
  const [phoenix, reals] = splitPhoenix(hand);
  const byRank = groupByRank(reals, NON_GROUPABLE);
  const positions = [...byRank.keys()].map((r) => STRAIGHT_RANK_ORDER.get(r)!).sort((a, b) => a - b);
  return straightWindows(positions, byRank, phoenix);
}

function straightWindows(
  positions: readonly number[],
  rankToCards: ReadonlyMap<Rank, Card[]>,
  phoenix: Card | null,
): Card[][] {
  const candidates: Card[][] = [];
  const n = positions.length;
  for (let start = 0; start < n; start += 1) {
    for (let end = start; end < n; end += 1) {
      const span = positions[end]! - positions[start]!;
      const count = end - start + 1;
      const gaps = span - (count - 1);
      const windowRanks = positions.slice(start, end + 1).map((p) => STRAIGHT_RANKS[p]!);
      if (gaps === 0) {
        if (count >= 5) {
          candidates.push(...cardChoices(windowRanks, rankToCards));
          if (phoenix !== null) {
            candidates.push(...phoenixSubstitutionChoices(windowRanks, rankToCards, phoenix));
          }
        }
        if (phoenix !== null && count + 1 >= 5) {
          for (const choice of cardChoices(windowRanks, rankToCards)) {
            candidates.push([...choice, phoenix]);
          }
        }
      } else if (gaps === 1 && phoenix !== null && count + 1 >= 5) {
        for (const choice of cardChoices(windowRanks, rankToCards)) {
          candidates.push([...choice, phoenix]);
        }
      }
    }
  }
  return candidates;
}

function phoenixSubstitutionChoices(
  windowRanks: readonly Rank[],
  rankToCards: ReadonlyMap<Rank, Card[]>,
  phoenix: Card,
): Card[][] {
  const candidates: Card[][] = [];
  for (let substituteIndex = 0; substituteIndex < windowRanks.length; substituteIndex += 1) {
    const keptRanks = [...windowRanks.slice(0, substituteIndex), ...windowRanks.slice(substituteIndex + 1)];
    for (const choice of cardChoices(keptRanks, rankToCards)) {
      candidates.push([...choice, phoenix]);
    }
  }
  return candidates;
}

function pairStraightCandidates(hand: readonly Card[]): Card[][] {
  const [phoenix, reals] = splitPhoenix(hand);
  const byRank = groupByRank(reals, new Set([...NON_GROUPABLE, Rank.Mahjong]));

  const fullPairChoices = new Map<Rank, Card[][]>();
  for (const [rank, cards] of byRank) {
    if (cards.length >= 2) fullPairChoices.set(rank, combinationsOf(cards, 2));
  }
  const candidates = pairStraightWindows(fullPairChoices);

  if (phoenix !== null) {
    for (const [wishRank, cards] of byRank) {
      if (cards.length !== 1) continue;
      const combined = new Map(fullPairChoices);
      combined.set(wishRank, [[cards[0]!, phoenix]]);
      candidates.push(...pairStraightWindows(combined, wishRank));
    }
  }
  return candidates;
}

function pairStraightWindows(rankToPairChoices: ReadonlyMap<Rank, Card[][]>, requireRank: Rank | null = null): Card[][] {
  const positions = [...rankToPairChoices.keys()].map((r) => STRAIGHT_RANK_ORDER.get(r)!).sort((a, b) => a - b);
  const candidates: Card[][] = [];
  const n = positions.length;
  for (let start = 0; start < n; start += 1) {
    for (let end = start; end < n; end += 1) {
      if (positions[end]! - positions[start]! !== end - start) continue;
      if (end - start + 1 < 2) continue;
      const windowRanks = positions.slice(start, end + 1).map((p) => STRAIGHT_RANKS[p]!);
      if (requireRank !== null && !windowRanks.includes(requireRank)) continue;
      const choicesPerRank = windowRanks.map((r) => rankToPairChoices.get(r)!);
      for (const pairChoice of cartesianProduct(choicesPerRank)) {
        const cards: Card[] = [];
        for (const pair of pairChoice) cards.push(...pair);
        candidates.push(cards);
      }
    }
  }
  return candidates;
}
