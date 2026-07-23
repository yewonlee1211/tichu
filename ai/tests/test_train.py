import random
import sys
from pathlib import Path

import pytest
import torch

import training.train as train_module
from agents.policy_network import TichuPolicyValueNet
from training.self_play import generate_self_play_games
from training.train import compute_reinforce_loss, train


def _small_network() -> TichuPolicyValueNet:
    return TichuPolicyValueNet(hidden_dim=16, embedding_dim=8)


def test_train_runs_the_requested_number_of_iterations_without_crashing(tmp_path: Path):
    history = train(
        _small_network(),
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(0),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert [m.iteration for m in history] == [1, 2, 3]


def test_train_writes_one_metrics_row_per_iteration(tmp_path: Path):
    metrics_path = tmp_path / "metrics.csv"

    train(
        _small_network(),
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(1),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=metrics_path,
    )

    lines = metrics_path.read_text().strip().splitlines()
    assert len(lines) == 1 + 3  # header + one row per iteration


def test_train_always_checkpoints_the_final_iteration(tmp_path: Path):
    checkpoint_dir = tmp_path / "checkpoints"

    train(
        _small_network(),
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(2),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert (checkpoint_dir / "checkpoint_3.pt").exists()


def test_train_checkpoints_at_the_configured_interval_only(tmp_path: Path):
    checkpoint_dir = tmp_path / "checkpoints"

    train(
        _small_network(),
        iterations=4,
        games_per_iteration=2,
        rng=random.Random(3),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=2,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert (checkpoint_dir / "checkpoint_2.pt").exists()
    assert (checkpoint_dir / "checkpoint_4.pt").exists()
    assert not (checkpoint_dir / "checkpoint_1.pt").exists()
    assert not (checkpoint_dir / "checkpoint_3.pt").exists()


def test_a_saved_checkpoint_reloads_into_a_fresh_network_of_the_same_shape(tmp_path: Path):
    checkpoint_dir = tmp_path / "checkpoints"
    network = _small_network()

    train(
        network,
        iterations=1,
        games_per_iteration=2,
        rng=random.Random(4),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=1,
        metrics_path=tmp_path / "metrics.csv",
    )

    reloaded = TichuPolicyValueNet(hidden_dim=16, embedding_dim=8)
    reloaded.load_state_dict(torch.load(checkpoint_dir / "checkpoint_1.pt", weights_only=True))

    for original, restored in zip(network.parameters(), reloaded.parameters()):
        assert torch.equal(original, restored)


def test_compute_reinforce_loss_reports_a_non_negative_mean_entropy():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=2, rng=random.Random(6))

    _, _, _, _, mean_entropy = compute_reinforce_loss(network, episodes)

    assert mean_entropy >= 0.0


def test_entropy_coef_lowers_total_loss_relative_to_zero_for_a_freshly_initialized_network():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=2, rng=random.Random(7))

    _, _, total_loss_no_bonus, _, mean_entropy = compute_reinforce_loss(network, episodes, entropy_coef=0.0)
    _, _, total_loss_with_bonus, _, _ = compute_reinforce_loss(network, episodes, entropy_coef=0.5)

    assert mean_entropy > 0.0  # a freshly initialized net's action distribution isn't degenerate
    assert total_loss_with_bonus.item() == pytest.approx(total_loss_no_bonus.item() - 0.5 * mean_entropy, abs=1e-4)


def _naive_reference_reinforce_loss(
    network: TichuPolicyValueNet,
    episodes: list[list],
    reward_scale: float = 100.0,
    entropy_coef: float = 0.0,
):
    """Independent, unbatched per-transition reimplementation of
    `compute_reinforce_loss`'s math -- used to pin down the batched implementation's
    correctness against a version that cannot share a batching bug."""
    policy_losses = []
    value_losses = []
    entropies = []
    raw_returns = []

    for trajectory in episodes:
        if not trajectory:
            continue
        raw_return = trajectory[-1].reward
        scaled_return = raw_return / reward_scale
        for transition in trajectory:
            obs = torch.as_tensor(transition.observation, dtype=torch.float32)
            action_vectors = torch.as_tensor(transition.action_vectors, dtype=torch.float32)
            output = network(obs, action_vectors)

            log_probs = torch.log_softmax(output.action_logits, dim=-1)
            chosen_log_prob = log_probs[transition.chosen_index]
            advantage = scaled_return - output.state_value.detach()

            policy_losses.append(-chosen_log_prob * advantage)
            value_losses.append((output.state_value - scaled_return) ** 2)
            entropies.append(-(log_probs.exp() * log_probs).sum())
            raw_returns.append(raw_return)

    policy_loss = torch.stack(policy_losses).mean()
    value_loss = torch.stack(value_losses).mean()
    entropy = torch.stack(entropies).mean()
    total_loss = policy_loss + value_loss - entropy_coef * entropy
    mean_return = sum(raw_returns) / len(raw_returns)
    return policy_loss, value_loss, total_loss, mean_return, entropy.item()


def test_compute_reinforce_loss_matches_a_naive_per_transition_reference_implementation():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=3, rng=random.Random(20))

    ref_policy, ref_value, ref_total, ref_return, ref_entropy = _naive_reference_reinforce_loss(
        network, episodes, entropy_coef=0.3
    )
    policy_loss, value_loss, total_loss, mean_return, mean_entropy = compute_reinforce_loss(
        network, episodes, entropy_coef=0.3
    )

    assert torch.allclose(policy_loss, ref_policy, atol=1e-5)
    assert torch.allclose(value_loss, ref_value, atol=1e-5)
    assert torch.allclose(total_loss, ref_total, atol=1e-5)
    assert mean_return == pytest.approx(ref_return)
    assert mean_entropy == pytest.approx(ref_entropy, abs=1e-5)


