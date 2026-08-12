import { type Card, type Combo, Phase, type Rank } from '@tichu/shared';
import type { TableViewModel } from './TableViewModel';
import { hasWishFulfillingPlay, isPlayableTichuState } from './legalPlay';
import { usePlayFlow } from './usePlayFlow';
import { Hand } from './Hand';
import { Trick } from './Trick';
import { Scoreboard } from './Scoreboard';
import { LargeTichuPrompt } from './LargeTichuPrompt';
import { ExchangePrompt } from './ExchangePrompt';
import { RoundOverSummary } from './RoundOverSummary';
import { WishPicker } from './WishPicker';
import { DragonRecipientPicker } from './DragonRecipientPicker';

export interface GameTableProps {
  readonly vm: TableViewModel;
  readonly legalCombos: readonly Combo[];
  readonly busy: boolean;
  readonly errorMessage: string | null;
  readonly exchangeSubmitted: boolean;
  readonly cumulativeScores?: readonly [number, number];
  readonly matchOver?: boolean;
  readonly onNextRound?: () => void;
  readonly onDecideGrandTichu: (called: boolean) => void;
  readonly onSubmitExchange: (gifts: Record<number, Card>) => void;
  readonly onCallTichu: () => void;
  readonly onPlayCards: (cards: readonly Card[], wish: Rank | null, dragonRecipient: number | null) => void;
  readonly onPass: (dragonRecipient: number | null) => void;
}

/** The one render surface shared by both human-vs-human (`PlayerView`) and
 * solo-vs-AI (`GameState`) -- callers adapt their data source to a
 * `TableViewModel` first (see `TableViewModel.ts`) so this component never
 * needs to know which mode it is in. */
export function GameTable({
  vm,
  legalCombos,
  busy,
  errorMessage,
  exchangeSubmitted,
  cumulativeScores,
  matchOver,
  onNextRound,
  onDecideGrandTichu,
  onSubmitExchange,
  onCallTichu,
  onPlayCards,
  onPass,
}: GameTableProps) {
  const isMyTurn = vm.currentPlayer === vm.viewerSeat;
  const canPassNow =
    vm.phase === Phase.Playing && isMyTurn && vm.currentBest !== null && !hasWishFulfillingPlay(vm.mahjongWish, legalCombos);
  const canCallTichu = isPlayableTichuState(vm.phase, vm.hand.length, vm.tichuCalls[vm.viewerSeat] ?? false);

  const flow = usePlayFlow({
    hand: vm.hand,
    viewerSeat: vm.viewerSeat,
    currentBest: vm.currentBest,
    lastPlayerToAct: vm.lastPlayerToAct,
    finishedOrder: vm.finishedOrder,
    legalCombos,
    canPassNow,
    onPlayCards,
    onPass,
  });

  return (
    <div className="game-table">
      {errorMessage !== null && (
        <p className="game-table__error" role="alert">
          {errorMessage}
        </p>
      )}

      {vm.phase === Phase.LargeTichu && (
        <LargeTichuPrompt
          hand={vm.hand}
          seatNames={vm.seatNames}
          largeTichuCalls={vm.largeTichuCalls}
          viewerSeat={vm.viewerSeat}
          busy={busy}
          onDecide={onDecideGrandTichu}
        />
      )}

      {vm.phase === Phase.Exchange && (
        <>
          <ExchangePrompt
            hand={vm.hand}
            seatNames={vm.seatNames}
            viewerSeat={vm.viewerSeat}
            submitted={exchangeSubmitted}
            busy={busy}
            onSubmit={onSubmitExchange}
          />
          {canCallTichu && (
            <button type="button" onClick={onCallTichu} disabled={busy}>
              티츄 콜
            </button>
          )}
        </>
      )}

      {vm.phase === Phase.Playing && (
        <>
          <Scoreboard
            seatNames={vm.seatNames}
            handSizes={vm.handSizes}
            collectedPoints={vm.collectedPoints}
            tichuCalls={vm.tichuCalls}
            largeTichuCalls={vm.largeTichuCalls}
            currentPlayer={vm.currentPlayer}
            viewerSeat={vm.viewerSeat}
            finishedOrder={vm.finishedOrder}
            cumulativeScores={cumulativeScores}
          />
          <Trick
            trickCards={vm.trickCards}
            currentBest={vm.currentBest}
            currentPlayerName={vm.seatNames[vm.currentPlayer] ?? `좌석 ${vm.currentPlayer}`}
            isMyTurn={isMyTurn}
          />
          {vm.mahjongWish !== null && <p className="game-table__wish">소원: {vm.mahjongWish}</p>}

          <Hand cards={vm.hand} selected={flow.selected} onToggle={flow.toggleCard} disabled={busy || flow.step.kind !== 'selecting'} />

          {flow.step.kind === 'selecting' && (
            <div className="game-table__actions">
              <button type="button" onClick={flow.submitPlay} disabled={!flow.canSubmitPlay || busy}>
                제출
              </button>
              <button type="button" onClick={flow.submitPass} disabled={!flow.canPass || busy}>
                패스
              </button>
              {canCallTichu && (
                <button type="button" onClick={onCallTichu} disabled={busy}>
                  티츄 콜
                </button>
              )}
            </div>
          )}

          {flow.step.kind === 'wish' && <WishPicker onChoose={flow.chooseWish} />}

          {flow.step.kind === 'dragon' && (
            <DragonRecipientPicker
              options={flow.dragonRecipientOptions}
              seatNames={vm.seatNames}
              onChoose={flow.chooseDragonRecipient}
            />
          )}
        </>
      )}

      {vm.phase === Phase.RoundOver && (
        <RoundOverSummary
          seatNames={vm.seatNames}
          handSizes={vm.handSizes}
          collectedPoints={vm.collectedPoints}
          tichuCalls={vm.tichuCalls}
          largeTichuCalls={vm.largeTichuCalls}
          currentPlayer={vm.currentPlayer}
          viewerSeat={vm.viewerSeat}
          finishedOrder={vm.finishedOrder}
          cumulativeScores={cumulativeScores}
          matchOver={matchOver}
          onNextRound={onNextRound}
        />
      )}
    </div>
  );
}
