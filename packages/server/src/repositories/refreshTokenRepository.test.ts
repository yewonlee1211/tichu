import { beforeEach, describe, expect, it, vi } from 'vitest';

const refreshTokenMock = {
  create: vi.fn(),
  findFirst: vi.fn(),
  update: vi.fn(),
};

vi.mock('../db/client', () => ({
  prisma: { refreshToken: refreshTokenMock },
}));

const { createRefreshToken, findActiveRefreshTokenByHash, revokeRefreshToken } = await import('./refreshTokenRepository');

describe('refreshTokenRepository', () => {
  beforeEach(() => {
    refreshTokenMock.create.mockReset();
    refreshTokenMock.findFirst.mockReset();
    refreshTokenMock.update.mockReset();
  });

  describe('createRefreshToken', () => {
    it('creates a row with the given fields', async () => {
      const input = { userId: 'u1', tokenHash: 'hash', expiresAt: new Date('2026-10-01') };
      const created = { id: 't1', ...input, revokedAt: null };
      refreshTokenMock.create.mockResolvedValue(created);

      const result = await createRefreshToken(input);

      expect(refreshTokenMock.create).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual({ ok: true, value: created });
    });
  });

  describe('findActiveRefreshTokenByHash', () => {
    it('queries for an unrevoked, unexpired token with the given hash', async () => {
      const token = { id: 't1', tokenHash: 'hash', revokedAt: null };
      refreshTokenMock.findFirst.mockResolvedValue(token);

      const result = await findActiveRefreshTokenByHash('hash');

      expect(refreshTokenMock.findFirst).toHaveBeenCalledWith({
        where: { tokenHash: 'hash', revokedAt: null, expiresAt: { gt: expect.any(Date) } },
      });
      expect(result).toEqual({ ok: true, value: token });
    });

    it('returns ok with null when no active token matches', async () => {
      refreshTokenMock.findFirst.mockResolvedValue(null);

      const result = await findActiveRefreshTokenByHash('missing');

      expect(result).toEqual({ ok: true, value: null });
    });
  });

  describe('revokeRefreshToken', () => {
    it('sets revokedAt on the given token', async () => {
      const revoked = { id: 't1', revokedAt: new Date() };
      refreshTokenMock.update.mockResolvedValue(revoked);

      const result = await revokeRefreshToken('t1');

      expect(refreshTokenMock.update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { revokedAt: expect.any(Date) } });
      expect(result).toEqual({ ok: true, value: revoked });
    });
  });
});
