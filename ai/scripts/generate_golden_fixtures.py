"""Generate golden fixtures from ai/tichu_env for the packages/shared TS port.

Run inside the ai Docker container (PYTHONPATH=/app):
    docker compose exec ai python scripts/generate_golden_fixtures.py

Writes one JSON file per scenario into ai/_tmp_golden_fixtures/. That
directory is bind-mounted to the host, so the files are picked up from the
host filesystem afterward and copied into packages/shared/src/goldenFixtures/
(this container has no visibility into packages/, which lives outside the
ai/ bind mount).
"""

from __future__ import annotations

import json
import random
from dataclasses import replace
from pathlib import Path

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import Combo, identify_combo
from tichu_env.encoding import ACTION_DIM, OBS_DIM, encode_legal_actions, encode_observation
from tichu_env.scoring import score_round
from tichu_env.state import (
    NUM_PLAYERS,
    GameState,
    Phase,
    deal_new_round,
    decide_large_tichu,
    exchange_cards,
    pass_turn,
    play_combo,
)

OUTPUT_DIR = Path(__file__).resolve().parent.parent / "_tmp_golden_fixtures"


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def make_playing_state(hands: dict[int, list[Card]], **overrides) -> GameState:
    full_hands = tuple(tuple(hands.get(i, [])) for i in range(NUM_PLAYERS))
    base = dict(
        hands=full_hands,
        pending_final_cards=tuple(() for _ in range(NUM_PLAYERS)),
        phase=Phase.PLAYING,
        current_player=0,
        trick_leader=0,
        trick_cards=(),
        current_best=None,
        current_strength=0.0,
        last_player_to_act=None,
        passes_in_a_row=0,
        finished_order=(),
        collected_tricks=tuple(() for _ in range(NUM_PLAYERS)),
        large_tichu_calls=(False, False, False, False),
        tichu_calls=(False, False, False, False),
        mahjong_wish=None,
    )
    base.update(overrides)
    return GameState(**base)


# --- Serialization ------------------------------------------------------------


def ser_card(c: Card) -> dict:
    return {"rank": c.rank.name, "suit": c.suit.name}


def ser_cards(cards) -> list:
    return [ser_card(c) for c in cards]


def ser_combo(combo: Combo | None) -> dict | None:
    if combo is None:
        return None
    return {
        "comboType": combo.combo_type.name,
        "cards": ser_cards(combo.cards),
        "length": combo.length,
        "rankStrength": combo.rank_strength,
        "isLonePhoenix": combo.is_lone_phoenix,
    }


def ser_state(state: GameState) -> dict:
    return {
        "hands": [ser_cards(h) for h in state.hands],
        "pendingFinalCards": [ser_cards(h) for h in state.pending_final_cards],
        "phase": state.phase.name,
        "currentPlayer": state.current_player,
        "trickLeader": state.trick_leader,
        "trickCards": ser_cards(state.trick_cards),
        "currentBest": ser_combo(state.current_best),
        "currentStrength": state.current_strength,
        "lastPlayerToAct": state.last_player_to_act,
        "passesInARow": state.passes_in_a_row,
        "finishedOrder": list(state.finished_order),
        "collectedTricks": [ser_cards(t) for t in state.collected_tricks],
        "largeTichuCalls": list(state.large_tichu_calls),
        "tichuCalls": list(state.tichu_calls),
        "mahjongWish": state.mahjong_wish.name if state.mahjong_wish is not None else None,
    }


def ser_vec(vec) -> list:
    return [float(x) for x in vec.tolist()]


def ser_observation(state: GameState, player: int) -> list:
    return ser_vec(encode_observation(state, player))


def ser_legal_actions(state: GameState, player: int) -> list:
    return [{"combo": ser_combo(combo), "vector": ser_vec(vec)} for combo, vec in encode_legal_actions(state, player)]


