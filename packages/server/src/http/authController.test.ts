import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const authService = {
  signUp: vi.fn(),
  logIn: vi.fn(),
  refreshSession: vi.fn(),
  logOut: vi.fn(),
  getSafeUserById: vi.fn(),
};
vi.mock('../services/authService', () => authService);

process.env.JWT_SECRET = 'test-secret';
const { createAccessToken } = await import('../services/jwt');
const { createApp } = await import('./app');

const okResult = <T>(value: T) => ({ ok: true as const, value });
const errResult = (error: { kind: string; message: string }) => ({ ok: false as const, error });

const safeUser = { id: 'u1', loginId: 'alice', nickname: 'Alice', ranking: 1000, createdAt: new Date(), updatedAt: new Date() };
const session = { user: safeUser, accessToken: 'access-token', refreshToken: 'refresh-token' };

function getSetCookies(res: request.Response): string[] {
  return (res.headers['set-cookie'] as unknown as string[] | undefined) ?? [];
}

describe('authController', () => {
  const app = createApp();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /auth/signup', () => {
    it('201s and sets cookies on success', async () => {
      authService.signUp.mockResolvedValue(okResult(session));

      const res = await request(app).post('/auth/signup').send({ loginId: 'alice', password: 'password1', nickname: 'Alice' });

      expect(res.status).toBe(201);
      expect(res.body.user.loginId).toBe('alice');
      expect(getSetCookies(res).some((c) => c.startsWith('accessToken='))).toBe(true);
      expect(getSetCookies(res).some((c) => c.startsWith('refreshToken='))).toBe(true);
    });

    it('400s on invalid input without calling the service', async () => {
      const res = await request(app).post('/auth/signup').send({ loginId: 'ab', password: 'short', nickname: '' });

      expect(res.status).toBe(400);
      expect(authService.signUp).not.toHaveBeenCalled();
    });

    it('409s when the service reports login_id_taken', async () => {
      authService.signUp.mockResolvedValue(errResult({ kind: 'login_id_taken', message: '이미 사용 중인 아이디입니다.' }));

      const res = await request(app).post('/auth/signup').send({ loginId: 'alice', password: 'password1', nickname: 'Alice' });

      expect(res.status).toBe(409);
    });
  });

  describe('POST /auth/login', () => {
    it('200s and sets cookies on success', async () => {
      authService.logIn.mockResolvedValue(okResult(session));

      const res = await request(app).post('/auth/login').send({ loginId: 'alice', password: 'password1' });

      expect(res.status).toBe(200);
      expect(res.body.user.loginId).toBe('alice');
    });

    it('401s on invalid credentials', async () => {
      authService.logIn.mockResolvedValue(errResult({ kind: 'invalid_credentials', message: '아이디 또는 비밀번호가 일치하지 않습니다.' }));

      const res = await request(app).post('/auth/login').send({ loginId: 'alice', password: 'wrong' });

      expect(res.status).toBe(401);
    });
  });

  describe('POST /auth/refresh', () => {
    it('401s when no refreshToken cookie is present', async () => {
      const res = await request(app).post('/auth/refresh');

      expect(res.status).toBe(401);
      expect(authService.refreshSession).not.toHaveBeenCalled();
    });

    it('200s and rotates cookies when the service succeeds', async () => {
      authService.refreshSession.mockResolvedValue(okResult(session));

      const res = await request(app).post('/auth/refresh').set('Cookie', ['refreshToken=old-token']);

      expect(res.status).toBe(200);
      expect(authService.refreshSession).toHaveBeenCalledWith('old-token');
    });

    it('clears cookies and 401s when the refresh token is invalid', async () => {
      authService.refreshSession.mockResolvedValue(errResult({ kind: 'invalid_refresh_token', message: '유효하지 않은 리프레시 토큰입니다.' }));

      const res = await request(app).post('/auth/refresh').set('Cookie', ['refreshToken=bad-token']);

      expect(res.status).toBe(401);
      expect(getSetCookies(res).some((c) => c.startsWith('accessToken=;'))).toBe(true);
    });
  });

  describe('POST /auth/logout', () => {
    it('clears cookies and 200s', async () => {
      authService.logOut.mockResolvedValue(okResult(undefined));

      const res = await request(app).post('/auth/logout').set('Cookie', ['refreshToken=old-token']);

      expect(res.status).toBe(200);
      expect(authService.logOut).toHaveBeenCalledWith('old-token');
    });
  });

  describe('GET /auth/me', () => {
    it('401s without a valid accessToken cookie', async () => {
      const res = await request(app).get('/auth/me');

      expect(res.status).toBe(401);
      expect(authService.getSafeUserById).not.toHaveBeenCalled();
    });

    it('200s with the user when the accessToken is valid', async () => {
      authService.getSafeUserById.mockResolvedValue(okResult(safeUser));
      const accessToken = createAccessToken('u1');

      const res = await request(app).get('/auth/me').set('Cookie', [`accessToken=${accessToken}`]);

      expect(res.status).toBe(200);
      expect(authService.getSafeUserById).toHaveBeenCalledWith('u1');
      expect(res.body.user.loginId).toBe('alice');
    });
  });
});
