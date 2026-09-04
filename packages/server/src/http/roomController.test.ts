import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const roomService = {
  createRoom: vi.fn(),
  listOpenRooms: vi.fn(),
};
vi.mock('../services/roomService', () => roomService);

process.env.JWT_SECRET = 'test-secret';
const { createAccessToken } = await import('../services/jwt');
const { createApp } = await import('./app');

const okResult = <T>(value: T) => ({ ok: true as const, value });
const errResult = (error: { kind: string; message: string }) => ({ ok: false as const, error });

const room = { id: 'r1', code: 'ABC123', title: 'My Room', isPublic: true, activeGameId: null, createdAt: new Date(), updatedAt: new Date() };
const accessToken = createAccessToken('u1');

describe('roomController', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /rooms', () => {
    it('401s without a valid accessToken cookie', async () => {
      const res = await request(app).post('/rooms').send({ title: 'My Room' });

      expect(res.status).toBe(401);
      expect(roomService.createRoom).not.toHaveBeenCalled();
    });

    it('201s and returns the created room when authenticated', async () => {
      roomService.createRoom.mockResolvedValue(okResult(room));

      const res = await request(app).post('/rooms').set('Cookie', [`accessToken=${accessToken}`]).send({ title: 'My Room' });

      expect(res.status).toBe(201);
      expect(roomService.createRoom).toHaveBeenCalledWith({ title: 'My Room', isPublic: true });
      expect(res.body.room.code).toBe('ABC123');
    });

    it('defaults isPublic to true when omitted, passes through an explicit false', async () => {
      roomService.createRoom.mockResolvedValue(okResult(room));

      await request(app).post('/rooms').set('Cookie', [`accessToken=${accessToken}`]).send({ title: 'My Room', isPublic: false });

      expect(roomService.createRoom).toHaveBeenCalledWith({ title: 'My Room', isPublic: false });
    });

    it('400s on invalid input without calling the service', async () => {
      const res = await request(app).post('/rooms').set('Cookie', [`accessToken=${accessToken}`]).send({ title: '' });

      expect(res.status).toBe(400);
      expect(roomService.createRoom).not.toHaveBeenCalled();
    });

    it('500s when the service reports a db error', async () => {
      roomService.createRoom.mockResolvedValue(errResult({ kind: 'db_error', message: 'boom' }));

      const res = await request(app).post('/rooms').set('Cookie', [`accessToken=${accessToken}`]).send({ title: 'My Room' });

      expect(res.status).toBe(500);
    });
  });

  describe('GET /rooms', () => {
    it('401s without a valid accessToken cookie', async () => {
      const res = await request(app).get('/rooms');

      expect(res.status).toBe(401);
      expect(roomService.listOpenRooms).not.toHaveBeenCalled();
    });

    it('200s with the open room list when authenticated', async () => {
      const rooms = [{ id: 'r1', code: 'ABC123', title: 'My Room', participantCount: 2 }];
      roomService.listOpenRooms.mockResolvedValue(okResult(rooms));

      const res = await request(app).get('/rooms').set('Cookie', [`accessToken=${accessToken}`]);

      expect(res.status).toBe(200);
      expect(res.body.rooms).toEqual(rooms);
    });
  });
});