def write_fixture(name: str, description: str, payload: dict) -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    full = {"name": name, "description": description, "obsDim": OBS_DIM, "actionDim": ACTION_DIM, **payload}
    path = OUTPUT_DIR / f"{name}.json"
    path.write_text(json.dumps(full, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"wrote {path}")


# --- Scenario 1: normal round --------------------------------------------------


def build_normal_round() -> dict:
    """Deal (seed=1) -> everyone declines large tichu -> non-strategic exchange
    (lowest 3 cards, one per opponent, mirroring env.py's _auto_exchange) ->
    one ordinary trick: leader opens a single, the other three pass in turn."""
    state = deal_new_round(random.Random(1))
    dealt = ser_state(state)

    for player in range(NUM_PLAYERS):
        state = decide_large_tichu(state, player, called=False)
    after_large_tichu = ser_state(state)

    gifts = {}
    for giver in range(NUM_PLAYERS):
        hand = sorted(state.hands[giver], key=lambda c: c.rank.value)
        others = [p for p in range(NUM_PLAYERS) if p != giver]
        gifts[giver] = {recipient: hand[i] for i, recipient in enumerate(others)}
    state = exchange_cards(state, gifts)
    after_exchange = ser_state(state)

    leader = state.current_player
    observation_before_lead = ser_observation(state, leader)
    legal_actions_before_lead = ser_legal_actions(state, leader)

    # Exclude the Dog: it would hand the lead to the leader's partner instead
    # of starting an ordinary trick, which this scenario isn't about.
    lead_card = min((c for c in state.hands[leader] if c.rank is not Rank.DOG), key=lambda c: c.rank.value)
    state = play_combo(state, leader, [lead_card])
    after_lead = ser_state(state)

    for _ in range(NUM_PLAYERS - 1):
        state = pass_turn(state, state.current_player)
    after_trick = ser_state(state)

    return {
        "dealtState": dealt,
        "afterLargeTichuState": after_large_tichu,
        "afterExchangeState": after_exchange,
        "leader": leader,
        "observationBeforeLead": observation_before_lead,
        "legalActionsBeforeLead": legal_actions_before_lead,
        "leadCard": ser_card(lead_card),
        "afterLeadState": after_lead,
        "afterTrickState": after_trick,
    }


# --- Scenario 2: bomb interrupt ------------------------------------------------


def build_bomb_interrupt() -> dict:
    """Player 0 opens with a lone Five; player 2 (out of turn) interrupts with
    a Seven bomb. Mirrors ai/tests/test_state.py::test_bomb_can_interrupt_out_of_turn."""
    quad = [card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)]
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [], 2: quad + [card(Rank.THREE)], 3: []},
        current_player=0,
        trick_leader=0,
    )
    before = ser_state(state)

    state = play_combo(state, 0, [card(Rank.FIVE)])
    after_open = ser_state(state)
    legal_actions_for_player2_before_bomb = ser_legal_actions(state, 2)

    state = play_combo(state, 2, quad)
    after_bomb = ser_state(state)

    return {
        "beforeState": before,
        "afterOpenState": after_open,
        "legalActionsForPlayer2BeforeBomb": legal_actions_for_player2_before_bomb,
        "bombCards": ser_cards(quad),
        "afterBombState": after_bomb,
    }


# --- Scenario 3: double out -----------------------------------------------------


def build_double_out() -> dict:
    """Seats 1 and 3 are partners. Seat 1 already finished (1st place); seat 3
    finishes next with their last card (2nd place), triggering a double win.
    Seat 1 also called small Tichu and *is* the 1st-place finisher, so this
    exercises the +100 Tichu bonus stacking on top of the +200 double-win
    bonus within the same team."""
    state = make_playing_state(
        {3: [card(Rank.NINE)]},
        current_player=3,
        trick_leader=3,
        finished_order=(1,),
        tichu_calls=(False, True, False, False),
    )
    before = ser_state(state)

    resolved = play_combo(state, 3, [card(Rank.NINE)])
    after_play = ser_state(resolved)
    observation_for_winner = ser_observation(resolved, 3)

    team_deltas = score_round(resolved)

    return {
        "beforeState": before,
        "afterPlayState": after_play,
        "observationForWinner": observation_for_winner,
        "teamScoreDeltas": {"team0": team_deltas[0], "team1": team_deltas[1]},
    }


