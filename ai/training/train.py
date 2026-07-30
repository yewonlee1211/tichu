from __future__ import annotations

import csv
import random
import warnings
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import optim

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.policy_network import TichuPolicyValueNet
from training.self_play import Transition, generate_self_play_games

DEFAULT_CHECKPOINT_DIR = Path("checkpoints")
DEFAULT_METRICS_PATH = Path("checkpoints/metrics.csv")


@dataclass(frozen=True)
class IterationMetrics:
    iteration: int
    games: int
    mean_return: float
    policy_loss: float
    value_loss: float
    mean_entropy: float
    learning_rate: float


DEFAULT_REWARD_SCALE = 100.0
DEFAULT_ENTROPY_COEF = 0.0


_REQUIRED_TRAINING_STATE_KEYS = {"iteration", "model_state_dict", "optimizer_state_dict", "rng_state"}


def _training_state_path(checkpoint_dir: Path, iteration: int) -> Path:
    return checkpoint_dir / f"training_state_{iteration}.pt"


def _atomic_torch_save(obj: object, path: Path) -> None:
    """Saves via a same-directory temp file + rename so a process killed mid-write
    leaves the previous (or no) file at `path` rather than a truncated one -- a
    corrupt training_state_*.pt would otherwise silently block every future resume
    attempt that lands on it."""
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    torch.save(obj, tmp_path)
    tmp_path.replace(path)


def find_latest_training_state(checkpoint_dir: Path) -> Path | None:
    """Returns the highest-iteration `training_state_*.pt` file in `checkpoint_dir`, or
    `None` if none exist. Backs the CLI's `--resume` convenience flag so a crashed run
    can be continued without the caller needing to know the exact iteration number it
    last reached. Files whose name doesn't parse as `training_state_<int>.pt` (e.g. a
    manually copied backup) are ignored rather than crashing the lookup."""
    numbered_candidates: list[tuple[int, Path]] = []
    for path in checkpoint_dir.glob("training_state_*.pt"):
        try:
            iteration = int(path.stem.removeprefix("training_state_"))
        except ValueError:
            continue
        numbered_candidates.append((iteration, path))

    if not numbered_candidates:
        return None
    return max(numbered_candidates, key=lambda pair: pair[0])[1]


def compute_reinforce_loss(
    network: TichuPolicyValueNet,
    episodes: list[list[Transition]],
    reward_scale: float = DEFAULT_REWARD_SCALE,
    entropy_coef: float = DEFAULT_ENTROPY_COEF,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, float, float]:
    """Returns (policy_loss, value_loss, total_loss, mean_return, mean_entropy) for one
    batch of self-play episodes, using REINFORCE with a learned value baseline. A round
    has no intermediate rewards (see training.self_play.Transition), so every transition
    in a trajectory shares the same Monte Carlo return: that trajectory's final reward.

    Team-score-scale returns (roughly -400..+400, from Tichu/Large Tichu bonuses and
    double wins) make for badly-scaled squared-error gradients on the value head, so the
    return is divided by `reward_scale` before it's used in either loss term. `mean_return`
    is still reported in the original, human-readable score units.

    `entropy_coef` subtracts `entropy_coef * mean_entropy` from `total_loss`, encouraging
    the policy to stay stochastic rather than collapsing onto a narrow set of actions
    early and losing the exploration self-play training depends on.

    Every transition across every trajectory is scored in one call to
    `network.forward_batch` rather than one `network.forward` call per transition --
    with ~20 transitions per game and dozens of games per iteration, a per-transition
    Python loop through the network turns into thousands of tiny matmuls that autograd
    then has to retrace node-by-node on `.backward()`."""
    transitions: list[Transition] = []
    raw_returns: list[float] = []
    for trajectory in episodes:
        if not trajectory:
            continue
        raw_return = trajectory[-1].reward
        transitions.extend(trajectory)
        raw_returns.extend([raw_return] * len(trajectory))

    scaled_returns = torch.tensor([r / reward_scale for r in raw_returns], dtype=torch.float32)

    obs_batch = torch.as_tensor(np.stack([t.observation for t in transitions]), dtype=torch.float32)
    action_vectors = torch.as_tensor(
        np.concatenate([t.action_vectors for t in transitions], axis=0), dtype=torch.float32
    )
    action_counts = torch.tensor([t.action_vectors.shape[0] for t in transitions], dtype=torch.long)

    output = network.forward_batch(obs_batch, action_vectors, action_counts)
    logits_per_transition = torch.split(output.action_logits, action_counts.tolist())

    policy_losses: list[torch.Tensor] = []
    entropies: list[torch.Tensor] = []
    advantages = scaled_returns - output.state_values.detach()
    for logits, transition, advantage in zip(logits_per_transition, transitions, advantages):
        log_probs = torch.log_softmax(logits, dim=-1)
        chosen_log_prob = log_probs[transition.chosen_index]
        policy_losses.append(-chosen_log_prob * advantage)
        entropies.append(-(log_probs.exp() * log_probs).sum())

    policy_loss = torch.stack(policy_losses).mean()
    value_loss = ((output.state_values - scaled_returns) ** 2).mean()
    entropy = torch.stack(entropies).mean()
    total_loss = policy_loss + value_loss - entropy_coef * entropy
    mean_return = sum(raw_returns) / len(raw_returns)
    return policy_loss, value_loss, total_loss, mean_return, entropy.item()


