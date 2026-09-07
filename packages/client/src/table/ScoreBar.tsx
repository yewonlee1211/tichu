import { useState } from 'react';
import { ScoreHistoryPanel } from './ScoreHistoryPanel';

export interface ScoreBarProps {
  readonly viewerSeat: number;
  readonly cumulativeScores?: readonly [number, number];
  readonly roundHistory?: readonly (readonly [number, number])[];
}

/** Thin, always-visible strip at the top of the table showing the running
 * team score, with a button that opens the same round-by-round breakdown
 * `RoundOverSummary` shows (`ScoreHistoryPanel`) in a popup. The "점수 내역
 * 확인하기" button itself is omitted when `roundHistory` isn't available
 * (multiplayer, for now) rather than opening a popup that can only ever say
 * "no rounds yet" even once rounds really have happened. */
export function ScoreBar({ viewerSeat, cumulativeScores, roundHistory }: ScoreBarProps) {
  const [showHistory, setShowHistory] = useState(false);
  const myTeam = viewerSeat % 2;
  const otherTeam = myTeam === 0 ? 1 : 0;
  const myScore = cumulativeScores?.[myTeam] ?? 0;
  const otherScore = cumulativeScores?.[otherTeam] ?? 0;

  return (
    <div className="score-bar">
      <span className="score-bar__summary">
        점수: 우리 팀 {myScore} vs 상대 팀 {otherScore}
      </span>
      {roundHistory !== undefined && (
        <button type="button" className="score-bar__history-button" onClick={() => setShowHistory(true)}>
          점수 내역 확인하기
        </button>
      )}
      {showHistory && (
        <div className="score-bar__overlay" role="dialog" aria-label="점수 내역">
          <div className="score-bar__panel">
            <ScoreHistoryPanel viewerSeat={viewerSeat} cumulativeScores={cumulativeScores} roundHistory={roundHistory} />
            <button type="button" onClick={() => setShowHistory(false)}>
              닫기
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
