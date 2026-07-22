from __future__ import annotations

import random
from dataclasses import dataclass, replace
from enum import Enum
from typing import Sequence

from tichu_env.cards import Card, Rank, create_deck
from tichu_env.combinations import Combo, ComboType, beats, effective_strength, identify_combo
from tichu_env.legal_moves import candidate_card_sets

NUM_PLAYERS = 4
PARTNER = {0: 2, 1: 3, 2: 0, 3: 1}

_BOMB_TYPES = frozenset({ComboType.BOMB_QUAD, ComboType.BOMB_STRAIGHT_FLUSH})


class Phase(Enum):
    LARGE_TICHU = "large_tichu"
    EXCHANGE = "exchange"
    PLAYING = "playing"
    ROUND_OVER = "round_over"


@dataclass(frozen=True)
class GameState:
    hands: tuple[tuple[Card, ...], ...]
    pending_final_cards: tuple[tuple[Card, ...], ...]
    phase: Phase
    current_player: int
    trick_leader: int
    trick_cards: tuple[Card, ...]
    current_best: Combo | None
    current_strength: float
    last_player_to_act: int | None
    passes_in_a_row: int
    finished_order: tuple[int, ...]
    collected_tricks: tuple[tuple[Card, ...], ...]
    large_tichu_calls: tuple[bool | None, ...]
    tichu_calls: tuple[bool, ...]
    mahjong_wish: Rank | None


def deal_new_round(rng: random.Random | None = None) -> GameState:
    rng = rng if rng is not None else random.Random()
    deck = list(create_deck())
    rng.shuffle(deck)
    initial_hands = tuple(tuple(deck[i * 14 : i * 14 + 8]) for i in range(NUM_PLAYERS))
    final_cards = tuple(tuple(deck[i * 14 + 8 : i * 14 + 14]) for i in range(NUM_PLAYERS))
    return GameState(
        hands=initial_hands,
        pending_final_cards=final_cards,
        phase=Phase.LARGE_TICHU,
        current_player=0,
        trick_leader=0,
        trick_cards=(),
        current_best=None,
        current_strength=0.0,
        last_player_to_act=None,
        passes_in_a_row=0,
        finished_order=(),
        collected_tricks=tuple(() for _ in range(NUM_PLAYERS)),
        large_tichu_calls=(None, None, None, None),
        tichu_calls=(False, False, False, False),
        mahjong_wish=None,
    )


def decide_large_tichu(state: GameState, player: int, called: bool) -> GameState:
    if state.phase is not Phase.LARGE_TICHU:
        raise ValueError("large tichu can only be decided before the final 6 cards are dealt")
    if state.large_tichu_calls[player] is not None:
        raise ValueError("player has already decided on large tichu")

    calls = list(state.large_tichu_calls)
    calls[player] = called
    state = replace(state, large_tichu_calls=tuple(calls))

    if all(c is not None for c in state.large_tichu_calls):
        new_hands = tuple(state.hands[i] + state.pending_final_cards[i] for i in range(NUM_PLAYERS))
        state = replace(
            state,
            hands=new_hands,
            pending_final_cards=tuple(() for _ in range(NUM_PLAYERS)),
            phase=Phase.EXCHANGE,
        )
    return state


def call_tichu(state: GameState, player: int) -> GameState:
    if state.phase not in (Phase.EXCHANGE, Phase.PLAYING):
        raise ValueError("tichu can only be called after the large tichu decision window")
    if state.tichu_calls[player]:
        raise ValueError("player has already called tichu")
    if len(state.hands[player]) != 14:
        raise ValueError("tichu can only be called while still holding all 14 cards")

    calls = list(state.tichu_calls)
    calls[player] = True
    return replace(state, tichu_calls=tuple(calls))


