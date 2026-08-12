import { describe, expect, it } from 'vitest';
import { Phase, Rank, Suit, dealNewRound } from '@tichu/shared';
import { fromPlayerView, fromSoloGameState } from './TableViewModel';
import type { PlayerView } from '@tichu/shared';

describe('fromPlayerView', () => {
  it('maps every PlayerView field straight through and defaults seat names', () => {
    const view: PlayerView = {
      viewerSeat: 2,
      hand: [{ rank: Rank.Ace, suit: Suit.Sword }],
      handSizes: [14, 14, 14, 14],
      trickCards: [],
      collectedPoints: [0, 0, 0, 0],
      phase: Phase.Playing,
      currentPlayer: 2,
      trickLeader: 2,
      currentBest: null,
      currentStrength: 0,
      lastPlayerToAct: null,
      finishedOrder: [],
      tichuCalls: [false, false, false, false],
      largeTichuCalls: [null, null, null, null],
      mahjongWish: null,
    };

    const vm = fromPlayerView(view);

    expect(vm.viewerSeat).toBe(2);
    expect(vm.hand).toEqual(view.hand);
    expect(vm.seatNames).toEqual(['나', '상대 1', '상대 2', '상대 3']);
  });

  it('accepts custom seat names (e.g. real player names from the lobby)', () => {
    const view: PlayerView = {
      viewerSeat: 0,
      hand: [],
      handSizes: [0, 0, 0, 0],
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
    };

    const vm = fromPlayerView(view, ['Alice', 'Bob', 'Carol', 'Dave']);

    expect(vm.seatNames).toEqual(['Alice', 'Bob', 'Carol', 'Dave']);
  });
});

describe('fromSoloGameState', () => {
  it('masks the full GameState down to the human seat and sums collected points', () => {
    const dealt = dealNewRound();
    const withTrick = {
      ...dealt,
      collectedTricks: [
        [{ rank: Rank.King, suit: Suit.Sword }],
        [],
        [{ rank: Rank.Five, suit: Suit.Jade }],
        [],
      ],
    };

    const vm = fromSoloGameState(withTrick, 0);

    expect(vm.viewerSeat).toBe(0);
    expect(vm.hand).toEqual(withTrick.hands[0]);
    expect(vm.handSizes).toEqual(withTrick.hands.map((h) => h.length));
    expect(vm.collectedPoints).toEqual([10, 0, 5, 0]);
    expect(vm.seatNames).toEqual(['나', 'AI 1', 'AI 2', 'AI 3']);
  });
});
