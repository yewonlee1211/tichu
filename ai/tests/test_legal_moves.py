import random
from itertools import combinations

import pytest

from tichu_env.cards import Card, Rank, Suit, create_deck
from tichu_env.combinations import ComboType, identify_combo
from tichu_env.legal_moves import candidate_card_sets


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def special(rank: Rank) -> Card:
    return Card(rank=rank, suit=Suit.SPECIAL)


def _brute_force_combos(hand: tuple[Card, ...]) -> set[tuple]:
    found: set[tuple] = set()
    for length in range(1, len(hand) + 1):
        for subset in combinations(hand, length):
            combo = identify_combo(subset)
            if combo is not None:
                found.add(_combo_key(combo, subset))
    return found


def _fast_combos(hand: tuple[Card, ...]) -> set[tuple]:
    found: set[tuple] = set()
    seen: set[frozenset[Card]] = set()
    for cards in candidate_card_sets(hand):
        key = frozenset(cards)
        if key in seen:
            continue
        seen.add(key)
        combo = identify_combo(cards)
        if combo is not None:
            found.add(_combo_key(combo, cards))
    return found


def _combo_key(combo, cards) -> tuple:
    # Full physical-card-set equality: which exact cards a play uses is not
    # a cosmetic detail here, since whichever card stays in hand afterward
    # can differ in point value (e.g. a real 5 vs. the Phoenix used in its
    # place), so every distinct physical action must be reachable.
    return (combo.combo_type, frozenset(cards))


@pytest.mark.parametrize("seed", range(30))
def test_fast_candidate_generation_matches_brute_force(seed: int):
    rng = random.Random(seed)
    deck = list(create_deck())
    rng.shuffle(deck)
    hand_size = rng.randint(1, 14)
    hand = tuple(deck[:hand_size])

    assert _fast_combos(hand) == _brute_force_combos(hand)


def test_fast_candidate_generation_matches_brute_force_on_full_starting_hand():
    rng = random.Random(42)
    deck = list(create_deck())
    rng.shuffle(deck)
    hand = tuple(deck[:14])

    assert _fast_combos(hand) == _brute_force_combos(hand)


def test_phoenix_can_substitute_for_a_rank_already_held_as_a_real_card():
    # Player holds a real Five *and* the Phoenix, plus enough for a 3-4-5-6-7
    # straight. Playing 3-4-Phoenix(as 5)-6-7 and keeping the real Five is a
    # genuinely different, legal action from playing the real Five and
    # keeping the Phoenix -- not a dominated no-op (see RULES.md 5.7).
    hand = (
        card(Rank.THREE),
        card(Rank.FOUR),
        card(Rank.FIVE),
        card(Rank.SIX),
        card(Rank.SEVEN),
        special(Rank.PHOENIX),
    )

    combos_using_phoenix_for_five = [
        cards
        for cards in candidate_card_sets(hand)
        if identify_combo(cards) is not None
        and identify_combo(cards).combo_type is ComboType.STRAIGHT
        and len(cards) == 5
        and special(Rank.PHOENIX) in cards
        and card(Rank.FIVE) not in cards
    ]

    assert len(combos_using_phoenix_for_five) >= 1
