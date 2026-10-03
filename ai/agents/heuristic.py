from __future__ import annotations

import numpy as np

from tichu_env.combinations import BOMB_TYPES, Combo

LegalAction = tuple[Combo | None, np.ndarray]


class HeuristicAgent:
    """Greedy rule-based bot: always plays the weakest legal non-bomb combo
    (conserving stronger cards for later), never spends a bomb unless it is
    the only legal action, and passes rather than beat a trick with a bomb
    whenever passing is available. This exists to validate the environment
    (a working environment should let this consistently outplay
    `RandomAgent`) and as a baseline for self-play evaluation later.

    Trick play only -- the large-Tichu and (small) Tichu call decisions are
    auto-resolved by `TichuEnv` itself now (see its class docstring) and
    never reach `legal_actions` here."""

    def choose_action(self, legal_actions: list[LegalAction]) -> Combo | None:
        non_bomb_plays = [combo for combo, _ in legal_actions if combo is not None and combo.combo_type not in BOMB_TYPES]
        if non_bomb_plays:
            return min(non_bomb_plays, key=lambda combo: combo.rank_strength)

        can_pass = any(combo is None for combo, _ in legal_actions)
        if can_pass:
            return None

        bombs = [combo for combo, _ in legal_actions if combo is not None]
        return min(bombs, key=lambda combo: combo.rank_strength)
