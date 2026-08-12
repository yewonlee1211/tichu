import type { InferenceSession } from 'onnxruntime-web';
import { describe, expect, it, vi } from 'vitest';
import { loadModel } from './loadModel';
import { MANIFEST_URL, MODEL_URL, cacheModelAndManifest } from './modelCache';
import { xorTransform } from './obfuscation';

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

function stubCreateSession(): { createSession: (bytes: Uint8Array) => Promise<InferenceSession>; calls: Uint8Array[] } {
  const calls: Uint8Array[] = [];
  return {
    calls,
    createSession: async (bytes: Uint8Array) => {
      calls.push(bytes);
      return {} as InferenceSession;
    },
  };
}

function encModelBytes(plain: number[]): Uint8Array<ArrayBuffer> {
  return xorTransform(Uint8Array.from(plain));
}

describe('loadModel', () => {
  it('downloads, caches, and decodes the model on first load', async () => {
    const cachesApi = fakeCachesApi();
    const plainModel = [1, 2, 3, 4, 5];
    const fetchFn = vi.fn(async (url: string) => {
      if (url === MANIFEST_URL) return new Response(JSON.stringify({ iteration: 1 }), { status: 200 });
      if (url === MODEL_URL) return new Response(encModelBytes(plainModel), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const { createSession, calls } = stubCreateSession();

    await loadModel({ fetchFn, cachesApi, createSession });

    expect(calls).toHaveLength(1);
    expect(Array.from(calls[0]!)).toEqual(plainModel);
    expect(fetchFn).toHaveBeenCalledWith(MODEL_URL);
  });

  it('reuses the cached model without re-downloading when the manifest iteration is unchanged', async () => {
    const cachesApi = fakeCachesApi();
    const plainModel = [9, 9, 9];
    await cacheModelAndManifest(new Response(encModelBytes(plainModel)), { iteration: 5 }, cachesApi);

    const fetchFn = vi.fn(async (url: string) => {
      if (url === MANIFEST_URL) return new Response(JSON.stringify({ iteration: 5 }), { status: 200 });
      throw new Error(`should not fetch the model itself: ${url}`);
    }) as unknown as typeof fetch;
    const { createSession, calls } = stubCreateSession();

    await loadModel({ fetchFn, cachesApi, createSession });

    expect(Array.from(calls[0]!)).toEqual(plainModel);
    expect(fetchFn).toHaveBeenCalledTimes(1); // manifest only, never MODEL_URL
  });

  it('re-downloads when the manifest reports a newer iteration than what is cached', async () => {
    const cachesApi = fakeCachesApi();
    await cacheModelAndManifest(new Response(encModelBytes([1, 1, 1])), { iteration: 5 }, cachesApi);

    const freshModel = [2, 2, 2, 2];
    const fetchFn = vi.fn(async (url: string) => {
      if (url === MANIFEST_URL) return new Response(JSON.stringify({ iteration: 6 }), { status: 200 });
      if (url === MODEL_URL) return new Response(encModelBytes(freshModel), { status: 200 });
      throw new Error(`unexpected fetch: ${url}`);
    }) as unknown as typeof fetch;
    const { createSession, calls } = stubCreateSession();

    await loadModel({ fetchFn, cachesApi, createSession });

    expect(Array.from(calls[0]!)).toEqual(freshModel);
  });

  it('falls back to the cached model when offline (manifest fetch fails)', async () => {
    const cachesApi = fakeCachesApi();
    const plainModel = [7, 7];
    await cacheModelAndManifest(new Response(encModelBytes(plainModel)), { iteration: 3 }, cachesApi);

    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const { createSession, calls } = stubCreateSession();

    await loadModel({ fetchFn, cachesApi, createSession });

    expect(Array.from(calls[0]!)).toEqual(plainModel);
  });

  it('throws when offline on the very first load (nothing cached yet)', async () => {
    const cachesApi = fakeCachesApi();
    const fetchFn = vi.fn(async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const { createSession } = stubCreateSession();

    await expect(loadModel({ fetchFn, cachesApi, createSession })).rejects.toThrow(/network is unavailable/);
  });

  it('throws when the model fetch itself fails', async () => {
    const cachesApi = fakeCachesApi();
    const fetchFn = vi.fn(async (url: string) => {
      if (url === MANIFEST_URL) return new Response(JSON.stringify({ iteration: 1 }), { status: 200 });
      return new Response('server error', { status: 500 });
    }) as unknown as typeof fetch;
    const { createSession } = stubCreateSession();

    await expect(loadModel({ fetchFn, cachesApi, createSession })).rejects.toThrow(/HTTP 500/);
  });
});
