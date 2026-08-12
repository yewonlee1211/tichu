import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WaitingRoom } from './WaitingRoom';

describe('WaitingRoom', () => {
  it('lets seat 0 (the host) start the game', async () => {
    const user = userEvent.setup();
    const onStartGame = vi.fn();
    render(<WaitingRoom roomCode="AB12CD" seat={0} errorMessage={null} onStartGame={onStartGame} onLeaveRoom={vi.fn()} />);

    expect(screen.getByText('AB12CD')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '게임 시작' }));
    expect(onStartGame).toHaveBeenCalled();
  });

  it('does not offer a start button to non-host seats', () => {
    render(<WaitingRoom roomCode="AB12CD" seat={2} errorMessage={null} onStartGame={vi.fn()} onLeaveRoom={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '게임 시작' })).not.toBeInTheDocument();
    expect(screen.getByText(/방장\(0번 좌석\)만/)).toBeInTheDocument();
  });

  it('surfaces a server error (e.g. starting before the room is full)', () => {
    render(
      <WaitingRoom roomCode="AB12CD" seat={0} errorMessage="room is not full yet" onStartGame={vi.fn()} onLeaveRoom={vi.fn()} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('room is not full yet');
  });

  it('calls onLeaveRoom when leaving', async () => {
    const user = userEvent.setup();
    const onLeaveRoom = vi.fn();
    render(<WaitingRoom roomCode="AB12CD" seat={1} errorMessage={null} onStartGame={vi.fn()} onLeaveRoom={onLeaveRoom} />);
    await user.click(screen.getByRole('button', { name: '나가기' }));
    expect(onLeaveRoom).toHaveBeenCalled();
  });
});
