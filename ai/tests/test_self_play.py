import random

from tichu_env.scoring import TEAM_OF

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.policy_network import TichuPolicyValueNet
from training.self_play import Transition, generate_self_play_games, play_self_play_round


def _small_network() -> TichuPolicyValueNet:
    return TichuPolicyValueNet(hidden_dim=16, embedding_dim=8)


def test_generate_self_play_games_returns_four_trajectories_per_game():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=3, rng=random.Random(0))

    assert len(episodes) == 4 * 3


def test_every_transition_has_a_valid_chosen_index_within_its_own_action_set():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=2, rng=random.Random(1))

    for trajectory in episodes:
        for transition in trajectory:
            assert 0 <= transition.chosen_index < transition.action_vectors.shape[0]


def test_only_the_last_transition_of_each_trajectory_carries_a_nonzero_reward():
    network = _small_network()
    episodes = generate_self_play_games(network, num_games=3, rng=random.Random(2))

    for trajectory in episodes:
        assert trajectory, "every seat should get at least one turn in a finished round"
        for transition in trajectory[:-1]:
            assert transition.reward == 0.0


def test_round_rewards_are_zero_sum_and_symmetric_within_a_team():
    network = _small_network()
    trajectories = play_self_play_round(network, rng=random.Random(3))

    final_rewards: dict[int, float] = {
        player: trajectory[-1].reward for player, trajectory in enumerate(trajectories) if trajectory
    }

    # Teammates see the identical round margin; opposing teams see its negation.
    by_team: dict[int, set[float]] = {0: set(), 1: set()}
    for player, reward in final_rewards.items():
        by_team[TEAM_OF[player]].add(reward)

    assert len(by_team[0]) == 1
    assert len(by_team[1]) == 1
    team0_reward = next(iter(by_team[0]))
    team1_reward = next(iter(by_team[1]))
    assert team0_reward == -team1_reward


def test_opponent_seats_record_no_transitions_and_are_not_asked_of_the_network():
    network = _small_network()
    trajectories = play_self_play_round(network, rng=random.Random(5), opponent=AdvancedHeuristicAgent())

    for player in range(4):
        if TEAM_OF[player] == TEAM_OF[0]:
            assert trajectories[player], "team0 (the trainable network) should still record its own turns"
        else:
            assert trajectories[player] == [], "team1 seats should record nothing once an opponent plays them"


def test_generate_self_play_games_threads_the_opponent_through_to_every_round():
    network = _small_network()
    episodes = generate_self_play_games(
        network, num_games=3, rng=random.Random(6), opponent=AdvancedHeuristicAgent()
    )

    team0_trajectories = [t for i, t in enumerate(episodes) if TEAM_OF[i % 4] == TEAM_OF[0] and t]
    team1_trajectories = [t for i, t in enumerate(episodes) if TEAM_OF[i % 4] == TEAM_OF[1] and t]
    assert len(team0_trajectories) == 2 * 3, "one non-empty trajectory per team0 seat per game"
    assert not team1_trajectories, "the opponent's seats must never contribute a trajectory"


def test_opponent_none_keeps_todays_exact_mirror_self_play_behaviour():
    network = _small_network()
    trajectories = play_self_play_round(network, rng=random.Random(7), opponent=None)

    assert all(trajectories), "with no opponent, every seat still plays via the network and records a trajectory"


def test_transition_is_immutable():
    network = _small_network()
    trajectories = play_self_play_round(network, rng=random.Random(4))
    transition = trajectories[0][0]

    try:
        transition.reward = 5.0  # type: ignore[misc]
        assert False, "Transition should be frozen"
    except AttributeError:
        pass

    assert isinstance(transition, Transition)
