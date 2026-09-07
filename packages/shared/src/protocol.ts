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

export interface DecideGrandTichuMessage {
  readonly type: 'DECIDE_GRAND_TICHU';
  readonly called: boolean;
}

/** Key = seat of the recipient (the other three seats, never the sender's
 * own). The server collects one of these from all four players before
 * merging them into a single `Gifts` object and calling `exchangeCards`. */
export interface ExchangeCardsMessage {
  readonly type: 'EXCHANGE_CARDS';
  readonly gifts: Readonly<Record<number, Card>>;
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
  | DecideGrandTichuMessage
  | ExchangeCardsMessage
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
  /** Consecutive passes since the current trick's `currentBest` was set --
   * lets the client tell whether *this* pass would be the one that actually
   * closes the trick, as opposed to an earlier pass in the same trick (see
   * `isClosingPass` in the client's `legalPlay.ts`). */
  readonly passesInARow: number;
  /** [team(0,2) total, team(1,3) total] accumulated across the match so far,
   * not including the currently in-progress round. */
  readonly cumulativeScores: readonly [number, number];
}

export interface StateUpdateMessage {
  readonly type: 'STATE_UPDATE';
  readonly view: PlayerView;
}

/** Sent once to a connection right after JOIN_ROOM or RECONNECT succeeds --
 * neither had any success acknowledgment otherwise, leaving a room's own
 * creator with no way to learn the code the server just generated for it,
 * and no seat/reconnectToken for any joiner to hold onto. Not part of Task
 * 9's original 8 messages; added here because Tasks 10-11 (room codes,
 * reconnect tokens) are unusable without a reply carrying this data back. */
export interface RoomJoinedMessage {
  readonly type: 'ROOM_JOINED';
  readonly roomCode: string;
  readonly seat: number;
  readonly reconnectToken: string;
}

export interface ErrorMessage {
  readonly type: 'ERROR';
  readonly message: string;
}

export type ServerMessage = RoomJoinedMessage | StateUpdateMessage | ErrorMessage;

export type ProtocolMessage = ClientMessage | ServerMessage;
