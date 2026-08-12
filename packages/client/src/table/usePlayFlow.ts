import { useEffect, useRef, useState } from 'react';
import { type Card, cardKey, type Combo, identifyCombo, Rank } from '@tichu/shared';
import { isAmongLegalCombos, isDragonSingle, validDragonRecipients } from './legalPlay';

export type PlayFlowStep =
  | { readonly kind: 'selecting' }
  | { readonly kind: 'wish' }
  | { readonly kind: 'dragon'; readonly action: 'play' | 'pass'; readonly wish: Rank | null };

export interface UsePlayFlowArgs {
  readonly hand: readonly Card[];
  readonly viewerSeat: number;
  readonly currentBest: Combo | null;
  /** Who played the currently-winning combo. Needed because a PASS that
   * closes a Dragon-won trick must exclude *that* player's team from the
   * recipient choices, not the passer's own -- see `resolveTrickRecipient`
   * in `packages/shared/src/gameState.ts`. */
  readonly lastPlayerToAct: number | null;
  readonly finishedOrder: readonly number[];
  readonly legalCombos: readonly Combo[];
  readonly canPassNow: boolean;
  readonly onPlayCards: (cards: readonly Card[], wish: Rank | null, dragonRecipient: number | null) => void;
  readonly onPass: (dragonRecipient: number | null) => void;
}

export interface UsePlayFlowResult {
  readonly selected: readonly Card[];
  readonly toggleCard: (card: Card) => void;
  readonly step: PlayFlowStep;
  readonly canSubmitPlay: boolean;
  readonly canPass: boolean;
  readonly submitPlay: () => void;
  readonly submitPass: () => void;
  readonly chooseWish: (wish: Rank | null) => void;
  readonly chooseDragonRecipient: (seat: number) => void;
  readonly cancelFlow: () => void;
  readonly dragonRecipientOptions: readonly number[];
}

function handSignature(hand: readonly Card[]): string {
  return hand.map(cardKey).sort().join(',');
}

/** Owns the local, multi-step act of committing to a play: select cards ->
 * (if the selection includes the Mahjong) optionally set a wish -> (if the
 * selection, or the trick being passed on, is a lone Dragon single) choose
 * who receives the trick -> fire the actual `onPlayCards`/`onPass` callback.
 * Kept separate from `GameTable` so the flow itself is unit-testable without
 * rendering. */
export function usePlayFlow(args: UsePlayFlowArgs): UsePlayFlowResult {
  const { hand, viewerSeat, currentBest, lastPlayerToAct, finishedOrder, legalCombos, canPassNow, onPlayCards, onPass } =
    args;
  const [selected, setSelected] = useState<readonly Card[]>([]);
  const [step, setStep] = useState<PlayFlowStep>({ kind: 'selecting' });
  const lastHandSignature = useRef(handSignature(hand));

  useEffect(() => {
    const signature = handSignature(hand);
    if (signature !== lastHandSignature.current) {
      lastHandSignature.current = signature;
      setSelected([]);
      setStep({ kind: 'selecting' });
    }
  }, [hand]);

  function toggleCard(card: Card): void {
    if (step.kind !== 'selecting') return;
    const key = cardKey(card);
    setSelected((prev) => (prev.some((c) => cardKey(c) === key) ? prev.filter((c) => cardKey(c) !== key) : [...prev, card]));
  }

  const canSubmitPlay = step.kind === 'selecting' && selected.length > 0 && isAmongLegalCombos(selected, legalCombos);

  function submitPlay(): void {
    if (!canSubmitPlay) return;
    if (selected.some((c) => c.rank === Rank.Mahjong)) {
      setStep({ kind: 'wish' });
      return;
    }
    finishPlay(null);
  }

  function chooseWish(wish: Rank | null): void {
    finishPlay(wish);
  }

  function finishPlay(wish: Rank | null): void {
    const combo = identifyCombo(selected);
    if (combo !== null && isDragonSingle(combo)) {
      setStep({ kind: 'dragon', action: 'play', wish });
      return;
    }
    onPlayCards(selected, wish, null);
    setSelected([]);
    setStep({ kind: 'selecting' });
  }

  function submitPass(): void {
    if (!canPassNow) return;
    if (isDragonSingle(currentBest)) {
      setStep({ kind: 'dragon', action: 'pass', wish: null });
      return;
    }
    onPass(null);
  }

  function chooseDragonRecipient(seat: number): void {
    if (step.kind !== 'dragon') return;
    if (step.action === 'play') {
      onPlayCards(selected, step.wish, seat);
      setSelected([]);
    } else {
      onPass(seat);
    }
    setStep({ kind: 'selecting' });
  }

  function cancelFlow(): void {
    setStep({ kind: 'selecting' });
  }

  const dragonWinner =
    step.kind !== 'dragon' ? null : step.action === 'play' ? viewerSeat : (lastPlayerToAct ?? viewerSeat);
  const dragonRecipientOptions = dragonWinner === null ? [] : validDragonRecipients(dragonWinner, finishedOrder);

  return {
    selected,
    toggleCard,
    step,
    canSubmitPlay,
    canPass: canPassNow,
    submitPlay,
    submitPass,
    chooseWish,
    chooseDragonRecipient,
    cancelFlow,
    dragonRecipientOptions,
  };
}
