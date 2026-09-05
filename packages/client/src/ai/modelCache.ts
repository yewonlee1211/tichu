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

/** Normalizes `VITE_MODEL_BASE_URL` (see `vite-env.d.ts`): strips a trailing slash so
 * concatenating `/models/...` below never produces a double slash (which would
 * resolve to a different S3 object key than what `deploy_s3.py` actually uploads),
 * and fails fast if the value is set but isn't an absolute http(s) URL -- a
 * scheme-less value (e.g. a bucket host with the `https://` accidentally left off)
 * would otherwise silently resolve as a same-origin relative path instead of erroring
 * where the mistake was made. */
export function resolveModelBaseUrl(rawBaseUrl: string | undefined): string {
  if (rawBaseUrl === undefined || rawBaseUrl === '') return '';
  if (!/^https?:\/\//.test(rawBaseUrl)) {
    throw new Error(`VITE_MODEL_BASE_URL must be an absolute http(s) URL, got: ${rawBaseUrl}`);
  }
  return rawBaseUrl.replace(/\/+$/, '');
}

/** `VITE_MODEL_BASE_URL` points these at the S3 bucket in a production build; unset
 * (local dev, E2E) they stay same-origin relative paths, served from
 * `packages/client/public/models/` -- see that directory's README. */
const MODEL_BASE_URL = resolveModelBaseUrl(import.meta.env.VITE_MODEL_BASE_URL);
export const MODEL_URL = `${MODEL_BASE_URL}/models/policy.onnx.enc`;
export const MANIFEST_URL = `${MODEL_BASE_URL}/models/manifest.json`;

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