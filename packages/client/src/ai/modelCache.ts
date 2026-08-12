/**
 * Cache Storage-backed persistence for the AI policy model, shared between
 * `loadModel.ts` (main thread) and `sw.ts` (service worker) -- both contexts expose
 * the same `caches`/`fetch` globals, so this module only depends on their standard
 * types and never on `window` or `self` directly, keeping it usable from either.
 *
 * A single fixed cache name is used (not one per checkpoint iteration) because the
 * "current iteration" is tracked as data *inside* that cache (the cached manifest),
 * not encoded into the cache's name -- this avoids having to enumerate and evict
 * old per-iteration caches.
 */

export const MODEL_CACHE_NAME = 'tichu-ai-model-v1';
export const MODEL_URL = '/models/policy.onnx.enc';
export const MANIFEST_URL = '/models/manifest.json';

export interface ModelManifest {
  readonly iteration: number;
}

function isModelManifest(value: unknown): value is ModelManifest {
  return typeof value === 'object' && value !== null && typeof (value as { iteration: unknown }).iteration === 'number';
}

/** Fetches the manifest fresh from the network (never from the HTTP cache -- it
 * must reflect whatever iteration is currently deployed). Returns `null` on any
 * failure (offline, non-200, malformed body) rather than throwing, since "no
 * manifest" is an expected, recoverable state (fall back to whatever is cached). */
export async function fetchManifest(fetchFn: typeof fetch): Promise<ModelManifest | null> {
  try {
    const response = await fetchFn(MANIFEST_URL, { cache: 'no-store' });
    if (!response.ok) return null;
    const body: unknown = await response.json();
    return isModelManifest(body) ? body : null;
  } catch {
    return null;
  }
}

/** The manifest as last cached alongside the model bytes, i.e. "what iteration is
 * currently on disk" -- `null` if nothing has ever been cached. */
export async function readCachedManifest(cachesApi: CacheStorage): Promise<ModelManifest | null> {
  const cache = await cachesApi.open(MODEL_CACHE_NAME);
  const response = await cache.match(MANIFEST_URL);
  if (!response) return null;
  const body: unknown = await response.json();
  return isModelManifest(body) ? body : null;
}

export async function readCachedModelBytes(cachesApi: CacheStorage): Promise<ArrayBuffer | null> {
  const cache = await cachesApi.open(MODEL_CACHE_NAME);
  const response = await cache.match(MODEL_URL);
  return response ? response.arrayBuffer() : null;
}

/** Persists a freshly-fetched model response together with the manifest that
 * describes it, so a later `readCachedManifest` reflects exactly the iteration
 * whose bytes are actually on disk (the two are always written together). */
export async function cacheModelAndManifest(
  modelResponse: Response,
  manifest: ModelManifest,
  cachesApi: CacheStorage,
): Promise<void> {
  const cache = await cachesApi.open(MODEL_CACHE_NAME);
  await cache.put(MODEL_URL, modelResponse);
  await cache.put(MANIFEST_URL, new Response(JSON.stringify(manifest), { headers: { 'content-type': 'application/json' } }));
}