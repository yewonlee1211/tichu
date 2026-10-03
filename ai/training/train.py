from __future__ import annotations

import csv
import os
import random
import warnings
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np
import torch
from torch import optim

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.heuristic import HeuristicAgent
from agents.policy_network import TichuPolicyValueNet
from tichu_env.match import MatchStartConfig
from training.opponent_pool import OpponentPool
from training.self_play import (
    HeuristicOpponentAdapter,
    PolicyOpponent,
    Transition,
    generate_self_play_games,
    generate_self_play_games_parallel,
)

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
DEFAULT_CLIP_EPSILON = 0.2
# λ and γ in the match return `r_k / S + λ·γ^(K−k)·z` -- see
# .claude/plans/tichu-m2-action-space-curriculum.plan.md's "매치 단위 학습 루프 결정".
DEFAULT_MATCH_WIN_WEIGHT = 1.0
DEFAULT_MATCH_DISCOUNT = 0.9


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


class TrainingAlreadyRunningError(RuntimeError):
    """Raised when `train()` finds a live process's lock already held on its
    target `checkpoint_dir` -- see `_acquire_training_lock`."""


def _training_lock_path(checkpoint_dir: Path) -> Path:
    return checkpoint_dir / "RUNNING.lock"


def _is_pid_alive(pid: int) -> bool:
    """Linux-only (this project's `ai/` code only ever runs inside the Docker
    container -- see CLAUDE.md): a PID has a live process iff `/proc/<pid>`
    exists. Cheaper and more portable across minimal container images than
    sending a real signal, and needs no special-casing for PIDs this process
    doesn't have permission to signal (a container's own PIDs are always
    owned by the same root user here)."""
    return Path(f"/proc/{pid}").exists()


def _write_training_lock(checkpoint_dir: Path, pid: int) -> None:
    _training_lock_path(checkpoint_dir).write_text(f"{pid}\n")


def _read_training_lock_pid(checkpoint_dir: Path) -> int | None:
    lock_path = _training_lock_path(checkpoint_dir)
    if not lock_path.exists():
        return None
    try:
        return int(lock_path.read_text().strip())
    except ValueError:
        return None


def _acquire_training_lock(checkpoint_dir: Path) -> None:
    """Refuses to start a second concurrent `train()` run against the same
    `checkpoint_dir`: two runs racing to write the same `checkpoint_*.pt` and
    `metrics.csv` files silently corrupt both (this happened for real -- see
    the `2026-09-12-m2-stage0-baseline` session log). A lock file visible in
    the checkpoint directory itself, rather than any one session remembering
    what it launched, is what lets a *different* Claude Code session (sharing
    the same long-lived Docker container, with no memory of this one) detect
    the conflict too.

    A lock whose recorded PID is no longer alive (the owning process crashed,
    or was `kill -9`'d, which skips any `finally`-block cleanup) is treated as
    stale and silently overwritten -- see `_is_pid_alive`."""
    existing_pid = _read_training_lock_pid(checkpoint_dir)
    if existing_pid is not None and _is_pid_alive(existing_pid):
        raise TrainingAlreadyRunningError(
            f"a training run (pid {existing_pid}) already holds the lock on {checkpoint_dir} -- "
            "if you're sure it's not actually running, remove RUNNING.lock from that directory and retry."
        )
    _write_training_lock(checkpoint_dir, pid=os.getpid())


def _release_training_lock(checkpoint_dir: Path) -> None:
    _training_lock_path(checkpoint_dir).unlink(missing_ok=True)


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


