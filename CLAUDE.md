# tichu-game

## Custom Project Skills May Change Between Turns

`.claude/skills/<name>/SKILL.md` files that are specific to this project (e.g. `commit-checkpoint`, `session-start`, `work-summary`, `self-play-log` — as opposed to the bundled `.claude/skills/ecc/*` library) get edited iteratively, sometimes by a different Claude Code session working in this same repo concurrently with yours.

Having read one of these skills once earlier in this conversation does not mean it still matches what's on disk. **Before following a project skill's procedure again — even one you used minutes ago in this same conversation — re-invoke it via the Skill tool to load its current content.** Do not act from a remembered summary of what it said earlier in this conversation.

## Stack & Structure

pnpm workspace monorepo (`packages/*`) plus a separately-run Python side (`ai/`):

| Package | Role |
|---|---|
| `packages/shared` (`@tichu/shared`) | Tichu rules engine + observation/action encoding. Ported by hand from `ai/tichu_env` (Python) and verified against golden fixtures dumped from it (`packages/shared/src/goldenFixtures/`), so the two implementations can't silently drift. |
| `packages/server` (`@tichu/server`) | Node.js + `ws`. The authoritative game server for human-vs-human play — owns `GameState`, applies actions via `packages/shared`'s reducers, broadcasts seat-masked `PlayerView`s. No AI seat handling. |
| `packages/client` (`@tichu/client`) | React 19 + Vite. Two modes sharing one `GameTable` UI: multiplayer (WebSocket to `packages/server`) and solo-vs-AI (`packages/client/src/ai/soloGame.ts`, entirely client-side — no server round-trip, runs the ONNX model locally via `onnxruntime-web`). |
| `ai/` | Python + PyTorch. Self-play training (`ai/training/train.py`) and the ONNX export pipeline (`ai/export/export_onnx.py`) that turns a trained checkpoint into the model the client loads. Runs inside Docker (`docker-compose.yml`) — Python/PyTorch version mismatches on host made that the reliable path; don't run `ai/` scripts on host Python. |
| `e2e/` | Playwright E2E specs exercising the built app end to end (real browser, real server, real WS traffic) — not part of any package. |

## Commands

```bash
pnpm install
pnpm dev              # all packages' dev servers in parallel
pnpm build
pnpm -w test           # unit tests, all packages
pnpm -w test -- --coverage   # per-package coverage (see per-package notes below -- pnpm -r doesn't reliably forward the flag)
pnpm -w typecheck
pnpm -w lint
pnpm test:e2e          # Playwright -- see "E2E" below before running this cold
```

Coverage doesn't reliably propagate through `pnpm -w test -- --coverage`; run it per package instead:

```bash
cd packages/shared && pnpm exec vitest run --coverage
cd packages/server  && pnpm exec vitest run --coverage
cd packages/client  && pnpm exec vitest run --coverage
```

Server dev server defaults to port 8080 (`packages/server/src/index.ts`, override with `PORT`); client dev server defaults to 5173 (Vite default). The client's WebSocket URL is a **build-time** env var (`VITE_WS_URL`, `packages/client/src/ws/useGameSocket.ts`), not derived from `window.location` — set it before starting `vite` if the server isn't on the default port.

## E2E (`e2e/`, `playwright.config.ts`)

```bash
pnpm exec playwright install chromium   # once
pnpm test:e2e
```

