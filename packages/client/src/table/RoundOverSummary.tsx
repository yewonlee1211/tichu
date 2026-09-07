import { ScoreHistoryPanel } from './ScoreHistoryPanel';

export interface RoundOverSummaryProps {
  readonly viewerSeat: number;
  readonly cumulativeScores?: readonly [number, number];
  readonly roundHistory?: readonly (readonly [number, number])[];
  /** Solo mode only: lets the player deal the next round, or is omitted once
   * the match itself has ended (`SoloGame.isMatchOver()`). Multiplayer deals
   * the next round automatically server-side (`gameServer.ts`'s `applyAction`),
   * so it never passes this -- there is no single client authorized to
   * trigger it for the whole room. */
  readonly onNextRound?: () => void;
  readonly matchOver?: boolean;
}

export function RoundOverSummary({ viewerSeat, cumulativeScores, roundHistory, onNextRound, matchOver }: RoundOverSummaryProps) {
  return (
    <section className="phase-prompt" aria-label="라운드 결과">
      <h2>라운드 종료</h2>
      <ScoreHistoryPanel viewerSeat={viewerSeat} cumulativeScores={cumulativeScores} roundHistory={roundHistory} />
      {matchOver === true && <p className="phase-prompt__status">매치가 종료되었습니다.</p>}
      {onNextRound !== undefined && matchOver !== true && (
        <button type="button" onClick={onNextRound}>
          다음 라운드
        </button>
      )}
    </section>
  );
}
