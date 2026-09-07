import { type GameState, type PlayerView, pointValue } from '@tichu/shared';

/** Masks `GameState` down to what `viewerSeat` is allowed to see: their own
 * hand in full, everyone else only as hand sizes and collected-point
 * totals. Mirrors the public/private split `encoding.ts` already
 * established for the AI's observation vector. */
export function buildPlayerView(
  state: GameState,
  viewerSeat: number,
  cumulativeScores: readonly [number, number],
): PlayerView {
  return {
    viewerSeat,
    hand: state.hands[viewerSeat]!,
    handSizes: state.hands.map((hand) => hand.length),
    trickCards: state.trickCards,
    collectedPoints: state.collectedTricks.map((cards) => cards.reduce((sum, card) => sum + pointValue(card), 0)),
    phase: state.phase,
    currentPlayer: state.currentPlayer,
    trickLeader: state.trickLeader,
    currentBest: state.currentBest,
    currentStrength: state.currentStrength,
    lastPlayerToAct: state.lastPlayerToAct,
    finishedOrder: state.finishedOrder,
    tichuCalls: state.tichuCalls,
    largeTichuCalls: state.largeTichuCalls,
    mahjongWish: state.mahjongWish,
    passesInARow: state.passesInARow,
    cumulativeScores,
  };
}
