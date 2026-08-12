import { type Card, cardKey, type Combo } from '@tichu/shared';
import { cardLabel, COMBO_TYPE_LABELS } from './cardDisplay';

export interface TrickProps {
  readonly trickCards: readonly Card[];
  readonly currentBest: Combo | null;
  readonly currentPlayerName: string;
  readonly isMyTurn: boolean;
}

export function Trick({ trickCards, currentBest, currentPlayerName, isMyTurn }: TrickProps) {
  return (
    <section className="trick" aria-label="현재 트릭">
      <div className="trick__cards">
        {trickCards.length === 0 ? (
          <p className="trick__empty">아직 낸 카드가 없습니다</p>
        ) : (
          trickCards.map((c) => (
            <span key={cardKey(c)} className={`card card--mini card--suit-${c.suit}`}>
              {cardLabel(c)}
            </span>
          ))
        )}
      </div>
      {currentBest !== null && (
        <p className="trick__best">현재 최고 조합: {COMBO_TYPE_LABELS[currentBest.comboType]}</p>
      )}
      <p className="trick__turn" aria-live="polite">
        {isMyTurn ? '내 차례입니다' : `${currentPlayerName}의 차례를 기다리는 중`}
      </p>
    </section>
  );
}
