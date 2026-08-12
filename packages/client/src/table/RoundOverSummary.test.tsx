import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoundOverSummary } from './RoundOverSummary';

const baseProps = {
  seatNames: ['나', 'AI 1', 'AI 2', 'AI 3'],
  handSizes: [0, 0, 0, 0],
  collectedPoints: [50, 30, 20, 0],
  tichuCalls: [false, false, false, false],
  largeTichuCalls: [null, null, null, null] as (boolean | null)[],
  currentPlayer: 0,
  viewerSeat: 0,
  finishedOrder: [0, 2, 1, 3],
};

describe('RoundOverSummary', () => {
  it('offers a next-round button when the match is not over', async () => {
    const user = userEvent.setup();
    const onNextRound = vi.fn();
    render(<RoundOverSummary {...baseProps} onNextRound={onNextRound} matchOver={false} />);

    await user.click(screen.getByRole('button', { name: '다음 라운드' }));
    expect(onNextRound).toHaveBeenCalled();
  });

  it('shows a match-over message instead of the next-round button when the match ended', () => {
    render(<RoundOverSummary {...baseProps} onNextRound={vi.fn()} matchOver />);
    expect(screen.getByText('매치가 종료되었습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다음 라운드' })).not.toBeInTheDocument();
  });

  it('omits the next-round button entirely when no handler is given (multiplayer)', () => {
    render(<RoundOverSummary {...baseProps} />);
    expect(screen.queryByRole('button', { name: '다음 라운드' })).not.toBeInTheDocument();
  });
});
