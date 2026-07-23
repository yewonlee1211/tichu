from __future__ import annotations

import random
from dataclasses import dataclass, replace
from typing import Optional

import numpy as np

from tichu_env.cards import Rank
from tichu_env.combinations import Combo, ComboType
from tichu_env.encoding import encode_legal_actions, encode_observation
from tichu_env.scoring import score_round
from tichu_env.state import (
    NUM_PLAYERS,
    PARTNER,
    GameState,
    Phase,
    decide_large_tichu,
    deal_new_round,
    exchange_cards,
    legal_combos,
    pass_turn,
    play_combo,
)


@dataclass(frozen=True)
class StepResult:
    player: int
    observation: np.ndarray
    legal_actions: list[tuple[Optional[Combo], np.ndarray]]
    reward: float
    done: bool
    info: dict


class TichuEnv:
    """A single-round Tichu environment whose RL action space is trick play
    only (play a combo, or pass). Large Tichu, card exchange, and (small)
    Tichu calls are auto-resolved with fixed non-strategic defaults on
    reset() so that every episode starts already in the trick-play phase.
    This scope is intentional (see ai/RULES.md) -- those decisions can be
    exposed as additional action heads later without touching the trick-play
    loop."""

    def __init__(self, rng: random.Random | None = None):
        self._rng = rng if rng is not None else random.Random()
        self._state: GameState | None = None

    @property
    def state(self) -> GameState:
        if self._state is None:
            raise RuntimeError("call reset() before using the environment")
        return self._state

    @property
    def current_player(self) -> int:
        return self.state.current_player

    @property
    def done(self) -> bool:
        return self.state.phase is Phase.ROUND_OVER

    def reset(self) -> StepResult:
        state = deal_new_round(self._rng)
        for player in range(NUM_PLAYERS):
            state = decide_large_tichu(state, player, called=False)
        state = _auto_exchange(state)
        self._state = state
        return self._observe_current(reward=0.0, done=False, info={})

    def step(self, action: Combo | None) -> StepResult:
        state = self.state
        player = state.current_player
        legal = legal_combos(state, player)

        if action is None:
            if state.current_best is None:
                raise ValueError("cannot pass while leading a trick")
            recipient = None
            if _is_dragon_win(state):
                recipient = _auto_dragon_recipient(state, state.last_player_to_act)
            new_state = pass_turn(state, player, dragon_recipient=recipient)
        else:
            if action not in legal:
                raise ValueError("action is not in the current legal action set")
            # If this play is a lone Dragon single, it may win and end the
            # round outright (no pass_turn will ever follow to supply this),
            # so a recipient must be provided up front; play_combo() simply
            # ignores it when this play doesn't actually end the round.
            recipient = _auto_dragon_recipient(state, player) if _is_dragon_single(action) else None
            new_state = play_combo(state, player, action.cards, dragon_recipient=recipient)

        self._state = new_state

        info: dict = {}
        done = new_state.phase is Phase.ROUND_OVER
        if done:
            info["team_scores"] = score_round(new_state)

        return self._observe_current(reward=0.0, done=done, info=info)

    def observation(self, player: int | None = None) -> np.ndarray:
        player = self.current_player if player is None else player
        return encode_observation(self.state, player)

    def legal_actions(self, player: int | None = None) -> list[tuple[Combo | None, np.ndarray]]:
        player = self.current_player if player is None else player
        return encode_legal_actions(self.state, player)

    def _observe_current(self, *, reward: float, done: bool, info: dict) -> StepResult:
        state = self.state
        player = state.current_player
        return StepResult(
            player=player,
            observation=encode_observation(state, player),
            legal_actions=encode_legal_actions(state, player),
            reward=reward,
            done=done,
            info=info,
        )


def _is_dragon_win(state: GameState) -> bool:
    return state.current_best is not None and _is_dragon_single(state.current_best)


def _is_dragon_single(combo: Combo) -> bool:
    return combo.combo_type is ComboType.SINGLE and combo.cards[0].rank is Rank.DRAGON


def _auto_dragon_recipient(state: GameState, winner: int) -> int:
    for candidate in range(NUM_PLAYERS):
        if candidate == winner or PARTNER[candidate] == winner:
            continue
        if candidate in state.finished_order:
            continue
        return candidate
    raise RuntimeError("no valid Dragon recipient available")


def _auto_exchange(state: GameState) -> GameState:
    """Non-strategic placeholder exchange: each player gives their three
    lowest-ranked cards, one to each opponent in seat order."""
    gifts: dict[int, dict[int, object]] = {}
    for giver in range(NUM_PLAYERS):
        hand = sorted(state.hands[giver], key=lambda card: card.rank.value)
        others = [p for p in range(NUM_PLAYERS) if p != giver]
        gifts[giver] = {recipient: hand[i] for i, recipient in enumerate(others)}
    return exchange_cards(state, gifts)
