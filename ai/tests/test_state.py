import random

import pytest

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import ComboType, identify_combo
from tichu_env.state import (
    NUM_PLAYERS,
    GameState,
    Phase,
    call_tichu,
    deal_new_round,
    decide_large_tichu,
    exchange_cards,
    legal_combos,
    pass_turn,
    play_combo,
)


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def special(rank: Rank) -> Card:
    return Card(rank=rank, suit=Suit.SPECIAL)


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
        large_tichu_calls=(True, True, True, True),
        tichu_calls=(False, False, False, False),
        mahjong_wish=None,
    )
    base.update(overrides)
    return GameState(**base)


# ---------------------------------------------------------------------------
# Dealing / large tichu / exchange
# ---------------------------------------------------------------------------


def test_deal_new_round_gives_8_cards_and_holds_6_in_reserve():
    state = deal_new_round(random.Random(1))

    assert all(len(hand) == 8 for hand in state.hands)
    assert all(len(reserve) == 6 for reserve in state.pending_final_cards)
    all_cards = [c for hand in state.hands for c in hand] + [c for reserve in state.pending_final_cards for c in reserve]
    assert len(all_cards) == 56
    assert len(set(all_cards)) == 56


def test_large_tichu_decisions_deal_final_6_once_everyone_has_decided():
    state = deal_new_round(random.Random(2))

    for player in range(3):
        state = decide_large_tichu(state, player, called=False)
        assert state.phase is Phase.LARGE_TICHU

    state = decide_large_tichu(state, 3, called=True)

    assert state.phase is Phase.EXCHANGE
    assert all(len(hand) == 14 for hand in state.hands)
    assert state.large_tichu_calls == (False, False, False, True)


def test_cannot_decide_large_tichu_twice():
    state = deal_new_round(random.Random(3))
    state = decide_large_tichu(state, 0, called=False)

    with pytest.raises(ValueError):
        decide_large_tichu(state, 0, called=True)


def test_call_tichu_requires_full_14_card_hand():
    state = deal_new_round(random.Random(4))
    for player in range(NUM_PLAYERS):
        state = decide_large_tichu(state, player, called=False)

    state = call_tichu(state, 0)
    assert state.tichu_calls[0] is True


def test_call_tichu_rejected_before_final_deal():
    state = deal_new_round(random.Random(5))

    with pytest.raises(ValueError):
        call_tichu(state, 0)


def test_exchange_cards_moves_exactly_one_card_to_each_opponent():
    state = deal_new_round(random.Random(6))
    for player in range(NUM_PLAYERS):
        state = decide_large_tichu(state, player, called=False)

    # Each player gives their first three cards (in hand order) to the other
    # three players, one each.
    gifts = {}
    for giver in range(NUM_PLAYERS):
        others = [p for p in range(NUM_PLAYERS) if p != giver]
        gifts[giver] = {recipient: state.hands[giver][i] for i, recipient in enumerate(others)}

    new_state = exchange_cards(state, gifts)

    assert new_state.phase is Phase.PLAYING
    assert all(len(hand) == 14 for hand in new_state.hands)
    mahjong_holder = next(p for p in range(NUM_PLAYERS) if any(c.rank is Rank.MAHJONG for c in new_state.hands[p]))
    assert new_state.current_player == mahjong_holder
    assert new_state.trick_leader == mahjong_holder


def test_exchange_rejects_giving_the_same_card_twice():
    state = deal_new_round(random.Random(7))
    for player in range(NUM_PLAYERS):
        state = decide_large_tichu(state, player, called=False)

    gifts = {}
    for giver in range(NUM_PLAYERS):
        others = [p for p in range(NUM_PLAYERS) if p != giver]
        same_card = state.hands[giver][0]
        gifts[giver] = {recipient: same_card for recipient in others}

    with pytest.raises(ValueError):
        exchange_cards(state, gifts)


# ---------------------------------------------------------------------------
# Turn order / bomb interrupts
# ---------------------------------------------------------------------------


def test_play_combo_rejects_playing_out_of_turn_for_non_bomb():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [card(Rank.SIX)]},
        current_player=0,
    )

    with pytest.raises(ValueError):
        play_combo(state, 1, [card(Rank.SIX)])


