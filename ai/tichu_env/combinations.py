from __future__ import annotations

from collections import Counter
from dataclasses import dataclass
from enum import Enum
from typing import Sequence

from tichu_env.cards import NUMERIC_RANKS, Card, Rank, Suit


class ComboType(Enum):
    SINGLE = "single"
    DOG = "dog"
    PAIR = "pair"
    TRIPLE = "triple"
    FULL_HOUSE = "full_house"
    STRAIGHT = "straight"
    PAIR_STRAIGHT = "pair_straight"
    BOMB_QUAD = "bomb_quad"
    BOMB_STRAIGHT_FLUSH = "bomb_straight_flush"


BOMB_TYPES = frozenset({ComboType.BOMB_QUAD, ComboType.BOMB_STRAIGHT_FLUSH})

# Straight-eligible ranks in ascending order: Mahjong is the lowest, Ace the highest.
# NUMERIC_RANKS already excludes Mahjong (it is one of the SPECIAL_RANKS).
STRAIGHT_RANKS = (Rank.MAHJONG,) + NUMERIC_RANKS
STRAIGHT_RANK_ORDER = {rank: index for index, rank in enumerate(STRAIGHT_RANKS)}

_UNPAIRABLE_RANKS = frozenset({Rank.DOG, Rank.DRAGON})


@dataclass(frozen=True)
class Combo:
    combo_type: ComboType
    cards: tuple[Card, ...]
    length: int
    rank_strength: float
    is_lone_phoenix: bool = False


def identify_combo(cards: Sequence[Card]) -> Combo | None:
    cards = tuple(cards)
    if len(cards) == 0 or len(set(cards)) != len(cards):
        return None
    n = len(cards)
    if n == 1:
        return _single(cards[0])
    if n == 2:
        return _pair(cards)
    if n == 3:
        return _triple(cards)
    if n == 4:
        return _bomb_quad(cards) or _pair_straight(cards)
    if n == 5:
        return _straight_flush(cards) or _straight(cards) or _full_house(cards)
    if n % 2 == 0:
        return _pair_straight(cards) or _straight_flush(cards) or _straight(cards)
    return _straight_flush(cards) or _straight(cards)


def effective_strength(combo: Combo, preceding_strength: float | None) -> float:
    """Strength of `combo` given what it is being compared against.

    Only a lone Phoenix single has context-dependent strength: 0.5 when it
    opens a trick, or half a point above whatever it is beating otherwise.
    Every other combo's strength is fixed at identification time.
    """
    if combo.is_lone_phoenix:
        return 0.5 if preceding_strength is None else preceding_strength + 0.5
    return combo.rank_strength


def beats(challenger: Combo, current: Combo, current_strength: float) -> bool:
    """Whether `challenger` legally beats `current`, which is already on the
    table with resolved strength `current_strength` (as produced by
    `effective_strength`)."""
    if challenger.combo_type is ComboType.DOG or current.combo_type is ComboType.DOG:
        return False
    if challenger.is_lone_phoenix and _is_dragon_single(current):
        return False

    challenger_is_bomb = challenger.combo_type in BOMB_TYPES
    current_is_bomb = current.combo_type in BOMB_TYPES
    if challenger_is_bomb and not current_is_bomb:
        return True
    if current_is_bomb and not challenger_is_bomb:
        return False
    if challenger_is_bomb and current_is_bomb:
        return _bomb_beats(challenger, current)

    if challenger.combo_type != current.combo_type or challenger.length != current.length:
        return False
    return effective_strength(challenger, current_strength) > current_strength


def _is_dragon_single(combo: Combo) -> bool:
    return combo.combo_type is ComboType.SINGLE and combo.cards[0].rank is Rank.DRAGON


def _bomb_beats(challenger: Combo, current: Combo) -> bool:
    if challenger.combo_type == current.combo_type:
        if challenger.combo_type is ComboType.BOMB_STRAIGHT_FLUSH and challenger.length != current.length:
            return challenger.length > current.length
        return challenger.rank_strength > current.rank_strength
    return challenger.combo_type is ComboType.BOMB_STRAIGHT_FLUSH


def _split_phoenix(cards: tuple[Card, ...]) -> tuple[Card | None, list[Card]]:
    phoenix = next((c for c in cards if c.rank is Rank.PHOENIX), None)
    reals = [c for c in cards if c.rank is not Rank.PHOENIX]
    return phoenix, reals


def _single(card: Card) -> Combo:
    if card.rank is Rank.DOG:
        return Combo(ComboType.DOG, (card,), 1, 0.0)
    if card.rank is Rank.PHOENIX:
        return Combo(ComboType.SINGLE, (card,), 1, 0.5, is_lone_phoenix=True)
    return Combo(ComboType.SINGLE, (card,), 1, float(card.rank.value))


def _pair(cards: tuple[Card, ...]) -> Combo | None:
    phoenix, reals = _split_phoenix(cards)
    if phoenix is not None:
        if len(reals) != 1 or reals[0].rank in _UNPAIRABLE_RANKS or reals[0].rank is Rank.MAHJONG:
            return None
        return Combo(ComboType.PAIR, cards, 2, float(reals[0].rank.value))
    ranks = {c.rank for c in cards}
    if len(ranks) != 1:
        return None
    rank = next(iter(ranks))
    if rank in _UNPAIRABLE_RANKS:
        return None
    return Combo(ComboType.PAIR, cards, 2, float(rank.value))


