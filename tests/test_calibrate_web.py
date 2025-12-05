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


def test_status_reports_coverage_and_available_channels(tmp_path):
    """Coverage and free channels should be included in status."""

    client = build_client(tmp_path)
    client.post("/api/mapping", json={"leg": 0, "joint": 1, "channel": 2})

    status = client.get("/api/status").json()
    coverage = status["coverage"]

    assert coverage["mapped"] == 1
    assert coverage["legs_configured"] == 1
    assert 2 not in coverage["available_channels"]
    assert all(not (u["leg"] == 0 and u["joint"] == 1) for u in coverage["unmapped"])


def test_mapping_endpoints_return_updated_coverage(tmp_path):
    """Mapping changes should send back refreshed coverage snapshots."""

    client = build_client(tmp_path)

    add_resp = client.post("/api/mapping", json={"leg": 3, "joint": 2, "channel": 5})
    added = add_resp.json()

    assert added["success"] is True
    assert added["coverage"]["mapped"] == 1
    assert added["coverage"]["unmapped"]

    remove_resp = client.delete("/api/mapping", params={"leg": 3, "joint": 2})
    removed = remove_resp.json()

    assert removed["success"] is True
    assert removed["coverage"]["mapped"] == 0
