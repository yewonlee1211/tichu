import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createAccessToken, createRefreshToken, verifyToken } from './jwt';

describe('jwt', () => {
  const originalSecret = process.env.JWT_SECRET;

  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.JWT_SECRET = originalSecret;
  });

  it('creates an access token that verifies back to the same userId', () => {
    const token = createAccessToken('u1');

    const payload = verifyToken(token);

    expect(payload).toEqual({ userId: 'u1' });
  });

  it('creates a refresh token that verifies back to the same userId and carries an expiresAt ~2 weeks out', () => {
    const before = Date.now();
    const { token, expiresAt } = createRefreshToken('u1');

    const payload = verifyToken(token);

    expect(payload).toEqual({ userId: 'u1' });
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + twoWeeksMs - 1000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(before + twoWeeksMs + 5000);
  });

  it('returns null for a malformed token', () => {
    expect(verifyToken('not-a-jwt')).toBeNull();
  });

  it('returns null for a token signed with a different secret', () => {
    const token = createAccessToken('u1');
    process.env.JWT_SECRET = 'different-secret';

    expect(verifyToken(token)).toBeNull();
  });

  it('throws when JWT_SECRET is not configured', () => {
    delete process.env.JWT_SECRET;

    expect(() => createAccessToken('u1')).toThrow('JWT_SECRET is not configured');
  });
});
