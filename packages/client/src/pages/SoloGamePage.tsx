import { useMemo, useState } from 'react';
import type { InferenceSession } from 'onnxruntime-common';
import { type Card, type Combo, type GameState, Phase, type Rank, type Result } from '@tichu/shared';
import { HUMAN_SEAT, SoloGame } from '../ai/soloGame';
import { fromSoloGameState } from '../table/TableViewModel';
import { GameTable } from '../table/GameTable';

export interface SoloGamePageProps {
  readonly session: InferenceSession;
  readonly onExit: () => void;
}

/** Wires the local, server-free `SoloGame` loop to the same `GameTable`
 * multiplayer uses, via the `fromSoloGameState` adapter. Every `human*`
 * method on `SoloGame` already drains all AI turns before resolving (see
 * its class doc comment), so this never needs to poll or wait separately
 * for AI moves -- `busy` only covers the single await itself. */
export function SoloGamePage({ session, onExit }: SoloGamePageProps) {
  // Held in state (not a ref) so reading its methods during render -- for
  // `legalCombos`, `cumulativeScores`, `matchOver` below -- is a plain value
  // read rather than a `.current` ref access; the setter is never called,
  // so identity stays stable across re-renders exactly like a ref would.
  const [game] = useState(() => new SoloGame({ session }));

  const [state, setState] = useState<GameState>(() => game.getState());
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const vm = useMemo(() => fromSoloGameState(state, HUMAN_SEAT), [state]);
  const legalCombos = useMemo<readonly Combo[]>(
    () => (state.phase === Phase.Playing ? game.humanLegalCombos() : []),
    [state, game],
  );

  function applyResult(result: Result<GameState, string>): void {
    if (!result.ok) {
      setErrorMessage(result.error);
      return;
    }
    setErrorMessage(null);
    setState(result.value);
  }

  async function runBusy(action: () => Promise<Result<GameState, string>>): Promise<void> {
    setBusy(true);
    try {
      applyResult(await action());
    } finally {
      setBusy(false);
    }
  }

  function handleNextRound(): void {
    setState(game.finishRoundAndDeal());
  }

  return (
    <div className="solo-game-page">
      <GameTable
        vm={vm}
        legalCombos={legalCombos}
        busy={busy}
        errorMessage={errorMessage}
        exchangeSubmitted={false}
        cumulativeScores={game.getCumulativeScores()}
        matchOver={game.isMatchOver()}
        onNextRound={handleNextRound}
        onDecideGrandTichu={(called) => applyResult(game.decideHumanLargeTichu(called))}
        onSubmitExchange={(gifts: Record<number, Card>) => void runBusy(() => game.submitHumanExchange(gifts))}
        onCallTichu={() => applyResult(game.humanCallTichu())}
        onPlayCards={(cards: readonly Card[], wish: Rank | null, dragonRecipient: number | null) =>
          void runBusy(() => game.humanPlayCombo(cards, wish, dragonRecipient))
        }
        onPass={(dragonRecipient: number | null) => void runBusy(() => game.humanPassTurn(dragonRecipient))}
      />
      <button type="button" onClick={onExit}>
        나가기
      </button>
    </div>
  );
}
