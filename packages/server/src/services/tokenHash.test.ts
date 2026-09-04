import { describe, expect, it } from 'vitest';
import { hashToken } from './tokenHash';

describe('hashToken', () => {
  it('returns the same hash for the same input', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
  });

  it('returns different hashes for different input', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('never returns the raw input', () => {
    expect(hashToken('abc')).not.toBe('abc');
  });
});
