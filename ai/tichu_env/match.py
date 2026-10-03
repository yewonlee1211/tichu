"""Match-level wrapper around the single-round `TichuEnv`: rounds repeat,
accumulating team scores, until `is_match_over`. Used by self-play training
(so the remaining-to-win observation feature actually varies) and by arena's
match-level evaluation. See .claude/plans/tichu-m2-action-space-curriculum.plan.md's
"매치 단위 학습 루프 결정" for the decisions this implements."""

from __future__ import annotations

import random
from dataclasses import dataclass, replace

from tichu_env.combinations import Combo
from tichu_env.env import StepResult, TichuEnv


def is_match_over(team_scores: tuple[int, int], target_score: int) -> bool:
    """A match ends once a team reaches `target_score` -- unless both teams
    are at or above it with equal scores, in which case one more round is
    played. Training-side rule only: the product game's `is_game_over`
    (scoring.py / packages/shared's isGameOver) has no tie rule."""
    if not any(score >= target_score for score in team_scores):
        return False
    return team_scores[0] != team_scores[1]


def match_winner(team_scores: tuple[int, int], target_score: int) -> int:
    if not is_match_over(team_scores, target_score):
        raise ValueError("match is not over yet")
    return 0 if team_scores[0] > team_scores[1] else 1


@dataclass(frozen=True)
class MatchStart:
    target_score: int
    team_scores: tuple[int, int]


@dataclass(frozen=True)
class MatchStartConfig:
    """Mixed ("C") starting-state distribution for training episodes.

    With probability `full_match_prob` a match is played in full from (0, 0)
    to a target drawn from `full_match_targets`. Otherwise the two teams'
    *remaining points to win* are drawn from [`remaining_min`,
    `remaining_max`] on a `remaining_step` grid, at most `max_remaining_gap`
    apart, and placed under `sampled_target_score` (any target works, since
    the observation only sees remaining points; it just has to be at least
    `remaining_max` so starting scores stay non-negative)."""

    full_match_prob: float = 0.5
    full_match_targets: tuple[int, ...] = (500, 1000, 2000)
    remaining_min: int = 5
    remaining_max: int = 2000
    remaining_step: int = 5
    max_remaining_gap: int = 1000
    sampled_target_score: int = 2000

    def __post_init__(self) -> None:
        if not 0.0 <= self.full_match_prob <= 1.0:
            raise ValueError("full_match_prob must be within [0, 1]")
        if not self.full_match_targets or any(target <= 0 for target in self.full_match_targets):
            raise ValueError("full_match_targets must be a non-empty tuple of positive scores")
        if self.remaining_step <= 0:
            raise ValueError("remaining_step must be positive")
        if self.remaining_min <= 0 or self.remaining_min > self.remaining_max:
            raise ValueError("remaining range must satisfy 0 < remaining_min <= remaining_max")
        if self.remaining_min % self.remaining_step or self.remaining_max % self.remaining_step:
            raise ValueError("remaining_min and remaining_max must be multiples of remaining_step")
        if self.max_remaining_gap < 0:
            raise ValueError("max_remaining_gap must be non-negative")
        if self.sampled_target_score < self.remaining_max:
            raise ValueError("sampled_target_score must be at least remaining_max")


def sample_match_start(rng: random.Random, config: MatchStartConfig) -> MatchStart:
    if rng.random() < config.full_match_prob:
        return MatchStart(target_score=rng.choice(config.full_match_targets), team_scores=(0, 0))

    remaining = _sample_remaining_pair(rng, config)
    target = config.sampled_target_score
    return MatchStart(target_score=target, team_scores=(target - remaining[0], target - remaining[1]))


def _sample_remaining_pair(rng: random.Random, config: MatchStartConfig) -> tuple[int, int]:
    """Uniform over grid pairs within the gap cap (rejection sampling)."""
    grid = range(config.remaining_min, config.remaining_max + 1, config.remaining_step)
    while True:
        first, second = rng.choice(grid), rng.choice(grid)
        if abs(first - second) <= config.max_remaining_gap:
            return (first, second)


class MatchEnv:
    """Same step interface as `TichuEnv`, but `done` means the whole match is
    over. A step that closes a round carries `round_index`, `round_scores`
    (that round's deltas), `team_scores` (cumulative after it), `match_over`
    and -- on the final round -- `winner` in its info; when the match goes on,
    that step's observation is already the next round's first decision."""

    def __init__(self, rng: random.Random | None = None):
        self._rng = rng if rng is not None else random.Random()
        self._round_env: TichuEnv | None = None
        self._target_score = 0
        self._team_scores = (0, 0)
        self._round_index = 0
        self._done = False

    @property
    def state(self):
        return self._require_round_env().state

    @property
    def current_player(self) -> int:
        return self.state.current_player

    @property
    def done(self) -> bool:
        return self._done

    @property
    def round_index(self) -> int:
        return self._round_index

    @property
    def team_scores(self) -> tuple[int, int]:
        return self._team_scores

    @property
    def target_score(self) -> int:
        return self._target_score

    def reset(self, start: MatchStart) -> StepResult:
        round_env = TichuEnv(rng=self._rng, target_score=start.target_score)
        if is_match_over(start.team_scores, start.target_score):
            raise ValueError("starting scores already end the match")
        self._round_env = round_env
        self._target_score = start.target_score
        self._team_scores = start.team_scores
        self._round_index = 0
        self._done = False
        return round_env.reset(team_scores=start.team_scores)

    def step(self, action: Combo | None) -> StepResult:
        if self._done:
            raise RuntimeError("match is over; call reset() to start a new one")
        round_env = self._require_round_env()
        result = round_env.step(action)
        if not result.done:
            return result

        round_scores = result.info["team_scores"]
        self._team_scores = (self._team_scores[0] + round_scores[0], self._team_scores[1] + round_scores[1])
        info = {
            "round_index": self._round_index,
            "round_scores": round_scores,
            "team_scores": self._team_scores,
            "match_over": is_match_over(self._team_scores, self._target_score),
        }
        if info["match_over"]:
            self._done = True
            info["winner"] = match_winner(self._team_scores, self._target_score)
            return replace(result, info=info)

        self._round_index += 1
        return replace(round_env.reset(team_scores=self._team_scores), info=info)

    def _require_round_env(self) -> TichuEnv:
        if self._round_env is None:
            raise RuntimeError("call reset() before using the environment")
        return self._round_env
