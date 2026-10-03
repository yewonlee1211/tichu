import { type Card, Rank, cardKey, containsCard, shuffledDeck, withoutCards } from './cards';
import { BOMB_TYPES, type Combo, ComboType, beats, effectiveStrength, identifyCombo } from './combinations';
import { candidateCardSets } from './legalMoves';
import { type Result, err, ok } from './result';

export const NUM_PLAYERS = 4;
export const PARTNER: Readonly<Record<number, number>> = { 0: 2, 1: 3, 2: 0, 3: 1 };
export const DEFAULT_TARGET_SCORE = 1000;

// String values match ai/tichu_env/state.py's Phase member *names*, for the
// same golden-fixture-comparability reason as combinations.ts's ComboType.
export enum Phase {
  LargeTichu = 'LARGE_TICHU',
  Exchange = 'EXCHANGE',
  Playing = 'PLAYING',
  RoundOver = 'ROUND_OVER',
}

export interface GameState {
  readonly hands: readonly (readonly Card[])[];
  readonly pendingFinalCards: readonly (readonly Card[])[];
  readonly phase: Phase;
  readonly currentPlayer: number;
  readonly trickLeader: number;
  readonly trickCards: readonly Card[];
  readonly currentBest: Combo | null;
  readonly currentStrength: number;
  readonly lastPlayerToAct: number | null;
  readonly passesInARow: number;
  readonly finishedOrder: readonly number[];
  readonly collectedTricks: readonly (readonly Card[])[];
  readonly largeTichuCalls: readonly (boolean | null)[];
  readonly tichuCalls: readonly boolean[];
  readonly mahjongWish: Rank | null;
  /** receivedFrom[recipient][giver] = card -- who gave `recipient` which card
   * during the exchange, populated by `exchangeCards`. Empty objects before
   * the exchange happens. Mirrors `ai/tichu_env/state.py`'s `received_from`:
   * kept as real state (not derived) since exchanged-card choice is strategic
   * signal the observation encoder needs to expose. */
  readonly receivedFrom: readonly Readonly<Record<number, Card>>[];
  /** Whether each player has passed through the (small) Tichu call/decline
   * decision point yet -- needed because `tichuCalls` alone is bool, not
   * bool | null, so it can't distinguish "declined" from "hasn't been asked
   * yet" the way `largeTichuCalls` can. See `isAwaitingTichuDecision`. Also
   * set true by `decideLargeTichu` when a player calls Grand Tichu -- that
   * supersedes the (small) Tichu decision, so they're never asked. */
  readonly tichuDecided: readonly boolean[];
  /** Cumulative game score per team (indexed by `teamOf`) as of the start of
   * this round, and the score at which a team wins the game. Mirrors
   * `ai/tichu_env/state.py`'s `team_scores`/`target_score`: only the enclosing
   * game loop changes these between rounds. */
  readonly teamScores: readonly [number, number];
  readonly targetScore: number;
}

export type Gifts = Record<number, Record<number, Card>>;

export function dealNewRound(deck: readonly Card[] = shuffledDeck()): GameState {
  const hands: Card[][] = [];
  const pendingFinalCards: Card[][] = [];
  for (let i = 0; i < NUM_PLAYERS; i += 1) {
    hands.push(deck.slice(i * 14, i * 14 + 8));
    pendingFinalCards.push(deck.slice(i * 14 + 8, i * 14 + 14));
  }
  return {
    hands,
    pendingFinalCards,
    phase: Phase.LargeTichu,
    currentPlayer: 0,
    trickLeader: 0,
    trickCards: [],
    currentBest: null,
    currentStrength: 0.0,
    lastPlayerToAct: null,
    passesInARow: 0,
    finishedOrder: [],
    collectedTricks: Array.from({ length: NUM_PLAYERS }, () => []),
    largeTichuCalls: [null, null, null, null],
    tichuCalls: [false, false, false, false],
    mahjongWish: null,
    receivedFrom: Array.from({ length: NUM_PLAYERS }, () => ({})),
    tichuDecided: [false, false, false, false],
    teamScores: [0, 0],
    targetScore: DEFAULT_TARGET_SCORE,
  };
}

