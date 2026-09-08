import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDeck, dealNewRound, Phase } from '@tichu/shared';
import { App } from './App';
import { loadModel } from './ai/loadModel';
import { saveSoloGameSnapshot } from './ai/soloGamePersistence';

vi.mock('./ai/loadModel', () => ({ loadModel: vi.fn(() => new Promise(() => {})) }));

afterEach(() => {
  window.localStorage.clear();
});

describe('App navigation', () => {
  // MVP ships solo-only -- the multiplayer entry point is deliberately hidden
  // from the home screen for now (App.tsx's 'multiplayer' screen/route and
  // MultiplayerPage itself are untouched, just unreachable via this button).
  it('starts on the home screen with only the solo entry point', () => {
    render(<App />);
    expect(screen.queryByRole('button', { name: '사람과 플레이' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'AI와 연습하기' })).toBeInTheDocument();
  });

  it('navigates to the solo entry (AI model loading) screen', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'AI와 연습하기' }));
    expect(screen.getByText(/AI 모델을 내려받는 중입니다/)).toBeInTheDocument();
    expect(vi.mocked(loadModel)).toHaveBeenCalled();
  });

  it('boots straight into the solo-AI flow (skipping home) when a solo game snapshot is saved', () => {
    saveSoloGameSnapshot({ state: { ...dealNewRound(createDeck()), phase: Phase.Exchange }, cumulativeScores: [0, 0] });

    render(<App />);

    expect(screen.getByText(/AI 모델을 내려받는 중입니다/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'AI와 연습하기' })).not.toBeInTheDocument();
  });
});
