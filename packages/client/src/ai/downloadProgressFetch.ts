export interface DownloadProgress {
  readonly loadedBytes: number;
  /** null when the server did not send a Content-Length header. */
  readonly totalBytes: number | null;
}

/** Wraps `fetch` to report byte-level download progress via `onProgress`,
 * without changing what the caller sees: the returned `Response` streams
 * the exact same bytes, just observed chunk-by-chunk on the way through.
 *
 * `loadModel()` (see `./loadModel.ts`) takes a `fetchFn` override but has no
 * progress-callback API of its own -- passing this as that override is how
 * the "AI와 연습하기" entry point shows real download progress without
 * touching `loadModel.ts` itself (that file is owned by the
 * `2026-08-06-m1-solo-ai-browser` session and this one only consumes it). */
export function createProgressFetch(onProgress: (progress: DownloadProgress) => void, baseFetch: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const response = await baseFetch(input, init);
    if (!response.ok || response.body === null) return response;

    const totalHeader = response.headers.get('content-length');
    const totalBytes = totalHeader === null ? null : Number(totalHeader);
    let loadedBytes = 0;
    const reader = response.body.getReader();

    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          return;
        }
        loadedBytes += value.byteLength;
        onProgress({ loadedBytes, totalBytes });
        controller.enqueue(value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    });

    return new Response(stream, { headers: response.headers, status: response.status, statusText: response.statusText });
  };
}