def test_bomb_can_interrupt_out_of_turn():
    quad = [card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)]
    state = make_playing_state(
        # Player 2 keeps an extra card so playing the quad doesn't finish
        # them -- players 0 and 2 are partners, and if both finished off this
        # single trick it would trigger a double win and end the round,
        # which isn't what this test is about.
        {0: [card(Rank.FIVE)], 1: [], 2: quad + [card(Rank.THREE)], 3: []},
        current_player=0,
        trick_leader=0,
        current_best=None,
    )
    # player 0 opens with a single five
    state = play_combo(state, 0, [card(Rank.FIVE)])
    assert state.current_player == 1

    # player 2 interrupts out of turn with a bomb
    state = play_combo(state, 2, quad)

    assert state.current_best.combo_type is ComboType.BOMB_QUAD
    assert state.last_player_to_act == 2
    assert state.current_player == 3
    assert state.passes_in_a_row == 0


def test_bomb_cannot_seize_the_lead_out_of_turn():
    quad = [card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)]
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 2: quad},
        current_player=0,
        trick_leader=0,
        current_best=None,
    )

    with pytest.raises(ValueError):
        play_combo(state, 2, quad)


def test_legal_combos_excludes_non_turn_players_ordinary_plays():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [card(Rank.NINE)], 2: [card(Rank.KING)]},
        current_player=0,
        trick_leader=0,
        current_best=None,
    )
    state = play_combo(state, 0, [card(Rank.FIVE)])

    # It's now player 1's turn; player 2 holds a beating card but isn't on
    # turn and has no bomb, so they should have no legal ordinary plays.
    assert legal_combos(state, 2) == []


def test_legal_combos_is_empty_for_non_leader_when_opening():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [card(Rank.NINE)]},
        current_player=0,
        trick_leader=0,
        current_best=None,
    )

    assert legal_combos(state, 1) == []


def test_dog_can_only_be_played_to_open_a_trick():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [special(Rank.DOG)]},
        current_player=0,
        trick_leader=0,
    )
    state = play_combo(state, 0, [card(Rank.FIVE)])

    with pytest.raises(ValueError):
        play_combo(state, 1, [special(Rank.DOG)])


def test_dog_passes_lead_to_partner():
    state = make_playing_state(
        {0: [special(Rank.DOG)], 2: [card(Rank.THREE)]},
        current_player=0,
        trick_leader=0,
    )

    state = play_combo(state, 0, [special(Rank.DOG)])

    assert state.trick_leader == 2
    assert state.current_player == 2
    assert state.current_best is None
    assert state.trick_cards == ()


def test_dog_falls_back_to_counter_clockwise_when_partner_already_finished():
    state = make_playing_state(
        {0: [special(Rank.DOG)], 1: [card(Rank.THREE)], 3: [card(Rank.FOUR)]},
        current_player=0,
        trick_leader=0,
        finished_order=(2,),
    )

    state = play_combo(state, 0, [special(Rank.DOG)])

    assert state.trick_leader == 3


# ---------------------------------------------------------------------------
# Finishing / round-over detection
# ---------------------------------------------------------------------------


def test_playing_last_card_marks_player_finished():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [card(Rank.SIX)]},
        current_player=0,
        trick_leader=0,
    )

    state = play_combo(state, 0, [card(Rank.FIVE)])

    assert state.finished_order == (0,)
    assert state.phase is Phase.PLAYING


def test_round_ends_when_third_player_finishes():
    state = make_playing_state(
        {3: [card(Rank.NINE)]},
        current_player=3,
        trick_leader=3,
        finished_order=(0, 1),
    )

    state = play_combo(state, 3, [card(Rank.NINE)])

    assert state.finished_order == (0, 1, 3)
    assert state.phase is Phase.ROUND_OVER


def test_round_ends_immediately_on_a_double_win_before_a_third_player_finishes():
    # Seats 1 and 3 are partners. If 1 already finished and 3 finishes next,
    # that is a double win (both members of one team out before anyone on
    # the other team) -- the round must end right there, not wait for a
    # third finisher. Continuing to play in this state is also unsafe: it
    # can leave a later Dragon-trick winner with no opposing player left to
    # gift the trick to, since both opponents already finished.
    state = make_playing_state(
        {3: [card(Rank.NINE)]},
        current_player=3,
        trick_leader=3,
        finished_order=(1,),
    )

    state = play_combo(state, 3, [card(Rank.NINE)])

    assert state.finished_order == (1, 3)
    assert state.phase is Phase.ROUND_OVER


