import jwt from 'jsonwebtoken';

const ACCESS_TOKEN_TTL = '1h';
const REFRESH_TOKEN_TTL = '2w';
const REFRESH_TOKEN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not configured');
  return secret;
}

export interface AccessTokenPayload {
  readonly userId: string;
}

export function createAccessToken(userId: string): string {
  return jwt.sign({ userId } satisfies AccessTokenPayload, requireJwtSecret(), { expiresIn: ACCESS_TOKEN_TTL });
}

/** Refresh tokens are JWTs too (same payload shape as the access token, just
 * a longer TTL) -- `expiresAt` mirrors the token's own `exp` claim so
 * `RefreshToken` rows can be queried for expiry without decoding every
 * token (see `schema.prisma`'s comment on `RefreshToken.expiresAt`). The
 * caller is responsible for hashing `token` before persisting it. */
export function createRefreshToken(userId: string): { readonly token: string; readonly expiresAt: Date } {
  const token = jwt.sign({ userId } satisfies AccessTokenPayload, requireJwtSecret(), { expiresIn: REFRESH_TOKEN_TTL });
  return { token, expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_MS) };
}

/** Verifies and decodes an access or refresh token (both share the same
 * `{ userId }` payload shape) -- returns `null` for anything
 * invalid/expired/malformed, so callers treat all of those as "not
 * authenticated" rather than needing to distinguish the reason. */
export function verifyToken(token: string): AccessTokenPayload | null {
  try {
    const decoded = jwt.verify(token, requireJwtSecret());
    if (typeof decoded === 'string' || typeof decoded.userId !== 'string') return null;
    return { userId: decoded.userId };
  } catch {
    return null;
  }
}
