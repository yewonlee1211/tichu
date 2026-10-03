from __future__ import annotations

from typing import Sequence

import numpy as np

from tichu_env.cards import Card, Rank, create_deck
from tichu_env.combinations import Combo, ComboType
from tichu_env.scoring import TEAM_OF
from tichu_env.state import NUM_PLAYERS, GameState, Phase, is_awaiting_tichu_decision, legal_combos

CARD_ORDER: tuple[Card, ...] = create_deck()
CARD_INDEX: dict[Card, int] = {card: i for i, card in enumerate(CARD_ORDER)}
NUM_CARDS = len(CARD_ORDER)

RANK_ORDER: tuple[Rank, ...] = tuple(Rank)
RANK_INDEX: dict[Rank, int] = {rank: i for i, rank in enumerate(RANK_ORDER)}
NUM_RANKS = len(RANK_ORDER)

COMBO_TYPE_ORDER: tuple[ComboType, ...] = tuple(ComboType)
COMBO_TYPE_INDEX: dict[ComboType, int] = {combo_type: i for i, combo_type in enumerate(COMBO_TYPE_ORDER)}
NUM_COMBO_TYPES = len(COMBO_TYPE_ORDER)

PHASE_ORDER: tuple[Phase, ...] = tuple(Phase)
PHASE_INDEX: dict[Phase, int] = {phase: i for i, phase in enumerate(PHASE_ORDER)}
NUM_PHASES = len(PHASE_ORDER)

MAX_HAND_SIZE = 14
MAX_STRENGTH = float(Rank.DRAGON.value)

# --- Observation layout -----------------------------------------------------
# Every block below only encodes information that is legitimately public or
# belongs to the observing player: their own hand, cards already visible on
# the table, seat-relative status flags, and public call/wish state. No
# opponent's exact hand contents ever appear.
_OWN_HAND_DIM = NUM_CARDS
_TRICK_CARDS_DIM = NUM_CARDS
_COLLECTED_POINTS_DIM = NUM_PLAYERS
_HAND_SIZES_DIM = NUM_PLAYERS
_CURRENT_BEST_DIM = 1 + NUM_COMBO_TYPES + 2  # has_current_best, combo_type, length, strength
_CURRENT_PLAYER_DIM = NUM_PLAYERS
_TRICK_LEADER_DIM = NUM_PLAYERS
_LAST_PLAYER_DIM = 1 + NUM_PLAYERS  # has_last_player, relative seat
# Per seat, a one-hot over the 4 mutually exclusive Tichu-call states:
# [undecided, declined_both, called_tichu, called_grand_tichu]. Grand Tichu
# supersedes the (small) Tichu decision (see state.decide_large_tichu), so
# these never overlap -- a single categorical block is enough, replacing what
# used to be two separate scalar/2-bit blocks (Tichu-only, Grand-Tichu-only).
_TICHU_STATUS_UNDECIDED = 0
_TICHU_STATUS_DECLINED = 1
_TICHU_STATUS_TICHU = 2
_TICHU_STATUS_GRAND_TICHU = 3
_NUM_TICHU_STATUSES = 4
_TICHU_STATUS_DIM = _NUM_TICHU_STATUSES * NUM_PLAYERS
# [own team, opposing team], each (target_score - team_score) / target_score.
# Normalized by the target so a 500-, 700-, or 3000-point game reads on the
# same scale. Not clipped: a team can be negative (a failed Grand Tichu costs
# 200), which makes its remaining distance exceed 1.0.
_REMAINING_TO_WIN_DIM = 2
_MAHJONG_WISH_DIM = 1 + NUM_RANKS  # no_wish, wished rank
_FINISHED_DIM = NUM_PLAYERS
_PHASE_DIM = NUM_PHASES
# One NUM_CARDS-wide one-hot slot per opponent (relative offsets 1..3), for
# the card each of them gave the observing player during the exchange.
_EXCHANGE_RECEIVED_DIM = (NUM_PLAYERS - 1) * NUM_CARDS
_PASSES_DIM = 1  # normalized count of consecutive passes on the current trick

