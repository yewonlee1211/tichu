from __future__ import annotations

from itertools import combinations as iter_combinations
from itertools import product
from typing import Sequence

from tichu_env.cards import Card, Rank
from tichu_env.combinations import STRAIGHT_RANK_ORDER, STRAIGHT_RANKS

_NON_GROUPABLE = frozenset({Rank.DOG, Rank.DRAGON})


def candidate_card_sets(hand: Sequence[Card]) -> list[tuple[Card, ...]]:
    """Card-subsets of `hand` worth checking with `identify_combo`.

    A brute-force search of every subset of a 14-card hand is 2**14
    candidates per call, which makes self-play far too slow (a single lead
    with a full hand alone costs 16384 `identify_combo` calls). This builds
    candidates directly from the hand's rank/suit structure instead --
    singles, rank-groupings for pairs/triples/quads/full houses, and
    consecutive-rank runs for straights/pair-straights/straight flushes --
    which stays polynomial in the number of distinct ranks (<=13) and the
    (small, <=4) number of duplicate cards per rank, rather than exponential
    in hand size. Where a rank has multiple physical cards of different
    suits, every choice is enumerated so the result matches a brute-force
    search exactly (see test_legal_moves.py); `identify_combo`/`beats`
    remain the single source of truth for what is actually legal.
    """
    candidates: list[tuple[Card, ...]] = [(card,) for card in hand]
    candidates.extend(_same_rank_candidates(hand))
    candidates.extend(_full_house_candidates(hand))
    candidates.extend(_straight_candidates(hand))
    candidates.extend(_pair_straight_candidates(hand))
    return candidates


def _split_phoenix(hand: Sequence[Card]) -> tuple[Card | None, list[Card]]:
    phoenix = next((c for c in hand if c.rank is Rank.PHOENIX), None)
    reals = [c for c in hand if c.rank is not Rank.PHOENIX]
    return phoenix, reals


def _group_by_rank(cards: Sequence[Card]) -> dict[Rank, list[Card]]:
    groups: dict[Rank, list[Card]] = {}
    for card in cards:
        groups.setdefault(card.rank, []).append(card)
    return groups


def _same_rank_candidates(hand: Sequence[Card]) -> list[tuple[Card, ...]]:
    """Pairs/triples/quads, including every Phoenix-assisted pair/triple."""
    phoenix, reals = _split_phoenix(hand)
    by_rank = _group_by_rank(reals)

    candidates: list[tuple[Card, ...]] = []
    for rank, cards in by_rank.items():
        if rank in _NON_GROUPABLE:
            continue
        for size in (2, 3, 4):
            if len(cards) >= size:
                candidates.extend(iter_combinations(cards, size))
        if phoenix is not None and rank is not Rank.MAHJONG:
            for card in cards:
                candidates.append((card, phoenix))
            if len(cards) >= 2:
                for pair in iter_combinations(cards, 2):
                    candidates.append(pair + (phoenix,))
    return candidates


def _full_house_candidates(hand: Sequence[Card]) -> list[tuple[Card, ...]]:
    same_rank = _same_rank_candidates(hand)
    triples = [c for c in same_rank if len(c) == 3]
    pairs = [c for c in same_rank if len(c) == 2]

    candidates: list[tuple[Card, ...]] = []
    for triple in triples:
        triple_ranks = {c.rank for c in triple if c.rank is not Rank.PHOENIX}
        triple_uses_phoenix = any(c.rank is Rank.PHOENIX for c in triple)
        for pair in pairs:
            pair_ranks = {c.rank for c in pair if c.rank is not Rank.PHOENIX}
            if pair_ranks & triple_ranks:
                continue
            pair_uses_phoenix = any(c.rank is Rank.PHOENIX for c in pair)
            if triple_uses_phoenix and pair_uses_phoenix:
                continue  # only one Phoenix exists
            candidates.append(triple + pair)
    return candidates


def _card_choices(ranks: Sequence[Rank], rank_to_cards: dict[Rank, list[Card]]):
    """Cartesian product of physical-card choices across `ranks`, so a rank
    held in two suits yields a candidate for each suit."""
    return product(*(rank_to_cards[r] for r in ranks))