def load_warm_start_state_dict(network: TichuPolicyValueNet, checkpoint_path: Path) -> list[str]:
    """Loads `checkpoint_path` (a `checkpoint_*.pt` model-weights-only file) into
    `network`, skipping any parameter whose shape no longer matches -- e.g.
    `action_encoder.0.weight` after `ACTION_DIM` grows or shrinks between
    curriculum stages (see .claude/plans/tichu-m2-action-space-curriculum.plan.md).
    Every other parameter (`state_encoder`/`action_encoder.2`/`action_scorer`/
    `value_head`) is unaffected by that change and loads unchanged, so a new
    stage's network starts from the previous stage's learned representations
    instead of from scratch. Returns the list of skipped parameter names (left
    at `network`'s own fresh initialization) so a caller can log/verify what
    was actually warm-started versus reinitialized."""
    # Trusted load: checkpoint_path is always expected to be a checkpoint_*.pt
    # this same module wrote via _atomic_torch_save, never an arbitrary/untrusted
    # file.
    checkpoint_state = torch.load(checkpoint_path, weights_only=True)
    own_state = network.state_dict()
    skipped: list[str] = []
    for key, value in checkpoint_state.items():
        if key in own_state and own_state[key].shape == value.shape:
            own_state[key] = value
        else:
            skipped.append(key)
    network.load_state_dict(own_state)
    return skipped


def migrate_action_encoder_input_layer(network: TichuPolicyValueNet, checkpoint_path: Path) -> None:
    """Repairs the one gap `load_warm_start_state_dict` leaves behind when
    `ACTION_DIM` changes between stages: that function must skip
    `action_encoder.0.weight` entirely once its shape changes, which throws
    away every previously learned column, not just the ones that actually
    moved or disappeared.

    This project's encoding convention (see `tichu_env/encoding.py`) always
    keeps PASS as the very last action dimension and adds/removes any
    pseudo-action flag columns (e.g. Stage 1's large-Tichu call/decline, or
    this session's removal of both call decisions from the action space --
    see .claude/plans/tichu-m2-action-space-curriculum.plan.md) as a
    contiguous block immediately before it -- so every other column keeps
    the same meaning at the same index across a stage boundary, and PASS
    itself just moves from the old last index to the new one, in either
    direction. This copies exactly those matching leading columns from
    `checkpoint_path` into `network`'s (freshly initialized)
    `action_encoder.0.weight`, plus PASS's column, leaving only genuinely
    new columns (when growing) at their random initialization. No-op if the
    shape already matches (nothing changed, so `load_warm_start_state_dict`
    already loaded it directly)."""
    checkpoint_state = torch.load(checkpoint_path, weights_only=True)
    old_weight = checkpoint_state["action_encoder.0.weight"]
    new_weight = network.action_encoder[0].weight.data
    if old_weight.shape == new_weight.shape:
        return
    old_action_dim = old_weight.shape[1]
    new_action_dim = new_weight.shape[1]
    shared_prefix = min(old_action_dim, new_action_dim) - 1
    with torch.no_grad():
        new_weight[:, :shared_prefix] = old_weight[:, :shared_prefix]
        new_weight[:, -1] = old_weight[:, -1]


def _collect_returns(
    episodes: list[list[Transition]],
    reward_scale: float,
    match_win_weight: float,
    match_discount: float,
) -> tuple[list[Transition], list[float], torch.Tensor]:
    """Flattens `episodes` into (transitions, raw_returns, scaled_returns).
    Every transition of a trajectory shares its last transition's return
    `G = reward / reward_scale + match_win_weight · match_discount^(K−k) · z`
    (see training.self_play.Transition); `raw_returns` is just the round
    margin `reward`, kept in score units for the `mean_return` metric."""
    transitions: list[Transition] = []
    raw_returns: list[float] = []
    scaled_returns: list[float] = []
    for trajectory in episodes:
        if not trajectory:
            continue
        last = trajectory[-1]
        scaled_return = (
            last.reward / reward_scale
            + match_win_weight * match_discount**last.rounds_to_match_end * last.match_outcome
        )
        transitions.extend(trajectory)
        raw_returns.extend([last.reward] * len(trajectory))
        scaled_returns.extend([scaled_return] * len(trajectory))
    return transitions, raw_returns, torch.tensor(scaled_returns, dtype=torch.float32)


