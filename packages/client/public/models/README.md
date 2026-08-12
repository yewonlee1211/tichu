# AI model assets

`policy.onnx.enc` and `manifest.json` are generated build artifacts, not source --
they are gitignored here for the same reason `ai/checkpoints/` is (M2 training is
still producing new checkpoints, so a committed model would go stale immediately).

To (re)generate them:

1. Copy `ai/export/.env.example` to `ai/export/.env` and set `CHECKPOINT` to the
   checkpoint you want deployed (resolved relative to `ai/`).
2. `docker compose exec ai python -m export.export_onnx`

`OUT` in `.env.example` already points at `deploy/client-models/`, which
`docker-compose.yml` bind-mounts to this directory -- the export writes
`policy.onnx.enc` and `manifest.json` straight here, no manual copy needed.

The client (`packages/client/src/ai/loadModel.ts`) fetches these at
`/models/policy.onnx.enc` and `/models/manifest.json`; both must exist for
solo-vs-AI mode (and its offline cache) to work.
