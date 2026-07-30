import random

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import identify_combo
from tichu_env.encoding import encode_action
from tichu_env.env import TichuEnv
from tichu_env.state import NUM_PLAYERS, GameState, Phase

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.heuristic import HeuristicAgent
from agents.random_agent import RandomAgent


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def special(rank: Rank) -> Card:
    return Card(rank=rank, suit=Suit.SPECIAL)


def _legal_actions(combos: list) -> list:
    return [(combo, encode_action(combo)) for combo in combos]


def make_playing_state(hands: dict[int, list[Card]] | None = None, **overrides) -> GameState:
    hands = hands or {}
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
# Rule 5: forced Dog lead in a 2-active-player endgame
# ---------------------------------------------------------------------------


def test_forced_dog_lead_wins_over_the_mahjong_straight_when_only_two_players_remain():
    dog = identify_combo([special(Rank.DOG)])
    mahjong_single = identify_combo([special(Rank.MAHJONG)])
    straight = identify_combo([special(Rank.MAHJONG), card(Rank.TWO), card(Rank.THREE), card(Rank.FOUR), card(Rank.FIVE)])
    legal_actions = _legal_actions([dog, mahjong_single, straight])
    state = make_playing_state(current_player=0, current_best=None, finished_order=(2, 3))
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == dog


def test_dog_is_not_forced_when_more_than_two_players_remain():
    dog = identify_combo([special(Rank.DOG)])
    mahjong_single = identify_combo([special(Rank.MAHJONG)])
    straight = identify_combo([special(Rank.MAHJONG), card(Rank.TWO), card(Rank.THREE), card(Rank.FOUR), card(Rank.FIVE)])
    legal_actions = _legal_actions([dog, mahjong_single, straight])
    state = make_playing_state(current_player=0, current_best=None, finished_order=(3,))
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == straight


# ---------------------------------------------------------------------------
# Rule 1: leading with the Mahjong
# ---------------------------------------------------------------------------


def test_leading_with_mahjong_prefers_the_longest_straight_over_the_bare_single():
    mahjong_single = identify_combo([special(Rank.MAHJONG)])
    straight = identify_combo([special(Rank.MAHJONG), card(Rank.TWO), card(Rank.THREE), card(Rank.FOUR), card(Rank.FIVE)])
    nine_single = identify_combo([card(Rank.NINE)])
    legal_actions = _legal_actions([mahjong_single, straight, nine_single])
    state = make_playing_state(current_player=0, current_best=None)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == straight


def test_leading_with_mahjong_plays_the_bare_single_when_no_straight_is_legal():
    mahjong_single = identify_combo([special(Rank.MAHJONG)])
    nine_single = identify_combo([card(Rank.NINE)])
    legal_actions = _legal_actions([mahjong_single, nine_single])
    state = make_playing_state(current_player=0, current_best=None)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == mahjong_single


def test_leading_without_mahjong_behaves_like_the_baseline():
    combos = [identify_combo([card(Rank.NINE)]), identify_combo([card(Rank.FIVE)]), identify_combo([card(Rank.KING)])]
    legal_actions = _legal_actions(combos)
    state = make_playing_state(current_player=0, current_best=None)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == identify_combo([card(Rank.FIVE)])


# ---------------------------------------------------------------------------
# Rule 2: partner currently holds the trick -- numeric (2-10) only
# ---------------------------------------------------------------------------


def test_beats_partners_trick_with_the_weakest_numeric_combo_when_one_is_legal():
    three = identify_combo([card(Rank.THREE)])
    five = identify_combo([card(Rank.FIVE)])
    ace = identify_combo([card(Rank.ACE)])
    legal_actions = _legal_actions([five, ace, None])
    state = make_playing_state(current_player=0, last_player_to_act=2, current_best=three, current_strength=three.rank_strength)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == five


