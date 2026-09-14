import { type Card, Rank, cardKey, createDeck, pointValue } from './cards';
import { type Combo, ComboType } from './combinations';
import {
  type GameState,
  NUM_PLAYERS,
  Phase,
  isAwaitingTichuDecision,
  legalCombos,
  nextUndecidedLargeTichuSeat,
} from './gameState';

// Card bitmask index -- must match ai/tichu_env/encoding.py's CARD_ORDER
// (create_deck() order), which cards.ts's createDeck() already mirrors.
const CARD_ORDER: readonly Card[] = createDeck();
const CARD_INDEX: ReadonlyMap<string, number> = new Map(CARD_ORDER.map((card, i) => [cardKey(card), i]));
const NUM_CARDS = CARD_ORDER.length;

// Rank enum values (0-16) already equal ai/tichu_env/cards.py's Rank member
// declaration order 1:1, so the rank itself doubles as its own index -- no
// separate RANK_INDEX lookup table is needed here.
const NUM_RANKS = 17;

// Declaration order matches ComboType in both combinations.ts and
// ai/tichu_env/combinations.py, which is what encoding.py's `tuple(ComboType)`
// iterates in.
const COMBO_TYPE_ORDER: readonly ComboType[] = [
  ComboType.Single,
  ComboType.Dog,
  ComboType.Pair,
  ComboType.Triple,
  ComboType.FullHouse,
  ComboType.Straight,
  ComboType.PairStraight,
  ComboType.BombQuad,
  ComboType.BombStraightFlush,
];
const COMBO_TYPE_INDEX: ReadonlyMap<ComboType, number> = new Map(COMBO_TYPE_ORDER.map((t, i) => [t, i]));
const NUM_COMBO_TYPES = COMBO_TYPE_ORDER.length;

// Declaration order matches Phase in both gameState.ts and
// ai/tichu_env/state.py, which is what encoding.py's `tuple(Phase)` iterates in.
const PHASE_ORDER: readonly Phase[] = [Phase.LargeTichu, Phase.Exchange, Phase.Playing, Phase.RoundOver];
const PHASE_INDEX: ReadonlyMap<Phase, number> = new Map(PHASE_ORDER.map((p, i) => [p, i]));
const NUM_PHASES = PHASE_ORDER.length;

const MAX_HAND_SIZE = 14;
const MAX_STRENGTH: number = Rank.Dragon;

// --- Observation layout -----------------------------------------------------
// Every block below only encodes information that is legitimately public or
// belongs to the observing player: their own hand, cards already visible on
// the table, seat-relative status flags, and public call/wish state. No
// opponent's exact hand contents ever appear.
const OWN_HAND_DIM = NUM_CARDS;
const TRICK_CARDS_DIM = NUM_CARDS;
const COLLECTED_POINTS_DIM = NUM_PLAYERS;
const HAND_SIZES_DIM = NUM_PLAYERS;
const CURRENT_BEST_DIM = 1 + NUM_COMBO_TYPES + 2; // has_current_best, combo_type, length, strength
const CURRENT_PLAYER_DIM = NUM_PLAYERS;
const TRICK_LEADER_DIM = NUM_PLAYERS;
const LAST_PLAYER_DIM = 1 + NUM_PLAYERS; // has_last_player, relative seat
const TICHU_CALLS_DIM = NUM_PLAYERS;
// Per seat: [called, declined] -- both zero means "hasn't decided yet" (the
// largeTichuCalls field is boolean | null). Collapsing undecided and declined
// to the same value would hide real information during the LARGE_TICHU phase.
const LARGE_TICHU_CALLS_DIM = 2 * NUM_PLAYERS;
const MAHJONG_WISH_DIM = 1 + NUM_RANKS; // no_wish, wished rank
const FINISHED_DIM = NUM_PLAYERS;
const PHASE_DIM = NUM_PHASES;
// One NUM_CARDS-wide one-hot slot per opponent (relative offsets 1..3), for
// the card each of them gave the observing player during the exchange.
const EXCHANGE_RECEIVED_DIM = (NUM_PLAYERS - 1) * NUM_CARDS;
const PASSES_DIM = 1; // normalized count of consecutive passes on the current trick

export const OBS_DIM =
  OWN_HAND_DIM +
  TRICK_CARDS_DIM +
  COLLECTED_POINTS_DIM +
  HAND_SIZES_DIM +
  CURRENT_BEST_DIM +
  CURRENT_PLAYER_DIM +
  TRICK_LEADER_DIM +
  LAST_PLAYER_DIM +
  TICHU_CALLS_DIM +
  LARGE_TICHU_CALLS_DIM +
  MAHJONG_WISH_DIM +
  FINISHED_DIM +
  PHASE_DIM +
  EXCHANGE_RECEIVED_DIM +
  PASSES_DIM;

