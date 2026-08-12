import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  ComboType,
  PARTNER,
  Phase,
  Rank,
  legalCombos,
  type Card,
  type ClientMessage,
  type Combo,
  type GameState,
  type PlayerView,
  type ServerMessage,
} from '@tichu/shared';
import { GameServer } from './gameServer';

function startServer(gracePeriodMs?: number): GameServer {
  return new GameServer({ port: 0, gracePeriodMs });
}

// A single persistent 'message' listener per socket, queueing anything that
// arrives before it's asked for. Using `.once('message', ...)` per await
// would drop messages: when the server sends two replies back-to-back
// synchronously (as RECONNECT's ack + resync does), both 'message' events
// can fire before a promise's `.then` continuation gets a chance to attach
// the *next* one-shot listener, silently losing the second message.
const readers = new WeakMap<WebSocket, { queue: ServerMessage[]; waiters: Array<(message: ServerMessage) => void> }>();

function connect(server: GameServer): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${server.address.port}`);
    const state = { queue: [] as ServerMessage[], waiters: [] as Array<(message: ServerMessage) => void> };
    readers.set(ws, state);
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as ServerMessage;
      const waiter = state.waiters.shift();
      if (waiter !== undefined) waiter(message);
      else state.queue.push(message);
    });
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function send(ws: WebSocket, message: ClientMessage): void {
  ws.send(JSON.stringify(message));
}

function nextMessage(ws: WebSocket, timeoutMs = 2000): Promise<ServerMessage> {
  const state = readers.get(ws);
  if (state === undefined) throw new Error('nextMessage() called on a socket not created via connect()');
  const queued = state.queue.shift();
  if (queued !== undefined) return Promise.resolve(queued);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for a server message')), timeoutMs);
    state.waiters.push((message) => {
      clearTimeout(timer);
      resolve(message);
    });
  });
}

interface Player {
  readonly ws: WebSocket;
  readonly seat: number;
  readonly reconnectToken: string;
}

async function joinFourPlayers(server: GameServer): Promise<{ roomCode: string; players: Player[] }> {
  const creator = await connect(server);
  send(creator, { type: 'JOIN_ROOM', roomCode: '', playerName: 'p0' });
  const created = await nextMessage(creator);
  if (created.type !== 'ROOM_JOINED') throw new Error(`expected ROOM_JOINED, got ${created.type}`);
  const roomCode = created.roomCode;
  const players: Player[] = [{ ws: creator, seat: created.seat, reconnectToken: created.reconnectToken }];

  for (const name of ['p1', 'p2', 'p3']) {
    const ws = await connect(server);
    send(ws, { type: 'JOIN_ROOM', roomCode, playerName: name });
    const joined = await nextMessage(ws);
    if (joined.type !== 'ROOM_JOINED') throw new Error(`expected ROOM_JOINED, got ${joined.type}`);
    players.push({ ws, seat: joined.seat, reconnectToken: joined.reconnectToken });
  }

  players.sort((a, b) => a.seat - b.seat);
  return { roomCode, players };
}

// -- A minimal bot: only enough strategy to reliably drive a round from
// deal to ROUND_OVER, using whatever cards the (random) shuffle produced.
// Never sets a Mahjong wish, so `mahjongWish` stays null and the
// wish-must-be-fulfilled rule in playCombo/passTurn never comes into play.

function legalCombosForView(view: PlayerView): Combo[] {
  const hands: Card[][] = [[], [], [], []];
  hands[view.viewerSeat] = [...view.hand];
  const fakeState: GameState = {
    hands,
    pendingFinalCards: [[], [], [], []],
    phase: view.phase,
    currentPlayer: view.currentPlayer,
    trickLeader: view.trickLeader,
    trickCards: view.trickCards,
    currentBest: view.currentBest,
    currentStrength: view.currentStrength,
    lastPlayerToAct: view.lastPlayerToAct,
    passesInARow: 0,
    finishedOrder: view.finishedOrder,
    collectedTricks: [[], [], [], []],
    largeTichuCalls: view.largeTichuCalls,
    tichuCalls: view.tichuCalls,
    mahjongWish: view.mahjongWish,
  };
  return legalCombos(fakeState, view.viewerSeat);
}

function isLoneDragon(combo: Combo): boolean {
  return combo.comboType === ComboType.Single && combo.cards[0]?.rank === Rank.Dragon;
}

function isDragonSingle(combo: Combo | null): boolean {
  return combo !== null && isLoneDragon(combo);
}

// `winnerSeat` is whoever is about to be awarded the trick (the Dragon's
// player), not the caller -- resolveTrickRecipient rejects a recipient on
// the *winner's* team, so this must always be computed relative to them.
function chooseDragonRecipient(winnerSeat: number, finishedOrder: readonly number[]): number {
  const partner = PARTNER[winnerSeat]!;
  const opponents = [0, 1, 2, 3].filter((s) => s !== winnerSeat && s !== partner);
  return opponents.find((s) => !finishedOrder.includes(s)) ?? opponents[0]!;
}

function chooseAction(view: PlayerView): ClientMessage {
  const combos = legalCombosForView(view);

  if (combos.length === 0) {
    // A trick only closes on PASS when someone else's Dragon is the
    // standing best -- `lastPlayerToAct` is that winner, not `viewerSeat`.
    const dragonRecipient = isDragonSingle(view.currentBest)
      ? chooseDragonRecipient(view.lastPlayerToAct!, view.finishedOrder)
      : undefined;
    return dragonRecipient === undefined ? { type: 'PASS' } : { type: 'PASS', dragonRecipient };
  }

  // Prefer a non-Dragon single so a forced Dragon-single lead is rare; fall
  // back to whatever is legal (Dog, a multi-card combo, or a forced Dragon)
  // otherwise, so the bot always makes forward progress.
  const nonDragonSingles = combos.filter((c) => c.comboType === ComboType.Single && !isLoneDragon(c));
  const chosen = nonDragonSingles[0] ?? combos[0]!;
  // Here the viewer themself is about to become the trick's winner.
  const dragonRecipient = isLoneDragon(chosen) ? chooseDragonRecipient(view.viewerSeat, view.finishedOrder) : undefined;
  return dragonRecipient === undefined
    ? { type: 'PLAY_CARDS', cards: chosen.cards }
    : { type: 'PLAY_CARDS', cards: chosen.cards, dragonRecipient };
}

describe('GameServer', () => {
  const servers: GameServer[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const ws of sockets.splice(0)) ws.terminate();
    for (const server of servers.splice(0)) await server.close();
  });

  it('creates a room, seats four players, and rejects a fifth join', async () => {
    const server = startServer();
    servers.push(server);

    const { roomCode, players } = await joinFourPlayers(server);
    sockets.push(...players.map((p) => p.ws));
    expect(players.map((p) => p.seat)).toEqual([0, 1, 2, 3]);

    const fifth = await connect(server);
    sockets.push(fifth);
    send(fifth, { type: 'JOIN_ROOM', roomCode, playerName: 'e' });
    const rejection = await nextMessage(fifth);

    expect(rejection.type).toBe('ERROR');
    if (rejection.type !== 'ERROR') throw new Error('unreachable');
    expect(rejection.message).toMatch(/full/);
  });

  it('preserves a seat through a forced disconnect and resyncs state on reconnect within the grace period', async () => {
    const server = startServer(1000);
    servers.push(server);
    const { roomCode, players } = await joinFourPlayers(server);
    sockets.push(...players.map((p) => p.ws));

    send(players[0]!.ws, { type: 'START_GAME' });
    await Promise.all(players.map((p) => nextMessage(p.ws)));

    const dropped = players[1]!;
    dropped.ws.terminate();
    await new Promise((resolve) => setTimeout(resolve, 100));

    const reconnected = await connect(server);
    sockets.push(reconnected);
    send(reconnected, { type: 'RECONNECT', reconnectToken: dropped.reconnectToken });

    const ack = await nextMessage(reconnected);
    expect(ack.type).toBe('ROOM_JOINED');
    if (ack.type !== 'ROOM_JOINED') throw new Error('unreachable');
    expect(ack.roomCode).toBe(roomCode);
    expect(ack.seat).toBe(dropped.seat);

    const resynced = await nextMessage(reconnected);
    expect(resynced.type).toBe('STATE_UPDATE');
    if (resynced.type !== 'STATE_UPDATE') throw new Error('unreachable');
    expect(resynced.view.viewerSeat).toBe(dropped.seat);
    expect(resynced.view.phase).toBe(Phase.LargeTichu);
  });

  it('drives four mock clients through a full round to completion', async () => {
    const server = startServer();
    servers.push(server);
    const { players } = await joinFourPlayers(server);
    sockets.push(...players.map((p) => p.ws));

    const views = new Map<number, PlayerView>();

    // On success every seat (including the actor) gets its own STATE_UPDATE
    // via broadcastState. On failure ONLY the actor gets an ERROR -- the
    // other three sockets get nothing at all. So check the actor's own
    // response first: a rejection fails the test immediately with the
    // server's reason instead of hanging the other three on Promise.all.
    async function sendActionAndCollect(actor: Player, action: ClientMessage): Promise<void> {
      send(actor.ws, action);
      const first = await nextMessage(actor.ws);
      if (first.type === 'ERROR') {
        throw new Error(`action ${JSON.stringify(action)} from seat ${actor.seat} was rejected: ${first.message}`);
      }
      if (first.type !== 'STATE_UPDATE') throw new Error(`expected STATE_UPDATE, got ${first.type}`);
      views.set(first.view.viewerSeat, first.view);

      const others = players.filter((p) => p !== actor);
      const rest = await Promise.all(others.map((p) => nextMessage(p.ws)));
      for (const message of rest) {
        if (message.type !== 'STATE_UPDATE') throw new Error(`expected STATE_UPDATE, got ${message.type}`);
        views.set(message.view.viewerSeat, message.view);
      }
    }

    async function broadcastAndCollect(): Promise<void> {
      const messages = await Promise.all(players.map((p) => nextMessage(p.ws)));
      for (const message of messages) {
        if (message.type !== 'STATE_UPDATE') throw new Error(`expected STATE_UPDATE, got ${message.type}`);
        views.set(message.view.viewerSeat, message.view);
      }
    }

    send(players[0]!.ws, { type: 'START_GAME' });
    await broadcastAndCollect();
    expect(views.get(0)?.phase).toBe(Phase.LargeTichu);

    for (const player of players) {
      await sendActionAndCollect(player, { type: 'DECIDE_GRAND_TICHU', called: false });
    }
    expect(views.get(0)?.phase).toBe(Phase.Exchange);

    for (const player of players) {
      const hand = views.get(player.seat)!.hand;
      const others = [0, 1, 2, 3].filter((s) => s !== player.seat);
      const gifts: Record<number, Card> = {};
      others.forEach((seat, i) => {
        gifts[seat] = hand[i]!;
      });
      // Only the fourth submission triggers a broadcast -- the server waits
      // until it has all four before merging and applying exchangeCards.
      if (player === players[players.length - 1]) {
        await sendActionAndCollect(player, { type: 'EXCHANGE_CARDS', gifts });
      } else {
        send(player.ws, { type: 'EXCHANGE_CARDS', gifts });
      }
    }
    expect(views.get(0)?.phase).toBe(Phase.Playing);

    const maxTurns = 300;
    let turns = 0;
    while (views.get(0)!.phase !== Phase.RoundOver) {
      turns += 1;
      if (turns > maxTurns) throw new Error(`round did not finish within ${maxTurns} turns`);

      const actingSeat = views.get(0)!.currentPlayer;
      const actor = players.find((p) => p.seat === actingSeat)!;
      const action = chooseAction(views.get(actingSeat)!);
      await sendActionAndCollect(actor, action);
    }

    for (const seat of [0, 1, 2, 3]) {
      expect(views.get(seat)?.phase).toBe(Phase.RoundOver);
    }
    expect(views.get(0)!.finishedOrder.length).toBeGreaterThanOrEqual(2);
  }, 20_000);

  it('scores a finished round into cumulativeScores and automatically deals the next round', async () => {
    const server = startServer();
    servers.push(server);
    const { players } = await joinFourPlayers(server);
    sockets.push(...players.map((p) => p.ws));

    const views = new Map<number, PlayerView>();

    async function sendActionAndCollect(actor: Player, action: ClientMessage): Promise<void> {
      send(actor.ws, action);
      const first = await nextMessage(actor.ws);
      if (first.type === 'ERROR') {
        throw new Error(`action ${JSON.stringify(action)} from seat ${actor.seat} was rejected: ${first.message}`);
      }
      if (first.type !== 'STATE_UPDATE') throw new Error(`expected STATE_UPDATE, got ${first.type}`);
      views.set(first.view.viewerSeat, first.view);

      const others = players.filter((p) => p !== actor);
      const rest = await Promise.all(others.map((p) => nextMessage(p.ws)));
      for (const message of rest) {
        if (message.type !== 'STATE_UPDATE') throw new Error(`expected STATE_UPDATE, got ${message.type}`);
        views.set(message.view.viewerSeat, message.view);
      }
    }

    async function broadcastAndCollect(): Promise<void> {
      const messages = await Promise.all(players.map((p) => nextMessage(p.ws)));
      for (const message of messages) {
        if (message.type !== 'STATE_UPDATE') throw new Error(`expected STATE_UPDATE, got ${message.type}`);
        views.set(message.view.viewerSeat, message.view);
      }
    }

    send(players[0]!.ws, { type: 'START_GAME' });
    await broadcastAndCollect();
    for (const seat of [0, 1, 2, 3]) {
      expect(views.get(seat)?.cumulativeScores).toEqual([0, 0]);
    }

    for (const player of players) {
      await sendActionAndCollect(player, { type: 'DECIDE_GRAND_TICHU', called: false });
    }

    for (const player of players) {
      const hand = views.get(player.seat)!.hand;
      const others = [0, 1, 2, 3].filter((s) => s !== player.seat);
      const gifts: Record<number, Card> = {};
      others.forEach((seat, i) => {
        gifts[seat] = hand[i]!;
      });
      if (player === players[players.length - 1]) {
        await sendActionAndCollect(player, { type: 'EXCHANGE_CARDS', gifts });
      } else {
        send(player.ws, { type: 'EXCHANGE_CARDS', gifts });
      }
    }

    const maxTurns = 300;
    let turns = 0;
    while (views.get(0)!.phase !== Phase.RoundOver) {
      turns += 1;
      if (turns > maxTurns) throw new Error(`round did not finish within ${maxTurns} turns`);

      const actingSeat = views.get(0)!.currentPlayer;
      const actor = players.find((p) => p.seat === actingSeat)!;
      const action = chooseAction(views.get(actingSeat)!);
      await sendActionAndCollect(actor, action);
    }

    // The ROUND_OVER broadcast (from the winning play/pass itself) already
    // carries the updated cumulative score -- no separate action needed.
    const [team0AfterRound, team1AfterRound] = views.get(0)!.cumulativeScores;
    expect(team0AfterRound !== 0 || team1AfterRound !== 0).toBe(true);
    for (const seat of [1, 2, 3]) {
      expect(views.get(seat)?.cumulativeScores).toEqual([team0AfterRound, team1AfterRound]);
    }

    // The server deals and broadcasts the next round automatically -- no
    // client sends anything here, just read the message each socket already
    // has queued from the server's second broadcast.
    await broadcastAndCollect();
    for (const seat of [0, 1, 2, 3]) {
      expect(views.get(seat)?.phase).toBe(Phase.LargeTichu);
      expect(views.get(seat)?.finishedOrder).toEqual([]);
      expect(views.get(seat)?.cumulativeScores).toEqual([team0AfterRound, team1AfterRound]);
    }
  }, 20_000);

  it('rejects JOIN_ROOM for a room code that does not exist', async () => {
    const server = startServer();
    servers.push(server);
    const ws = await connect(server);
    sockets.push(ws);

    send(ws, { type: 'JOIN_ROOM', roomCode: 'NOSUCH', playerName: 'a' });
    const rejection = await nextMessage(ws);

    expect(rejection.type).toBe('ERROR');
    if (rejection.type !== 'ERROR') throw new Error('unreachable');
    expect(rejection.message).toMatch(/does not exist/);
  });

  it('rejects actions from a connection that never joined a room', async () => {
    const server = startServer();
    servers.push(server);
    const ws = await connect(server);
    sockets.push(ws);

    send(ws, { type: 'CALL_TICHU' });
    const rejection = await nextMessage(ws);

    expect(rejection.type).toBe('ERROR');
    if (rejection.type !== 'ERROR') throw new Error('unreachable');
    expect(rejection.message).toMatch(/not joined/);
  });

  it('rejects START_GAME while the room is not yet full, and again once already started', async () => {
    const server = startServer();
    servers.push(server);
    const creator = await connect(server);
    sockets.push(creator);
    send(creator, { type: 'JOIN_ROOM', roomCode: '', playerName: 'p0' });
    const created = await nextMessage(creator);
    if (created.type !== 'ROOM_JOINED') throw new Error('unreachable');

    send(creator, { type: 'START_GAME' });
    const tooEarly = await nextMessage(creator);
    expect(tooEarly.type).toBe('ERROR');
    if (tooEarly.type !== 'ERROR') throw new Error('unreachable');
    expect(tooEarly.message).toMatch(/not full/);

    const others: WebSocket[] = [];
    for (const name of ['p1', 'p2', 'p3']) {
      const ws = await connect(server);
      others.push(ws);
      send(ws, { type: 'JOIN_ROOM', roomCode: created.roomCode, playerName: name });
      const joined = await nextMessage(ws);
      if (joined.type !== 'ROOM_JOINED') throw new Error('unreachable');
    }
    sockets.push(...others);
    const allSockets = [creator, ...others];

    send(creator, { type: 'START_GAME' });
    await Promise.all(allSockets.map((ws) => nextMessage(ws)));

    send(creator, { type: 'START_GAME' });
    const alreadyStarted = await nextMessage(creator);
    expect(alreadyStarted.type).toBe('ERROR');
    if (alreadyStarted.type !== 'ERROR') throw new Error('unreachable');
    expect(alreadyStarted.message).toMatch(/already started/);
  });

  it('rejects EXCHANGE_CARDS before the game starts and outside the exchange phase', async () => {
    const server = startServer();
    servers.push(server);
    const { players } = await joinFourPlayers(server);
    sockets.push(...players.map((p) => p.ws));

    send(players[0]!.ws, { type: 'EXCHANGE_CARDS', gifts: {} });
    const beforeStart = await nextMessage(players[0]!.ws);
    expect(beforeStart.type).toBe('ERROR');
    if (beforeStart.type !== 'ERROR') throw new Error('unreachable');
    expect(beforeStart.message).toMatch(/not started/);

    send(players[0]!.ws, { type: 'START_GAME' });
    await Promise.all(players.map((p) => nextMessage(p.ws)));

    // Still LARGE_TICHU here (nobody has decided yet), not EXCHANGE.
    send(players[0]!.ws, { type: 'EXCHANGE_CARDS', gifts: {} });
    const wrongPhase = await nextMessage(players[0]!.ws);
    expect(wrongPhase.type).toBe('ERROR');
    if (wrongPhase.type !== 'ERROR') throw new Error('unreachable');
    expect(wrongPhase.message).toMatch(/exchange phase/);
  });

  it('rejects a malformed message and an unrecognized message type', async () => {
    const server = startServer();
    servers.push(server);
    const ws = await connect(server);
    sockets.push(ws);

    ws.send('not json{{{');
    const malformed = await nextMessage(ws);
    expect(malformed.type).toBe('ERROR');
    if (malformed.type !== 'ERROR') throw new Error('unreachable');
    expect(malformed.message).toMatch(/malformed/);

    ws.send(JSON.stringify({ type: 'NOT_A_REAL_MESSAGE_TYPE' }));
    const unrecognized = await nextMessage(ws);
    expect(unrecognized.type).toBe('ERROR');
    if (unrecognized.type !== 'ERROR') throw new Error('unreachable');
    expect(unrecognized.message).toMatch(/unrecognized/);
  });

  it('rejects a duplicate CALL_TICHU from the same seat without changing state', async () => {
    const server = startServer();
    servers.push(server);
    const { players } = await joinFourPlayers(server);
    sockets.push(...players.map((p) => p.ws));

    send(players[0]!.ws, { type: 'START_GAME' });
    await Promise.all(players.map((p) => nextMessage(p.ws)));
    // CALL_TICHU requires a full 14-card hand, which only exists from the
    // Exchange phase onward -- clear the large-tichu decision window first.
    for (const player of players) {
      send(player.ws, { type: 'DECIDE_GRAND_TICHU', called: false });
      await Promise.all(players.map((p) => nextMessage(p.ws)));
    }

    send(players[0]!.ws, { type: 'CALL_TICHU' });
    const first = await nextMessage(players[0]!.ws);
    expect(first.type).toBe('STATE_UPDATE');
    await Promise.all(players.slice(1).map((p) => nextMessage(p.ws)));

    send(players[0]!.ws, { type: 'CALL_TICHU' });
    const duplicate = await nextMessage(players[0]!.ws);
    expect(duplicate.type).toBe('ERROR');
    if (duplicate.type !== 'ERROR') throw new Error('unreachable');
    expect(duplicate.message).toMatch(/already called/);
  });

  it('rejects RECONNECT with an unknown reconnect token', async () => {
    const server = startServer();
    servers.push(server);
    const ws = await connect(server);
    sockets.push(ws);

    send(ws, { type: 'RECONNECT', reconnectToken: 'not-a-real-token' });
    const rejection = await nextMessage(ws);

    expect(rejection.type).toBe('ERROR');
    if (rejection.type !== 'ERROR') throw new Error('unreachable');
    expect(rejection.message).toMatch(/unknown/);
  });

  it('frees a forfeited seat but keeps the room alive for the remaining players once the grace period elapses', async () => {
    const server = startServer(200);
    servers.push(server);
    const { players } = await joinFourPlayers(server);
    sockets.push(...players.map((p) => p.ws));

    send(players[0]!.ws, { type: 'START_GAME' });
    await Promise.all(players.map((p) => nextMessage(p.ws)));

    const dropped = players[3]!;
    dropped.ws.terminate();

    const remaining = players.slice(0, 3);
    const updates = await Promise.all(remaining.map((p) => nextMessage(p.ws, 2000)));
    for (const update of updates) {
      expect(update.type).toBe('STATE_UPDATE');
    }
  });
});
