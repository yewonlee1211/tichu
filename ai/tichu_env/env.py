from __future__ import annotations

import random
from dataclasses import dataclass, replace
from typing import Optional

import numpy as np

from tichu_env.cards import Card, Rank
from tichu_env.combinations import Combo, ComboType
from tichu_env.encoding import encode_legal_actions, encode_observation
from tichu_env.scoring import score_round
from tichu_env.state import (
    NUM_PLAYERS,
    PARTNER,
    GameState,
    Phase,
    decide_large_tichu,
    decide_tichu,
    deal_new_round,
    exchange_cards,
    is_awaiting_tichu_decision,
    legal_combos,
    pass_turn,
    play_combo,
)


@dataclass(frozen=True)
class StepResult:
    player: int
    observation: np.ndarray
    legal_actions: list[tuple[Combo | bool | None, np.ndarray]]
    reward: float
    done: bool
    info: dict
    state: GameState


class TichuEnv:
    """A single-round Tichu environment. The RL action space currently
    covers the large-Tichu call/decline decision (`Phase.LARGE_TICHU`, one
    per player, `True`/`False`), the (small) Tichu call/decline decision
    (offered once per player, right before their first `Phase.PLAYING`
    action -- see `state.is_awaiting_tichu_decision`, also `True`/`False`),
    and trick play (`Phase.PLAYING`, a `Combo` or `None` to pass). Card
    exchange is still auto-resolved by a fixed heuristic (see
    `_auto_exchange`) rather than exposed as a decision -- see
    .claude/plans/tichu-m2-action-space-curriculum.plan.md's "결정 3" for why."""

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
        self._state = deal_new_round(self._rng)
        return self._observe_current(reward=0.0, done=False, info={})

    def step(self, action: Combo | bool | None) -> StepResult:
        state = self.state
        player = state.current_player

        if state.phase is Phase.LARGE_TICHU:
            new_state = self._step_large_tichu(state, player, action)
        elif is_awaiting_tichu_decision(state, player):
            new_state = self._step_tichu_decision(state, player, action)
        else:
            new_state = self._step_trick_play(state, player, action)

        self._state = new_state

        info: dict = {}
        done = new_state.phase is Phase.ROUND_OVER
        if done:
            info["team_scores"] = score_round(new_state)

        return self._observe_current(reward=0.0, done=done, info=info)

    def _step_large_tichu(self, state: GameState, player: int, action: object) -> GameState:
        if not isinstance(action, bool):
            raise ValueError("during Phase.LARGE_TICHU, the action must be True (call) or False (decline)")
        new_state = decide_large_tichu(state, player, called=action)
        if new_state.phase is Phase.EXCHANGE:
            new_state = _auto_exchange(new_state)
        return new_state

    def _step_tichu_decision(self, state: GameState, player: int, action: object) -> GameState:
        if not isinstance(action, bool):
            raise ValueError("during the tichu call/decline decision, the action must be True (call) or False (decline)")
        return decide_tichu(state, player, called=action)

    def _step_trick_play(self, state: GameState, player: int, action: Combo | None) -> GameState:
        legal = legal_combos(state, player)

        if action is None:
            if state.current_best is None:
                raise ValueError("cannot pass while leading a trick")
            recipient = None
            if _is_dragon_win(state):
                recipient = _auto_dragon_recipient(state, state.last_player_to_act)
            return pass_turn(state, player, dragon_recipient=recipient)

        if action not in legal:
            raise ValueError("action is not in the current legal action set")
        # If this play is a lone Dragon single, it may win and end the round
        # outright (no pass_turn will ever follow to supply this), so a
        # recipient must be provided up front; play_combo() simply ignores it
        # when this play doesn't actually end the round.
        recipient = _auto_dragon_recipient(state, player) if _is_dragon_single(action) else None
        return play_combo(state, player, action.cards, dragon_recipient=recipient)

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
            state=state,
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
    """Heuristic (non-RL) exchange strategy used until Stage 3 makes exchange
    a trainable decision: partner gets your best card (or, if you called
    large tichu, a low card instead -- you keep your strength for yourself),
    opponents get your two lowest cards. The Mahjong is never given away
    (its holder becomes the trick leader). The Dog defaults to being treated
    as your lowest card (goes to an opponent), unless you called large tichu
    (goes to your partner instead) or your partner did (you keep it, since
    playing the Dog later hands your partner the lead)."""
    gifts: dict[int, dict[int, Card]] = {}
    for giver in range(NUM_PLAYERS):
        partner = PARTNER[giver]
        opponents = [p for p in range(NUM_PLAYERS) if p not in (giver, partner)]
        giver_called = state.large_tichu_calls[giver] is True
        partner_called = state.large_tichu_calls[partner] is True

        pool = [c for c in state.hands[giver] if c.rank is not Rank.MAHJONG]
        dog = next((c for c in pool if c.rank is Rank.DOG), None)

        partner_card: Card | None = None
        if dog is not None and giver_called:
            partner_card = dog
            pool.remove(dog)
        elif dog is not None and partner_called:
            pool.remove(dog)

        if partner_card is None:
            if giver_called:
                partner_card = min(pool, key=lambda c: c.rank.value)
            else:
                phoenix = next((c for c in pool if c.rank is Rank.PHOENIX), None)
                dragon = next((c for c in pool if c.rank is Rank.DRAGON), None)
                partner_card = phoenix or dragon or max(pool, key=lambda c: c.rank.value)
            pool.remove(partner_card)

        opponent_cards = sorted(pool, key=lambda c: c.rank.value)[:2]
        for c in opponent_cards:
            pool.remove(c)

        gifts[giver] = {
            opponents[0]: opponent_cards[0],
            opponents[1]: opponent_cards[1],
            partner: partner_card,
        }
    return exchange_cards(state, gifts)
