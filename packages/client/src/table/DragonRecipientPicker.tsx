export interface DragonRecipientPickerProps {
  readonly options: readonly number[];
  readonly seatNames: readonly string[];
  readonly onChoose: (seat: number) => void;
}

/** Shown when a lone Dragon single is about to win a trick: the rules
 * require giving that trick's points to an opponent. */
export function DragonRecipientPicker({ options, seatNames, onChoose }: DragonRecipientPickerProps) {
  return (
    <div className="flow-picker" role="group" aria-label="용 트릭을 받을 상대 선택">
      <p>용(Dragon)이 이긴 트릭을 받을 상대를 선택하세요</p>
      <div className="flow-picker__options">
        {options.map((seat) => (
          <button key={seat} type="button" onClick={() => onChoose(seat)}>
            {seatNames[seat]}
          </button>
        ))}
      </div>
    </div>
  );
}
