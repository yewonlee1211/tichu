import sys
from pathlib import Path
from unittest.mock import MagicMock

import pytest

from export import deploy_s3
from export.deploy_s3 import _main, upload_model


def _make_bundle(tmp_path: Path) -> tuple[Path, Path]:
    onnx_path = tmp_path / "policy.onnx.enc"
    onnx_path.write_bytes(b"fake-onnx-bytes")
    manifest_path = tmp_path / "manifest.json"
    manifest_path.write_text('{"iteration": 3}')
    return onnx_path, manifest_path


def test_upload_model_uploads_both_files_under_the_models_prefix_with_expected_content_types(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    onnx_path, manifest_path = _make_bundle(tmp_path)
    mock_client = MagicMock()
    monkeypatch.setattr(deploy_s3.boto3, "client", MagicMock(return_value=mock_client))

    upload_model(onnx_path, manifest_path, bucket="test-bucket", region="ap-southeast-2")

    calls = {call.args[1:3]: call.kwargs["ExtraArgs"] for call in mock_client.upload_file.call_args_list}
    assert calls[("test-bucket", "models/policy.onnx.enc")]["ContentType"] == "application/octet-stream"
    assert calls[("test-bucket", "models/manifest.json")]["ContentType"] == "application/json"


def test_upload_model_passes_credentials_and_region_through_to_boto3_client(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    onnx_path, manifest_path = _make_bundle(tmp_path)
    mock_client_factory = MagicMock(return_value=MagicMock())
    monkeypatch.setattr(deploy_s3.boto3, "client", mock_client_factory)

    upload_model(
        onnx_path,
        manifest_path,
        bucket="test-bucket",
        region="ap-southeast-2",
        access_key="AKIA...",
        secret_key="secret",
    )

    mock_client_factory.assert_called_once_with(
        "s3", region_name="ap-southeast-2", aws_access_key_id="AKIA...", aws_secret_access_key="secret"
    )


def test_main_falls_back_to_env_file_for_bucket_and_region(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    onnx_path, manifest_path = _make_bundle(tmp_path)
    env_path = tmp_path / ".env"
    env_path.write_text(f"OUT={onnx_path}\nS3_BUCKET=tichu-online-model-assets\nAWS_REGION=ap-southeast-2\n")
    mock_client = MagicMock()
    monkeypatch.setattr(deploy_s3.boto3, "client", MagicMock(return_value=mock_client))

    monkeypatch.setattr(sys, "argv", ["deploy_s3.py", "--env-file", str(env_path)])
    _main()

    assert mock_client.upload_file.call_count == 2


def test_main_exits_with_an_error_when_the_onnx_file_is_missing(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "deploy_s3.py",
            "--onnx",
            str(tmp_path / "missing.onnx.enc"),
            "--bucket",
            "tichu-online-model-assets",
            "--region",
            "ap-southeast-2",
        ],
    )
    with pytest.raises(SystemExit):
        _main()


def test_main_exits_with_an_error_when_neither_cli_nor_env_file_gives_a_bucket(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
):
    onnx_path, _manifest_path = _make_bundle(tmp_path)
    monkeypatch.setattr(
        sys,
        "argv",
        ["deploy_s3.py", "--onnx", str(onnx_path), "--region", "ap-southeast-2", "--env-file", str(tmp_path / "missing.env")],
    )
    with pytest.raises(SystemExit):
        _main()
