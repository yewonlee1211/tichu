from __future__ import annotations

import multiprocessing as mp
import random
from dataclasses import dataclass, replace
from multiprocessing.queues import Queue as MPQueue
from typing import Callable

import numpy as np
import torch

from tichu_env.combinations import Combo
from tichu_env.encoding import encode_observation
from tichu_env.env import TichuEnv
from tichu_env.scoring import TEAM_OF
from tichu_env.state import NUM_PLAYERS, GameState

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.policy_network import TichuPolicyValueNet

LegalAction = tuple[Combo | None, np.ndarray]

DEFAULT_EPSILON_BINARY_CALL = 0.0


def _is_binary_call_decision(combos: list) -> bool:
    """True iff this decision point is a large-Tichu or (small) Tichu
    call/decline choice -- both always offer exactly the two `bool`
    pseudo-actions `True`/`False`, distinguishable from every other decision
    (`Combo` or `None`) at a glance. The two decisions are indistinguishable
    at this generic level, which is what lets one epsilon mechanism cover
    both without change (see `_sample_action_index`)."""
    return len(combos) == 2 and all(isinstance(combo, bool) for combo in combos)


def _sample_action_index(
    combos: list,
    probs: np.ndarray,
    rng: random.Random,
    epsilon_binary_call: float,
) -> int:
    """Picks which of `combos` to play. Ordinarily samples from the policy's
    own `probs`; but for a large-Tichu or (small) Tichu call/decline decision
    specifically, forces a uniform-random choice with probability
    `epsilon_binary_call`. Only ever calling on the best hands makes this a
    rare binary decision that entropy regularization alone can't teach the
    network to condition on hand strength -- real sampling probability on a
    "call" logit stays too low for policy gradients to ever see enough call
    outcomes to learn from. Trick-play decisions are left untouched: they
    already get plenty of exploration from entropy regularization, and
    forcing a uniform choice among dozens of legal combos would be far more
    disruptive than helpful."""
    if _is_binary_call_decision(combos) and rng.random() < epsilon_binary_call:
        return rng.randrange(len(combos))
    return rng.choices(range(len(combos)), weights=probs.tolist(), k=1)[0]


class HeuristicOpponentAdapter:
    """Adapts an agent whose `choose_action` takes only `legal_actions` (e.g.
    `HeuristicAgent`) to self-play's opponent interface, which always calls
    `choose_action(state, legal_actions)` to also support agents like
    `AdvancedHeuristicAgent` that need the full game state."""

    def __init__(self, agent: object):
        self._agent = agent

    def choose_action(self, state: GameState, legal_actions: list[LegalAction]) -> Combo | None:
        return self._agent.choose_action(legal_actions)


class PolicyOpponent:
    """Adapts a frozen `TichuPolicyValueNet` (e.g. an `OpponentPool` snapshot)
    to self-play's opponent interface (`choose_action(state, legal_actions)`),
    sampling stochastically from its policy exactly as team0's own turns are
    sampled -- a past self should still play like the self-play process that
    produced it, not switch to argmax evaluation-style play."""

    def __init__(self, network: TichuPolicyValueNet, rng: random.Random):
        self._network = network
        self._rng = rng

    def choose_action(self, state: GameState, legal_actions: list[LegalAction]) -> Combo | None:
        combos = [combo for combo, _ in legal_actions]
        action_vectors = np.stack([vec for _, vec in legal_actions])
        observation = encode_observation(state, state.current_player)
        with torch.no_grad():
            probs = self._network.action_probabilities(
                torch.as_tensor(observation, dtype=torch.float32),
                torch.as_tensor(action_vectors, dtype=torch.float32),
            ).numpy()
        chosen_index = self._rng.choices(range(len(combos)), weights=probs.tolist(), k=1)[0]
        return combos[chosen_index]


class HybridOpponent:
    """Adapts a frozen `TichuPolicyValueNet` for trick play (delegating to a
    `PolicyOpponent` internally, so it samples identically) combined with
    `AdvancedHeuristicAgent`'s hand-strength rules for the large-Tichu and
    (small) Tichu call/decline decisions.

    Motivation: the trainee's own large-Tichu/Tichu-call policy has
    collapsed to always-decline regardless of hand strength (see
    .claude/plans/tichu-m2-action-space-curriculum.plan.md's "5단계와의
    연결"), so mirroring the trainee's own current weights for an opponent
    gives it essentially no exposure to an opponent whose calls actually
    correlate with hand quality. A plain `AdvancedHeuristicAgent` opponent
    fixes that but trades down to a much weaker, simple-greedy trick-play
    style. `HybridOpponent` keeps a specific checkpoint's trick-play
    strength while swapping in the heuristic's hand-quality-correlated
    calls, so team0 gets both a strong trick-play sparring partner and a
    realistic "opponent called Tichu with a good hand" signal to condition
    on."""

    def __init__(self, network: TichuPolicyValueNet, rng: random.Random):
        self._policy_opponent = PolicyOpponent(network, rng)
        self._heuristic = AdvancedHeuristicAgent()

    def choose_action(self, state: GameState, legal_actions: list[LegalAction]) -> Combo | bool | None:
        if any(isinstance(action, bool) for action, _ in legal_actions):
            return self._heuristic.choose_action(state, legal_actions)
        return self._policy_opponent.choose_action(state, legal_actions)


