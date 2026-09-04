import { PrismaClient } from '@prisma/client';
import { type Result } from '@tichu/shared';
import { withDb, type DbError } from './errors';

/** Singleton -- every module that needs DB access imports this instead of
 * constructing its own PrismaClient, so connections don't multiply across
 * modules (and across tsx watch reloads in dev). */
export const prisma = new PrismaClient();

/** Called once at server startup (see index.ts) so a broken DB connection
 * fails the process immediately with a clear message, instead of surfacing
 * later as an opaque error the first time a repository call needs it. */
export async function checkDatabaseConnection(): Promise<Result<void, DbError>> {
  return withDb(async () => {
    await prisma.$queryRaw`SELECT 1`;
  });
}
