import {
  type Card,
  cardKey,
  type Combo,
  ComboType,
  type GameState,
  legalCombos,
  NUM_PLAYERS,
  PARTNER,
  type PlayerView,
  Phase,
  Rank,
} from '@tichu/shared';

/** `legalCombos(state, player)` only ever reads `state.hands[player]`,
 * `currentBest`, `currentStrength`, `trickLeader`, and `currentPlayer` (see
 * `packages/shared/src/gameState.ts`) -- never any other seat's hand or any
 * other field. So a `PlayerView` (which never carries opponents' hands) has
 * everything the real reducer needs; this fakes just enough of `GameState`
 * around it to reuse the single source of truth for combo legality instead
 * of re-implementing Tichu's play rules in the UI layer. */
export function legalCombosForView(view: PlayerView): Combo[] {
  const hands: Card[][] = Array.from({ length: NUM_PLAYERS }, () => []);
  hands[view.viewerSeat] = [...view.hand];

  const fakeState: GameState = {
    hands,
    pendingFinalCards: Array.from({ length: NUM_PLAYERS }, () => []),
    phase: view.phase,
    currentPlayer: view.currentPlayer,
    trickLeader: view.trickLeader,
    trickCards: view.trickCards,
    currentBest: view.currentBest,
    currentStrength: view.currentStrength,
    lastPlayerToAct: view.lastPlayerToAct,
    passesInARow: 0,
    finishedOrder: view.finishedOrder,
    collectedTricks: Array.from({ length: NUM_PLAYERS }, () => []),
    largeTichuCalls: view.largeTichuCalls,
    tichuCalls: view.tichuCalls,
    mahjongWish: view.mahjongWish,
    receivedFrom: Array.from({ length: NUM_PLAYERS }, () => ({})),
    tichuDecided: Array.from({ length: NUM_PLAYERS }, () => false),
  };

  return legalCombos(fakeState, view.viewerSeat);
}

export function isDragonSingle(combo: Combo | null): boolean {
  return combo !== null && combo.comboType === ComboType.Single && combo.cards[0]?.rank === Rank.Dragon;
}

function comboCardsKey(cards: readonly Card[]): string {
  return cards
    .map(cardKey)
    .sort()
    .join('|');
}

export function isAmongLegalCombos(cards: readonly Card[], legal: readonly Combo[]): boolean {
  const key = comboCardsKey(cards);
  return legal.some((combo) => comboCardsKey(combo.cards) === key);
}

/** Mirrors `wishFulfillingPlays` in `packages/shared/src/gameState.ts`:
 * passing is illegal while a Mahjong wish is outstanding and the passer
 * holds a legal play that would satisfy it. */
export function hasWishFulfillingPlay(mahjongWish: Rank | null, legal: readonly Combo[]): boolean {
  if (mahjongWish === null) return false;
  return legal.some((combo) => combo.cards.some((c) => c.rank === mahjongWish));
}

/** Seats that may legally receive a trick won by a lone Dragon: not the
 * winner, not the winner's partner, and not already finished the round --
 * mirrors `resolveTrickRecipient` in `packages/shared/src/gameState.ts`. */
export function validDragonRecipients(winner: number, finishedOrder: readonly number[]): readonly number[] {
  const seats: number[] = [];
  for (let seat = 0; seat < NUM_PLAYERS; seat += 1) {
    if (seat === winner || PARTNER[seat] === winner) continue;
    if (finishedOrder.includes(seat)) continue;
    seats.push(seat);
  }
  return seats;
}

/** Whether a pass right now (the (passesInARow + 1)-th consecutive one)
 * would be the one that actually closes the current trick, as opposed to an
 * earlier pass still awaiting others -- mirrors `passTurn`'s `neededPasses`
 * computation in `packages/shared/src/gameState.ts`. Needed because a Dragon
 * single stays `currentBest` for every pass leading up to the close, not
 * just the last one, so `currentBest` being a Dragon single alone isn't
 * enough to know whether *this* pass is the moment to ask for a recipient. */
export function isClosingPass(
  currentBest: Combo | null,
  lastPlayerToAct: number | null,
  finishedOrder: readonly number[],
  passesInARow: number,
): boolean {
  if (currentBest === null || lastPlayerToAct === null) return false;
  const activeCount = NUM_PLAYERS - finishedOrder.length;
  const winnerStillActive = !finishedOrder.includes(lastPlayerToAct);
  const neededPasses = winnerStillActive ? activeCount - 1 : activeCount;
  return passesInARow + 1 >= neededPasses;
}

export function isPlayableTichuState(phase: Phase, handSize: number, alreadyCalled: boolean): boolean {
  return (phase === Phase.Exchange || phase === Phase.Playing) && handSize === 14 && !alreadyCalled;
}
