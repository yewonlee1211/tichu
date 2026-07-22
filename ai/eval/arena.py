from __future__ import annotations

import math
import random
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import torch

from tichu_env.combinations import Combo
from tichu_env.env import StepResult, TichuEnv

from agents.heuristic import HeuristicAgent
from agents.policy_network import TichuPolicyValueNet

SeatChooser = Callable[[StepResult], "Combo | None"]

DEFAULT_CHECKPOINT_DIR = Path("checkpoints")
_ELO_CLIP_EPS = 1e-3


@dataclass(frozen=True)
class ArenaResult:
    games: int
    team_a_wins: int
    team_b_wins: int
    draws: int
    team_a_win_rate: float
    team_a_elo_diff: float


def load_checkpoint(path: Path, **network_kwargs) -> TichuPolicyValueNet:
    """Loads a `train.py`-produced `checkpoint_*.pt` into a fresh, eval-mode network.
    `network_kwargs` must match the architecture the checkpoint was saved with
    (hidden_dim/embedding_dim) if it differs from the defaults."""
    network = TichuPolicyValueNet(**network_kwargs)
    network.load_state_dict(torch.load(path, weights_only=True))
    network.eval()
    return network


def policy_chooser(network: TichuPolicyValueNet, *, deterministic: bool = True) -> SeatChooser:
    """Builds a seat-chooser from a policy network. Arena play defaults to the
    network's best move (argmax over candidate logits) rather than sampling --
    evaluation measures the policy's actual strength, not the exploration
    behaviour self-play needs during training. Pass `deterministic=False` to
    sample instead, e.g. to see the same checkpoint's variance across games."""

    def choose(result: StepResult) -> Combo | None:
        combos = [combo for combo, _ in result.legal_actions]
        action_vectors = torch.as_tensor(
            np.stack([vec for _, vec in result.legal_actions]), dtype=torch.float32
        )
        obs = torch.as_tensor(result.observation, dtype=torch.float32)
        with torch.no_grad():
            output = network(obs, action_vectors)
        if deterministic:
            index = int(torch.argmax(output.action_logits).item())
        else:
            probs = torch.softmax(output.action_logits, dim=-1).tolist()
            index = random.choices(range(len(combos)), weights=probs, k=1)[0]
        return combos[index]

    return choose


def heuristic_chooser(agent: HeuristicAgent | None = None) -> SeatChooser:
    agent = agent if agent is not None else HeuristicAgent()
    return lambda result: agent.choose_action(result.legal_actions)


def play_arena_round(env: TichuEnv, seat_choosers: dict[int, SeatChooser]) -> tuple[int, int]:
    """Plays one round to completion, letting each seat's chooser pick every
    one of its turns, and returns that round's (team0_delta, team1_delta)."""
    result = env.reset()
    while not result.done:
        combo = seat_choosers[result.player](result)
        result = env.step(combo)
    return result.info["team_scores"]


def run_arena(
    team_a_chooser: SeatChooser,
    team_b_chooser: SeatChooser,
    games: int,
    rng: random.Random | None = None,
) -> ArenaResult:
    """Plays `games` rounds with `team_a_chooser` at seats 0 and 2 (team 0) and
    `team_b_chooser` at seats 1 and 3 (team 1). Reports team A's win rate and an
    Elo rating gap estimated from that win rate via the standard performance-rating
    formula (assuming both sides started at equal rating). The exact target win
    rate/Elo threshold is intentionally left open per the plan -- this is meant to
    let you observe an improvement *trend* across checkpoints, not pass/fail a
    fixed bar."""
    rng = rng if rng is not None else random.Random()
    env = TichuEnv(rng=rng)
    seat_choosers = {0: team_a_chooser, 1: team_b_chooser, 2: team_a_chooser, 3: team_b_chooser}

    team_a_wins = 0
    team_b_wins = 0
    draws = 0
    for _ in range(games):
        team0_delta, team1_delta = play_arena_round(env, seat_choosers)
        if team0_delta > team1_delta:
            team_a_wins += 1
        elif team0_delta < team1_delta:
            team_b_wins += 1
        else:
            draws += 1

    win_rate = team_a_wins / games
    score = (team_a_wins + 0.5 * draws) / games
    elo_diff = _elo_diff_from_win_rate(score)

    return ArenaResult(
        games=games,
        team_a_wins=team_a_wins,
        team_b_wins=team_b_wins,
        draws=draws,
        team_a_win_rate=win_rate,
        team_a_elo_diff=elo_diff,
    )


def _elo_diff_from_win_rate(score: float) -> float:
    """Standard performance-rating estimate of the Elo gap implied by a score
    (wins + 0.5*draws, over N games), clipped away from the 0/1 boundary so a
    small smoke-test sample size never divides by zero or returns +/-inf."""
    clipped = min(max(score, _ELO_CLIP_EPS), 1 - _ELO_CLIP_EPS)
    return -400.0 * math.log10(1.0 / clipped - 1.0)


def _resolve_checkpoint(spec: str, checkpoint_dir: Path) -> Path:
    if spec != "latest":
        return Path(spec)
    candidates = sorted(checkpoint_dir.glob("checkpoint_*.pt"), key=lambda p: p.stat().st_mtime)
    if not candidates:
        raise FileNotFoundError(f"no checkpoint_*.pt files found in {checkpoint_dir}")
    return candidates[-1]


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(
        description="Evaluate a Tichu policy checkpoint against a heuristic baseline or another checkpoint."
    )
    parser.add_argument("--checkpoint", required=True, help="Checkpoint path, or 'latest' for the newest in --checkpoint-dir.")
    parser.add_argument("--opponent", default="heuristic", help="'heuristic', a checkpoint path, or 'latest'.")
    parser.add_argument("--checkpoint-dir", type=Path, default=DEFAULT_CHECKPOINT_DIR)
    parser.add_argument("--games", type=int, default=100)
    parser.add_argument("--stochastic", action="store_true", help="Sample actions instead of playing the argmax move.")
    parser.add_argument("--seed", type=int, default=None)
    args = parser.parse_args()

    checkpoint_path = _resolve_checkpoint(args.checkpoint, args.checkpoint_dir)
    team_a_chooser = policy_chooser(load_checkpoint(checkpoint_path), deterministic=not args.stochastic)

    if args.opponent == "heuristic":
        team_b_chooser = heuristic_chooser()
    else:
        opponent_path = _resolve_checkpoint(args.opponent, args.checkpoint_dir)
        team_b_chooser = policy_chooser(load_checkpoint(opponent_path), deterministic=not args.stochastic)

    rng = random.Random(args.seed) if args.seed is not None else None
    result = run_arena(team_a_chooser, team_b_chooser, games=args.games, rng=rng)

    print(
        f"{result.games} games: A won {result.team_a_wins}, B won {result.team_b_wins}, draws {result.draws} "
        f"(A win rate {result.team_a_win_rate:.1%}, Elo diff {result.team_a_elo_diff:+.1f})"
    )


if __name__ == "__main__":
    _main()
