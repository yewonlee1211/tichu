import { type Card, cardKey } from '@tichu/shared';
import { cardLabel, sortHand } from './cardDisplay';

export interface HandProps {
  readonly cards: readonly Card[];
  readonly selected: readonly Card[];
  readonly onToggle: (card: Card) => void;
  readonly disabled?: boolean;
}

export function Hand({ cards, selected, onToggle, disabled = false }: HandProps) {
  const sorted = sortHand(cards);
  const selectedKeys = new Set(selected.map(cardKey));

  return (
    <ul className="hand" aria-label="내 손패">
      {sorted.map((c) => {
        const key = cardKey(c);
        const isSelected = selectedKeys.has(key);
        return (
          <li key={key} className="hand__item">
            <button
              type="button"
              className={`card card--suit-${c.suit}${isSelected ? ' card--selected' : ''}`}
              onClick={() => onToggle(c)}
              disabled={disabled}
              aria-pressed={isSelected}
            >
              {cardLabel(c)}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
