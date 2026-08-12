import { Tensor, type InferenceSession } from 'onnxruntime-common';

/** How to turn `action_logits` into a single chosen index. `argmax` always picks
 * the highest-scoring candidate (deterministic play); `temperature` softmaxes the
 * logits (scaled by `temperature`) and samples from that distribution, for
 * variety in casual/practice play. `random` is injectable for deterministic tests. */
export type SelectionStrategy =
  | { readonly kind: 'argmax' }
  | { readonly kind: 'temperature'; readonly temperature: number; readonly random?: () => number };

const DEFAULT_STRATEGY: SelectionStrategy = { kind: 'argmax' };

/**
 * Runs one AI decision and returns the index into `actionVectors` the AI chose.
 *
 * Pure aside from `session.run` (and, for temperature sampling, the injectable
 * `random` source): no model loading, caching, or browser API here. `session` is
 * typed against `onnxruntime-common` (not `onnxruntime-web` directly) so this same
 * function works unchanged with `onnxruntime-node` in a future mixed-room server --
 * only the loading/caching layer (`loadModel.ts`) needs to differ per platform.
 *
 * `observation`/`actionVectors` must come from `@tichu/shared`'s `encodeObservation`
 * / `encodeLegalActions`, and `session` must be a model exported by
 * `ai/export/export_onnx.py` (obs/action_vectors in, action_logits/state_value out).
 */
export async function decideAiMove(
  observation: readonly number[],
  actionVectors: readonly (readonly number[])[],
  session: InferenceSession,
  strategy: SelectionStrategy = DEFAULT_STRATEGY,
): Promise<number> {
  if (actionVectors.length === 0) {
    throw new Error('decideAiMove requires at least one candidate action');
  }

  const actionDim = actionVectors[0]!.length;
  const flatActions = new Float32Array(actionVectors.length * actionDim);
  actionVectors.forEach((vector, i) => flatActions.set(vector, i * actionDim));

  const feeds: InferenceSession.FeedsType = {
    obs: new Tensor('float32', Float32Array.from(observation), [observation.length]),
    action_vectors: new Tensor('float32', flatActions, [actionVectors.length, actionDim]),
  };

  const outputs = await session.run(feeds);
  const logits = outputs.action_logits;
  if (!logits) {
    throw new Error("ONNX session did not return an 'action_logits' output");
  }
  const logitsData = logits.data as ArrayLike<number>;

  return strategy.kind === 'argmax'
    ? argmax(logitsData)
    : sampleWithTemperature(logitsData, strategy.temperature, strategy.random ?? Math.random);
}

function argmax(logits: ArrayLike<number>): number {
  let bestIndex = 0;
  let bestValue = -Infinity;
  for (let i = 0; i < logits.length; i += 1) {
    const value = Number(logits[i]);
    if (value > bestValue) {
      bestValue = value;
      bestIndex = i;
    }
  }
  return bestIndex;
}

function sampleWithTemperature(logits: ArrayLike<number>, temperature: number, random: () => number): number {
  if (temperature <= 0) return argmax(logits);

  let max = -Infinity;
  const scaled: number[] = [];
  for (let i = 0; i < logits.length; i += 1) {
    const value = Number(logits[i]) / temperature;
    scaled.push(value);
    if (value > max) max = value;
  }
  const expValues = scaled.map((v) => Math.exp(v - max));
  const sum = expValues.reduce((a, b) => a + b, 0);
  const probs = expValues.map((v) => v / sum);

  const target = random();
  let cumulative = 0;
  for (let i = 0; i < probs.length; i += 1) {
    cumulative += probs[i]!;
    if (target < cumulative) return i;
  }
  return probs.length - 1;
}
