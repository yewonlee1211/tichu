import { type Card, type Rank } from './cards';
import { type Combo } from './combinations';
import { type Phase } from './gameState';

// Human-vs-human WebSocket protocol only. There is no AI seat in this
// message set (see tichu-online.plan.md Phase 3: solo-vs-AI runs entirely
// client-side via decideAiMove.ts, never over the wire). If mixed rooms
// (human + AI seats in the same room) are ever supported, add AI-seat
// messages here as a new branch of ClientMessage/ServerMessage rather than
// overloading these.

// --- Client -> Server ---------------------------------------------------

export interface JoinRoomMessage {
  readonly type: 'JOIN_ROOM';
  readonly roomCode: string;
  readonly playerName: string;
}

export interface StartGameMessage {
  readonly type: 'START_GAME';
}

export interface CallTichuMessage {
  readonly type: 'CALL_TICHU';
}

export interface PlayCardsMessage {
  readonly type: 'PLAY_CARDS';
  readonly cards: readonly Card[];
  readonly wish?: Rank;
  readonly dragonRecipient?: number;
}

export interface PassMessage {
  readonly type: 'PASS';
  readonly dragonRecipient?: number;
}

export interface ReconnectMessage {
  readonly type: 'RECONNECT';
  readonly reconnectToken: string;
}

export type ClientMessage =
  | JoinRoomMessage
  | StartGameMessage
  | CallTichuMessage
  | PlayCardsMessage
  | PassMessage
  | ReconnectMessage;

// --- Server -> Client ----------------------------------------------------

/** A player-masked view of `GameState`, sent instead of the raw state so
 * opponents' exact hands never reach the client. Mirrors the same
 * public/private split `encoding.ts`'s `encodeObservation` already
 * established for the AI: the viewer's own hand, seat-relative hand sizes
 * and collected-point totals, and public call/wish state -- never another
 * seat's exact cards. */
export interface PlayerView {
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
}

export interface StateUpdateMessage {
  readonly type: 'STATE_UPDATE';
  readonly view: PlayerView;
}

export interface ErrorMessage {
  readonly type: 'ERROR';
  readonly message: string;
}

export type ServerMessage = StateUpdateMessage | ErrorMessage;

export type ProtocolMessage = ClientMessage | ServerMessage;
