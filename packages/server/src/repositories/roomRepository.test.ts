import { beforeEach, describe, expect, it, vi } from 'vitest';

const roomMock = {
  create: vi.fn(),
  findUnique: vi.fn(),
  findMany: vi.fn(),
};

vi.mock('../db/client', () => ({
  prisma: { room: roomMock },
}));

const { createRoom, findRoomByCode, listOpenRooms } = await import('./roomRepository');

describe('roomRepository', () => {
  beforeEach(() => {
    roomMock.create.mockReset();
    roomMock.findUnique.mockReset();
    roomMock.findMany.mockReset();
  });

  describe('createRoom', () => {
    it('creates a room with the given fields', async () => {
      const input = { code: 'ABC123', title: 'My Room', isPublic: true };
      const created = { id: 'r1', ...input, activeGameId: null };
      roomMock.create.mockResolvedValue(created);

      const result = await createRoom(input);

      expect(roomMock.create).toHaveBeenCalledWith({ data: input });
      expect(result).toEqual({ ok: true, value: created });
    });

    it('returns a classified err on a duplicate code', async () => {
      const { Prisma } = await import('@prisma/client');
      roomMock.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' }),
      );

      const result = await createRoom({ code: 'ABC123', title: 'My Room', isPublic: true });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('conflict');
    });
  });

  describe('findRoomByCode', () => {
    it('returns ok with the room when found', async () => {
      const room = { id: 'r1', code: 'ABC123' };
      roomMock.findUnique.mockResolvedValue(room);

      const result = await findRoomByCode('ABC123');

      expect(roomMock.findUnique).toHaveBeenCalledWith({ where: { code: 'ABC123' } });
      expect(result).toEqual({ ok: true, value: room });
    });

    it('returns ok with null when no room matches', async () => {
      roomMock.findUnique.mockResolvedValue(null);

      const result = await findRoomByCode('MISSING');

      expect(result).toEqual({ ok: true, value: null });
    });
  });

  describe('listOpenRooms', () => {
    it('queries public, not-mid-game rooms and maps the participant count', async () => {
      roomMock.findMany.mockResolvedValue([
        { id: 'r1', code: 'ABC123', title: 'Room 1', _count: { participants: 2 } },
        { id: 'r2', code: 'XYZ789', title: 'Room 2', _count: { participants: 0 } },
      ]);

      const result = await listOpenRooms();

      expect(roomMock.findMany).toHaveBeenCalledWith({
        where: { isPublic: true, activeGameId: null },
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { participants: true } } },
      });
      expect(result).toEqual({
        ok: true,
        value: [
          { id: 'r1', code: 'ABC123', title: 'Room 1', participantCount: 2 },
          { id: 'r2', code: 'XYZ789', title: 'Room 2', participantCount: 0 },
        ],
      });
    });

    it('returns a classified err when the query fails', async () => {
      roomMock.findMany.mockRejectedValue(new Error('connection refused'));

      const result = await listOpenRooms();

      expect(result.ok).toBe(false);
    });
  });
});
