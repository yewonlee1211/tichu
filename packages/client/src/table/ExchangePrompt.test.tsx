import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type Card, Rank, Suit } from '@tichu/shared';
import { ExchangePrompt } from './ExchangePrompt';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

const seatNames = ['나', 'AI 1', 'AI 2', 'AI 3'];

describe('ExchangePrompt', () => {
  it('shows a waiting message and the hand once already submitted', () => {
    const hand = [card(Rank.Three)];
    render(<ExchangePrompt hand={hand} seatNames={seatNames} viewerSeat={0} submitted busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByText(/제출했습니다/)).toBeInTheDocument();
    expect(screen.getByText('3⚔')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '3⚔' })).not.toBeInTheDocument();
  });

  it('shows the full hand as clickable cards before submission', () => {
    const hand = [card(Rank.Three), card(Rank.Four), card(Rank.Five)];
    render(<ExchangePrompt hand={hand} seatNames={seatNames} viewerSeat={0} submitted={false} busy={false} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: '3⚔' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '4⚔' })).toBeEnabled();
    expect(screen.getByRole('button', { name: '5⚔' })).toBeEnabled();
  });

  it('clicking a card opens a picker of recipient names (reverse seat order); picking one assigns the card', async () => {
    const user = userEvent.setup();
    const hand = [card(Rank.Three)];
    render(<ExchangePrompt hand={hand} seatNames={seatNames} viewerSeat={0} submitted={false} busy={false} onSubmit={vi.fn()} />);

    expect(screen.queryByRole('group')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '3⚔' }));

    const picker = screen.getByRole('group');
    const optionNames = within(picker)
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(optionNames).toEqual(['AI 3', 'AI 2', 'AI 1']);

    await user.click(screen.getByRole('button', { name: 'AI 2' }));
    expect(screen.getByText('→ AI 2')).toBeInTheDocument();
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('hides a recipient from every other card once they already have one, until that card cancels them', async () => {
    const user = userEvent.setup();
    const hand = [card(Rank.Three), card(Rank.Four)];
    render(<ExchangePrompt hand={hand} seatNames={seatNames} viewerSeat={0} submitted={false} busy={false} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '3⚔' }));
    await user.click(screen.getByRole('button', { name: 'AI 1' }));
    expect(screen.getByText('→ AI 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '4⚔' }));
    expect(screen.queryByRole('button', { name: 'AI 1' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI 2' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '3⚔' }));
    await user.click(screen.getByRole('button', { name: 'AI 1 (배정 취소)' }));
    expect(screen.queryByText('→ AI 1')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '4⚔' }));
    expect(screen.getByRole('button', { name: 'AI 1' })).toBeInTheDocument();
  });

  it('reassigning the same card to a different recipient moves it, without duplicating the old recipient', async () => {
    const user = userEvent.setup();
    const hand = [card(Rank.Three)];
    render(<ExchangePrompt hand={hand} seatNames={seatNames} viewerSeat={0} submitted={false} busy={false} onSubmit={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '3⚔' }));
    await user.click(screen.getByRole('button', { name: 'AI 1' }));
    expect(screen.getByText('→ AI 1')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '3⚔' }));
    await user.click(screen.getByRole('button', { name: 'AI 2' }));
    expect(screen.queryByText('→ AI 1')).not.toBeInTheDocument();
    expect(screen.getByText('→ AI 2')).toBeInTheDocument();
  });

  it('disables submit until all three recipients have a distinct card, then submits the gifts', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    const hand = [card(Rank.Three), card(Rank.Four), card(Rank.Five)];
    render(<ExchangePrompt hand={hand} seatNames={seatNames} viewerSeat={0} submitted={false} busy={false} onSubmit={onSubmit} />);

    const submitButton = screen.getByRole('button', { name: '교환 제출' });
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '3⚔' }));
    await user.click(screen.getByRole('button', { name: 'AI 1' }));
    await user.click(screen.getByRole('button', { name: '4⚔' }));
    await user.click(screen.getByRole('button', { name: 'AI 2' }));
    expect(submitButton).toBeDisabled();

    await user.click(screen.getByRole('button', { name: '5⚔' }));
    await user.click(screen.getByRole('button', { name: 'AI 3' }));
    expect(submitButton).toBeEnabled();

    await user.click(submitButton);
    expect(onSubmit).toHaveBeenCalledWith({
      1: card(Rank.Three),
      2: card(Rank.Four),
      3: card(Rank.Five),
    });
  });
});
