import { cardKey } from '@tichu/shared';
import { cardLabel } from './cardDisplay';
import type { ActionAnnouncement } from './useActionAnnouncement';

export interface ActionAnnouncementBannerProps {
  readonly announcement: ActionAnnouncement;
  readonly seatNames: readonly string[];
}

function seatName(seatNames: readonly string[], seat: number): string {
  return seatNames[seat] ?? `좌석 ${seat}`;
}

/** Center-screen, transient callout over the table -- see
 * `useActionAnnouncement` for how each variant is determined. A `play`
 * shows the player's name on top, the actual cards played in the middle,
 * and the combo description (e.g. "싱글 5") on the bottom. A `trickWon`
 * instead shows who just won the open trick and who leads the next one,
 * replacing the last play's cards until that new leader actually plays. A
 * `dragonWon` starts identical to `trickWon` but with only the "트릭 획득"
 * line (no "차례" line yet) -- until `revealed` flips (see
 * `useActionAnnouncement`'s `revealDragonRecipient`), at which point it
 * switches to showing who actually received the trick. */
export function ActionAnnouncementBanner({ announcement, seatNames }: ActionAnnouncementBannerProps) {
  if (announcement.kind === 'trickWon') {
    return (
      <div className="action-announcement" role="status" aria-live="polite">
        <span className="action-announcement__name">{seatName(seatNames, announcement.winnerSeat)} 님이 트릭 획득</span>
        <span className="action-announcement__label">{seatName(seatNames, announcement.nextSeat)} 님의 차례</span>
      </div>
    );
  }

  if (announcement.kind === 'dragonWon') {
    return (
      <div className="action-announcement" role="status" aria-live="polite">
        {announcement.revealed ? (
          <span className="action-announcement__name">{seatName(seatNames, announcement.recipientSeat)} 님이 용 획득</span>
        ) : (
          <span className="action-announcement__name">{seatName(seatNames, announcement.winnerSeat)} 님이 트릭 획득</span>
        )}
      </div>
    );
  }

  const { seat, cards, label } = announcement;
  return (
    <div className="action-announcement" role="status" aria-live="polite">
      <span className="action-announcement__name">{seatName(seatNames, seat)}</span>
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
