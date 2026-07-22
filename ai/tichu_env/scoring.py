from __future__ import annotations

from tichu_env.state import NUM_PLAYERS, GameState, Phase

TEAM_OF = {0: 0, 1: 1, 2: 0, 3: 1}

TICHU_BONUS = 100
LARGE_TICHU_BONUS = 200
DOUBLE_WIN_BONUS = 200
DEFAULT_TARGET_SCORE = 1000


def team_of(player: int) -> int:
    return TEAM_OF[player]


def score_round(state: GameState) -> tuple[int, int]:
    """Score a finished round, returning (team0_delta, team1_delta) for this
    round only. The caller is responsible for accumulating this into the
    running game score."""
    if state.phase is not Phase.ROUND_OVER:
        raise ValueError("round has not ended yet")
    if len(state.finished_order) < 2:
        raise ValueError("round is not actually over (fewer than 3 players have finished)")

    finished = state.finished_order
    first, second = finished[0], finished[1]
    # A double win (both members of one team finish 1st and 2nd before either
    # opponent finishes) ends the round right there -- see state.py's
    # round_over detection -- so exactly 2 finishers is also a valid final
    # state, not just the usual >= 3.
    double_win = len(finished) == 2 and team_of(first) == team_of(second)
    if len(finished) < 3 and not double_win:
        raise ValueError("round is not actually over (fewer than 3 players have finished)")

    fourth = next(p for p in range(NUM_PLAYERS) if p not in finished)

    scores = [0, 0]

    if team_of(first) == team_of(second):
        scores[team_of(first)] += DOUBLE_WIN_BONUS
    else:
        for player in range(NUM_PLAYERS):
            if player == fourth:
                continue
            scores[team_of(player)] += _points(state.collected_tricks[player])
        # The fourth player's remaining hand goes to the opposing team.
        opposing_team = 1 - team_of(fourth)
        scores[opposing_team] += _points(state.hands[fourth])
        # Tricks the fourth player had already banked go to first place,
        # regardless of which team first place is on.
        scores[team_of(first)] += _points(state.collected_tricks[fourth])

    for player in range(NUM_PLAYERS):
        if state.tichu_calls[player]:
            scores[team_of(player)] += TICHU_BONUS if player == first else -TICHU_BONUS
        if state.large_tichu_calls[player]:
            scores[team_of(player)] += LARGE_TICHU_BONUS if player == first else -LARGE_TICHU_BONUS

    return (scores[0], scores[1])


def is_game_over(cumulative_scores: tuple[int, int], target_score: int = DEFAULT_TARGET_SCORE) -> bool:
    return any(score >= target_score for score in cumulative_scores)


def _points(cards) -> int:
    return sum(card.point_value for card in cards)
