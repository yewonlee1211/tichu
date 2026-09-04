import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { withDb } from './errors';

describe('withDb', () => {
  it('returns ok with the resolved value on success', async () => {
    const result = await withDb(async () => 42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('classifies a PrismaClientInitializationError as connection', async () => {
    const cause = new Prisma.PrismaClientInitializationError('cannot reach database server', '6.19.3');
    const result = await withDb(async () => {
      throw cause;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'connection', message: cause.message, cause });
  });

  it('classifies a P2025 known request error as not_found', async () => {
    const cause = new Prisma.PrismaClientKnownRequestError('record not found', { code: 'P2025', clientVersion: '6.19.3' });
    const result = await withDb(async () => {
      throw cause;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('not_found');
  });

  it('classifies a P2002 known request error as conflict', async () => {
    const cause = new Prisma.PrismaClientKnownRequestError('unique constraint failed', { code: 'P2002', clientVersion: '6.19.3' });
    const result = await withDb(async () => {
      throw cause;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('conflict');
  });

  it('classifies an unrecognized known request error code as unknown', async () => {
    const cause = new Prisma.PrismaClientKnownRequestError('some other failure', { code: 'P2003', clientVersion: '6.19.3' });
    const result = await withDb(async () => {
      throw cause;
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('unknown');
  });

  it('classifies a plain Error as unknown', async () => {
    const result = await withDb(async () => {
      throw new Error('boom');
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'unknown', message: 'boom', cause: expect.any(Error) });
  });

  it('classifies a non-Error thrown value as unknown with a stringified message', async () => {
    const result = await withDb(async () => {
      throw 'plain string throw';
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toEqual({ kind: 'unknown', message: 'plain string throw', cause: 'plain string throw' });
  });
});
