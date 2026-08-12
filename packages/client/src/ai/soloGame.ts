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

  constructor(options: SoloGameOptions) {
    this.session = options.session;
    this.strategy = options.strategy;
    this.state = dealNewRound(options.deck);
    this.autoDecideAiLargeTichu();
  }

  getState(): GameState {
    return this.state;
  }

  getCumulativeScores(): readonly [number, number] {
    return this.cumulativeScores;
  }

  isMatchOver(targetScore: number = DEFAULT_TARGET_SCORE): boolean {
    return isGameOver(this.cumulativeScores, targetScore);
  }

  private autoDecideAiLargeTichu(): void {
    for (const seat of AI_SEATS) {
      this.state = mustOk(decideLargeTichu(this.state, seat, false));
    }
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
  }

  private async advanceAiTurns(): Promise<void> {
    while (this.state.phase === Phase.Playing && AI_SEATS.includes(this.state.currentPlayer)) {
      await this.playOneAiTurn();
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
   * a bomb may legally interrupt out of turn, exactly as `playCombo` allows. */
  async humanPlayCombo(
    cards: readonly Card[],
    wish: Rank | null = null,
    dragonRecipient: number | null = null,
  ): Promise<Result<GameState, string>> {
    const result = playCombo(this.state, HUMAN_SEAT, cards, wish, dragonRecipient);
    if (!result.ok) return result;
    this.state = result.value;
    await this.advanceAiTurns();
    return ok(this.state);
  }

  async humanPassTurn(dragonRecipient: number | null = null): Promise<Result<GameState, string>> {
    const result = passTurn(this.state, HUMAN_SEAT, dragonRecipient);
    if (!result.ok) return result;
    this.state = result.value;
    await this.advanceAiTurns();
    return ok(this.state);
  }

  humanLegalCombos(): Combo[] {
    return legalCombos(this.state, HUMAN_SEAT);
  }

  /** Scores the just-finished round into the running match total and, unless the
   * match has now been won, deals the next round (AI Large Tichu auto-decided
   * again). Throws if the round is not actually over -- callers should check
   * `getState().phase === Phase.RoundOver` first. */
  finishRoundAndDeal(deck?: readonly Card[]): GameState {
    const roundScore = mustOk(scoreRound(this.state));
    this.cumulativeScores = [this.cumulativeScores[0] + roundScore[0], this.cumulativeScores[1] + roundScore[1]];
    if (this.isMatchOver()) return this.state;

    this.state = dealNewRound(deck);
    this.pendingAiGifts = null;
    this.autoDecideAiLargeTichu();
    return this.state;
  }
}
