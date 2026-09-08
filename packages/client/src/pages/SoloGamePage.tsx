import { type MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import type { InferenceSession } from 'onnxruntime-common';
import { type Card, type Combo, type GameState, Phase, type Rank, type Result } from '@tichu/shared';
import { HUMAN_SEAT, SoloGame } from '../ai/soloGame';
import { clearSoloGameSnapshot, loadSoloGameSnapshot, saveSoloGameSnapshot } from '../ai/soloGamePersistence';
import { fromSoloGameState } from '../table/TableViewModel';
import { GameTable } from '../table/GameTable';
import { ExchangeResultToast } from '../table/ExchangeResultToast';

/** Minimum gap between two AI turns actually advancing, regardless of how
 * fast the player taps the screen -- guards against a rapid double-tap (or
 * panic-tapping) firing two `advanceOneAiTurn` steps close enough together
 * to race the shared onnxruntime-web session (it rejects a `run()` call that
 * arrives while a previous one is still in flight). */
const AI_TAP_COOLDOWN_MS = 500;

export interface SoloGamePageProps {
  readonly session: InferenceSession;
  readonly onExit: () => void;
}

/** Wires the local, server-free `SoloGame` loop to the same `GameTable`
 * multiplayer uses, via the `fromSoloGameState` adapter. Every `human*`
 * method on `SoloGame` already drains all AI turns before resolving (see
 * its class doc comment), so this never needs to poll or wait separately
 * for AI moves -- `busy` only covers the single await itself. Each
 * individual AI turn is paced by `awaitAdvance` (below): rather than a fixed
 * delay, it waits for the player to tap anywhere on the screen, so the
 * player controls how fast opponent turns play out. */
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

  // The tap-to-advance gate: while an AI turn is waiting to proceed,
  // `pendingAdvanceResolveRef.current` holds that wait's resolver; a screen
  // tap (see `handleTapToAdvance`) calls it exactly once to release it. Null
  // whenever nothing is actually waiting (the human's own turn, or between
  // waits), so an unrelated tap elsewhere in the UI is always a harmless
  // no-op.
  const pendingAdvanceResolveRef = useRef<(() => void) | null>(null);
  const lastAdvanceAtRef = useRef(0);

  function awaitAdvance(): Promise<void> {
    return new Promise((resolve) => {
      pendingAdvanceResolveRef.current = resolve;
    });
  }

  /** Bound to the whole page so any tap advances a waiting AI turn -- except
   * a tap that lands on an actual control (a button, in practice every
   * interactive element this page renders). Without that exclusion, the
   * human's own submit/pass/etc. click bubbles up to this same handler (click
   * events bubble through the DOM to their ancestors) and, since
   * `advanceAiTurns` has by then already synchronously armed the gate for
   * whichever AI seat goes next, immediately releases it too -- collapsing
   * the intended gap between the human's action and the next AI's to zero. */
  function handleTapToAdvance(event: MouseEvent<HTMLDivElement>): void {
    if (event.target instanceof Element && event.target.closest('button, a, select, input')) return;
    const resolve = pendingAdvanceResolveRef.current;
    if (resolve === null) return;
    const now = Date.now();
    if (now - lastAdvanceAtRef.current < AI_TAP_COOLDOWN_MS) return;
    lastAdvanceAtRef.current = now;
    pendingAdvanceResolveRef.current = null;
    resolve();
  }

  // Held in state (not a ref) so reading its methods during render -- for
  // `legalCombos`, `cumulativeScores`, `matchOver` below -- is a plain value
  // read rather than a `.current` ref access; the setter is never called,
  // so identity stays stable across re-renders exactly like a ref would.
  const [game] = useState(
    () =>
      new SoloGame({
        session,
        awaitAdvance,
        onTurnResolved: (nextState) => setStateRef.current(nextState),
        // Fires the moment the exchange resolves -- if this instead waited
        // for submitHumanExchange's own promise (as it used to), the toast
        // wouldn't appear until every subsequent AI trick-play turn (each
        // waiting on its own screen tap) had also finished.
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
    <div className="solo-game-page" onClick={handleTapToAdvance}>
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
      <button type="button" className="solo-game-page__exit" onClick={handleExit}>
        나가기
      </button>
    </div>
  );
}
