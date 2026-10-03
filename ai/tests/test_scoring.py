import pytest

from tichu_env.cards import Card, Rank, Suit
from tichu_env.scoring import is_game_over, score_round, team_of
from tichu_env.state import NUM_PLAYERS, GameState, Phase


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def make_round_over_state(
    *,
    finished_order: tuple[int, ...],
    collected_tricks: dict[int, list[Card]] | None = None,
    hands: dict[int, list[Card]] | None = None,
    tichu_calls: tuple[bool, bool, bool, bool] = (False, False, False, False),
    large_tichu_calls: tuple[bool | None, bool | None, bool | None, bool | None] = (False, False, False, False),
    phase: Phase = Phase.ROUND_OVER,
) -> GameState:
    collected_tricks = collected_tricks or {}
    hands = hands or {}
    return GameState(
        hands=tuple(tuple(hands.get(i, [])) for i in range(NUM_PLAYERS)),
        pending_final_cards=tuple(() for _ in range(NUM_PLAYERS)),
        phase=phase,
        current_player=0,
        trick_leader=0,
        trick_cards=(),
        current_best=None,
        current_strength=0.0,
        last_player_to_act=None,
        passes_in_a_row=0,
        finished_order=finished_order,
        collected_tricks=tuple(tuple(collected_tricks.get(i, [])) for i in range(NUM_PLAYERS)),
        large_tichu_calls=large_tichu_calls,
        tichu_calls=tichu_calls,
        mahjong_wish=None,
    )


def test_team_of_pairs_opposite_seats():
    assert team_of(0) == team_of(2)
    assert team_of(1) == team_of(3)
    assert team_of(0) != team_of(1)


def test_double_win_scores_200_with_no_card_tally():
    # seats 0 and 2 are partners; both finish before the other team.
    state = make_round_over_state(
        finished_order=(0, 2, 1),
        collected_tricks={0: [card(Rank.KING)], 3: [card(Rank.TEN)]},
    )

    team0, team1 = score_round(state)

    assert (team0, team1) == (200, 0)


def test_normal_end_tallies_collected_tricks_per_team():
    state = make_round_over_state(
        finished_order=(0, 1, 2),
        collected_tricks={0: [card(Rank.KING)], 1: [card(Rank.FIVE)]},
        hands={3: []},
    )

    team0, team1 = score_round(state)

    assert team0 == 10  # seat 0 (team 0) collected a King
    assert team1 == 5  # seat 1 (team 1) collected a Five


def test_fourth_players_remaining_hand_goes_to_opposing_team():
    # seat 3 (team 1) never finishes and is left holding a King (10 points).
    state = make_round_over_state(
        finished_order=(0, 1, 2),
        hands={3: [card(Rank.KING)]},
    )

    team0, team1 = score_round(state)

    assert team0 == 10  # opposing team (team 0) receives seat 3's hand points
    assert team1 == 0


def test_fourth_players_already_collected_tricks_go_to_first_place_regardless_of_team():
    # seat 3 (team 1) finishes last but already banked a trick worth 10 points.
    # First place is seat 1 (team 1) -- same team as seat 3 here.
    state = make_round_over_state(
        finished_order=(1, 0, 2),
        collected_tricks={3: [card(Rank.KING)]},
    )

    team0, team1 = score_round(state)

    assert team1 == 10
    assert team0 == 0


def test_fourth_players_tricks_go_to_first_place_even_on_the_opposing_team():
    # First place is seat 0 (team 0); seat 3 (team 1) is fourth with a banked trick.
    state = make_round_over_state(
        finished_order=(0, 1, 2),
        collected_tricks={3: [card(Rank.KING)]},
    )

    team0, team1 = score_round(state)

    assert team0 == 10
    assert team1 == 0


def test_tichu_bonus_awarded_when_caller_finishes_first():
    state = make_round_over_state(
        finished_order=(0, 1, 2),
        tichu_calls=(True, False, False, False),
    )

    team0, team1 = score_round(state)

    assert team0 == 100


def test_tichu_penalty_when_caller_does_not_finish_first():
    state = make_round_over_state(
        finished_order=(1, 0, 2),
        tichu_calls=(True, False, False, False),
    )

    team0, team1 = score_round(state)

    assert team0 == -100


def test_large_tichu_bonus_is_200():
    state = make_round_over_state(
        finished_order=(0, 1, 2),
        large_tichu_calls=(True, False, False, False),
    )

    team0, team1 = score_round(state)

    assert team0 == 200


def test_large_tichu_penalty_is_200_when_not_first():
    state = make_round_over_state(
        finished_order=(1, 0, 2),
        large_tichu_calls=(True, False, False, False),
    )

    team0, team1 = score_round(state)

    assert team0 == -200


def test_score_round_rejects_unfinished_round():
    state = make_round_over_state(finished_order=(0, 1), phase=Phase.PLAYING)

    with pytest.raises(ValueError):
        score_round(state)


def test_is_game_over_true_once_target_reached():
    assert is_game_over((1000, 400)) is True
    assert is_game_over((950, 400), target_score=1000) is False


def test_is_game_over_respects_custom_target():
    assert is_game_over((520, 100), target_score=500) is True


@pytest.mark.parametrize(
    ("scores", "expected"),
    [
        ((1000, 1000), False),
        ((1100, 1100), False),
        ((1000, 995), True),
        ((995, 995), False),
    ],
)
def test_is_game_over_plays_another_round_on_a_tie_at_or_above_target(scores, expected):
    assert is_game_over(scores) is expected
