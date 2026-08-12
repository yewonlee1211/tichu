import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import {
  NUM_PLAYERS,
  Phase,
  callTichu,
  dealNewRound,
  decideLargeTichu,
  exchangeCards,
  passTurn,
  playCombo,
  type Card,
  type ClientMessage,
  type ErrorMessage,
  type GameState,
  type Gifts,
  type Result,
  type RoomJoinedMessage,
  type StateUpdateMessage,
} from '@tichu/shared';
import { createRoom, generateRoomCode, isRoomFull, joinRoom, leaveRoom, type Room } from './room';
import { SessionRegistry, type PlayerSession } from './session';
import { buildPlayerView } from './view';
import { logGameEvent, logOperational } from './logger';

interface GameRoom {
  room: Room;
  state: GameState | null;
  /** Gifts submitted so far this exchange phase, keyed by giver seat.
   * Reset once all four have submitted (whether the merge succeeds or not
   * -- a failed merge means at least one submission was invalid, so all
   * four re-submit rather than leaving stale gifts half-applied). */
  pendingGifts: Partial<Record<number, Record<number, Card>>>;
}

interface ConnectionContext {
  readonly reconnectToken: string;
  readonly roomCode: string;
  readonly seat: number;
}

export interface GameServerOptions {
  readonly port?: number;
  readonly gracePeriodMs?: number;
}

export class GameServer {
  private readonly wss: WebSocketServer;
  private readonly sessions: SessionRegistry;
  private readonly rooms = new Map<string, GameRoom>();
  /** roomCode -> seat -> the currently-live socket for that seat. Entries
   * are removed on disconnect and restored on a successful RECONNECT. */
  private readonly sockets = new Map<string, Map<number, WebSocket>>();
  private readonly connections = new Map<WebSocket, string>();

  constructor(options: GameServerOptions = {}) {
    this.sessions = new SessionRegistry({
      gracePeriodMs: options.gracePeriodMs,
      onExpire: (session) => this.handleSessionExpired(session),
    });
    this.wss = new WebSocketServer({ port: options.port ?? 0 });
    this.wss.on('listening', () => {
      logOperational('server_listening', { port: (this.wss.address() as AddressInfo).port });
    });
    this.wss.on('connection', (ws) => this.handleConnection(ws));
  }

  get address(): AddressInfo {
    return this.wss.address() as AddressInfo;
  }

