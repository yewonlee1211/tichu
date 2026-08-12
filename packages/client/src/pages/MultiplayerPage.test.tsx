import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Phase } from '@tichu/shared';
import { MultiplayerPage } from './MultiplayerPage';
import { FakeWebSocket, latestFakeSocket } from '../testUtils/FakeWebSocket';

beforeEach(() => {
  FakeWebSocket.instances = [];
  window.localStorage.clear();
  vi.stubGlobal('WebSocket', FakeWebSocket as unknown as typeof WebSocket);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MultiplayerPage', () => {
  it('walks from the join form through the waiting room to a live game table', async () => {
    const user = userEvent.setup();
    render(<MultiplayerPage wsUrl="ws://test" onExit={vi.fn()} />);

    await user.type(screen.getByLabelText('이름'), 'Alice');
    await user.click(screen.getByRole('button', { name: '방 만들기' }));
    latestFakeSocket().open();
    latestFakeSocket().message({ type: 'ROOM_JOINED', roomCode: 'AB12CD', seat: 0, reconnectToken: 'tok' });

    await waitFor(() => expect(screen.getByText('대기실')).toBeInTheDocument());
    expect(screen.getByText('AB12CD')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '게임 시작' }));
    expect(latestFakeSocket().sent).toContain(JSON.stringify({ type: 'START_GAME' }));

    latestFakeSocket().message({
      type: 'STATE_UPDATE',
      view: {
        viewerSeat: 0,
        hand: [],
        handSizes: [14, 14, 14, 14],
        trickCards: [],
        collectedPoints: [0, 0, 0, 0],
        phase: Phase.LargeTichu,
        currentPlayer: 0,
        trickLeader: 0,
        currentBest: null,
        currentStrength: 0,
        lastPlayerToAct: null,
        finishedOrder: [],
        tichuCalls: [false, false, false, false],
        largeTichuCalls: [null, null, null, null],
        mahjongWish: null,
      },
    });

    await waitFor(() => expect(screen.getByText('그랜드 티츄')).toBeInTheDocument());
  });

  it('leaves the room and calls onExit', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<MultiplayerPage wsUrl="ws://test" onExit={onExit} />);

    await user.type(screen.getByLabelText('이름'), 'Alice');
    await user.click(screen.getByRole('button', { name: '방 만들기' }));
    latestFakeSocket().open();
    latestFakeSocket().message({ type: 'ROOM_JOINED', roomCode: 'AB12CD', seat: 0, reconnectToken: 'tok' });
    await waitFor(() => expect(screen.getByText('대기실')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '나가기' }));
    expect(onExit).toHaveBeenCalled();
    expect(window.localStorage.getItem('tichu:reconnectToken')).toBeNull();
  });

  it('surfaces a join error from the server', async () => {
    const user = userEvent.setup();
    render(<MultiplayerPage wsUrl="ws://test" onExit={vi.fn()} />);

    await user.type(screen.getByLabelText('이름'), 'Alice');
    await user.type(screen.getByLabelText(/방 코드/), 'ZZZZZZ');
    await user.click(screen.getByRole('button', { name: '방 입장' }));
    latestFakeSocket().open();
    latestFakeSocket().message({ type: 'ERROR', message: 'room ZZZZZZ does not exist' });

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('room ZZZZZZ does not exist'));
  });
});
