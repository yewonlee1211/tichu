import random
import sys
from dataclasses import replace
from pathlib import Path

import pytest
import torch

import training.train as train_module
from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.policy_network import TichuPolicyValueNet
from training.opponent_pool import OpponentPool
from training.self_play import HeuristicOpponentAdapter, PolicyOpponent, generate_self_play_games
from training.train import (
    compute_ppo_loss,
    compute_reinforce_loss,
    load_warm_start_state_dict,
    migrate_action_encoder_input_layer,
    train,
)


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


def test_compute_ppo_loss_reports_a_non_negative_mean_entropy():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=2, rng=random.Random(60))

    _, _, _, _, mean_entropy = compute_ppo_loss(network, episodes)

    assert mean_entropy >= 0.0


def _naive_reference_ppo_loss(
    network: TichuPolicyValueNet,
    episodes: list[list],
    reward_scale: float = 100.0,
    entropy_coef: float = 0.0,
    clip_epsilon: float = 0.2,
):
    """Independent, unbatched per-transition reimplementation of the clipped PPO
    surrogate objective -- same role as `_naive_reference_reinforce_loss` above:
    pins down the batched implementation's correctness against a version that
    cannot share a batching bug."""
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
            new_log_prob = log_probs[transition.chosen_index]
            advantage = scaled_return - output.state_value.detach()
            ratio = torch.exp(new_log_prob - transition.old_log_prob)
            clipped_ratio = torch.clamp(ratio, 1.0 - clip_epsilon, 1.0 + clip_epsilon)
            surrogate = torch.min(ratio * advantage, clipped_ratio * advantage)

            policy_losses.append(-surrogate)
            value_losses.append((output.state_value - scaled_return) ** 2)
            entropies.append(-(log_probs.exp() * log_probs).sum())
            raw_returns.append(raw_return)

    policy_loss = torch.stack(policy_losses).mean()
    value_loss = torch.stack(value_losses).mean()
    entropy = torch.stack(entropies).mean()
    total_loss = policy_loss + value_loss - entropy_coef * entropy
    mean_return = sum(raw_returns) / len(raw_returns)
    return policy_loss, value_loss, total_loss, mean_return, entropy.item()


def test_compute_ppo_loss_matches_a_naive_per_transition_reference_implementation():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=3, rng=random.Random(61))
    # Shift old_log_prob away from the network's actual current log-probs so the
    # clipping branch is actually exercised for at least some transitions, rather
    # than only ever hitting the trivial ratio==1 case.
    shifted_episodes = [
        [replace(t, old_log_prob=t.old_log_prob - 0.5) for t in trajectory] for trajectory in episodes
    ]

    ref_policy, ref_value, ref_total, ref_return, ref_entropy = _naive_reference_ppo_loss(
        network, shifted_episodes, entropy_coef=0.3, clip_epsilon=0.2
    )
    policy_loss, value_loss, total_loss, mean_return, mean_entropy = compute_ppo_loss(
        network, shifted_episodes, entropy_coef=0.3, clip_epsilon=0.2
    )

    assert torch.allclose(policy_loss, ref_policy, atol=1e-5)
    assert torch.allclose(value_loss, ref_value, atol=1e-5)
    assert torch.allclose(total_loss, ref_total, atol=1e-5)
    assert mean_return == pytest.approx(ref_return)
    assert mean_entropy == pytest.approx(ref_entropy, abs=1e-5)


def test_a_tighter_clip_epsilon_changes_the_policy_loss_when_the_ratio_is_far_from_one():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=2, rng=random.Random(62))
    # Shift old_log_prob far below the network's current log-probs so ratio =
    # exp(new - old) is far above 1 for every transition, guaranteeing the clip
    # bound actually engages.
    shifted_episodes = [
        [replace(t, old_log_prob=t.old_log_prob - 2.0) for t in trajectory] for trajectory in episodes
    ]

    tight_policy_loss, _, _, _, _ = compute_ppo_loss(network, shifted_episodes, clip_epsilon=0.1)
    loose_policy_loss, _, _, _, _ = compute_ppo_loss(network, shifted_episodes, clip_epsilon=10.0)

    assert tight_policy_loss.item() != pytest.approx(loose_policy_loss.item())


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


