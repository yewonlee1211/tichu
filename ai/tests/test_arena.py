import math
import random
import sys
from pathlib import Path

import pytest
import torch

import eval.arena as arena_module
from tichu_env.env import TichuEnv
from tichu_env.match import MatchEnv, MatchStart, match_winner

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.heuristic import HeuristicAgent
from agents.policy_network import TichuPolicyValueNet
from agents.random_agent import RandomAgent
from training.train import train

from eval.arena import (
    MatchOutcome,
    _elo_diff_from_win_rate,
    _resolve_checkpoint,
    _resolve_opponent_chooser,
    advanced_heuristic_chooser,
    heuristic_chooser,
    load_checkpoint,
    play_arena_match,
    policy_chooser,
    run_arena,
    run_match_arena,
)


def _small_network() -> TichuPolicyValueNet:
    return TichuPolicyValueNet(hidden_dim=16, embedding_dim=8)


# ---------------------------------------------------------------------------
# _elo_diff_from_win_rate
# ---------------------------------------------------------------------------


def test_elo_diff_is_zero_at_an_even_score():
    assert _elo_diff_from_win_rate(0.5) == 0.0


def test_elo_diff_is_positive_above_an_even_score():
    assert _elo_diff_from_win_rate(0.75) > 0


def test_elo_diff_is_negative_below_an_even_score():
    assert _elo_diff_from_win_rate(0.25) < 0


def test_elo_diff_stays_finite_at_the_score_extremes():
    assert math.isfinite(_elo_diff_from_win_rate(1.0))
    assert math.isfinite(_elo_diff_from_win_rate(0.0))


# ---------------------------------------------------------------------------
# policy_chooser
# ---------------------------------------------------------------------------


def test_policy_chooser_deterministic_mode_only_returns_legal_actions_across_a_round():
    choose = policy_chooser(_small_network(), deterministic=True)
    env = TichuEnv(rng=random.Random(2))
    result = env.reset()
    while not result.done:
        combo = choose(result)
        assert combo in [c for c, _ in result.legal_actions]
        result = env.step(combo)


def test_policy_chooser_stochastic_mode_only_returns_legal_actions_across_a_round():
    choose = policy_chooser(_small_network(), deterministic=False)
    env = TichuEnv(rng=random.Random(3))
    result = env.reset()
    while not result.done:
        combo = choose(result)
        assert combo in [c for c, _ in result.legal_actions]
        result = env.step(combo)


# ---------------------------------------------------------------------------
# load_checkpoint
# ---------------------------------------------------------------------------


def test_load_checkpoint_restores_the_exact_trained_parameters(tmp_path: Path):
    network = _small_network()
    train(
        network,
        iterations=1,
        games_per_iteration=2,
        rng=random.Random(1),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=1,
        metrics_path=tmp_path / "metrics.csv",
    )

    loaded = load_checkpoint(tmp_path / "checkpoints" / "checkpoint_1.pt", hidden_dim=16, embedding_dim=8)

    for original, restored in zip(network.parameters(), loaded.parameters()):
        assert torch.equal(original, restored)


# ---------------------------------------------------------------------------
# _resolve_checkpoint
# ---------------------------------------------------------------------------


def test_resolve_checkpoint_passes_through_an_explicit_path(tmp_path: Path):
    explicit = tmp_path / "some_checkpoint.pt"

    assert _resolve_checkpoint(str(explicit), tmp_path) == explicit


def test_resolve_checkpoint_latest_picks_the_most_recently_modified_file(tmp_path: Path):
    older = tmp_path / "checkpoint_1.pt"
    newer = tmp_path / "checkpoint_2.pt"
    older.write_bytes(b"old")
    newer.write_bytes(b"new")
    newer.touch()  # ensure a strictly later mtime than `older` on fast filesystems

    assert _resolve_checkpoint("latest", tmp_path) == newer


def test_resolve_checkpoint_latest_raises_when_the_directory_has_no_checkpoints(tmp_path: Path):
    try:
        _resolve_checkpoint("latest", tmp_path)
        assert False, "expected FileNotFoundError when no checkpoint_*.pt files exist"
    except FileNotFoundError:
        pass


# ---------------------------------------------------------------------------
# run_arena -- validated against the already-proven heuristic > random result
# ---------------------------------------------------------------------------


def test_heuristic_team_beats_random_team_over_many_arena_games():
    heuristic_choose = heuristic_chooser(HeuristicAgent())
    random_agent = RandomAgent(rng=random.Random(11))
    random_choose = lambda result: random_agent.choose_action(result.legal_actions)  # noqa: E731

    result = run_arena(heuristic_choose, random_choose, games=100, rng=random.Random(0))

    assert result.team_a_win_rate > 0.5
    assert result.team_a_elo_diff > 0
    assert result.team_a_wins + result.team_b_wins + result.draws == 100