def compute_reinforce_loss(
    network: TichuPolicyValueNet,
    episodes: list[list[Transition]],
    reward_scale: float = DEFAULT_REWARD_SCALE,
    entropy_coef: float = DEFAULT_ENTROPY_COEF,
    match_win_weight: float = DEFAULT_MATCH_WIN_WEIGHT,
    match_discount: float = DEFAULT_MATCH_DISCOUNT,
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
    then has to retrace node-by-node on `.backward()`.

    In match self-play the return also carries the discounted match outcome
    (`match_win_weight`, `match_discount`; see `_collect_returns`). Single-round
    transitions have z = 0, so for them the return is the round margin alone."""
    transitions, raw_returns, scaled_returns = _collect_returns(
        episodes, reward_scale, match_win_weight, match_discount
    )

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


def compute_ppo_loss(
    network: TichuPolicyValueNet,
    episodes: list[list[Transition]],
    reward_scale: float = DEFAULT_REWARD_SCALE,
    entropy_coef: float = DEFAULT_ENTROPY_COEF,
    clip_epsilon: float = DEFAULT_CLIP_EPSILON,
    match_win_weight: float = DEFAULT_MATCH_WIN_WEIGHT,
    match_discount: float = DEFAULT_MATCH_DISCOUNT,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, float, float]:
    """PPO's clipped-surrogate counterpart to `compute_reinforce_loss` -- same
    signature and same value-loss/entropy terms, but the policy loss uses
    `ratio = exp(new_log_prob - old_log_prob)` (comparing `network`'s *current*
    log-probability for each transition's chosen action against the log-probability
    already recorded on it at rollout time, `Transition.old_log_prob`) instead of
    `log_prob` directly.

    Calling this once, right after the episodes that produced it were generated
    (so every `old_log_prob` still equals the current `new_log_prob`, ratio==1
    everywhere), gives the same *gradient* as `compute_reinforce_loss` -- the
    clipping is inert at ratio==1. The two functions only diverge once `network`'s
    parameters move away from the rollout-time policy, e.g. across multiple
    epochs of updates on the same batch of episodes: `min(ratio * advantage,
    clip(ratio, 1-clip_epsilon, 1+clip_epsilon) * advantage)` caps how much any
    single transition's loss can reward pushing the policy further in a direction
    it has already moved a lot in, which is exactly the unbounded-single-step
    policy churn this function exists to prevent."""
    transitions, raw_returns, scaled_returns = _collect_returns(
        episodes, reward_scale, match_win_weight, match_discount
    )
    old_log_probs = torch.tensor([t.old_log_prob for t in transitions], dtype=torch.float32)

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
    for logits, transition, advantage, old_log_prob in zip(
        logits_per_transition, transitions, advantages, old_log_probs
    ):
        log_probs = torch.log_softmax(logits, dim=-1)
        new_log_prob = log_probs[transition.chosen_index]
        ratio = torch.exp(new_log_prob - old_log_prob)
        clipped_ratio = torch.clamp(ratio, 1.0 - clip_epsilon, 1.0 + clip_epsilon)
        surrogate = torch.min(ratio * advantage, clipped_ratio * advantage)
        policy_losses.append(-surrogate)
        entropies.append(-(log_probs.exp() * log_probs).sum())

    policy_loss = torch.stack(policy_losses).mean()
    value_loss = ((output.state_values - scaled_returns) ** 2).mean()
    entropy = torch.stack(entropies).mean()
    total_loss = policy_loss + value_loss - entropy_coef * entropy
    mean_return = sum(raw_returns) / len(raw_returns)
    return policy_loss, value_loss, total_loss, mean_return, entropy.item()


def _sample_pool_mix_opponent(opponent_pool: OpponentPool, rng: random.Random) -> object:
    """Picks one game's team1 opponent: an equal-weight draw among whichever of
    {a snapshot from `opponent_pool`, `HeuristicAgent`, `AdvancedHeuristicAgent`} are
    currently available. The pool's share is left out of the draw entirely (rather
    than given zero weight within it, which would waste a third of games erroring
    out) while the pool is still empty -- e.g. right at the start of a run before
    any checkpoint has been added to it."""
    choices: list[Callable[[], object]] = [
        lambda: HeuristicOpponentAdapter(HeuristicAgent()),
        lambda: AdvancedHeuristicAgent(),
    ]
    if len(opponent_pool) > 0:
        choices.append(lambda: PolicyOpponent(opponent_pool.sample(rng), rng))
    return rng.choice(choices)()


def train(
    network: TichuPolicyValueNet,
    iterations: int,
    games_per_iteration: int = 20,
    learning_rate: float = 1e-3,
    reward_scale: float = DEFAULT_REWARD_SCALE,
    entropy_coef: float = DEFAULT_ENTROPY_COEF,
    lr_min: float | None = None,
    opponent: object | None = None,
    opponent_pool: OpponentPool | None = None,
    ppo_epochs: int | None = None,
    clip_epsilon: float = DEFAULT_CLIP_EPSILON,
    self_play_workers: int = 1,
    match_start_config: MatchStartConfig | None = None,
    match_win_weight: float = DEFAULT_MATCH_WIN_WEIGHT,
    match_discount: float = DEFAULT_MATCH_DISCOUNT,
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

    `self_play_workers`, left at its default of 1, calls `generate_self_play_games`
    directly, exactly as before this parameter existed (including its exact RNG draw
    sequence, and its visibility to tests that monkeypatch that name). Set above 1, each
    iteration's self-play instead runs via `generate_self_play_games_parallel`, splitting
    `games_per_iteration` across that many subprocesses -- see that function's docstring
    for what this does and does not preserve about reproducibility (profiling in the
    `2026-07-23-m2-training-speed` session found self-play generation, not the loss/
    backward pass, dominates iteration time, and that most of it is CPU-bound Python/
    single-decision network-forward work that parallelizes across cores).

    `opponent_pool`, if set, takes precedence over `opponent`: each game's team1
    opponent is instead an equal-weight random draw among {a frozen snapshot from
    the pool, `HeuristicAgent`, `AdvancedHeuristicAgent`} (see
    `_sample_pool_mix_opponent`), so team0 keeps facing a mix of past selves and
    fixed baselines rather than either a single static opponent or a pure mirror of
    its own current, still-changing policy. `network`'s own current weights are
    added to `opponent_pool` as a new snapshot at every `checkpoint_every` interval
    (alongside that iteration's checkpoint files), so the pool grows over the
    course of a run; callers can also pre-seed it before calling `train` (e.g. with
    checkpoints from an earlier phase of the same experiment).

    `ppo_epochs`, if set, switches the update rule from single-step REINFORCE to
    PPO (see `compute_ppo_loss`): each iteration's episodes are generated once as
    usual, but then reused for `ppo_epochs` successive gradient steps (each a fresh
    forward pass under the network's then-current parameters, clipped against the
    log-probabilities recorded at rollout time) instead of REINFORCE's single step.
    `clip_epsilon` is PPO's trust-region width and is unused when `ppo_epochs` is
    `None`. Left `None` (the default), behavior is unchanged from before PPO
    support existed -- one `compute_reinforce_loss` call and one optimizer step per
    iteration.

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
    clean splice of "old shape then new shape".

    `match_start_config`, if set, switches self-play from single rounds to whole
    matches whose starting state is drawn from it (see
    `training.self_play.play_self_play_match`); `games_per_iteration` then counts
    matches. `match_win_weight` (λ) and `match_discount` (γ) weight the match
    outcome in the return (see `_collect_returns`) and have no effect on
    single-round episodes. Left `None` (the API default, kept so existing callers
    and tests are unchanged), each game is one round as before; the CLI defaults
    to match training instead."""
    if match_win_weight < 0:
        raise ValueError("match_win_weight must be non-negative")
    if not 0.0 < match_discount <= 1.0:
        raise ValueError("match_discount must be within (0, 1]")
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
    _acquire_training_lock(checkpoint_dir)
    try:
        history = _run_training_loop(
            network=network,
            optimizer=optimizer,
            scheduler=scheduler,
            rng=rng,
            start_iteration=start_iteration,
            iterations=iterations,
            games_per_iteration=games_per_iteration,
            reward_scale=reward_scale,
            entropy_coef=entropy_coef,
            opponent=opponent,
            opponent_pool=opponent_pool,
            ppo_epochs=ppo_epochs,
            clip_epsilon=clip_epsilon,
            self_play_workers=self_play_workers,
            match_start_config=match_start_config,
            match_win_weight=match_win_weight,
            match_discount=match_discount,
            checkpoint_dir=checkpoint_dir,
            checkpoint_every=checkpoint_every,
            metrics_path=metrics_path,
        )
    finally:
        _release_training_lock(checkpoint_dir)
    return history


