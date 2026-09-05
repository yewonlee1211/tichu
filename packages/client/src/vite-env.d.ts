/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the human-vs-human WS server URL (see `useGameSocket.ts`).
   * Useful in local dev since the server's default port can collide with an
   * OS-reserved range (e.g. Windows Hyper-V/WSL excludes 8035-8134). */
  readonly VITE_WS_URL?: string;
  /** Base origin the AI model bundle is fetched from (see `modelCache.ts`), e.g.
   * `https://<bucket>.s3.<region>.amazonaws.com`. Unset in local dev and E2E --
   * `modelCache.ts` falls back to same-origin `/models/...` paths, which is what
   * the E2E suite's mocked `/models/*` fixtures and `packages/client/public/models/`
   * both assume. Only a production build needs this set, once the S3 bucket from
   * `ai/export/README.md` is CORS-configured for that build's origin. */
  readonly VITE_MODEL_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
