import random

import torch

from agents.policy_network import TichuPolicyValueNet
from training.opponent_pool import OpponentPool


def _small_network() -> TichuPolicyValueNet:
    return TichuPolicyValueNet(hidden_dim=16, embedding_dim=8)


def test_pool_starts_empty():
    pool = OpponentPool()

    assert len(pool) == 0


def test_sampling_an_empty_pool_raises():
    pool = OpponentPool()

    try:
        pool.sample(random.Random(0))
        assert False, "sampling an empty pool should raise"
    except ValueError:
        pass


def test_add_then_sample_returns_a_network_with_the_same_weights():
    pool = OpponentPool()
    network = _small_network()

    pool.add(network)
    sampled = pool.sample(random.Random(0))

    for original, snapshot in zip(network.parameters(), sampled.parameters()):
        assert torch.equal(original, snapshot)


def test_the_stored_snapshot_is_independent_of_further_training_on_the_source_network():
    pool = OpponentPool()
    network = _small_network()
    pool.add(network)
    before = [p.detach().clone() for p in network.parameters()]

    with torch.no_grad():
        for p in network.parameters():
            p.add_(1.0)  # simulate a gradient step mutating the live network in place

    sampled = pool.sample(random.Random(0))
    for snapshot_param, original in zip(sampled.parameters(), before):
        assert torch.equal(snapshot_param, original)


def test_pool_evicts_the_oldest_snapshot_once_max_size_is_exceeded():
    pool = OpponentPool(max_size=2)
    net_a, net_b, net_c = _small_network(), _small_network(), _small_network()
    with torch.no_grad():
        for p in net_a.parameters():
            p.fill_(1.0)
        for p in net_b.parameters():
            p.fill_(2.0)
        for p in net_c.parameters():
            p.fill_(3.0)

    pool.add(net_a)
    pool.add(net_b)
    pool.add(net_c)

    assert len(pool) == 2
    observed = {
        round(float(next(pool.sample(random.Random(seed)).parameters()).detach().flatten()[0]), 4)
        for seed in range(20)
    }
    assert observed == {2.0, 3.0}, "the oldest snapshot (net_a, fill value 1.0) should have been evicted"
