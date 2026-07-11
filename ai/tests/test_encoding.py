import numpy as np
import pytest

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import ComboType, identify_combo
from tichu_env.encoding import (
    ACTION_DIM,
    OBS_DIM,
    encode_action,
    encode_legal_actions,
    encode_observation,
)
from tichu_env.state import NUM_PLAYERS, GameState, Phase


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def make_state(hands: dict[int, list[Card]], **overrides) -> GameState:
    base = dict(
        hands=tuple(tuple(hands.get(i, [])) for i in range(NUM_PLAYERS)),
        pending_final_cards=tuple(() for _ in range(NUM_PLAYERS)),
        phase=Phase.PLAYING,
        current_player=0,
        trick_leader=0,
        trick_cards=(),
        current_best=None,
        current_strength=0.0,
        last_player_to_act=None,
        passes_in_a_row=0,
        finished_order=(),
        collected_tricks=tuple(() for _ in range(NUM_PLAYERS)),
        large_tichu_calls=(True, True, True, True),
        tichu_calls=(False, False, False, False),
        mahjong_wish=None,
    )
    base.update(overrides)
    return GameState(**base)


# ---------------------------------------------------------------------------
# Observation encoding
# ---------------------------------------------------------------------------


def test_encode_observation_has_fixed_shape_and_dtype():
    state = make_state({0: [card(Rank.FIVE)]})

    obs = encode_observation(state, player=0)

    assert obs.shape == (OBS_DIM,)
    assert obs.dtype == np.float32


def test_encode_observation_reflects_own_hand_size():
    state = make_state({0: [card(Rank.FIVE), card(Rank.SIX), card(Rank.SEVEN)]})

    obs = encode_observation(state, player=0)

    assert obs[:56].sum() == 3


def test_encode_observation_does_not_leak_opponent_hand_contents():
    # Same hand *sizes* for every seat, but seat 1's exact cards differ between
    # the two states. From seat 0's perspective these must be indistinguishable.
    state_a = make_state({0: [card(Rank.FIVE)], 1: [card(Rank.SIX)], 2: [card(Rank.SEVEN)], 3: [card(Rank.EIGHT)]})
    state_b = make_state({0: [card(Rank.FIVE)], 1: [card(Rank.KING)], 2: [card(Rank.SEVEN)], 3: [card(Rank.EIGHT)]})

    obs_a = encode_observation(state_a, player=0)
    obs_b = encode_observation(state_b, player=0)

    np.testing.assert_array_equal(obs_a, obs_b)


def test_encode_observation_differs_when_own_hand_differs():
    state_a = make_state({0: [card(Rank.FIVE)]})
    state_b = make_state({0: [card(Rank.KING)]})

    obs_a = encode_observation(state_a, player=0)
    obs_b = encode_observation(state_b, player=0)

    assert not np.array_equal(obs_a, obs_b)


def test_encode_observation_uses_seat_relative_encoding():
    # current_player = seat 2, which is the partner (offset 2) from seat 0's
    # perspective, but the *next opponent* (offset 1) from seat 1's perspective.
    state = make_state({}, current_player=2)

    obs_from_seat_0 = encode_observation(state, player=0)
    obs_from_seat_1 = encode_observation(state, player=1)

    assert not np.array_equal(obs_from_seat_0, obs_from_seat_1)


def test_encode_observation_marks_no_current_best_when_leading():
    state = make_state({0: [card(Rank.FIVE)]}, current_best=None)

    obs = encode_observation(state, player=0)

    # The "has current best" flag is the first element of the current-best block,
    # located right after own-hand(56) + trick-cards(56) + points(4) + hand-sizes(4).
    flag_index = 56 + 56 + 4 + 4
    assert obs[flag_index] == 0.0


def test_encode_observation_flags_current_best_when_present():
    combo = identify_combo([card(Rank.FIVE)])
    state = make_state({0: [card(Rank.FIVE)]}, current_best=combo, current_strength=5.0)

    obs = encode_observation(state, player=0)

    flag_index = 56 + 56 + 4 + 4
    assert obs[flag_index] == 1.0


# ---------------------------------------------------------------------------
# Action encoding
# ---------------------------------------------------------------------------


def test_encode_action_for_pass_sets_only_the_pass_flag():
    vec = encode_action(None)

    assert vec.shape == (ACTION_DIM,)
    assert vec[-1] == 1.0
    assert vec[:-1].sum() == 0.0


def test_encode_action_for_combo_sets_card_bits_and_type():
    combo = identify_combo([card(Rank.FIVE), card(Rank.FIVE, Suit.JADE)])

    vec = encode_action(combo)

    assert vec[-1] == 0.0  # not a pass
    assert vec[:56].sum() == 2  # two cards used


def test_encode_legal_actions_includes_pass_only_when_following():
    leading_state = make_state({0: [card(Rank.FIVE)]}, current_player=0, trick_leader=0, current_best=None)
    following_state = make_state(
        {0: [card(Rank.SEVEN)], 1: [card(Rank.NINE)]},
        current_player=1,
        trick_leader=0,
        current_best=identify_combo([card(Rank.SEVEN)]),
        current_strength=7.0,
    )

    leading_actions = encode_legal_actions(leading_state, player=0)
    following_actions = encode_legal_actions(following_state, player=1)

    assert all(combo is not None for combo, _ in leading_actions)
    assert any(combo is None for combo, _ in following_actions)


def test_encode_legal_actions_never_offers_pass_to_a_non_turn_player():
    # Player 2 holds a card but it isn't their turn and they have no bomb,
    # so they should have no legal actions at all -- and in particular no
    # spurious PASS (pass_turn() would reject it: only the current player
    # may pass).
    state = make_state(
        {0: [card(Rank.SEVEN)], 1: [card(Rank.NINE)], 2: [card(Rank.KING)]},
        current_player=1,
        trick_leader=0,
        current_best=identify_combo([card(Rank.SEVEN)]),
        current_strength=7.0,
    )

    actions = encode_legal_actions(state, player=2)

    assert actions == []
