import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { identifyCombo, Phase, Rank, Suit } from '@tichu/shared';
import type { TableViewModel } from './TableViewModel';
import { useActionAnnouncement } from './useActionAnnouncement';

const seatNames = ['나', 'AI 1', 'AI 2', 'AI 3'];

function baseVm(overrides: Partial<TableViewModel> = {}): TableViewModel {
  return {
    viewerSeat: 0,
    hand: [],
    handSizes: [10, 10, 10, 10],
    trickCards: [],
    collectedPoints: [0, 0, 0, 0],
    phase: Phase.Playing,
    currentPlayer: 0,
    trickLeader: 0,
    currentBest: null,
    currentStrength: 0,
    lastPlayerToAct: null,
    finishedOrder: [],
    tichuCalls: [false, false, false, false],
    largeTichuCalls: [null, null, null, null],
    mahjongWish: null,
    passesInARow: 0,
    seatNames,
    ...overrides,
  };
}

describe('useActionAnnouncement', () => {
  it('reports nothing on the first render (no previous state to diff against)', () => {
    const { result } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), { initialProps: baseVm() });
    expect(result.current).toBeNull();
  });

  it('announces a play with the combo description and the actual cards once a seat\'s hand shrinks and becomes current-best', () => {
    const kingCard = { rank: Rank.King, suit: Suit.Sword };
    const king = identifyCombo([kingCard])!;
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1 }),
    });

    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 2 }));

    expect(result.current).toEqual({ kind: 'play', seat: 1, cards: [kingCard], label: '싱글 K' });
  });

  it('does not announce a pass -- the turn moving on with no hand change leaves the display as-is (nothing shown yet)', () => {
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1 }),
    });

    rerender(baseVm({ currentPlayer: 2 }));

    expect(result.current).toBeNull();
  });

  it('announces the Dog (with its fixed card) when a hand shrinks but currentBest stays null (the Dog resets both)', () => {
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 0, currentBest: null }),
    });

    rerender(baseVm({ handSizes: [9, 10, 10, 10], currentBest: null, lastPlayerToAct: null, currentPlayer: 2 }));

    expect(result.current).toEqual({ kind: 'play', seat: 0, cards: [{ rank: Rank.Dog, suit: Suit.Special }], label: '개' });
  });

  it('does not announce anything across a phase transition (e.g. into RoundOver)', () => {
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1 }),
    });

    rerender(baseVm({ phase: Phase.RoundOver, currentPlayer: 2 }));

    expect(result.current).toBeNull();
  });

  it('keeps showing the same play through any non-closing passes that follow it', () => {
    const kingCard = { rank: Rank.King, suit: Suit.Sword };
    const king = identifyCombo([kingCard])!;
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1, handSizes: [10, 10, 10, 10] }),
    });

    // Player 1 plays the King (announced), then another player passes --
    // the trick is still open (currentBest unchanged), so the King must
    // stay on screen.
    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 2 }));
    expect(result.current).toEqual({ kind: 'play', seat: 1, cards: [kingCard], label: '싱글 K' });

    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 3 }));
    expect(result.current).toEqual({ kind: 'play', seat: 1, cards: [kingCard], label: '싱글 K' });
  });

  it('switches to a trickWon callout once the final pass closes the trick, then to the new play once the leader plays', () => {
    const kingCard = { rank: Rank.King, suit: Suit.Sword };
    const king = identifyCombo([kingCard])!;
    const aceCard = { rank: Rank.Ace, suit: Suit.Sword };
    const ace = identifyCombo([aceCard])!;
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1, handSizes: [10, 10, 10, 10] }),
    });

    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 2 }));
    expect(result.current).toEqual({ kind: 'play', seat: 1, cards: [kingCard], label: '싱글 K' });

    // The final pass closes the trick (currentBest resets to null, seat 1 --
    // who won it -- leads the new one): the King display is replaced by a
    // "seat 1 won / seat 1's turn" callout, not left alone.
    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: null, lastPlayerToAct: null, currentPlayer: 1 }));
    expect(result.current).toEqual({ kind: 'trickWon', winnerSeat: 1, nextSeat: 1 });

    // Seat 1 leads the new trick with the Ace -- this is a real play, so it replaces the callout.
    rerender(baseVm({ handSizes: [10, 8, 10, 10], currentBest: ace, lastPlayerToAct: 1, currentPlayer: 2 }));
    expect(result.current).toEqual({ kind: 'play', seat: 1, cards: [aceCard], label: '싱글 A' });
  });

  it('credits the trick to a winner who went out on their winning play, and names the next active player as leader', () => {
    const aceCard = { rank: Rank.Ace, suit: Suit.Sword };
    const ace = identifyCombo([aceCard])!;
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 0, handSizes: [1, 10, 10, 10] }),
    });

    // Seat 0 plays their last card (the Ace), winning the open trick and
    // finishing the round for themselves.
    rerender(
      baseVm({
        handSizes: [0, 10, 10, 10],
        currentBest: ace,
        lastPlayerToAct: 0,
        currentPlayer: 1,
        finishedOrder: [0],
      }),
    );
    expect(result.current).toEqual({ kind: 'play', seat: 0, cards: [aceCard], label: '싱글 A' });

    // Everyone else passes; the trick closes. Seat 0 is out, so the reducer
    // hands the lead to seat 1 -- the callout must credit seat 0 with the
    // win but name seat 1 as next to act.
    rerender(
      baseVm({
        handSizes: [0, 10, 10, 10],
        currentBest: null,
        lastPlayerToAct: null,
        currentPlayer: 1,
        finishedOrder: [0],
      }),
    );
    expect(result.current).toEqual({ kind: 'trickWon', winnerSeat: 0, nextSeat: 1 });
  });

  it('clears an already-showing announcement once the phase leaves Playing', () => {
    const kingCard = { rank: Rank.King, suit: Suit.Sword };
    const king = identifyCombo([kingCard])!;
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1, handSizes: [10, 10, 10, 10] }),
    });

    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 2 }));
    expect(result.current).not.toBeNull();

    rerender(baseVm({ phase: Phase.RoundOver, currentPlayer: 2 }));
    expect(result.current).toBeNull();
  });
});