/** Deliberately does NOT enforce `player === state.currentPlayer` (unlike
 * Python's `decide_large_tichu`, which does -- that's a self-play-only
 * simplification for sequencing the RL action space one seat at a time, no
 * longer applicable now that ai/tichu_env's `TichuEnv` auto-resolves this
 * decision internally rather than exposing it as an RL action; see
 * `TichuEnv._auto_resolve_calls`). Real Tichu's grand-Tichu decision is
 * simultaneous/order-independent, and `packages/server`'s multiplayer room
 * already relies on any of the four seats being able to decide whenever
 * their client sends the message -- adding turn enforcement here would
 * force human players to wait through a seat-order queue that the real game
 * doesn't have. */
export function decideLargeTichu(state: GameState, player: number, called: boolean): Result<GameState, string> {
  if (state.phase !== Phase.LargeTichu) {
    return err('large tichu can only be decided before the final 6 cards are dealt');
  }
  if (state.largeTichuCalls[player] !== null) {
    return err('player has already decided on large tichu');
  }

  const calls = [...state.largeTichuCalls];
  calls[player] = called;
  let next: GameState = { ...state, largeTichuCalls: calls };

  if (called) {
    // Calling Grand Tichu supersedes the (small) Tichu call -- the real
    // rules never offer that separate decision to a player who already
    // committed to the bigger bonus. Marking tichuDecided here keeps
    // isAwaitingTichuDecision's own check simple and keeps this player's
    // tichuCalls correctly false (they never actually called (small) Tichu,
    // they called Grand Tichu).
    const decided = [...next.tichuDecided];
    decided[player] = true;
    next = { ...next, tichuDecided: decided };
  }

  if (calls.every((c) => c !== null)) {
    const newHands = state.hands.map((hand, i) => [...hand, ...state.pendingFinalCards[i]!]);
    next = {
      ...next,
      hands: newHands,
      pendingFinalCards: Array.from({ length: NUM_PLAYERS }, () => []),
      phase: Phase.Exchange,
    };
  }
  return ok(next);
}

export function callTichu(state: GameState, player: number): Result<GameState, string> {
  if (state.phase !== Phase.Exchange && state.phase !== Phase.Playing) {
    return err('tichu can only be called after the large tichu decision window');
  }
  if (state.tichuCalls[player]) {
    return err('player has already called tichu');
  }
  if (state.hands[player]!.length !== 14) {
    return err('tichu can only be called while still holding all 14 cards');
  }

  const calls = [...state.tichuCalls];
  calls[player] = true;
  return ok({ ...state, tichuCalls: calls });
}

/** True iff `player` is exactly at the point where the (small) Tichu
 * call/decline decision should be offered before any trick-play action: the
 * playing phase has started, `player` hasn't decided yet, and they still
 * hold the full 14-card hand (their first card of the round hasn't been
 * played). This is the simplified "decide at your first play" window the M2
 * curriculum settled on, rather than the real rule's "anytime before your
 * first play" (which `callTichu` above still allows, unrestricted by this
 * flag) -- mirrors `ai/tichu_env/state.py`'s `is_awaiting_tichu_decision`. */
export function isAwaitingTichuDecision(state: GameState, player: number): boolean {
  return state.phase === Phase.Playing && !state.tichuDecided[player] && state.hands[player]!.length === 14;
}

/** The AI/self-play-facing counterpart to `callTichu`: a one-time forced
 * call-or-decline decision gated to `isAwaitingTichuDecision`'s window, and
 * (unlike `decideLargeTichu`) enforcing turn order -- safe to enforce here
 * because during `Phase.Playing`, `state.currentPlayer` already carries real
 * turn-order meaning (whoever must act next), so this isn't a new ordering
 * constraint the way it would have been during `Phase.LargeTichu`. Mirrors
 * `ai/tichu_env/state.py`'s `decide_tichu`. */
export function decideTichu(state: GameState, player: number, called: boolean): Result<GameState, string> {
  if (state.phase !== Phase.Playing) {
    return err('tichu can only be decided during the playing phase');
  }
  if (state.tichuDecided[player]) {
    return err('player has already decided on tichu');
  }
  if (player !== state.currentPlayer) {
    return err("it is not this player's turn to decide on tichu");
  }
  if (state.hands[player]!.length !== 14) {
    return err('tichu can only be decided while still holding all 14 cards');
  }

  const decided = [...state.tichuDecided];
  decided[player] = true;
  let next: GameState = { ...state, tichuDecided: decided };

  if (called) {
    const calls = [...state.tichuCalls];
    calls[player] = true;
    next = { ...next, tichuCalls: calls };
  }

  return ok(next);
}

