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

    expect(result.current).toEqual({ seat: 1, cards: [kingCard], label: '싱글 K' });
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

    expect(result.current).toEqual({ seat: 0, cards: [{ rank: Rank.Dog, suit: Suit.Special }], label: '개' });
  });

  it('does not announce anything across a phase transition (e.g. into RoundOver)', () => {
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1 }),
    });

    rerender(baseVm({ phase: Phase.RoundOver, currentPlayer: 2 }));

    expect(result.current).toBeNull();
  });

  it('keeps showing the same play through any number of passes that follow it -- passes never disturb the center display', () => {
    const kingCard = { rank: Rank.King, suit: Suit.Sword };
    const king = identifyCombo([kingCard])!;
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1, handSizes: [10, 10, 10, 10] }),
    });

    // Player 1 plays the King (announced), then several other players pass
    // in turn -- none of those passes change who currently owns the trick,
    // so the King must stay on screen throughout.
    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 2 }));
    expect(result.current).toEqual({ seat: 1, cards: [kingCard], label: '싱글 K' });

    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 3 }));
    expect(result.current).toEqual({ seat: 1, cards: [kingCard], label: '싱글 K' });

    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 0 }));
    expect(result.current).toEqual({ seat: 1, cards: [kingCard], label: '싱글 K' });
  });

  it('replaces the current announcement only once someone actually plays again, not when the trick closes via the final pass', () => {
    const kingCard = { rank: Rank.King, suit: Suit.Sword };
    const king = identifyCombo([kingCard])!;
    const aceCard = { rank: Rank.Ace, suit: Suit.Sword };
    const ace = identifyCombo([aceCard])!;
    const { result, rerender } = renderHook((vm: TableViewModel) => useActionAnnouncement(vm), {
      initialProps: baseVm({ currentPlayer: 1, handSizes: [10, 10, 10, 10] }),
    });

    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: king, lastPlayerToAct: 1, currentPlayer: 2 }));
    expect(result.current).toEqual({ seat: 1, cards: [kingCard], label: '싱글 K' });

    // The trick closes (currentBest resets to null, a new trick begins led
    // by seat 1) via what is still just a pass on the diff -- must not
    // replace the King that just won the previous trick.
    rerender(baseVm({ handSizes: [10, 9, 10, 10], currentBest: null, lastPlayerToAct: null, currentPlayer: 1 }));
    expect(result.current).toEqual({ seat: 1, cards: [kingCard], label: '싱글 K' });

    // Seat 1 leads the new trick with the Ace -- this is a real play, so it replaces the King.
    rerender(baseVm({ handSizes: [10, 8, 10, 10], currentBest: ace, lastPlayerToAct: 1, currentPlayer: 2 }));
    expect(result.current).toEqual({ seat: 1, cards: [aceCard], label: '싱글 A' });
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