def test_advanced_heuristic_team_beats_random_team_over_many_arena_games():
    advanced_choose = advanced_heuristic_chooser(AdvancedHeuristicAgent())
    random_agent = RandomAgent(rng=random.Random(11))
    random_choose = lambda result: random_agent.choose_action(result.legal_actions)  # noqa: E731

    result = run_arena(advanced_choose, random_choose, games=100, rng=random.Random(0))

    assert result.team_a_win_rate > 0.5
    assert result.team_a_wins + result.team_b_wins + result.draws == 100


# ---------------------------------------------------------------------------
# _resolve_opponent_chooser -- the CLI's --opponent spec resolution
# ---------------------------------------------------------------------------


def _assert_only_plays_legal_actions(choose, seed: int) -> None:
    env = TichuEnv(rng=random.Random(seed))
    result = env.reset()
    while not result.done:
        combo = choose(result)
        assert combo in [c for c, _ in result.legal_actions]
        result = env.step(combo)


def test_resolve_opponent_chooser_heuristic_spec_plays_only_legal_actions():
    choose = _resolve_opponent_chooser("heuristic", Path("unused"), deterministic=True)
    _assert_only_plays_legal_actions(choose, seed=4)


def test_resolve_opponent_chooser_advanced_heuristic_spec_plays_only_legal_actions():
    choose = _resolve_opponent_chooser("advanced_heuristic", Path("unused"), deterministic=True)
    _assert_only_plays_legal_actions(choose, seed=5)


# ---------------------------------------------------------------------------
# match-level arena
# ---------------------------------------------------------------------------


def _random_chooser(seed: int):
    agent = RandomAgent(rng=random.Random(seed))
    return lambda result: agent.choose_action(result.legal_actions)


def test_play_arena_match_matches_an_independent_replay_of_the_same_match():
    heuristic_choose = heuristic_chooser(HeuristicAgent())
    advanced_choose = advanced_heuristic_chooser(AdvancedHeuristicAgent())
    choosers = {0: heuristic_choose, 1: advanced_choose, 2: heuristic_choose, 3: advanced_choose}

    outcome = play_arena_match(MatchEnv(rng=random.Random(20)), choosers, target_score=500)

    env = MatchEnv(rng=random.Random(20))
    result = env.reset(MatchStart(target_score=500, team_scores=(0, 0)))
    rounds = 0
    while not result.done:
        result = env.step(choosers[result.player](result))
        rounds += "round_scores" in result.info
    assert outcome == MatchOutcome(team_scores=env.team_scores, winner=result.info["winner"], rounds=rounds)
    assert outcome.rounds >= 2
    assert outcome.winner == match_winner(outcome.team_scores, 500)


def test_run_match_arena_plays_every_match_at_the_requested_target():
    seen_targets = set()
    heuristic_choose = heuristic_chooser(HeuristicAgent())

    def recording_choose(result):
        seen_targets.add((result.state.target_score, result.state.team_scores))
        return heuristic_choose(result)

    result = run_match_arena(recording_choose, _random_chooser(21), matches=3, target_score=700, rng=random.Random(1))

    assert {target for target, _ in seen_targets} == {700}
    assert (700, (0, 0)) in seen_targets, "matches start from (0, 0)"
    assert any(scores != (0, 0) for _, scores in seen_targets), "later rounds see the accumulated scores"
    assert result.matches == 3
    assert result.team_a_wins + result.team_b_wins == 3
    assert result.mean_rounds >= 2


def test_heuristic_team_beats_random_team_over_many_arena_matches():
    result = run_match_arena(
        heuristic_chooser(HeuristicAgent()), _random_chooser(22), matches=20, target_score=500, rng=random.Random(2)
    )

    assert result.team_a_win_rate > 0.5
    assert result.team_a_elo_diff > 0
    assert result.team_a_win_rate == result.team_a_wins / 20


def test_run_match_arena_rejects_a_non_positive_match_count():
    with pytest.raises(ValueError):
        run_match_arena(heuristic_chooser(), heuristic_chooser(), matches=0)


def test_cli_match_mode_reports_the_match_win_rate(tmp_path: Path, monkeypatch, capsys):
    checkpoint = tmp_path / "checkpoint_1.pt"
    torch.save(TichuPolicyValueNet().state_dict(), checkpoint)
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "arena.py",
            "--checkpoint", str(checkpoint),
            "--opponent", "heuristic",
            "--mode", "match",
            "--target-score", "300",
            "--games", "2",
            "--seed", "3",
        ],
    )

    arena_module._main()

    output = capsys.readouterr().out
    assert output.startswith("2 matches (target 300):")
    assert "match win rate" in output


def test_resolve_opponent_chooser_checkpoint_path_loads_that_checkpoint(tmp_path: Path):
    network = _small_network()
    train(
        network,
        iterations=1,
        games_per_iteration=2,
        rng=random.Random(1),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=1,
        metrics_path=tmp_path / "metrics.csv",
    )
    checkpoint_path = tmp_path / "checkpoints" / "checkpoint_1.pt"

    choose = _resolve_opponent_chooser(
        str(checkpoint_path), tmp_path, deterministic=True, hidden_dim=16, embedding_dim=8
    )

    _assert_only_plays_legal_actions(choose, seed=6)
