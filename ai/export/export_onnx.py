"""Exports a trained `TichuPolicyValueNet` checkpoint to an obfuscated ONNX model that
runs client-side in the browser via onnxruntime-web (see
`.claude/plans/tichu-ai-onnx-export.handoff.md`).

Input/output contract -- this is the interface the browser-side loader
(tichu-solo-ai-browser session) binds to by name, and it must stay in sync with that
session's expectations:

  Inputs:
    - obs (float32[OBS_DIM]): a single observation, as produced by
      `tichu_env.encoding.encode_observation`.
    - action_vectors (float32[num_candidates, ACTION_DIM]): encoded legal actions for
      that observation, as produced by `tichu_env.encoding.encode_legal_actions`.
      `num_candidates` is a dynamic axis -- Tichu offers a different number of legal
      combos every turn, so this is never a fixed width.

  Outputs:
    - action_logits (float32[num_candidates]): one unnormalized logit per candidate
      action, in the same order as the `action_vectors` input. Caller applies softmax.
    - state_value (float32, scalar): estimated value of `obs` for the player to move.

This contract survives any change to `TichuPolicyValueNet`'s internal architecture
(hidden_dim, embedding_dim, number of layers, ...) -- only `forward`'s signature
(obs/action_vectors in, logits/value out) needs to hold. If a future M2 change alters
`forward`'s signature itself (e.g. an additional input becomes necessary), this export
script must be updated to match, and the browser-side session must be notified since
its loader depends on the input/output names declared here.

Divergence from the PyTorch model: `TichuPolicyValueNet.forward` raises `ValueError`
for an empty `action_vectors` (see `agents/policy_network.py`). That check is a
Python-level `if` on a concrete traced shape, so the legacy tracer used here bakes in
whichever branch executes at trace time and does not record the raise into the ONNX
graph -- an empty `action_vectors` therefore does not error in the exported model, it
returns `action_logits` with shape `(0,)`. This is safe under this project's own game
rules (`tichu_env.encoding.encode_legal_actions` always returns at least one candidate
for the player whose turn it is, which is the only player this model is ever asked to
decide for), but a caller must not rely on the ONNX model to reject an empty input the
way the PyTorch model does.
"""

from __future__ import annotations

import argparse
import json
import re
import tempfile
from pathlib import Path

import torch
from torch import Tensor, nn

from agents.policy_network import TichuPolicyValueNet
from export.obfuscate import xor_transform
from tichu_env.encoding import ACTION_DIM, OBS_DIM

INPUT_NAMES = ["obs", "action_vectors"]
OUTPUT_NAMES = ["action_logits", "state_value"]
DYNAMIC_AXES = {
    "action_vectors": {0: "num_candidates"},
    "action_logits": {0: "num_candidates"},
}
OPSET_VERSION = 17

CHECKPOINT_ITERATION_RE = re.compile(r"checkpoint_(\d+)\.pt$")


class _OnnxExportWrapper(nn.Module):
    """`TichuPolicyValueNet.forward` returns a `PolicyValueOutput` dataclass, but
    `torch.onnx.export` binds output names to a flat tuple of tensors -- this wrapper
    is the adapter between the two."""

    def __init__(self, net: TichuPolicyValueNet) -> None:
        super().__init__()
        self.net = net

    def forward(self, obs: Tensor, action_vectors: Tensor) -> tuple[Tensor, Tensor]:
        output = self.net(obs, action_vectors)
        return output.action_logits, output.state_value


def load_network(checkpoint_path: Path) -> TichuPolicyValueNet:
    """`checkpoint_*.pt` files (see `training/train.py`) store only `state_dict()`, no
    hyperparameters, so this constructs `TichuPolicyValueNet` with its defaults --
    matching how `train.py` always constructs the network it trains. A checkpoint
    trained with non-default hidden_dim/embedding_dim will fail to load here with a
    shape-mismatch error."""
    if not checkpoint_path.is_file():
        raise ValueError(f"checkpoint not found: {checkpoint_path}")
    network = TichuPolicyValueNet()
    network.load_state_dict(torch.load(checkpoint_path, weights_only=True))
    network.eval()
    return network


