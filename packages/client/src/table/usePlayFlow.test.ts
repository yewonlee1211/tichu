import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type Card, identifyCombo, Rank, Suit } from '@tichu/shared';
import { usePlayFlow } from './usePlayFlow';

function card(rank: Rank, suit: Suit = Suit.Sword): Card {
  return { rank, suit };
}

function setup(overrides: Partial<Parameters<typeof usePlayFlow>[0]> = {}) {
  const onPlayCards = vi.fn();
  const onPass = vi.fn();
  const hand = overrides.hand ?? [card(Rank.King), card(Rank.King, Suit.Jade), card(Rank.Three)];
  const legalCombos = overrides.legalCombos ?? [identifyCombo([card(Rank.King), card(Rank.King, Suit.Jade)])!];
  const rendered = renderHook(() =>
    usePlayFlow({
      hand,
      viewerSeat: 0,
      currentBest: null,
      lastPlayerToAct: null,
      finishedOrder: [],
      passesInARow: 0,
      legalCombos,
      canPassNow: true,
      onPlayCards,
      onPass,
      ...overrides,
    }),
  );
  return { ...rendered, onPlayCards, onPass, hand };
}

describe('usePlayFlow selection', () => {
  it('toggles cards into and out of the selection', () => {
    const { result, hand } = setup();
    act(() => result.current.toggleCard(hand[0]!));
    expect(result.current.selected).toEqual([hand[0]]);
    act(() => result.current.toggleCard(hand[0]!));
    expect(result.current.selected).toEqual([]);
  });

  it('canSubmitPlay is false until the selection matches a legal combo', () => {
    const { result, hand } = setup();
    act(() => result.current.toggleCard(hand[2]!)); // lone Three: not in legalCombos
    expect(result.current.canSubmitPlay).toBe(false);

    act(() => result.current.toggleCard(hand[2]!));
    act(() => result.current.toggleCard(hand[0]!));
    act(() => result.current.toggleCard(hand[1]!));
    expect(result.current.canSubmitPlay).toBe(true);
  });
});

describe('usePlayFlow submitPlay', () => {
  it('plays a plain combo immediately with no wish and no dragon step', () => {
    const { result, hand, onPlayCards } = setup();
    act(() => {
      result.current.toggleCard(hand[0]!);
      result.current.toggleCard(hand[1]!);
    });
    act(() => result.current.submitPlay());

    expect(onPlayCards).toHaveBeenCalledWith([hand[0], hand[1]], null, null);
    expect(result.current.step).toEqual({ kind: 'selecting' });
    expect(result.current.selected).toEqual([]);
  });

  it('routes through a wish step when the selection includes the Mahjong', () => {
    const mahjongHand = [card(Rank.Mahjong, Suit.Special)];
    const legal = [identifyCombo(mahjongHand)!];
    const { result, onPlayCards } = setup({ hand: mahjongHand, legalCombos: legal });

    act(() => result.current.toggleCard(mahjongHand[0]!));
    act(() => result.current.submitPlay());
    expect(result.current.step).toEqual({ kind: 'wish' });
    expect(onPlayCards).not.toHaveBeenCalled();

    act(() => result.current.chooseWish(Rank.King));
    expect(onPlayCards).toHaveBeenCalledWith(mahjongHand, Rank.King, null);
  });

  it('routes through a dragon-recipient step when playing a lone Dragon single', () => {
    const dragonHand = [card(Rank.Dragon, Suit.Special)];
    const legal = [identifyCombo(dragonHand)!];
    const { result, onPlayCards } = setup({ hand: dragonHand, legalCombos: legal, viewerSeat: 0, finishedOrder: [] });

    act(() => result.current.toggleCard(dragonHand[0]!));
    act(() => result.current.submitPlay());

    expect(result.current.step).toEqual({ kind: 'dragon', action: 'play', wish: null });
    // seat 0 wins; excludes self (0) and partner (2) -> [1, 3]
    expect(result.current.dragonRecipientOptions).toEqual([1, 3]);

    act(() => result.current.chooseDragonRecipient(1));
    expect(onPlayCards).toHaveBeenCalledWith(dragonHand, null, 1);
    expect(result.current.step).toEqual({ kind: 'selecting' });
  });
});

