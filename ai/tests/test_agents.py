import random

from tichu_env.cards import Card, Rank, Suit
from tichu_env.combinations import identify_combo
from tichu_env.encoding import encode_action
from tichu_env.env import TichuEnv

from agents.heuristic import HeuristicAgent
from agents.random_agent import RandomAgent


def card(rank: Rank, suit: Suit = Suit.SWORD) -> Card:
    return Card(rank=rank, suit=suit)


def _legal_actions(combos: list) -> list:
    return [(combo, encode_action(combo)) for combo in combos]


# ---------------------------------------------------------------------------
# RandomAgent
# ---------------------------------------------------------------------------


def test_random_agent_only_returns_offered_actions():
    combos = [
        identify_combo([card(Rank.FIVE)]),
        identify_combo([card(Rank.NINE)]),
        None,
    ]
    legal_actions = _legal_actions(combos)
    agent = RandomAgent(rng=random.Random(0))

    for _ in range(20):
        chosen = agent.choose_action(legal_actions)
        assert chosen in combos


def test_random_agent_is_deterministic_given_a_seeded_rng():
    combos = [identify_combo([card(Rank.FIVE)]), identify_combo([card(Rank.NINE)])]
    legal_actions = _legal_actions(combos)

    first = RandomAgent(rng=random.Random(7)).choose_action(legal_actions)
    second = RandomAgent(rng=random.Random(7)).choose_action(legal_actions)

    assert first == second


# ---------------------------------------------------------------------------
# HeuristicAgent
# ---------------------------------------------------------------------------


def test_heuristic_prefers_the_weakest_legal_non_bomb_play():
    combos = [
        identify_combo([card(Rank.NINE)]),
        identify_combo([card(Rank.FIVE)]),
        identify_combo([card(Rank.KING)]),
    ]
    legal_actions = _legal_actions(combos)
    agent = HeuristicAgent()

    chosen = agent.choose_action(legal_actions)

    assert chosen == identify_combo([card(Rank.FIVE)])


def test_heuristic_prefers_passing_over_spending_a_bomb():
    quad = identify_combo([card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)])
    legal_actions = _legal_actions([quad, None])
    agent = HeuristicAgent()

    chosen = agent.choose_action(legal_actions)

    assert chosen is None


def test_heuristic_plays_a_bomb_only_when_it_is_the_only_option():
    quad = identify_combo([card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)])
    legal_actions = _legal_actions([quad])
    agent = HeuristicAgent()

    chosen = agent.choose_action(legal_actions)

    assert chosen == quad


def test_heuristic_prefers_non_bomb_over_bomb_even_when_pass_is_unavailable():
    single = identify_combo([card(Rank.FIVE)])
    quad = identify_combo([card(Rank.SEVEN, s) for s in (Suit.SWORD, Suit.PAGODA, Suit.JADE, Suit.STAR)])
    legal_actions = _legal_actions([single, quad])
    agent = HeuristicAgent()

    chosen = agent.choose_action(legal_actions)

    assert chosen == single


# ---------------------------------------------------------------------------
# Environment validation: heuristic should reliably beat random
# ---------------------------------------------------------------------------


def _play_round(env: TichuEnv, agents: dict) -> tuple[int, int]:
    result = env.reset()
    while not result.done:
        agent = agents[result.player]
        combo = agent.choose_action(result.legal_actions)
        result = env.step(combo)
    return result.info["team_scores"]


def test_heuristic_team_outperforms_random_team_over_many_rounds():
    rng = random.Random(0)
    env = TichuEnv(rng=rng)
    heuristic = HeuristicAgent()
    random_agent = RandomAgent(rng=rng)
    # Seats 0 and 2 are partners (team 0), seats 1 and 3 are partners (team 1).
    agents = {0: heuristic, 2: heuristic, 1: random_agent, 3: random_agent}

    heuristic_total = 0
    random_total = 0
    for _ in range(100):
        team0, team1 = _play_round(env, agents)
        heuristic_total += team0
        random_total += team1

    assert heuristic_total > random_total