def test_train_forwards_its_opponent_straight_through_to_self_play(tmp_path: Path, monkeypatch):
    seen_opponents = []
    real_generate = train_module.generate_self_play_games

    def spy(network, num_games, rng=None, opponent=None, opponent_factory=None):
        seen_opponents.append(opponent)
        return real_generate(network, num_games, rng=rng, opponent=opponent, opponent_factory=opponent_factory)

    monkeypatch.setattr(train_module, "generate_self_play_games", spy)
    opponent = AdvancedHeuristicAgent()

    train(
        _small_network(),
        iterations=2,
        games_per_iteration=2,
        opponent=opponent,
        rng=random.Random(12),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert seen_opponents == [opponent, opponent]


def test_train_runs_to_completion_against_a_fixed_heuristic_opponent(tmp_path: Path):
    history = train(
        _small_network(),
        iterations=2,
        games_per_iteration=2,
        opponent=AdvancedHeuristicAgent(),
        rng=random.Random(13),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert [m.iteration for m in history] == [1, 2]


def test_cli_heuristic_opponent_flag_wires_in_the_advanced_heuristic_agent(tmp_path: Path, monkeypatch):
    checkpoint_dir = tmp_path / "checkpoints"
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
            "14",
            "--heuristic-opponent",
        ],
    )

    train_module._main()

    assert (checkpoint_dir / "checkpoint_1.pt").exists()


