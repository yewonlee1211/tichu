import pytest

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import ComboType, beats, effective_strength, identify_combo


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def special(rank: Rank) -> Card:
    return Card(rank=rank, suit=Suit.SPECIAL)


# ---------------------------------------------------------------------------
# Single
# ---------------------------------------------------------------------------


def test_single_normal_card():
    combo = identify_combo([card(Rank.KING)])

    assert combo.combo_type is ComboType.SINGLE
    assert combo.rank_strength == Rank.KING.value


def test_single_dog_is_its_own_combo_type():
    combo = identify_combo([special(Rank.DOG)])

    assert combo.combo_type is ComboType.DOG


def test_single_phoenix_is_marked_lone_phoenix():
    combo = identify_combo([special(Rank.PHOENIX)])

    assert combo.combo_type is ComboType.SINGLE
    assert combo.is_lone_phoenix is True


# ---------------------------------------------------------------------------
# Pair
# ---------------------------------------------------------------------------


def test_pair_same_rank():
    combo = identify_combo([card(Rank.SEVEN, Suit.SWORD), card(Rank.SEVEN, Suit.JADE)])

    assert combo.combo_type is ComboType.PAIR
    assert combo.rank_strength == Rank.SEVEN.value


def test_pair_with_phoenix_substitute():
    combo = identify_combo([card(Rank.NINE), special(Rank.PHOENIX)])

    assert combo.combo_type is ComboType.PAIR
    assert combo.rank_strength == Rank.NINE.value


def test_pair_of_different_ranks_is_invalid():
    assert identify_combo([card(Rank.SEVEN), card(Rank.EIGHT)]) is None


def test_pair_of_dragon_is_invalid_even_with_phoenix():
    assert identify_combo([special(Rank.DRAGON), special(Rank.PHOENIX)]) is None


def test_pair_of_mahjong_is_invalid_even_with_phoenix():
    assert identify_combo([special(Rank.MAHJONG), special(Rank.PHOENIX)]) is None


# ---------------------------------------------------------------------------
# Triple
# ---------------------------------------------------------------------------


def test_triple_same_rank():
    combo = identify_combo(
        [card(Rank.FOUR, Suit.SWORD), card(Rank.FOUR, Suit.JADE), card(Rank.FOUR, Suit.STAR)]
    )

    assert combo.combo_type is ComboType.TRIPLE
    assert combo.rank_strength == Rank.FOUR.value


def test_triple_with_phoenix_substitute():
    combo = identify_combo(
        [card(Rank.FOUR, Suit.SWORD), card(Rank.FOUR, Suit.JADE), special(Rank.PHOENIX)]
    )

    assert combo.combo_type is ComboType.TRIPLE
    assert combo.rank_strength == Rank.FOUR.value


# ---------------------------------------------------------------------------
# Full house
# ---------------------------------------------------------------------------