export function exchangeCards(state: GameState, gifts: Gifts): Result<GameState, string> {
  if (state.phase !== Phase.Exchange) {
    return err('cards can only be exchanged during the exchange phase');
  }

  for (let giver = 0; giver < NUM_PLAYERS; giver += 1) {
    const recipients = gifts[giver] ?? {};
    const expected = new Set(
      Array.from({ length: NUM_PLAYERS }, (_, p) => p).filter((p) => p !== giver),
    );
    const actual = new Set(Object.keys(recipients).map(Number));
    if (actual.size !== expected.size || [...expected].some((p) => !actual.has(p))) {
      return err(`player ${giver} must give exactly one card to each of the other three players`);
    }
    const givenCards = Object.values(recipients);
    if (new Set(givenCards.map(cardKey)).size !== 3) {
      return err('cannot give the same physical card to more than one recipient');
    }
    for (const card of givenCards) {
      if (!containsCard(state.hands[giver]!, card)) {
        return err('cannot give away a card that is not in hand');
      }
    }
  }

  const incoming: Card[][] = Array.from({ length: NUM_PLAYERS }, () => []);
  const receivedFrom: Record<number, Card>[] = Array.from({ length: NUM_PLAYERS }, () => ({}));
  for (let giver = 0; giver < NUM_PLAYERS; giver += 1) {
    for (const [recipientStr, card] of Object.entries(gifts[giver] ?? {})) {
      const recipient = Number(recipientStr);
      incoming[recipient]!.push(card);
      receivedFrom[recipient]![giver] = card;
    }
  }

  const newHands: Card[][] = [];
  for (let player = 0; player < NUM_PLAYERS; player += 1) {
    const givenAway = Object.values(gifts[player] ?? {});
    const kept = withoutCards(state.hands[player]!, givenAway);
    newHands.push([...kept, ...incoming[player]!]);
  }

  const leader = newHands.findIndex((hand) => hand.some((c) => c.rank === Rank.Mahjong));

  return ok({
    ...state,
    hands: newHands,
    phase: Phase.Playing,
    currentPlayer: leader,
    trickLeader: leader,
    receivedFrom,
  });
}

function comboKey(cards: readonly Card[]): string {
  return cards.map(cardKey).sort().join('|');
}

/** All combos `player` may legally play right now. Only the trick leader may
 * open a fresh trick (any combo type, including a bomb); once a trick is
 * under way, ordinary combos are restricted to whoever's turn it is, while
 * bombs remain legal for any active player as an interrupt.
 *
 * If a Mahjong wish is outstanding and any of these combos would fulfill it
 * (contains a card of the wished rank), the result is narrowed to just those
 * -- mirroring the obligation `playCombo`/`passTurn` already enforce by
 * rejecting a submission that ignores a fulfillable wish. Without this, a
 * caller that treats this list as "the candidates to choose from" (the AI's
 * `encodeLegalActions`, and the client's play/submit UI) could offer or pick
 * a combo that the reducer would then reject, which for the AI meant an
 * unconditional `mustOk` throw instead of a graceful legality check. */
export function legalCombos(state: GameState, player: number): Combo[] {
  const hand = state.hands[player]!;
  const isLeading = state.currentBest === null;

  if (isLeading && player !== state.trickLeader) return [];

  const onlyBombs = !isLeading && player !== state.currentPlayer;

  const found: Combo[] = [];
  const seen = new Set<string>();
  for (const cards of candidateCardSets(hand)) {
    const key = comboKey(cards);
    if (seen.has(key)) continue;
    seen.add(key);
    const combo = identifyCombo(cards);
    if (combo === null) continue;
    if (combo.comboType === ComboType.Dog) {
      if (isLeading) found.push(combo);
      continue;
    }
    const isBomb = BOMB_TYPES.has(combo.comboType);
    if (onlyBombs && !isBomb) continue;
    if (isLeading) {
      found.push(combo);
    } else if (beats(combo, state.currentBest!, state.currentStrength)) {
      found.push(combo);
    }
  }

  if (state.mahjongWish !== null) {
    const wishedRank = state.mahjongWish;
    const fulfilling = found.filter((combo) => combo.cards.some((c) => c.rank === wishedRank));
    if (fulfilling.length > 0) return fulfilling;
  }

  return found;
}