def test_train_saves_a_training_state_file_at_the_configured_checkpoint_interval(tmp_path: Path):
    checkpoint_dir = tmp_path / "checkpoints"

    train(
        _small_network(),
        iterations=4,
        games_per_iteration=2,
        rng=random.Random(90),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=2,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert (checkpoint_dir / "training_state_2.pt").exists()
    assert (checkpoint_dir / "training_state_4.pt").exists()
    assert not (checkpoint_dir / "training_state_1.pt").exists()
    assert not (checkpoint_dir / "training_state_3.pt").exists()


def test_resume_starts_at_the_iteration_after_the_saved_one(tmp_path: Path):
    checkpoint_dir = tmp_path / "ckpt"
    net = _small_network()

    train(
        net,
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(95),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=tmp_path / "metrics.csv",
    )

    history = train(
        net,
        iterations=5,
        games_per_iteration=2,
        rng=random.Random(95),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
        resume_from=checkpoint_dir / "training_state_3.pt",
    )

    assert [m.iteration for m in history] == [4, 5]


def test_resume_requires_target_iterations_beyond_the_saved_point(tmp_path: Path):
    checkpoint_dir = tmp_path / "ckpt"
    net = _small_network()

    train(
        net,
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(70),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=tmp_path / "metrics.csv",
    )

    with pytest.raises(ValueError):
        train(
            net,
            iterations=3,
            games_per_iteration=2,
            rng=random.Random(70),
            checkpoint_dir=checkpoint_dir,
            checkpoint_every=100,
            metrics_path=tmp_path / "metrics.csv",
            resume_from=checkpoint_dir / "training_state_3.pt",
        )


def test_resume_from_a_checkpoint_only_file_raises_a_clear_error(tmp_path: Path):
    # checkpoint_*.pt is a raw state_dict (no "iteration"/"optimizer_state_dict"/etc.
    # keys) -- pointing --resume-from at one by mistake, instead of the sibling
    # training_state_*.pt, must fail with a clear message rather than a bare KeyError.
    checkpoint_dir = tmp_path / "ckpt"
    net = _small_network()

    train(
        net,
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(103),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=tmp_path / "metrics.csv",
    )

    with pytest.raises(ValueError, match="training_state"):
        train(
            net,
            iterations=6,
            games_per_iteration=2,
            rng=random.Random(103),
            checkpoint_dir=checkpoint_dir,
            checkpoint_every=100,
            metrics_path=tmp_path / "metrics.csv",
            resume_from=checkpoint_dir / "checkpoint_3.pt",
        )


def test_resume_appends_to_existing_metrics_csv_without_duplicating_the_header(tmp_path: Path):
    checkpoint_dir = tmp_path / "ckpt"
    metrics_path = tmp_path / "metrics.csv"
    net = _small_network()

    train(
        net,
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(80),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=metrics_path,
    )
    train(
        net,
        iterations=6,
        games_per_iteration=2,
        rng=random.Random(80),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=100,
        metrics_path=metrics_path,
        resume_from=checkpoint_dir / "training_state_3.pt",
    )

    lines = metrics_path.read_text().strip().splitlines()
    assert sum(1 for line in lines if line.startswith("iteration,")) == 1
    assert len(lines) == 1 + 6  # header + one row per iteration across both calls


def test_resume_can_override_the_learning_rate(tmp_path: Path):
    checkpoint_dir = tmp_path / "ckpt"
    net = _small_network()

    train(
        net,
        iterations=3,
        games_per_iteration=2,
        learning_rate=1e-3,
        rng=random.Random(60),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=tmp_path / "metrics.csv",
    )

    history = train(
        net,
        iterations=5,
        games_per_iteration=2,
        learning_rate=5e-2,
        rng=random.Random(60),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
        resume_from=checkpoint_dir / "training_state_3.pt",
    )

    assert all(m.learning_rate == pytest.approx(5e-2) for m in history)


def test_resume_reconstructs_the_cosine_schedule_continuously_across_the_interruption(tmp_path: Path):
    # A real interruption keeps the same target `iterations` across both invocations --
    # only `checkpoint_every` decides where a training_state_*.pt lands. This full run
    # doubles as the source of that mid-run checkpoint (at iteration 3) and as the
    # "what should have happened" reference for iterations 4-6.
    checkpoint_dir = tmp_path / "run"
    full_run = train(
        _small_network(),
        iterations=6,
        games_per_iteration=2,
        learning_rate=1e-3,
        lr_min=1e-4,
        rng=random.Random(50),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=checkpoint_dir / "metrics.csv",
    )

    resumed_tail = train(
        _small_network(),
        iterations=6,
        games_per_iteration=2,
        learning_rate=1e-3,
        lr_min=1e-4,
        rng=random.Random(999),  # a schedule depends only on iteration count, not rng
        checkpoint_dir=tmp_path / "resumed",
        checkpoint_every=100,
        metrics_path=tmp_path / "resumed" / "metrics.csv",
        resume_from=checkpoint_dir / "training_state_3.pt",
    )

    full_tail_lrs = [m.learning_rate for m in full_run[3:]]
    resumed_lrs = [m.learning_rate for m in resumed_tail]
    assert resumed_lrs == pytest.approx(full_tail_lrs)


def test_resuming_reconstructs_the_exact_same_final_weights_as_an_uninterrupted_run(tmp_path: Path):
    uninterrupted = _small_network()
    initial_state = {key: value.clone() for key, value in uninterrupted.state_dict().items()}

    train(
        uninterrupted,
        iterations=6,
        games_per_iteration=2,
        rng=random.Random(42),
        checkpoint_dir=tmp_path / "uninterrupted",
        checkpoint_every=100,
        metrics_path=tmp_path / "uninterrupted" / "metrics.csv",
    )

    checkpoint_dir = tmp_path / "resumed"
    first_half_net = _small_network()
    first_half_net.load_state_dict(initial_state)
    train(
        first_half_net,
        iterations=3,
        games_per_iteration=2,
        rng=random.Random(42),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=checkpoint_dir / "metrics.csv",
    )

    resumed_net = _small_network()
    train(
        resumed_net,
        iterations=6,
        games_per_iteration=2,
        rng=random.Random(999),  # deliberately wrong: resume_from's saved rng state must win
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=100,
        metrics_path=checkpoint_dir / "metrics.csv",
        resume_from=checkpoint_dir / "training_state_3.pt",
    )

    for original, resumed in zip(uninterrupted.parameters(), resumed_net.parameters()):
        assert torch.equal(original, resumed)


def test_resume_from_an_explicit_older_checkpoint_is_honored_over_a_newer_one(tmp_path: Path):
    # Both training_state_3.pt and training_state_6.pt exist by the time this finishes --
    # an explicit resume_from must pick the one it's given, not whichever is newest.
    checkpoint_dir = tmp_path / "ckpt"
    net = _small_network()
    train(
        net,
        iterations=6,
        games_per_iteration=2,
        rng=random.Random(101),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=tmp_path / "metrics.csv",
    )
    assert (checkpoint_dir / "training_state_3.pt").exists()
    assert (checkpoint_dir / "training_state_6.pt").exists()

    history = train(
        net,
        iterations=9,
        games_per_iteration=2,
        rng=random.Random(101),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
        resume_from=checkpoint_dir / "training_state_3.pt",
    )

    assert [m.iteration for m in history] == [4, 5, 6, 7, 8, 9]


def test_resume_with_a_changed_lr_min_reconstructs_the_schedule_for_the_new_target(tmp_path: Path):
    checkpoint_dir = tmp_path / "ckpt"
    net = _small_network()
    train(
        net,
        iterations=3,
        games_per_iteration=2,
        learning_rate=1e-3,
        lr_min=1e-4,
        rng=random.Random(102),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=3,
        metrics_path=tmp_path / "metrics.csv",
    )

    # Resuming with a different lr_min re-derives the cosine curve as if the new
    # eta_min (and this call's iterations=6) had applied for the whole run -- it is
    # not a splice of the old curve's shape onto a new one. For T_max=5, eta_min=5e-4,
    # base_lr=1e-3, epoch k's closed form is
    # eta_min + (base_lr - eta_min) * (1 + cos(pi * k / T_max)) / 2.
    history = train(
        net,
        iterations=6,
        games_per_iteration=2,
        learning_rate=1e-3,
        lr_min=5e-4,
        rng=random.Random(102),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
        resume_from=checkpoint_dir / "training_state_3.pt",
    )

    import math

    base_lr, eta_min, t_max = 1e-3, 5e-4, 5
    expected = [eta_min + (base_lr - eta_min) * (1 + math.cos(math.pi * k / t_max)) / 2 for k in (3, 4, 5)]
    assert [m.learning_rate for m in history] == pytest.approx(expected)


def test_find_latest_training_state_returns_the_highest_iteration_file(tmp_path: Path):
    checkpoint_dir = tmp_path / "checkpoints"

    train(
        _small_network(),
        iterations=6,
        games_per_iteration=2,
        rng=random.Random(91),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=2,
        metrics_path=tmp_path / "metrics.csv",
    )

    latest = train_module.find_latest_training_state(checkpoint_dir)

    assert latest == checkpoint_dir / "training_state_6.pt"


def test_find_latest_training_state_returns_none_when_the_directory_has_no_state_files(tmp_path: Path):
    checkpoint_dir = tmp_path / "empty"
    checkpoint_dir.mkdir()

    assert train_module.find_latest_training_state(checkpoint_dir) is None


def test_find_latest_training_state_ignores_non_conforming_filenames(tmp_path: Path):
    checkpoint_dir = tmp_path / "checkpoints"

    train(
        _small_network(),
        iterations=4,
        games_per_iteration=2,
        rng=random.Random(104),
        checkpoint_dir=checkpoint_dir,
        checkpoint_every=2,
        metrics_path=tmp_path / "metrics.csv",
    )
    # A manually-copied backup with a non-integer suffix must not crash the lookup.
    (checkpoint_dir / "training_state_backup.pt").write_bytes(b"not a real checkpoint")

    latest = train_module.find_latest_training_state(checkpoint_dir)

    assert latest == checkpoint_dir / "training_state_4.pt"


def test_cli_resume_from_flag_continues_training_past_the_saved_iteration(tmp_path: Path, monkeypatch):
    checkpoint_dir = tmp_path / "checkpoints"
    metrics_path = checkpoint_dir / "metrics.csv"

    def run_cli(extra_args: list[str]) -> None:
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "train.py",
                "--iterations",
                "3",
                "--games-per-iteration",
                "2",
                "--checkpoint-dir",
                str(checkpoint_dir),
                "--checkpoint-every",
                "3",
                "--metrics-path",
                str(metrics_path),
                "--seed",
                "42",
            ]
            + extra_args,
        )
        train_module._main()

    run_cli([])
    run_cli(["--iterations", "5", "--resume-from", str(checkpoint_dir / "training_state_3.pt")])

    assert (checkpoint_dir / "checkpoint_5.pt").exists()
    lines = metrics_path.read_text().strip().splitlines()
    assert len(lines) == 1 + 5


