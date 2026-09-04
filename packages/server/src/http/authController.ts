import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getSafeUserById, logIn, logOut, refreshSession, signUp, type AuthError } from '../services/authService';
import { requireAccessToken } from './authMiddleware';
import { clearAuthCookies, setAuthCookies } from './authCookies';

const signUpSchema = z.object({
  loginId: z.string().min(3).max(32),
  password: z.string().min(8).max(72),
  nickname: z.string().min(1).max(32),
});

const logInSchema = z.object({
  loginId: z.string().min(1),
  password: z.string().min(1),
});

function statusForAuthError(kind: AuthError['kind']): number {
  switch (kind) {
    case 'invalid_credentials':
    case 'invalid_refresh_token':
      return 401;
    case 'login_id_taken':
      return 409;
    case 'db_error':
      return 500;
  }
}

function respondWithAuthError(res: Response, error: AuthError): void {
  res.status(statusForAuthError(error.kind)).json({ error: error.message });
}

export const authRouter: Router = Router();

authRouter.post('/signup', async (req: Request, res: Response) => {
  const parsed = signUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '입력값을 확인해 주세요.', details: parsed.error.flatten() });
    return;
  }

  const result = await signUp(parsed.data);
  if (!result.ok) {
    respondWithAuthError(res, result.error);
    return;
  }

  setAuthCookies(res, result.value);
  res.status(201).json({ user: result.value.user });
});

authRouter.post('/login', async (req: Request, res: Response) => {
  const parsed = logInSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: '입력값을 확인해 주세요.', details: parsed.error.flatten() });
    return;
  }

  const result = await logIn(parsed.data);
  if (!result.ok) {
    respondWithAuthError(res, result.error);
    return;
  }

  setAuthCookies(res, result.value);
  res.status(200).json({ user: result.value.user });
});

authRouter.post('/refresh', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (!refreshToken) {
    res.status(401).json({ error: '인증이 필요합니다.' });
    return;
  }

  const result = await refreshSession(refreshToken);
  if (!result.ok) {
    clearAuthCookies(res);
    respondWithAuthError(res, result.error);
    return;
  }

  setAuthCookies(res, result.value);
  res.status(200).json({ user: result.value.user });
});

authRouter.post('/logout', async (req: Request, res: Response) => {
  const refreshToken = req.cookies?.refreshToken as string | undefined;
  if (refreshToken) await logOut(refreshToken);
  clearAuthCookies(res);
  res.status(200).json({ message: 'logged out' });
});

authRouter.get('/me', requireAccessToken, async (req: Request, res: Response) => {
  const result = await getSafeUserById(req.userId!);
  if (!result.ok) {
    respondWithAuthError(res, result.error);
    return;
  }
  if (result.value === null) {
    res.status(404).json({ error: '유저를 찾을 수 없습니다.' });
    return;
  }
  res.status(200).json({ user: result.value });
});
