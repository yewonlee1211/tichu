import { type Card } from '@tichu/shared';
import { cardLabel, sortHand } from './cardDisplay';

export interface LargeTichuPromptProps {
  readonly hand: readonly Card[];
  readonly seatNames: readonly string[];
  readonly largeTichuCalls: readonly (boolean | null)[];
  readonly viewerSeat: number;
  readonly busy: boolean;
  readonly onDecide: (called: boolean) => void;
}

export function LargeTichuPrompt({ hand, seatNames, largeTichuCalls, viewerSeat, busy, onDecide }: LargeTichuPromptProps) {
  const alreadyDecided = largeTichuCalls[viewerSeat] !== null;

  return (
    <section className="phase-prompt" aria-label="그랜드 티츄 결정">
      <h2>그랜드 티츄</h2>
      <p>처음 받은 8장입니다. 그랜드 티츄를 선언하시겠습니까?</p>
      <ul className="hand hand--preview">
        {sortHand(hand).map((c) => (
          <li key={cardLabel(c)} className="hand__item">
            <span className={`card card--suit-${c.suit}`}>{cardLabel(c)}</span>
          </li>
        ))}
      </ul>
      {alreadyDecided ? (
        <p className="phase-prompt__status">결정을 완료했습니다. 다른 플레이어를 기다리는 중...</p>
      ) : (
        <div className="phase-prompt__actions">
          <button type="button" onClick={() => onDecide(true)} disabled={busy}>
            그랜드 티츄 선언
          </button>
          <button type="button" onClick={() => onDecide(false)} disabled={busy}>
            선언하지 않음
          </button>
        </div>
      )}
      <ul className="phase-prompt__status-list">
        {seatNames.map((name, seat) => (
          <li key={seat}>
            {name}: {largeTichuCalls[seat] === null ? '결정 대기 중' : largeTichuCalls[seat] ? '그랜드 티츄 선언' : '선언 안 함'}
          </li>
        ))}
      </ul>
    </section>
  );
}
