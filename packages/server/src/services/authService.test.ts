import { beforeEach, describe, expect, it, vi } from 'vitest';

const userRepo = {
  findUserByLoginId: vi.fn(),
  findUserById: vi.fn(),
  createUser: vi.fn(),
};
vi.mock('../repositories/userRepository', () => userRepo);

const refreshTokenRepo = {
  createRefreshToken: vi.fn(),
  findActiveRefreshTokenByHash: vi.fn(),
  revokeRefreshToken: vi.fn(),
};
vi.mock('../repositories/refreshTokenRepository', () => refreshTokenRepo);

const jwtMock = {
  createAccessToken: vi.fn(),
  createRefreshToken: vi.fn(),
  verifyToken: vi.fn(),
};
vi.mock('./jwt', () => jwtMock);

const hashTokenMock = vi.fn((token: string) => `hashed:${token}`);
vi.mock('./tokenHash', () => ({ hashToken: hashTokenMock }));

const bcryptMock = { hash: vi.fn(), compare: vi.fn() };
vi.mock('bcrypt', () => ({ default: bcryptMock }));

const { signUp, logIn, refreshSession, logOut } = await import('./authService');

const dbErr = (message = 'boom') => ({ ok: false as const, error: { kind: 'unknown' as const, message, cause: undefined } });
const okResult = <T>(value: T) => ({ ok: true as const, value });

const user = { id: 'u1', loginId: 'alice', passwordHash: 'stored-hash', nickname: 'Alice', ranking: 1000, createdAt: new Date(), updatedAt: new Date() };

describe('authService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hashTokenMock.mockImplementation((token: string) => `hashed:${token}`);
    jwtMock.createAccessToken.mockReturnValue('access-token');
    jwtMock.createRefreshToken.mockReturnValue({ token: 'refresh-token', expiresAt: new Date('2026-10-01') });
    refreshTokenRepo.createRefreshToken.mockResolvedValue(okResult({ id: 't1' }));
  });

  describe('signUp', () => {
    it('creates the user and issues a session when loginId is free', async () => {
      userRepo.findUserByLoginId.mockResolvedValue(okResult(null));
      bcryptMock.hash.mockResolvedValue('hashed-password');
      userRepo.createUser.mockResolvedValue(okResult(user));

      const result = await signUp({ loginId: 'alice', password: 'pw', nickname: 'Alice' });

      expect(userRepo.createUser).toHaveBeenCalledWith({ loginId: 'alice', passwordHash: 'hashed-password', nickname: 'Alice' });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.accessToken).toBe('access-token');
        expect(result.value.refreshToken).toBe('refresh-token');
        expect(result.value.user).not.toHaveProperty('passwordHash');
      }
    });

    it('rejects when loginId already exists', async () => {
      userRepo.findUserByLoginId.mockResolvedValue(okResult(user));

      const result = await signUp({ loginId: 'alice', password: 'pw', nickname: 'Alice' });

      expect(result).toEqual({ ok: false, error: { kind: 'login_id_taken', message: expect.any(String) } });
      expect(userRepo.createUser).not.toHaveBeenCalled();
    });

    it('maps a conflict from createUser (e.g. duplicate nickname) to login_id_taken', async () => {
      userRepo.findUserByLoginId.mockResolvedValue(okResult(null));
      bcryptMock.hash.mockResolvedValue('hashed-password');
      userRepo.createUser.mockResolvedValue({ ok: false, error: { kind: 'conflict', message: 'unique violation' } });

      const result = await signUp({ loginId: 'alice', password: 'pw', nickname: 'Alice' });

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('login_id_taken');
    });

    it('propagates a db error from the initial lookup', async () => {
      userRepo.findUserByLoginId.mockResolvedValue(dbErr('connection lost'));

      const result = await signUp({ loginId: 'alice', password: 'pw', nickname: 'Alice' });

      expect(result).toEqual({ ok: false, error: { kind: 'db_error', message: 'connection lost' } });
    });
  });

  describe('logIn', () => {
    it('issues a session when credentials are valid', async () => {
      userRepo.findUserByLoginId.mockResolvedValue(okResult(user));
      bcryptMock.compare.mockResolvedValue(true);

      const result = await logIn({ loginId: 'alice', password: 'pw' });

      expect(bcryptMock.compare).toHaveBeenCalledWith('pw', 'stored-hash');
      expect(result.ok).toBe(true);
    });

    it('rejects when no user matches the loginId', async () => {
      userRepo.findUserByLoginId.mockResolvedValue(okResult(null));

      const result = await logIn({ loginId: 'nobody', password: 'pw' });

      expect(result).toEqual({ ok: false, error: { kind: 'invalid_credentials', message: expect.any(String) } });
      expect(bcryptMock.compare).not.toHaveBeenCalled();
    });

    it('rejects when the password does not match', async () => {
      userRepo.findUserByLoginId.mockResolvedValue(okResult(user));
      bcryptMock.compare.mockResolvedValue(false);

      const result = await logIn({ loginId: 'alice', password: 'wrong' });

      expect(result).toEqual({ ok: false, error: { kind: 'invalid_credentials', message: expect.any(String) } });
    });
  });

  describe('refreshSession', () => {
    it('rotates the token and issues a fresh session', async () => {
      jwtMock.verifyToken.mockReturnValue({ userId: 'u1' });
      refreshTokenRepo.findActiveRefreshTokenByHash.mockResolvedValue(okResult({ id: 't-old', userId: 'u1' }));
      refreshTokenRepo.revokeRefreshToken.mockResolvedValue(okResult({ id: 't-old' }));
      userRepo.findUserById.mockResolvedValue(okResult(user));

      const result = await refreshSession('old-refresh-token');

      expect(refreshTokenRepo.revokeRefreshToken).toHaveBeenCalledWith('t-old');
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.refreshToken).toBe('refresh-token');
    });

    it('rejects a token that fails JWT verification', async () => {
      jwtMock.verifyToken.mockReturnValue(null);

      const result = await refreshSession('garbage');

      expect(result).toEqual({ ok: false, error: { kind: 'invalid_refresh_token', message: expect.any(String) } });
      expect(refreshTokenRepo.findActiveRefreshTokenByHash).not.toHaveBeenCalled();
    });

    it('rejects when no active (unrevoked, unexpired) row matches the hash', async () => {
      jwtMock.verifyToken.mockReturnValue({ userId: 'u1' });
      refreshTokenRepo.findActiveRefreshTokenByHash.mockResolvedValue(okResult(null));

      const result = await refreshSession('reused-token');

      expect(result).toEqual({ ok: false, error: { kind: 'invalid_refresh_token', message: expect.any(String) } });
    });
  });

  describe('logOut', () => {
    it('revokes the matching active token', async () => {
      refreshTokenRepo.findActiveRefreshTokenByHash.mockResolvedValue(okResult({ id: 't1' }));
      refreshTokenRepo.revokeRefreshToken.mockResolvedValue(okResult({ id: 't1' }));

      const result = await logOut('refresh-token');

      expect(refreshTokenRepo.revokeRefreshToken).toHaveBeenCalledWith('t1');
      expect(result).toEqual({ ok: true, value: undefined });
    });

    it('is a no-op when no active token matches', async () => {
      refreshTokenRepo.findActiveRefreshTokenByHash.mockResolvedValue(okResult(null));

      const result = await logOut('already-gone');

      expect(refreshTokenRepo.revokeRefreshToken).not.toHaveBeenCalled();
      expect(result).toEqual({ ok: true, value: undefined });
    });
  });
});