@dataclass(frozen=True)
class Transition:
    """One trick-play decision by one player. `reward` is 0.0 on every
    transition except the last one of a player's round, which carries that
    round's outcome -- mirroring TichuEnv.step's own convention of only
    surfacing a non-zero reward once the round is actually scored."""

    observation: np.ndarray
    action_vectors: np.ndarray  # (num_candidates, ACTION_DIM) legal actions offered at this step
    chosen_index: int  # index into action_vectors of the action actually taken
    reward: float
    old_log_prob: float = 0.0  # log-probability of chosen_index under the rollout-time policy (PPO only)


def play_self_play_round(
    network: TichuPolicyValueNet,
    rng: random.Random,
    opponent: object | None = None,
    epsilon_binary_call: float = DEFAULT_EPSILON_BINARY_CALL,
) -> list[list[Transition]]:
    """Plays one full round with `network` seated at team0 (seats 0, 2) and
    returns one trajectory per player: every trick-play decision that seat
    made this round, in order.

    With `opponent=None`, `network` also plays team1 (seats 1, 3) -- today's
    mirror self-play, unchanged. With `opponent` set to an object exposing
    `choose_action(state, legal_actions) -> Combo | None` (e.g.
    `AdvancedHeuristicAgent`), team1's turns are played by `opponent` instead
    and recorded into no trajectory at all: only team0's transitions are ever
    returned non-empty, since team1's actions did not come from `network` and
    have no log-probability to train against.

    Each network turn's offered legal actions are scored into a probability
    distribution and one is sampled -- self-play data generation needs
    exploration, not the best move, so this always samples rather than taking
    the argmax. `epsilon_binary_call` additionally forces a uniform-random
    call/decline choice on the large-Tichu and (small) Tichu decisions
    specifically, with that probability (see `_sample_action_index`); left at
    its default of 0.0, behavior is unchanged from before this parameter
    existed.

    The round's final reward (own team's `score_round` delta minus the
    opposing team's) is written onto the *last* transition of each player
    that actually got a turn; players who never acted, or whose seat was
    played entirely by `opponent`, are skipped."""
    env = TichuEnv(rng=rng)
    result = env.reset()
    per_player: list[list[Transition]] = [[] for _ in range(NUM_PLAYERS)]
    opponent_team = TEAM_OF[1]

    while not result.done:
        player = result.player

        if opponent is not None and TEAM_OF[player] == opponent_team:
            chosen_combo = opponent.choose_action(result.state, result.legal_actions)
        else:
            combos = [combo for combo, _ in result.legal_actions]
            action_vectors = np.stack([vec for _, vec in result.legal_actions])

            with torch.no_grad():
                probs = network.action_probabilities(
                    torch.as_tensor(result.observation, dtype=torch.float32),
                    torch.as_tensor(action_vectors, dtype=torch.float32),
                ).numpy()
            chosen_index = _sample_action_index(combos, probs, rng, epsilon_binary_call)

            per_player[player].append(
                Transition(
                    observation=result.observation,
                    action_vectors=action_vectors,
                    chosen_index=chosen_index,
                    reward=0.0,
                    old_log_prob=float(np.log(probs[chosen_index])),
                )
            )
            chosen_combo = combos[chosen_index]

        result = env.step(chosen_combo)

    team_scores = result.info["team_scores"]
    for player in range(NUM_PLAYERS):
        trajectory = per_player[player]
        if not trajectory:
            continue
        own_team = TEAM_OF[player]
        opponent_team = 1 - own_team
        team_return = float(team_scores[own_team] - team_scores[opponent_team])
        per_player[player][-1] = replace(trajectory[-1], reward=team_return)

    return per_player


def generate_self_play_games(
    network: TichuPolicyValueNet,
    num_games: int,
    rng: random.Random | None = None,
    opponent: object | None = None,
    opponent_factory: Callable[[], object | None] | None = None,
    epsilon_binary_call: float = DEFAULT_EPSILON_BINARY_CALL,
) -> list[list[Transition]]:
    """Runs `num_games` self-play rounds and returns a flat list of
    per-player trajectories -- 4 per game, one per seat (some empty when
    `opponent`/`opponent_factory` is set; see `play_self_play_round`).

    `opponent_factory`, if set, is called once per game to pick that game's
    team1 opponent afresh (e.g. a random draw from an `OpponentPool` mixed
    with heuristic agents) -- it takes precedence over the single, fixed
    `opponent` for every game where it's set.

    `epsilon_binary_call` is forwarded to `play_self_play_round` unchanged --
    see there for what it does."""
    rng = rng if rng is not None else random.Random()
    episodes: list[list[Transition]] = []
    for _ in range(num_games):
        game_opponent = opponent_factory() if opponent_factory is not None else opponent
        episodes.extend(
            play_self_play_round(network, rng, opponent=game_opponent, epsilon_binary_call=epsilon_binary_call)
        )
    return episodes