describe('usePlayFlow submitPass', () => {
  it('passes immediately when the current best is not a Dragon single', () => {
    const { result, onPass } = setup({ currentBest: identifyCombo([card(Rank.King)]) });
    act(() => result.current.submitPass());
    expect(onPass).toHaveBeenCalledWith(null);
  });

  it('routes through a dragon-recipient step keyed on lastPlayerToAct, not the passer -- when this pass actually closes the trick', () => {
    const dragonBest = identifyCombo([card(Rank.Dragon, Suit.Special)]);
    const { result, onPass } = setup({
      currentBest: dragonBest,
      lastPlayerToAct: 1,
      viewerSeat: 3, // seat 3 is the one passing/closing the trick
      finishedOrder: [],
      passesInARow: 2, // seats 2 and 0 already passed; this is the 3rd (closing) pass
    });

    act(() => result.current.submitPass());
    expect(result.current.step).toEqual({ kind: 'dragon', action: 'pass', wish: null });
    // winner is seat 1 (lastPlayerToAct), so options exclude seat 1 and its partner seat 3
    expect(result.current.dragonRecipientOptions).toEqual([0, 2]);

    act(() => result.current.chooseDragonRecipient(0));
    expect(onPass).toHaveBeenCalledWith(0);
  });

  it('passes immediately with no dragon step when this pass is not the one closing the trick', () => {
    const dragonBest = identifyCombo([card(Rank.Dragon, Suit.Special)]);
    const { result, onPass } = setup({
      currentBest: dragonBest,
      lastPlayerToAct: 1,
      viewerSeat: 2, // seat 2 passes first, right after the Dragon owner (seat 1)
      finishedOrder: [],
      passesInARow: 0, // 2 more passes (seat 3, then seat 0) are still needed to close
    });

    act(() => result.current.submitPass());
    expect(result.current.step).toEqual({ kind: 'selecting' });
    expect(onPass).toHaveBeenCalledWith(null);
  });

  it('does nothing when canPassNow is false', () => {
    const { result, onPass } = setup({ canPassNow: false });
    act(() => result.current.submitPass());
    expect(onPass).not.toHaveBeenCalled();
  });
});

describe('usePlayFlow reset behavior', () => {
  it('clears selection and step when the hand changes (e.g. after a play resolves)', () => {
    const initialHand = [card(Rank.King), card(Rank.King, Suit.Jade)];
    const legal = [identifyCombo(initialHand)!];
    const { result, rerender } = renderHook(
      ({ hand }: { hand: Card[] }) =>
        usePlayFlow({
          hand,
          viewerSeat: 0,
          currentBest: null,
          lastPlayerToAct: null,
          finishedOrder: [],
          passesInARow: 0,
          legalCombos: legal,
          canPassNow: true,
          onPlayCards: vi.fn(),
          onPass: vi.fn(),
        }),
      { initialProps: { hand: initialHand } },
    );

    act(() => result.current.toggleCard(initialHand[0]!));
    expect(result.current.selected).toEqual([initialHand[0]]);

    rerender({ hand: [card(Rank.Three)] });
    expect(result.current.selected).toEqual([]);
    expect(result.current.step).toEqual({ kind: 'selecting' });
  });

  it('cancelFlow returns to selecting without firing a callback', () => {
    const dragonHand = [card(Rank.Dragon, Suit.Special)];
    const legal = [identifyCombo(dragonHand)!];
    const { result, onPlayCards } = setup({ hand: dragonHand, legalCombos: legal });

    act(() => result.current.toggleCard(dragonHand[0]!));
    act(() => result.current.submitPlay());
    expect(result.current.step.kind).toBe('dragon');

    act(() => result.current.cancelFlow());
    expect(result.current.step).toEqual({ kind: 'selecting' });
    expect(onPlayCards).not.toHaveBeenCalled();
  });
});
