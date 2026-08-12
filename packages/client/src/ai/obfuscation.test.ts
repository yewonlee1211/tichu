import { describe, expect, it } from 'vitest';
import { xorTransform } from './obfuscation';

describe('xorTransform', () => {
  it('round-trips arbitrary bytes back to the original', () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 252, 253, 254, 255, 42, 7]);

    const encoded = xorTransform(original);
    const decoded = xorTransform(encoded);

    expect(decoded).toEqual(original);
  });

  it('actually changes the bytes (is not a no-op)', () => {
    const original = new Uint8Array(64).fill(0);

    const encoded = xorTransform(original);

    expect(encoded).not.toEqual(original);
  });

  it('handles input shorter than the key', () => {
    const original = new Uint8Array([1, 2, 3]);

    expect(xorTransform(xorTransform(original))).toEqual(original);
  });

  it('handles empty input', () => {
    expect(xorTransform(new Uint8Array(0))).toEqual(new Uint8Array(0));
  });
});