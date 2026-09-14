import { describe, expect, it } from 'vitest';
import bombInterruptFixture from './goldenFixtures/bomb_interrupt.json';
import doubleOutFixture from './goldenFixtures/double_out.json';
import grandTichuFixture from './goldenFixtures/grand_tichu.json';
import lastCardHandoverFixture from './goldenFixtures/last_card_handover.json';
import normalRoundFixture from './goldenFixtures/normal_round.json';
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

  it('encodes the two-bit called/declined large-Tichu calls after a True/False/True/False sequence', () => {
    const state = stateFromFixture(tichuCallDecisionFixture.afterLargeTichuState as never);

    const observation = encodeObservation(state, 0);

    expect(observation).toEqual(tichuCallDecisionFixture.observationAfterLargeTichu);
  });

  it('offers the (small) Tichu call/decline choice to the leader before their first play', () => {
    const state = stateFromFixture(tichuCallDecisionFixture.afterExchangeState as never);

    const actions = encodeLegalActions(state, tichuCallDecisionFixture.leader);

    expect(actions).toEqual(legalActionsFromFixture(tichuCallDecisionFixture.legalActionsBeforeDecision));
  });

  it('offers no legal actions to a player other than the one currently deciding', () => {
    const state = stateFromFixture(tichuCallDecisionFixture.afterExchangeState as never);
    const other = (tichuCallDecisionFixture.leader + 1) % 4;

    const actions = encodeLegalActions(state, other);

    expect(actions).toEqual(legalActionsFromFixture(tichuCallDecisionFixture.legalActionsForOtherBeforeDecision));
  });

  it('returns to ordinary trick-play candidates once the leader has decided', () => {
    const state = stateFromFixture(tichuCallDecisionFixture.afterTichuDecisionState as never);

    const actions = encodeLegalActions(state, tichuCallDecisionFixture.leader);

    expect(actions).toEqual(legalActionsFromFixture(tichuCallDecisionFixture.legalActionsAfterDecision));
  });
});
