from __future__ import annotations

import copy
import random

from agents.policy_network import TichuPolicyValueNet


class OpponentPool:
    """A bounded, FIFO-evicting collection of frozen past-checkpoint network
    snapshots, used as self-play training opponents so team1 isn't always a
    pure mirror of the live network -- self-relative evaluation showed that
    pure mirror self-play checkpoints don't reliably outrank earlier
    checkpoints of the same run, even when they do improve against fixed
    baselines (see 2026-07-23-m2-model-improve's non-transitivity finding)."""

    def __init__(self, max_size: int | None = None):
        self._snapshots: list[TichuPolicyValueNet] = []
        self._max_size = max_size

    def __len__(self) -> int:
        return len(self._snapshots)

    def add(self, network: TichuPolicyValueNet) -> None:
        """Stores a deep-copied, eval-mode snapshot of `network`'s *current*
        weights -- independent of whatever training happens to `network`
        afterward. Evicts the oldest snapshot first once `max_size` is
        exceeded."""
        snapshot = copy.deepcopy(network)
        snapshot.eval()
        self._snapshots.append(snapshot)
        if self._max_size is not None and len(self._snapshots) > self._max_size:
            self._snapshots.pop(0)

    def sample(self, rng: random.Random) -> TichuPolicyValueNet:
        if not self._snapshots:
            raise ValueError("cannot sample from an empty OpponentPool")
        return rng.choice(self._snapshots)
