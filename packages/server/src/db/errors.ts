import { Prisma } from '@prisma/client';
import { ok, err, type Result } from '@tichu/shared';

/** `connection` covers both "can't reach the DB" (init failure) and a live
 * connection dropping mid-query -- callers that care about retrying treat
 * both the same way. `not_found`/`conflict` map Prisma's most common known
 * request error codes (P2025/P2002) so callers can branch without parsing
 * Prisma-specific codes themselves. */
export type DbErrorKind = 'connection' | 'not_found' | 'conflict' | 'unknown';

export interface DbError {
  readonly kind: DbErrorKind;
  readonly message: string;
  readonly cause: unknown;
}

function classify(cause: unknown): DbError {
  if (cause instanceof Prisma.PrismaClientInitializationError) {
    return { kind: 'connection', message: cause.message, cause };
  }
  if (cause instanceof Prisma.PrismaClientKnownRequestError) {
    if (cause.code === 'P2025') return { kind: 'not_found', message: cause.message, cause };
    if (cause.code === 'P2002') return { kind: 'conflict', message: cause.message, cause };
    return { kind: 'unknown', message: cause.message, cause };
  }
  const message = cause instanceof Error ? cause.message : String(cause);
  return { kind: 'unknown', message, cause };
}

/** Every DB call site (health check today, repository functions in Phase 2)
 * should go through this instead of a bare try/catch, so a Prisma exception
 * never reaches a caller as an uncaught throw. */
export async function withDb<T>(fn: () => Promise<T>): Promise<Result<T, DbError>> {
  try {
    return ok(await fn());
  } catch (cause) {
    return err(classify(cause));
  }
}
