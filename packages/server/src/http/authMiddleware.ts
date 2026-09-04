import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '../services/jwt';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

/** Requires a valid `accessToken` cookie; sets `req.userId` and calls
 * `next()` on success, or responds 401 without calling `next()`. */
export function requireAccessToken(req: Request, res: Response, next: NextFunction): void {
  const payload = verifyToken(req.cookies?.accessToken);
  if (payload === null) {
    res.status(401).json({ error: '인증이 필요합니다.' });
    return;
  }
  req.userId = payload.userId;
  next();
}
