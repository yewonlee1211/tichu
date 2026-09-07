import { StrictMode } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InferenceSession } from 'onnxruntime-common';
import { createDeck, dealNewRound, Phase } from '@tichu/shared';
import { loadSoloGameSnapshot, saveSoloGameSnapshot } from '../ai/soloGamePersistence';
import { SoloGamePage } from './SoloGamePage';

function stubSession(): InferenceSession {
  return {
    async run(feeds: InferenceSession.FeedsType) {
      const numCandidates = (feeds.action_vectors as { dims: readonly number[] }).dims[0] as number;
      const logits = new Float32Array(numCandidates);
      logits[0] = 1;
      return {
        action_logits: { data: logits } as never,
        state_value: { data: Float32Array.from([0]) } as never,
      };
    },
  } as unknown as InferenceSession;
}

/** Mirrors real onnxruntime-web behavior: a session rejects a `run()` call
 * that arrives while a previous one is still in flight ("Session already
 * started"). Used to actually detect a regression back to the concurrent-
 * call bug, not just assume the fix holds. */
function stubSessionRejectingConcurrentCalls(): InferenceSession {
  let inFlight = false;
  return {
    async run(feeds: InferenceSession.FeedsType) {
      if (inFlight) throw new Error('Session already started');
      inFlight = true;
      try {
        await Promise.resolve();
        const numCandidates = (feeds.action_vectors as { dims: readonly number[] }).dims[0] as number;
        const logits = new Float32Array(numCandidates);
        logits[0] = 1;
        return {
          action_logits: { data: logits } as never,
          state_value: { data: Float32Array.from([0]) } as never,
        };
      } finally {
        inFlight = false;
      }
    },
  } as unknown as InferenceSession;
}

afterEach(() => {
  window.localStorage.clear();
});

describe('SoloGamePage', () => {
  it('plays through Large Tichu and Exchange into the Playing phase', async () => {
    const user = userEvent.setup();
    render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);

    expect(screen.getByText('그랜드 티츄')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '선언하지 않음' }));
    await waitFor(() => expect(screen.getByText('카드 교환')).toBeInTheDocument());

    const selects = screen.getAllByRole('combobox');
    expect(selects).toHaveLength(3);
    for (const select of selects) {
      // Query options fresh each iteration: picking a card removes it from
      // the remaining selects' option lists, so this always lands on a
      // still-available, distinct card.
      const options = Array.from((select as HTMLSelectElement).options).filter((o) => o.value !== '');
      await user.selectOptions(select, options[0]!.value);
    }

    await user.click(screen.getByRole('button', { name: '교환 제출' }));

    await waitFor(() => expect(screen.queryByText('카드 교환')).not.toBeInTheDocument());
  }, 10000);

  it('calls onExit when leaving', async () => {
    const user = userEvent.setup();
    const onExit = vi.fn();
    render(<SoloGamePage session={stubSession()} onExit={onExit} />);

    await user.click(screen.getByRole('button', { name: '나가기' }));
    expect(onExit).toHaveBeenCalled();
  });

  it('resumes from a saved snapshot on mount instead of starting a fresh Large Tichu decision', () => {
    const dealt = dealNewRound(createDeck());
    saveSoloGameSnapshot({ state: { ...dealt, phase: Phase.Exchange, largeTichuCalls: [false, false, false, false] }, cumulativeScores: [40, 15] });

    render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);

    expect(screen.queryByText('그랜드 티츄')).not.toBeInTheDocument();
    expect(screen.getByText('카드 교환')).toBeInTheDocument();
  });

  it('persists progress to localStorage as the game advances', async () => {
    const user = userEvent.setup();
    render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);

    expect(loadSoloGameSnapshot()?.state.phase).toBe(Phase.LargeTichu);

    await user.click(screen.getByRole('button', { name: '선언하지 않음' }));

    expect(loadSoloGameSnapshot()?.state.phase).toBe(Phase.Exchange);
  });

  it('clears the saved snapshot on exit, so the next visit starts a fresh game', async () => {
    const user = userEvent.setup();
    render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);
    expect(loadSoloGameSnapshot()).not.toBeNull();

    await user.click(screen.getByRole('button', { name: '나가기' }));

    expect(loadSoloGameSnapshot()).toBeNull();
  });

  it('resuming into an AI seat\'s turn under StrictMode does not crash the shared session with a concurrent call', async () => {
    // Regression test for a real bug: StrictMode double-invokes the
    // useState(() => new SoloGame(...)) initializer in dev, so kicking off
    // the resumed AI turn from inside the constructor fired two concurrent
    // decideAiMove calls against the same session and crashed it ("Session
    // already started"). If that regresses, stubSessionRejectingConcurrentCalls
    // throws and this test fails.
    const dealt = dealNewRound(createDeck());
    saveSoloGameSnapshot({
      state: { ...dealt, phase: Phase.Playing, currentPlayer: 3, trickLeader: 3, currentBest: null },
      cumulativeScores: [0, 0],
    });

    render(
      <StrictMode>
        <SoloGamePage session={stubSessionRejectingConcurrentCalls()} onExit={vi.fn()} />
      </StrictMode>,
    );

    await waitFor(() => expect(loadSoloGameSnapshot()?.state.currentPlayer).not.toBe(3));
  });
});