- Spawns both the server and client dev servers itself (`playwright.config.ts`'s `webServer` array) — no need to start them manually first.
- **Windows note**: the server's default port 8080 sits inside this machine's Hyper-V/WSL dynamic port-exclusion range on some setups (`netsh interface ipv4 show excludedportrange protocol=tcp` to check), which fails with `EACCES`. Set `E2E_SERVER_PORT=<port outside the excluded ranges>` (e.g. `8888`) to work around it without touching the config.
- `full-game.spec.ts` drives 4 real browser contexts through room creation → a full round → the server's automatic next-round deal, using a simple "always pass, lead the safest available card" bot (`e2e/helpers.ts`) — not a smart player, just legal-move-guaranteed, since the point is exercising the server/client wiring, not game strategy.
- `solo-ai.spec.ts` verifies the AI practice mode's model loads online, caches, and reloads from cache when genuinely offline (`context.setOffline(true)`). It mocks `/models/*` with a tiny untrained fixture model (`e2e/fixtures/`) rather than depending on a real deployed checkpoint — see "AI model asset deployment" below for why a real one may not even be present in a fresh checkout.
- The server's `ROUND_OVER_DISPLAY_MS` (see below) is set to `10` for the E2E `webServer` so runs aren't stuck waiting out the real several-second delay.

## AI model asset deployment (`ai/export/`, `packages/client/public/models/`)

`packages/client/public/models/policy.onnx.enc` + `manifest.json` are the deployed model the client fetches at runtime — **gitignored build artifacts**, not source, because M2 training is ongoing and "the best checkpoint" changes frequently. A fresh checkout has neither file present; solo-vs-AI mode won't work until they're generated.

To (re)generate:

1. Copy `ai/export/.env.example` to `ai/export/.env` (gitignored) and set `CHECKPOINT` to the checkpoint you want deployed, e.g. `checkpoints/run4_vs_heuristic_1000/checkpoint_1000.pt` (path resolved relative to `ai/`, i.e. the container's `/app`).
2. `docker compose exec ai python -m export.export_onnx`

`OUT` in `.env.example` points at `deploy/client-models/`, which `docker-compose.yml` bind-mounts straight to `packages/client/public/models/` — the export writes both files directly there, no manual copy step. See `packages/client/public/models/README.md` for more detail and `ai/export/export_onnx.py`'s module docstring for the ONNX input/output contract (`obs`/`action_vectors` in, `action_logits`/`state_value` out) that must stay in sync with any change to `TichuPolicyValueNet.forward`.

For an actual deployment (not local dev), a further step uploads that same bundle to S3: `docker compose exec ai python -m export.deploy_s3` (see `ai/export/README.md` for the bucket policy/CORS/IAM setup this requires). The client then needs `VITE_MODEL_BASE_URL` (see `packages/client/src/vite-env.d.ts`) set to that bucket's origin at build time — same build-time-env-var mechanism as `VITE_WS_URL` above. Unset (local dev, E2E), `packages/client/src/ai/modelCache.ts` keeps fetching the same-origin `/models/...` paths described above.

## Mixed rooms (human + AI in the same room) — explicit future extension point

Out of MVP scope, but two places are already structured for it rather than needing a rewrite:

- `packages/shared/src/protocol.ts` (top-of-file comment): AI-seat messages, if ever added, should be a new branch of `ClientMessage`/`ServerMessage`, not layered onto the existing human-only set.
- `packages/client/src/ai/decideAiMove.ts`: deliberately a **pure function** — `(observation, actionVectors, onnxSession, strategy) -> chosenIndex`, no model loading/caching/browser API inside it. It's typed against `onnxruntime-common` rather than `onnxruntime-web` specifically so the same function would work unchanged with `onnxruntime-node` in a future server-side mixed-room implementation; only the loading/caching layer (`loadModel.ts`, browser-only today) would need a server-side counterpart.

## Known trade-offs

- **RoundOver display delay**: the server (`GameServer`'s `ROUND_OVER_DISPLAY_MS` / `GameServerOptions.roundOverDisplayMs`, default 4000ms) deliberately waits before auto-dealing the next round after scoring one, so players actually see the round summary — without it, the RoundOver and next-round broadcasts went out back-to-back and React batched straight through the intermediate render.
- **Client-side model exposure**: the ONNX model ships to the browser as-is (XOR-obfuscated only, see `ai/export/obfuscate.py`'s module docstring) — this is friction against casual extraction, not real security. Accepted trade-off: there's no ranking/rating system, so a determined user extracting the weights isn't considered a meaningful risk (see `.claude/plans/tichu-online.plan.md`'s Risks table).
- **Multiplayer waiting room never shows a live headcount before `START_GAME`**: the server has no `PlayerView`/`GameState` to broadcast until the game actually starts (`WaitingRoom.tsx`'s doc comment), so it only shows what the viewer's own `ROOM_JOINED.seat` already implies. This is a protocol-shape consequence, not an oversight — extending it would mean adding a pre-game broadcast the server doesn't otherwise need.
