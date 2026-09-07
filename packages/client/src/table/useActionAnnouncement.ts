import { useEffect, useRef, useState } from 'react';
import { type Card, ComboType, Phase, Rank, Suit } from '@tichu/shared';
import type { TableViewModel } from './TableViewModel';
import { comboDescription, COMBO_TYPE_LABELS } from './cardDisplay';

export type ActionAnnouncement =
  | { readonly kind: 'play'; readonly seat: number; readonly cards: readonly Card[]; readonly label: string }
  | { readonly kind: 'trickWon'; readonly winnerSeat: number; readonly nextSeat: number };

/** The Dog is a single, fixed card (mirrors `createDeck()` in
 * `packages/shared/src/cards.ts`) -- unlike every other combo, playing it
 * clears `currentBest` on the same transition (see `playCombo`'s `isDog`
 * branch in `packages/shared/src/gameState.ts`), so there is no
 * `next.currentBest.cards` to read the played card back from. Hardcoding it
 * is simpler than threading the actual card through the state diff. */
const DOG_CARD: Card = { rank: Rank.Dog, suit: Suit.Special };

/** Diffs two consecutive `TableViewModel`s to figure out what the last
 * player to act just did -- a real play (including the Dog) replaces the
 * display, a plain pass leaves it untouched, and a pass that closes the
 * trick (everyone else has passed) switches the display to a "trick won /
 * next to act" callout. A shrunk hand means that seat played something --
 * the Dog is the only combo that clears `currentBest`/`lastPlayerToAct`
 * again on the very same transition, so a shrunk hand with no matching
 * `lastPlayerToAct` update must be a Dog. */
function detectAction(prev: TableViewModel, next: TableViewModel): ActionAnnouncement | null {
  if (prev.phase !== Phase.Playing || next.phase !== Phase.Playing) return null;

  for (let seat = 0; seat < next.handSizes.length; seat += 1) {
    if (next.handSizes[seat]! < prev.handSizes[seat]!) {
      if (next.currentBest !== null && next.lastPlayerToAct === seat) {
        return { kind: 'play', seat, cards: next.currentBest.cards, label: comboDescription(next.currentBest) };
      }
      return { kind: 'play', seat, cards: [DOG_CARD], label: COMBO_TYPE_LABELS[ComboType.Dog] };
    }
  }

  // No hand shrank, so this wasn't a play. If the open trick just cleared,
  // it was the closing pass -- see `passTurn`'s closing branch in
  // `packages/shared/src/gameState.ts`. `prev.lastPlayerToAct` is who won
  // the trick; `next.currentPlayer` is who leads next, already adjusted by
  // the reducer to skip the winner if their winning play emptied their hand.
  if (prev.currentBest !== null && next.currentBest === null) {
    return { kind: 'trickWon', winnerSeat: prev.lastPlayerToAct!, nextSeat: next.currentPlayer };
  }

  return null;
}

/** Announces whichever play currently owns the open trick -- or, once that
 * trick has been fully passed around, who won it and who leads next -- by
 * diffing consecutive `TableViewModel`s. Works identically for solo-AI
 * (`SoloGame` reports one state per turn, human or AI, via `onTurnResolved`)
 * and multiplayer (the server broadcasts one `PlayerView` per action), with
 * no extra plumbing needed in either page. This depends on every consumer
 * actually delivering one state per atomic turn -- a consumer that instead
 * batches several turns into one state update (as `SoloGame` used to for the
 * human's own play/pass) breaks the diff: the most recently changed hand and
 * `lastPlayerToAct` would belong to different turns.
 *
 * There is deliberately no display-duration timer: an announcement stays up
 * until the *next play or trick-closing pass* replaces it (however long that
 * takes -- AI pacing is ~2s per turn, but nothing here assumes that). A
 * plain (non-closing) pass never replaces it (see `detectAction`'s doc
 * comment), and it's cleared once the table leaves the Playing phase (e.g.
 * the round ends). */
export function useActionAnnouncement(vm: TableViewModel): ActionAnnouncement | null {
  const prevVmRef = useRef<TableViewModel | null>(null);
  const [announcement, setAnnouncement] = useState<ActionAnnouncement | null>(null);

  useEffect(() => {
    const prev = prevVmRef.current;
    prevVmRef.current = vm;
    if (prev === null) return;

    if (vm.phase !== Phase.Playing) {
      setAnnouncement(null);
      return;
    }

    const detected = detectAction(prev, vm);
    if (detected !== null) setAnnouncement(detected);
  }, [vm]);

  return announcement;
}
