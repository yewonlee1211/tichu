import { Scoreboard, type ScoreboardProps } from './Scoreboard';

export interface RoundOverSummaryProps extends ScoreboardProps {
  /** Solo mode only: lets the player deal the next round, or is omitted once
   * the match itself has ended (`SoloGame.isMatchOver()`). Multiplayer has
   * no next-round flow yet (see the client-ui session log). */
  readonly onNextRound?: () => void;
  readonly matchOver?: boolean;
}

export function RoundOverSummary({ onNextRound, matchOver, ...scoreboardProps }: RoundOverSummaryProps) {
  return (
    <section className="phase-prompt" aria-label="라운드 결과">
      <h2>라운드 종료</h2>
      <Scoreboard {...scoreboardProps} />
      {matchOver === true && <p className="phase-prompt__status">매치가 종료되었습니다.</p>}
      {onNextRound !== undefined && matchOver !== true && (
        <button type="button" onClick={onNextRound}>
          다음 라운드
        </button>
      )}
    </section>
  );
}
