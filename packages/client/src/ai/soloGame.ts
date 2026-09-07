import type { InferenceSession } from 'onnxruntime-common';
import {
  type Card,
  type Combo,
  ComboType,
  DEFAULT_TARGET_SCORE,
  type GameState,
  type Gifts,
  NUM_PLAYERS,
  PARTNER,
  Phase,
  Rank,
  type Result,
  callTichu,
  dealNewRound,
  decideLargeTichu,
  encodeLegalActions,
  encodeObservation,
  err,
  exchangeCards,
  isGameOver,
  legalCombos,
  ok,
  passTurn,
  playCombo,
  scoreRound,
} from '@tichu/shared';
import { decideAiMove, type SelectionStrategy } from './decideAiMove';

/** The human always sits seat 0; the other three seats are AI-controlled. This
 * is a fixed MVP simplification (no seat picker) -- see
 * `.claude/plans/tichu-solo-ai-browser.handoff.md`. */
export const HUMAN_SEAT = 0;
const AI_SEATS: readonly number[] = [1, 2, 3];

export interface SoloGameOptions {
  readonly session: InferenceSession;
  readonly strategy?: SelectionStrategy;
  /** Injectable for deterministic tests; defaults to a real shuffle. */
  readonly deck?: readonly Card[];
  /** Called after every individual turn resolves -- the human's own play/pass
   * as well as each AI turn that follows it -- with the state already
   * updated, so a caller can re-render progressively. Without this, a human
   * action that triggers several AI turns in a row would only ever be seen
   * as one final, combined state: every intermediate move (including the
   * human's own) invisible, which broke anything trying to announce "who
   * just did what" (it could only ever see the *last* mover in the batch). */
  readonly onTurnResolved?: (state: GameState) => void;
  /** Milliseconds to pause after each AI turn before continuing, so a human
   * viewer can actually follow the sequence instead of it resolving
   * instantly. Defaults to 0 (no delay) -- the real app passes 2000; tests
   * leave this unset to stay fast. */
  readonly aiTurnDelayMs?: number;
  /** Called the moment an exchange resolves, before any of the AI seats'
   * subsequent trick-play turns run. `submitHumanExchange`'s own returned
   * promise only resolves once every AI turn (and its `aiTurnDelayMs` pause)
   * has drained, which is too late for anything that should appear right
   * after the exchange itself -- e.g. a "here's what you were given" toast. */
  readonly onExchangeReceived?: (received: Record<number, Card>) => void;
  /** Resume a previously in-progress game (e.g. restoring after a page
   * refresh) instead of dealing a fresh round. When set, `deck` is ignored
   * and Large Tichu is not re-decided for the AI seats -- the restored state
   * already reflects whatever phase the game was actually in. */
  readonly resumeFrom?: {
    readonly state: GameState;
    readonly cumulativeScores: readonly [number, number];
    readonly roundHistory?: readonly (readonly [number, number])[];
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mustOk<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`soloGame invariant violated: ${result.error}`);
  }
  return result.value;
}

function isDragonSingle(combo: Combo | null): boolean {
  return combo !== null && combo.comboType === ComboType.Single && combo.cards[0]?.rank === Rank.Dragon;
}

function isDragonWinPending(state: GameState): boolean {
  return isDragonSingle(state.currentBest);
}

/** Mirrors `ai/tichu_env/env.py`'s `_auto_dragon_recipient`: the first seat, in
 * ascending order, that is neither the winner nor the winner's partner and has
 * not already finished the round. */
function autoDragonRecipient(state: GameState, winner: number): number {
  for (let candidate = 0; candidate < NUM_PLAYERS; candidate += 1) {
    if (candidate === winner || PARTNER[candidate] === winner) continue;
    if (state.finishedOrder.includes(candidate)) continue;
    return candidate;
  }
  throw new Error('no valid Dragon recipient available');
}

/** Mirrors `ai/tichu_env/env.py`'s `_auto_exchange` for a single giver:
 * hand sorted by rank ascending, lowest 3 cards given one each to the other
 * three seats in seat order. This is the same non-strategic default the model
 * was trained against for every seat's exchange during self-play, so AI seats
 * must keep using it rather than something "smarter" the model never saw. */