// --- Action layout -----------------------------------------------------------
// cards used, combo type, length, rank strength, is_lone_phoenix,
// is_large_tichu_call, is_large_tichu_decline, is_tichu_call, is_tichu_decline,
// is_pass (kept last so it stays addressable as vec[-1], matching every
// existing PASS-detection call site).
const LARGE_TICHU_CALL_OFFSET = 3;
const LARGE_TICHU_DECLINE_OFFSET = 4;
const TICHU_CALL_OFFSET = 5;
const TICHU_DECLINE_OFFSET = 6;
export const ACTION_DIM = NUM_CARDS + NUM_COMBO_TYPES + 8;

export function encodeObservation(state: GameState, player: number): readonly number[] {
  const seats = [0, 1, 2, 3];
  const seatOf = (offset: number): number => (player + offset) % NUM_PLAYERS;

  const parts: readonly Float32Array[] = [
    cardsBitmask(state.hands[player]!),
    cardsBitmask(state.trickCards),
    Float32Array.from(seats.map((o) => points(state.collectedTricks[seatOf(o)]!) / 100.0)),
    Float32Array.from(seats.map((o) => state.hands[seatOf(o)]!.length / MAX_HAND_SIZE)),
    encodeCurrentBest(state.currentBest, state.currentStrength),
    relativeSeatOnehot(state.currentPlayer, player),
    relativeSeatOnehot(state.trickLeader, player),
    encodeOptionalSeat(state.lastPlayerToAct, player),
    Float32Array.from(seats.map((o) => (state.tichuCalls[seatOf(o)] ? 1.0 : 0.0))),
    encodeLargeTichuCalls(state.largeTichuCalls, player),
    encodeMahjongWish(state.mahjongWish),
    Float32Array.from(seats.map((o) => (state.finishedOrder.includes(seatOf(o)) ? 1.0 : 0.0))),
    encodePhase(state.phase),
    encodeExchangeReceived(state.receivedFrom[player]!, player),
    Float32Array.from([state.passesInARow / NUM_PLAYERS]),
  ];
  return Array.from(concatFloat32(parts));
}

/** Encode a single candidate action. `combo=null` represents PASS. */
export function encodeAction(combo: Combo | null): readonly number[] {
  const vec = new Float32Array(ACTION_DIM);
  if (combo === null) {
    vec[ACTION_DIM - 1] = 1.0;
    return Array.from(vec);
  }
  for (const card of combo.cards) {
    vec[CARD_INDEX.get(cardKey(card))!] = 1.0;
  }
  vec[NUM_CARDS + COMBO_TYPE_INDEX.get(combo.comboType)!] = 1.0;
  vec[NUM_CARDS + NUM_COMBO_TYPES] = combo.length / MAX_HAND_SIZE;
  vec[NUM_CARDS + NUM_COMBO_TYPES + 1] = combo.rankStrength / MAX_STRENGTH;
  vec[NUM_CARDS + NUM_COMBO_TYPES + 2] = combo.isLonePhoenix ? 1.0 : 0.0;
  return Array.from(vec);
}

/** Encode the large-Tichu call/decline pseudo-action offered once per player
 * before the final 6 cards are dealt (see `Phase.LargeTichu`). Carries no
 * card information -- just a flag bit, the same pattern PASS already uses. */
export function encodeLargeTichuAction(called: boolean): readonly number[] {
  const vec = new Float32Array(ACTION_DIM);
  vec[NUM_CARDS + NUM_COMBO_TYPES + (called ? LARGE_TICHU_CALL_OFFSET : LARGE_TICHU_DECLINE_OFFSET)] = 1.0;
  return Array.from(vec);
}

/** Encode the (small) Tichu call/decline pseudo-action offered once per
 * player right before their first trick-play action (see
 * `isAwaitingTichuDecision`). Same flag-bit pattern as
 * `encodeLargeTichuAction`, in its own disjoint pair of offsets so the
 * network can tell the two decisions apart. */
export function encodeTichuAction(called: boolean): readonly number[] {
  const vec = new Float32Array(ACTION_DIM);
  vec[NUM_CARDS + NUM_COMBO_TYPES + (called ? TICHU_CALL_OFFSET : TICHU_DECLINE_OFFSET)] = 1.0;
  return Array.from(vec);
}

export interface LegalActionCandidate {
  readonly action: Combo | boolean | null;
  readonly vector: readonly number[];
}

/** All legal candidate actions for `player` right now, each paired with its
 * encoded vector.
 *
 * During `Phase.LargeTichu`, the only decision is call (`true`) or decline
 * (`false`) large Tichu, offered exactly once per player and only once it is
 * that player's turn in the AI/self-play sequencing (see
 * `nextUndecidedLargeTichuSeat` -- real multiplayer's `decideLargeTichu`
 * itself stays order-independent, this gate only applies to what this
 * function offers) -- everyone else sees no legal actions yet.
 *
 * Once playing has started, a player who hasn't yet decided on the (small)
 * Tichu call and still holds their full 14-card hand sees the same kind of
 * call/decline choice instead of trick-play candidates, gated the same way
 * (only once it is their turn -- see `isAwaitingTichuDecision`).
 *
 * Otherwise (ordinary trick play), PASS (`null`) is included only when it is
 * actually `player`'s turn and there is a current trick to pass on (you
 * cannot pass while leading, and a non-turn player may only interrupt with a
 * bomb, never pass). */
