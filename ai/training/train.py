from __future__ import annotations

import csv
import random
from dataclasses import dataclass
from pathlib import Path

import torch
from torch import optim

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


def compute_reinforce_loss(
    network: TichuPolicyValueNet, episodes: list[list[Transition]]
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, float]:
    """Returns (policy_loss, value_loss, total_loss, mean_return) for one batch of
    self-play episodes, using REINFORCE with a learned value baseline. A round has no
    intermediate rewards (see training.self_play.Transition), so every transition in a
    trajectory shares the same Monte Carlo return: that trajectory's final reward."""
    policy_losses: list[torch.Tensor] = []
    value_losses: list[torch.Tensor] = []
    returns: list[float] = []

    for trajectory in episodes:
        if not trajectory:
            continue
        episode_return = trajectory[-1].reward
        for transition in trajectory:
            obs = torch.as_tensor(transition.observation, dtype=torch.float32)
            action_vectors = torch.as_tensor(transition.action_vectors, dtype=torch.float32)
            output = network(obs, action_vectors)

            log_probs = torch.log_softmax(output.action_logits, dim=-1)
            chosen_log_prob = log_probs[transition.chosen_index]
            advantage = episode_return - output.state_value.detach()

            policy_losses.append(-chosen_log_prob * advantage)
            value_losses.append((output.state_value - episode_return) ** 2)
            returns.append(episode_return)

    policy_loss = torch.stack(policy_losses).mean()
    value_loss = torch.stack(value_losses).mean()
    total_loss = policy_loss + value_loss
    mean_return = sum(returns) / len(returns)
    return policy_loss, value_loss, total_loss, mean_return


def train(
    network: TichuPolicyValueNet,
    iterations: int,
    games_per_iteration: int = 20,
    learning_rate: float = 1e-3,
    rng: random.Random | None = None,
    checkpoint_dir: Path = DEFAULT_CHECKPOINT_DIR,
    checkpoint_every: int = 10,
    metrics_path: Path = DEFAULT_METRICS_PATH,
) -> list[IterationMetrics]:
    """Runs the self-play -> REINFORCE update loop for `iterations` steps. Each
    iteration generates `games_per_iteration` fresh self-play games with the network's
    *current* parameters (on-policy), takes one gradient step on the combined
    policy+value loss, appends a row to `metrics_path`, and saves a checkpoint every
    `checkpoint_every` iterations (always including the final one)."""
    rng = rng if rng is not None else random.Random()
    optimizer = optim.Adam(network.parameters(), lr=learning_rate)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    metrics_path.parent.mkdir(parents=True, exist_ok=True)

    history: list[IterationMetrics] = []
    with metrics_path.open("w", newline="") as metrics_file:
        writer = csv.writer(metrics_file)
        writer.writerow(["iteration", "games", "mean_return", "policy_loss", "value_loss"])

        for iteration in range(1, iterations + 1):
            episodes = generate_self_play_games(network, games_per_iteration, rng=rng)
            policy_loss, value_loss, total_loss, mean_return = compute_reinforce_loss(network, episodes)

            optimizer.zero_grad()
            total_loss.backward()
            optimizer.step()

            metrics = IterationMetrics(
                iteration=iteration,
                games=games_per_iteration,
                mean_return=mean_return,
                policy_loss=policy_loss.item(),
                value_loss=value_loss.item(),
            )
            history.append(metrics)
            writer.writerow(
                [metrics.iteration, metrics.games, metrics.mean_return, metrics.policy_loss, metrics.value_loss]
            )
            metrics_file.flush()

            if iteration % checkpoint_every == 0 or iteration == iterations:
                torch.save(network.state_dict(), checkpoint_dir / f"checkpoint_{iteration}.pt")

    return history


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Self-play REINFORCE training loop for the Tichu policy/value net.")
    parser.add_argument("--iterations", type=int, default=20)
    parser.add_argument("--games-per-iteration", type=int, default=20)
    parser.add_argument("--learning-rate", type=float, default=1e-3)
    parser.add_argument("--checkpoint-dir", type=Path, default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--checkpoint-every", type=int, default=10)
    parser.add_argument("--metrics-path", type=Path, default=DEFAULT_METRICS_PATH)
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    network = TichuPolicyValueNet()
    rng = random.Random(args.seed) if args.seed is not None else None
    history = train(
        network,
        iterations=args.iterations,
        games_per_iteration=args.games_per_iteration,
        learning_rate=args.learning_rate,
        rng=rng,
        checkpoint_dir=args.checkpoint_dir,
        checkpoint_every=args.checkpoint_every,
        metrics_path=args.metrics_path,
    )
    last = history[-1]
    print(
        f"iteration {last.iteration}: mean_return={last.mean_return:.2f} "
        f"policy_loss={last.policy_loss:.4f} value_loss={last.value_loss:.4f}"
    )


if __name__ == "__main__":
    _main()
