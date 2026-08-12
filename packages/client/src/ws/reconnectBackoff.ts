/** The server holds a disconnected session open for 60s
 * (`DEFAULT_GRACE_PERIOD_MS` in `packages/server/src/session.ts`) before
 * freeing the seat. Backoff is capped well under that so a client that lost
 * its connection gets several attempts inside the grace window. */
export const MAX_RECONNECT_ATTEMPTS = 5;
const BASE_DELAY_MS = 1000;
const MAX_DELAY_MS = 8000;

export function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
}
