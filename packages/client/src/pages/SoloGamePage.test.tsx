import { StrictMode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InferenceSession } from 'onnxruntime-common';
import { createDeck, dealNewRound, Phase, Rank } from '@tichu/shared';
import { HUMAN_SEAT } from '../ai/soloGame';
import { loadSoloGameSnapshot, saveSoloGameSnapshot } from '../ai/soloGamePersistence';
import { cardLabel } from '../table/cardDisplay';
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
    const { container } = render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);

    expect(screen.getByText('그랜드 티츄')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '선언하지 않음' }));
    await waitFor(() => expect(screen.getByText('카드 교환')).toBeInTheDocument());

    // Click a card, then click a recipient name in the picker that opens
    // below it -- one distinct card per AI recipient. Assigned cards stay in
    // the hand list (with a "-> name" label), so advance the index each time
    // instead of always picking the first (still-unassigned) button.
    const recipientNames = ['AI 1', 'AI 2', 'AI 3'];
    for (let i = 0; i < recipientNames.length; i += 1) {
      const handList = screen.getByLabelText('내 손패');
      const cardButton = within(handList).getAllByRole('button')[i]!;
      await user.click(cardButton);
      await user.click(screen.getByRole('button', { name: recipientNames[i] }));
    }

    await user.click(screen.getByRole('button', { name: '교환 제출' }));

    // Whoever holds the post-exchange Mahjong (random) leads, and up to two
    // more AI seats might need to act before it's the human's turn again --
    // each now waits for a screen tap (see SoloGamePage's tap-to-advance
    // gate), so keep tapping (spaced past the 0.5s cooldown) until the
    // Exchange screen is gone. A no-op tap (if the human already led) is
    // harmless.
    const page = container.querySelector('.solo-game-page')!;
    await waitFor(
      () => {
        fireEvent.click(page);
        expect(screen.queryByText('카드 교환')).not.toBeInTheDocument();
      },
      { interval: 600, timeout: 8000 },
    );
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

    const user = userEvent.setup();
    const { container } = render(
      <StrictMode>
        <SoloGamePage session={stubSessionRejectingConcurrentCalls()} onExit={vi.fn()} />
      </StrictMode>,
    );

    // The resumed AI turn now waits for a screen tap (see SoloGamePage's
    // tap-to-advance gate) before it ever calls decideAiMove.
    await user.click(container.querySelector('.solo-game-page')!);

    await waitFor(() => expect(loadSoloGameSnapshot()?.state.currentPlayer).not.toBe(3));
  });

  it('advances one AI turn per screen tap, and blocks a second tap within the 0.5s cooldown', async () => {
    const dealt = dealNewRound(createDeck());
    // Seat 1 leads a fresh trick (currentBest: null forces a real play, not
    // a pass), and with no one finished, the next player after seat 1 is
    // seat 2 -- still an AI seat, so a *second* AI turn is needed and this
    // test can tell whether the cooldown actually blocked it.
    saveSoloGameSnapshot({
      state: { ...dealt, phase: Phase.Playing, currentPlayer: 1, trickLeader: 1, currentBest: null },
      cumulativeScores: [0, 0],
    });

    let now = 1_000_000;
    const dateNowSpy = vi.spyOn(Date, 'now').mockImplementation(() => now);
    try {
      const { container } = render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);
      const page = container.querySelector('.solo-game-page')!;

      fireEvent.click(page);
      await waitFor(() => expect(loadSoloGameSnapshot()?.state.currentPlayer).toBe(2));

      // Still within the 0.5s cooldown -- must not advance seat 2's turn yet.
      now += 100;
      fireEvent.click(page);
      await Promise.resolve();
      expect(loadSoloGameSnapshot()?.state.currentPlayer).toBe(2);

      // Past the cooldown -- a tap now does advance the next AI turn.
      now += 500;
      fireEvent.click(page);
      await waitFor(() => expect(loadSoloGameSnapshot()?.state.currentPlayer).not.toBe(2));
    } finally {
      dateNowSpy.mockRestore();
    }
  });

  it('does not let the human\'s own submit click double as the tap that advances the very next AI turn', async () => {
    // Regression test: click events bubble, so the "제출" button's click also
    // reaches the page-level tap-to-advance handler. By the time it does,
    // humanPlayCombo has already (synchronously) armed the gate for seat 1's
    // turn -- without excluding clicks on actual controls, that same click
    // immediately released it too, collapsing the gap between the human's
    // own action and the next AI's to nothing.
    const dealt = dealNewRound(createDeck());
    const resumedState = { ...dealt, phase: Phase.Playing, currentPlayer: HUMAN_SEAT, trickLeader: HUMAN_SEAT, currentBest: null };
    saveSoloGameSnapshot({ state: resumedState, cumulativeScores: [0, 0] });

    const user = userEvent.setup();
    render(<SoloGamePage session={stubSession()} onExit={vi.fn()} />);

    const hand = resumedState.hands[HUMAN_SEAT]!;
    // Avoid the Mahjong (triggers an extra wish-picker step) and the Dragon
    // (triggers an extra recipient-picker step) -- either would stop this
    // play short of actually calling onPlayCards within this one click.
    const plainCard = hand.find((c) => c.rank !== Rank.Mahjong && c.rank !== Rank.Dragon && c.rank !== Rank.Dog)!;

    await user.click(screen.getByRole('button', { name: cardLabel(plainCard) }));
    await user.click(screen.getByRole('button', { name: '제출' }));

    // Seat 1 is up next, but must still be waiting on a tap -- not already
    // having acted as a side effect of the human's own submit click.
    expect(loadSoloGameSnapshot()?.state.currentPlayer).toBe(1);

    // A genuine tap (not on a button) does then advance seat 1's turn.
    fireEvent.click(document.querySelector('.solo-game-page')!);
    await waitFor(() => expect(loadSoloGameSnapshot()?.state.currentPlayer).not.toBe(1));
  });
});
