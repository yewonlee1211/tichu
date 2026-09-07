import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ScoreBar } from './ScoreBar';

describe('ScoreBar', () => {
  it('shows the running team score from the viewer\'s own perspective', () => {
    render(<ScoreBar viewerSeat={0} cumulativeScores={[65, 135]} roundHistory={[]} />);
    expect(screen.getByText('점수: 우리 팀 65 vs 상대 팀 135')).toBeInTheDocument();
  });

  it('treats a missing cumulativeScores as 0-0 rather than crashing (e.g. before the first STATE_UPDATE)', () => {
    render(<ScoreBar viewerSeat={0} roundHistory={[]} />);
    expect(screen.getByText('점수: 우리 팀 0 vs 상대 팀 0')).toBeInTheDocument();
  });

  it('opens the score history popup on click, and closes it again', async () => {
    const user = userEvent.setup();
    render(<ScoreBar viewerSeat={0} cumulativeScores={[40, 60]} roundHistory={[[40, 60]]} />);

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '점수 내역 확인하기' }));
    const dialog = screen.getByRole('dialog', { name: '점수 내역' });
    expect(dialog).toHaveTextContent('1라운드 — 우리 팀 40점 · 상대 팀 60점');

    await user.click(screen.getByRole('button', { name: '닫기' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('omits the history button entirely when roundHistory is unavailable (multiplayer, for now)', () => {
    render(<ScoreBar viewerSeat={0} cumulativeScores={[0, 0]} />);
    expect(screen.queryByRole('button', { name: '점수 내역 확인하기' })).not.toBeInTheDocument();
  });
});
