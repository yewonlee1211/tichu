import random

from tichu_env.env import TichuEnv
from tichu_env.state import Phase


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


def test_reset_lands_directly_in_playing_phase():
    env = TichuEnv(rng=random.Random(1))

    result = env.reset()

    assert env.state.phase is Phase.PLAYING
    assert all(len(hand) == 14 for hand in env.state.hands)
    assert result.done is False


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