# --- Scenario 4: last-card handover ---------------------------------------------


def build_last_card_handover() -> dict:
    """Seats 0 and 1 already finished. Seat 2 plays their last card (a Six)
    beating seat 0's pending Five lead, becoming the 3rd finisher and ending
    the round -- not a double win (seats 0/2 aren't partners). Seat 3 (the
    "fourth") is left holding a King and a Three: score_round must move those
    10 points to the opposing team, while seat 3's already-collected Four
    (0 points) goes to 1st place's team."""
    state = make_playing_state(
        {2: [card(Rank.SIX)], 3: [card(Rank.KING), card(Rank.THREE)]},
        current_player=2,
        trick_leader=0,
        current_best=identify_combo([card(Rank.FIVE)]),
        current_strength=5.0,
        last_player_to_act=0,
        trick_cards=(card(Rank.FIVE),),
        finished_order=(0, 1),
        collected_tricks=(
            (card(Rank.TEN),),
            (),
            (),
            (card(Rank.FOUR),),
        ),
    )
    before = ser_state(state)

    resolved = play_combo(state, 2, [card(Rank.SIX)])
    after_play = ser_state(resolved)
    observation_for_finisher = ser_observation(resolved, 2)
    observation_for_fourth_place = ser_observation(resolved, 3)

    team_deltas = score_round(resolved)

    return {
        "beforeState": before,
        "afterPlayState": after_play,
        "observationForFinisher": observation_for_finisher,
        "observationForFourthPlace": observation_for_fourth_place,
        "teamScoreDeltas": {"team0": team_deltas[0], "team1": team_deltas[1]},
    }


# --- Scenario 5: grand tichu -----------------------------------------------------


def build_grand_tichu() -> dict:
    """Deal (seed=7) -> seat 0 calls Grand Tichu, everyone else declines. Trick
    play to a full round conclusion is already covered by the other four
    scenarios, so here the finish is constructed directly (seat 0 finishes
    1st) to isolate score_round's LARGE_TICHU_BONUS path."""
    state = deal_new_round(random.Random(7))
    dealt = ser_state(state)

    for player in range(NUM_PLAYERS):
        state = decide_large_tichu(state, player, called=(player == 0))
    after_large_tichu = ser_state(state)

    finished_state = replace(
        state,
        phase=Phase.ROUND_OVER,
        finished_order=(0, 1, 2),
        hands=((), (), (), state.hands[3]),
        collected_tricks=((card(Rank.KING),), (), (), ()),
    )
    finished_state_serialized = ser_state(finished_state)
    observation_for_caller = ser_observation(finished_state, 0)

    team_deltas = score_round(finished_state)

    return {
        "dealtState": dealt,
        "afterLargeTichuState": after_large_tichu,
        "finishedState": finished_state_serialized,
        "observationForCaller": observation_for_caller,
        "teamScoreDeltas": {"team0": team_deltas[0], "team1": team_deltas[1]},
    }


def main() -> None:
    scenarios = [
        ("normal_round", "정상 라운드: 딜 -> 그랜드 티츄 전원 패스 -> 교환 -> 한 트릭 완료", build_normal_round),
        ("bomb_interrupt", "봄 인터럽트: 순서가 아닌 플레이어가 봄으로 트릭에 끼어듦", build_bomb_interrupt),
        ("double_out", "더블 아웃: 파트너 두 명이 1/2등으로 동시에 아웃되며 라운드 종료", build_double_out),
        ("last_card_handover", "마지막 카드 이관: 4등의 잔여 패 점수가 상대팀으로 이관", build_last_card_handover),
        ("grand_tichu", "그랜드 티츄: 성공한 그랜드 티츄 콜의 스코어링", build_grand_tichu),
    ]
    for name, description, builder in scenarios:
        write_fixture(name, description, builder())


if __name__ == "__main__":
    main()
