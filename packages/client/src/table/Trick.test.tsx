import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { identifyCombo, Rank, Suit } from '@tichu/shared';
import { Trick } from './Trick';

describe('Trick', () => {
  it('shows a placeholder when no cards have been played yet', () => {
    render(<Trick trickCards={[]} currentBest={null} currentPlayerName="Alice" isMyTurn={false} />);
    expect(screen.getByText('아직 낸 카드가 없습니다')).toBeInTheDocument();
    expect(screen.getByText('Alice의 차례를 기다리는 중')).toBeInTheDocument();
  });

  it('lists played cards and the current best combo label', () => {
    const cards = [{ rank: Rank.King, suit: Suit.Sword }];
    render(<Trick trickCards={cards} currentBest={identifyCombo(cards)} currentPlayerName="Alice" isMyTurn />);
    expect(screen.getByText('K⚔')).toBeInTheDocument();
    expect(screen.getByText(/현재 최고 조합: 싱글/)).toBeInTheDocument();
    expect(screen.getByText('내 차례입니다')).toBeInTheDocument();
  });
});
