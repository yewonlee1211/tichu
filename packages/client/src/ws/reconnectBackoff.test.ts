import { describe, expect, it } from 'vitest';
import { backoffDelayMs, MAX_RECONNECT_ATTEMPTS } from './reconnectBackoff';

describe('backoffDelayMs', () => {
  it('doubles per attempt starting at 1000ms', () => {
    expect(backoffDelayMs(0)).toBe(1000);
    expect(backoffDelayMs(1)).toBe(2000);
    expect(backoffDelayMs(2)).toBe(4000);
  });

  it('caps at 8000ms', () => {
    expect(backoffDelayMs(3)).toBe(8000);
    expect(backoffDelayMs(10)).toBe(8000);
  });

  it('keeps the full retry budget under the 60s server grace period', () => {
    let total = 0;
    for (let attempt = 0; attempt < MAX_RECONNECT_ATTEMPTS; attempt += 1) {
      total += backoffDelayMs(attempt);
    }
    expect(total).toBeLessThan(60_000);
  });
});