def _run_training_loop(
    *,
    network: TichuPolicyValueNet,
    optimizer: optim.Optimizer,
    scheduler: optim.lr_scheduler.LRScheduler | None,
    rng: random.Random,
    start_iteration: int,
    iterations: int,
    games_per_iteration: int,
    reward_scale: float,
    entropy_coef: float,
    opponent: object | None,
    opponent_pool: OpponentPool | None,
    ppo_epochs: int | None,
    clip_epsilon: float,
    self_play_workers: int,
    match_start_config: MatchStartConfig | None,
    match_win_weight: float,
    match_discount: float,
    checkpoint_dir: Path,
    checkpoint_every: int,
    metrics_path: Path,
) -> list[IterationMetrics]:
    """The self-play/update loop itself, factored out of `train()` so the lock
    acquired there (see `_acquire_training_lock`) covers this in a single
    `try`/`finally` without an extra indentation level around the whole
    function body."""
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
            opponent_factory = (
                (lambda: _sample_pool_mix_opponent(opponent_pool, rng)) if opponent_pool is not None else None
            )
            if self_play_workers <= 1:
                episodes = generate_self_play_games(
                    network,
                    games_per_iteration,
                    rng=rng,
                    opponent=opponent,
                    opponent_factory=opponent_factory,
                    match_start_config=match_start_config,
                )
            else:
                episodes = generate_self_play_games_parallel(
                    network,
                    games_per_iteration,
                    num_workers=self_play_workers,
                    rng=rng,
                    opponent=opponent,
                    opponent_factory=opponent_factory,
                    match_start_config=match_start_config,
                )

            return_kwargs = {
                "reward_scale": reward_scale,
                "entropy_coef": entropy_coef,
                "match_win_weight": match_win_weight,
                "match_discount": match_discount,
            }
            if ppo_epochs is not None:
                for _ in range(ppo_epochs):
                    policy_loss, value_loss, total_loss, mean_return, mean_entropy = compute_ppo_loss(
                        network, episodes, clip_epsilon=clip_epsilon, **return_kwargs
                    )
                    optimizer.zero_grad()
                    total_loss.backward()
                    optimizer.step()
            else:
                policy_loss, value_loss, total_loss, mean_return, mean_entropy = compute_reinforce_loss(
                    network, episodes, **return_kwargs
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
                if opponent_pool is not None:
                    opponent_pool.add(network)

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
    parser.add_argument(
        "--opponent-pool",
        action="store_true",
        help=(
            "Draw team1's seats each game from an equal-weight mix of past-checkpoint "
            "snapshots, HeuristicAgent, and AdvancedHeuristicAgent, instead of a single "
            "fixed opponent. Mutually exclusive with --heuristic-opponent."
        ),
    )
    parser.add_argument(
        "--opponent-pool-seed",
        nargs="+",
        type=Path,
        default=(),
        help="checkpoint_*.pt file(s) to pre-load into the opponent pool before training starts.",
    )
    parser.add_argument(
        "--opponent-pool-max-size",
        type=int,
        default=None,
        help="Cap on the opponent pool's size; oldest snapshots are evicted first once exceeded.",
    )
    parser.add_argument(
        "--ppo-epochs",
        type=int,
        default=None,
        help="Switch from single-step REINFORCE to PPO, reusing each iteration's episodes for this many "
        "clipped-surrogate gradient steps.",
    )
    parser.add_argument(
        "--clip-epsilon",
        type=float,
        default=DEFAULT_CLIP_EPSILON,
        help="PPO's trust-region width; only used when --ppo-epochs is set.",
    )
    parser.add_argument(
        "--self-play-workers",
        type=int,
        default=1,
        help="Generate each iteration's self-play games across this many subprocesses "
        "instead of sequentially in-process. Profiling found self-play generation "
        "dominates iteration time, so this is the main lever for wall-clock training "
        "speed; a good starting point is the container's CPU count.",
    )
    parser.add_argument(
        "--single-round",
        action="store_true",
        help="Train on single rounds from (0, 0) instead of whole matches (the pre-match-loop behavior).",
    )
    parser.add_argument(
        "--full-match-prob",
        type=float,
        default=MatchStartConfig.full_match_prob,
        help="Share of matches played in full from (0, 0); the rest start from sampled remaining-to-win points.",
    )
    parser.add_argument(
        "--max-remaining-gap",
        type=int,
        default=MatchStartConfig.max_remaining_gap,
        help="Cap on the gap between the two teams' sampled remaining-to-win points.",
    )
    parser.add_argument(
        "--match-win-weight",
        type=float,
        default=DEFAULT_MATCH_WIN_WEIGHT,
        help="λ: weight of the match outcome z in the return r_k/S + λ·γ^(K−k)·z.",
    )
    parser.add_argument(
        "--match-discount",
        type=float,
        default=DEFAULT_MATCH_DISCOUNT,
        help="γ: per-round discount of the match outcome in the return r_k/S + λ·γ^(K−k)·z.",
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
    parser.add_argument(
        "--warm-start-from",
        type=Path,
        default=None,
        help="Curriculum warm-start: load a prior stage's checkpoint_*.pt into the freshly "
        "constructed network before training starts, skipping any parameter whose shape no "
        "longer matches (e.g. after ACTION_DIM grows). Mutually exclusive with --resume/--resume-from, "
        "which continue a run's own optimizer/rng state instead of starting a new one.",
    )
    args = parser.parse_args()

    if args.heuristic_opponent and args.opponent_pool:
        parser.error("--heuristic-opponent and --opponent-pool are mutually exclusive")
    if args.warm_start_from is not None and (args.resume or args.resume_from is not None):
        parser.error("--warm-start-from and --resume/--resume-from are mutually exclusive")

    resume_from = args.resume_from
    if resume_from is None and args.resume:
        resume_from = find_latest_training_state(args.checkpoint_dir)
        if resume_from is None:
            parser.error(f"--resume was given but no training_state_*.pt file exists in {args.checkpoint_dir}")

    if args.seed is not None:
        torch.manual_seed(args.seed)
    network = TichuPolicyValueNet()
    if args.warm_start_from is not None:
        load_warm_start_state_dict(network, args.warm_start_from)
        migrate_action_encoder_input_layer(network, args.warm_start_from)
    rng = random.Random(args.seed) if args.seed is not None else None
    opponent = AdvancedHeuristicAgent() if args.heuristic_opponent else None
    opponent_pool = None
    if args.opponent_pool:
        opponent_pool = OpponentPool(max_size=args.opponent_pool_max_size)
        for seed_checkpoint in args.opponent_pool_seed:
            seed_network = TichuPolicyValueNet()
            seed_network.load_state_dict(torch.load(seed_checkpoint, weights_only=True))
            opponent_pool.add(seed_network)
    match_start_config = (
        None
        if args.single_round
        else MatchStartConfig(full_match_prob=args.full_match_prob, max_remaining_gap=args.max_remaining_gap)
    )
    history = train(
        network,
        iterations=args.iterations,
        games_per_iteration=args.games_per_iteration,
        learning_rate=args.learning_rate,
        reward_scale=args.reward_scale,
        entropy_coef=args.entropy_coef,
        lr_min=args.lr_min,
        opponent=opponent,
        opponent_pool=opponent_pool,
        ppo_epochs=args.ppo_epochs,
        clip_epsilon=args.clip_epsilon,
        self_play_workers=args.self_play_workers,
        match_start_config=match_start_config,
        match_win_weight=args.match_win_weight,
        match_discount=args.match_discount,
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