  close(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.wss.close((error) => (error ? reject(error) : resolve()));
    });
  }

  private handleConnection(ws: WebSocket): void {
    ws.on('message', (data) => this.handleMessage(ws, data));
    ws.on('close', () => this.handleClose(ws));
  }

  private handleMessage(ws: WebSocket, data: RawData): void {
    let message: ClientMessage;
    try {
      message = JSON.parse(data.toString()) as ClientMessage;
    } catch {
      this.sendError(ws, 'malformed message: not valid JSON');
      return;
    }

    switch (message.type) {
      case 'JOIN_ROOM':
        this.handleJoinRoom(ws, message.roomCode, message.playerName);
        return;
      case 'START_GAME':
        this.handleStartGame(ws);
        return;
      case 'CALL_TICHU':
        this.applyAction(ws, (state, seat) => callTichu(state, seat));
        return;
      case 'DECIDE_GRAND_TICHU':
        this.applyAction(ws, (state, seat) => decideLargeTichu(state, seat, message.called));
        return;
      case 'EXCHANGE_CARDS':
        this.handleExchangeCards(ws, message.gifts);
        return;
      case 'PLAY_CARDS':
        this.applyAction(ws, (state, seat) =>
          playCombo(state, seat, message.cards, message.wish ?? null, message.dragonRecipient ?? null),
        );
        return;
      case 'PASS':
        this.applyAction(ws, (state, seat) => passTurn(state, seat, message.dragonRecipient ?? null));
        return;
      case 'RECONNECT':
        this.handleReconnect(ws, message.reconnectToken);
        return;
      default:
        this.sendError(ws, `unrecognized message type: ${(message as { type: string }).type}`);
    }
  }

  /** Room creation is not a separate message: JOIN_ROOM with an empty
   * `roomCode` asks the server to mint a fresh code (Task 10 owns
   * generation), while a non-empty `roomCode` joins an existing room. */
  private handleJoinRoom(ws: WebSocket, requestedCode: string, playerName: string): void {
    let gameRoom: GameRoom;
    let roomCode: string;
    if (requestedCode === '') {
      do {
        roomCode = generateRoomCode();
      } while (this.rooms.has(roomCode));
      gameRoom = { room: createRoom(roomCode), state: null, pendingGifts: {} };
      this.rooms.set(roomCode, gameRoom);
      logOperational('room_created', { roomCode });
    } else {
      const existing = this.rooms.get(requestedCode);
      if (existing === undefined) {
        this.sendError(ws, `room ${requestedCode} does not exist`);
        return;
      }
      roomCode = requestedCode;
      gameRoom = existing;
    }

    const joined = joinRoom(gameRoom.room, { playerId: randomUUID(), playerName });
    if (!joined.ok) {
      this.sendError(ws, joined.error);
      return;
    }
    gameRoom.room = joined.value.room;

    const session = this.sessions.register(roomCode, joined.value.seat);
    this.bindConnection(ws, roomCode, joined.value.seat, session.reconnectToken);
    logOperational('player_joined', { roomCode, seat: joined.value.seat, playerName });

    this.sendRoomJoined(ws, roomCode, joined.value.seat, session.reconnectToken);
    // Nothing further to broadcast if the game hasn't started -- STATE_UPDATE
    // carries a PlayerView, which only exists once there is a GameState.
    if (gameRoom.state !== null) this.broadcastState(gameRoom);
  }

  private handleStartGame(ws: WebSocket): void {
    const context = this.resolveConnection(ws);
    if (context === undefined) {
      this.sendError(ws, 'not joined to a room');
      return;
    }
    const gameRoom = this.rooms.get(context.roomCode);
    if (gameRoom === undefined) {
      this.sendError(ws, 'room no longer exists');
      return;
    }
    if (!isRoomFull(gameRoom.room)) {
      this.sendError(ws, 'room is not full yet');
      return;
    }
    if (gameRoom.state !== null) {
      this.sendError(ws, 'game has already started');
      return;
    }

    gameRoom.state = dealNewRound();
    logGameEvent('round_started', { roomCode: context.roomCode });
    this.broadcastState(gameRoom);
  }

  private handleExchangeCards(ws: WebSocket, gifts: Readonly<Record<number, Card>>): void {
    const context = this.resolveConnection(ws);
    if (context === undefined) {
      this.sendError(ws, 'not joined to a room');
      return;
    }
    const gameRoom = this.rooms.get(context.roomCode);
    if (gameRoom === undefined || gameRoom.state === null) {
      this.sendError(ws, 'game has not started yet');
      return;
    }
    if (gameRoom.state.phase !== Phase.Exchange) {
      this.sendError(ws, 'cards can only be exchanged during the exchange phase');
      return;
    }

    gameRoom.pendingGifts = { ...gameRoom.pendingGifts, [context.seat]: gifts };
    if (Object.keys(gameRoom.pendingGifts).length < NUM_PLAYERS) {
      return;
    }

    const merged = gameRoom.pendingGifts as Gifts;
    gameRoom.pendingGifts = {};
    const result = exchangeCards(gameRoom.state, merged);
    if (!result.ok) {
      this.sendError(ws, result.error);
      return;
    }
    gameRoom.state = result.value;
    logGameEvent('cards_exchanged', { roomCode: context.roomCode });
    this.broadcastState(gameRoom);
  }

  private applyAction(ws: WebSocket, reducer: (state: GameState, seat: number) => Result<GameState, string>): void {
    const context = this.resolveConnection(ws);
    if (context === undefined) {
      this.sendError(ws, 'not joined to a room');
      return;
    }
    const gameRoom = this.rooms.get(context.roomCode);
    if (gameRoom === undefined || gameRoom.state === null) {
      this.sendError(ws, 'game has not started yet');
      return;
    }

    const result = reducer(gameRoom.state, context.seat);
    if (!result.ok) {
      this.sendError(ws, result.error);
      return;
    }
    gameRoom.state = result.value;
    logGameEvent('state_transition', { roomCode: context.roomCode, seat: context.seat, phase: result.value.phase });
    this.broadcastState(gameRoom);
  }

  private handleReconnect(ws: WebSocket, reconnectToken: string): void {
    const result = this.sessions.reconnect(reconnectToken);
    if (!result.ok) {
      this.sendError(ws, result.error);
      return;
    }
    const gameRoom = this.rooms.get(result.value.roomCode);
    if (gameRoom === undefined) {
      this.sendError(ws, 'room no longer exists');
      return;
    }

    this.bindConnection(ws, result.value.roomCode, result.value.seat, reconnectToken);
    logOperational('player_reconnected', { roomCode: result.value.roomCode, seat: result.value.seat });
    this.sendRoomJoined(ws, result.value.roomCode, result.value.seat, reconnectToken);
    if (gameRoom.state !== null) this.sendState(ws, gameRoom, result.value.seat);
  }

  private handleClose(ws: WebSocket): void {
    const reconnectToken = this.connections.get(ws);
    if (reconnectToken === undefined) return;
    this.connections.delete(ws);

    const session = this.sessions.get(reconnectToken);
    if (session === undefined) return;
    this.sockets.get(session.roomCode)?.delete(session.seat);
    this.sessions.markDisconnected(reconnectToken);
    logOperational('player_disconnected', { roomCode: session.roomCode, seat: session.seat });
  }

  private handleSessionExpired(session: PlayerSession): void {
    const gameRoom = this.rooms.get(session.roomCode);
    if (gameRoom === undefined) return;

    const remaining = leaveRoom(gameRoom.room, session.seat);
    logOperational('seat_forfeited', { roomCode: session.roomCode, seat: session.seat });
    if (remaining === null) {
      this.rooms.delete(session.roomCode);
      this.sockets.delete(session.roomCode);
      logOperational('room_deleted', { roomCode: session.roomCode });
      return;
    }
    gameRoom.room = remaining;
    if (gameRoom.state !== null) this.broadcastState(gameRoom);
  }

  private bindConnection(ws: WebSocket, roomCode: string, seat: number, reconnectToken: string): void {
    this.connections.set(ws, reconnectToken);
    let roomSockets = this.sockets.get(roomCode);
    if (roomSockets === undefined) {
      roomSockets = new Map();
      this.sockets.set(roomCode, roomSockets);
    }
    roomSockets.set(seat, ws);
  }

  private resolveConnection(ws: WebSocket): ConnectionContext | undefined {
    const reconnectToken = this.connections.get(ws);
    if (reconnectToken === undefined) return undefined;
    const session = this.sessions.get(reconnectToken);
    if (session === undefined) return undefined;
    return { reconnectToken, roomCode: session.roomCode, seat: session.seat };
  }

  private broadcastState(gameRoom: GameRoom): void {
    const roomSockets = this.sockets.get(gameRoom.room.code);
    if (roomSockets === undefined) return;
    for (const [seat, ws] of roomSockets) {
      this.sendState(ws, gameRoom, seat);
    }
  }

  private sendState(ws: WebSocket, gameRoom: GameRoom, seat: number): void {
    if (gameRoom.state === null) return;
    const payload: StateUpdateMessage = { type: 'STATE_UPDATE', view: buildPlayerView(gameRoom.state, seat) };
    this.send(ws, payload);
  }

  private sendRoomJoined(ws: WebSocket, roomCode: string, seat: number, reconnectToken: string): void {
    const payload: RoomJoinedMessage = { type: 'ROOM_JOINED', roomCode, seat, reconnectToken };
    this.send(ws, payload);
  }

  private sendError(ws: WebSocket, message: string): void {
    const payload: ErrorMessage = { type: 'ERROR', message };
    this.send(ws, payload);
  }

  private send(ws: WebSocket, payload: RoomJoinedMessage | StateUpdateMessage | ErrorMessage): void {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
  }
}