def exchange_cards(state: GameState, gifts: dict[int, dict[int, Card]]) -> GameState:
    if state.phase is not Phase.EXCHANGE:
        raise ValueError("cards can only be exchanged during the exchange phase")

    for giver in range(NUM_PLAYERS):
        recipients = gifts.get(giver, {})
        expected_recipients = {p for p in range(NUM_PLAYERS) if p != giver}
        if set(recipients) != expected_recipients:
            raise ValueError(f"player {giver} must give exactly one card to each of the other three players")
        if len(set(recipients.values())) != 3:
            raise ValueError("cannot give the same physical card to more than one recipient")
        for card in recipients.values():
            if card not in state.hands[giver]:
                raise ValueError("cannot give away a card that is not in hand")

    incoming: list[list[Card]] = [[] for _ in range(NUM_PLAYERS)]
    for giver in range(NUM_PLAYERS):
        for recipient, card in gifts[giver].items():
            incoming[recipient].append(card)

    new_hands = []
    for player in range(NUM_PLAYERS):
        given_away = set(gifts[player].values())
        kept = tuple(c for c in state.hands[player] if c not in given_away)
        new_hands.append(kept + tuple(incoming[player]))

    leader = next(p for p in range(NUM_PLAYERS) if any(c.rank is Rank.MAHJONG for c in new_hands[p]))
    return replace(
        state,
        hands=tuple(new_hands),
        phase=Phase.PLAYING,
        current_player=leader,
        trick_leader=leader,
    )


def legal_combos(state: GameState, player: int) -> list[Combo]:
    """All combos `player` may legally play right now. Only the trick leader
    may open a fresh trick (any combo type, including a bomb); once a trick
    is under way, ordinary combos are restricted to whoever's turn it is,
    while bombs remain legal for any active player as an interrupt.

    Candidates come from `legal_moves.candidate_card_sets`, which builds them
    from the hand's rank/suit structure instead of a brute-force subset scan
    (2**14 in the worst case) -- `identify_combo`/`beats` still decide what
    is actually legal, this just avoids checking every possible subset."""
    hand = state.hands[player]
    is_leading = state.current_best is None

    if is_leading and player != state.trick_leader:
        return []

    only_bombs = not is_leading and player != state.current_player

    found: list[Combo] = []
    seen: set[frozenset[Card]] = set()
    for cards in candidate_card_sets(hand):
        key = frozenset(cards)
        if key in seen:
            continue
        seen.add(key)
        combo = identify_combo(cards)
        if combo is None:
            continue
        if combo.combo_type is ComboType.DOG:
            if is_leading:
                found.append(combo)
            continue
        is_bomb = combo.combo_type in _BOMB_TYPES
        if only_bombs and not is_bomb:
            continue
        if is_leading:
            found.append(combo)
        elif beats(combo, state.current_best, state.current_strength):
            found.append(combo)
    return found


def play_combo(state: GameState, player: int, cards: Sequence[Card], wish: Rank | None = None) -> GameState:
    if state.phase is not Phase.PLAYING:
        raise ValueError("cards can only be played during the playing phase")
    if player in state.finished_order:
        raise ValueError("player has already finished this round")

    cards = tuple(cards)
    combo = identify_combo(cards)
    if combo is None:
        raise ValueError("not a valid combination")
    if any(card not in state.hands[player] for card in cards):
        raise ValueError("player does not hold all of these cards")

    is_bomb = combo.combo_type in _BOMB_TYPES
    is_dog = combo.combo_type is ComboType.DOG

    if is_dog:
        if state.current_best is not None or player != state.trick_leader:
            raise ValueError("the Dog can only be played to open a trick")
    elif state.current_best is None:
        if player != state.trick_leader:
            raise ValueError("only the trick leader may open a new trick")
    elif not is_bomb and player != state.current_player:
        raise ValueError("it is not this player's turn (only a bomb may interrupt)")

    if not is_dog and state.current_best is not None:
        if not beats(combo, state.current_best, state.current_strength):
            raise ValueError("this combination does not beat the current trick")

    if wish is not None and not any(card.rank is Rank.MAHJONG for card in cards):
        raise ValueError("only a play that includes the Mahjong can set a wish")

    if state.mahjong_wish is not None and not any(card.rank is state.mahjong_wish for card in cards):
        if _wish_fulfilling_plays(state, player):
            raise ValueError(f"must play a combination including the wished rank {state.mahjong_wish}")

    remaining_hand = tuple(c for c in state.hands[player] if c not in cards)
    new_hands = list(state.hands)
    new_hands[player] = remaining_hand

    finished_order = state.finished_order
    if not remaining_hand:
        finished_order = finished_order + (player,)
    double_win = len(finished_order) == 2 and PARTNER[finished_order[0]] == finished_order[1]
    round_over = len(finished_order) >= 3 or double_win

    if is_dog:
        next_leader = _next_leader_after_dog(player, finished_order)
        return replace(
            state,
            hands=tuple(new_hands),
            trick_cards=(),
            current_best=None,
            current_strength=0.0,
            last_player_to_act=None,
            passes_in_a_row=0,
            trick_leader=next_leader,
            current_player=next_leader,
            finished_order=finished_order,
            phase=Phase.ROUND_OVER if round_over else Phase.PLAYING,
        )

    new_strength = effective_strength(combo, state.current_strength if state.current_best is not None else None)

    new_wish = state.mahjong_wish
    if any(card.rank is Rank.MAHJONG for card in cards):
        new_wish = wish
    elif state.mahjong_wish is not None and any(card.rank is state.mahjong_wish for card in cards):
        new_wish = None

    next_player = _next_active_player(player, finished_order)

    return replace(
        state,
        hands=tuple(new_hands),
        trick_cards=state.trick_cards + cards,
        current_best=combo,
        current_strength=new_strength,
        last_player_to_act=player,
        passes_in_a_row=0,
        current_player=next_player,
        finished_order=finished_order,
        mahjong_wish=new_wish,
        phase=Phase.ROUND_OVER if round_over else Phase.PLAYING,
    )


