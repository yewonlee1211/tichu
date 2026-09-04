import { beforeEach, describe, expect, it, vi } from 'vitest';

const userMock = {
  findUnique: vi.fn(),
  create: vi.fn(),
};

vi.mock('../db/client', () => ({
  prisma: { user: userMock },
}));

const { findUserByLoginId, findUserById, createUser } = await import('./userRepository');

describe('userRepository', () => {
  beforeEach(() => {
    userMock.findUnique.mockReset();
    userMock.create.mockReset();
  });

  describe('findUserByLoginId', () => {
    it('returns ok with the user when found', async () => {
      const user = { id: 'u1', loginId: 'alice' };
      userMock.findUnique.mockResolvedValue(user);

      const result = await findUserByLoginId('alice');

      expect(userMock.findUnique).toHaveBeenCalledWith({ where: { loginId: 'alice' } });
      expect(result).toEqual({ ok: true, value: user });
    });

    it('returns ok with null when no user matches', async () => {
      userMock.findUnique.mockResolvedValue(null);

      const result = await findUserByLoginId('missing');

      expect(result).toEqual({ ok: true, value: null });
    });

    it('returns a classified err when the query fails', async () => {
      userMock.findUnique.mockRejectedValue(new Error('connection refused'));

      const result = await findUserByLoginId('alice');

      expect(result.ok).toBe(false);
    });
  });

  describe('findUserById', () => {
    it('queries by id', async () => {
      const user = { id: 'u1', loginId: 'alice' };
      userMock.findUnique.mockResolvedValue(user);

      const result = await findUserById('u1');

      expect(userMock.findUnique).toHaveBeenCalledWith({ where: { id: 'u1' } });
      expect(result).toEqual({ ok: true, value: user });
    });
  });

  describe('createUser', () => {
    it('creates a user with the given fields', async () => {
      const input = { loginId: 'alice', passwordHash: 'hashed', nickname: 'Alice' };
      const created = { id: 'u1', ...input };
      userMock.create.mockResolvedValue(created);

      const result = await createUser(input);

      expect(userMock.create).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual({ ok: true, value: created });
    });

    it('returns a classified err on unique constraint violation', async () => {
      const { Prisma } = await import('@prisma/client');
      userMock.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' }),
      );

      const result = await createUser({ loginId: 'alice', passwordHash: 'hashed', nickname: 'Alice' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('conflict');
    });
  });
});
