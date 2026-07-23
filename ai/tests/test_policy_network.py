import torch

from tichu_env.encoding import ACTION_DIM, OBS_DIM

from agents.policy_network import TichuPolicyValueNet


def _random_transition_batch(num_transitions: int, action_counts: list[int]):
    obs_batch = torch.rand(num_transitions, OBS_DIM)
    per_transition_action_vectors = [torch.rand(count, ACTION_DIM) for count in action_counts]
    action_vectors = torch.cat(per_transition_action_vectors, dim=0)
    action_counts_tensor = torch.tensor(action_counts, dtype=torch.long)
    return obs_batch, per_transition_action_vectors, action_vectors, action_counts_tensor


def test_forward_produces_one_logit_per_candidate_action_and_a_scalar_value():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    obs = torch.rand(OBS_DIM)
    num_candidates = 7
    action_vectors = torch.rand(num_candidates, ACTION_DIM)

    output = net(obs, action_vectors)

    assert output.action_logits.shape == (num_candidates,)
    assert output.state_value.shape == ()


def test_forward_handles_a_single_candidate_action():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    obs = torch.rand(OBS_DIM)
    action_vectors = torch.rand(1, ACTION_DIM)

    output = net(obs, action_vectors)

    assert output.action_logits.shape == (1,)


def test_forward_rejects_an_empty_action_set():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    obs = torch.rand(OBS_DIM)
    action_vectors = torch.rand(0, ACTION_DIM)

    try:
        net(obs, action_vectors)
        assert False, "expected ValueError for an empty action set"
    except ValueError:
        pass


def test_action_probabilities_sum_to_one():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    obs = torch.rand(OBS_DIM)
    action_vectors = torch.rand(5, ACTION_DIM)

    probs = net.action_probabilities(obs, action_vectors)

    assert torch.isclose(probs.sum(), torch.tensor(1.0), atol=1e-5)
    assert (probs >= 0).all()


def test_gradients_flow_to_every_parameter_on_backward():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    obs = torch.rand(OBS_DIM)
    action_vectors = torch.rand(4, ACTION_DIM)

    output = net(obs, action_vectors)
    loss = output.action_logits.sum() + output.state_value
    loss.backward()

    for name, param in net.named_parameters():
        assert param.grad is not None, f"no gradient reached {name}"
        assert torch.isfinite(param.grad).all(), f"non-finite gradient in {name}"


def test_forward_batch_output_shapes_match_total_and_per_transition_candidate_counts():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    action_counts = [2, 3, 1]
    obs_batch, _, action_vectors, action_counts_tensor = _random_transition_batch(3, action_counts)

    output = net.forward_batch(obs_batch, action_vectors, action_counts_tensor)

    assert output.action_logits.shape == (sum(action_counts),)
    assert output.state_values.shape == (3,)


def test_forward_batch_matches_looping_forward_over_each_transition_individually():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    action_counts = [2, 3, 1, 4]
    obs_batch, per_transition_action_vectors, action_vectors, action_counts_tensor = _random_transition_batch(
        4, action_counts
    )

    batched = net.forward_batch(obs_batch, action_vectors, action_counts_tensor)
    split_logits = torch.split(batched.action_logits, action_counts)

    for i, action_vecs in enumerate(per_transition_action_vectors):
        individual = net(obs_batch[i], action_vecs)
        assert torch.allclose(split_logits[i], individual.action_logits, atol=1e-6)
        assert torch.allclose(batched.state_values[i], individual.state_value, atol=1e-6)


def test_forward_batch_gradients_flow_to_every_parameter_on_backward():
    net = TichuPolicyValueNet(hidden_dim=32, embedding_dim=16)
    obs_batch, _, action_vectors, action_counts_tensor = _random_transition_batch(3, [2, 3, 1])

    output = net.forward_batch(obs_batch, action_vectors, action_counts_tensor)
    loss = output.action_logits.sum() + output.state_values.sum()
    loss.backward()

    for name, param in net.named_parameters():
        assert param.grad is not None, f"no gradient reached {name}"
        assert torch.isfinite(param.grad).all(), f"non-finite gradient in {name}"