def test_cli_resume_flag_auto_discovers_the_latest_training_state_file(tmp_path: Path, monkeypatch):
    checkpoint_dir = tmp_path / "checkpoints"
    metrics_path = checkpoint_dir / "metrics.csv"

    def run_cli(extra_args: list[str]) -> None:
        monkeypatch.setattr(
            sys,
            "argv",
            [
                "train.py",
                "--iterations",
                "3",
                "--games-per-iteration",
                "2",
                "--checkpoint-dir",
                str(checkpoint_dir),
                "--checkpoint-every",
                "3",
                "--metrics-path",
                str(metrics_path),
                "--seed",
                "42",
            ]
            + extra_args,
        )
        train_module._main()

    run_cli([])
    run_cli(["--iterations", "5", "--resume"])

    assert (checkpoint_dir / "checkpoint_5.pt").exists()


def test_cli_resume_flag_errors_clearly_when_no_training_state_file_exists(tmp_path: Path, monkeypatch):
    checkpoint_dir = tmp_path / "checkpoints"
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "train.py",
            "--iterations",
            "3",
            "--games-per-iteration",
            "2",
            "--checkpoint-dir",
            str(checkpoint_dir),
            "--checkpoint-every",
            "3",
            "--metrics-path",
            str(checkpoint_dir / "metrics.csv"),
            "--resume",
        ],
    )

    with pytest.raises(SystemExit):
        train_module._main()


