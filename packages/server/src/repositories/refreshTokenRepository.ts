import type { RefreshToken } from '@prisma/client';
import { type Result } from '@tichu/shared';
import { prisma } from '../db/client';
import { withDb, type DbError } from '../db/errors';

export interface CreateRefreshTokenInput {
  readonly userId: string;
  readonly tokenHash: string;
  readonly expiresAt: Date;
}

export function createRefreshToken(data: CreateRefreshTokenInput): Promise<Result<RefreshToken, DbError>> {
  return withDb(() => prisma.refreshToken.create({ data }));
}

/** Only ever matches a token that is both unexpired and not yet revoked --
 * callers don't need to re-check those conditions themselves. */
export function findActiveRefreshTokenByHash(tokenHash: string): Promise<Result<RefreshToken | null, DbError>> {
  return withDb(() =>
    prisma.refreshToken.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: new Date() } },
    }),
  );
}

export function revokeRefreshToken(id: string): Promise<Result<RefreshToken, DbError>> {
  return withDb(() => prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } }));
}
