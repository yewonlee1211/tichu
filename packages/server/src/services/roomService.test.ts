import { beforeEach, describe, expect, it, vi } from 'vitest';

const roomRepo = {
  createRoom: vi.fn(),
  listOpenRooms: vi.fn(),
};
vi.mock('../repositories/roomRepository', () => roomRepo);

const { createRoom, listOpenRooms } = await import('./roomService');

const okResult = <T>(value: T) => ({ ok: true as const, value });
const dbErr = (message = 'boom') => ({ ok: false as const, error: { kind: 'unknown' as const, message, cause: undefined } });

describe('roomService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('createRoom', () => {
    it('creates the room on the first attempt when the code is free', async () => {
      const room = { id: 'r1', code: 'ABC123', title: 'My Room', isPublic: true, activeGameId: null };
      roomRepo.createRoom.mockResolvedValue(okResult(room));

      const result = await createRoom({ title: 'My Room', isPublic: true });

      expect(roomRepo.createRoom).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: true, value: room });
    });

    it('retries with a fresh code on a conflict, then succeeds', async () => {
      const room = { id: 'r1', code: 'ABC123', title: 'My Room', isPublic: true, activeGameId: null };
      roomRepo.createRoom
        .mockResolvedValueOnce({ ok: false, error: { kind: 'conflict', message: 'duplicate code' } })
        .mockResolvedValueOnce(okResult(room));

      const result = await createRoom({ title: 'My Room', isPublic: true });

      expect(roomRepo.createRoom).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ ok: true, value: room });
    });

    it('gives up after repeated conflicts', async () => {
      roomRepo.createRoom.mockResolvedValue({ ok: false, error: { kind: 'conflict', message: 'duplicate code' } });

      const result = await createRoom({ title: 'My Room', isPublic: true });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('db_error');
    });

    it('does not retry on a non-conflict db error', async () => {
      roomRepo.createRoom.mockResolvedValue(dbErr('connection lost'));

      const result = await createRoom({ title: 'My Room', isPublic: true });

      expect(roomRepo.createRoom).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ ok: false, error: { kind: 'db_error', message: 'connection lost' } });
    });
  });

  describe('listOpenRooms', () => {
    it('returns the rooms from the repository', async () => {
      const rooms = [{ id: 'r1', code: 'ABC123', title: 'My Room', participantCount: 2 }];
      roomRepo.listOpenRooms.mockResolvedValue(okResult(rooms));

      const result = await listOpenRooms();

      expect(result).toEqual({ ok: true, value: rooms });
    });

    it('propagates a db error', async () => {
      roomRepo.listOpenRooms.mockResolvedValue(dbErr('connection lost'));

      const result = await listOpenRooms();

      expect(result).toEqual({ ok: false, error: { kind: 'db_error', message: 'connection lost' } });
    });
  });
});