def test_passes_on_partners_trick_when_only_a_face_card_could_beat_it():
    three = identify_combo([card(Rank.THREE)])
    ace = identify_combo([card(Rank.ACE)])
    legal_actions = _legal_actions([ace, None])
    state = make_playing_state(current_player=0, last_player_to_act=2, current_best=three, current_strength=three.rank_strength)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen is None


def test_never_bombs_over_partners_trick():
    three = identify_combo([card(Rank.THREE)])
    quad = identify_combo([card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)])
    legal_actions = _legal_actions([quad, None])
    state = make_playing_state(current_player=0, last_player_to_act=2, current_best=three, current_strength=three.rank_strength)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen is None


def test_never_uses_a_phoenix_completed_pair_over_partners_trick_even_though_the_real_card_is_numeric():
    three_pair = identify_combo([card(Rank.THREE), card(Rank.THREE, Suit.PAGODA)])
    phoenix_pair = identify_combo([card(Rank.FIVE), special(Rank.PHOENIX)])
    legal_actions = _legal_actions([phoenix_pair, None])
    state = make_playing_state(
        current_player=0, last_player_to_act=2, current_best=three_pair, current_strength=three_pair.rank_strength
    )
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen is None


def test_still_contests_an_opponents_trick_with_the_weakest_play_including_face_cards():
    three = identify_combo([card(Rank.THREE)])
    five = identify_combo([card(Rank.FIVE)])
    ace = identify_combo([card(Rank.ACE)])
    legal_actions = _legal_actions([five, ace, None])
    state = make_playing_state(current_player=0, last_player_to_act=1, current_best=three, current_strength=three.rank_strength)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == five


# ---------------------------------------------------------------------------
# Rules 3/4: Phoenix single / Dragon only beat the highest still-live single
# ---------------------------------------------------------------------------


def test_withholds_phoenix_from_a_single_below_the_highest_live_rank():
    jack = identify_combo([card(Rank.JACK)])
    phoenix_single = identify_combo([special(Rank.PHOENIX)])
    queen = identify_combo([card(Rank.QUEEN)])
    legal_actions = _legal_actions([phoenix_single, queen, None])
    state = make_playing_state(
        hands={0: [special(Rank.PHOENIX)]},
        current_player=0,
        last_player_to_act=1,
        current_best=jack,
        current_strength=jack.rank_strength,
    )
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == queen


def test_uses_phoenix_to_beat_an_ace_single_when_all_aces_are_still_unaccounted_for():
    ace = identify_combo([card(Rank.ACE)])
    phoenix_single = identify_combo([special(Rank.PHOENIX)])
    legal_actions = _legal_actions([phoenix_single, None])
    state = make_playing_state(
        hands={0: [special(Rank.PHOENIX)]},
        current_player=0,
        last_player_to_act=1,
        current_best=ace,
        current_strength=ace.rank_strength,
    )
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == phoenix_single


def test_uses_phoenix_on_a_king_single_once_all_four_aces_are_accounted_for():
    king = identify_combo([card(Rank.KING)])
    phoenix_single = identify_combo([special(Rank.PHOENIX)])
    legal_actions = _legal_actions([phoenix_single, None])
    all_aces = tuple(card(Rank.ACE, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR))
    collected = tuple(all_aces if i == 1 else () for i in range(NUM_PLAYERS))
    state = make_playing_state(
        hands={0: [special(Rank.PHOENIX)]},
        current_player=0,
        last_player_to_act=1,
        current_best=king,
        current_strength=king.rank_strength,
        collected_tricks=collected,
    )
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == phoenix_single


