---
name: deploy-client
description: Rebuild packages/client and redeploy it to the S3 + CloudFront static hosting set up in the 2026-09-09-m1-client-deploy session. Manual, user-invoked only; never automatic.
metadata:
  origin: project
---

# Deploy Client

Rebuilds `packages/client` and republishes it to the deployed URL (`https://d3eaqeztt5cahh.cloudfront.net`). This wraps `packages/client/deploy.mjs` — see `CLAUDE.md`'s "Client static deployment (S3 + CloudFront)" section for the full architecture/rationale (bucket, CloudFront distribution, IAM user scoping).

## When to Use

- The user explicitly asks to (re)deploy the client ("배포해줘", "재배포해줘", "/deploy-client").
- After a client-side code change (gameplay logic, UI fix, etc.) has landed and needs to reach the deployed URL — redeploying is the only way a fix becomes visible there, since the site is a static build, not a live server.
- Not for server (`packages/server`) changes — it has no public deployment yet; this skill only ever touches the client's static hosting.

## Steps

1. **Confirm there's actually something to deploy.** `git status`/`git diff` on `packages/client` (and `packages/shared`, since the client bundles it) — if nothing changed since the last deploy, say so and ask whether the user still wants to proceed rather than silently no-op'ing.
2. **Check `packages/client/.env.production` exists and looks complete** (`VITE_MODEL_BASE_URL` set; `VITE_WS_URL` intentionally unset until `packages/server` has a public deployment). If the file is missing, stop and tell the user to copy it from `.env.production.example` and fill in the model bucket origin — don't guess a value.
3. **Run the deploy script**: `node packages/client/deploy.mjs` (pass `--profile <name>` only if the user says the default `tichu-frontend-deploy` AWS CLI profile isn't right for them). Let its own console output show each step (build → strip `dist/models` → gzip the ONNX WASM asset in place → upload with per-file cache headers → CloudFront invalidation) — don't re-narrate it, just watch for a non-zero exit / thrown error.
4. **If it fails**, diagnose from the actual error before retrying — common causes seen before: wrong/expired AWS credentials on the profile, a typo'd region, or the IAM user lacking a permission (see CLAUDE.md's deploy user scope) needed for a new kind of operation.
5. **Tell the user to verify in a real browser** at `https://d3eaqeztt5cahh.cloudfront.net` — CloudFront invalidation can take a minute or two to propagate, so a check immediately after may still show the old version. Solo-AI mode is the only thing expected to work end-to-end; remind them multiplayer has nothing to connect to until `packages/server` gets a public deployment (separate, not-yet-started work).
6. Do not mark the task done on the strength of the script exiting 0 alone — the deploy script only proves the upload succeeded, not that the fix actually works in a browser. Wait for the user's real-browser confirmation before considering the redeploy complete.
