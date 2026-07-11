from __future__ import annotations

import random

import numpy as np

from tichu_env.combinations import Combo

LegalAction = tuple[Combo | None, np.ndarray]


class RandomAgent:
    """Chooses uniformly among the offered legal actions. Serves as a floor
    baseline: an environment bug that lets an "impossible" action through
    tends to surface quickly once random play exercises every branch."""

    def __init__(self, rng: random.Random | None = None):
        self._rng = rng if rng is not None else random.Random()

    def choose_action(self, legal_actions: list[LegalAction]) -> Combo | None:
        combo, _ = self._rng.choice(legal_actions)
        return combo
