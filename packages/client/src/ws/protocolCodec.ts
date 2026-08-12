import type { ServerMessage } from '@tichu/shared';

/** Parses and structurally validates a raw WS text frame as a `ServerMessage`.
 * The server is a trusted first-party process, but the frame still crosses a
 * network boundary -- a malformed or unexpected payload should surface as
 * `null` (dropped by the caller) rather than throw and tear down the socket
 * handler. */
export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null || !('type' in parsed)) {
    return null;
  }

  const type = (parsed as { type: unknown }).type;
  if (type === 'ROOM_JOINED' || type === 'STATE_UPDATE' || type === 'ERROR') {
    return parsed as ServerMessage;
  }
  return null;
}
