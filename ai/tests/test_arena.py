import math
import random
from pathlib import Path

import torch

from tichu_env.env import TichuEnv

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.heuristic import HeuristicAgent
from agents.policy_network import TichuPolicyValueNet
from agents.random_agent import RandomAgent
from training.train import train

from eval.arena import (
    _elo_diff_from_win_rate,
    _resolve_checkpoint,
    advanced_heuristic_chooser,
    heuristic_chooser,
    load_checkpoint,
    policy_chooser,
    run_arena,
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