export function playCombo(
  state: GameState,
  player: number,
  cards: readonly Card[],
  wish: Rank | null = null,
  dragonRecipient: number | null = null,
): Result<GameState, string> {
  if (state.phase !== Phase.Playing) {
    return err('cards can only be played during the playing phase');
  }
  if (state.finishedOrder.includes(player)) {
    return err('player has already finished this round');
  }

  const combo = identifyCombo(cards);
  if (combo === null) {
    return err('not a valid combination');
  }
  if (cards.some((c) => !containsCard(state.hands[player]!, c))) {
    return err('player does not hold all of these cards');
  }

  const isBomb = BOMB_TYPES.has(combo.comboType);
  const isDog = combo.comboType === ComboType.Dog;

  if (isDog) {
    if (state.currentBest !== null || player !== state.trickLeader) {
      return err('the Dog can only be played to open a trick');
    }
  } else if (state.currentBest === null) {
    if (player !== state.trickLeader) {
      return err('only the trick leader may open a new trick');
    }
  } else if (!isBomb && player !== state.currentPlayer) {
    return err("it is not this player's turn (only a bomb may interrupt)");
  }

  if (!isDog && state.currentBest !== null && !beats(combo, state.currentBest, state.currentStrength)) {
    return err('this combination does not beat the current trick');
  }

  if (wish !== null && !cards.some((c) => c.rank === Rank.Mahjong)) {
    return err('only a play that includes the Mahjong can set a wish');
  }

  if (
    state.mahjongWish !== null &&
    !cards.some((c) => c.rank === state.mahjongWish) &&
    wishFulfillingPlays(state, player).length > 0
  ) {
    return err(`must play a combination including the wished rank ${Rank[state.mahjongWish]}`);
  }

  const remainingHand = withoutCards(state.hands[player]!, cards);
  const newHands = [...state.hands];
  newHands[player] = remainingHand;

  let finishedOrder = state.finishedOrder;
  if (remainingHand.length === 0) {
    finishedOrder = [...finishedOrder, player];
  }
  const doubleWin = finishedOrder.length === 2 && PARTNER[finishedOrder[0]!] === finishedOrder[1];
  const roundOver = finishedOrder.length >= 3 || doubleWin;

  if (isDog) {
    const nextLeader = nextLeaderAfterDog(player, finishedOrder);
    return ok({
      ...state,
      hands: newHands,
      trickCards: [],
      currentBest: null,
      currentStrength: 0.0,
      lastPlayerToAct: null,
      passesInARow: 0,
      trickLeader: nextLeader,
      currentPlayer: nextLeader,
      finishedOrder,
      phase: roundOver ? Phase.RoundOver : Phase.Playing,
    });
  }

  const newStrength = effectiveStrength(combo, state.currentBest !== null ? state.currentStrength : null);

  let newWish = state.mahjongWish;
  if (cards.some((c) => c.rank === Rank.Mahjong)) {
    newWish = wish;
  } else if (state.mahjongWish !== null && cards.some((c) => c.rank === state.mahjongWish)) {
    newWish = null;
  }

  if (roundOver) {
    const recipientResult = resolveTrickRecipient(combo, player, dragonRecipient, finishedOrder);
    if (!recipientResult.ok) return recipientResult;
    const recipient = recipientResult.value;
    const collected = [...state.collectedTricks];
    collected[recipient] = [...collected[recipient]!, ...state.trickCards, ...cards];
    return ok({
      ...state,
      hands: newHands,
      trickCards: [],
      currentBest: null,
      currentStrength: 0.0,
      lastPlayerToAct: null,
      passesInARow: 0,
      finishedOrder,
      mahjongWish: newWish,
      collectedTricks: collected,
      phase: Phase.RoundOver,
    });
  }

  const nextPlayer = nextActivePlayer(player, finishedOrder);

  return ok({
    ...state,
    hands: newHands,
    trickCards: [...state.trickCards, ...cards],
    currentBest: combo,
    currentStrength: newStrength,
    lastPlayerToAct: player,
    passesInARow: 0,
    currentPlayer: nextPlayer,
    finishedOrder,
    mahjongWish: newWish,
    phase: Phase.Playing,
  });
}