def test_third_player_finishing_mid_trick_collects_the_pending_trick():
    # Player 3 beats player 0's earlier lead and empties their hand doing so,
    # becoming the 3rd finisher. Nobody will ever get a chance to pass on
    # this trick (the round is over), so its cards must be collected into
    # player 3's pile right here instead of being stranded in trick_cards.
    state = make_playing_state(
        {3: [card(Rank.NINE)]},
        current_player=3,
        trick_leader=0,
        current_best=identify_combo([card(Rank.FIVE)]),
        current_strength=5.0,
        last_player_to_act=0,
        trick_cards=(card(Rank.FIVE),),
        finished_order=(1, 2),
    )

    state = play_combo(state, 3, [card(Rank.NINE)])

    assert state.finished_order == (1, 2, 3)
    assert state.phase is Phase.ROUND_OVER
    assert state.trick_cards == ()
    assert state.current_best is None
    assert set(state.collected_tricks[3]) == {card(Rank.FIVE), card(Rank.NINE)}
    assert state.collected_tricks[0] == ()


def test_double_win_still_collects_the_pending_trick_into_the_winners_pile():
    # Same shape as above, but the finishing play completes a double win
    # (seats 1 and 3 are partners) instead of a third finisher. Even though
    # score_round() ignores collected_tricks for a double win, the invariant
    # that every played card ends up *somewhere* should still hold (useful
    # for logging/debugging, e.g. the self-play narration log).
    state = make_playing_state(
        {3: [card(Rank.NINE)]},
        current_player=3,
        trick_leader=0,
        current_best=identify_combo([card(Rank.FIVE)]),
        current_strength=5.0,
        last_player_to_act=0,
        trick_cards=(card(Rank.FIVE),),
        finished_order=(1,),
    )

    state = play_combo(state, 3, [card(Rank.NINE)])

    assert state.finished_order == (1, 3)
    assert state.phase is Phase.ROUND_OVER
    assert set(state.collected_tricks[3]) == {card(Rank.FIVE), card(Rank.NINE)}


def test_round_ending_play_with_the_dragon_requires_a_recipient():
    state = make_playing_state(
        {3: [special(Rank.DRAGON)]},
        current_player=3,
        trick_leader=0,
        current_best=identify_combo([card(Rank.FIVE)]),
        current_strength=5.0,
        last_player_to_act=0,
        trick_cards=(card(Rank.FIVE),),
        finished_order=(0, 1),
    )

    with pytest.raises(ValueError):
        play_combo(state, 3, [special(Rank.DRAGON)])

    # Seat 2 is the only valid recipient: seat 0 already finished, and seat 1
    # is the winner's (seat 3's) own partner.
    resolved = play_combo(state, 3, [special(Rank.DRAGON)], dragon_recipient=2)

    assert resolved.phase is Phase.ROUND_OVER
    assert set(resolved.collected_tricks[2]) == {card(Rank.FIVE), special(Rank.DRAGON)}
    assert resolved.collected_tricks[3] == ()


# ---------------------------------------------------------------------------
# Mahjong wish
# ---------------------------------------------------------------------------


def test_mahjong_lead_can_set_a_wish():
    state = make_playing_state(
        {0: [special(Rank.MAHJONG)], 1: [card(Rank.NINE)]},
        current_player=0,
        trick_leader=0,
    )

    state = play_combo(state, 0, [special(Rank.MAHJONG)], wish=Rank.NINE)

    assert state.mahjong_wish is Rank.NINE


def test_wish_forces_breaking_a_triple_into_a_single():
    triple_nine = [card(Rank.NINE, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE)]
    state = make_playing_state(
        {0: [], 1: triple_nine + [card(Rank.THREE)]},
        current_player=1,
        trick_leader=1,
        mahjong_wish=Rank.NINE,
    )

    with pytest.raises(ValueError):
        play_combo(state, 1, [card(Rank.THREE)])

    resolved = play_combo(state, 1, [triple_nine[0]])
    assert resolved.mahjong_wish is None


def test_wish_does_not_force_a_play_when_rank_is_unreachable():
    state = make_playing_state(
        {0: [card(Rank.THREE)]},
        current_player=0,
        trick_leader=0,
        mahjong_wish=Rank.NINE,
    )

    resolved = play_combo(state, 0, [card(Rank.THREE)])
    assert resolved.mahjong_wish is Rank.NINE


def test_wish_blocks_the_dog_when_fulfillable():
    state = make_playing_state(
        {0: [special(Rank.DOG), card(Rank.NINE)]},
        current_player=0,
        trick_leader=0,
        mahjong_wish=Rank.NINE,
    )

    with pytest.raises(ValueError):
        play_combo(state, 0, [special(Rank.DOG)])


def test_wish_blocks_a_bomb_when_fulfillable():
    quad = [card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)]
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [card(Rank.NINE)] + quad},
        current_player=1,
        trick_leader=0,
        mahjong_wish=Rank.NINE,
    )
    state = play_combo(state, 0, [card(Rank.FIVE)])

    with pytest.raises(ValueError):
        play_combo(state, 1, quad)

    resolved = play_combo(state, 1, [card(Rank.NINE)])
    assert resolved.mahjong_wish is None