def test_train_logs_mean_entropy_as_a_metrics_column(tmp_path: Path):
    metrics_path = tmp_path / "metrics.csv"

    history = train(
        _small_network(),
        iterations=2,
        games_per_iteration=2,
        entropy_coef=0.01,
        rng=random.Random(8),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=metrics_path,
    )

    header = metrics_path.read_text().splitlines()[0]
    assert "mean_entropy" in header
    assert all(hasattr(m, "mean_entropy") for m in history)


def test_train_keeps_a_constant_learning_rate_when_lr_min_is_not_set(tmp_path: Path):
    history = train(
        _small_network(),
        iterations=3,
        games_per_iteration=2,
        learning_rate=1e-3,
        rng=random.Random(9),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert all(m.learning_rate == pytest.approx(1e-3) for m in history)


def test_train_decays_the_learning_rate_via_cosine_schedule_when_lr_min_is_set(tmp_path: Path):
    history = train(
        _small_network(),
        iterations=5,
        games_per_iteration=2,
        learning_rate=1e-3,
        lr_min=1e-4,
        rng=random.Random(10),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert history[0].learning_rate == pytest.approx(1e-3)
    assert history[-1].learning_rate == pytest.approx(1e-4)
    rates = [m.learning_rate for m in history]
    assert all(a >= b - 1e-12 for a, b in zip(rates, rates[1:]))  # monotonically non-increasing


def test_train_logs_learning_rate_as_a_metrics_column(tmp_path: Path):
    metrics_path = tmp_path / "metrics.csv"

    train(
        _small_network(),
        iterations=2,
        games_per_iteration=2,
        lr_min=1e-4,
        rng=random.Random(11),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=metrics_path,
    )

    header = metrics_path.read_text().splitlines()[0]
    assert "learning_rate" in header


def test_cli_with_the_same_seed_produces_an_identical_initial_network(tmp_path: Path, monkeypatch):
    def run_cli(checkpoint_dir: Path) -> None:
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "train.py",
                "--iterations",
                "1",
                "--games-per-iteration",
                "2",
                "--checkpoint-dir",
                str(checkpoint_dir),
                "--checkpoint-every",
                "1",
                "--metrics-path",
                str(checkpoint_dir / "metrics.csv"),
                "--seed",
                "123",
            ],
        )
        train_module._main()

    dir_a = tmp_path / "a"
    dir_b = tmp_path / "b"
    run_cli(dir_a)
    run_cli(dir_b)

    state_a = torch.load(dir_a / "checkpoint_1.pt", weights_only=True)
    state_b = torch.load(dir_b / "checkpoint_1.pt", weights_only=True)
    for key in state_a:
        assert torch.equal(state_a[key], state_b[key])


def test_training_actually_changes_the_networks_parameters(tmp_path: Path):
    network = _small_network()
    before = [p.detach().clone() for p in network.parameters()]

    train(
        network,
        iterations=5,
        games_per_iteration=3,
        rng=random.Random(5),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    after = list(network.parameters())
    assert any(not torch.equal(b, a) for b, a in zip(before, after))
