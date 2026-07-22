from __future__ import annotations

from dataclasses import dataclass

import torch
from torch import Tensor, nn

from tichu_env.encoding import ACTION_DIM, OBS_DIM


def _mlp(in_dim: int, hidden_dim: int, out_dim: int, num_hidden_layers: int) -> nn.Sequential:
    layers: list[nn.Module] = [nn.Linear(in_dim, hidden_dim), nn.ReLU()]
    for _ in range(num_hidden_layers - 1):
        layers += [nn.Linear(hidden_dim, hidden_dim), nn.ReLU()]
    layers.append(nn.Linear(hidden_dim, out_dim))
    return nn.Sequential(*layers)


@dataclass(frozen=True)
class PolicyValueOutput:
    action_logits: Tensor  # (num_candidates,) unnormalized -- softmax externally
    state_value: Tensor  # scalar, estimated value of the observation for the current player


class TichuPolicyValueNet(nn.Module):
    """Policy/value network over Tichu's variable-size legal action set.

    Every turn offers a different number of legal combos (`encoding.encode_legal_actions`
    returns a list, not a fixed-width vector), so there is no fixed action space to put a
    single softmax head over. Instead this follows the plan's action-embedding approach:
    the fixed-size observation (`encoding.OBS_DIM`) is encoded once into a state
    embedding, each candidate action (`encoding.ACTION_DIM`) is independently encoded into
    an action embedding, and each (state, action) embedding pair is scored to produce one
    logit per candidate. The state embedding is reused for the value head.
    """

    def __init__(
        self,
        obs_dim: int = OBS_DIM,
        action_dim: int = ACTION_DIM,
        hidden_dim: int = 256,
        embedding_dim: int = 128,
    ) -> None:
        super().__init__()
        self.state_encoder = _mlp(obs_dim, hidden_dim, embedding_dim, num_hidden_layers=2)
        self.action_encoder = _mlp(action_dim, hidden_dim, embedding_dim, num_hidden_layers=1)
        self.action_scorer = _mlp(embedding_dim * 2, hidden_dim, 1, num_hidden_layers=1)
        self.value_head = _mlp(embedding_dim, hidden_dim, 1, num_hidden_layers=1)

    def encode_state(self, obs: Tensor) -> Tensor:
        """obs: (..., obs_dim) -> (..., embedding_dim)"""
        return self.state_encoder(obs)

    def forward(self, obs: Tensor, action_vectors: Tensor) -> PolicyValueOutput:
        """obs: (obs_dim,) single observation.
        action_vectors: (num_candidates, action_dim) encoded legal actions for that
        observation (as produced by `encoding.encode_legal_actions`).
        """
        if action_vectors.shape[0] == 0:
            raise ValueError("action_vectors must contain at least one candidate action")

        state_embedding = self.encode_state(obs)  # (embedding_dim,)
        action_embeddings = self.action_encoder(action_vectors)  # (N, embedding_dim)
        expanded_state = state_embedding.unsqueeze(0).expand(action_embeddings.shape[0], -1)
        combined = torch.cat([expanded_state, action_embeddings], dim=-1)
        action_logits = self.action_scorer(combined).squeeze(-1)  # (N,)
        state_value = self.value_head(state_embedding).squeeze(-1)  # scalar
        return PolicyValueOutput(action_logits=action_logits, state_value=state_value)

    def action_probabilities(self, obs: Tensor, action_vectors: Tensor) -> Tensor:
        """Softmax over the candidate action logits for `obs`. Convenience wrapper
        around `forward` for callers that only need the distribution (e.g. sampling
        an action during self-play)."""
        return torch.softmax(self.forward(obs, action_vectors).action_logits, dim=-1)
