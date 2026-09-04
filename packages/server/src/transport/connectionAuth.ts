import type { IncomingMessage } from 'node:http';
import { verifyToken } from '../services/jwt';

function extractCookie(header: string | undefined, name: string): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(';')) {
    const separatorIndex = part.indexOf('=');
    if (separatorIndex === -1) continue;
    const key = part.slice(0, separatorIndex).trim();
    if (key !== name) continue;
    return decodeURIComponent(part.slice(separatorIndex + 1).trim());
  }
  return undefined;
}

/** Identifies the account behind a WS upgrade request, if any -- the WS
 * upgrade is a normal same-origin HTTP request now that it shares an
 * `http.Server` with the Express auth API (see `GameServerOptions.server`),
 * so the browser attaches the `accessToken` cookie automatically, same as
 * any REST call. Returns `null` (never throws) for a missing/invalid/expired
 * token: an unauthenticated connection is still allowed to join with a
 * client-supplied name (see `gameServer.ts`'s `handleJoinRoom`) -- login is
 * not yet enforced client-side, so this only identifies who's on the other
 * end when it can. */
export function resolveUpgradeUserId(req: IncomingMessage): string | null {
  const token = extractCookie(req.headers.cookie, 'accessToken');
  if (token === undefined) return null;
  return verifyToken(token)?.userId ?? null;
}
