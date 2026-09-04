import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';

process.env.JWT_SECRET = 'test-secret';
const { createAccessToken } = await import('../services/jwt');
const { requireAccessToken } = await import('./authMiddleware');

function mockRes(): Response {
  const res: Partial<Response> = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  return res as Response;
}

describe('requireAccessToken', () => {
  let next: NextFunction;

  beforeEach(() => {
    next = vi.fn();
  });

  it('sets req.userId and calls next() for a valid token', () => {
    const token = createAccessToken('u1');
    const req = { cookies: { accessToken: token } } as unknown as Request;
    const res = mockRes();

    requireAccessToken(req, res, next);

    expect(req.userId).toBe('u1');
    expect(next).toHaveBeenCalled();
  });

  it('401s without calling next() when there is no accessToken cookie', () => {
    const req = { cookies: {} } as unknown as Request;
    const res = mockRes();

    requireAccessToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('401s for a malformed token', () => {
    const req = { cookies: { accessToken: 'garbage' } } as unknown as Request;
    const res = mockRes();

    requireAccessToken(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