def pass_turn(state: GameState, player: int, dragon_recipient: int | None = None) -> GameState:
    if state.phase is not Phase.PLAYING:
        raise ValueError("can only pass during the playing phase")
    if state.current_best is None:
        raise ValueError("the trick leader must play, not pass")
    if player != state.current_player:
        raise ValueError("it is not this player's turn")

    if _wish_fulfilling_plays(state, player):
        raise ValueError(
            f"must play a combination including the wished rank {state.mahjong_wish} instead of passing"
        )

    active_count = NUM_PLAYERS - len(state.finished_order)
    winner = state.last_player_to_act
    assert winner is not None
    # Everyone currently active must pass before a trick resolves, except the
    # winner themself if they are still active (they already acted). If the
    # winner has already gone out this trick (their winning play was also
    # their last card), every remaining active player must pass.
    winner_still_active = winner not in state.finished_order
    needed_passes = active_count - 1 if winner_still_active else active_count

    passes = state.passes_in_a_row + 1
    if passes < needed_passes:
        return replace(
            state,
            passes_in_a_row=passes,
            current_player=_next_active_player(player, state.finished_order),
        )
    is_dragon_win = (
        state.current_best.combo_type is ComboType.SINGLE and state.current_best.cards[0].rank is Rank.DRAGON
    )
    if is_dragon_win:
        if dragon_recipient is None:
            raise ValueError("winning a trick with the Dragon requires choosing an opponent to give it to")
        if dragon_recipient == winner or PARTNER[dragon_recipient] == winner:
            raise ValueError("the Dragon trick must go to an opponent, not the winner's own team")
        if dragon_recipient in state.finished_order:
            raise ValueError("cannot give the Dragon trick to a player who has already finished")
        recipient = dragon_recipient
    else:
        if dragon_recipient is not None:
            raise ValueError("dragon_recipient is only used when the Dragon wins the trick")
        recipient = winner

    collected = list(state.collected_tricks)
    collected[recipient] = collected[recipient] + state.trick_cards

    if winner in state.finished_order:
        # Same fallback as the Dog: partner first, else nearest active player
        # going counter-clockwise.
        next_leader = _next_leader_after_dog(winner, state.finished_order)
    else:
        next_leader = winner

    return replace(
        state,
        trick_cards=(),
        current_best=None,
        current_strength=0.0,
        last_player_to_act=None,
        passes_in_a_row=0,
        trick_leader=next_leader,
        current_player=next_leader,
        collected_tricks=tuple(collected),
    )


def _wish_fulfilling_plays(state: GameState, player: int) -> list[Combo]:
    """Legal combos for `player` right now that would satisfy a pending
    Mahjong wish. Empty if there is no wish, or no legal play can fulfill it."""
    if state.mahjong_wish is None:
        return []
    wished_rank = state.mahjong_wish
    return [combo for combo in legal_combos(state, player) if any(card.rank is wished_rank for card in combo.cards)]


def _next_active_player(current: int, finished_order: tuple[int, ...]) -> int:
    seat = (current + 1) % NUM_PLAYERS
    while seat in finished_order:
        seat = (seat + 1) % NUM_PLAYERS
    return seat


def _next_leader_after_dog(player: int, finished_order: tuple[int, ...]) -> int:
    partner = PARTNER[player]
    if partner not in finished_order:
        return partner
    seat = (player - 1) % NUM_PLAYERS
    while seat in finished_order:
        seat = (seat - 1) % NUM_PLAYERS
    return seat
