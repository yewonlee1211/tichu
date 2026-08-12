import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionRegistry } from './session';

const GRACE_PERIOD_MS = 60_000;

describe('SessionRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('issues a reconnect token that can be used to reconnect immediately', () => {
    const onExpire = vi.fn();
    const registry = new SessionRegistry({ gracePeriodMs: GRACE_PERIOD_MS, onExpire });

    const session = registry.register('ABCDEF', 2);
    const result = registry.reconnect(session.reconnectToken);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value).toEqual({ reconnectToken: session.reconnectToken, roomCode: 'ABCDEF', seat: 2, connected: true });
  });

  it('preserves the seat and resyncs on reconnect within the grace period', () => {
    const onExpire = vi.fn();
    const registry = new SessionRegistry({ gracePeriodMs: GRACE_PERIOD_MS, onExpire });
    const session = registry.register('ABCDEF', 1);

    registry.markDisconnected(session.reconnectToken);
    vi.advanceTimersByTime(GRACE_PERIOD_MS - 1);
    const result = registry.reconnect(session.reconnectToken);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('unreachable');
    expect(result.value.connected).toBe(true);
    expect(result.value.roomCode).toBe('ABCDEF');
    expect(result.value.seat).toBe(1);

    // Reconnecting must cancel the pending expiry -- letting the clock run
    // the rest of the way out should not fire onExpire retroactively.
    vi.advanceTimersByTime(GRACE_PERIOD_MS);
    expect(onExpire).not.toHaveBeenCalled();
  });

  it('expires the session and frees the seat once the grace period elapses without a reconnect', () => {
    const onExpire = vi.fn();
    const registry = new SessionRegistry({ gracePeriodMs: GRACE_PERIOD_MS, onExpire });
    const session = registry.register('ABCDEF', 3);

    registry.markDisconnected(session.reconnectToken);
    vi.advanceTimersByTime(GRACE_PERIOD_MS);

    expect(onExpire).toHaveBeenCalledTimes(1);
    expect(onExpire).toHaveBeenCalledWith(expect.objectContaining({ roomCode: 'ABCDEF', seat: 3 }));

    const lateReconnect = registry.reconnect(session.reconnectToken);
    expect(lateReconnect.ok).toBe(false);
  });

  it('rejects reconnect with an unknown token', () => {
    const registry = new SessionRegistry({ gracePeriodMs: GRACE_PERIOD_MS, onExpire: vi.fn() });

    const result = registry.reconnect('not-a-real-token');

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('unreachable');
    expect(result.error).toMatch(/unknown/);
  });

  it('markDisconnected() is a no-op for an unknown token', () => {
    const onExpire = vi.fn();
    const registry = new SessionRegistry({ gracePeriodMs: GRACE_PERIOD_MS, onExpire });

    registry.markDisconnected('not-a-real-token');
    vi.advanceTimersByTime(GRACE_PERIOD_MS);

    expect(onExpire).not.toHaveBeenCalled();
  });

  it('remove() cancels the grace timer so onExpire never fires for an intentional leave', () => {
    const onExpire = vi.fn();
    const registry = new SessionRegistry({ gracePeriodMs: GRACE_PERIOD_MS, onExpire });
    const session = registry.register('ABCDEF', 0);

    registry.markDisconnected(session.reconnectToken);
    registry.remove(session.reconnectToken);
    vi.advanceTimersByTime(GRACE_PERIOD_MS);

    expect(onExpire).not.toHaveBeenCalled();
  });
});