def _split_game_counts(num_games: int, num_workers: int) -> list[int]:
    """Divides `num_games` as evenly as possible across `num_workers` worker
    processes -- the first `num_games % num_workers` workers get one extra
    game so every game is covered exactly once with no worker left more than
    one game ahead of another."""
    base, remainder = divmod(num_games, num_workers)
    return [base + 1 if worker_index < remainder else base for worker_index in range(num_workers)]


def _run_self_play_worker(
    network: TichuPolicyValueNet,
    num_games: int,
    seed: int,
    opponent: object | None,
    opponent_factory: Callable[[], object | None] | None,
    epsilon_binary_call: float,
    result_queue: MPQueue,
) -> None:
    """Entry point for one self-play worker process (see
    `generate_self_play_games_parallel`). Always puts exactly one
    `("ok", episodes)` or `("error", exception)` tuple onto `result_queue`,
    never letting an exception propagate unreported -- otherwise the
    parent's matching `result_queue.get()` would hang forever waiting on a
    worker that died before producing output. `torch.set_num_threads(1)`
    stops this worker's own BLAS intra-op threading from oversubscribing
    the CPU cores `generate_self_play_games_parallel` is already splitting
    across worker *processes* -- without it, N worker processes each
    spawning torch's own multi-threaded default would all contend for the
    same cores."""
    try:
        torch.set_num_threads(1)
        episodes = generate_self_play_games(
            network,
            num_games,
            rng=random.Random(seed),
            opponent=opponent,
            opponent_factory=opponent_factory,
            epsilon_binary_call=epsilon_binary_call,
        )
        result_queue.put(("ok", episodes))
    except Exception as exc:  # noqa: BLE001 -- re-raised in the parent process via the queue
        result_queue.put(("error", exc))


def generate_self_play_games_parallel(
    network: TichuPolicyValueNet,
    num_games: int,
    num_workers: int,
    rng: random.Random | None = None,
    opponent: object | None = None,
    opponent_factory: Callable[[], object | None] | None = None,
    epsilon_binary_call: float = DEFAULT_EPSILON_BINARY_CALL,
) -> list[list[Transition]]:
    """Process-parallel counterpart to `generate_self_play_games`: splits
    `num_games` across up to `num_workers` subprocesses (each running the
    exact same sequential function on its own share) and concatenates their
    results, in no particular order -- callers already treat the returned
    list as an unordered bag of trajectories (see `compute_reinforce_loss`),
    so cross-worker ordering doesn't matter.

    `num_workers <= 1` (or `num_games < 2`) skips subprocesses entirely and
    calls `generate_self_play_games` directly, so single-worker behavior
    (including its exact RNG draw sequence) is unchanged from before this
    function existed -- this is what lets `train()` default to
    `self_play_workers=1` without disturbing any existing run's
    reproducibility, or its `generate_self_play_games`-monkeypatching tests.

    Each worker gets its own `random.Random(seed)`, seeded from a value
    drawn off the *caller's* `rng` (one `rng.randrange(...)` draw per
    worker, made here in the parent process before any subprocess starts) --
    worker processes share no memory once running, so per-worker seeding is
    what keeps this call reproducible for a fixed `(rng state, num_games,
    num_workers)`, even though it does not reproduce single-process
    `generate_self_play_games`'s own draw sequence.

    Uses the `fork` start method unconditionally (this project's `ai/` code
    only ever runs inside its Linux Docker container -- see CLAUDE.md),
    which lets `network`/`opponent`/`opponent_factory` (some of these, like
    an opponent-pool-driven factory closure, are not picklable) reach worker
    processes for free via copy-on-write instead of needing pickling -- only
    each worker's returned episodes travel back through an explicit
    `Queue`, where pickling numpy-array-bearing `Transition`s is cheap and
    unavoidable either way."""
    rng = rng if rng is not None else random.Random()
    effective_workers = max(1, min(num_workers, num_games))
    if effective_workers <= 1:
        return generate_self_play_games(
            network,
            num_games,
            rng=rng,
            opponent=opponent,
            opponent_factory=opponent_factory,
            epsilon_binary_call=epsilon_binary_call,
        )

    game_counts = _split_game_counts(num_games, effective_workers)
    seeds = [rng.randrange(2**31) for _ in game_counts]

    ctx = mp.get_context("fork")
    result_queue: MPQueue = ctx.Queue()
    processes = [
        ctx.Process(
            target=_run_self_play_worker,
            args=(network, count, seed, opponent, opponent_factory, epsilon_binary_call, result_queue),
        )
        for count, seed in zip(game_counts, seeds)
    ]
    for process in processes:
        process.start()

    results = [result_queue.get() for _ in processes]
    for process in processes:
        process.join()

    episodes: list[list[Transition]] = []
    for status, payload in results:
        if status == "error":
            raise payload
        episodes.extend(payload)
    return episodes
