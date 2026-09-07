export interface ScoreHistoryPanelProps {
  readonly viewerSeat: number;
  /** [team(0,2) total, team(1,3) total]. Solo mode tracks this client-side
   * (`SoloGame.getCumulativeScores()`); multiplayer gets it from the
   * server's `PlayerView.cumulativeScores`. */
  readonly cumulativeScores?: readonly [number, number];
  /** Each completed round's own [team(0,2), team(1,3)] score. Solo-only for
   * now -- multiplayer has nowhere server-side that tracks this yet, so it
   * stays `undefined` there and the round-by-round list is simply omitted. */
  readonly roundHistory?: readonly (readonly [number, number])[];
}

/** Round-by-round team score breakdown ending in the running total --
 * shared content for the always-visible `ScoreBar`'s "점수 내역 확인하기"
 * popup and the `RoundOverSummary` screen, always framed from the viewer's
 * own perspective ("우리 팀" = the viewer's team, seats 0&2 or 1&3). */
export function ScoreHistoryPanel({ viewerSeat, cumulativeScores, roundHistory }: ScoreHistoryPanelProps) {
  const myTeam = viewerSeat % 2;
  const otherTeam = myTeam === 0 ? 1 : 0;

  return (
    <div className="score-history">
      <h3>점수 내역</h3>
      {roundHistory === undefined || roundHistory.length === 0 ? (
        <p className="score-history__empty">아직 종료된 라운드가 없습니다.</p>
      ) : (
        <ol className="score-history__rounds">
          {roundHistory.map((score, index) => (
            <li key={index}>
              {index + 1}라운드 — 우리 팀 {score[myTeam]}점 · 상대 팀 {score[otherTeam]}점
            </li>
          ))}
        </ol>
      )}
      {cumulativeScores !== undefined && (
        <p className="score-history__total">
          총합 — 우리 팀 {cumulativeScores[myTeam]}점 · 상대 팀 {cumulativeScores[otherTeam]}점
        </p>
      )}
    </div>
  );
}
