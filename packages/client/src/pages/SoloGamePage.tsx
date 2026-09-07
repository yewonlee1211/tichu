import { useEffect, useMemo, useRef, useState } from 'react';
import type { InferenceSession } from 'onnxruntime-common';
import { type Card, type Combo, type GameState, Phase, type Rank, type Result } from '@tichu/shared';
import { HUMAN_SEAT, SoloGame } from '../ai/soloGame';
import { clearSoloGameSnapshot, loadSoloGameSnapshot, saveSoloGameSnapshot } from '../ai/soloGamePersistence';
import { fromSoloGameState } from '../table/TableViewModel';
import { GameTable } from '../table/GameTable';
import { ExchangeResultToast } from '../table/ExchangeResultToast';

const AI_TURN_DELAY_MS = 2000;

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
  // SoloGame needs onTurnResolved/onExchangeReceived callbacks to report
  // things as they happen, but those callbacks are `setState`/
  // `setExchangeToast` below -- which don't exist yet at this point in the
  // component body. Refs sidestep the ordering problem: the indirection
  // closures below are stable from the start, and the refs are pointed at
  // the real setters during this same render, well before either callback
  // could actually fire.
  const setStateRef = useRef<(state: GameState) => void>(() => {});
  const setExchangeToastRef = useRef<(received: Record<number, Card>) => void>(() => {});

  // Held in state (not a ref) so reading its methods during render -- for
  // `legalCombos`, `cumulativeScores`, `matchOver` below -- is a plain value
  // read rather than a `.current` ref access; the setter is never called,
  // so identity stays stable across re-renders exactly like a ref would.
  const [game] = useState(
    () =>
      new SoloGame({
        session,
        aiTurnDelayMs: AI_TURN_DELAY_MS,
        onTurnResolved: (nextState) => setStateRef.current(nextState),
        // Fires the moment the exchange resolves -- if this instead waited
        // for submitHumanExchange's own promise (as it used to), the toast
        // wouldn't appear until every subsequent AI trick-play turn (each
        // with its own aiTurnDelayMs pause) had also finished.
        onExchangeReceived: (received) => setExchangeToastRef.current(received),
        // Resumes an in-progress game after e.g. a page refresh -- App.tsx
        // only decides *whether* to route here based on a snapshot existing
        // (see hasSoloGameSnapshot()); the actual data is picked up here so
        // this works regardless of how the page was reached.
        resumeFrom: loadSoloGameSnapshot() ?? undefined,
      }),
  );

  const [state, setState] = useState<GameState>(() => game.getState());
  setStateRef.current = setState;
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [exchangeToast, setExchangeToast] = useState<Record<number, Card> | null>(null);
  setExchangeToastRef.current = setExchangeToast;

  // Drains a pending AI turn left over from a resumed snapshot, exactly
  // once. This can't live in SoloGame's constructor: React 18 StrictMode
  // double-invokes `useState` initializers in dev, and a constructor that
  // itself kicked off async work would fire two concurrent decideAiMove
  // calls against the same shared onnxruntime-web session, crashing it
  // ("Session already started"). The ref guard is needed for the same
  // reason -- this effect body would otherwise also run twice.
  const hasResumedAiTurnRef = useRef(false);
  useEffect(() => {
    if (hasResumedAiTurnRef.current) return;
    hasResumedAiTurnRef.current = true;
    void game.resumePendingAiTurnIfNeeded();
  }, [game]);

  // Re-saves on every state change so a refresh mid-game (or mid-turn --
  // onTurnResolved's intermediate states flow through this same `state`)
  // always has something recent to resume from. Cleared explicitly on match-over
  // (handleNextRound below) and on intentional exit (handleExit), not here,
  // since `game.finishRoundAndDeal()` returns the *same* state reference
  // when the match just ended, which never re-triggers a `[state]` effect.
  useEffect(() => {
    saveSoloGameSnapshot({ state, cumulativeScores: game.getCumulativeScores(), roundHistory: game.getRoundHistory() });
  }, [state, game]);

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
    const nextState = game.finishRoundAndDeal();
    if (game.isMatchOver()) clearSoloGameSnapshot();
    setState(nextState);
  }

  function handleExit(): void {
    clearSoloGameSnapshot();
    onExit();
  }

  return (
    <div className="solo-game-page">
      {exchangeToast !== null && (
        <ExchangeResultToast received={exchangeToast} seatNames={vm.seatNames} onDismiss={() => setExchangeToast(null)} />
      )}
      <GameTable
        vm={vm}
        legalCombos={legalCombos}
        busy={busy}
        errorMessage={errorMessage}
        exchangeSubmitted={false}
        cumulativeScores={game.getCumulativeScores()}
        roundHistory={game.getRoundHistory()}
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
      <button type="button" onClick={handleExit}>
        나가기
      </button>
    </div>
  );
}
