import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RoundOverSummary } from './RoundOverSummary';

describe('RoundOverSummary', () => {
  it('offers a next-round button when the match is not over', async () => {
    const user = userEvent.setup();
    const onNextRound = vi.fn();
    render(<RoundOverSummary viewerSeat={0} onNextRound={onNextRound} matchOver={false} />);

    await user.click(screen.getByRole('button', { name: '다음 라운드' }));
    expect(onNextRound).toHaveBeenCalled();
  });

  it('shows a match-over message instead of the next-round button when the match ended', () => {
    render(<RoundOverSummary viewerSeat={0} onNextRound={vi.fn()} matchOver />);
    expect(screen.getByText('매치가 종료되었습니다.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '다음 라운드' })).not.toBeInTheDocument();
  });

  it('omits the next-round button entirely when no handler is given (multiplayer)', () => {
    render(<RoundOverSummary viewerSeat={0} />);
    expect(screen.queryByRole('button', { name: '다음 라운드' })).not.toBeInTheDocument();
  });

  it('shows the score history and running total instead of a per-player table', () => {
    render(
      <RoundOverSummary
        viewerSeat={0}
        cumulativeScores={[65, 135]}
        roundHistory={[
          [40, 60],
          [25, 75],
        ]}
        onNextRound={vi.fn()}
        matchOver={false}
      />,
    );

    expect(screen.getByText(/1라운드/)).toHaveTextContent('우리 팀 40점 · 상대 팀 60점');
    expect(screen.getByText(/2라운드/)).toHaveTextContent('우리 팀 25점 · 상대 팀 75점');
    expect(screen.getByText(/총합/)).toHaveTextContent('우리 팀 65점 · 상대 팀 135점');
  });
});
