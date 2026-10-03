import random

import numpy as np
import pytest
import torch
from tichu_env.scoring import TEAM_OF

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.policy_network import TichuPolicyValueNet

from training.self_play import (
    PolicyOpponent,
    Transition,
    _split_game_counts,
    generate_self_play_games,
    generate_self_play_games_parallel,
    play_self_play_round,
)


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


def test_policy_opponent_plays_a_frozen_network_as_a_valid_self_play_opponent():
    network = _small_network()
    frozen = _small_network()
    trajectories = play_self_play_round(
        network, rng=random.Random(30), opponent=PolicyOpponent(frozen, random.Random(31))
    )

    for player in range(4):
        if TEAM_OF[player] == TEAM_OF[0]:
            assert trajectories[player], "team0 (the trainable network) should still record its own turns"
        else:
            assert trajectories[player] == [], "team1 seats played by PolicyOpponent record nothing"


def test_generate_self_play_games_calls_the_opponent_factory_once_per_game():
    network = _small_network()
    calls = []

    def factory():
        calls.append(1)
        return AdvancedHeuristicAgent()

    generate_self_play_games(network, num_games=4, rng=random.Random(32), opponent_factory=factory)

    assert len(calls) == 4


def test_opponent_factory_takes_precedence_over_the_static_opponent():
    network = _small_network()

    episodes = generate_self_play_games(
        network,
        num_games=2,
        rng=random.Random(33),
        opponent=AdvancedHeuristicAgent(),
        opponent_factory=lambda: None,
    )

    assert all(episodes), "opponent_factory returning None should mirror self-play, overriding `opponent`"


def test_transition_records_the_old_log_prob_of_the_chosen_action():
    network = _small_network()
    trajectories = play_self_play_round(network, rng=random.Random(40))
    team0_trajectory = next(t for t in trajectories if t)
    transition = team0_trajectory[0]

    with torch.no_grad():
        probs = network.action_probabilities(
            torch.as_tensor(transition.observation, dtype=torch.float32),
            torch.as_tensor(transition.action_vectors, dtype=torch.float32),
        ).numpy()
    expected_log_prob = float(np.log(probs[transition.chosen_index]))

    assert transition.old_log_prob == pytest.approx(expected_log_prob, abs=1e-5)


def test_transition_is_immutable():
    network = _small_network()
    trajectories = play_self_play_round(network, rng=random.Random(4))
    transition = trajectories[0][0]

    try:
        transition.reward = 5.0  # type: ignore[misc]
        assert False, "Transition should be frozen"
    except AttributeError:
        pass


def test_split_game_counts_evenly_divides_when_there_is_no_remainder():
    assert _split_game_counts(9, 3) == [3, 3, 3]


def test_split_game_counts_gives_the_remainder_to_the_first_workers():
    counts = _split_game_counts(10, 3)

    assert counts == [4, 3, 3]
    assert sum(counts) == 10


def test_generate_self_play_games_parallel_with_one_worker_matches_sequential_call():
    # num_workers=1 must short-circuit to generate_self_play_games directly (same rng
    # draw sequence), not spawn a redundant single subprocess.
    network = _small_network()
    sequential = generate_self_play_games(network, num_games=3, rng=random.Random(70))
    parallel = generate_self_play_games_parallel(network, num_games=3, num_workers=1, rng=random.Random(70))

    assert len(parallel) == len(sequential)
    for seq_trajectory, par_trajectory in zip(sequential, parallel):
        assert len(seq_trajectory) == len(par_trajectory)
        for seq_transition, par_transition in zip(seq_trajectory, par_trajectory):
            assert seq_transition.chosen_index == par_transition.chosen_index
            assert seq_transition.reward == par_transition.reward
            assert np.array_equal(seq_transition.observation, par_transition.observation)


def test_generate_self_play_games_parallel_returns_four_trajectories_per_game():
    network = _small_network()
    episodes = generate_self_play_games_parallel(network, num_games=6, num_workers=3, rng=random.Random(71))

    assert len(episodes) == 4 * 6


def test_generate_self_play_games_parallel_produces_valid_transitions():
    network = _small_network()
    episodes = generate_self_play_games_parallel(network, num_games=4, num_workers=2, rng=random.Random(72))

    for trajectory in episodes:
        for transition in trajectory:
            assert 0 <= transition.chosen_index < transition.action_vectors.shape[0]


def test_generate_self_play_games_parallel_caps_worker_count_at_num_games():
    network = _small_network()
    episodes = generate_self_play_games_parallel(network, num_games=2, num_workers=10, rng=random.Random(73))

    assert len(episodes) == 4 * 2


def test_generate_self_play_games_parallel_is_deterministic_for_a_fixed_seed_and_worker_count():
    network = _small_network()
    first = generate_self_play_games_parallel(network, num_games=5, num_workers=3, rng=random.Random(99))
    second = generate_self_play_games_parallel(network, num_games=5, num_workers=3, rng=random.Random(99))

    first_rewards = sorted(t.reward for trajectory in first for t in trajectory)
    second_rewards = sorted(t.reward for trajectory in second for t in trajectory)
    assert first_rewards == second_rewards


def test_generate_self_play_games_parallel_propagates_worker_exceptions():
    network = _small_network()

    def boom():
        raise RuntimeError("self-play worker exploded")

    with pytest.raises(RuntimeError, match="self-play worker exploded"):
        generate_self_play_games_parallel(
            network, num_games=4, num_workers=2, rng=random.Random(50), opponent_factory=boom
        )