def test_sample_pool_mix_opponent_only_returns_heuristics_when_pool_is_empty():
    pool = OpponentPool()
    rng = random.Random(0)

    seen_types = {type(train_module._sample_pool_mix_opponent(pool, rng)) for _ in range(30)}

    assert seen_types == {HeuristicOpponentAdapter, AdvancedHeuristicAgent}


def test_sample_pool_mix_opponent_can_draw_a_policy_opponent_once_the_pool_is_non_empty():
    pool = OpponentPool()
    pool.add(_small_network())
    rng = random.Random(1)

    seen_types = {type(train_module._sample_pool_mix_opponent(pool, rng)) for _ in range(60)}

    assert PolicyOpponent in seen_types
    assert seen_types <= {HeuristicOpponentAdapter, AdvancedHeuristicAgent, PolicyOpponent}


def test_train_forwards_an_opponent_factory_when_opponent_pool_is_set(tmp_path: Path, monkeypatch):
    seen_factories = []
    real_generate = train_module.generate_self_play_games

    def spy(network, num_games, rng=None, opponent=None, opponent_factory=None):
        seen_factories.append(opponent_factory)
        return real_generate(network, num_games, rng=rng, opponent=opponent, opponent_factory=opponent_factory)

    monkeypatch.setattr(train_module, "generate_self_play_games", spy)
    pool = OpponentPool()
    pool.add(_small_network())

    train(
        _small_network(),
        iterations=2,
        games_per_iteration=2,
        opponent_pool=pool,
        rng=random.Random(15),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert len(seen_factories) == 2
    assert all(factory is not None for factory in seen_factories)


def test_train_adds_a_snapshot_to_the_opponent_pool_at_each_checkpoint_interval(tmp_path: Path):
    pool = OpponentPool()

    train(
        _small_network(),
        iterations=4,
        games_per_iteration=2,
        opponent_pool=pool,
        rng=random.Random(16),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=2,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert len(pool) == 2  # one snapshot added at iteration 2, one at iteration 4


def test_train_runs_to_completion_with_an_initially_empty_opponent_pool(tmp_path: Path):
    history = train(
        _small_network(),
        iterations=2,
        games_per_iteration=2,
        opponent_pool=OpponentPool(),
        rng=random.Random(17),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert [m.iteration for m in history] == [1, 2]


def test_cli_opponent_pool_flag_runs_to_completion(tmp_path: Path, monkeypatch):
    checkpoint_dir = tmp_path / "checkpoints"
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
            "18",
            "--opponent-pool",
        ],
    )

    train_module._main()

    assert (checkpoint_dir / "checkpoint_1.pt").exists()


def test_cli_opponent_pool_seed_preloads_the_pool_before_training_starts(tmp_path: Path, monkeypatch):
    seed_dir = tmp_path / "seed_ckpt"
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
            str(seed_dir),
            "--checkpoint-every",
            "1",
            "--metrics-path",
            str(seed_dir / "metrics.csv"),
            "--seed",
            "19",
        ],
    )
    train_module._main()
    seed_checkpoint = seed_dir / "checkpoint_1.pt"

    checkpoint_dir = tmp_path / "checkpoints"
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
            "20",
            "--opponent-pool",
            "--opponent-pool-seed",
            str(seed_checkpoint),
        ],
    )

    train_module._main()

    assert (checkpoint_dir / "checkpoint_1.pt").exists()


