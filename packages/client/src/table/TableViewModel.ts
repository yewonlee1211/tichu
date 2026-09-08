import {
  type Card,
  type Combo,
  type GameState,
  type PlayerView,
  type Rank,
  Phase,
  pointValue,
} from '@tichu/shared';

/** Everything the shared table UI needs to render one player's-eye view of
 * the game, regardless of whether it came from the WS server (`PlayerView`,
 * already seat-masked) or from a local `SoloGame` (`GameState`, always
 * viewed from `HUMAN_SEAT`). The two adapters below are the only place that
 * knows the difference. */
export interface TableViewModel {
  readonly viewerSeat: number;
  readonly hand: readonly Card[];
  readonly handSizes: readonly number[];
  readonly trickCards: readonly Card[];
  readonly collectedPoints: readonly number[];
  readonly phase: Phase;
  readonly currentPlayer: number;
  readonly trickLeader: number;
  readonly currentBest: Combo | null;
  readonly currentStrength: number;
  readonly lastPlayerToAct: number | null;
  readonly finishedOrder: readonly number[];
  readonly tichuCalls: readonly boolean[];
  readonly largeTichuCalls: readonly (boolean | null)[];
  readonly mahjongWish: Rank | null;
  /** Consecutive passes since `currentBest` was set -- see `isClosingPass`
   * in `legalPlay.ts`. */
  readonly passesInARow: number;
  readonly seatNames: readonly string[];
  /** See `usePlayFlow.ts`'s `UsePlayFlowArgs.dragonRecipientPreDecided` doc
   * comment -- `false` for multiplayer (`fromPlayerView`), always `true` for
   * solo-AI (`fromSoloGameState`, since `SoloGame` always captures the
   * decision the instant a Dragon single is played). */
  readonly dragonRecipientPreDecided: boolean;
}

const DEFAULT_SEAT_NAMES: readonly string[] = ['나', '상대 1', '상대 2', '상대 3'];

export function fromPlayerView(view: PlayerView, seatNames: readonly string[] = DEFAULT_SEAT_NAMES): TableViewModel {
  return {
    viewerSeat: view.viewerSeat,
    hand: view.hand,
    handSizes: view.handSizes,
    trickCards: view.trickCards,
    collectedPoints: view.collectedPoints,
    phase: view.phase,
    currentPlayer: view.currentPlayer,
    trickLeader: view.trickLeader,
    currentBest: view.currentBest,
    currentStrength: view.currentStrength,
    lastPlayerToAct: view.lastPlayerToAct,
    finishedOrder: view.finishedOrder,
    tichuCalls: view.tichuCalls,
    largeTichuCalls: view.largeTichuCalls,
    mahjongWish: view.mahjongWish,
    passesInARow: view.passesInARow,
    seatNames,
    dragonRecipientPreDecided: false,
  };
}

const SOLO_SEAT_NAMES: readonly string[] = ['나', 'AI 1', 'AI 2', 'AI 3'];

/** `SoloGame.getState()` always reports the full `GameState` (all 4 hands),
 * but the human only ever plays as `humanSeat` -- mask it down to the same
 * shape a server `PlayerView` would give that seat. */
export function fromSoloGameState(state: GameState, humanSeat: number): TableViewModel {
  return {
    viewerSeat: humanSeat,
    hand: state.hands[humanSeat] ?? [],
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
    seatNames: SOLO_SEAT_NAMES,
    dragonRecipientPreDecided: true,
  };
}
