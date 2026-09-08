import { PARTNER } from '@tichu/shared';
import { ActionAnnouncementBanner } from './ActionAnnouncementBanner';
import type { ActionAnnouncement } from './useActionAnnouncement';

export interface SeatsProps {
  readonly seatNames: readonly string[];
  readonly viewerSeat: number;
  readonly currentPlayer: number;
  readonly handSizes: readonly number[];
  readonly tichuCalls: readonly boolean[];
  readonly largeTichuCalls: readonly (boolean | null)[];
  /** Seats in the order they finished the round, if any have. Combined with
   * the Tichu badge into one "above the name" badge line -- there's no
   * dedicated scoreboard anymore for either of these. */
  readonly finishedOrder: readonly number[];
  /** Rendered over the table's center circle, not the viewport -- see
   * `useActionAnnouncement`. */
  readonly announcement: ActionAnnouncement | null;
  /** Shown as a small note below `announcement` -- see
   * `useActionAnnouncement`'s `lastPassSeat` doc comment. */
  readonly lastPassSeat: number | null;
}

type Position = 'bottom' | 'right' | 'top' | 'left';

const POSITION_BY_OFFSET: Readonly<Record<number, Position>> = { 0: 'bottom', 1: 'right', 2: 'top', 3: 'left' };

/** Fixed circular arrangement around the table, always relative to the
 * viewer: the viewer sits at the bottom, seat+1 to the right, the partner
 * (seat+2 -- teams are always the two seats two apart, see `PARTNER`) at the
 * top, and seat+3 to the left. This is what makes the partner/opponent
 * relationship visible at a glance instead of three anonymous "AI n" rows. */
export function Seats({
  seatNames,
  viewerSeat,
  currentPlayer,
  handSizes,
  tichuCalls,
  largeTichuCalls,
  finishedOrder,
  announcement,
  lastPassSeat,
}: SeatsProps) {
  const partnerSeat = PARTNER[viewerSeat];

  return (
    <div className="seats" aria-label="좌석 배치">
      {seatNames.map((name, seat) => {
        const offset = (seat - viewerSeat + 4) % 4;
        const position = POSITION_BY_OFFSET[offset]!;
        const isViewer = seat === viewerSeat;
        const isPartner = seat === partnerSeat;
        const relationLabel = isViewer ? '나' : isPartner ? '파트너' : '상대팀';
        const tichuBadge = largeTichuCalls[seat] ? '그랜드 티츄' : tichuCalls[seat] ? '티츄' : null;
        const finishRank = finishedOrder.indexOf(seat);
        const rankBadge = finishRank === -1 ? null : `${finishRank + 1}위`;
        const topBadges = [rankBadge, tichuBadge].filter((badge): badge is string => badge !== null);

        return (
          <div
            key={seat}
            className={`seats__seat seats__seat--${position}${seat === currentPlayer ? ' seats__seat--active' : ''}${
              isPartner ? ' seats__seat--partner' : ''
            }`}
          >
            {topBadges.length > 0 && <span className="seats__badges">{topBadges.join(' · ')}</span>}
            <span className="seats__name">{name}</span>
            <span className="seats__relation">{relationLabel}</span>
            <span className="seats__hand-size">{handSizes[seat]}장</span>
          </div>
        );
      })}
      <div className="seats__center">
        {announcement !== null && <ActionAnnouncementBanner announcement={announcement} seatNames={seatNames} />}
        {lastPassSeat !== null && <p className="seats__pass-note">{seatNames[lastPassSeat] ?? `좌석 ${lastPassSeat}`} 님이 패스</p>}
      </div>
    </div>
  );
}
