import random

import pytest

from agents.advanced_heuristic import AdvancedHeuristicAgent
from tichu_env.env import TichuEnv
from tichu_env.state import NUM_PLAYERS, Phase, deal_new_round


def _play_full_round(env: TichuEnv, rng: random.Random) -> None:
    result = env.reset()
    steps = 0
    max_steps = 500  # generous upper bound; a real round finishes in well under this
    while not result.done:
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)
        steps += 1
        assert steps < max_steps, "round did not terminate within a sane number of steps"


def test_random_agent_completes_many_rounds_without_crashing():
    rng = random.Random(0)
    env = TichuEnv(rng=rng)

    for _ in range(200):
        _play_full_round(env, rng)
        assert env.state.phase is Phase.ROUND_OVER


def test_reset_lands_directly_in_playing_phase_with_14_card_hands():
    """Large-Tichu and card exchange are both auto-resolved internally now
    (see TichuEnv's class docstring), so reset() never leaves Phase.LARGE_TICHU
    or Phase.EXCHANGE observable to a caller -- it goes straight to trick play."""
    env = TichuEnv(rng=random.Random(1))

    result = env.reset()

    assert env.state.phase is Phase.PLAYING
    assert all(len(hand) == 14 for hand in env.state.hands)
    assert result.done is False


def test_reset_auto_resolves_large_tichu_calls_matching_the_heuristic():
    """Exact-state-diff check: the large-Tichu call recorded for each seat
    after reset() must match what AdvancedHeuristicAgent.should_call_large_tichu
    would decide from that seat's actual 8-card deal -- not just "some call
    was made". Uses a freshly seeded RNG to independently reproduce the same
    deal `TichuEnv.reset()` itself draws from an identically seeded `rng`."""
    seed = 7
    pre_decision_state = deal_new_round(random.Random(seed))
    heuristic = AdvancedHeuristicAgent()
    expected_calls = tuple(
        heuristic.should_call_large_tichu(pre_decision_state.hands[player]) for player in range(NUM_PLAYERS)
    )

    env = TichuEnv(rng=random.Random(seed))
    result = env.reset()

    assert result.state.large_tichu_calls == expected_calls


def test_reset_auto_resolves_the_current_players_tichu_decision():
    env = TichuEnv(rng=random.Random(1))

    result = env.reset()

    assert result.state.tichu_decided[result.player] is True


def test_legal_actions_after_reset_never_offer_a_bool_decision():
    env = TichuEnv(rng=random.Random(1))

    result = env.reset()

    assert all(not isinstance(action, bool) for action, _ in result.legal_actions)


def test_every_players_tichu_decision_gets_auto_resolved_by_their_first_turn():
    """Each seat's (small) Tichu decision is only made once it's actually
    their turn (see `_auto_resolve_calls`'s docstring) -- walk the round
    until every seat has had a turn and confirm none of them ever see a bool
    legal action, and all end up decided."""
    env = TichuEnv(rng=random.Random(1))
    result = env.reset()

    rng = random.Random(99)
    seen_players = {result.player}
    while not result.done and len(seen_players) < NUM_PLAYERS:
        assert all(not isinstance(action, bool) for action, _ in result.legal_actions)
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)
        seen_players.add(result.player)

    assert all(result.state.tichu_decided)


def test_step_raises_on_action_outside_legal_set():
    env = TichuEnv(rng=random.Random(2))
    env.reset()

    bogus_hand = env.state.hands[(env.current_player + 1) % 4]
    from tichu_env.combinations import identify_combo

    foreign_combo = identify_combo([bogus_hand[0]]) if bogus_hand else None

    if foreign_combo is not None:
        try:
            env.step(foreign_combo)
        except ValueError:
            pass
        else:
            raise AssertionError("expected step() to reject a card the current player does not hold")


def test_step_result_exposes_the_current_game_state():
    env = TichuEnv(rng=random.Random(4))

    reset_result = env.reset()
    assert reset_result.state == env.state

    combo, _ = reset_result.legal_actions[0]
    step_result = env.step(combo)
    assert step_result.state == env.state


def test_reset_defaults_to_zero_team_scores_and_the_standard_1000_point_target():
    env = TichuEnv(rng=random.Random(5))

    result = env.reset()

    assert result.state.team_scores == (0, 0)
    assert result.state.target_score == 1000


def test_reset_carries_the_configured_target_and_starting_scores_into_the_state():
    env = TichuEnv(rng=random.Random(5), target_score=500)

    result = env.reset(team_scores=(120, 340))

    assert result.state.team_scores == (120, 340)
    assert result.state.target_score == 500


def test_env_rejects_a_non_positive_target_score():
    with pytest.raises(ValueError):
        TichuEnv(rng=random.Random(5), target_score=0)


def test_a_round_plays_out_with_nonzero_starting_scores_and_a_custom_target():
    rng = random.Random(6)
    env = TichuEnv(rng=rng, target_score=700)
    result = env.reset(team_scores=(650, 400))

    while not result.done:
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)

    assert result.state.team_scores == (650, 400)
    assert "team_scores" in result.info


def test_finished_round_reports_team_scores_in_info():
    rng = random.Random(3)
    env = TichuEnv(rng=rng)
    result = env.reset()

    while not result.done:
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)

    assert "team_scores" in result.info
    team0, team1 = result.info["team_scores"]
    assert isinstance(team0, int)
    assert isinstance(team1, int)