def train(
    network: TichuPolicyValueNet,
    iterations: int,
    games_per_iteration: int = 20,
    learning_rate: float = 1e-3,
    reward_scale: float = DEFAULT_REWARD_SCALE,
    entropy_coef: float = DEFAULT_ENTROPY_COEF,
    lr_min: float | None = None,
    opponent: object | None = None,
    rng: random.Random | None = None,
    checkpoint_dir: Path = DEFAULT_CHECKPOINT_DIR,
    checkpoint_every: int = 10,
    metrics_path: Path = DEFAULT_METRICS_PATH,
    resume_from: Path | None = None,
) -> list[IterationMetrics]:
    """Runs the self-play -> REINFORCE update loop for `iterations` steps. Each
    iteration generates `games_per_iteration` fresh self-play games with the network's
    *current* parameters (on-policy), takes one gradient step on the combined
    policy+value loss, appends a row to `metrics_path`, and saves a checkpoint every
    `checkpoint_every` iterations (always including the final one).

    `lr_min`, if set, anneals the learning rate from `learning_rate` down to `lr_min`
    over the run via cosine decay (`learning_rate` at iteration 1, `lr_min` at the final
    iteration). Left `None`, the learning rate stays constant -- the run1 baseline
    behavior.

    `opponent`, if set, is forwarded to `generate_self_play_games` and takes over
    team1's seats every game (see `training.self_play.play_self_play_round`); only
    team0's transitions -- the network's own -- ever feed the loss. Left `None`,
    `network` mirrors itself at all 4 seats, as before.

    `resume_from`, if set, points to a `training_state_*.pt` file saved by an earlier
    call (alongside that iteration's `checkpoint_*.pt`, at the same `checkpoint_every`
    interval). It restores `network`'s weights, the optimizer's momentum, and `rng`'s
    state exactly as they were right after that iteration, then continues from the next
    iteration onward. `iterations` is always the *absolute* final iteration to reach,
    not an additional count on top of the saved one -- so running iterations=6
    uninterrupted, or running iterations=3 and then resuming with iterations=6, land on
    identical final weights.

    `learning_rate`, `entropy_coef`, and `reward_scale` always take whatever value is
    passed to *this* call, even when resuming -- so resuming with a changed value
    switches training onto the new hyperparameter starting with the very next
    iteration, while the optimizer's momentum and the self-play RNG stream carry over
    unbroken. `lr_min` behaves the same way for the value itself, but because a cosine
    schedule needs a full curve shape to evaluate, changing it on resume reconstructs
    the schedule as if the new `lr_min` (and current `iterations`) had applied for the
    *entire* run, purely to derive the correct internal position to continue from --
    iterations 1..N's already-recorded history is untouched, but the new curve is not a
    clean splice of "old shape then new shape"."""
    rng = rng if rng is not None else random.Random()

    resumed_state = None
    start_iteration = 1
    if resume_from is not None:
        # Trusted load: resume_from is always expected to be a training_state_*.pt this
        # same module wrote via _atomic_torch_save below, never an arbitrary/untrusted
        # file -- weights_only=False is required to deserialize the optimizer/rng state
        # bundled alongside the tensors.
        resumed_state = torch.load(resume_from, weights_only=False)
        missing_keys = _REQUIRED_TRAINING_STATE_KEYS - resumed_state.keys()
        if missing_keys:
            raise ValueError(
                f"resume_from ({resume_from}) is missing expected key(s) {sorted(missing_keys)} -- "
                "is this a checkpoint_*.pt file (model weights only) instead of a training_state_*.pt file?"
            )
        network.load_state_dict(resumed_state["model_state_dict"])
        rng.setstate(resumed_state["rng_state"])
        start_iteration = resumed_state["iteration"] + 1
        if start_iteration > iterations:
            raise ValueError(
                f"resume_from ({resume_from}) is already at iteration {resumed_state['iteration']}, "
                f"which is not before the requested iterations={iterations}"
            )

    optimizer = optim.Adam(network.parameters(), lr=learning_rate)
    if resumed_state is not None:
        optimizer.load_state_dict(resumed_state["optimizer_state_dict"])
    for group in optimizer.param_groups:
        group["lr"] = learning_rate
        group["initial_lr"] = learning_rate

    scheduler = (
        optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=max(iterations - 1, 1), eta_min=lr_min)
        if lr_min is not None
        else None
    )
    if scheduler is not None:
        # Reconstructing at `last_epoch=start_iteration - 2` looks tempting but is
        # unreliable: CosineAnnealingLR's very first post-construction lr just echoes
        # back whatever `lr` is currently set (harmless for a fresh run, where that
        # happens to equal the correct epoch-0 value, but wrong for any other epoch).
        # Fast-forwarding with real .step() calls instead walks the same recursive path
        # an uninterrupted run would have, so it reproduces that run's schedule exactly.
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            for _ in range(start_iteration - 1):
                scheduler.step()
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)

    history: list[IterationMetrics] = []
    write_header = not (metrics_path.exists() and metrics_path.stat().st_size > 0)
    with metrics_path.open("w" if write_header else "a", newline="") as metrics_file:
        writer = csv.writer(metrics_file)
        if write_header:
            writer.writerow(
                ["iteration", "games", "mean_return", "policy_loss", "value_loss", "mean_entropy", "learning_rate"]
            )

        for iteration in range(start_iteration, iterations + 1):
            current_lr = optimizer.param_groups[0]["lr"]
            episodes = generate_self_play_games(network, games_per_iteration, rng=rng, opponent=opponent)
            policy_loss, value_loss, total_loss, mean_return, mean_entropy = compute_reinforce_loss(
                network, episodes, reward_scale=reward_scale, entropy_coef=entropy_coef
            )

            optimizer.zero_grad()
            total_loss.backward()
            optimizer.step()
            if scheduler is not None:
                scheduler.step()

            metrics = IterationMetrics(
                iteration=iteration,
                games=games_per_iteration,
                mean_return=mean_return,
                policy_loss=policy_loss.item(),
                value_loss=value_loss.item(),
                mean_entropy=mean_entropy,
                learning_rate=current_lr,
            )
            history.append(metrics)
            writer.writerow(
                [
                    metrics.iteration,
                    metrics.games,
                    metrics.mean_return,
                    metrics.policy_loss,
                    metrics.value_loss,
                    metrics.mean_entropy,
                    metrics.learning_rate,
                ]
            )
            metrics_file.flush()

            if iteration % checkpoint_every == 0 or iteration == iterations:
                _atomic_torch_save(network.state_dict(), checkpoint_dir / f"checkpoint_{iteration}.pt")
                _atomic_torch_save(
                    {
                        "iteration": iteration,
                        "model_state_dict": network.state_dict(),
                        "optimizer_state_dict": optimizer.state_dict(),
                        "rng_state": rng.getstate(),
                    },
                    _training_state_path(checkpoint_dir, iteration),
                )

    return history


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Self-play REINFORCE training loop for the Tichu policy/value net.")
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--games-per-iteration", type=int, default=20)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--reward-scale", type=float, default=DEFAULT_REWARD_SCALE)
    parser.add_argument("--entropy-coef", type=float, default=DEFAULT_ENTROPY_COEF)
    parser.add_argument(
        "--lr-min", type=float, default=None, help="Cosine-anneal the learning rate down to this value."
    )
    parser.add_argument(
        "--heuristic-opponent",
        action="store_true",
        help="Fix team1's seats to AdvancedHeuristicAgent instead of mirroring the network.",
    )
    parser.add_argument("--checkpoint-dir", type=Path, default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--checkpoint-every", type=int, default=10)
    parser.add_argument("--metrics-path", type=Path, default=DEFAULT_METRICS_PATH)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument(
        "--resume",
        action="store_true",
        help="Resume from the latest training_state_*.pt found in --checkpoint-dir.",
    )
    parser.add_argument(
        "--resume-from",
        type=Path,
        default=None,
        help="Resume from a specific training_state_*.pt file (overrides --resume).",
    )
    args = parser.parse_args()

    resume_from = args.resume_from
    if resume_from is None and args.resume:
        resume_from = find_latest_training_state(args.checkpoint_dir)
        if resume_from is None:
            parser.error(f"--resume was given but no training_state_*.pt file exists in {args.checkpoint_dir}")

    if args.seed is not None:
        torch.manual_seed(args.seed)
    network = TichuPolicyValueNet()
    rng = random.Random(args.seed) if args.seed is not None else None
    opponent = AdvancedHeuristicAgent() if args.heuristic_opponent else None
    history = train(
        network,
        iterations=args.iterations,
        games_per_iteration=args.games_per_iteration,
        learning_rate=args.learning_rate,
        reward_scale=args.reward_scale,
        entropy_coef=args.entropy_coef,
        lr_min=args.lr_min,
        opponent=opponent,
        rng=rng,
        checkpoint_dir=args.checkpoint_dir,
        checkpoint_every=args.checkpoint_every,
        metrics_path=args.metrics_path,
        resume_from=resume_from,
    )
    last = history[-1]
    print(
        f"iteration {last.iteration}: mean_return={last.mean_return:.2f} "
        f"policy_loss={last.policy_loss:.4f} value_loss={last.value_loss:.4f} "
        f"mean_entropy={last.mean_entropy:.4f} learning_rate={last.learning_rate:.6f}"
    )


if __name__ == "__main__":
    _main()
