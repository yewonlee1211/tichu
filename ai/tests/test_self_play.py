import random

import numpy as np
import pytest
import torch
from tichu_env.scoring import TEAM_OF

from agents.advanced_heuristic import AdvancedHeuristicAgent
from agents.policy_network import TichuPolicyValueNet
from tichu_env.encoding import encode_tichu_action

from training.self_play import (
    PolicyOpponent,
    Transition,
    _sample_action_index,
    generate_self_play_games,
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


def test_sample_action_index_ignores_epsilon_for_non_binary_call_decisions():
    # A trick-play decision offers Combo/None candidates, never plain bools --
    # epsilon-greedy forcing must never touch these, even at epsilon=1.0.
    combos = [None, "combo-stand-in"]
    probs = np.array([0.95, 0.05])

    chosen = [
        _sample_action_index(combos, probs, random.Random(seed), epsilon_binary_call=1.0) for seed in range(200)
    ]

    index0_rate = sum(1 for index in chosen if index == 0) / len(chosen)
    assert index0_rate > 0.8, (
        f"non-binary-call decisions must stay policy-weighted even at epsilon=1.0, got index0_rate={index0_rate}"
    )


def test_sample_action_index_never_forces_random_when_epsilon_is_zero():
    combos = [True, False]
    probs = np.array([0.0, 1.0])  # policy always prefers declining (index 1)

    for seed in range(20):
        index = _sample_action_index(combos, probs, random.Random(seed), epsilon_binary_call=0.0)
        assert index == 1


def test_sample_action_index_always_forces_uniform_choice_when_epsilon_is_one():
    combos = [True, False]
    probs = np.array([0.0, 1.0])  # policy would otherwise always decline

    chosen = [
        _sample_action_index(combos, probs, random.Random(seed), epsilon_binary_call=1.0) for seed in range(200)
    ]

    call_rate = sum(1 for index in chosen if index == 0) / len(chosen)
    assert 0.35 < call_rate < 0.65, f"epsilon=1.0 should force a roughly uniform choice, got call_rate={call_rate}"


def test_play_self_play_round_threads_epsilon_binary_call_into_the_large_tichu_decision():
    network = _small_network()
    call_count = 0
    total = 0
    for seed in range(100):
        trajectories = play_self_play_round(network, rng=random.Random(seed), epsilon_binary_call=1.0)
        for trajectory in trajectories:
            if not trajectory:
                continue
            # Each player's first-ever decision in a round is the large-Tichu
            # call/decline choice (Phase.LARGE_TICHU precedes everything else).
            first_transition = trajectory[0]
            assert first_transition.action_vectors.shape[0] == 2
            total += 1
            if first_transition.chosen_index == 0:
                call_count += 1

    call_rate = call_count / total
    assert 0.35 < call_rate < 0.65, (
        f"epsilon_binary_call=1.0 should force roughly half of large-Tichu decisions to 'call', "
        f"got call_rate={call_rate} over {total} decisions"
    )


def test_play_self_play_round_threads_epsilon_binary_call_into_the_tichu_call_decision_too():
    # _is_binary_call_decision can't tell the large-Tichu and (small) Tichu
    # decisions apart, so epsilon_binary_call forcing applies to both without
    # any extra wiring -- this pins down that the second (small) Tichu
    # decision that now shows up later in each trajectory also gets forced.
    network = _small_network()
    expected_call_vector = encode_tichu_action(True)
    call_count = 0
    total = 0
    for seed in range(200):
        trajectories = play_self_play_round(network, rng=random.Random(seed), epsilon_binary_call=1.0)
        for trajectory in trajectories:
            for transition in trajectory:
                if transition.action_vectors.shape[0] != 2:
                    continue
                if not np.array_equal(transition.action_vectors[0], expected_call_vector):
                    continue  # this 2-candidate decision is the large-Tichu one, not the tichu-call one
                total += 1
                if transition.chosen_index == 0:
                    call_count += 1

    assert total > 0, "expected at least one (small) Tichu call decision to show up across 200 rounds"
    call_rate = call_count / total
    assert 0.35 < call_rate < 0.65, (
        f"epsilon_binary_call=1.0 should force roughly half of tichu-call decisions to 'call', "
        f"got call_rate={call_rate} over {total} decisions"
    )