export function passTurn(
  state: GameState,
  player: number,
  dragonRecipient: number | null = null,
): Result<GameState, string> {
  if (state.phase !== Phase.Playing) {
    return err('can only pass during the playing phase');
  }
  if (state.currentBest === null) {
    return err('the trick leader must play, not pass');
  }
  if (player !== state.currentPlayer) {
    return err("it is not this player's turn");
  }

  if (wishFulfillingPlays(state, player).length > 0) {
    return err(`must play a combination including the wished rank ${Rank[state.mahjongWish!]} instead of passing`);
  }

  const activeCount = NUM_PLAYERS - state.finishedOrder.length;
  const winner = state.lastPlayerToAct;
  if (winner === null) {
    throw new Error('invariant violated: passTurn requires a lastPlayerToAct while a trick is open');
  }
  const winnerStillActive = !state.finishedOrder.includes(winner);
  const neededPasses = winnerStillActive ? activeCount - 1 : activeCount;

  const passes = state.passesInARow + 1;
  if (passes < neededPasses) {
    return ok({
      ...state,
      passesInARow: passes,
      currentPlayer: nextActivePlayer(player, state.finishedOrder),
    });
  }

  const recipientResult = resolveTrickRecipient(state.currentBest, winner, dragonRecipient, state.finishedOrder);
  if (!recipientResult.ok) return recipientResult;
  const recipient = recipientResult.value;
  const collected = [...state.collectedTricks];
  collected[recipient] = [...collected[recipient]!, ...state.trickCards];

  // Unlike the Dog (which always hands the lead to the winner's partner --
  // see `nextLeaderAfterDog`), a trick winner who simply went out on their
  // winning play passes the lead to whoever is next in normal turn order --
  // see `ai/RULES.md`'s 5.6/5.10 sections for why these two cases were
  // wrongly conflated for a while.
  const nextLeader = state.finishedOrder.includes(winner) ? nextActivePlayer(winner, state.finishedOrder) : winner;

  return ok({
    ...state,
    trickCards: [],
    currentBest: null,
    currentStrength: 0.0,
    lastPlayerToAct: null,
    passesInARow: 0,
    trickLeader: nextLeader,
    currentPlayer: nextLeader,
    collectedTricks: collected,
  });
}

/** Who a just-completed trick's cards go to: normally the winner, but a
 * trick won with a lone Dragon single must go to a chosen opponent. */
function resolveTrickRecipient(
  winningCombo: Combo,
  winner: number,
  dragonRecipient: number | null,
  finishedOrder: readonly number[],
): Result<number, string> {
  const isDragonWin = winningCombo.comboType === ComboType.Single && winningCombo.cards[0]?.rank === Rank.Dragon;
  if (!isDragonWin) {
    if (dragonRecipient !== null) {
      return err('dragon_recipient is only used when the Dragon wins the trick');
    }
    return ok(winner);
  }
  if (dragonRecipient === null) {
    return err('winning a trick with the Dragon requires choosing an opponent to give it to');
  }
  if (dragonRecipient === winner || PARTNER[dragonRecipient] === winner) {
    return err("the Dragon trick must go to an opponent, not the winner's own team");
  }
  if (finishedOrder.includes(dragonRecipient)) {
    return err('cannot give the Dragon trick to a player who has already finished');
  }
  return ok(dragonRecipient);
}

/** Legal combos for `player` right now that would satisfy a pending Mahjong
 * wish. Empty if there is no wish, or no legal play can fulfill it. */
function wishFulfillingPlays(state: GameState, player: number): Combo[] {
  if (state.mahjongWish === null) return [];
  const wishedRank = state.mahjongWish;
  return legalCombos(state, player).filter((combo) => combo.cards.some((c) => c.rank === wishedRank));
}

function nextActivePlayer(current: number, finishedOrder: readonly number[]): number {
  let seat = (current + 1) % NUM_PLAYERS;
  while (finishedOrder.includes(seat)) {
    seat = (seat + 1) % NUM_PLAYERS;
  }
  return seat;
}

/** Dog hands the lead to the player's own teammate. If that teammate has
 * already finished, the lead instead goes to whoever is next in the normal
 * turn order (seat number ascending, wrapping around) after the teammate's
 * seat -- not back to `player`'s own seat first. */
function nextLeaderAfterDog(player: number, finishedOrder: readonly number[]): number {
  const partner = PARTNER[player]!;
  if (!finishedOrder.includes(partner)) return partner;
  return nextActivePlayer(partner, finishedOrder);
}