def test_cannot_pass_when_wish_is_fulfillable():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [card(Rank.NINE)]},
        current_player=0,
        trick_leader=0,
        mahjong_wish=Rank.NINE,
    )
    state = play_combo(state, 0, [card(Rank.FIVE)])

    with pytest.raises(ValueError):
        pass_turn(state, 1)

    resolved = play_combo(state, 1, [card(Rank.NINE)])
    assert resolved.mahjong_wish is None


# ---------------------------------------------------------------------------
# Legal move enumeration
# ---------------------------------------------------------------------------


def test_legal_combos_when_leading_includes_every_valid_combo():
    hand = [card(Rank.FIVE), card(Rank.FIVE, Suit.JADE)]
    state = make_playing_state({0: hand}, current_player=0, trick_leader=0)

    combos = legal_combos(state, 0)
    combo_types = {c.combo_type for c in combos}

    assert ComboType.SINGLE in combo_types
    assert ComboType.PAIR in combo_types


def test_legal_combos_when_following_excludes_weaker_combos():
    hand = [card(Rank.FOUR), card(Rank.NINE)]
    current_best_state = make_playing_state(
        {0: [card(Rank.SEVEN)], 1: hand},
        current_player=0,
        trick_leader=0,
    )
    state = play_combo(current_best_state, 0, [card(Rank.SEVEN)])

    combos = legal_combos(state, 1)

    assert all(c.rank_strength > Rank.SEVEN.value for c in combos)


# ---------------------------------------------------------------------------
# Trick resolution / passing
# ---------------------------------------------------------------------------


def test_trick_resolves_to_winner_after_all_others_pass():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [], 2: [], 3: []},
        current_player=0,
        trick_leader=0,
    )
    state = play_combo(state, 0, [card(Rank.FIVE)])
    state = pass_turn(state, 1)
    state = pass_turn(state, 2)
    state = pass_turn(state, 3)

    assert state.collected_tricks[0] == (card(Rank.FIVE),)
    # Player 0 won the trick with their last card and is already out, so the
    # lead falls to their partner (seat 2) instead.
    assert state.trick_leader == 2
    assert state.current_best is None


def test_dragon_win_requires_choosing_an_opponent():
    state = make_playing_state(
        {0: [special(Rank.DRAGON)], 1: [], 2: [], 3: []},
        current_player=0,
        trick_leader=0,
    )
    state = play_combo(state, 0, [special(Rank.DRAGON)])
    state = pass_turn(state, 1)
    state = pass_turn(state, 2)

    with pytest.raises(ValueError):
        pass_turn(state, 3)

    resolved = pass_turn(state, 3, dragon_recipient=1)
    assert resolved.collected_tricks[1] == (special(Rank.DRAGON),)
    assert resolved.collected_tricks[0] == ()


def test_dragon_trick_cannot_go_to_winners_own_team():
    state = make_playing_state(
        {0: [special(Rank.DRAGON)], 1: [], 2: [], 3: []},
        current_player=0,
        trick_leader=0,
    )
    state = play_combo(state, 0, [special(Rank.DRAGON)])
    state = pass_turn(state, 1)
    state = pass_turn(state, 2)

    with pytest.raises(ValueError):
        pass_turn(state, 3, dragon_recipient=2)  # seat 2 is partner of seat 0


def test_dragon_trick_cannot_go_to_a_player_who_already_finished():
    state = make_playing_state(
        {0: [special(Rank.DRAGON), card(Rank.THREE)], 2: [card(Rank.FOUR)], 3: [card(Rank.SIX)]},
        current_player=0,
        trick_leader=0,
        finished_order=(1,),
    )
    state = play_combo(state, 0, [special(Rank.DRAGON)])
    state = pass_turn(state, 2)

    with pytest.raises(ValueError):
        pass_turn(state, 3, dragon_recipient=1)  # seat 1 already finished


def test_dragon_recipient_must_be_none_on_a_non_dragon_win():
    state = make_playing_state(
        {0: [card(Rank.FIVE)], 1: [], 2: [], 3: []},
        current_player=0,
        trick_leader=0,
    )
    state = play_combo(state, 0, [card(Rank.FIVE)])
    state = pass_turn(state, 1)
    state = pass_turn(state, 2)

    with pytest.raises(ValueError):
        pass_turn(state, 3, dragon_recipient=1)
