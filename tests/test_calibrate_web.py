"""Tests for calibration web app metadata and endpoints."""

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hexapod import calibrate_web


@pytest.fixture(autouse=True)
def restore_calibration_file():
    """Ensure calibration path modifications do not leak between tests."""

    original_file = calibrate_web.CALIBRATION_FILE
    yield
    calibrate_web.CALIBRATION_FILE = original_file


def build_client(tmp_path: Path) -> TestClient:
    """Create a TestClient with calibration file redirected to tmp_path."""

    fake_file = tmp_path / "calibration.json"
    calibrate_web.CALIBRATION_FILE = fake_file
    app = calibrate_web.create_calibration_app()
    return TestClient(app)


def test_calibration_endpoint_includes_metadata(tmp_path):
    """Metadata should accompany calibration payloads for UI display."""

    client = build_client(tmp_path)
    response = client.get("/api/calibration")
    payload = response.json()

    assert payload["metadata"]["path"] == str(calibrate_web.CALIBRATION_FILE)
    assert payload["metadata"]["exists"] is False
    assert payload["calibration"] == {}


def test_save_creates_file_and_reports_metadata(tmp_path):
    """Saving calibration should create the file and return metadata."""

    client = build_client(tmp_path)
    response = client.post("/api/calibration/save")
    payload = response.json()

    saved_path = Path(payload["metadata"]["path"])
    assert payload["success"] is True
    assert payload["metadata"]["exists"] is True
    assert saved_path.exists()
    assert payload["metadata"]["size"] >= 2  # "{}" when empty
