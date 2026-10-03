import numpy as np
import pytest

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import ComboType, identify_combo
from tichu_env.encoding import (
    ACTION_DIM,
    CARD_INDEX,
    NUM_CARDS,
    OBS_DIM,
    _CURRENT_BEST_DIM,
    _EXCHANGE_RECEIVED_DIM,
    _LAST_PLAYER_DIM,
    _NUM_TICHU_STATUSES,
    _PASSES_DIM,
    _PHASE_DIM,
    _REMAINING_TO_WIN_DIM,
    _TICHU_STATUS_DECLINED,
    _TICHU_STATUS_DIM,
    _TICHU_STATUS_GRAND_TICHU,
    _TICHU_STATUS_TICHU,
    _TICHU_STATUS_UNDECIDED,
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
        tichu_decided=(True, True, True, True),
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


def test_encode_observation_differs_by_phase():
    state_playing = make_state({0: [card(Rank.FIVE)]}, phase=Phase.PLAYING)
    state_exchange = make_state({0: [card(Rank.FIVE)]}, phase=Phase.EXCHANGE)

    obs_playing = encode_observation(state_playing, player=0)
    obs_exchange = encode_observation(state_exchange, player=0)

    assert not np.array_equal(obs_playing, obs_exchange)


def test_encode_observation_phase_block_is_one_hot():
    state = make_state({0: [card(Rank.FIVE)]}, phase=Phase.EXCHANGE)

    obs = encode_observation(state, player=0)

    end = OBS_DIM - _PASSES_DIM - _EXCHANGE_RECEIVED_DIM
    phase_block = obs[end - _PHASE_DIM : end]

    assert phase_block.sum() == 1.0


def test_encode_observation_distinguishes_undecided_from_declined_large_tichu():
    # bool | None: an opponent who hasn't decided yet (None) must not look
    # identical to one who has already declined (False) -- both used to
    # collapse to the same 0.0, hiding real information during the
    # LARGE_TICHU decision phase.
    state_undecided = make_state(
        {0: [card(Rank.FIVE)]}, phase=Phase.LARGE_TICHU, large_tichu_calls=(None, True, True, True)
    )
    state_declined = make_state(
        {0: [card(Rank.FIVE)]}, phase=Phase.LARGE_TICHU, large_tichu_calls=(False, True, True, True)
    )

    obs_undecided = encode_observation(state_undecided, player=0)
    obs_declined = encode_observation(state_declined, player=0)

    assert not np.array_equal(obs_undecided, obs_declined)


_TICHU_STATUS_START = (
    NUM_CARDS  # own hand
    + NUM_CARDS  # trick cards
    + NUM_PLAYERS  # collected points
    + NUM_PLAYERS  # hand sizes
    + _CURRENT_BEST_DIM
    + NUM_PLAYERS  # current player
    + NUM_PLAYERS  # trick leader
    + _LAST_PLAYER_DIM
)


def _tichu_status_block(obs: np.ndarray) -> np.ndarray:
    return obs[_TICHU_STATUS_START : _TICHU_STATUS_START + _TICHU_STATUS_DIM]


def test_encode_observation_tichu_status_is_one_hot_per_seat_from_own_perspective():
    # seat0 (self): undecided, seat1: declined both, seat2: called tichu,
    # seat3: called grand tichu -- one of every category, exercised from
    # player 0's own perspective so relative offset == seat number.
    state = make_state(
        {0: [card(Rank.FIVE)]},
        large_tichu_calls=(None, False, False, True),
        tichu_decided=(False, True, True, True),
        tichu_calls=(False, False, True, False),
    )

    block = _tichu_status_block(encode_observation(state, player=0))

    expected = np.zeros(_TICHU_STATUS_DIM, dtype=np.float32)
    expected[0 * _NUM_TICHU_STATUSES + _TICHU_STATUS_UNDECIDED] = 1.0
    expected[1 * _NUM_TICHU_STATUSES + _TICHU_STATUS_DECLINED] = 1.0
    expected[2 * _NUM_TICHU_STATUSES + _TICHU_STATUS_TICHU] = 1.0
    expected[3 * _NUM_TICHU_STATUSES + _TICHU_STATUS_GRAND_TICHU] = 1.0
    np.testing.assert_array_equal(block, expected)


def test_encode_observation_tichu_status_is_seat_relative():
    # Same underlying state as above, but observed from player 1's
    # perspective -- offset 0 must be seat1 (self, declined), offset 1 seat2
    # (tichu), offset 2 seat3 (grand tichu), offset 3 seat0 (undecided).
    state = make_state(
        {1: [card(Rank.FIVE)]},
        large_tichu_calls=(None, False, False, True),
        tichu_decided=(False, True, True, True),
        tichu_calls=(False, False, True, False),
    )

    block = _tichu_status_block(encode_observation(state, player=1))

    expected = np.zeros(_TICHU_STATUS_DIM, dtype=np.float32)
    expected[0 * _NUM_TICHU_STATUSES + _TICHU_STATUS_DECLINED] = 1.0
    expected[1 * _NUM_TICHU_STATUSES + _TICHU_STATUS_TICHU] = 1.0
    expected[2 * _NUM_TICHU_STATUSES + _TICHU_STATUS_GRAND_TICHU] = 1.0
    expected[3 * _NUM_TICHU_STATUSES + _TICHU_STATUS_UNDECIDED] = 1.0
    np.testing.assert_array_equal(block, expected)


def test_encode_observation_grand_tichu_takes_precedence_over_a_stray_tichu_call_flag():
    # Defensive: state.decide_large_tichu's own invariant guarantees a Grand
    # Tichu caller's tichu_calls stays False (see its "called" branch), but
    # this pins down that even if tichu_calls[seat] were True regardless,
    # large_tichu_calls is checked first and still reports grand_tichu.
    state = make_state(
        {0: [card(Rank.FIVE)]},
        large_tichu_calls=(True, True, True, True),
        tichu_decided=(True, True, True, True),
        tichu_calls=(True, True, True, True),
    )

    block = _tichu_status_block(encode_observation(state, player=0))

    expected = np.zeros(_TICHU_STATUS_DIM, dtype=np.float32)
    for offset in range(NUM_PLAYERS):
        expected[offset * _NUM_TICHU_STATUSES + _TICHU_STATUS_GRAND_TICHU] = 1.0
    np.testing.assert_array_equal(block, expected)


_REMAINING_START = _TICHU_STATUS_START + _TICHU_STATUS_DIM


def _remaining_block(obs: np.ndarray) -> np.ndarray:
    return obs[_REMAINING_START : _REMAINING_START + _REMAINING_TO_WIN_DIM]


def test_encode_observation_remaining_to_win_is_own_then_opponent_in_absolute_points():
    # Team 0 (seats 0/2) has 250 of 1000; team 1 has 600. From seat 0's view:
    # own = 750 points left, opponent = 400, each / _REMAINING_SCALE (1000).
    state = make_state({0: [card(Rank.FIVE)]}, team_scores=(250, 600), target_score=1000)

    block = _remaining_block(encode_observation(state, player=0))

    np.testing.assert_array_equal(block, np.array([0.75, 0.4], dtype=np.float32))


def test_encode_observation_remaining_to_win_swaps_for_the_other_team():
    state = make_state({1: [card(Rank.FIVE)]}, team_scores=(250, 600), target_score=1000)

    block = _remaining_block(encode_observation(state, player=1))

    np.testing.assert_array_equal(block, np.array([0.4, 0.75], dtype=np.float32))


def test_encode_observation_remaining_to_win_is_shared_by_partners():
    state = make_state({2: [card(Rank.FIVE)]}, team_scores=(250, 600), target_score=1000)

    block = _remaining_block(encode_observation(state, player=2))

    np.testing.assert_array_equal(block, np.array([0.75, 0.4], dtype=np.float32))


def test_encode_observation_remaining_to_win_is_absolute_not_a_fraction_of_the_target():
    # A 500-point game: 250 and 500 points left read as 0.25/0.5 -- the same
    # values those distances would have in a 1000-point game, not 0.5/1.0.
    state = make_state({0: [card(Rank.FIVE)]}, team_scores=(250, 0), target_score=500)

    block = _remaining_block(encode_observation(state, player=0))

    np.testing.assert_array_equal(block, np.array([0.25, 0.5], dtype=np.float32))


def test_encode_observation_remaining_to_win_is_identical_for_the_same_distance_under_different_targets():
    # 150 points left (own) and 400 left (opponent) under target 500 vs 2000.
    short_game = make_state({0: [card(Rank.FIVE)]}, team_scores=(350, 100), target_score=500)
    long_game = make_state({0: [card(Rank.FIVE)]}, team_scores=(1850, 1600), target_score=2000)

    short_block = _remaining_block(encode_observation(short_game, player=0))
    long_block = _remaining_block(encode_observation(long_game, player=0))

    np.testing.assert_array_equal(short_block, long_block)
    np.testing.assert_array_equal(short_block, np.array([0.15, 0.4], dtype=np.float32))


def test_encode_observation_remaining_to_win_is_capped_at_2000_points():
    # Target 3000: 3000 and 2500 left both clip to the 2000-point cap (2.0).
    state = make_state({0: [card(Rank.FIVE)]}, team_scores=(0, 500), target_score=3000)

    block = _remaining_block(encode_observation(state, player=0))

    np.testing.assert_array_equal(block, np.array([2.0, 2.0], dtype=np.float32))


def test_encode_observation_remaining_to_win_cap_also_applies_after_a_negative_score():
    # Target 2000 with -100: 2100 points left, clipped to the same 2.0 as 2000.
    state = make_state({0: [card(Rank.FIVE)]}, team_scores=(-100, 0), target_score=2000)

    block = _remaining_block(encode_observation(state, player=0))

    np.testing.assert_array_equal(block, np.array([2.0, 2.0], dtype=np.float32))


def test_encode_observation_remaining_to_win_can_exceed_one_after_a_negative_score():
    state = make_state({0: [card(Rank.FIVE)]}, team_scores=(-100, 0), target_score=1000)

    block = _remaining_block(encode_observation(state, player=0))

    np.testing.assert_array_equal(block, np.array([1.1, 1.0], dtype=np.float32))


def test_encode_observation_exchange_history_is_empty_before_any_exchange():
    state = make_state({0: [card(Rank.FIVE)]})

    obs = encode_observation(state, player=0)

    end = OBS_DIM - _PASSES_DIM
    exchange_block = obs[end - _EXCHANGE_RECEIVED_DIM : end]

    assert exchange_block.sum() == 0.0


def test_encode_observation_places_received_card_in_the_givers_relative_seat_slot():
    # From player 1's perspective, seat 2 is the next opponent (offset 1), so
    # the King they gave must land in the first NUM_CARDS-wide slot of the
    # exchange-history block.
    received = ({}, {2: card(Rank.KING)}, {}, {})
    state = make_state({1: [card(Rank.FIVE)]}, received_from=received)

    obs = encode_observation(state, player=1)

    end = OBS_DIM - _PASSES_DIM
    exchange_block = obs[end - _EXCHANGE_RECEIVED_DIM : end]

    king_index = CARD_INDEX[card(Rank.KING)]
    assert exchange_block[king_index] == 1.0
    assert exchange_block.sum() == 1.0


def test_encode_observation_reflects_passes_in_a_row():
    state_none_passed = make_state({0: [card(Rank.FIVE)]}, passes_in_a_row=0)
    state_two_passed = make_state({0: [card(Rank.FIVE)]}, passes_in_a_row=2)

    obs_none_passed = encode_observation(state_none_passed, player=0)
    obs_two_passed = encode_observation(state_two_passed, player=0)

    assert obs_none_passed[-1] != obs_two_passed[-1]


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


def test_encode_legal_actions_raises_when_state_is_still_in_large_tichu_phase():
    # Large-Tichu is auto-resolved by TichuEnv before it ever calls
    # encode_legal_actions (see TichuEnv._auto_resolve_calls); a state still
    # in Phase.LARGE_TICHU reaching this function at all is a misuse.
    state = make_state(
        {0: [card(Rank.FIVE)]},
        phase=Phase.LARGE_TICHU,
        current_player=0,
        large_tichu_calls=(None, None, None, None),
    )

    with pytest.raises(ValueError):
        encode_legal_actions(state, player=0)


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


def _full_hand() -> list[Card]:
    """14 distinct cards -- enough to satisfy `is_awaiting_tichu_decision`'s
    full-hand check without needing deck-legal special ranks."""
    numeric = [Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN]
    suits = [Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR]
    cards = [card(rank, suit) for rank in numeric for suit in suits]
    return cards[:14]


def test_encode_legal_actions_raises_when_player_has_not_yet_decided_tichu():
    # Same reasoning as the large-Tichu case: TichuEnv resolves the (small)
    # Tichu decision internally (see TichuEnv._auto_resolve_calls) before a
    # player is ever asked for trick-play legal actions.
    state = make_state(
        {0: _full_hand()},
        current_player=0,
        tichu_decided=(False, False, False, False),
    )

    with pytest.raises(ValueError):
        encode_legal_actions(state, player=0)


def test_encode_legal_actions_skips_tichu_decision_once_already_decided():
    state = make_state(
        {0: [card(Rank.FIVE)]},
        current_player=0,
        trick_leader=0,
        current_best=None,
        tichu_decided=(True, False, False, False),
    )

    actions = encode_legal_actions(state, player=0)

    assert all(not isinstance(combo, bool) for combo, _ in actions)


def test_encode_legal_actions_skips_tichu_decision_after_the_first_card_is_played():
    state = make_state(
        {0: [card(Rank.FIVE)]},  # only 1 card left -- already played 13
        current_player=0,
        trick_leader=0,
        current_best=None,
        tichu_decided=(False, False, False, False),
    )

    actions = encode_legal_actions(state, player=0)

    assert all(not isinstance(combo, bool) for combo, _ in actions)


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