def test_cli_rejects_combining_heuristic_opponent_and_opponent_pool_flags(monkeypatch):
    monkeypatch.setattr(
        sys,
        "argv",
        ["train.py", "--iterations", "1", "--heuristic-opponent", "--opponent-pool"],
    )

    with pytest.raises(SystemExit):
        train_module._main()


def test_train_calls_compute_ppo_loss_ppo_epochs_times_per_iteration(tmp_path: Path, monkeypatch):
    calls = []
    real_compute_ppo_loss = train_module.compute_ppo_loss

    def spy(network, episodes, reward_scale=100.0, entropy_coef=0.0, clip_epsilon=0.2):
        calls.append(1)
        return real_compute_ppo_loss(
            network, episodes, reward_scale=reward_scale, entropy_coef=entropy_coef, clip_epsilon=clip_epsilon
        )

    monkeypatch.setattr(train_module, "compute_ppo_loss", spy)

    train(
        _small_network(),
        iterations=3,
        games_per_iteration=2,
        ppo_epochs=4,
        rng=random.Random(70),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert len(calls) == 3 * 4


def test_train_runs_to_completion_with_ppo_epochs_set(tmp_path: Path):
    history = train(
        _small_network(),
        iterations=2,
        games_per_iteration=2,
        ppo_epochs=3,
        rng=random.Random(71),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    assert [m.iteration for m in history] == [1, 2]


def test_training_changes_parameters_when_using_ppo_epochs(tmp_path: Path):
    network = _small_network()
    before = [p.detach().clone() for p in network.parameters()]

    train(
        network,
        iterations=2,
        games_per_iteration=3,
        ppo_epochs=3,
        rng=random.Random(72),
        checkpoint_dir=tmp_path / "checkpoints",
        checkpoint_every=100,
        metrics_path=tmp_path / "metrics.csv",
    )

    after = list(network.parameters())
    assert any(not torch.equal(b, a) for b, a in zip(before, after))


def test_cli_ppo_epochs_and_clip_epsilon_flags_run_to_completion(tmp_path: Path, monkeypatch):
    checkpoint_dir = tmp_path / "checkpoints"
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
            "80",
            "--ppo-epochs",
            "3",
            "--clip-epsilon",
            "0.15",
        ],
    )

    train_module._main()

    assert (checkpoint_dir / "checkpoint_1.pt").exists()


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


# ---------------------------------------------------------------------------
# load_warm_start_state_dict -- curriculum-stage warm-start (ACTION_DIM growth)
# ---------------------------------------------------------------------------


def test_load_warm_start_state_dict_loads_every_parameter_when_shapes_are_unchanged(tmp_path: Path):
    source = TichuPolicyValueNet(hidden_dim=16, embedding_dim=8, action_dim=10)
    torch.save(source.state_dict(), tmp_path / "checkpoint.pt")
    target = TichuPolicyValueNet(hidden_dim=16, embedding_dim=8, action_dim=10)

    skipped = load_warm_start_state_dict(target, tmp_path / "checkpoint.pt")

    assert skipped == []
    for source_param, target_param in zip(source.parameters(), target.parameters()):
        assert torch.equal(source_param, target_param)


