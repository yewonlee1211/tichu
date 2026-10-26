---
name: new-device-setting
description: One-shot setup of a freshly cloned tichu-game on a new Windows machine — checks toolchain, installs deps, pulls the private tichu-context repo (worklog + Claude memory) and wires its junctions/sync hooks, then lists the secrets the user must copy by hand. Manual, user-invoked only; never automatic.
metadata:
  origin: project
---

# New Device Setting

Brings a fresh `git clone` of `tichu-game` on another machine up to the same working state as the main PC. The code comes from this repo; personal context (`.claude/worklog/` + Claude Code's auto-memory) lives in the separate private repo `https://github.com/yewonlee1211/tichu-context`, which this skill clones and links in. See that repo's `README.md`, `setup.ps1`, `sync.ps1` for the mechanism.

Windows only (uses junctions + PowerShell, same as the main PC). Safe to re-run: every step checks before acting.

## When to Use

- The user runs `/new-device-setting`, or says they just cloned the repo on a new/other computer and want it set up.

## Steps

Run from the repo root (the directory this session is in). Report each step's result briefly as you go; at the end give one summary table (step / result / user action needed).

1. **Toolchain check** — don't install system software yourself; list what's missing and how to get it, then continue with whatever doesn't depend on it.
   - `git --version`
   - `node --version` → must satisfy `package.json` `engines.node` (`>=22.11.0`; `.nvmrc` has the exact version)
   - `corepack --version` (ships with Node) — pnpm itself comes from `package.json`'s `packageManager` via corepack
   - `docker --version` and `docker info` (Docker Desktop must be running) — only needed for `ai/`
2. **JS dependencies** — `corepack enable` then `pnpm install`. If `corepack enable` fails with a permissions error, tell the user to run it once in an admin terminal.
3. **Context repo** (`$HOME\tichu-context`):
   - Missing → `git clone https://github.com/yewonlee1211/tichu-context.git $HOME\tichu-context`
   - Present → `git -C $HOME\tichu-context pull --rebase --autostash`
   - On an auth failure, stop this step and tell the user: it's a private repo, so this machine's GitHub login (Git Credential Manager browser prompt, or a fine-grained token that includes `tichu-context` with Contents read/write) must cover it. Have them run the clone themselves in a terminal, then re-run this skill.
4. **Link context + register hooks** — `& $HOME\tichu-context\setup.ps1 -ProjectPath <repo root absolute path>`.
   - It junctions `.claude\worklog` and `~\.claude\projects\<slug>\memory` into the context repo and adds SessionStart (pull) / Stop (push) hooks to the gitignored `.claude\settings.local.json`.
   - Any pre-existing real folder at either link path is renamed to `*.bak-<timestamp>`, not deleted — mention it if the script printed that.
   - Verify afterwards: `(Get-Item .claude\worklog).LinkType` is `Junction` and the memory folder contains `MEMORY.md`.
5. **Secrets check** — report which of these exist; never create them with placeholder values, never commit or upload them, and never read their contents:
   - `packages/server/.env` (RDS connection — server dev)
   - `ai/export/.env` (model export / S3 deploy)
   - `packages/client/.env.production` (client deploy)
   - `~\.aws\` with the `tichu-frontend-deploy` profile (deploys)
   Tell the user to copy the missing ones from the main PC by hand (USB / password manager), not via GitHub or the context repo.
6. **Optional extras** — ask once, as a single question, which of these to run now (all can be skipped):
   - `pnpm exec playwright install chromium` (E2E)
   - `docker compose up -d --build` (ai/ container — first build is slow)
   - `pnpm -w typecheck` and `pnpm -w test` (sanity check)
   Not handled by this skill, just mention: `ai/checkpoints/` (≈1.8GB, only needed to resume training/export on this machine — copy by hand) and `packages/client/public/models/` (regenerate via `docker compose exec ai python -m export.export_onnx`, see `CLAUDE.md`).
7. **Finish** — tell the user to **restart Claude Code**: this session started before the memory junction and hooks existed, so the synced memory and auto pull/push only take effect in a new session.

## Guardrails

- Never modify tracked files in `tichu-game`, and never commit anything to it — this skill only installs dependencies and touches gitignored/per-machine paths.
- Never `Remove-Item -Recurse` a junction path (Windows PowerShell 5.1 can recurse into the target and delete the real context files). `setup.ps1` already handles re-linking safely.
- Don't work on this machine and the main PC at the same time — sync is plain pull/commit/push without merge handling. Remind the user once at the end.
