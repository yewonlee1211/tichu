import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGameSocket } from './useGameSocket';
import { FakeWebSocket, latestFakeSocket as latestSocket } from '../testUtils/FakeWebSocket';

beforeEach(() => {
  FakeWebSocket.instances = [];
  window.localStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('useGameSocket', () => {
  it('starts idle and sends JOIN_ROOM once the socket opens after joinRoom()', async () => {
    const { result } = renderHook(() => useGameSocket('ws://test'));
    expect(result.current.status).toBe('idle');

    act(() => result.current.joinRoom('', 'Alice'));
    expect(result.current.status).toBe('connecting');

    act(() => latestSocket().open());
    await waitFor(() => expect(result.current.status).toBe('open'));
    expect(latestSocket().sent).toEqual([JSON.stringify({ type: 'JOIN_ROOM', roomCode: '', playerName: 'Alice' })]);
  });

  it('stores the reconnect token and exposes roomCode/seat on ROOM_JOINED', async () => {
    const { result } = renderHook(() => useGameSocket('ws://test'));
    act(() => result.current.joinRoom('ABC123', 'Alice'));
    act(() => latestSocket().open());

    act(() => latestSocket().message({ type: 'ROOM_JOINED', roomCode: 'ABC123', seat: 1, reconnectToken: 'tok-1' }));

    await waitFor(() => expect(result.current.roomCode).toBe('ABC123'));
    expect(result.current.seat).toBe(1);
    expect(window.localStorage.getItem('tichu:reconnectToken')).toBe('tok-1');
  });

  it('exposes STATE_UPDATE as view and ERROR as error', async () => {
    const { result } = renderHook(() => useGameSocket('ws://test'));
    act(() => result.current.joinRoom('ABC123', 'Alice'));
    act(() => latestSocket().open());

    const view = { viewerSeat: 1, phase: 'PLAYING' } as never;
    act(() => latestSocket().message({ type: 'STATE_UPDATE', view }));
    await waitFor(() => expect(result.current.view).toEqual(view));

    act(() => latestSocket().message({ type: 'ERROR', message: 'room is full' }));
    await waitFor(() => expect(result.current.error).toBe('room is full'));
  });

  it('leaveRoom() clears the stored token and resets state without reconnecting', async () => {
    const { result } = renderHook(() => useGameSocket('ws://test'));
    act(() => result.current.joinRoom('ABC123', 'Alice'));
    act(() => latestSocket().open());
    act(() => latestSocket().message({ type: 'ROOM_JOINED', roomCode: 'ABC123', seat: 0, reconnectToken: 'tok-1' }));
    await waitFor(() => expect(result.current.roomCode).toBe('ABC123'));

    act(() => result.current.leaveRoom());

    expect(result.current.status).toBe('idle');
    expect(result.current.roomCode).toBeNull();
    expect(window.localStorage.getItem('tichu:reconnectToken')).toBeNull();
  });

  it('resumes automatically with RECONNECT when a token is already stored on mount', async () => {
    window.localStorage.setItem('tichu:reconnectToken', 'tok-saved');

    renderHook(() => useGameSocket('ws://test'));

    await waitFor(() => expect(FakeWebSocket.instances.length).toBe(1));
    act(() => latestSocket().open());
    expect(latestSocket().sent).toEqual([JSON.stringify({ type: 'RECONNECT', reconnectToken: 'tok-saved' })]);
  });

  it('schedules a reconnect attempt after an unexpected close while holding a token', async () => {
    vi.useFakeTimers();
    window.localStorage.setItem('tichu:reconnectToken', 'tok-saved');

    renderHook(() => useGameSocket('ws://test'));
    expect(FakeWebSocket.instances.length).toBe(1);

    act(() => latestSocket().open());
    act(() => latestSocket().close());
    expect(FakeWebSocket.instances.length).toBe(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(FakeWebSocket.instances.length).toBe(2);
  });

  it('sends game action messages once connected', async () => {
    const { result } = renderHook(() => useGameSocket('ws://test'));
    act(() => result.current.joinRoom('ABC123', 'Alice'));
    act(() => latestSocket().open());
    latestSocket().sent.length = 0;

    act(() => result.current.startGame());
    act(() => result.current.callTichu());
    act(() => result.current.decideGrandTichu(true));
    act(() => result.current.pass(2));

    expect(latestSocket().sent).toEqual([
      JSON.stringify({ type: 'START_GAME' }),
      JSON.stringify({ type: 'CALL_TICHU' }),
      JSON.stringify({ type: 'DECIDE_GRAND_TICHU', called: true }),
      JSON.stringify({ type: 'PASS', dragonRecipient: 2 }),
    ]);
  });
});
