"""Lightweight, reversible byte obfuscation for exported ONNX models.

This is NOT real security -- the XOR key below is fixed and public in this source
file, the opposite of a secret. Its only purpose is enough friction that a right-click
save or a direct request to the served `.onnx.enc` URL doesn't hand out a directly
loadable ONNX file. The browser-side loader (tichu-solo-ai-browser session) is expected
to XOR the bytes back with the same key before feeding them to onnxruntime-web.
"""

from __future__ import annotations

import numpy as np

_XOR_KEY = b"tichu-onnx-friction-v1"


def xor_transform(data: bytes) -> bytes:
    """XORs `data` against a fixed repeating key. Self-inverse: applying this twice
    with the same key returns the original bytes, so the same function both encodes
    (`.onnx` -> `.onnx.enc`) and decodes (`.onnx.enc` -> `.onnx`)."""
    key = np.frombuffer(_XOR_KEY, dtype=np.uint8)
    reps = -(-len(data) // len(key))  # ceil division
    repeated_key = np.tile(key, reps)[: len(data)]
    data_arr = np.frombuffer(data, dtype=np.uint8)
    return (data_arr ^ repeated_key).tobytes()
