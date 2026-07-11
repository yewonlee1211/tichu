import random

import pytest

from tichu_env.cards import Card, Rank, Suit, create_deck, shuffled_deck


def test_deck_has_56_unique_cards():
    # Arrange / Act
    deck = create_deck()

    # Assert
    assert len(deck) == 56
    assert len(set(deck)) == 56


def test_deck_has_four_special_cards():
    # Arrange / Act
    deck = create_deck()
    special_ranks = {card.rank for card in deck if card.is_special}

    # Assert
    assert special_ranks == {Rank.DOG, Rank.MAHJONG, Rank.PHOENIX, Rank.DRAGON}


def test_deck_has_13_ranks_across_4_suits():
    # Arrange / Act
    deck = create_deck()
    normal_cards = [card for card in deck if not card.is_special]

    # Assert
    assert len(normal_cards) == 52
    for suit in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR):
        ranks_in_suit = {card.rank for card in normal_cards if card.suit == suit}
        assert len(ranks_in_suit) == 13


def test_shuffled_deck_is_reproducible_with_same_seed():
    # Arrange
    rng_a = random.Random(42)
    rng_b = random.Random(42)

    # Act
    deck_a = shuffled_deck(rng_a)
    deck_b = shuffled_deck(rng_b)

    # Assert
    assert deck_a == deck_b


def test_shuffled_deck_contains_same_cards_as_ordered_deck():
    # Arrange / Act
    ordered = set(create_deck())
    shuffled = set(shuffled_deck(random.Random(1)))

    # Assert
    assert ordered == shuffled


@pytest.mark.parametrize(
    "rank,expected_points",
    [
        (Rank.FIVE, 5),
        (Rank.TEN, 10),
        (Rank.KING, 10),
        (Rank.DRAGON, 25),
        (Rank.PHOENIX, -25),
        (Rank.DOG, 0),
        (Rank.MAHJONG, 0),
        (Rank.ACE, 0),
        (Rank.THREE, 0),
    ],
)
def test_card_point_values(rank, expected_points):
    # Arrange
    special_ranks = {Rank.DOG, Rank.MAHJONG, Rank.PHOENIX, Rank.DRAGON}
    suit = Suit.SPECIAL if rank in special_ranks else Suit.SWORD
    card = Card(rank=rank, suit=suit)

    # Act / Assert
    assert card.point_value == expected_points