def test_counts_a_still_live_trick_card_toward_the_accounted_for_total():
    # The trick so far: an Ace was led and then beaten by this King, so both
    # cards still sit in trick_cards (accumulated, not discarded). Combined
    # with the other 3 Aces already sitting in a collected trick, all 4 Aces
    # are accounted for purely via trick_cards + collected_tricks (no Ace in
    # anyone's still-open hand) -- proving trick_cards is actually counted,
    # not just collected_tricks.
    king = identify_combo([card(Rank.KING)])
    phoenix_single = identify_combo([special(Rank.PHOENIX)])
    legal_actions = _legal_actions([phoenix_single, None])
    trick_so_far = (card(Rank.ACE, Suit.SWORD), card(Rank.KING))
    remaining_aces = tuple(card(Rank.ACE, s) for s in (Suit.PAGODA, Suit.JADE, Suit.STAR))
    collected = tuple(remaining_aces if i == 1 else () for i in range(NUM_PLAYERS))
    state = make_playing_state(
        hands={0: [special(Rank.PHOENIX)]},
        current_player=0,
        last_player_to_act=1,
        current_best=king,
        current_strength=king.rank_strength,
        trick_cards=trick_so_far,
        collected_tricks=collected,
    )
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == phoenix_single


def test_withholds_dragon_from_a_single_below_the_highest_live_rank():
    jack = identify_combo([card(Rank.JACK)])
    dragon = identify_combo([special(Rank.DRAGON)])
    queen = identify_combo([card(Rank.QUEEN)])
    legal_actions = _legal_actions([dragon, queen, None])
    state = make_playing_state(
        hands={0: [special(Rank.DRAGON)]},
        current_player=0,
        last_player_to_act=1,
        current_best=jack,
        current_strength=jack.rank_strength,
    )
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == queen


def test_uses_dragon_to_beat_an_ace_single():
    ace = identify_combo([card(Rank.ACE)])
    dragon = identify_combo([special(Rank.DRAGON)])
    legal_actions = _legal_actions([dragon, None])
    state = make_playing_state(
        hands={0: [special(Rank.DRAGON)]},
        current_player=0,
        last_player_to_act=1,
        current_best=ace,
        current_strength=ace.rank_strength,
    )
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == dragon


def test_plays_a_bomb_only_when_it_is_the_only_option():
    ace = identify_combo([card(Rank.ACE)])
    quad = identify_combo([card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)])
    legal_actions = _legal_actions([quad])
    state = make_playing_state(current_player=0, last_player_to_act=1, current_best=ace, current_strength=ace.rank_strength)
    agent = AdvancedHeuristicAgent()

    chosen = agent.choose_action(state, legal_actions)

    assert chosen == quad


# ---------------------------------------------------------------------------
# Environment validation: advanced heuristic should reliably beat random and
# outperform the plain HeuristicAgent baseline.
# ---------------------------------------------------------------------------


def _play_round_advanced(env: TichuEnv, agents: dict) -> tuple[int, int]:
    result = env.reset()
    while not result.done:
        agent = agents[result.player]
        if isinstance(agent, AdvancedHeuristicAgent):
            combo = agent.choose_action(env.state, result.legal_actions)
        else:
            combo = agent.choose_action(result.legal_actions)
        result = env.step(combo)
    return result.info["team_scores"]


def test_advanced_heuristic_team_outperforms_random_team_over_many_rounds():
    rng = random.Random(0)
    env = TichuEnv(rng=rng)
    advanced = AdvancedHeuristicAgent()
    random_agent = RandomAgent(rng=rng)
    agents = {0: advanced, 2: advanced, 1: random_agent, 3: random_agent}

    advanced_total = 0
    random_total = 0
    for _ in range(100):
        team0, team1 = _play_round_advanced(env, agents)
        advanced_total += team0
        random_total += team1

    assert advanced_total > random_total


def test_advanced_heuristic_team_outperforms_plain_heuristic_team_over_many_rounds():
    rng = random.Random(1)
    env = TichuEnv(rng=rng)
    advanced = AdvancedHeuristicAgent()
    plain = HeuristicAgent()
    agents = {0: advanced, 2: advanced, 1: plain, 3: plain}

    advanced_total = 0
    plain_total = 0
    for _ in range(100):
        team0, team1 = _play_round_advanced(env, agents)
        advanced_total += team0
        plain_total += team1

    assert advanced_total > plain_total
