export interface ScoreboardProps {
  readonly seatNames: readonly string[];
  readonly handSizes: readonly number[];
  readonly collectedPoints: readonly number[];
  readonly tichuCalls: readonly boolean[];
  readonly largeTichuCalls: readonly (boolean | null)[];
  readonly currentPlayer: number;
  readonly viewerSeat: number;
  readonly finishedOrder: readonly number[];
  /** [team(0,2) total, team(1,3) total]. Solo mode tracks this client-side
   * (`SoloGame.getCumulativeScores()`); multiplayer gets it from the server's
   * `PlayerView.cumulativeScores`. Optional only so callers without either
   * source (e.g. isolated component tests) can omit the team-totals row. */
  readonly cumulativeScores?: readonly [number, number];
}

export function Scoreboard({
  seatNames,
  handSizes,
  collectedPoints,
  tichuCalls,
  largeTichuCalls,
  currentPlayer,
  viewerSeat,
  finishedOrder,
  cumulativeScores,
}: ScoreboardProps) {
  return (
    <section className="scoreboard" aria-label="점수판">
      <table>
        <thead>
          <tr>
            <th scope="col">플레이어</th>
            <th scope="col">남은 카드</th>
            <th scope="col">획득 점수</th>
            <th scope="col">티츄</th>
            <th scope="col">순위</th>
          </tr>
        </thead>
        <tbody>
          {seatNames.map((name, seat) => {
            const finishRank = finishedOrder.indexOf(seat);
            const tichuBadge = largeTichuCalls[seat] ? '그랜드 티츄' : tichuCalls[seat] ? '티츄' : null;
            return (
              <tr key={seat} className={seat === currentPlayer ? 'scoreboard__row--active' : undefined}>
                <th scope="row">
                  {name}
                  {seat === viewerSeat ? ' (나)' : ''}
                </th>
                <td>{handSizes[seat]}</td>
                <td>{collectedPoints[seat]}</td>
                <td>{tichuBadge ?? '-'}</td>
                <td>{finishRank === -1 ? '-' : `${finishRank + 1}위`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {cumulativeScores !== undefined && (
        <p className="scoreboard__totals">
          누적 팀 점수 — {seatNames[0]} & {seatNames[2]}: {cumulativeScores[0]}점 · {seatNames[1]} & {seatNames[3]}:{' '}
          {cumulativeScores[1]}점
        </p>
      )}
    </section>
  );
}
