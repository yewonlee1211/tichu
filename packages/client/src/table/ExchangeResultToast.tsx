import type { Card } from '@tichu/shared';
import { cardLabel } from './cardDisplay';

export interface ExchangeResultToastProps {
  readonly received: Readonly<Record<number, Card>>;
  readonly seatNames: readonly string[];
  readonly onDismiss: () => void;
}

/** Shown once right after a solo-AI exchange resolves, listing which AI seat
 * gave the human which card -- highest seat number first (left-to-right), one
 * card face above each giver's name. Rendered as a screen-centered overlay
 * over a dimmed backdrop; there is no close button -- tapping anywhere
 * dismisses it. Solo-only for now -- multiplayer's `PlayerView` carries no
 * exchange-provenance data, so this can't be wired there without a protocol
 * change (see the gameplay-bugfixes session notes). */
export function ExchangeResultToast({ received, seatNames, onDismiss }: ExchangeResultToastProps) {
  const entries = Object.entries(received)
    .map(([seat, card]) => ({ seat: Number(seat), card }))
    .sort((a, b) => b.seat - a.seat);

  return (
    <div className="exchange-toast__overlay" onClick={onDismiss}>
      <div className="exchange-toast" role="status">
        <ul className="exchange-toast__list">
          {entries.map(({ seat, card }) => (
            <li key={seat} className="exchange-toast__item">
              <span className={`card card--mini card--suit-${card.suit}`}>{cardLabel(card)}</span>
              <span className="exchange-toast__name">{seatNames[seat] ?? `좌석 ${seat}`}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
