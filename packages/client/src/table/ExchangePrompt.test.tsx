import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type Card, Rank, Suit } from '@tichu/shared';
import { ExchangePrompt } from './ExchangePrompt';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

describe('ExchangePrompt', () => {
  it('shows a waiting message once already submitted', () => {
    render(
      <ExchangePrompt
        hand={[]}
        seatNames={['나', 'AI 1', 'AI 2', 'AI 3']}
        viewerSeat={0}
        submitted
        busy={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByText(/제출했습니다/)).toBeInTheDocument();
  });

  it('disables submit until all three recipients have a distinct card, then submits the gifts', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const hand = [card(Rank.Three), card(Rank.Four), card(Rank.Five)];
    render(
      <ExchangePrompt hand={hand} seatNames={['나', 'AI 1', 'AI 2', 'AI 3']} viewerSeat={0} submitted={false} busy={false} onSubmit={onSubmit} />,
    );

    const submitButton = screen.getByRole('button', { name: '교환 제출' });
    expect(submitButton).toBeDisabled();

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(3);
    await user.selectOptions(selects[0]!, '3:sword');
    await user.selectOptions(selects[1]!, '4:sword');
    expect(submitButton).toBeDisabled();
    await user.selectOptions(selects[2]!, '5:sword');
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    expect(onSubmit).toHaveBeenCalledWith({
      1: card(Rank.Three),
      2: card(Rank.Four),
      3: card(Rank.Five),
    });
  });
});
