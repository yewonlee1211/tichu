import type { Response } from 'express';

const ACCESS_TOKEN_MAX_AGE_MS = 60 * 60 * 1000;
const REFRESH_TOKEN_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000;

/** `secure` follows `NODE_ENV` rather than always being on -- the local dev
 * server runs over plain HTTP, and a `secure` cookie is silently dropped by
 * the browser there. */
function isProduction(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function setAuthCookies(res: Response, tokens: { readonly accessToken: string; readonly refreshToken: string }): void {
  res.cookie('accessToken', tokens.accessToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    maxAge: ACCESS_TOKEN_MAX_AGE_MS,
  });
  res.cookie('refreshToken', tokens.refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction(),
    maxAge: REFRESH_TOKEN_MAX_AGE_MS,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie('accessToken');
  res.clearCookie('refreshToken');
}
