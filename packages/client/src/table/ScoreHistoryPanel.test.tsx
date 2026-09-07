import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ScoreHistoryPanel } from './ScoreHistoryPanel';

describe('ScoreHistoryPanel', () => {
  it('lists each completed round from the viewer\'s own team perspective, ending with the running total', () => {
    render(
      <ScoreHistoryPanel
        viewerSeat={0}
        cumulativeScores={[65, 135]}
        roundHistory={[
          [40, 60],
          [25, 75],
        ]}
      />,
    );

    expect(screen.getByText(/1라운드/)).toHaveTextContent('우리 팀 40점 · 상대 팀 60점');
    expect(screen.getByText(/2라운드/)).toHaveTextContent('우리 팀 25점 · 상대 팀 75점');
    expect(screen.getByText(/총합/)).toHaveTextContent('우리 팀 65점 · 상대 팀 135점');
  });

  it('flips which cumulative index is "우리 팀" based on the viewer\'s own seat', () => {
    // Seat 1 is on team index 1 -- "우리 팀" must read from cumulativeScores[1].
    render(<ScoreHistoryPanel viewerSeat={1} cumulativeScores={[65, 135]} roundHistory={[[40, 60]]} />);

    expect(screen.getByText(/1라운드/)).toHaveTextContent('우리 팀 60점 · 상대 팀 40점');
    expect(screen.getByText(/총합/)).toHaveTextContent('우리 팀 135점 · 상대 팀 65점');
  });

  it('shows an empty-state message when there is no round history yet', () => {
    render(<ScoreHistoryPanel viewerSeat={0} cumulativeScores={[0, 0]} roundHistory={[]} />);
    expect(screen.getByText('아직 종료된 라운드가 없습니다.')).toBeInTheDocument();
  });

  it('omits the round list (but still shows the empty state) when roundHistory is unavailable, e.g. multiplayer', () => {
    render(<ScoreHistoryPanel viewerSeat={0} cumulativeScores={[10, 20]} />);
    expect(screen.getByText('아직 종료된 라운드가 없습니다.')).toBeInTheDocument();
    expect(screen.getByText(/총합/)).toHaveTextContent('우리 팀 10점 · 상대 팀 20점');
  });

  it('omits the total line when cumulativeScores is unavailable', () => {
    render(<ScoreHistoryPanel viewerSeat={0} roundHistory={[[10, 20]]} />);
    expect(screen.queryByText(/총합/)).not.toBeInTheDocument();
  });
});
