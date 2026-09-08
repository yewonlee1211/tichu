import { useEffect, useRef, useState } from 'react';
import { type Card, ComboType, Phase, Rank, Suit } from '@tichu/shared';
import type { TableViewModel } from './TableViewModel';
import { comboDescription, COMBO_TYPE_LABELS } from './cardDisplay';
import { isDragonSingle } from './legalPlay';

export type ActionAnnouncement =
  | { readonly kind: 'play'; readonly seat: number; readonly cards: readonly Card[]; readonly label: string }
  | { readonly kind: 'trickWon'; readonly winnerSeat: number; readonly nextSeat: number }
  | { readonly kind: 'dragonWon'; readonly winnerSeat: number; readonly recipientSeat: number; readonly revealed: boolean };

/** The Dog is a single, fixed card (mirrors `createDeck()` in
 * `packages/shared/src/cards.ts`) -- unlike every other combo, playing it
 * clears `currentBest` on the same transition (see `playCombo`'s `isDog`
 * branch in `packages/shared/src/gameState.ts`), so there is no
 * `next.currentBest.cards` to read the played card back from. Hardcoding it
 * is simpler than threading the actual card through the state diff. */
const DOG_CARD: Card = { rank: Rank.Dog, suit: Suit.Special };

/** Who a just-closed Dragon-won trick's cards actually went to -- some seat
 * other than the winner, chosen when the Dragon was played (see soloGame.ts's
 * `pendingDragonRecipient`). `TableViewModel` doesn't expose the trick piles
 * themselves, but the Dragon is always worth points (25), so whichever seat's
 * `collectedPoints` just rose is unambiguously the recipient. */
function findDragonRecipient(prev: TableViewModel, next: TableViewModel): number {
  for (let seat = 0; seat < next.collectedPoints.length; seat += 1) {
    if (next.collectedPoints[seat]! > prev.collectedPoints[seat]!) return seat;
  }
  return prev.lastPlayerToAct!;
}

/** Diffs two consecutive `TableViewModel`s to figure out what the last
 * player to act just did -- a real play (including the Dog) replaces the
 * display, a plain pass leaves it untouched, and a pass that closes the
 * trick (everyone else has passed) switches the display to a "trick won /
 * next to act" callout (or, for a Dragon-won trick whose recipient is
 * already decided -- see `TableViewModel.dragonRecipientPreDecided` -- a
 * "trick won" callout that later reveals to "recipient acquired the Dragon
 * trick", see `useActionAnnouncement`'s doc comment). A shrunk hand means
 * that seat played something -- the Dog is the only combo that clears
 * `currentBest`/`lastPlayerToAct` again on the very same transition, so a
 * shrunk hand with no matching `lastPlayerToAct` update must be a Dog. */
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
    const winnerSeat = prev.lastPlayerToAct!;
    if (next.dragonRecipientPreDecided && isDragonSingle(prev.currentBest)) {
      return { kind: 'dragonWon', winnerSeat, recipientSeat: findDragonRecipient(prev, next), revealed: false };
    }
    return { kind: 'trickWon', winnerSeat, nextSeat: next.currentPlayer };
  }

  return null;
}

/** A plain (non-closing) pass -- the seat whose turn just ended in a pass
 * that left the trick open, or `null` if the last transition wasn't that
 * (a play, a trick-closing pass, or a phase change all clear it). Unlike
 * `ActionAnnouncement`, this is recomputed fresh on every transition rather
 * than persisted until specifically replaced -- see `useActionAnnouncement`'s
 * doc comment for why a plain pass needs different lifetime rules than a
 * play or a closed trick. */
function detectPlainPass(prev: TableViewModel, next: TableViewModel): number | null {
  if (prev.phase !== Phase.Playing || next.phase !== Phase.Playing) return null;
  const someoneShrank = prev.handSizes.some((size, seat) => next.handSizes[seat]! < size);
  if (someoneShrank) return null;
  if (prev.currentBest === null || next.currentBest === null) return null;
  if (prev.currentPlayer === next.currentPlayer) return null;
  return prev.currentPlayer;
}

export interface UseActionAnnouncementResult {
  readonly announcement: ActionAnnouncement | null;
  /** The seat whose plain pass (not a trick-closing one) just ended their
   * turn -- shown as "(이름) 님이 패스" alongside `announcement` for exactly
   * one subsequent turn, then cleared (or replaced, if that next turn is
   * also a plain pass) regardless of what `announcement` itself is doing. */
  readonly lastPassSeat: number | null;
  /** True exactly when a Dragon-won trick's recipient is already decided but
   * not yet shown -- see `revealDragonRecipient`. Always false outside
   * solo-AI (`dragonRecipientPreDecided` is false for multiplayer, so the
   * two-stage reveal never triggers there -- see `TableViewModel.ts`). */
  readonly dragonRecipientPending: boolean;
  /** Advances a pending `dragonWon` announcement from "OOO 님이 트릭 획득" to
   * "OOO 님이 용 획득" -- a pure display transition (the actual recipient was
   * already decided the instant the Dragon was played, see soloGame.ts's
   * `pendingDragonRecipient`). Solo-AI gates this behind one extra screen tap
   * (see `SoloGamePage.tsx`) so the "트릭 획득" stage doesn't just flash by
   * unnoticed in the same instant the trick closes. A no-op when nothing is
   * pending. */
  readonly revealDragonRecipient: () => void;
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
 * takes -- AI turns are paced by a screen tap, not a fixed delay, so nothing
 * here assumes any particular timing). A plain (non-closing) pass never
 * replaces it, and it's cleared once the table leaves the Playing phase (e.g.
 * the round ends). */
export function useActionAnnouncement(vm: TableViewModel): UseActionAnnouncementResult {
  const prevVmRef = useRef<TableViewModel | null>(null);
  const [announcement, setAnnouncement] = useState<ActionAnnouncement | null>(null);
  const [lastPassSeat, setLastPassSeat] = useState<number | null>(null);

  useEffect(() => {
    const prev = prevVmRef.current;
    prevVmRef.current = vm;
    if (prev === null) return;

    if (vm.phase !== Phase.Playing) {
      setAnnouncement(null);
      setLastPassSeat(null);
      return;
    }

    const detected = detectAction(prev, vm);
    if (detected !== null) setAnnouncement(detected);
    setLastPassSeat(detectPlainPass(prev, vm));
  }, [vm]);

  return {
    announcement,
    lastPassSeat,
    dragonRecipientPending: announcement?.kind === 'dragonWon' && !announcement.revealed,
    revealDragonRecipient: () =>
      setAnnouncement((prev) => (prev !== null && prev.kind === 'dragonWon' ? { ...prev, revealed: true } : prev)),
  };
}
