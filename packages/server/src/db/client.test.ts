import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryRawMock = vi.fn();

vi.mock('@prisma/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@prisma/client')>();
  return {
    ...actual,
    PrismaClient: vi.fn().mockImplementation(() => ({
      $queryRaw: (...args: unknown[]) => queryRawMock(...args),
    })),
  };
});

const { checkDatabaseConnection } = await import('./client');

describe('checkDatabaseConnection', () => {
  beforeEach(() => {
    queryRawMock.mockReset();
  });

  it('returns ok when the health check query succeeds', async () => {
    queryRawMock.mockResolvedValue([{ '?column?': 1 }]);
    const result = await checkDatabaseConnection();
    expect(result.ok).toBe(true);
  });

  it('returns a classified err when the health check query fails', async () => {
    queryRawMock.mockRejectedValue(new Error('connection refused'));
    const result = await checkDatabaseConnection();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unknown');
  });
});
