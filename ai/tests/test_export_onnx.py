import json
import sys
from pathlib import Path

import numpy as np
import onnx
import onnxruntime as ort
import pytest
import torch

from agents.policy_network import TichuPolicyValueNet
from export.export_onnx import (
    INPUT_NAMES,
    OUTPUT_NAMES,
    _main,
    export_to_file,
    infer_iteration,
    load_env_file,
    load_network,
    write_manifest,
)
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


def test_infer_iteration_parses_the_number_out_of_a_conventional_checkpoint_filename(tmp_path: Path):
    assert infer_iteration(tmp_path / "checkpoint_42.pt") == 42


def test_infer_iteration_raises_for_a_filename_that_does_not_follow_the_convention(tmp_path: Path):
    try:
        infer_iteration(tmp_path / "best_model.pt")
        assert False, "expected ValueError for a non-conventional checkpoint filename"
    except ValueError:
        pass


def test_write_manifest_writes_the_iteration_as_json(tmp_path: Path):
    manifest_path = tmp_path / "nested" / "manifest.json"

    write_manifest(manifest_path, 7)

    assert json.loads(manifest_path.read_text()) == {"iteration": 7}


def test_load_env_file_parses_key_value_pairs_and_skips_blanks_and_comments(tmp_path: Path):
    env_path = tmp_path / ".env"
    env_path.write_text("\n".join(["# comment", "", "CHECKPOINT=checkpoints/run1/checkpoint_300.pt", "OUT=deploy/client-models/policy.onnx.enc"]))

    assert load_env_file(env_path) == {
        "CHECKPOINT": "checkpoints/run1/checkpoint_300.pt",
        "OUT": "deploy/client-models/policy.onnx.enc",
    }


def test_load_env_file_returns_empty_dict_when_the_file_does_not_exist(tmp_path: Path):
    assert load_env_file(tmp_path / "missing.env") == {}


def test_main_exports_using_explicit_cli_checkpoint_and_out(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    net = TichuPolicyValueNet()
    checkpoint_path = tmp_path / "checkpoint_5.pt"
    _save_checkpoint(net, checkpoint_path)
    out_path = tmp_path / "policy.onnx.enc"

    monkeypatch.setattr(sys, "argv", ["export_onnx.py", "--checkpoint", str(checkpoint_path), "--out", str(out_path)])
    _main()

    assert out_path.is_file()
    manifest_path = out_path.parent / "manifest.json"
    assert json.loads(manifest_path.read_text()) == {"iteration": 5}


def test_main_falls_back_to_env_file_for_checkpoint_and_out(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    net = TichuPolicyValueNet()
    checkpoint_path = tmp_path / "checkpoint_9.pt"
    _save_checkpoint(net, checkpoint_path)
    out_path = tmp_path / "deploy" / "policy.onnx.enc"
    env_path = tmp_path / ".env"
    env_path.write_text(f"CHECKPOINT={checkpoint_path}\nOUT={out_path}\n")

    monkeypatch.setattr(sys, "argv", ["export_onnx.py", "--env-file", str(env_path)])
    _main()

    assert out_path.is_file()
    assert json.loads((out_path.parent / "manifest.json").read_text()) == {"iteration": 9}


def test_main_exits_with_an_error_when_neither_cli_nor_env_file_gives_a_checkpoint(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(sys, "argv", ["export_onnx.py", "--env-file", str(tmp_path / "missing.env")])
    with pytest.raises(SystemExit):
        _main()


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
