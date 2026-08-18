import { defineConfig } from '@playwright/test';

/** Matches the app's real, hardcoded default (`ws://localhost:8080`, see
 * `packages/client/src/ws/useGameSocket.ts`) unless overridden -- the server's
 * default port sits inside Windows' Hyper-V/WSL-reserved range on some
 * machines, so `E2E_SERVER_PORT` exists as an escape hatch without needing to
 * touch this file. */
const SERVER_PORT = Number(process.env.E2E_SERVER_PORT ?? 8080);
const CLIENT_PORT = Number(process.env.E2E_CLIENT_PORT ?? 5173);

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: `http://localhost:${CLIENT_PORT}`,
    trace: 'off',
    actionTimeout: 10_000,
  },
  webServer: [
    {
      // No HTTP endpoint to health-check (raw `ws` server) -- `port` makes
      // Playwright wait for the TCP port to accept connections instead.
      command: 'pnpm --filter @tichu/server dev',
      port: SERVER_PORT,
      // Real default is several seconds (see `DEFAULT_ROUND_OVER_DISPLAY_MS` in
      // gameServer.ts) so players actually see the round summary -- e2e specs
      // don't need that wait, so keep it near-zero here.
      env: { PORT: String(SERVER_PORT), ROUND_OVER_DISPLAY_MS: '10' },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'pnpm --filter @tichu/client dev',
      port: CLIENT_PORT,
      env: { VITE_WS_URL: `ws://localhost:${SERVER_PORT}` },
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
  ],
});