def test_full_house_without_phoenix():
    cards = [
        card(Rank.FIVE, Suit.SWORD),
        card(Rank.FIVE, Suit.JADE),
        card(Rank.FIVE, Suit.STAR),
        card(Rank.NINE, Suit.SWORD),
        card(Rank.NINE, Suit.JADE),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.FULL_HOUSE
    assert combo.rank_strength == Rank.FIVE.value


def test_full_house_phoenix_completes_the_pair():
    cards = [
        card(Rank.FIVE, Suit.SWORD),
        card(Rank.FIVE, Suit.JADE),
        card(Rank.FIVE, Suit.STAR),
        card(Rank.NINE, Suit.SWORD),
        special(Rank.PHOENIX),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.FULL_HOUSE
    assert combo.rank_strength == Rank.FIVE.value


def test_full_house_phoenix_with_two_pairs_prefers_higher_rank_as_triple():
    cards = [
        card(Rank.FIVE, Suit.SWORD),
        card(Rank.FIVE, Suit.JADE),
        card(Rank.NINE, Suit.SWORD),
        card(Rank.NINE, Suit.JADE),
        special(Rank.PHOENIX),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.FULL_HOUSE
    assert combo.rank_strength == Rank.NINE.value


def test_full_house_rejects_phoenix_substituting_for_mahjong():
    cards = [
        card(Rank.FIVE, Suit.SWORD),
        card(Rank.FIVE, Suit.JADE),
        card(Rank.FIVE, Suit.STAR),
        special(Rank.MAHJONG),
        special(Rank.PHOENIX),
    ]

    assert identify_combo(cards) is None


# ---------------------------------------------------------------------------
# Straight
# ---------------------------------------------------------------------------


def test_straight_from_mahjong():
    cards = [
        special(Rank.MAHJONG),
        card(Rank.TWO),
        card(Rank.THREE),
        card(Rank.FOUR),
        card(Rank.FIVE),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.STRAIGHT
    assert combo.length == 5
    assert combo.rank_strength == Rank.FIVE.value


def test_straight_with_phoenix_filling_internal_gap():
    cards = [
        card(Rank.THREE),
        card(Rank.FOUR),
        card(Rank.SIX),
        card(Rank.SEVEN),
        special(Rank.PHOENIX),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.STRAIGHT
    assert combo.rank_strength == Rank.SEVEN.value


def test_straight_with_phoenix_extends_upward_when_not_at_top():
    cards = [
        card(Rank.THREE),
        card(Rank.FOUR),
        card(Rank.FIVE),
        card(Rank.SIX),
        special(Rank.PHOENIX),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.STRAIGHT
    assert combo.rank_strength == Rank.SEVEN.value


def test_straight_with_phoenix_extends_downward_at_ace_boundary():
    cards = [
        card(Rank.JACK),
        card(Rank.QUEEN),
        card(Rank.KING),
        card(Rank.ACE),
        special(Rank.PHOENIX),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.STRAIGHT
    assert combo.rank_strength == Rank.ACE.value


def test_straight_cannot_contain_dragon():
    cards = [
        card(Rank.THREE),
        card(Rank.FOUR),
        card(Rank.FIVE),
        card(Rank.SIX),
        special(Rank.DRAGON),
    ]

    assert identify_combo(cards) is None


def test_non_consecutive_cards_are_not_a_straight():
    cards = [card(Rank.THREE), card(Rank.FOUR), card(Rank.FIVE), card(Rank.SIX), card(Rank.EIGHT)]

    assert identify_combo(cards) is None


# ---------------------------------------------------------------------------
# Pair straight (stairs)
# ---------------------------------------------------------------------------


def test_pair_straight_two_pairs():
    cards = [
        card(Rank.THREE, Suit.SWORD),
        card(Rank.THREE, Suit.JADE),
        card(Rank.FOUR, Suit.SWORD),
        card(Rank.FOUR, Suit.JADE),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.PAIR_STRAIGHT
    assert combo.rank_strength == Rank.FOUR.value


def test_pair_straight_with_phoenix_completing_one_pair():
    cards = [
        card(Rank.THREE, Suit.SWORD),
        card(Rank.THREE, Suit.JADE),
        card(Rank.FOUR, Suit.SWORD),
        special(Rank.PHOENIX),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.PAIR_STRAIGHT
    assert combo.rank_strength == Rank.FOUR.value


def test_pair_straight_rejects_non_consecutive_pairs():
    cards = [
        card(Rank.THREE, Suit.SWORD),
        card(Rank.THREE, Suit.JADE),
        card(Rank.SIX, Suit.SWORD),
        card(Rank.SIX, Suit.JADE),
    ]

    assert identify_combo(cards) is None


# ---------------------------------------------------------------------------
# Bombs
# ---------------------------------------------------------------------------


def test_bomb_quad():
    cards = [
        card(Rank.EIGHT, Suit.SWORD),
        card(Rank.EIGHT, Suit.PAGODA),
        card(Rank.EIGHT, Suit.JADE),
        card(Rank.EIGHT, Suit.STAR),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.BOMB_QUAD
    assert combo.rank_strength == Rank.EIGHT.value


def test_bomb_quad_cannot_use_phoenix():
    cards = [
        card(Rank.EIGHT, Suit.SWORD),
        card(Rank.EIGHT, Suit.PAGODA),
        card(Rank.EIGHT, Suit.JADE),
        special(Rank.PHOENIX),
    ]

    assert identify_combo(cards) is None


def test_bomb_straight_flush():
    cards = [
        card(Rank.THREE, Suit.SWORD),
        card(Rank.FOUR, Suit.SWORD),
        card(Rank.FIVE, Suit.SWORD),
        card(Rank.SIX, Suit.SWORD),
        card(Rank.SEVEN, Suit.SWORD),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.BOMB_STRAIGHT_FLUSH
    assert combo.length == 5
    assert combo.rank_strength == Rank.SEVEN.value


def test_bomb_straight_flush_cannot_use_phoenix():
    cards = [
        card(Rank.THREE, Suit.SWORD),
        card(Rank.FOUR, Suit.SWORD),
        card(Rank.FIVE, Suit.SWORD),
        card(Rank.SIX, Suit.SWORD),
        special(Rank.PHOENIX),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is not ComboType.BOMB_STRAIGHT_FLUSH


def test_mixed_suit_five_cards_is_plain_straight_not_flush():
    cards = [
        card(Rank.THREE, Suit.SWORD),
        card(Rank.FOUR, Suit.PAGODA),
        card(Rank.FIVE, Suit.SWORD),
        card(Rank.SIX, Suit.SWORD),
        card(Rank.SEVEN, Suit.SWORD),
    ]

    combo = identify_combo(cards)

    assert combo.combo_type is ComboType.STRAIGHT


# ---------------------------------------------------------------------------
# beats()
# ---------------------------------------------------------------------------


def test_bomb_beats_non_bomb_regardless_of_type():
    bomb = identify_combo(
        [
            card(Rank.THREE, Suit.SWORD),
            card(Rank.THREE, Suit.PAGODA),
            card(Rank.THREE, Suit.JADE),
            card(Rank.THREE, Suit.STAR),
        ]
    )
    dragon_single = identify_combo([special(Rank.DRAGON)])

    assert beats(bomb, dragon_single, effective_strength(dragon_single, None)) is True


def test_straight_flush_beats_quad_bomb_regardless_of_rank():
    quad_ace = identify_combo(
        [
            card(Rank.ACE, Suit.SWORD),
            card(Rank.ACE, Suit.PAGODA),
            card(Rank.ACE, Suit.JADE),
            card(Rank.ACE, Suit.STAR),
        ]
    )
    low_straight_flush = identify_combo(
        [
            card(Rank.THREE, Suit.SWORD),
            card(Rank.FOUR, Suit.SWORD),
            card(Rank.FIVE, Suit.SWORD),
            card(Rank.SIX, Suit.SWORD),
            card(Rank.SEVEN, Suit.SWORD),
        ]
    )

    assert beats(low_straight_flush, quad_ace, quad_ace.rank_strength) is True
    assert beats(quad_ace, low_straight_flush, low_straight_flush.rank_strength) is False


def test_quad_vs_quad_compares_rank():
    low = identify_combo(
        [card(Rank.THREE, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)]
    )
    high = identify_combo(
        [card(Rank.NINE, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)]
    )

    assert beats(high, low, low.rank_strength) is True
    assert beats(low, high, high.rank_strength) is False


def test_straight_flush_longer_beats_shorter_regardless_of_rank():
    short_high = identify_combo(
        [
            card(Rank.NINE, Suit.SWORD),
            card(Rank.TEN, Suit.SWORD),
            card(Rank.JACK, Suit.SWORD),
            card(Rank.QUEEN, Suit.SWORD),
            card(Rank.KING, Suit.SWORD),
        ]
    )
    long_low = identify_combo(
        [
            card(Rank.TWO, Suit.SWORD),
            card(Rank.THREE, Suit.SWORD),
            card(Rank.FOUR, Suit.SWORD),
            card(Rank.FIVE, Suit.SWORD),
            card(Rank.SIX, Suit.SWORD),
            card(Rank.SEVEN, Suit.SWORD),
        ]
    )

    assert beats(long_low, short_high, short_high.rank_strength) is True


def test_same_type_and_length_compares_rank():
    low = identify_combo([card(Rank.FOUR, Suit.SWORD), card(Rank.FOUR, Suit.JADE)])
    high = identify_combo([card(Rank.NINE, Suit.SWORD), card(Rank.NINE, Suit.JADE)])

    assert beats(high, low, low.rank_strength) is True
    assert beats(low, high, high.rank_strength) is False


def test_mismatched_type_or_length_never_beats():
    pair = identify_combo([card(Rank.FOUR, Suit.SWORD), card(Rank.FOUR, Suit.JADE)])
    triple = identify_combo(
        [card(Rank.NINE, Suit.SWORD), card(Rank.NINE, Suit.JADE), card(Rank.NINE, Suit.STAR)]
    )

    assert beats(pair, triple, triple.rank_strength) is False


def test_dragon_single_beats_king_single():
    dragon = identify_combo([special(Rank.DRAGON)])
    king = identify_combo([card(Rank.KING)])

    assert beats(dragon, king, king.rank_strength) is True


def test_phoenix_single_beats_a_plain_single():
    phoenix = identify_combo([special(Rank.PHOENIX)])
    queen = identify_combo([card(Rank.QUEEN)])

    assert beats(phoenix, queen, queen.rank_strength) is True


def test_phoenix_single_can_never_beat_dragon():
    phoenix = identify_combo([special(Rank.PHOENIX)])
    dragon = identify_combo([special(Rank.DRAGON)])

    assert beats(phoenix, dragon, dragon.rank_strength) is False


def test_effective_strength_of_lone_phoenix_when_leading_is_half():
    phoenix = identify_combo([special(Rank.PHOENIX)])

    assert effective_strength(phoenix, None) == 0.5


def test_effective_strength_of_lone_phoenix_when_following_beats_by_half_point():
    phoenix = identify_combo([special(Rank.PHOENIX)])

    assert effective_strength(phoenix, 10.0) == 10.5
