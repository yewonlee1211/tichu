/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Overrides the human-vs-human WS server URL (see `useGameSocket.ts`).
   * Useful in local dev since the server's default port can collide with an
   * OS-reserved range (e.g. Windows Hyper-V/WSL excludes 8035-8134). */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