export function encodeLegalActions(state: GameState, player: number): readonly LegalActionCandidate[] {
  if (state.phase === Phase.LargeTichu) {
    if (player !== nextUndecidedLargeTichuSeat(state.largeTichuCalls)) return [];
    return [
      { action: true, vector: encodeLargeTichuAction(true) },
      { action: false, vector: encodeLargeTichuAction(false) },
    ];
  }

  if (isAwaitingTichuDecision(state, player)) {
    if (player !== state.currentPlayer) return [];
    return [
      { action: true, vector: encodeTichuAction(true) },
      { action: false, vector: encodeTichuAction(false) },
    ];
  }

  const candidates: (Combo | null)[] = [...legalCombos(state, player)];
  if (state.currentBest !== null && player === state.currentPlayer) {
    candidates.push(null);
  }
  return candidates.map((combo) => ({ action: combo, vector: encodeAction(combo) }));
}

function cardsBitmask(cards: readonly Card[]): Float32Array {
  const vec = new Float32Array(NUM_CARDS);
  for (const card of cards) {
    vec[CARD_INDEX.get(cardKey(card))!] = 1.0;
  }
  return vec;
}

function seatOffset(seat: number, perspective: number): number {
  return (((seat - perspective) % NUM_PLAYERS) + NUM_PLAYERS) % NUM_PLAYERS;
}

function relativeSeatOnehot(seat: number, perspective: number): Float32Array {
  const vec = new Float32Array(NUM_PLAYERS);
  vec[seatOffset(seat, perspective)] = 1.0;
  return vec;
}

function encodeOptionalSeat(seat: number | null, perspective: number): Float32Array {
  const vec = new Float32Array(1 + NUM_PLAYERS);
  if (seat === null) return vec;
  vec[0] = 1.0;
  vec[1 + seatOffset(seat, perspective)] = 1.0;
  return vec;
}

function encodeCurrentBest(combo: Combo | null, strength: number): Float32Array {
  const vec = new Float32Array(CURRENT_BEST_DIM);
  if (combo === null) return vec;
  vec[0] = 1.0;
  vec[1 + COMBO_TYPE_INDEX.get(combo.comboType)!] = 1.0;
  vec[1 + NUM_COMBO_TYPES] = combo.length / MAX_HAND_SIZE;
  vec[1 + NUM_COMBO_TYPES + 1] = strength / MAX_STRENGTH;
  return vec;
}

function encodeMahjongWish(wish: Rank | null): Float32Array {
  const vec = new Float32Array(MAHJONG_WISH_DIM);
  if (wish === null) {
    vec[0] = 1.0;
    return vec;
  }
  vec[1 + wish] = 1.0;
  return vec;
}

function encodeLargeTichuCalls(calls: readonly (boolean | null)[], perspective: number): Float32Array {
  const vec = new Float32Array(LARGE_TICHU_CALLS_DIM);
  for (let offset = 0; offset < NUM_PLAYERS; offset += 1) {
    const call = calls[(perspective + offset) % NUM_PLAYERS];
    if (call === true) vec[2 * offset] = 1.0;
    else if (call === false) vec[2 * offset + 1] = 1.0;
  }
  return vec;
}

function encodePhase(phase: Phase): Float32Array {
  const vec = new Float32Array(PHASE_DIM);
  vec[PHASE_INDEX.get(phase)!] = 1.0;
  return vec;
}

function encodeExchangeReceived(received: Readonly<Record<number, Card>>, perspective: number): Float32Array {
  const vec = new Float32Array(EXCHANGE_RECEIVED_DIM);
  for (let offset = 1; offset < NUM_PLAYERS; offset += 1) {
    const giver = (perspective + offset) % NUM_PLAYERS;
    const card = received[giver];
    if (card !== undefined) {
      vec[(offset - 1) * NUM_CARDS + CARD_INDEX.get(cardKey(card))!] = 1.0;
    }
  }
  return vec;
}

function points(cards: readonly Card[]): number {
  return cards.reduce((sum, c) => sum + pointValue(c), 0);
}

// Every sub-block above is built as a Float32Array so each element is
// float32-rounded at the point of assignment -- matching ai/tichu_env's
// per-block `dtype=np.float32` numpy arrays -- rather than only rounding
// once at the very end, which could round differently.
function concatFloat32(parts: readonly Float32Array[]): Float32Array {
  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const result = new Float32Array(total);
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }
  return result;
}
