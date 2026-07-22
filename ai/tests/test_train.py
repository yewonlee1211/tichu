import random
from pathlib import Path

import torch

from agents.policy_network import TichuPolicyValueNet
from training.train import train


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
