import { useState } from 'react';
import { type Card, cardKey } from '@tichu/shared';
import { cardLabel, sortHand } from './cardDisplay';

export interface ExchangePromptProps {
  readonly hand: readonly Card[];
  readonly seatNames: readonly string[];
  readonly viewerSeat: number;
  readonly submitted: boolean;
  readonly busy: boolean;
  readonly onSubmit: (gifts: Record<number, Card>) => void;
}

/** One card must go to each of the other three seats -- see `EXCHANGE_CARDS`
 * in `packages/shared/src/protocol.ts`. A plain `<select>` per recipient
 * keeps this accessible without drag-and-drop. */
export function ExchangePrompt({ hand, seatNames, viewerSeat, submitted, busy, onSubmit }: ExchangePromptProps) {
  const recipients = [0, 1, 2, 3].filter((seat) => seat !== viewerSeat);
  const [assignment, setAssignment] = useState<Partial<Record<number, string>>>({});

  if (submitted) {
    return (
      <section className="phase-prompt" aria-label="카드 교환">
        <h2>카드 교환</h2>
        <p className="phase-prompt__status">교환 카드를 제출했습니다. 다른 플레이어를 기다리는 중...</p>
      </section>
    );
  }

  const sorted = sortHand(hand);
  const assignedKeys = new Set(Object.values(assignment).filter((v): v is string => v !== undefined));
  const isComplete = recipients.every((seat) => assignment[seat] !== undefined);

  function handleSubmit(): void {
    const gifts: Record<number, Card> = {};
    for (const seat of recipients) {
      const key = assignment[seat];
      const found = hand.find((c) => cardKey(c) === key);
      if (found === undefined) return;
      gifts[seat] = found;
    }
    onSubmit(gifts);
  }

  return (
    <section className="phase-prompt" aria-label="카드 교환">
      <h2>카드 교환</h2>
      <p>세 명의 상대에게 각각 카드 한 장씩 나눠주세요.</p>
      <div className="exchange__slots">
        {recipients.map((seat) => (
          <label key={seat} className="exchange__slot">
            {seatNames[seat]}
            <select
              value={assignment[seat] ?? ''}
              onChange={(e) => setAssignment((prev) => ({ ...prev, [seat]: e.target.value || undefined }))}
            >
              <option value="">카드 선택</option>
              {sorted
                .filter((c) => !assignedKeys.has(cardKey(c)) || assignment[seat] === cardKey(c))
                .map((c) => (
                  <option key={cardKey(c)} value={cardKey(c)}>
                    {cardLabel(c)}
                  </option>
                ))}
            </select>
          </label>
        ))}
      </div>
      <button type="button" onClick={handleSubmit} disabled={!isComplete || busy}>
        교환 제출
      </button>
    </section>
  );
}
