import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { JoinRoomForm } from './JoinRoomForm';

describe('JoinRoomForm', () => {
  it('creates a room (empty code) when the room code field is left blank', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    render(<JoinRoomForm busy={false} errorMessage={null} onJoin={onJoin} />);

    await user.type(screen.getByLabelText('이름'), 'Alice');
    expect(screen.getByRole('button', { name: '방 만들기' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '방 만들기' }));

    expect(onJoin).toHaveBeenCalledWith('', 'Alice');
  });

  it('joins an existing room, uppercasing the code', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    render(<JoinRoomForm busy={false} errorMessage={null} onJoin={onJoin} />);

    await user.type(screen.getByLabelText('이름'), 'Bob');
    await user.type(screen.getByLabelText(/방 코드/), 'ab12cd');
    await user.click(screen.getByRole('button', { name: '방 입장' }));

    expect(onJoin).toHaveBeenCalledWith('AB12CD', 'Bob');
  });

  it('disables submit until a name is entered, and shows server errors', () => {
    render(<JoinRoomForm busy={false} errorMessage="room ABC123 does not exist" onJoin={vi.fn()} />);
    expect(screen.getByRole('button', { name: '방 만들기' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('room ABC123 does not exist');
  });
});
