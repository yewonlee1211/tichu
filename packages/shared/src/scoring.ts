import { type Card, pointValue } from './cards';
import { DEFAULT_TARGET_SCORE, type GameState, NUM_PLAYERS, Phase } from './gameState';
import { type Result, err, ok } from './result';

export { DEFAULT_TARGET_SCORE };

export const TEAM_OF: Readonly<Record<number, number>> = { 0: 0, 1: 1, 2: 0, 3: 1 };

export const TICHU_BONUS = 100;
export const LARGE_TICHU_BONUS = 200;
export const DOUBLE_WIN_BONUS = 200;

export function teamOf(player: number): number {
  return TEAM_OF[player]!;
}

/** Score a finished round, returning (team0Delta, team1Delta) for this round
 * only. The caller accumulates this into the running game score. */
export function scoreRound(state: GameState): Result<readonly [number, number], string> {
  if (state.phase !== Phase.RoundOver) {
    return err('round has not ended yet');
  }

  const finished = state.finishedOrder;
  if (finished.length < 2) {
    return err('round is not actually over (fewer than 2 players have finished)');
  }
  const first = finished[0]!;
  const second = finished[1]!;
  // A double win (both members of one team finish 1st and 2nd before either
  // opponent finishes) ends the round right there, so exactly 2 finishers is
  // also a valid final state, not just the usual >= 3.
  const doubleWin = finished.length === 2 && teamOf(first) === teamOf(second);
  if (finished.length < 3 && !doubleWin) {
    return err('round is not actually over (fewer than 3 players have finished, and not a double win)');
  }

  const fourth = Array.from({ length: NUM_PLAYERS }, (_, p) => p).find((p) => !finished.includes(p))!;

  const scores = [0, 0];

  if (teamOf(first) === teamOf(second)) {
    scores[teamOf(first)]! += DOUBLE_WIN_BONUS;
  } else {
    for (let player = 0; player < NUM_PLAYERS; player += 1) {
      if (player === fourth) continue;
      scores[teamOf(player)]! += points(state.collectedTricks[player]!);
    }
    // The fourth player's remaining hand goes to the opposing team.
    const opposingTeam = 1 - teamOf(fourth);
    scores[opposingTeam]! += points(state.hands[fourth]!);
    // Tricks the fourth player had already banked go to first place,
    // regardless of which team first place is on.
    scores[teamOf(first)]! += points(state.collectedTricks[fourth]!);
  }

  for (let player = 0; player < NUM_PLAYERS; player += 1) {
    if (state.tichuCalls[player]) {
      scores[teamOf(player)]! += player === first ? TICHU_BONUS : -TICHU_BONUS;
    }
    if (state.largeTichuCalls[player]) {
      scores[teamOf(player)]! += player === first ? LARGE_TICHU_BONUS : -LARGE_TICHU_BONUS;
    }
  }

  return ok([scores[0]!, scores[1]!]);
}

export function isGameOver(cumulativeScores: readonly [number, number], targetScore: number = DEFAULT_TARGET_SCORE): boolean {
  return cumulativeScores.some((s) => s >= targetScore);
}

function points(cards: readonly Card[]): number {
  return cards.reduce((sum, c) => sum + pointValue(c), 0);
}
