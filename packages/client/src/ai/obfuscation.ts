/**
 * Byte-for-byte mirror of `ai/export/obfuscate.py`'s `xor_transform` -- the fixed
 * key here MUST stay identical to that file's `_XOR_KEY`, or every `.onnx.enc`
 * asset fails to decode into a valid ONNX model. Not real security (documented as
 * such on the Python side too): just enough friction that a right-click-save of
 * the served `.onnx.enc` doesn't hand out a directly loadable model file.
 */
const XOR_KEY: Uint8Array = new TextEncoder().encode('tichu-onnx-friction-v1');

/** Self-inverse: XORing the output against the same key again returns the
 * original bytes, so this one function both encodes and decodes.
 *
 * Return type is the concrete `Uint8Array<ArrayBuffer>` (matching what `new
 * Uint8Array(length)` actually allocates), not the wider bare `Uint8Array`
 * (= `Uint8Array<ArrayBufferLike>`) -- the latter isn't assignable to DOM APIs
 * like `Response`'s `BodyInit` that expect a concrete `ArrayBuffer`-backed view. */
export function xorTransform(data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 1) {
    out[i] = data[i]! ^ XOR_KEY[i % XOR_KEY.length]!;
  }
  return out;
}
