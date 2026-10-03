import { describe, expect, it } from 'vitest';
import bombInterruptFixture from './goldenFixtures/bomb_interrupt.json';
import doubleOutFixture from './goldenFixtures/double_out.json';
import grandTichuFixture from './goldenFixtures/grand_tichu.json';
import lastCardHandoverFixture from './goldenFixtures/last_card_handover.json';
import normalRoundFixture from './goldenFixtures/normal_round.json';
import remainingToWinFixture from './goldenFixtures/remaining_to_win.json';
import tichuCallDecisionFixture from './goldenFixtures/tichu_call_decision.json';
import { actionFromFixture, stateFromFixture } from './goldenFixtures/decode';
import { ACTION_DIM, OBS_DIM, encodeLegalActions, encodeObservation } from './encoding';

function legalActionsFromFixture(entries: readonly { action: unknown; vector: readonly number[] }[]) {
  return entries.map((entry) => ({
    action: actionFromFixture(entry.action as never),
    vector: entry.vector,
  }));
}

describe('OBS_DIM / ACTION_DIM', () => {
  it('matches the dimensions Python computed for every golden fixture', () => {
    expect(OBS_DIM).toBe(normalRoundFixture.obsDim);
    expect(ACTION_DIM).toBe(normalRoundFixture.actionDim);
    expect(OBS_DIM).toBe(bombInterruptFixture.obsDim);
    expect(ACTION_DIM).toBe(bombInterruptFixture.actionDim);
  });
});

describe('golden fixtures: encodeObservation', () => {
  it('matches Python for the trick leader about to open a fresh trick', () => {
    const state = stateFromFixture(normalRoundFixture.afterTichuDecisionState as never);

    const observation = encodeObservation(state, normalRoundFixture.leader);

    expect(observation).toEqual(normalRoundFixture.observationBeforeLead);
  });

  it('matches Python for the winner of a double-out trick', () => {
    const state = stateFromFixture(doubleOutFixture.afterPlayState as never);

    const observation = encodeObservation(state, 3);

    expect(observation).toEqual(doubleOutFixture.observationForWinner);
  });

  it('matches Python for the 3rd-place finisher of a last-card handover', () => {
    const state = stateFromFixture(lastCardHandoverFixture.afterPlayState as never);

    const observation = encodeObservation(state, 2);

    expect(observation).toEqual(lastCardHandoverFixture.observationForFinisher);
  });

  it('matches Python for the 4th-place player of a last-card handover', () => {
    const state = stateFromFixture(lastCardHandoverFixture.afterPlayState as never);

    const observation = encodeObservation(state, 3);

    expect(observation).toEqual(lastCardHandoverFixture.observationForFourthPlace);
  });

  it('matches Python for a successful Grand Tichu caller', () => {
    const state = stateFromFixture(grandTichuFixture.finishedState as never);

    const observation = encodeObservation(state, 0);

    expect(observation).toEqual(grandTichuFixture.observationForCaller);
  });

  it.each(remainingToWinFixture.cases.map((entry) => [entry.state.targetScore, entry.state.teamScores, entry] as const))(
    'matches Python remaining-to-win for target %d with team scores %j',
    (_target, _scores, entry) => {
      const state = stateFromFixture(entry.state as never);

      expect(encodeObservation(state, 0)).toEqual(entry.observationForSeat0);
      expect(encodeObservation(state, 1)).toEqual(entry.observationForSeat1);
    },
  );
});

describe('golden fixtures: encodeLegalActions', () => {
  it('matches Python for the trick leader about to open a fresh trick', () => {
    const state = stateFromFixture(normalRoundFixture.afterTichuDecisionState as never);

    const actions = encodeLegalActions(state, normalRoundFixture.leader);

    expect(actions).toEqual(legalActionsFromFixture(normalRoundFixture.legalActionsBeforeLead));
  });

  it('matches Python for an out-of-turn bomb interrupt (bomb-only candidates, no pass)', () => {
    const state = stateFromFixture(bombInterruptFixture.afterOpenState as never);

    const actions = encodeLegalActions(state, 2);

    expect(actions).toEqual(legalActionsFromFixture(bombInterruptFixture.legalActionsForPlayer2BeforeBomb));
  });
});

describe('golden fixtures: tichu call decision', () => {
  it('matches Python OBS_DIM/ACTION_DIM', () => {
    expect(OBS_DIM).toBe(tichuCallDecisionFixture.obsDim);
    expect(ACTION_DIM).toBe(tichuCallDecisionFixture.actionDim);
  });

  it('encodes each seat\'s 4-category Tichu status after a False/True/True/False Grand Tichu sequence', () => {
    const state = stateFromFixture(tichuCallDecisionFixture.afterLargeTichuState as never);

    const observation = encodeObservation(state, 0);

    expect(observation).toEqual(tichuCallDecisionFixture.observationAfterLargeTichu);
  });

  it('throws for the leader before their (small) Tichu decision is resolved', () => {
    // Large-Tichu and (small) Tichu call decisions are no longer part of the
    // action space -- both are auto-resolved internally (by TichuEnv on the
    // Python side, by soloGame.ts's shouldCallLargeTichu/shouldCallTichu
    // here) before this function is ever called. See encodeLegalActions's
    // doc comment.
    const state = stateFromFixture(tichuCallDecisionFixture.afterExchangeState as never);

    expect(() => encodeLegalActions(state, tichuCallDecisionFixture.leader)).toThrow();
  });

  it('throws for a player other than the one currently deciding too', () => {
    const state = stateFromFixture(tichuCallDecisionFixture.afterExchangeState as never);
    // Must also have declined Grand Tichu -- a seat that called Grand Tichu
    // has its (small) Tichu decision auto-resolved (see gameState.ts's
    // "Grand Tichu supersedes (small) Tichu" rule), so encodeLegalActions
    // would no longer throw for them either.
    const other = tichuCallDecisionFixture.afterLargeTichuState.largeTichuCalls.findIndex(
      (called, seat) => called === false && seat !== tichuCallDecisionFixture.leader,
    );

    expect(() => encodeLegalActions(state, other)).toThrow();
  });

  it('returns to ordinary trick-play candidates once the leader has decided', () => {
    const state = stateFromFixture(tichuCallDecisionFixture.afterTichuDecisionState as never);

    const actions = encodeLegalActions(state, tichuCallDecisionFixture.leader);

    expect(actions).toEqual(legalActionsFromFixture(tichuCallDecisionFixture.legalActionsAfterDecision));
  });
});
