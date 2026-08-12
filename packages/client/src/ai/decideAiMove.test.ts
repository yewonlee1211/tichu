import type { InferenceSession } from 'onnxruntime-common';
import { describe, expect, it } from 'vitest';
import { decideAiMove } from './decideAiMove';

/** A stub session that returns a fixed logits array (must match the number of
 * candidates the caller sends) instead of running real inference. */
function stubSession(logits: readonly number[]): InferenceSession {
  return {
    async run() {
      return {
        action_logits: { data: Float32Array.from(logits) } as never,
        state_value: { data: Float32Array.from([0]) } as never,
      };
    },
  } as unknown as InferenceSession;
}

describe('decideAiMove', () => {
  it('argmax picks the index of the highest logit', async () => {
    const session = stubSession([0.1, 5.0, -3.0, 2.0]);
    const observation = [1, 2, 3];
    const actionVectors = [
      [1, 0],
      [0, 1],
      [1, 1],
      [0, 0],
    ];

    const index = await decideAiMove(observation, actionVectors, session);

    expect(index).toBe(1);
  });

  it('defaults to argmax when no strategy is given', async () => {
    const session = stubSession([9.0, 1.0]);

    const index = await decideAiMove([0], [[0], [1]], session);

    expect(index).toBe(0);
  });

  it('always returns a valid index among a single candidate', async () => {
    const session = stubSession([42.0]);

    const index = await decideAiMove([0, 0], [[1, 2, 3]], session);

    expect(index).toBe(0);
  });

  it('temperature sampling with temperature<=0 falls back to argmax', async () => {
    const session = stubSession([1.0, 9.0, 2.0]);

    const index = await decideAiMove([0], [[0], [1], [2]], session, { kind: 'temperature', temperature: 0 });

    expect(index).toBe(1);
  });

  it('temperature sampling uses the injected random source deterministically', async () => {
    // Two candidates with equal logits -> uniform 50/50 split after softmax.
    const session = stubSession([1.0, 1.0]);

    const low = await decideAiMove([0], [[0], [1]], session, {
      kind: 'temperature',
      temperature: 1,
      random: () => 0.1,
    });
    const high = await decideAiMove([0], [[0], [1]], session, {
      kind: 'temperature',
      temperature: 1,
      random: () => 0.9,
    });

    expect(low).toBe(0);
    expect(high).toBe(1);
  });

  it('rejects an empty candidate list', async () => {
    const session = stubSession([]);

    await expect(decideAiMove([0], [], session)).rejects.toThrow(/at least one candidate/);
  });

  it('throws if the session does not return action_logits', async () => {
    const session = {
      async run() {
        return { state_value: { data: Float32Array.from([0]) } } as never;
      },
    } as unknown as InferenceSession;

    await expect(decideAiMove([0], [[1]], session)).rejects.toThrow(/action_logits/);
  });
});