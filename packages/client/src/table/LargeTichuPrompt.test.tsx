import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Rank, Suit } from '@tichu/shared';
import { LargeTichuPrompt } from './LargeTichuPrompt';

describe('LargeTichuPrompt', () => {
  it('lets the viewer decide when they have not yet, and reports the choice', async () => {
    const user = userEvent.setup();
    const onDecide = vi.fn();
    render(
      <LargeTichuPrompt
        hand={[{ rank: Rank.King, suit: Suit.Sword }]}
        seatNames={['나', 'AI 1', 'AI 2', 'AI 3']}
        largeTichuCalls={[null, null, false, null]}
        viewerSeat={0}
        busy={false}
        onDecide={onDecide}
      />,
    );

    await user.click(screen.getByRole('button', { name: '그랜드 티츄 선언' }));
    expect(onDecide).toHaveBeenCalledWith(true);
    expect(screen.getByText(/AI 2: 선언 안 함/)).toBeInTheDocument();
  });

  it('shows a waiting message once the viewer has already decided', () => {
    render(
      <LargeTichuPrompt
        hand={[]}
        seatNames={['나', 'AI 1', 'AI 2', 'AI 3']}
        largeTichuCalls={[true, null, null, null]}
        viewerSeat={0}
        busy={false}
        onDecide={vi.fn()}
      />,
    );

    expect(screen.getByText(/결정을 완료했습니다/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '그랜드 티츄 선언' })).not.toBeInTheDocument();
  });
});
