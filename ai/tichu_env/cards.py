from __future__ import annotations

import random
from dataclasses import dataclass
from enum import Enum


class Suit(Enum):
    SWORD = "sword"
    PAGODA = "pagoda"
    JADE = "jade"
    STAR = "star"
    SPECIAL = "special"


class Rank(Enum):
    DOG = 0
    MAHJONG = 1
    TWO = 2
    THREE = 3
    FOUR = 4
    FIVE = 5
    SIX = 6
    SEVEN = 7
    EIGHT = 8
    NINE = 9
    TEN = 10
    JACK = 11
    QUEEN = 12
    KING = 13
    ACE = 14
    PHOENIX = 15
    DRAGON = 16


SPECIAL_RANKS = frozenset({Rank.DOG, Rank.MAHJONG, Rank.PHOENIX, Rank.DRAGON})
NUMERIC_RANKS = tuple(rank for rank in Rank if rank not in SPECIAL_RANKS)

_POINT_VALUES: dict[Rank, int] = {
    Rank.FIVE: 5,
    Rank.TEN: 10,
    Rank.KING: 10,
    Rank.DRAGON: 25,
    Rank.PHOENIX: -25,
}


@dataclass(frozen=True)
class Card:
    rank: Rank
    suit: Suit

    @property
    def is_special(self) -> bool:
        return self.rank in SPECIAL_RANKS

    @property
    def point_value(self) -> int:
        return _POINT_VALUES.get(self.rank, 0)


def create_deck() -> tuple[Card, ...]:
    normal_cards = tuple(
        Card(rank=rank, suit=suit)
        for suit in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)
        for rank in NUMERIC_RANKS
    )
    special_cards = tuple(
        Card(rank=rank, suit=Suit.SPECIAL)
        for rank in (Rank.DOG, Rank.MAHJONG, Rank.PHOENIX, Rank.DRAGON)
    )
    return normal_cards + special_cards


def shuffled_deck(rng: random.Random | None = None) -> list[Card]:
    rng = rng if rng is not None else random.Random()
    deck = list(create_deck())
    rng.shuffle(deck)
    return deck
