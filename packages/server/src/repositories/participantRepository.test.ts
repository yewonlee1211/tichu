import { beforeEach, describe, expect, it, vi } from 'vitest';

const participantMock = { create: vi.fn() };

vi.mock('../db/client', () => ({
  prisma: { participant: participantMock },
}));

const { createParticipant } = await import('./participantRepository');

describe('participantRepository', () => {
  beforeEach(() => {
    participantMock.create.mockReset();
  });

  describe('createParticipant', () => {
    it('creates a row with the given fields', async () => {
      const input = { roomId: 'r1', userId: 'u1', seat: 0 };
      const created = { id: 'p1', ...input, ready: false };
      participantMock.create.mockResolvedValue(created);

      const result = await createParticipant(input);

      expect(participantMock.create).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual({ ok: true, value: created });
    });

    it('returns a classified err on a duplicate seat', async () => {
      const { Prisma } = await import('@prisma/client');
      participantMock.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' }),
      );

      const result = await createParticipant({ roomId: 'r1', userId: 'u1', seat: 0 });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('conflict');
    });
  });
});
