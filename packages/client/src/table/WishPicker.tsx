import { NUMERIC_RANKS, Rank } from '@tichu/shared';
import { rankLabel } from './cardDisplay';

export interface WishPickerProps {
  readonly onChoose: (wish: Rank | null) => void;
}

/** Shown after playing the Mahjong: optionally name a rank the next forced
 * play must include (see `mahjongWish` in `packages/shared/src/gameState.ts`). */
export function WishPicker({ onChoose }: WishPickerProps) {
  return (
    <div className="flow-picker" role="group" aria-label="소원 카드 선택">
      <p>소원으로 걸 숫자를 선택하세요 (선택하지 않아도 됩니다)</p>
      <div className="flow-picker__options">
        {NUMERIC_RANKS.map((rank) => (
          <button key={rank} type="button" onClick={() => onChoose(rank)}>
            {rankLabel(rank)}
          </button>
        ))}
        <button type="button" className="flow-picker__skip" onClick={() => onChoose(null)}>
          선택 안 함
        </button>
      </div>
    </div>
  );
}