def _triple(cards: tuple[Card, ...]) -> Combo | None:
    phoenix, reals = _split_phoenix(cards)
    if phoenix is not None:
        if len(reals) != 2:
            return None
        ranks = {c.rank for c in reals}
        if len(ranks) != 1:
            return None
        rank = next(iter(ranks))
        if rank in _UNPAIRABLE_RANKS or rank is Rank.MAHJONG:
            return None
        return Combo(ComboType.TRIPLE, cards, 3, float(rank.value))
    ranks = {c.rank for c in cards}
    if len(ranks) != 1:
        return None
    rank = next(iter(ranks))
    if rank in _UNPAIRABLE_RANKS:
        return None
    return Combo(ComboType.TRIPLE, cards, 3, float(rank.value))


def _bomb_quad(cards: tuple[Card, ...]) -> Combo | None:
    if any(c.rank is Rank.PHOENIX for c in cards):
        return None
    ranks = {c.rank for c in cards}
    if len(ranks) != 1:
        return None
    rank = next(iter(ranks))
    if rank in _UNPAIRABLE_RANKS or rank is Rank.MAHJONG:
        return None
    return Combo(ComboType.BOMB_QUAD, cards, 4, float(rank.value))


def _full_house(cards: tuple[Card, ...]) -> Combo | None:
    phoenix, reals = _split_phoenix(cards)
    counts = Counter(c.rank for c in reals)
    if any(rank in _UNPAIRABLE_RANKS or rank is Rank.MAHJONG for rank in counts):
        return None
    if phoenix is None:
        if sorted(counts.values()) != [2, 3]:
            return None
        triple_rank = next(rank for rank, count in counts.items() if count == 3)
        return Combo(ComboType.FULL_HOUSE, cards, 5, float(triple_rank.value))
    if len(reals) != 4:
        return None
    if sorted(counts.values()) == [1, 3]:
        triple_rank = next(rank for rank, count in counts.items() if count == 3)
        return Combo(ComboType.FULL_HOUSE, cards, 5, float(triple_rank.value))
    if sorted(counts.values()) == [2, 2]:
        # Ambiguous which pair the Phoenix completes into a triple; the real
        # rules require the player to declare this. Simplification: complete
        # the higher-ranked pair (most favorable outcome for the player).
        triple_rank = max(counts, key=lambda rank: rank.value)
        return Combo(ComboType.FULL_HOUSE, cards, 5, float(triple_rank.value))
    return None


def _straight(cards: tuple[Card, ...]) -> Combo | None:
    phoenix, reals = _split_phoenix(cards)
    if any(c.rank in _UNPAIRABLE_RANKS for c in reals):
        return None
    real_ranks = [c.rank for c in reals]
    if len(set(real_ranks)) != len(real_ranks):
        return None
    n = len(cards)
    positions = sorted(STRAIGHT_RANK_ORDER[r] for r in real_ranks)

    if phoenix is None:
        if len(positions) != n or positions[-1] - positions[0] != n - 1:
            return None
        return Combo(ComboType.STRAIGHT, cards, n, float(STRAIGHT_RANKS[positions[-1]].value))

    if len(positions) != n - 1:
        return None
    span = positions[-1] - positions[0]
    if span == n - 1:
        # Exactly one internal gap; the real maximum is already the run's top.
        return Combo(ComboType.STRAIGHT, cards, n, float(STRAIGHT_RANKS[positions[-1]].value))
    if span == n - 2:
        # Reals are contiguous and one card short; Phoenix extends an end.
        # Simplification: prefer extending upward unless that would pass Ace.
        if positions[-1] + 1 < len(STRAIGHT_RANKS):
            top_index = positions[-1] + 1
        else:
            top_index = positions[-1]
        return Combo(ComboType.STRAIGHT, cards, n, float(STRAIGHT_RANKS[top_index].value))
    return None


def _pair_straight(cards: tuple[Card, ...]) -> Combo | None:
    n = len(cards)
    if n < 4:
        return None
    num_pairs = n // 2
    phoenix, reals = _split_phoenix(cards)
    if any(c.rank in _UNPAIRABLE_RANKS or c.rank is Rank.MAHJONG for c in reals):
        return None
    counts = Counter(c.rank for c in reals)

    if phoenix is None:
        if len(reals) != n or len(counts) != num_pairs or any(count != 2 for count in counts.values()):
            return None
        positions = sorted(STRAIGHT_RANK_ORDER[r] for r in counts)
        if positions[-1] - positions[0] != num_pairs - 1:
            return None
        return Combo(ComboType.PAIR_STRAIGHT, cards, n, float(STRAIGHT_RANKS[positions[-1]].value))

    if len(reals) != n - 1:
        return None
    singles = [rank for rank, count in counts.items() if count == 1]
    doubles = [rank for rank, count in counts.items() if count == 2]
    if len(singles) != 1 or len(doubles) != num_pairs - 1 or any(c not in (1, 2) for c in counts.values()):
        return None
    positions = sorted(STRAIGHT_RANK_ORDER[r] for r in (*doubles, *singles))
    if positions[-1] - positions[0] != num_pairs - 1:
        return None
    return Combo(ComboType.PAIR_STRAIGHT, cards, n, float(STRAIGHT_RANKS[positions[-1]].value))


def _straight_flush(cards: tuple[Card, ...]) -> Combo | None:
    if any(c.suit is Suit.SPECIAL for c in cards):
        return None
    suits = {c.suit for c in cards}
    if len(suits) != 1:
        return None
    ranks = [c.rank for c in cards]
    if len(set(ranks)) != len(ranks):
        return None
    positions = sorted(STRAIGHT_RANK_ORDER[r] for r in ranks)
    if positions[-1] - positions[0] != len(cards) - 1:
        return None
    return Combo(ComboType.BOMB_STRAIGHT_FLUSH, cards, len(cards), float(STRAIGHT_RANKS[positions[-1]].value))
