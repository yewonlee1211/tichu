import { randomUUID } from 'node:crypto';
import { type Result, err, ok } from '@tichu/shared';

export const DEFAULT_GRACE_PERIOD_MS = 60_000;

export interface PlayerSession {
  readonly reconnectToken: string;
  readonly roomCode: string;
  readonly seat: number;
  readonly connected: boolean;
}

interface SessionRegistryOptions {
  readonly gracePeriodMs?: number;
  /** Fires once a disconnected session's grace period elapses with no
   * reconnect. The caller (gameServer.ts) is responsible for actually
   * freeing the seat -- this registry only tracks token/timer bookkeeping. */
  readonly onExpire: (session: PlayerSession) => void;
}

/** Tracks reconnect tokens for live WS connections. A connection drop does
 * not immediately free its seat: `markDisconnected` starts a grace-period
 * timer, and a matching `reconnect` within that window resumes the same
 * session so the caller can resync state to the new socket. */
export class SessionRegistry {
  private readonly sessions = new Map<string, PlayerSession>();
  private readonly graceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly gracePeriodMs: number;
  private readonly onExpire: (session: PlayerSession) => void;

  constructor(options: SessionRegistryOptions) {
    this.gracePeriodMs = options.gracePeriodMs ?? DEFAULT_GRACE_PERIOD_MS;
    this.onExpire = options.onExpire;
  }

  /** Non-mutating lookup for resolving which room/seat an already-open
   * connection belongs to on every message -- unlike `reconnect()`, this
   * does not touch the grace timer or `connected` flag. */
  get(reconnectToken: string): PlayerSession | undefined {
    return this.sessions.get(reconnectToken);
  }

  register(roomCode: string, seat: number): PlayerSession {
    const session: PlayerSession = { reconnectToken: randomUUID(), roomCode, seat, connected: true };
    this.sessions.set(session.reconnectToken, session);
    return session;
  }

  markDisconnected(reconnectToken: string): void {
    const session = this.sessions.get(reconnectToken);
    if (session === undefined) return;

    this.sessions.set(reconnectToken, { ...session, connected: false });
    const timer = setTimeout(() => {
      this.graceTimers.delete(reconnectToken);
      const expired = this.sessions.get(reconnectToken);
      this.sessions.delete(reconnectToken);
      if (expired !== undefined) this.onExpire(expired);
    }, this.gracePeriodMs);
    this.graceTimers.set(reconnectToken, timer);
  }

  reconnect(reconnectToken: string): Result<PlayerSession, string> {
    const session = this.sessions.get(reconnectToken);
    if (session === undefined) {
      return err('reconnect token is unknown or its grace period has already expired');
    }

    const timer = this.graceTimers.get(reconnectToken);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.graceTimers.delete(reconnectToken);
    }
    const reconnected: PlayerSession = { ...session, connected: true };
    this.sessions.set(reconnectToken, reconnected);
    return ok(reconnected);
  }

  /** Explicit cleanup for a player who leaves on purpose, as opposed to a
   * network drop that should still go through the grace period. */
  remove(reconnectToken: string): void {
    const timer = this.graceTimers.get(reconnectToken);
    if (timer !== undefined) clearTimeout(timer);
    this.graceTimers.delete(reconnectToken);
    this.sessions.delete(reconnectToken);
  }
}
