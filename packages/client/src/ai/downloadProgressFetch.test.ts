import { describe, expect, it, vi } from 'vitest';
import { createProgressFetch, type DownloadProgress } from './downloadProgressFetch';

function streamOf(chunks: readonly Uint8Array[]): ReadableStream<Uint8Array> {
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(chunks[i]!);
      i += 1;
    },
  });
}

describe('createProgressFetch', () => {
  it('reports cumulative loaded bytes per chunk and preserves the response body', async () => {
    const chunkA = new Uint8Array([1, 2, 3]);
    const chunkB = new Uint8Array([4, 5]);
    const baseFetch = vi.fn(
      async () =>
        new Response(streamOf([chunkA, chunkB]), {
          status: 200,
          headers: { 'content-length': '5' },
        }),
    );

    const progressEvents: DownloadProgress[] = [];
    const progressFetch = createProgressFetch((p) => progressEvents.push(p), baseFetch as unknown as typeof fetch);

    const response = await progressFetch('https://example.test/model.onnx.enc');
    const body = new Uint8Array(await response.arrayBuffer());

    expect(body).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(progressEvents).toEqual([
      { loadedBytes: 3, totalBytes: 5 },
      { loadedBytes: 5, totalBytes: 5 },
    ]);
  });

  it('reports totalBytes as null when Content-Length is absent', async () => {
    const baseFetch = vi.fn(async () => new Response(streamOf([new Uint8Array([9])])));
    const progressEvents: DownloadProgress[] = [];
    const progressFetch = createProgressFetch((p) => progressEvents.push(p), baseFetch as unknown as typeof fetch);

    await (await progressFetch('https://example.test/manifest.json')).arrayBuffer();

    expect(progressEvents).toEqual([{ loadedBytes: 1, totalBytes: null }]);
  });

  it('passes through a non-ok response untouched (no progress reported)', async () => {
    const baseFetch = vi.fn(async () => new Response(null, { status: 404 }));
    const onProgress = vi.fn();
    const progressFetch = createProgressFetch(onProgress, baseFetch as unknown as typeof fetch);

    const response = await progressFetch('https://example.test/missing');

    expect(response.status).toBe(404);
    expect(onProgress).not.toHaveBeenCalled();
  });
});
