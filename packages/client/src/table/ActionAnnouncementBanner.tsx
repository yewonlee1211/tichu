import { type Card, cardKey } from '@tichu/shared';
import { cardLabel } from './cardDisplay';

export interface ActionAnnouncementBannerProps {
  readonly seatName: string;
  /** The cards actually played -- empty for a pass, which shows no card row. */
  readonly cards: readonly Card[];
  readonly label: string;
}

/** Center-screen, transient callout for the most recent play/pass -- see
 * `useActionAnnouncement` for how that action is determined. Player name on
 * top, the actual cards played in the middle (omitted for a pass), and the
 * combo description (e.g. "싱글 5") on the bottom. */
export function ActionAnnouncementBanner({ seatName, cards, label }: ActionAnnouncementBannerProps) {
  return (
    <div className="action-announcement" role="status" aria-live="polite">
      <span className="action-announcement__name">{seatName}</span>
      {cards.length > 0 && (
        <ul className="action-announcement__cards">
          {cards.map((c) => (
            <li key={cardKey(c)} className={`card card--mini card--suit-${c.suit}`}>
              {cardLabel(c)}
            </li>
          ))}
        </ul>
      )}
      <span className="action-announcement__label">{label}</span>
    </div>
  );
}
