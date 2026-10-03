import { type Card, Rank, cardKey, createDeck, pointValue } from './cards';
import { type Combo, ComboType } from './combinations';
import { teamOf } from './scoring';
import { type GameState, NUM_PLAYERS, Phase, isAwaitingTichuDecision, legalCombos } from './gameState';

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
// Per seat, a one-hot over the 4 mutually exclusive Tichu-call states:
// [undecided, declined_both, called_tichu, called_grand_tichu]. Grand Tichu
// supersedes the (small) Tichu decision (see gameState.ts's decideLargeTichu),
// so these never overlap -- a single categorical block is enough, replacing
// what used to be two separate scalar/2-bit blocks (Tichu-only,
// Grand-Tichu-only). Must match encoding.py's _TICHU_STATUS_* layout.
const TICHU_STATUS_UNDECIDED = 0;
const TICHU_STATUS_DECLINED = 1;
const TICHU_STATUS_TICHU = 2;
const TICHU_STATUS_GRAND_TICHU = 3;
const NUM_TICHU_STATUSES = 4;
const TICHU_STATUS_DIM = NUM_TICHU_STATUSES * NUM_PLAYERS;
// [own team, opposing team], each (targetScore - teamScore) / targetScore.
// Must match encoding.py's _REMAINING_TO_WIN_DIM block.
const REMAINING_TO_WIN_DIM = 2;
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
  TICHU_STATUS_DIM +
  REMAINING_TO_WIN_DIM +
  MAHJONG_WISH_DIM +
  FINISHED_DIM +
  PHASE_DIM +
  EXCHANGE_RECEIVED_DIM +
  PASSES_DIM;

// --- Action layout -----------------------------------------------------------
// cards used, combo type, length, rank strength, is_lone_phoenix, is_pass
// (kept last so it stays addressable as vec[-1], matching every existing
// PASS-detection call site). Large-Tichu and (small) Tichu call/decline used
// to occupy 4 more offsets here as RL pseudo-actions; they are now auto-
// resolved by ai/tichu_env's TichuEnv via a fixed heuristic instead (see its
// class docstring and .claude/plans/tichu-m2-action-space-curriculum.plan.md),
// so this action space covers trick play only -- must match encoding.py's
// ACTION_DIM.
export const ACTION_DIM = NUM_CARDS + NUM_COMBO_TYPES + 4;

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
    encodeTichuStatus(state, player),
    encodeRemainingToWin(state, player),
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

export interface LegalActionCandidate {
  readonly action: Combo | null;
  readonly vector: readonly number[];
}

/** All legal trick-play candidate actions for `player` right now, each
 * paired with its encoded vector.
 *
 * The large-Tichu and (small) Tichu call/decline decisions are no longer
 * part of the RL action space: `ai/tichu_env`'s `TichuEnv` auto-resolves
 * both internally via a fixed heuristic before ever exposing a state to a
 * caller (see its `_auto_resolve_calls`), and this port's own AI caller
 * (`packages/client/src/ai/soloGame.ts`) already resolves both the same way
 * (see `shouldCallLargeTichu`/`shouldCallTichu` there) before ever reaching
 * this function -- so this assumes `state` is already past both, and throws
 * otherwise rather than silently returning nonsense from `legalCombos` on a
 * state it was never designed for.
 *
 * PASS (`null`) is included only when it is actually `player`'s turn and
 * there is a current trick to pass on (you cannot pass while leading, and a
 * non-turn player may only interrupt with a bomb, never pass). */
export function encodeLegalActions(state: GameState, player: number): readonly LegalActionCandidate[] {
  if (state.phase === Phase.LargeTichu || isAwaitingTichuDecision(state, player)) {
    throw new Error(
      'encodeLegalActions expects a state past all call decisions -- large-Tichu and Tichu calls are ' +
        'auto-resolved before trick play, not exposed as legal actions',
    );
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

function encodeTichuStatus(state: GameState, perspective: number): Float32Array {
  const vec = new Float32Array(TICHU_STATUS_DIM);
  for (let offset = 0; offset < NUM_PLAYERS; offset += 1) {
    const seat = (perspective + offset) % NUM_PLAYERS;
    vec[NUM_TICHU_STATUSES * offset + tichuStatus(state, seat)] = 1.0;
  }
  return vec;
}

function encodeRemainingToWin(state: GameState, perspective: number): Float32Array {
  const ownTeam = teamOf(perspective);
  const target = state.targetScore;
  return Float32Array.from([
    (target - state.teamScores[ownTeam]!) / target,
    (target - state.teamScores[1 - ownTeam]!) / target,
  ]);
}

/** One of the 4 `TICHU_STATUS_*` categories for `seat`, derived from
 * `largeTichuCalls`/`tichuDecided`/`tichuCalls` (see their field comments on
 * `GameState`). Calling Grand Tichu (`largeTichuCalls[seat] === true`)
 * always means `tichuCalls[seat]` is still false -- `seat` never actually
 * reaches the (small) Tichu decision, since `decideLargeTichu` marks
 * `tichuDecided` true for them at the same time they call it. */
function tichuStatus(state: GameState, seat: number): number {
  const largeTichu = state.largeTichuCalls[seat];
  if (largeTichu === null) return TICHU_STATUS_UNDECIDED;
  if (largeTichu === true) return TICHU_STATUS_GRAND_TICHU;
  if (!state.tichuDecided[seat]) return TICHU_STATUS_UNDECIDED;
  return state.tichuCalls[seat] ? TICHU_STATUS_TICHU : TICHU_STATUS_DECLINED;
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
