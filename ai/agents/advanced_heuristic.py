from __future__ import annotations

from collections import Counter

import numpy as np

from tichu_env.cards import NUMERIC_RANKS, Card, Rank
from tichu_env.combinations import BOMB_TYPES, Combo, ComboType
from tichu_env.state import NUM_PLAYERS, PARTNER, GameState

LegalAction = tuple[Combo | None, np.ndarray]

_PLAIN_NUMERIC_RANKS = frozenset(
    {Rank.TWO, Rank.THREE, Rank.FOUR, Rank.FIVE, Rank.SIX, Rank.SEVEN, Rank.EIGHT, Rank.NINE, Rank.TEN}
)


class AdvancedHeuristicAgent:
    """Same greedy weakest-combo baseline as HeuristicAgent, refined with five
    hand-designed rules (checked in this priority order):

    1. Leading with only 2 active players left (an endgame 1v1) and holding
       the Dog: always play it, even over a Mahjong-straight opportunity.
    2. Leading while holding the Mahjong: play the longest legal straight
       that includes it, or the bare Mahjong single if no straight is legal.
    3. A trick currently held by our own partner: only beat it with a
       plain-numeric (2-10) combo, conserving specials/face cards; pass if
       no numeric combo is legal.
    4. Otherwise (an opponent holds the trick, or nobody does and we aren't
       leading -- unreachable in practice): fall back to the baseline
       weakest-legal-non-bomb-play logic, except a lone-Phoenix single or the
       Dragon may only be used to beat the highest single rank not yet fully
       exhausted in publicly known cards (own hand + trick cards + everyone's
       collected tricks) -- never "wasted" beating a lower one while a higher
       threat could still be out there.
    """

    _LARGE_TICHU_MIN_ACES = 2  # among the 8 dealt cards

    def choose_action(self, state: GameState, legal_actions: list[LegalAction]) -> Combo | bool | None:
        if any(isinstance(action, bool) for action, _ in legal_actions):
            return self._should_call_large_tichu(state.hands[state.current_player])

        is_leading = state.current_best is None
        can_pass = any(combo is None for combo, _ in legal_actions)

        if is_leading:
            dog_play = self._forced_dog_lead(state, legal_actions)
            if dog_play is not None:
                return dog_play
            mahjong_play = self._best_mahjong_lead(legal_actions)
            if mahjong_play is not None:
                return mahjong_play
        elif can_pass and self._partner_holds_the_trick(state):
            numeric_plays = [
                combo
                for combo, _ in legal_actions
                if combo is not None and combo.combo_type not in BOMB_TYPES and self._is_plain_numeric(combo)
            ]
            if numeric_plays:
                return min(numeric_plays, key=lambda combo: combo.rank_strength)
            return None

        non_bomb_plays = [combo for combo, _ in legal_actions if combo is not None and combo.combo_type not in BOMB_TYPES]
        if not is_leading:
            non_bomb_plays = [combo for combo in non_bomb_plays if self._phoenix_dragon_gate_allows(combo, state)]

        if non_bomb_plays:
            return min(non_bomb_plays, key=lambda combo: combo.rank_strength)

        if can_pass:
            return None

        bombs = [combo for combo, _ in legal_actions if combo is not None]
        return min(bombs, key=lambda combo: combo.rank_strength)

    def _should_call_large_tichu(self, hand: tuple[Card, ...]) -> bool:
        """Simple hand-strength gate: call with at least
        `_LARGE_TICHU_MIN_ACES` Aces among the 8 cards dealt before the
        large-Tichu decision. This agent is a fixed opponent baseline, not
        the thing being trained -- it only needs a plausible, non-degenerate
        call rate that actually varies with hand quality."""
        aces = sum(1 for card in hand if card.rank is Rank.ACE)
        return aces >= self._LARGE_TICHU_MIN_ACES

    def _partner_holds_the_trick(self, state: GameState) -> bool:
        winner = state.last_player_to_act
        return winner is not None and PARTNER[winner] == state.current_player

    def _is_plain_numeric(self, combo: Combo) -> bool:
        return all(card.rank in _PLAIN_NUMERIC_RANKS for card in combo.cards)

    def _forced_dog_lead(self, state: GameState, legal_actions: list[LegalAction]) -> Combo | None:
        active_count = NUM_PLAYERS - len(state.finished_order)
        if active_count != 2:
            return None
        return next((combo for combo, _ in legal_actions if combo is not None and combo.combo_type is ComboType.DOG), None)

    def _best_mahjong_lead(self, legal_actions: list[LegalAction]) -> Combo | None:
        mahjong_combos = [
            combo for combo, _ in legal_actions if combo is not None and any(card.rank is Rank.MAHJONG for card in combo.cards)
        ]
        if not mahjong_combos:
            return None
        straights = [combo for combo in mahjong_combos if combo.combo_type is ComboType.STRAIGHT]
        if straights:
            return max(straights, key=lambda combo: combo.length)
        return next(combo for combo in mahjong_combos if combo.combo_type is ComboType.SINGLE)

    def _phoenix_dragon_gate_allows(self, combo: Combo, state: GameState) -> bool:
        is_dragon = combo.combo_type is ComboType.SINGLE and combo.cards[0].rank is Rank.DRAGON
        is_phoenix_single = combo.is_lone_phoenix and combo.combo_type is ComboType.SINGLE
        if not (is_dragon or is_phoenix_single):
            return True
        highest_live = self._highest_live_single_rank(state)
        if highest_live is None:
            return True
        return state.current_strength >= float(highest_live.value)

    def _highest_live_single_rank(self, state: GameState) -> Rank | None:
        seen: Counter[Rank] = Counter()
        for card in state.hands[state.current_player]:
            seen[card.rank] += 1
        for card in state.trick_cards:
            seen[card.rank] += 1
        for collected in state.collected_tricks:
            for card in collected:
                seen[card.rank] += 1
        for rank in sorted(NUMERIC_RANKS, key=lambda r: r.value, reverse=True):
            if seen[rank] < 4:
                return rank
        return None