function autoExchangeGifts(state: GameState, giver: number): Record<number, Card> {
  const hand = [...state.hands[giver]!].sort((a, b) => a.rank - b.rank);
  const others = [0, 1, 2, 3].filter((p) => p !== giver);
  const gift: Record<number, Card> = {};
  others.forEach((recipient, i) => {
    gift[recipient] = hand[i]!;
  });
  return gift;
}

/**
 * Local, server-free game loop for AI 대국(혼자 모드): one human (`HUMAN_SEAT`)
 * plus three AI seats, driven by `packages/shared`'s reducers and `decideAiMove`.
 * Never makes a network call itself -- all inference runs in-process against the
 * already-loaded `session` (see `loadModel.ts` for how that session is obtained).
 *
 * Large Tichu and card exchange have no corresponding action head in the trained
 * model (`ai/tichu_env/env.py`'s `TichuEnv` auto-resolves both with fixed
 * non-strategic defaults during self-play), so AI seats mirror those exact
 * defaults here: always decline Large Tichu, never call (small) Tichu, and
 * exchange via `autoExchangeGifts`. Only trick-play (which combo to play, or
 * pass) is an actual model decision.
 *
 * Invariant: after any `human*` method resolves with `{ ok: true }`, either
 * `getState().phase === Phase.RoundOver` or `getState().currentPlayer ===
 * HUMAN_SEAT` -- AI turns are always fully drained before control returns to
 * the caller.
 */
export class SoloGame {
  private readonly session: InferenceSession;
  private readonly strategy: SelectionStrategy | undefined;
  private state: GameState;
  private pendingAiGifts: Gifts | null = null;
  private cumulativeScores: readonly [number, number] = [0, 0];
  private roundHistory: readonly (readonly [number, number])[] = [];
  /** Whether the round `this.state` currently sits in (if it's RoundOver) has
   * already been folded into `cumulativeScores`/`roundHistory` -- see
   * `scoreRoundIfNeeded`. Reset to `false` every time a fresh round is dealt. */
  private roundScored = false;
  private readonly onTurnResolved: ((state: GameState) => void) | undefined;
  private readonly aiTurnDelayMs: number;
  private readonly onExchangeReceived: ((received: Record<number, Card>) => void) | undefined;

  constructor(options: SoloGameOptions) {
    this.session = options.session;
    this.strategy = options.strategy;
    this.onTurnResolved = options.onTurnResolved;
    this.aiTurnDelayMs = options.aiTurnDelayMs ?? 0;
    this.onExchangeReceived = options.onExchangeReceived;
    if (options.resumeFrom !== undefined) {
      this.state = options.resumeFrom.state;
      this.cumulativeScores = options.resumeFrom.cumulativeScores;
      this.roundHistory = options.resumeFrom.roundHistory ?? [];
      // A resumed RoundOver state was necessarily already scored before it was
      // ever saved -- `scoreRoundIfNeeded` runs synchronously the instant the
      // round ends, before that state reaches any caller (including the
      // snapshot-saving effect in `SoloGamePage`). Re-scoring here would
      // double-count it.
      this.roundScored = this.state.phase === Phase.RoundOver;
      this.computeAiGiftsIfNeeded();
    } else {
      this.state = dealNewRound(options.deck);
      this.autoDecideAiLargeTichu();
    }
  }

  getState(): GameState {
    return this.state;
  }

  getCumulativeScores(): readonly [number, number] {
    return this.cumulativeScores;
  }

  /** Each completed round's own [team(0,2), team(1,3)] score, in order --
   * for the "점수 내역" (score history) view. Cumulative totals alone can't
   * reconstruct this (they're a running sum), so it's tracked separately. */
  getRoundHistory(): readonly (readonly [number, number])[] {
    return this.roundHistory;
  }