def test_load_warm_start_state_dict_skips_only_the_action_encoders_input_layer_when_action_dim_grows(
    tmp_path: Path,
):
    source = TichuPolicyValueNet(hidden_dim=16, embedding_dim=8, action_dim=10)
    torch.save(source.state_dict(), tmp_path / "checkpoint.pt")
    target = TichuPolicyValueNet(hidden_dim=16, embedding_dim=8, action_dim=12)

    skipped = load_warm_start_state_dict(target, tmp_path / "checkpoint.pt")

    # Only the input layer's *weight* actually depends on action_dim -- its
    # bias is shaped (hidden_dim,) regardless, so it loads unchanged like
    # everything else.
    assert set(skipped) == {"action_encoder.0.weight"}
    assert target.action_encoder[0].weight.shape == (16, 12)
    assert torch.equal(target.action_encoder[0].bias, source.action_encoder[0].bias)
    assert torch.equal(target.state_encoder[0].weight, source.state_encoder[0].weight)
    assert torch.equal(target.action_encoder[2].weight, source.action_encoder[2].weight)
    assert torch.equal(target.action_scorer[0].weight, source.action_scorer[0].weight)
    assert torch.equal(target.value_head[0].weight, source.value_head[0].weight)


def test_migrate_action_encoder_input_layer_preserves_all_but_the_newly_inserted_columns(tmp_path: Path):
    # Mirrors this project's real ACTION_DIM history: 69 -> 71, with PASS kept as
    # the very last column in both layouts and the 2 new large-Tichu flag
    # columns inserted just before it (see tichu_env/encoding.py). Columns
    # 0..67 keep the same meaning at the same position in both layouts; only
    # PASS moves (from old index 68 to new index 70).
    source = TichuPolicyValueNet(hidden_dim=4, embedding_dim=4, action_dim=69)
    with torch.no_grad():
        source.action_encoder[0].weight.copy_(torch.arange(4 * 69, dtype=torch.float32).reshape(4, 69))
    torch.save(source.state_dict(), tmp_path / "checkpoint.pt")

    target = TichuPolicyValueNet(hidden_dim=4, embedding_dim=4, action_dim=71)
    gap_before = target.action_encoder[0].weight[:, 68:70].clone()

    migrate_action_encoder_input_layer(target, tmp_path / "checkpoint.pt")

    assert torch.equal(target.action_encoder[0].weight[:, :68], source.action_encoder[0].weight[:, :68])
    assert torch.equal(target.action_encoder[0].weight[:, -1], source.action_encoder[0].weight[:, -1])
    # The 2 newly inserted columns (large-Tichu call/decline) have no old
    # counterpart -- they must be left exactly as freshly initialized.
    assert torch.equal(target.action_encoder[0].weight[:, 68:70], gap_before)


def test_migrate_action_encoder_input_layer_is_a_noop_when_action_dim_is_unchanged(tmp_path: Path):
    source = TichuPolicyValueNet(hidden_dim=4, embedding_dim=4, action_dim=10)
    torch.save(source.state_dict(), tmp_path / "checkpoint.pt")
    target = TichuPolicyValueNet(hidden_dim=4, embedding_dim=4, action_dim=10)
    before = target.action_encoder[0].weight.clone()

    migrate_action_encoder_input_layer(target, tmp_path / "checkpoint.pt")

    assert torch.equal(target.action_encoder[0].weight, before)


def test_cli_warm_start_from_loads_a_prior_checkpoint_before_training(tmp_path: Path, monkeypatch):
    seed_checkpoint = tmp_path / "seed_checkpoint.pt"
    torch.save(TichuPolicyValueNet().state_dict(), seed_checkpoint)

    checkpoint_dir = tmp_path / "checkpoints"
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
            "16",
            "--warm-start-from",
            str(seed_checkpoint),
        ],
    )

    train_module._main()

    assert (checkpoint_dir / "checkpoint_1.pt").exists()
