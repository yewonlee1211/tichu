# Model export + S3 deploy pipeline

Two steps, both run inside the `ai` Docker container:

```bash
docker compose exec ai python -m export.export_onnx
docker compose exec ai python -m export.deploy_s3
```

1. `export_onnx.py` reads `CHECKPOINT` from `export/.env`, exports + XOR-obfuscates it,
   and writes `policy.onnx.enc` + `manifest.json` to `OUT` (see `export/.env.example`).
2. `deploy_s3.py` uploads both files from that same `OUT` location to
   `s3://<S3_BUCKET>/models/` (`S3_BUCKET`/`AWS_REGION`/credentials also in `export/.env`).

Both scripts share the same `--env-file` (`export/.env`, gitignored) and the same
hand-rolled `KEY=VALUE` loader (`export_onnx.load_env_file`) -- no `python-dotenv`
dependency added for this handful of flat values.

## S3 bucket

- Name/region: set in your local `export/.env` (`S3_BUCKET`/`AWS_REGION`, gitignored --
  see `.env.example`). Region matches the RDS Postgres instance from
  `2026-09-03-m1-aws-postgres-deploy` (`ap-southeast-2`) -- region choice doesn't
  materially affect fetch latency here since this is a public static-file bucket, not
  compute, but kept consistent with existing infra.
- Versioning: **on**, with a lifecycle rule expiring noncurrent versions after 30 days
  -- gives a rollback window if a bad checkpoint gets deployed, without unbounded
  storage growth.
- Public access: only the `models/*` prefix is public (`s3:GetObject` via bucket
  policy). Everything else in the bucket stays private. No CloudFront in front of it
  for now -- the browser-side loader (`packages/client/src/ai/loadModel.ts`) already
  caches the model via a service worker after first download, so CDN edge-caching
  buys little at this project's traffic level. Revisit if that changes.
- Deploy credentials: IAM user `tichu-model-deploy`, least-privilege policy scoped to
  `PutObject`/`GetObject`/`ListBucket` (prefix-conditioned) on this bucket's
  `models/*` only -- not the `AdministratorAccess` group used for RDS console work.

## Final URL structure (for the client-side fetch path -- separate session)

```
https://<S3_BUCKET>.s3.<AWS_REGION>.amazonaws.com/models/policy.onnx.enc
https://<S3_BUCKET>.s3.<AWS_REGION>.amazonaws.com/models/manifest.json
```

(the real bucket name/region live in the gitignored `export/.env` -- see the session
worklog for this session's actual values if you need them for a one-off check)

`packages/client/src/ai/loadModel.ts` currently fetches these from the same-origin
`/models/policy.onnx.enc` + `/models/manifest.json` (static files under
`packages/client/public/models/`, gitignored build artifacts -- see that directory's
own README). Pointing it at the URLs above instead is the next session's work; this
session only stands up the bucket and the upload step, it does not touch
`packages/client`.

Both objects are uploaded with `CacheControl: no-cache` (see `deploy_s3.py`'s module
docstring for why) -- worth re-checking once the client's fetch path lands, since that
session may want a different caching strategy on top of its own service-worker cache.
