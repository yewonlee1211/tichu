import random

import pytest

import tichu_env.env as env_module
from tichu_env.encoding import encode_observation
from tichu_env.match import (
    MatchEnv,
    MatchStart,
    MatchStartConfig,
    is_match_over,
    match_winner,
    sample_match_start,
)


def _play_match(env: MatchEnv, start: MatchStart, rng: random.Random) -> list[dict]:
    """Plays a whole match with a random policy, returning the info dict of
    every step that closed a round (in order)."""
    result = env.reset(start)
    round_infos = []
    steps = 0
    while not result.done:
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)
        if "round_scores" in result.info:
            round_infos.append(result.info)
        steps += 1
        assert steps < 20_000, "match did not terminate within a sane number of steps"
    return round_infos


# --- is_match_over / match_winner -----------------------------------------


@pytest.mark.parametrize(
    ("scores", "target", "expected"),
    [
        ((999, 0), 1000, False),
        ((1000, 0), 1000, True),
        ((0, 1000), 1000, True),
        ((1000, 995), 1000, True),
        ((1100, 1050), 1000, True),
        ((995, 995), 1000, False),
        ((1000, 1000), 1000, False),
        ((1100, 1100), 1000, False),
        ((500, -100), 500, True),
    ],
)
def test_is_match_over_requires_a_team_at_target_and_no_tie_at_the_top(scores, target, expected):
    assert is_match_over(scores, target) is expected


@pytest.mark.parametrize(
    ("scores", "expected"),
    [((1050, 1000), 0), ((900, 1000), 1), ((1000, -300), 0)],
)
def test_match_winner_is_the_higher_scoring_team(scores, expected):
    assert match_winner(scores, 1000) == expected


@pytest.mark.parametrize("scores", [(1000, 1000), (900, 400)])
def test_match_winner_rejects_a_match_that_is_not_over(scores):
    with pytest.raises(ValueError):
        match_winner(scores, 1000)


# --- sample_match_start ----------------------------------------------------


def test_full_match_starts_from_zero_with_one_of_the_configured_targets():
    config = MatchStartConfig(full_match_prob=1.0)
    rng = random.Random(0)

    starts = [sample_match_start(rng, config) for _ in range(300)]

    assert all(start.team_scores == (0, 0) for start in starts)
    assert {start.target_score for start in starts} == {500, 1000, 2000}


def test_sampled_start_draws_remaining_points_on_a_5_point_grid_within_the_gap_cap():
    config = MatchStartConfig(full_match_prob=0.0, max_remaining_gap=300)
    rng = random.Random(1)

    starts = [sample_match_start(rng, config) for _ in range(2000)]

    for start in starts:
        assert start.target_score == config.sampled_target_score
        remaining = [start.target_score - score for score in start.team_scores]
        for value in remaining:
            assert 5 <= value <= 2000
            assert value % 5 == 0
        assert abs(remaining[0] - remaining[1]) <= 300
    all_remaining = [start.target_score - s for start in starts for s in start.team_scores]
    assert min(all_remaining) <= 50
    assert max(all_remaining) >= 1950


def test_mixing_ratio_splits_episodes_between_full_and_sampled_starts():
    config = MatchStartConfig(full_match_prob=0.5)
    rng = random.Random(2)

    starts = [sample_match_start(rng, config) for _ in range(2000)]

    full = sum(1 for start in starts if start.team_scores == (0, 0))
    assert 900 <= full <= 1100


@pytest.mark.parametrize(
    "kwargs",
    [
        {"full_match_prob": -0.1},
        {"full_match_prob": 1.1},
        {"full_match_targets": ()},
        {"full_match_targets": (0, 1000)},
        {"remaining_min": 0},
        {"remaining_min": 100, "remaining_max": 50},
        {"remaining_min": 7},
        {"remaining_max": 1003},
        {"max_remaining_gap": -5},
        {"sampled_target_score": 1000, "remaining_max": 2000},
    ],
)
def test_match_start_config_rejects_invalid_values(kwargs):
    with pytest.raises(ValueError):
        MatchStartConfig(**kwargs)


# --- MatchEnv --------------------------------------------------------------


def test_reset_starts_the_first_round_at_the_given_scores_and_target():
    env = MatchEnv(rng=random.Random(3))

    result = env.reset(MatchStart(target_score=500, team_scores=(350, 100)))

    assert result.state.target_score == 500
    assert result.state.team_scores == (350, 100)
    assert env.round_index == 0
    assert env.team_scores == (350, 100)
    assert result.done is False
    assert (result.observation == encode_observation(result.state, result.player)).all()


def test_full_match_accumulates_round_scores_until_a_team_reaches_the_target():
    rng = random.Random(4)
    env = MatchEnv(rng=rng)
    start = MatchStart(target_score=500, team_scores=(0, 0))

    round_infos = _play_match(env, start, rng)

    assert len(round_infos) >= 2
    cumulative = start.team_scores
    for k, info in enumerate(round_infos):
        assert info["round_index"] == k
        cumulative = (cumulative[0] + info["round_scores"][0], cumulative[1] + info["round_scores"][1])
        assert info["team_scores"] == cumulative
        is_last = k == len(round_infos) - 1
        assert info["match_over"] is is_last
        assert is_match_over(cumulative, 500) is is_last
    assert env.team_scores == cumulative
    assert round_infos[-1]["winner"] == match_winner(cumulative, 500)
    assert env.done is True


def test_each_new_round_is_dealt_with_the_cumulative_scores_and_same_target():
    rng = random.Random(5)
    env = MatchEnv(rng=rng)
    result = env.reset(MatchStart(target_score=500, team_scores=(0, 0)))

    while not result.done:
        combo, _ = rng.choice(result.legal_actions)
        result = env.step(combo)
        if "round_scores" in result.info and not result.done:
            assert result.state.team_scores == result.info["team_scores"]
            assert result.state.target_score == 500
            assert env.round_index == result.info["round_index"] + 1
            assert all(len(hand) == 14 for hand in result.state.hands)


def test_tied_scores_at_or_above_target_play_one_more_round(monkeypatch):
    forced_round_scores = iter([(100, 100), (100, 0)])
    monkeypatch.setattr(env_module, "score_round", lambda _state: next(forced_round_scores))
    rng = random.Random(6)
    env = MatchEnv(rng=rng)

    round_infos = _play_match(env, MatchStart(target_score=1000, team_scores=(950, 950)), rng)

    assert [info["team_scores"] for info in round_infos] == [(1050, 1050), (1150, 1050)]
    assert [info["match_over"] for info in round_infos] == [False, True]
    assert round_infos[-1]["winner"] == 0


def test_step_after_the_match_is_over_raises():
    rng = random.Random(7)
    env = MatchEnv(rng=rng)
    _play_match(env, MatchStart(target_score=5, team_scores=(0, 0)), rng)

    with pytest.raises(RuntimeError):
        env.step(None)


def test_reset_rejects_a_start_that_is_already_over():
    env = MatchEnv(rng=random.Random(8))

    with pytest.raises(ValueError):
        env.reset(MatchStart(target_score=500, team_scores=(500, 0)))


def test_reset_rejects_a_non_positive_target():
    env = MatchEnv(rng=random.Random(8))

    with pytest.raises(ValueError):
        env.reset(MatchStart(target_score=0, team_scores=(0, 0)))
