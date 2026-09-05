"""Uploads an exported ONNX model bundle (`policy.onnx.enc` + `manifest.json`,
produced by `export_onnx.py`) to the S3 bucket that will serve them to the browser.

Run after export_onnx.py has written its output (see `export/.env`):
  docker compose exec ai python -m export.export_onnx
  docker compose exec ai python -m export.deploy_s3

Both files are uploaded under the bucket's `models/` prefix -- the bucket policy
only grants public GetObject on that prefix, everything else in the bucket stays
private. See `ai/export/README.md` for the full deployment writeup (bucket setup,
IAM policy, final URL structure).

CacheControl is deliberately `no-cache` (revalidate on every fetch, not "don't
cache") rather than a long max-age: both files are re-uploaded to the same key on
every deploy, and the browser-side loader decides whether to redownload based on
`manifest.json`'s `iteration` field, not HTTP freshness -- a long browser HTTP
cache on `manifest.json` in particular could otherwise mask a new deploy for a
while. Revisit this once the client-side fetch path (a separate session) is in
place and its own caching strategy is known.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import boto3

from export.export_onnx import DEFAULT_ENV_FILE, load_env_file

MODEL_KEY_PREFIX = "models"
_CONTENT_TYPES = {
    ".enc": "application/octet-stream",
    ".json": "application/json",
}


def upload_model(
    onnx_path: Path,
    manifest_path: Path,
    bucket: str,
    region: str,
    access_key: str | None = None,
    secret_key: str | None = None,
) -> None:
    """Uploads both files to `s3://{bucket}/models/`. `access_key`/`secret_key` are
    passed through to boto3 explicitly (rather than relying on process env vars) to
    match this project's existing convention of scoping credentials to a single
    gitignored `.env` file instead of the shell environment; `None` falls back to
    boto3's normal credential chain (e.g. `~/.aws/credentials`) for anyone using that
    instead."""
    client = boto3.client(
        "s3",
        region_name=region,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
    )
    for path in (onnx_path, manifest_path):
        key = f"{MODEL_KEY_PREFIX}/{path.name}"
        client.upload_file(
            str(path),
            bucket,
            key,
            ExtraArgs={
                "ContentType": _CONTENT_TYPES[path.suffix],
                "CacheControl": "no-cache",
            },
        )
        print(f"uploaded {path} -> s3://{bucket}/{key}")


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Upload an exported ONNX model bundle to S3."
    )
    parser.add_argument(
        "--onnx", type=Path, default=None, help="Path to policy.onnx.enc. Falls back to OUT in --env-file."
    )
    parser.add_argument(
        "--manifest", type=Path, default=None, help="Path to manifest.json. Defaults to manifest.json next to --onnx."
    )
    parser.add_argument("--bucket", default=None, help="Target S3 bucket. Falls back to S3_BUCKET in --env-file.")
    parser.add_argument("--region", default=None, help="Bucket region. Falls back to AWS_REGION in --env-file.")
    parser.add_argument(
        "--env-file",
        type=Path,
        default=DEFAULT_ENV_FILE,
        help="KEY=VALUE file providing defaults (default: export/.env, gitignored -- see export/.env.example).",
    )
    args = parser.parse_args()

    env = load_env_file(args.env_file)
    onnx_path = args.onnx if args.onnx is not None else (Path(env["OUT"]) if "OUT" in env else None)
    if onnx_path is None:
        parser.error(f"--onnx is required (or set OUT in {args.env_file}).")
    manifest_path = args.manifest if args.manifest is not None else onnx_path.parent / "manifest.json"
    bucket = args.bucket if args.bucket is not None else env.get("S3_BUCKET")
    region = args.region if args.region is not None else env.get("AWS_REGION")
    if bucket is None:
        parser.error(f"--bucket is required (or set S3_BUCKET in {args.env_file}).")
    if region is None:
        parser.error(f"--region is required (or set AWS_REGION in {args.env_file}).")
    if not onnx_path.is_file():
        parser.error(f"onnx file not found: {onnx_path} (run export_onnx.py first)")
    if not manifest_path.is_file():
        parser.error(f"manifest file not found: {manifest_path} (run export_onnx.py first)")

    upload_model(
        onnx_path,
        manifest_path,
        bucket,
        region,
        access_key=env.get("AWS_ACCESS_KEY_ID"),
        secret_key=env.get("AWS_SECRET_ACCESS_KEY"),
    )


if __name__ == "__main__":
    _main()