def _straight_candidates(hand: Sequence[Card]) -> list[tuple[Card, ...]]:
    """Straight (and, via `identify_combo`, straight-flush) candidates.

    Only rank-based windows are built here -- a same-suit run is already one
    of the `product()` choices `_straight_windows` enumerates whenever every
    rank in that window has a card of that suit, so a separate per-suit pass
    would just re-check the same card-sets."""
    phoenix, reals = _split_phoenix(hand)

    by_rank: dict[Rank, list[Card]] = {}
    for card in reals:
        if card.rank in _NON_GROUPABLE:
            continue
        by_rank.setdefault(card.rank, []).append(card)
    positions = sorted(STRAIGHT_RANK_ORDER[r] for r in by_rank)
    return _straight_windows(positions, by_rank, phoenix)


def _straight_windows(
    positions: list[int], rank_to_cards: dict[Rank, list[Card]], phoenix: Card | None
) -> list[tuple[Card, ...]]:
    candidates: list[tuple[Card, ...]] = []
    n = len(positions)
    for start in range(n):
        for end in range(start, n):
            span = positions[end] - positions[start]
            count = end - start + 1
            gaps = span - (count - 1)
            window_ranks = [STRAIGHT_RANKS[p] for p in positions[start : end + 1]]
            if gaps == 0:
                if count >= 5:
                    candidates.extend(_card_choices(window_ranks, rank_to_cards))
                    if phoenix is not None:
                        candidates.extend(_phoenix_substitution_choices(window_ranks, rank_to_cards, phoenix))
                if phoenix is not None and count + 1 >= 5:
                    for choice in _card_choices(window_ranks, rank_to_cards):
                        candidates.append(choice + (phoenix,))
            elif gaps == 1 and phoenix is not None and count + 1 >= 5:
                for choice in _card_choices(window_ranks, rank_to_cards):
                    candidates.append(choice + (phoenix,))
    return candidates


def _phoenix_substitution_choices(
    window_ranks: list[Rank], rank_to_cards: dict[Rank, list[Card]], phoenix: Card
) -> list[tuple[Card, ...]]:
    """For a fully-contiguous window, also let the Phoenix stand in for any
    one rank the player already holds a real card of, keeping that real card
    in hand instead. This is *not* a no-op: whichever physical card ends up
    in the play is the one exposed to whoever wins this trick, and point
    cards (5/10/K, worth +5/+10/+10) score very differently from the
    Phoenix's fixed -25 -- so this is a genuine choice under uncertainty
    about who wins the trick, not a dominated action (see ai/RULES.md)."""
    candidates: list[tuple[Card, ...]] = []
    for substitute_index in range(len(window_ranks)):
        kept_ranks = window_ranks[:substitute_index] + window_ranks[substitute_index + 1 :]
        for choice in _card_choices(kept_ranks, rank_to_cards):
            candidates.append(choice + (phoenix,))
    return candidates


def _pair_straight_candidates(hand: Sequence[Card]) -> list[tuple[Card, ...]]:
    phoenix, reals = _split_phoenix(hand)
    by_rank: dict[Rank, list[Card]] = {}
    for card in reals:
        if card.rank in _NON_GROUPABLE or card.rank is Rank.MAHJONG:
            continue
        by_rank.setdefault(card.rank, []).append(card)

    full_pair_choices = {
        rank: list(iter_combinations(cards, 2)) for rank, cards in by_rank.items() if len(cards) >= 2
    }
    candidates = _pair_straight_windows(full_pair_choices)

    if phoenix is not None:
        half_pair_choices = {
            rank: [(card, phoenix) for card in cards] for rank, cards in by_rank.items() if len(cards) == 1
        }
        for wish_rank, phoenix_pairs in half_pair_choices.items():
            combined = dict(full_pair_choices)
            combined[wish_rank] = phoenix_pairs
            candidates.extend(_pair_straight_windows(combined, require_rank=wish_rank))

    return candidates


def _pair_straight_windows(
    rank_to_pair_choices: dict[Rank, list[tuple[Card, Card]]], require_rank: Rank | None = None
) -> list[tuple[Card, ...]]:
    positions = sorted(STRAIGHT_RANK_ORDER[r] for r in rank_to_pair_choices)
    candidates: list[tuple[Card, ...]] = []
    n = len(positions)
    for start in range(n):
        for end in range(start, n):
            if positions[end] - positions[start] != end - start:
                continue  # pair-straights allow no gaps at all
            if end - start + 1 < 2:
                continue
            window_ranks = [STRAIGHT_RANKS[p] for p in positions[start : end + 1]]
            if require_rank is not None and require_rank not in window_ranks:
                continue
            for pair_choice in product(*(rank_to_pair_choices[r] for r in window_ranks)):
                cards: list[Card] = []
                for pair in pair_choice:
                    cards.extend(pair)
                candidates.append(tuple(cards))
    return candidates