  /** Resuming mid-round can leave an AI seat already up (e.g. the human
   * refreshed while it was seat 3's turn) -- every other entry point only
   * ever drains AI turns as a *reaction* to a human action
   * (submitHumanExchange, humanPlayCombo, humanPassTurn), and none of those
   * are coming if it isn't the human's turn to begin with. Call this once
   * after construction to cover that case; a no-op otherwise.
   *
   * Deliberately NOT done automatically in the constructor: constructing
   * this class must stay synchronous and side-effect-free. React 18
   * StrictMode's dev-mode double-invoke of `useState` initializers means a
   * constructor that itself kicks off async work would fire twice, and two
   * concurrent `decideAiMove` calls against the same shared
   * onnxruntime-web session crash it ("Session already started"). The
   * caller is expected to invoke this from a guarded one-shot effect
   * instead (see `SoloGamePage.tsx`). */
  async resumePendingAiTurnIfNeeded(): Promise<void> {
    if (this.state.phase === Phase.Playing && AI_SEATS.includes(this.state.currentPlayer)) {
      await this.advanceAiTurns();
    }
  }

  isMatchOver(targetScore: number = DEFAULT_TARGET_SCORE): boolean {
    return isGameOver(this.cumulativeScores, targetScore);
  }

  private autoDecideAiLargeTichu(): void {
    for (const seat of AI_SEATS) {
      this.state = mustOk(decideLargeTichu(this.state, seat, false));
    }
  }

  /** Folds the just-ended round's score into `cumulativeScores`/`roundHistory`
   * the instant `this.state` becomes `Phase.RoundOver` -- not deferred until
   * `finishRoundAndDeal` is called (that used to be the only place this ran,
   * which meant the round-over screen showed stale totals, missing the round
   * that had literally just finished, until the human clicked "다음 라운드"). A
   * pass can never itself end a round (only playing out your last card(s)
   * can), so this only needs calling after a `playCombo` result is applied. */
  private scoreRoundIfNeeded(): void {
    if (this.state.phase !== Phase.RoundOver || this.roundScored) return;
    const roundScore = mustOk(scoreRound(this.state));
    this.roundHistory = [...this.roundHistory, roundScore];
    this.cumulativeScores = [this.cumulativeScores[0] + roundScore[0], this.cumulativeScores[1] + roundScore[1]];
    this.roundScored = true;
  }

  private computeAiGiftsIfNeeded(): void {
    if (this.state.phase !== Phase.Exchange || this.pendingAiGifts !== null) return;
    const gifts: Record<number, Record<number, Card>> = {};
    for (const seat of AI_SEATS) {
      gifts[seat] = autoExchangeGifts(this.state, seat);
    }
    this.pendingAiGifts = gifts;
  }

  private async playOneAiTurn(): Promise<void> {
    const seat = this.state.currentPlayer;
    const observation = encodeObservation(this.state, seat);
    const candidates = encodeLegalActions(this.state, seat);
    const chosenIndex = await decideAiMove(
      observation,
      candidates.map((c) => c.vector),
      this.session,
      this.strategy,
    );
    const chosen = candidates[chosenIndex]!.combo;

    if (chosen === null) {
      const recipient = isDragonWinPending(this.state) ? autoDragonRecipient(this.state, this.state.lastPlayerToAct!) : null;
      this.state = mustOk(passTurn(this.state, seat, recipient));
      return;
    }

    // AI never sets a Mahjong wish, mirroring ai/tichu_env/env.py's step() (which
    // always calls play_combo without a wish) -- the model has no action head for it.
    const recipient = isDragonSingle(chosen) ? autoDragonRecipient(this.state, seat) : null;
    this.state = mustOk(playCombo(this.state, seat, chosen.cards, null, recipient));
    this.scoreRoundIfNeeded();
  }

  private async advanceAiTurns(): Promise<void> {
    while (this.state.phase === Phase.Playing && AI_SEATS.includes(this.state.currentPlayer)) {
      await this.playOneAiTurn();
      this.onTurnResolved?.(this.state);
      if (this.aiTurnDelayMs > 0) await sleep(this.aiTurnDelayMs);
    }
  }

