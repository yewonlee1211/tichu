from __future__ import annotations

import random
from dataclasses import dataclass, replace
from typing import Optional

import numpy as np

from agents.advanced_heuristic import AdvancedHeuristicAgent
from tichu_env.cards import Card, Rank
from tichu_env.combinations import Combo, ComboType
from tichu_env.encoding import encode_legal_actions, encode_observation
from tichu_env.scoring import score_round
from tichu_env.state import (
    DEFAULT_TARGET_SCORE,
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
    legal_actions: list[tuple[Combo | None, np.ndarray]]
    reward: float
    done: bool
    info: dict
    state: GameState


class TichuEnv:
    """A single-round Tichu environment. The RL action space is trick play
    only (`Phase.PLAYING`, a `Combo` or `None` to pass). The large-Tichu
    call/decline decision (`Phase.LARGE_TICHU`), the (small) Tichu
    call/decline decision (offered once per player, right before their
    first `Phase.PLAYING` action -- see `state.is_awaiting_tichu_decision`),
    and card exchange are all auto-resolved internally by a fixed heuristic
    (`AdvancedHeuristicAgent`, see `_auto_resolve_calls` and
    `_auto_exchange`) rather than exposed as RL decisions -- trick play is
    conditioned on the outcome anyway via `encoding.OBS_DIM`'s call/exchange
    observation fields, which are unaffected by this. See
    .claude/plans/tichu-m2-action-space-curriculum.plan.md for the curriculum
    history: card exchange was auto-resolved from the start ("결정 3"), while
    the calls were briefly RL-trainable (Stage 1/2) before their action head
    collapsed to always-decline regardless of hand strength and calls were
    moved to this same auto-resolved pattern -- see the plan's "5단계" for
    the collapse diagnosis and what reintroducing them as trainable actions
    would require."""

    def __init__(self, rng: random.Random | None = None, target_score: int = DEFAULT_TARGET_SCORE):
        if target_score <= 0:
            raise ValueError("target_score must be positive")
        self._rng = rng if rng is not None else random.Random()
        self._target_score = target_score
        self._state: GameState | None = None
        self._observed_legal: tuple[GameState, int, list[Combo]] | None = None
        self._heuristic = AdvancedHeuristicAgent()

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

    def reset(self, team_scores: tuple[int, int] = (0, 0)) -> StepResult:
        state = replace(deal_new_round(self._rng), team_scores=team_scores, target_score=self._target_score)
        self._state = self._auto_resolve_calls(state)
        return self._observe_current(reward=0.0, done=False, info={})

    def step(self, action: Combo | None) -> StepResult:
        state = self.state
        player = state.current_player

        new_state = self._step_trick_play(state, player, action)
        new_state = self._auto_resolve_calls(new_state)
        self._state = new_state

        info: dict = {}
        done = new_state.phase is Phase.ROUND_OVER
        if done:
            info["team_scores"] = score_round(new_state)

        return self._observe_current(reward=0.0, done=done, info=info)

    def _auto_resolve_calls(self, state: GameState) -> GameState:
        """Resolves every pending large-Tichu/Tichu call decision for
        whichever player is up next via the fixed heuristic, looping until
        the state actually needs a trick-play action (or the round ends) --
        the same non-RL auto-resolution `_auto_exchange` already does for
        card exchange, now covering the two call decisions too (see the
        class docstring). Each decision only advances `state.current_player`
        by itself for the large-Tichu round (one decision per player before
        anyone starts playing); the (small) Tichu decision does not consume
        the deciding player's real turn, so after resolving it this loop
        re-checks the same player before falling through to trick play."""
        while True:
            if state.phase is Phase.LARGE_TICHU:
                player = state.current_player
                called = self._heuristic.should_call_large_tichu(state.hands[player])
                state = decide_large_tichu(state, player, called=called)
                if state.phase is Phase.EXCHANGE:
                    state = _auto_exchange(state)
                continue

            if is_awaiting_tichu_decision(state, state.current_player):
                player = state.current_player
                called = self._heuristic.should_call_tichu(state.hands[player])
                state = decide_tichu(state, player, called=called)
                continue

            return state

    def _step_trick_play(self, state: GameState, player: int, action: Combo | None) -> GameState:
        legal = self._legal_for(state, player)

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

    def _legal_for(self, state: GameState, player: int) -> list[Combo]:
        """`legal_combos(state, player)`, reusing the set `_observe_current`
        already computed for exactly this state and player when available --
        `encode_legal_actions`' candidates are `legal_combos` plus an optional
        PASS, so recomputing them to validate the very next step() doubled
        the dominant self-play cost."""
        cached = self._observed_legal
        if cached is not None and cached[0] is state and cached[1] == player:
            return cached[2]
        return legal_combos(state, player)

    def _observe_current(self, *, reward: float, done: bool, info: dict) -> StepResult:
        state = self.state
        player = state.current_player
        legal_actions = encode_legal_actions(state, player)
        self._observed_legal = (state, player, [combo for combo, _ in legal_actions if combo is not None])
        return StepResult(
            player=player,
            observation=encode_observation(state, player),
            legal_actions=legal_actions,
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
