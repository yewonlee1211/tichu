import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type Card, Rank, Suit } from '@tichu/shared';
import { ExchangeResultToast } from './ExchangeResultToast';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

describe('ExchangeResultToast', () => {
  it('shows each giver as a card face above their name, ordered seat 3-2-1', () => {
    const received = { 1: card(Rank.King), 2: card(Rank.Two), 3: card(Rank.Dragon) };
    render(<ExchangeResultToast received={received} seatNames={['나', 'AI 1', 'AI 2', 'AI 3']} onDismiss={vi.fn()} />);

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]).toHaveTextContent('용');
    expect(items[0]).toHaveTextContent('AI 3');
    expect(items[1]).toHaveTextContent('2');
    expect(items[1]).toHaveTextContent('AI 2');
    expect(items[2]).toHaveTextContent('K');
    expect(items[2]).toHaveTextContent('AI 1');
  });

  it('calls onDismiss when the overlay is clicked anywhere, including the toast itself', async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<ExchangeResultToast received={{ 1: card(Rank.Five) }} seatNames={['나', 'AI 1', 'AI 2', 'AI 3']} onDismiss={onDismiss} />);

    await user.click(screen.getByRole('status'));

    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('has no visible dismiss button', () => {
    render(<ExchangeResultToast received={{ 1: card(Rank.Five) }} seatNames={['나', 'AI 1', 'AI 2', 'AI 3']} onDismiss={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '닫기' })).not.toBeInTheDocument();
  });
});
