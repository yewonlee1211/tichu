from tichu_env.cards import Card, Rank, Suit
from tichu_env.env import _auto_exchange
from tichu_env.state import NUM_PLAYERS, GameState, Phase


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def special(rank: Rank) -> Card:
    return Card(rank=rank, suit=Suit.SPECIAL)


def _filler_hand(suit: Suit) -> list[Card]:
    """A generic 4-card hand for seats whose exchange decision isn't under
    test -- _auto_exchange runs for all 4 seats every call, so they need
    enough cards to not blow up, even though the test only asserts on seat 0."""
    return [card(Rank.TWO, suit), card(Rank.FOUR, suit), card(Rank.SIX, suit), card(Rank.EIGHT, suit)]


def make_exchange_state(hands: dict[int, list[Card]], large_tichu_calls=(False, False, False, False)) -> GameState:
    # exchange_cards() picks whoever holds the Mahjong post-exchange as the
    # next trick leader, so some hand must hold one -- park it on seat 3's
    # filler hand, since it's excluded from being given away either way and
    # no test asserts on seat 3's outcome.
    defaults = {
        1: _filler_hand(Suit.PAGODA),
        2: _filler_hand(Suit.JADE),
        3: _filler_hand(Suit.STAR) + [special(Rank.MAHJONG)],
    }
    merged = {**defaults, **hands}
    full_hands = tuple(tuple(merged.get(i, [])) for i in range(NUM_PLAYERS))
    return GameState(
        hands=full_hands,
        pending_final_cards=tuple(() for _ in range(NUM_PLAYERS)),
        phase=Phase.EXCHANGE,
        current_player=0,
        trick_leader=0,
        trick_cards=(),
        current_best=None,
        current_strength=0.0,
        last_player_to_act=None,
        passes_in_a_row=0,
        finished_order=(),
        collected_tricks=tuple(() for _ in range(NUM_PLAYERS)),
        large_tichu_calls=large_tichu_calls,
        tichu_calls=(False, False, False, False),
        mahjong_wish=None,
    )


# Seats: 0's partner is 2, opponents are 1 and 3 (see PARTNER in state.py).


def test_default_gives_two_lowest_cards_to_opponents_and_highest_to_partner():
    hand0 = [card(Rank.THREE), card(Rank.SEVEN), card(Rank.KING)]
    state = make_exchange_state({0: hand0})

    result = _auto_exchange(state)

    assert result.received_from[1][0] == card(Rank.THREE)
    assert result.received_from[3][0] == card(Rank.SEVEN)
    assert result.received_from[2][0] == card(Rank.KING)


def test_mahjong_is_never_given_away_even_when_it_is_the_lowest_card():
    hand0 = [special(Rank.MAHJONG), card(Rank.THREE), card(Rank.SEVEN), card(Rank.KING)]
    state = make_exchange_state({0: hand0})

    result = _auto_exchange(state)

    given_away = {result.received_from[1][0], result.received_from[2][0], result.received_from[3][0]}
    assert special(Rank.MAHJONG) not in given_away
    assert special(Rank.MAHJONG) in result.hands[0]


def test_phoenix_is_preferred_over_a_numbered_card_for_the_partner_gift():
    hand0 = [card(Rank.THREE), card(Rank.SEVEN), card(Rank.KING), special(Rank.PHOENIX)]
    state = make_exchange_state({0: hand0})

    result = _auto_exchange(state)

    assert result.received_from[2][0] == special(Rank.PHOENIX)


def test_dragon_is_preferred_over_a_numbered_card_for_the_partner_gift_when_no_phoenix_held():
    hand0 = [card(Rank.THREE), card(Rank.SEVEN), card(Rank.KING), special(Rank.DRAGON)]
    state = make_exchange_state({0: hand0})

    result = _auto_exchange(state)

    assert result.received_from[2][0] == special(Rank.DRAGON)


def test_phoenix_is_preferred_over_dragon_for_the_partner_gift_when_both_are_held():
    hand0 = [card(Rank.THREE), special(Rank.DRAGON), special(Rank.PHOENIX)]
    state = make_exchange_state({0: hand0})

    result = _auto_exchange(state)

    assert result.received_from[2][0] == special(Rank.PHOENIX)


def test_dog_defaults_to_being_treated_as_the_lowest_card_given_to_an_opponent():
    hand0 = [special(Rank.DOG), card(Rank.THREE), card(Rank.SEVEN), card(Rank.KING)]
    state = make_exchange_state({0: hand0})

    result = _auto_exchange(state)

    opponent_cards = {result.received_from[1][0], result.received_from[3][0]}
    assert special(Rank.DOG) in opponent_cards


def test_giver_who_called_large_tichu_gives_partner_a_low_card_instead_of_the_best_card():
    hand0 = [card(Rank.THREE), card(Rank.FOUR), card(Rank.SEVEN), special(Rank.DRAGON)]
    state = make_exchange_state(
        {0: hand0},
        large_tichu_calls=(True, False, False, False),
    )

    result = _auto_exchange(state)

    assert result.received_from[2][0] == card(Rank.THREE)
    assert special(Rank.DRAGON) not in result.received_from[2].values()
    assert special(Rank.DRAGON) in result.hands[0]


def test_giver_who_called_large_tichu_gives_the_dog_to_partner_when_held():
    hand0 = [special(Rank.DOG), card(Rank.THREE), card(Rank.SEVEN), card(Rank.KING)]
    state = make_exchange_state(
        {0: hand0},
        large_tichu_calls=(True, False, False, False),
    )

    result = _auto_exchange(state)

    assert result.received_from[2][0] == special(Rank.DOG)


def test_giver_whose_partner_called_large_tichu_keeps_the_dog_and_gives_the_next_lowest_card_to_the_opponent():
    hand0 = [special(Rank.DOG), card(Rank.THREE), card(Rank.SEVEN), card(Rank.KING)]
    state = make_exchange_state(
        {0: hand0},
        large_tichu_calls=(False, False, True, False),
    )

    result = _auto_exchange(state)

    given_away = {result.received_from[1][0], result.received_from[2][0], result.received_from[3][0]}
    assert special(Rank.DOG) not in given_away
    assert special(Rank.DOG) in result.hands[0]
    assert card(Rank.THREE) in given_away
