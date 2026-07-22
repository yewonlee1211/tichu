import torch

from tichu_env.encoding import ACTION_DIM, OBS_DIM

from agents.policy_network import TichuPolicyValueNet


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
