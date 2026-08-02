from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import torch

from agents.policy_network import TichuPolicyValueNet
from export.export_onnx import INPUT_NAMES, OUTPUT_NAMES, export_to_file, load_network
from export.obfuscate import xor_transform
from tichu_env.encoding import ACTION_DIM, OBS_DIM


def _save_checkpoint(net: TichuPolicyValueNet, path: Path) -> None:
    torch.save(net.state_dict(), path)


def _export(tmp_path: Path, net: TichuPolicyValueNet) -> Path:
    checkpoint_path = tmp_path / "checkpoint.pt"
    _save_checkpoint(net, checkpoint_path)
    out_path = tmp_path / "policy.onnx.enc"
    export_to_file(checkpoint_path, out_path)
    return out_path


def test_export_to_file_writes_an_obfuscated_onnx_model_with_the_declared_io_names(tmp_path: Path):
    net = TichuPolicyValueNet()

    out_path = _export(tmp_path, net)

    onnx_bytes = xor_transform(out_path.read_bytes())
    model = onnx.load_from_string(onnx_bytes)
    onnx.checker.check_model(model)
    assert [i.name for i in model.graph.input] == INPUT_NAMES
    assert [o.name for o in model.graph.output] == OUTPUT_NAMES


def test_load_network_raises_for_a_missing_checkpoint_path(tmp_path: Path):
    try:
        load_network(tmp_path / "missing.pt")
        assert False, "expected ValueError for a missing checkpoint path"
    except ValueError:
        pass


def test_xor_transform_round_trips_arbitrary_bytes():
    data = bytes(range(256)) * 4
    assert xor_transform(xor_transform(data)) == data


def test_onnx_export_does_not_replicate_pytorchs_empty_action_set_guard(tmp_path: Path):
    """`TichuPolicyValueNet.forward` raises `ValueError` for an empty `action_vectors`
    (see `agents/policy_network.py`), but that guard is a Python-level `if` on a
    concrete traced shape, so it is not recorded into the exported graph -- pins down
    that documented divergence so it isn't silently lost to a future export change."""
    net = TichuPolicyValueNet()
    net.eval()

    out_path = _export(tmp_path, net)
    session = ort.InferenceSession(xor_transform(out_path.read_bytes()))

    obs = torch.rand(OBS_DIM)
    action_vectors = torch.rand(0, ACTION_DIM)

    logits, value = session.run(None, {"obs": obs.numpy(), "action_vectors": action_vectors.numpy()})

    assert logits.shape == (0,)
    assert value.shape == ()


def test_onnx_output_matches_pytorch_output_across_varying_candidate_counts(tmp_path: Path):
    """The exported model's `action_vectors` input and `action_logits` output share a
    dynamic first axis (`num_candidates`), since Tichu offers a different number of
    legal combos every turn -- this checks that axis actually behaves dynamically
    rather than being baked in at whatever count was used during tracing."""
    net = TichuPolicyValueNet()
    net.eval()

    out_path = _export(tmp_path, net)
    session = ort.InferenceSession(xor_transform(out_path.read_bytes()))

    for num_candidates in (1, 3, 7, 14):
        obs = torch.rand(OBS_DIM)
        action_vectors = torch.rand(num_candidates, ACTION_DIM)
        with torch.no_grad():
            expected = net(obs, action_vectors)
        logits, value = session.run(None, {"obs": obs.numpy(), "action_vectors": action_vectors.numpy()})

        assert logits.shape == (num_candidates,)
        assert np.allclose(expected.action_logits.numpy(), logits, atol=1e-5)
        assert np.allclose(expected.state_value.numpy(), value, atol=1e-5)
