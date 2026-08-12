/// <reference lib="webworker" />
import { MANIFEST_URL, MODEL_URL } from './ai/modelCache';

declare const self: ServiceWorkerGlobalScope;

/** `loadModel.ts` already does its own explicit, version-aware Cache Storage
 * read/write for the model + manifest (see `modelCache.ts`) -- it compares the
 * freshly-fetched manifest's iteration against what's cached before deciding
 * whether to redownload. If this worker also did a naive cache-first intercept of
 * those same URLs, it would transparently serve stale bytes back to `loadModel.ts`'s
 * own `fetch()` call whenever a new checkpoint iteration is deployed, silently
 * defeating that version check. So this worker deliberately leaves both URLs alone
 * and only provides a generic cache-first strategy for everything else (the future
 * app shell), which is safe to intercept without any version bookkeeping. */
function isModelAsset(pathname: string): boolean {
  return pathname === MODEL_URL || pathname === MANIFEST_URL;
}

const SHELL_CACHE_NAME = 'tichu-app-shell-v1';

async function cacheFirst(request: Request): Promise<Response> {
  const cache = await self.caches.open(SHELL_CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
  }
  return response;
}

export function handleFetchEvent(event: FetchEvent): void {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || isModelAsset(url.pathname)) {
    return;
  }
  event.respondWith(cacheFirst(event.request));
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', () => {
    void self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
  });

  self.addEventListener('fetch', handleFetchEvent);
}