  /** The human's Large Tichu decision. AI seats already decided (always decline)
   * at construction time, so once this resolves the phase moves on to Exchange. */
  decideHumanLargeTichu(called: boolean): Result<GameState, string> {
    const result = decideLargeTichu(this.state, HUMAN_SEAT, called);
    if (!result.ok) return result;
    this.state = result.value;
    this.computeAiGiftsIfNeeded();
    return ok(this.state);
  }

  /** The human's own 3 exchange gifts (recipient seat -> card). Combined with the
   * AI seats' auto-computed gifts and applied all at once, since `exchangeCards`
   * requires every seat's gifts simultaneously. */
  async submitHumanExchange(humanGifts: Record<number, Card>): Promise<Result<GameState, string>> {
    if (this.state.phase !== Phase.Exchange) {
      return err('not in the exchange phase');
    }
    this.computeAiGiftsIfNeeded();
    const gifts: Gifts = { ...this.pendingAiGifts, [HUMAN_SEAT]: humanGifts };
    const result = exchangeCards(this.state, gifts);
    if (!result.ok) return result;
    const received: Record<number, Card> = {};
    for (const seat of AI_SEATS) {
      const card = gifts[seat]?.[HUMAN_SEAT];
      if (card !== undefined) received[seat] = card;
    }
    this.onExchangeReceived?.(received);
    this.pendingAiGifts = null;
    this.state = result.value;
    await this.advanceAiTurns();
    return ok(this.state);
  }

  humanCallTichu(): Result<GameState, string> {
    const result = callTichu(this.state, HUMAN_SEAT);
    if (!result.ok) return result;
    this.state = result.value;
    return ok(this.state);
  }

  /** Plays `cards` for the human. `player` need not be `state.currentPlayer` --
   * a bomb may legally interrupt out of turn, exactly as `playCombo` allows.
   *
   * Reports the human's own resulting state via `onTurnResolved` *before*
   * draining any AI turns that follow -- otherwise a caller only ever sees
   * the combined state after this play and every subsequent AI turn, with
   * no way to tell the human's own play apart from whichever AI moved last
   * (a real bug: an action-announcement feature built on `onTurnResolved`
   * alone always ended up describing the human's play as whatever the last
   * AI in the batch did). */
  async humanPlayCombo(
    cards: readonly Card[],
    wish: Rank | null = null,
    dragonRecipient: number | null = null,
  ): Promise<Result<GameState, string>> {
    const result = playCombo(this.state, HUMAN_SEAT, cards, wish, dragonRecipient);
    if (!result.ok) return result;
    this.state = result.value;
    this.scoreRoundIfNeeded();
    this.onTurnResolved?.(this.state);
    await this.advanceAiTurns();
    return ok(this.state);
  }

  /** See `humanPlayCombo`'s doc comment -- same reasoning for reporting the
   * human's own pass immediately, before any AI turns that follow it. */
  async humanPassTurn(dragonRecipient: number | null = null): Promise<Result<GameState, string>> {
    const result = passTurn(this.state, HUMAN_SEAT, dragonRecipient);
    if (!result.ok) return result;
    this.state = result.value;
    this.onTurnResolved?.(this.state);
    await this.advanceAiTurns();
    return ok(this.state);
  }

  humanLegalCombos(): Combo[] {
    return legalCombos(this.state, HUMAN_SEAT);
  }

  /** Unless the match has now been won, deals the next round (AI Large Tichu
   * auto-decided again). The just-finished round's score is *not* computed
   * here -- it was already folded into `cumulativeScores`/`roundHistory` the
   * instant the round ended (see `scoreRoundIfNeeded`), so the round-over
   * screen has correct totals to show immediately, without waiting for the
   * human to click "다음 라운드". Throws if the round is not actually over --
   * callers should check `getState().phase === Phase.RoundOver` first. */
  finishRoundAndDeal(deck?: readonly Card[]): GameState {
    if (this.state.phase !== Phase.RoundOver) {
      throw new Error('soloGame invariant violated: finishRoundAndDeal called before the round ended');
    }
    if (this.isMatchOver()) return this.state;

    this.state = dealNewRound(deck);
    this.roundScored = false;
    this.pendingAiGifts = null;
    this.autoDecideAiLargeTichu();
    return this.state;
  }
}
