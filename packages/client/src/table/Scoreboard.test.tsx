import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Scoreboard } from './Scoreboard';

describe('Scoreboard', () => {
  it('renders every seat with hand size, points, tichu badge, and rank', () => {
    render(
      <Scoreboard
        seatNames={['나', 'AI 1', 'AI 2', 'AI 3']}
        handSizes={[0, 5, 3, 6]}
        collectedPoints={[40, 0, 10, 0]}
        tichuCalls={[true, false, false, false]}
        largeTichuCalls={[null, null, true, null]}
        currentPlayer={1}
        viewerSeat={0}
        finishedOrder={[0]}
      />,
    );

    expect(screen.getByText('나 (나)')).toBeInTheDocument();
    expect(screen.getByText('1위')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '티츄' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '그랜드 티츄' })).toBeInTheDocument();
    expect(screen.queryByText(/누적 팀 점수/)).not.toBeInTheDocument();
  });

  it('shows cumulative team totals when provided (solo mode)', () => {
    render(
      <Scoreboard
        seatNames={['나', 'AI 1', 'AI 2', 'AI 3']}
        handSizes={[0, 0, 0, 0]}
        collectedPoints={[0, 0, 0, 0]}
        tichuCalls={[false, false, false, false]}
        largeTichuCalls={[null, null, null, null]}
        currentPlayer={0}
        viewerSeat={0}
        finishedOrder={[]}
        cumulativeScores={[300, 150]}
      />,
    );
    expect(screen.getByText(/누적 팀 점수/)).toHaveTextContent('나 & AI 2: 300점');
  });
});