def export_onnx_bytes(network: TichuPolicyValueNet) -> bytes:
    """Traces `network.forward` and returns the serialized (un-obfuscated) ONNX model
    bytes. `torch.onnx.export` only writes to a real filesystem path in this torch
    version, so a temp file is used as scratch space and immediately read back."""
    wrapper = _OnnxExportWrapper(network)
    wrapper.eval()
    example_obs = torch.zeros(OBS_DIM)
    example_action_vectors = torch.zeros(2, ACTION_DIM)

    with tempfile.TemporaryDirectory() as tmp_dir:
        tmp_path = Path(tmp_dir) / "model.onnx"
        # dynamo=False: this torch version defaults to the newer dynamo/torch.export
        # based exporter, which requires the `onnxscript` package (not part of this
        # project's dependencies). The legacy TorchScript-tracing exporter has no such
        # dependency and is sufficient for this module's simple, non-data-dependent
        # control flow.
        torch.onnx.export(
            wrapper,
            (example_obs, example_action_vectors),
            str(tmp_path),
            input_names=INPUT_NAMES,
            output_names=OUTPUT_NAMES,
            dynamic_axes=DYNAMIC_AXES,
            opset_version=OPSET_VERSION,
            dynamo=False,
        )
        return tmp_path.read_bytes()


def export_to_file(checkpoint_path: Path, out_path: Path) -> None:
    network = load_network(checkpoint_path)
    onnx_bytes = export_onnx_bytes(network)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(xor_transform(onnx_bytes))


def infer_iteration(checkpoint_path: Path) -> int:
    """Parses the training iteration out of a `checkpoint_<N>.pt` filename (see
    `training/train.py`, which always names checkpoints this way). The browser-side
    loader (`packages/client/src/ai/loadModel.ts`) compares this number against its
    cached manifest to decide whether to redownload the model, so a wrong guess here
    means a stale model silently never refreshes -- raise instead of guessing when the
    filename doesn't follow the convention."""
    match = CHECKPOINT_ITERATION_RE.search(checkpoint_path.name)
    if match is None:
        raise ValueError(
            f"cannot infer iteration from checkpoint filename {checkpoint_path.name!r} "
            "(expected checkpoint_<N>.pt); pass --iteration explicitly."
        )
    return int(match.group(1))


def write_manifest(manifest_path: Path, iteration: int) -> None:
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps({"iteration": iteration}))


DEFAULT_ENV_FILE = Path(__file__).parent / ".env"


def load_env_file(path: Path) -> dict[str, str]:
    """Parses a minimal `KEY=VALUE`-per-line env file (blank lines and `#` comments
    ignored). Hand-rolled instead of adding a `python-dotenv` dependency for this
    handful of flat string values. Lets `--checkpoint`/`--out` be pinned in a local,
    gitignored file (see `.env.example`) instead of retyped on the command line every
    time a different training run's checkpoint should ship -- CLI flags still take
    precedence when passed explicitly. Missing file is not an error: an empty dict
    just means no defaults were supplied this way."""
    if not path.is_file():
        return {}
    env: dict[str, str] = {}
    for line in path.read_text().splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, sep, value = stripped.partition("=")
        if not sep:
            continue
        env[key.strip()] = value.strip()
    return env


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Export a TichuPolicyValueNet checkpoint to an obfuscated ONNX model for the browser."
    )
    parser.add_argument(
        "--checkpoint", type=Path, default=None, help="checkpoint_*.pt file to export. Falls back to CHECKPOINT in --env-file."
    )
    parser.add_argument("--out", type=Path, default=None, help="Output path, e.g. policy.onnx.enc. Falls back to OUT in --env-file.")
    parser.add_argument(
        "--iteration",
        type=int,
        default=None,
        help="Model iteration number recorded in manifest.json. Inferred from --checkpoint's "
        "filename (checkpoint_<N>.pt) when omitted.",
    )
    parser.add_argument(
        "--manifest-out",
        type=Path,
        default=None,
        help="Output path for manifest.json. Defaults to manifest.json next to --out.",
    )
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help="KEY=VALUE file providing CHECKPOINT/OUT defaults (default: export/.env, gitignored -- see export/.env.example).",
    )
    args = parser.parse_args()

    env = load_env_file(args.env_file)
    checkpoint = args.checkpoint if args.checkpoint is not None else (Path(env["CHECKPOINT"]) if "CHECKPOINT" in env else None)
    out = args.out if args.out is not None else (Path(env["OUT"]) if "OUT" in env else None)
    if checkpoint is None:
        parser.error(f"--checkpoint is required (or set CHECKPOINT in {args.env_file}).")
    if out is None:
        parser.error(f"--out is required (or set OUT in {args.env_file}).")

    iteration = args.iteration if args.iteration is not None else infer_iteration(checkpoint)
    manifest_out = args.manifest_out if args.manifest_out is not None else out.parent / "manifest.json"

    export_to_file(checkpoint, out)
    write_manifest(manifest_out, iteration)
    print(f"exported {checkpoint} -> {out}")
    print(f"wrote manifest (iteration={iteration}) -> {manifest_out}")


if __name__ == "__main__":
    _main()
