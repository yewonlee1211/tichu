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
 * in `packages/shared/src/protocol.ts`. Clicking a card in the hand opens a
 * picker of recipient names below it (shown in reverse seat order); clicking
 * a name assigns that card to them. A recipient who already has a different
 * card drops out of every other card's picker -- reassigning them means
 * cancelling their current card first, from that card's own picker. */
export function ExchangePrompt({ hand, seatNames, viewerSeat, submitted, busy, onSubmit }: ExchangePromptProps) {
  const recipients = [0, 1, 2, 3].filter((seat) => seat !== viewerSeat);
  const [giftBySeat, setGiftBySeat] = useState<Partial<Record<number, string>>>({});
  const [pendingCardKey, setPendingCardKey] = useState<string | null>(null);

  const sorted = sortHand(hand);

  if (submitted) {
    return (
      <section className="phase-prompt" aria-label="카드 교환">
        <h2>카드 교환</h2>
        <p className="phase-prompt__status">교환 카드를 제출했습니다. 다른 플레이어를 기다리는 중...</p>
        <ul className="hand hand--preview" aria-label="내 손패">
          {sorted.map((c) => (
            <li key={cardKey(c)} className="hand__item">
              <span className={`card card--suit-${c.suit}`}>{cardLabel(c)}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const recipientByCardKey = new Map(Object.entries(giftBySeat).map(([seat, key]) => [key, Number(seat)]));
  const isComplete = recipients.every((seat) => giftBySeat[seat] !== undefined);
  const pendingCard = pendingCardKey === null ? null : hand.find((c) => cardKey(c) === pendingCardKey) ?? null;

  function assignCard(key: string, seat: number): void {
    setGiftBySeat((prev) => {
      const next: Partial<Record<number, string>> = {};
      for (const [s, k] of Object.entries(prev)) {
        if (k === key) continue;
        next[Number(s)] = k;
      }
      next[seat] = key;
      return next;
    });
    setPendingCardKey(null);
  }

  function unassignCard(key: string): void {
    setGiftBySeat((prev) => {
      const next: Partial<Record<number, string>> = {};
      for (const [s, k] of Object.entries(prev)) {
        if (k === key) continue;
        next[Number(s)] = k;
      }
      return next;
    });
    setPendingCardKey(null);
  }

  function handleSubmit(): void {
    const gifts: Record<number, Card> = {};
    for (const seat of recipients) {
      const key = giftBySeat[seat];
      const found = hand.find((c) => cardKey(c) === key);
      if (found === undefined) return;
      gifts[seat] = found;
    }
    onSubmit(gifts);
  }

  return (
    <section className="phase-prompt" aria-label="카드 교환">
      <h2>카드 교환</h2>
      <p>손패에서 카드를 눌러 세 명의 상대에게 각각 한 장씩 나눠주세요.</p>
      <ul className="hand" aria-label="내 손패">
        {sorted.map((c) => {
          const key = cardKey(c);
          const recipientSeat = recipientByCardKey.get(key);
          return (
            <li key={key} className="exchange__hand-item">
              <button
                type="button"
                className={`card card--suit-${c.suit}${pendingCardKey === key ? ' card--selected' : ''}`}
                onClick={() => setPendingCardKey((prev) => (prev === key ? null : key))}
                disabled={busy}
                aria-pressed={pendingCardKey === key}
              >
                {cardLabel(c)}
              </button>
              {recipientSeat !== undefined && <span className="exchange__gift-label">→ {seatNames[recipientSeat]}</span>}
            </li>
          );
        })}
      </ul>

      {pendingCard !== null && (
        <div className="flow-picker" role="group" aria-label={`${cardLabel(pendingCard)} 카드를 줄 상대 선택`}>
          <p>{cardLabel(pendingCard)} 카드를 줄 상대를 선택하세요</p>
          <div className="flow-picker__options">
            {[...recipients]
              .reverse()
              // Already-gifted recipients (a card assigned to someone else) drop out of
              // the list entirely -- only the recipient of *this* card stays, so its
              // "cancel" option remains reachable.
              .filter((seat) => giftBySeat[seat] === undefined || recipientByCardKey.get(cardKey(pendingCard)) === seat)
              .map((seat) => {
                const key = cardKey(pendingCard);
                const isCurrentRecipient = recipientByCardKey.get(key) === seat;
                return (
                  <button
                    key={seat}
                    type="button"
                    onClick={() => (isCurrentRecipient ? unassignCard(key) : assignCard(key, seat))}
                    disabled={busy}
                  >
                    {isCurrentRecipient ? `${seatNames[seat]} (배정 취소)` : seatNames[seat]}
                  </button>
                );
              })}
          </div>
        </div>
      )}

      <button type="button" onClick={handleSubmit} disabled={!isComplete || busy}>
        교환 제출
      </button>
    </section>
  );
}
