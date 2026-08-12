import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { type Card, Rank, Suit } from '@tichu/shared';
import { Hand } from './Hand';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

describe('Hand', () => {
  it('renders cards sorted by rank and calls onToggle with the clicked card', async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    const cards = [card(Rank.King), card(Rank.Three)];
    render(<Hand cards={cards} selected={[]} onToggle={onToggle} />);

    const buttons = screen.getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['3⚔', 'K⚔']);

    await user.click(buttons[1]!);
    expect(onToggle).toHaveBeenCalledWith(card(Rank.King));
  });

  it('marks selected cards as pressed', () => {
    const cards = [card(Rank.King)];
    render(<Hand cards={cards} selected={[card(Rank.King)]} onToggle={() => {}} />);
    expect(screen.getByRole('button', { name: 'K⚔' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('disables all cards when disabled', () => {
    const cards = [card(Rank.King)];
    render(<Hand cards={cards} selected={[]} onToggle={() => {}} disabled />);
    expect(screen.getByRole('button', { name: 'K⚔' })).toBeDisabled();
  });
});
