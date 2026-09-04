import { beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';

process.env.JWT_SECRET = 'test-secret';
const { createAccessToken } = await import('../services/jwt');
const { resolveUpgradeUserId } = await import('./connectionAuth');

function reqWithCookie(cookie: string | undefined): IncomingMessage {
  return { headers: { cookie } } as IncomingMessage;
}

describe('resolveUpgradeUserId', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret';
  });

  it('returns the userId for a valid accessToken cookie', () => {
    const token = createAccessToken('u1');

    expect(resolveUpgradeUserId(reqWithCookie(`accessToken=${token}`))).toBe('u1');
  });

  it('finds accessToken among multiple cookies', () => {
    const token = createAccessToken('u1');

    expect(resolveUpgradeUserId(reqWithCookie(`foo=bar; accessToken=${token}; baz=qux`))).toBe('u1');
  });

  it('returns null when there is no cookie header', () => {
    expect(resolveUpgradeUserId(reqWithCookie(undefined))).toBeNull();
  });

  it('returns null when there is no accessToken cookie', () => {
    expect(resolveUpgradeUserId(reqWithCookie('foo=bar'))).toBeNull();
  });

  it('returns null for a malformed token', () => {
    expect(resolveUpgradeUserId(reqWithCookie('accessToken=garbage'))).toBeNull();
  });
});
