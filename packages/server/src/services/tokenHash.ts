import { createHash } from 'node:crypto';

/** Mirrors `passwordHash`: the raw JWT string is never persisted, only this
 * hash, so a DB leak alone doesn't hand out working refresh tokens. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