OBS_DIM = (
    _OWN_HAND_DIM
    + _TRICK_CARDS_DIM
    + _COLLECTED_POINTS_DIM
    + _HAND_SIZES_DIM
    + _CURRENT_BEST_DIM
    + _CURRENT_PLAYER_DIM
    + _TRICK_LEADER_DIM
    + _LAST_PLAYER_DIM
    + _TICHU_STATUS_DIM
    + _REMAINING_TO_WIN_DIM
    + _MAHJONG_WISH_DIM
    + _FINISHED_DIM
    + _PHASE_DIM
    + _EXCHANGE_RECEIVED_DIM
    + _PASSES_DIM
)

# --- Action layout -----------------------------------------------------------
# cards used, combo type, length, rank strength, is_lone_phoenix, is_pass
# (kept last so it stays addressable as vec[-1], matching every existing
# PASS-detection call site). Large-Tichu and (small) Tichu call/decline used
# to occupy 4 more offsets here as RL pseudo-actions; they are now auto-
# resolved by TichuEnv via a fixed heuristic instead (see its class
# docstring and .claude/plans/tichu-m2-action-space-curriculum.plan.md), so
# this action space covers trick play only.
ACTION_DIM = NUM_CARDS + NUM_COMBO_TYPES + 4


def encode_observation(state: GameState, player: int) -> np.ndarray:
    def relative_seats() -> range:
        return range(NUM_PLAYERS)

    def seat_of(offset: int) -> int:
        return (player + offset) % NUM_PLAYERS

    parts = [
        _cards_bitmask(state.hands[player]),
        _cards_bitmask(state.trick_cards),
        np.array([_points(state.collected_tricks[seat_of(o)]) / 100.0 for o in relative_seats()], dtype=np.float32),
        np.array([len(state.hands[seat_of(o)]) / MAX_HAND_SIZE for o in relative_seats()], dtype=np.float32),
        _encode_current_best(state.current_best, state.current_strength),
        _relative_seat_onehot(state.current_player, player),
        _relative_seat_onehot(state.trick_leader, player),
        _encode_optional_seat(state.last_player_to_act, player),
        _encode_tichu_status(state, player),
        _encode_remaining_to_win(state, player),
        _encode_mahjong_wish(state.mahjong_wish),
        np.array([1.0 if seat_of(o) in state.finished_order else 0.0 for o in relative_seats()], dtype=np.float32),
        _encode_phase(state.phase),
        _encode_exchange_received(state.received_from[player], player),
        np.array([state.passes_in_a_row / NUM_PLAYERS], dtype=np.float32),
    ]
    return np.concatenate(parts).astype(np.float32)


def encode_action(combo: Combo | None) -> np.ndarray:
    """Encode a single candidate action. `combo=None` represents PASS."""
    vec = np.zeros(ACTION_DIM, dtype=np.float32)
    if combo is None:
        vec[-1] = 1.0
        return vec
    for card in combo.cards:
        vec[CARD_INDEX[card]] = 1.0
    vec[NUM_CARDS + COMBO_TYPE_INDEX[combo.combo_type]] = 1.0
    vec[NUM_CARDS + NUM_COMBO_TYPES] = combo.length / MAX_HAND_SIZE
    vec[NUM_CARDS + NUM_COMBO_TYPES + 1] = combo.rank_strength / MAX_STRENGTH
    vec[NUM_CARDS + NUM_COMBO_TYPES + 2] = 1.0 if combo.is_lone_phoenix else 0.0
    return vec


def encode_legal_actions(state: GameState, player: int) -> list[tuple[Combo | None, np.ndarray]]:
    """All legal trick-play candidate actions for `player` right now, each
    paired with its encoded vector.

    The large-Tichu and (small) Tichu call/decline decisions are no longer
    part of the RL action space: `TichuEnv` auto-resolves both internally via
    a fixed heuristic before ever exposing a state to a caller (see
    `TichuEnv._auto_resolve_calls`), so this function assumes `state` is
    already past both -- and raises rather than silently returning nonsense
    from `legal_combos` on a state it was never designed for -- but still
    accepts `Phase.ROUND_OVER` (the terminal state `TichuEnv._observe_current`
    still builds a `StepResult` for, expecting an empty/trivial action list).

    PASS (`None`) is included only when it is actually `player`'s turn and
    there is a current trick to pass on (you cannot pass while leading, and
    a non-turn player may only interrupt with a bomb, never pass)."""
    if state.phase is Phase.LARGE_TICHU or is_awaiting_tichu_decision(state, player):
        raise ValueError(
            "encode_legal_actions expects a state past all call decisions -- "
            "large-Tichu and Tichu calls are auto-resolved by TichuEnv, not exposed as legal actions"
        )

    candidates: list[Combo | None] = list(legal_combos(state, player))
    if state.current_best is not None and player == state.current_player:
        candidates.append(None)
    return [(combo, encode_action(combo)) for combo in candidates]


