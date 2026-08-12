import { useCallback, useEffect, useRef, useState } from 'react';
import type { Card, ClientMessage, PlayerView, Rank } from '@tichu/shared';
import { parseServerMessage } from './protocolCodec';
import { backoffDelayMs, MAX_RECONNECT_ATTEMPTS } from './reconnectBackoff';

const RECONNECT_TOKEN_KEY = 'tichu:reconnectToken';
/** `VITE_WS_URL` overrides this for local dev (see `vite-env.d.ts`) -- the
 * server's default port (8080) sits inside Windows' Hyper-V/WSL-reserved
 * range on some machines, so a fixed default alone isn't always usable. */
const DEFAULT_WS_URL = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080';

export type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed';

export interface GameSocketState {
  readonly status: ConnectionStatus;
  readonly roomCode: string | null;
  readonly seat: number | null;
  readonly view: PlayerView | null;
  readonly error: string | null;
}

export interface GameSocketActions {
  readonly joinRoom: (roomCode: string, playerName: string) => void;
  readonly startGame: () => void;
  readonly callTichu: () => void;
  readonly decideGrandTichu: (called: boolean) => void;
  readonly exchangeCards: (gifts: Readonly<Record<number, Card>>) => void;
  readonly playCards: (cards: readonly Card[], wish?: Rank, dragonRecipient?: number) => void;
  readonly pass: (dragonRecipient?: number) => void;
  readonly leaveRoom: () => void;
}

function readStoredReconnectToken(): string | null {
  try {
    return window.localStorage.getItem(RECONNECT_TOKEN_KEY);
  } catch {
    return null;
  }
}

function storeReconnectToken(token: string): void {
  try {
    window.localStorage.setItem(RECONNECT_TOKEN_KEY, token);
  } catch {
    // Storage may be unavailable (private browsing); reconnect-on-reload is
    // best-effort, not a correctness requirement.
  }
}

function clearStoredReconnectToken(): void {
  try {
    window.localStorage.removeItem(RECONNECT_TOKEN_KEY);
  } catch {
    // See storeReconnectToken.
  }
}

/** Human-vs-human WS connection: join/create a room, send game actions, and
 * transparently resume a dropped connection with the token the server
 * handed back in `ROOM_JOINED` (see `packages/server/src/session.ts` --
 * reconnecting within its 60s grace period keeps the same seat). */
export function useGameSocket(url: string = DEFAULT_WS_URL): GameSocketState & GameSocketActions {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [seat, setSeat] = useState<number | null>(null);
  const [view, setView] = useState<PlayerView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTokenRef = useRef<string | null>(readStoredReconnectToken());
  const pendingJoinRef = useRef<{ roomCode: string; playerName: string } | null>(null);
  const intentionalCloseRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Always points at the latest `openSocket` closure so the retry timer
   * below can call it without naming it directly inside its own body --
   * referencing a `useCallback` result recursively from within itself is
   * flagged by `react-hooks/immutability` as a stale/inconsistent-identity
   * risk under the React Compiler. Kept in sync by the effect further down. */
  const openSocketRef = useRef<() => void>(() => {});

  const clearRetryTimer = useCallback(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
  }, []);

  const send = useCallback((message: ClientMessage) => {
    const ws = wsRef.current;
    if (ws !== null && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }, []);

  const openSocket = useCallback(() => {
    intentionalCloseRef.current = false;
    setStatus('connecting');
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.addEventListener('open', () => {
      retryCountRef.current = 0;
      setStatus('open');
      setError(null);
      const pendingJoin = pendingJoinRef.current;
      if (pendingJoin !== null) {
        ws.send(JSON.stringify({ type: 'JOIN_ROOM', ...pendingJoin } satisfies ClientMessage));
        pendingJoinRef.current = null;
      } else if (reconnectTokenRef.current !== null) {
        ws.send(
          JSON.stringify({ type: 'RECONNECT', reconnectToken: reconnectTokenRef.current } satisfies ClientMessage),
        );
      }
    });

    ws.addEventListener('message', (event: MessageEvent<string>) => {
      const message = parseServerMessage(event.data);
      if (message === null) return;

      if (message.type === 'ROOM_JOINED') {
        setRoomCode(message.roomCode);
        setSeat(message.seat);
        setError(null);
        reconnectTokenRef.current = message.reconnectToken;
        storeReconnectToken(message.reconnectToken);
      } else if (message.type === 'STATE_UPDATE') {
        setView(message.view);
      } else {
        setError(message.message);
      }
    });

    ws.addEventListener('close', () => {
      setStatus('closed');
      wsRef.current = null;
      if (intentionalCloseRef.current) return;
      if (reconnectTokenRef.current === null) return;
      if (retryCountRef.current >= MAX_RECONNECT_ATTEMPTS) return;

      const delay = backoffDelayMs(retryCountRef.current);
      retryCountRef.current += 1;
      retryTimerRef.current = setTimeout(() => openSocketRef.current(), delay);
    });
  }, [url]);

  useEffect(() => {
    openSocketRef.current = openSocket;
  });

  useEffect(() => {
    if (reconnectTokenRef.current !== null) {
      openSocket();
    }
    return () => {
      intentionalCloseRef.current = true;
      clearRetryTimer();
      wsRef.current?.close();
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on mount to resume a prior session; joinRoom() drives fresh connections explicitly.
  }, []);

  const joinRoom = useCallback(
    (roomCodeToJoin: string, playerName: string) => {
      clearRetryTimer();
      retryCountRef.current = 0;
      pendingJoinRef.current = { roomCode: roomCodeToJoin, playerName };
      if (wsRef.current !== null) {
        wsRef.current.close();
      }
      openSocket();
    },
    [clearRetryTimer, openSocket],
  );

  const leaveRoom = useCallback(() => {
    intentionalCloseRef.current = true;
    clearRetryTimer();
    wsRef.current?.close();
    wsRef.current = null;
    reconnectTokenRef.current = null;
    clearStoredReconnectToken();
    setStatus('idle');
    setRoomCode(null);
    setSeat(null);
    setView(null);
    setError(null);
  }, [clearRetryTimer]);

  const startGame = useCallback(() => send({ type: 'START_GAME' }), [send]);
  const callTichu = useCallback(() => send({ type: 'CALL_TICHU' }), [send]);
  const decideGrandTichu = useCallback((called: boolean) => send({ type: 'DECIDE_GRAND_TICHU', called }), [send]);
  const exchangeCards = useCallback(
    (gifts: Readonly<Record<number, Card>>) => send({ type: 'EXCHANGE_CARDS', gifts }),
    [send],
  );
  const playCards = useCallback(
    (cards: readonly Card[], wish?: Rank, dragonRecipient?: number) =>
      send({ type: 'PLAY_CARDS', cards, wish, dragonRecipient }),
    [send],
  );
  const pass = useCallback((dragonRecipient?: number) => send({ type: 'PASS', dragonRecipient }), [send]);

  return {
    status,
    roomCode,
    seat,
    view,
    error,
    joinRoom,
    startGame,
    callTichu,
    decideGrandTichu,
    exchangeCards,
    playCards,
    pass,
    leaveRoom,
  };
}
