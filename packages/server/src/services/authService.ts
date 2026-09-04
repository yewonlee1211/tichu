import bcrypt from 'bcrypt';
import type { User } from '@prisma/client';
import { ok, err, type Result } from '@tichu/shared';
import { createUser, findUserByLoginId, findUserById } from '../repositories/userRepository';
import { createRefreshToken as storeRefreshToken, findActiveRefreshTokenByHash, revokeRefreshToken } from '../repositories/refreshTokenRepository';
import { type DbError } from '../db/errors';
import { createAccessToken, createRefreshToken, verifyToken } from './jwt';
import { hashToken } from './tokenHash';

const BCRYPT_SALT_ROUNDS = 10;

export type AuthErrorKind = 'invalid_credentials' | 'login_id_taken' | 'invalid_refresh_token' | 'db_error';

export interface AuthError {
  readonly kind: AuthErrorKind;
  readonly message: string;
}

export type SafeUser = Omit<User, 'passwordHash'>;

export interface AuthSession {
  readonly user: SafeUser;
  readonly accessToken: string;
  readonly refreshToken: string;
}

function toSafeUser(user: User): SafeUser {
  return {
    id: user.id,
    loginId: user.loginId,
    nickname: user.nickname,
    ranking: user.ranking,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function fromDbError(error: DbError): AuthError {
  return { kind: 'db_error', message: error.message };
}

function invalidCredentials(): AuthError {
  return { kind: 'invalid_credentials', message: '아이디 또는 비밀번호가 일치하지 않습니다.' };
}

async function issueSession(user: User): Promise<Result<AuthSession, AuthError>> {
  const accessToken = createAccessToken(user.id);
  const { token: refreshToken, expiresAt } = createRefreshToken(user.id);

  const stored = await storeRefreshToken({ userId: user.id, tokenHash: hashToken(refreshToken), expiresAt });
  if (!stored.ok) return err(fromDbError(stored.error));

  return ok({ user: toSafeUser(user), accessToken, refreshToken });
}

export interface SignUpInput {
  readonly loginId: string;
  readonly password: string;
  readonly nickname: string;
}

export async function signUp(input: SignUpInput): Promise<Result<AuthSession, AuthError>> {
  const existing = await findUserByLoginId(input.loginId);
  if (!existing.ok) return err(fromDbError(existing.error));
  if (existing.value !== null) return err({ kind: 'login_id_taken', message: '이미 사용 중인 아이디입니다.' });

  const passwordHash = await bcrypt.hash(input.password, BCRYPT_SALT_ROUNDS);
  const created = await createUser({ loginId: input.loginId, passwordHash, nickname: input.nickname });
  if (!created.ok) {
    if (created.error.kind === 'conflict') return err({ kind: 'login_id_taken', message: '이미 사용 중인 아이디 또는 닉네임입니다.' });
    return err(fromDbError(created.error));
  }

  return issueSession(created.value);
}

export interface LogInInput {
  readonly loginId: string;
  readonly password: string;
}

export async function logIn(input: LogInInput): Promise<Result<AuthSession, AuthError>> {
  const found = await findUserByLoginId(input.loginId);
  if (!found.ok) return err(fromDbError(found.error));
  if (found.value === null) return err(invalidCredentials());

  const passwordMatches = await bcrypt.compare(input.password, found.value.passwordHash);
  if (!passwordMatches) return err(invalidCredentials());

  return issueSession(found.value);
}

/** Rotates the refresh token: the presented one is revoked and a new
 * access/refresh pair is issued, so a leaked refresh token has a single
 * use window before its replacement invalidates it. */
export async function refreshSession(refreshToken: string): Promise<Result<AuthSession, AuthError>> {
  const payload = verifyToken(refreshToken);
  if (payload === null) return err({ kind: 'invalid_refresh_token', message: '유효하지 않은 리프레시 토큰입니다.' });

  const found = await findActiveRefreshTokenByHash(hashToken(refreshToken));
  if (!found.ok) return err(fromDbError(found.error));
  if (found.value === null) return err({ kind: 'invalid_refresh_token', message: '유효하지 않은 리프레시 토큰입니다.' });

  const revoked = await revokeRefreshToken(found.value.id);
  if (!revoked.ok) return err(fromDbError(revoked.error));

  const user = await findUserById(payload.userId);
  if (!user.ok) return err(fromDbError(user.error));
  if (user.value === null) return err({ kind: 'invalid_refresh_token', message: '유효하지 않은 리프레시 토큰입니다.' });

  return issueSession(user.value);
}

export async function getSafeUserById(id: string): Promise<Result<SafeUser | null, AuthError>> {
  const found = await findUserById(id);
  if (!found.ok) return err(fromDbError(found.error));
  if (found.value === null) return ok(null);
  return ok(toSafeUser(found.value));
}

export async function logOut(refreshToken: string): Promise<Result<void, AuthError>> {
  const found = await findActiveRefreshTokenByHash(hashToken(refreshToken));
  if (!found.ok) return err(fromDbError(found.error));
  if (found.value === null) return ok(undefined);

  const revoked = await revokeRefreshToken(found.value.id);
  if (!revoked.ok) return err(fromDbError(revoked.error));

  return ok(undefined);
}
