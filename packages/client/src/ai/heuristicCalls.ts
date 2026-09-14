import { type Card, Rank } from '@tichu/shared';

const LARGE_TICHU_MIN_ACES = 2; // among the 8 dealt cards
const TICHU_MIN_ACES = 2; // among the full 14-card hand, plus a Dragon or Phoenix (see shouldCallTichu)

function countAces(hand: readonly Card[]): number {
  return hand.filter((card) => card.rank === Rank.Ace).length;
}

/** Simple hand-strength gate for the large-Tichu call: at least
 * `LARGE_TICHU_MIN_ACES` Aces among the 8 cards dealt before the decision.
 * Mirrors `ai/agents/advanced_heuristic.py`'s `AdvancedHeuristicAgent
 * ._should_call_large_tichu` -- the same fixed, non-strategic rule the
 * deployed checkpoint's opponents called large Tichu with during training
 * (see `ai/training/self_play.py`'s `HybridOpponent`), used here instead of
 * the policy network itself (which has no action head for this decision in
 * this deployment -- see CLAUDE.md's "AI model asset deployment"). */
export function shouldCallLargeTichu(hand: readonly Card[]): boolean {
  return countAces(hand) >= LARGE_TICHU_MIN_ACES;
}

/** Hand-strength gate for the (small) Tichu call: at least `TICHU_MIN_ACES`
 * Aces among the full 14-card hand *and* a Dragon or Phoenix -- a slightly
 * stricter bar than `shouldCallLargeTichu` since this decision is made
 * later, with more information. Mirrors `AdvancedHeuristicAgent
 * ._should_call_tichu`. */
export function shouldCallTichu(hand: readonly Card[]): boolean {
  const hasDragonOrPhoenix = hand.some((card) => card.rank === Rank.Dragon || card.rank === Rank.Phoenix);
  return countAces(hand) >= TICHU_MIN_ACES && hasDragonOrPhoenix;
}
