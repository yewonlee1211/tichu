import { InferenceSession } from 'onnxruntime-web';
import { xorTransform } from './obfuscation';
import { MODEL_URL, cacheModelAndManifest, fetchManifest, readCachedManifest, readCachedModelBytes } from './modelCache';

export interface LoadModelOptions {
  /** Injectable for tests; defaults to the global `fetch`. */
  readonly fetchFn?: typeof fetch;
  /** Injectable for tests; defaults to the global `caches` (Cache Storage). */
  readonly cachesApi?: CacheStorage;
  readonly sessionOptions?: InferenceSession.SessionOptions;
  /** Injectable for tests, so they don't have to feed real ONNX model bytes
   * through onnxruntime-web's WASM backend; defaults to `InferenceSession.create`. */
  readonly createSession?: (bytes: Uint8Array, options?: InferenceSession.SessionOptions) => Promise<InferenceSession>;
}

/** Loads the AI policy model: checks the deployed manifest's iteration against
 * whatever is already cached, reuses the cached bytes when they match (including
 * fully offline, when the manifest can't be fetched at all), and otherwise
 * downloads + XOR-decodes + caches a fresh copy before handing back a ready
 * onnxruntime-web session. See `ai/export/export_onnx.py` for the obs/action_vectors
 * -> action_logits/state_value contract this session must satisfy. */
export async function loadModel(options: LoadModelOptions = {}): Promise<InferenceSession> {
  const fetchFn = options.fetchFn ?? fetch;
  const cachesApi = options.cachesApi ?? caches;
  const createSession = options.createSession ?? ((bytes, sessionOptions) => InferenceSession.create(bytes, sessionOptions));

  const [remoteManifest, cachedManifest] = await Promise.all([fetchManifest(fetchFn), readCachedManifest(cachesApi)]);

  const cacheIsCurrent =
    cachedManifest !== null && remoteManifest !== null && cachedManifest.iteration === remoteManifest.iteration;
  const shouldUseCache = cacheIsCurrent || (remoteManifest === null && cachedManifest !== null);

  let bytes: ArrayBuffer | null = shouldUseCache ? await readCachedModelBytes(cachesApi) : null;

  if (bytes === null) {
    if (remoteManifest === null) {
      throw new Error('AI model is not cached yet and the network is unavailable -- connect once to download it.');
    }
    const response = await fetchFn(MODEL_URL);
    if (!response.ok) {
      throw new Error(`failed to fetch AI model: HTTP ${response.status}`);
    }
    await cacheModelAndManifest(response.clone(), remoteManifest, cachesApi);
    bytes = await response.arrayBuffer();
  }

  const decoded = xorTransform(new Uint8Array(bytes));
  return createSession(decoded, options.sessionOptions);
}