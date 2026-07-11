from __future__ import annotations

from typing import Sequence

import numpy as np

from tichu_env.cards import Card, Rank, create_deck
from tichu_env.combinations import Combo, ComboType
from tichu_env.state import NUM_PLAYERS, GameState, legal_combos

CARD_ORDER: tuple[Card, ...] = create_deck()
CARD_INDEX: dict[Card, int] = {card: i for i, card in enumerate(CARD_ORDER)}
NUM_CARDS = len(CARD_ORDER)

RANK_ORDER: tuple[Rank, ...] = tuple(Rank)
RANK_INDEX: dict[Rank, int] = {rank: i for i, rank in enumerate(RANK_ORDER)}
NUM_RANKS = len(RANK_ORDER)

COMBO_TYPE_ORDER: tuple[ComboType, ...] = tuple(ComboType)
COMBO_TYPE_INDEX: dict[ComboType, int] = {combo_type: i for i, combo_type in enumerate(COMBO_TYPE_ORDER)}
NUM_COMBO_TYPES = len(COMBO_TYPE_ORDER)

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
_TICHU_CALLS_DIM = NUM_PLAYERS
_LARGE_TICHU_CALLS_DIM = NUM_PLAYERS
_MAHJONG_WISH_DIM = 1 + NUM_RANKS  # no_wish, wished rank
_FINISHED_DIM = NUM_PLAYERS

OBS_DIM = (
    _OWN_HAND_DIM
    + _TRICK_CARDS_DIM
    + _COLLECTED_POINTS_DIM
    + _HAND_SIZES_DIM
    + _CURRENT_BEST_DIM
    + _CURRENT_PLAYER_DIM
    + _TRICK_LEADER_DIM
    + _LAST_PLAYER_DIM
    + _TICHU_CALLS_DIM
    + _LARGE_TICHU_CALLS_DIM
    + _MAHJONG_WISH_DIM
    + _FINISHED_DIM
)

# --- Action layout -----------------------------------------------------------
# cards used, combo type, length, rank strength, is_lone_phoenix, is_pass
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
        np.array([1.0 if state.tichu_calls[seat_of(o)] else 0.0 for o in relative_seats()], dtype=np.float32),
        np.array([1.0 if state.large_tichu_calls[seat_of(o)] else 0.0 for o in relative_seats()], dtype=np.float32),
        _encode_mahjong_wish(state.mahjong_wish),
        np.array([1.0 if seat_of(o) in state.finished_order else 0.0 for o in relative_seats()], dtype=np.float32),
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
    """All legal candidate actions for `player` right now, each paired with its
    encoded vector. PASS is included only when it is actually `player`'s turn
    and there is a current trick to pass on (you cannot pass while leading,
    and a non-turn player may only interrupt with a bomb, never pass)."""
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


def _encode_mahjong_wish(wish: Rank | None) -> np.ndarray:
    vec = np.zeros(_MAHJONG_WISH_DIM, dtype=np.float32)
    if wish is None:
        vec[0] = 1.0
        return vec
    vec[1 + RANK_INDEX[wish]] = 1.0
    return vec


def _points(cards: Sequence[Card]) -> int:
    return sum(card.point_value for card in cards)