def _cards_bitmask(cards: Sequence[Card]) -> np.ndarray:
    vec = np.zeros(NUM_CARDS, dtype=np.float32)
    for card in cards:
        vec[CARD_INDEX[card]] = 1.0
    return vec


def _relative_seat_onehot(seat: int, perspective: int) -> np.ndarray:
    vec = np.zeros(NUM_PLAYERS, dtype=np.float32)
    vec[(seat - perspective) % NUM_PLAYERS] = 1.0
    return vec


def _encode_optional_seat(seat: int | None, perspective: int) -> np.ndarray:
    vec = np.zeros(1 + NUM_PLAYERS, dtype=np.float32)
    if seat is None:
        return vec
    vec[0] = 1.0
    vec[1 + (seat - perspective) % NUM_PLAYERS] = 1.0
    return vec


def _encode_current_best(combo: Combo | None, strength: float) -> np.ndarray:
    vec = np.zeros(_CURRENT_BEST_DIM, dtype=np.float32)
    if combo is None:
        return vec
    vec[0] = 1.0
    vec[1 + COMBO_TYPE_INDEX[combo.combo_type]] = 1.0
    vec[1 + NUM_COMBO_TYPES] = combo.length / MAX_HAND_SIZE
    vec[1 + NUM_COMBO_TYPES + 1] = strength / MAX_STRENGTH
    return vec


def _encode_tichu_status(state: GameState, perspective: int) -> np.ndarray:
    vec = np.zeros(_TICHU_STATUS_DIM, dtype=np.float32)
    for offset in range(NUM_PLAYERS):
        seat = (perspective + offset) % NUM_PLAYERS
        status = _tichu_status(state, seat)
        vec[_NUM_TICHU_STATUSES * offset + status] = 1.0
    return vec


def _encode_remaining_to_win(state: GameState, perspective: int) -> np.ndarray:
    own_team = TEAM_OF[perspective]
    target = float(state.target_score)
    return np.array(
        [
            (target - state.team_scores[own_team]) / target,
            (target - state.team_scores[1 - own_team]) / target,
        ],
        dtype=np.float32,
    )


def _tichu_status(state: GameState, seat: int) -> int:
    """One of the 4 `_TICHU_STATUS_*` categories for `seat`, derived from
    `large_tichu_calls`/`tichu_decided`/`tichu_calls` (see their field
    comments on `GameState`). Calling Grand Tichu (`large_tichu_calls[seat]
    is True`) always means `tichu_calls[seat]` is still False -- `seat` never
    actually reaches the (small) Tichu decision, since decide_large_tichu
    marks tichu_decided True for them at the same time they call it."""
    large_tichu = state.large_tichu_calls[seat]
    if large_tichu is None:
        return _TICHU_STATUS_UNDECIDED
    if large_tichu is True:
        return _TICHU_STATUS_GRAND_TICHU
    if not state.tichu_decided[seat]:
        return _TICHU_STATUS_UNDECIDED
    return _TICHU_STATUS_TICHU if state.tichu_calls[seat] else _TICHU_STATUS_DECLINED


def _encode_phase(phase: Phase) -> np.ndarray:
    vec = np.zeros(_PHASE_DIM, dtype=np.float32)
    vec[PHASE_INDEX[phase]] = 1.0
    return vec


def _encode_exchange_received(received: dict[int, Card], perspective: int) -> np.ndarray:
    vec = np.zeros(_EXCHANGE_RECEIVED_DIM, dtype=np.float32)
    for offset in range(1, NUM_PLAYERS):
        giver = (perspective + offset) % NUM_PLAYERS
        card = received.get(giver)
        if card is not None:
            vec[(offset - 1) * NUM_CARDS + CARD_INDEX[card]] = 1.0
    return vec


def _encode_mahjong_wish(wish: Rank | None) -> np.ndarray:
    vec = np.zeros(_MAHJONG_WISH_DIM, dtype=np.float32)
    if wish is None:
        vec[0] = 1.0
        return vec
    vec[1 + RANK_INDEX[wish]] = 1.0
    return vec


def _points(cards: Sequence[Card]) -> int:
    return sum(card.point_value for card in cards)
