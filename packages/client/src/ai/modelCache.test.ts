import { describe, expect, it } from 'vitest';
import {
  MANIFEST_URL,
  MODEL_CACHE_NAME,
  MODEL_URL,
  cacheModelAndManifest,
  fetchManifest,
  readCachedManifest,
  readCachedModelBytes,
  resolveModelBaseUrl,
} from './modelCache';

describe('resolveModelBaseUrl', () => {
  it('returns an empty string when unset, keeping MODEL_URL/MANIFEST_URL same-origin relative', () => {
    expect(resolveModelBaseUrl(undefined)).toBe('');
    expect(resolveModelBaseUrl('')).toBe('');
  });

  it('passes through an absolute http(s) URL unchanged when it has no trailing slash', () => {
    expect(resolveModelBaseUrl('https://bucket.s3.ap-southeast-2.amazonaws.com')).toBe(
      'https://bucket.s3.ap-southeast-2.amazonaws.com',
    );
  });

  it('strips a trailing slash so concatenating /models/... never double-slashes', () => {
    expect(resolveModelBaseUrl('https://bucket.s3.ap-southeast-2.amazonaws.com/')).toBe(
      'https://bucket.s3.ap-southeast-2.amazonaws.com',
    );
  });

  it('throws for a scheme-less value instead of silently resolving it as same-origin', () => {
    expect(() => resolveModelBaseUrl('bucket.s3.ap-southeast-2.amazonaws.com')).toThrow(/absolute http\(s\) URL/);
  });
});

/** Minimal in-memory stand-in for the browser's Cache Storage API, enough for
 * this module's `open`/`match`/`put` usage. Node has no `caches` global, so every
 * modelCache function takes this as an explicit parameter instead of reading it
 * off `globalThis` -- that's what makes these tests possible without jsdom. */
class FakeCache {
  private readonly entries = new Map<string, Response>();

  async match(request: string): Promise<Response | undefined> {
    return this.entries.get(request);
  }

  async put(request: string, response: Response): Promise<void> {
    this.entries.set(request, response);
  }
}

class FakeCacheStorage {
  private readonly caches = new Map<string, FakeCache>();

  async open(name: string): Promise<FakeCache> {
    let cache = this.caches.get(name);
    if (!cache) {
      cache = new FakeCache();
      this.caches.set(name, cache);
    }
    return cache;
  }
}

function fakeCachesApi(): CacheStorage {
  return new FakeCacheStorage() as unknown as CacheStorage;
}

describe('fetchManifest', () => {
  it('returns the parsed manifest on a successful fetch', async () => {
    const fetchFn = (async (url: string) => {
      expect(url).toBe(MANIFEST_URL);
      return new Response(JSON.stringify({ iteration: 42 }), { status: 200 });
    }) as typeof fetch;

    expect(await fetchManifest(fetchFn)).toEqual({ iteration: 42 });
  });

  it('returns null on a non-ok response', async () => {
    const fetchFn = (async () => new Response('not found', { status: 404 })) as typeof fetch;

    expect(await fetchManifest(fetchFn)).toBeNull();
  });

  it('returns null when the fetch throws (offline)', async () => {
    const fetchFn = (async () => {
      throw new Error('network unreachable');
    }) as typeof fetch;

    expect(await fetchManifest(fetchFn)).toBeNull();
  });

  it('returns null for a malformed manifest body', async () => {
    const fetchFn = (async () => new Response(JSON.stringify({ notIteration: 1 }), { status: 200 })) as typeof fetch;

    expect(await fetchManifest(fetchFn)).toBeNull();
  });
});

describe('cacheModelAndManifest / readCachedManifest / readCachedModelBytes', () => {
  it('round-trips the manifest and model bytes through the same cache', async () => {
    const cachesApi = fakeCachesApi();
    const modelBytes = new Uint8Array([1, 2, 3, 4]);
    const modelResponse = new Response(modelBytes);

    await cacheModelAndManifest(modelResponse, { iteration: 7 }, cachesApi);

    expect(await readCachedManifest(cachesApi)).toEqual({ iteration: 7 });
    const cachedBytes = await readCachedModelBytes(cachesApi);
    expect(new Uint8Array(cachedBytes!)).toEqual(modelBytes);
  });

  it('readCachedManifest returns null when nothing has been cached yet', async () => {
    expect(await readCachedManifest(fakeCachesApi())).toBeNull();
  });

  it('readCachedModelBytes returns null when nothing has been cached yet', async () => {
    expect(await readCachedModelBytes(fakeCachesApi())).toBeNull();
  });

  it('uses the fixed cache name and the documented URLs as cache keys', async () => {
    const cachesApi = fakeCachesApi();
    await cacheModelAndManifest(new Response(new Uint8Array([9])), { iteration: 1 }, cachesApi);

    const cache = await (cachesApi as unknown as { open(name: string): Promise<FakeCache> }).open(MODEL_CACHE_NAME);
    expect(await cache.match(MODEL_URL)).toBeDefined();
    expect(await cache.match(MANIFEST_URL)).toBeDefined();
  });
});