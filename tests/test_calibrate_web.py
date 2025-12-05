"""Tests for calibrate_web.py web-based calibration server."""

import pytest
import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

# Check if fastapi is available
try:
    import fastapi
    from fastapi.testclient import TestClient
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

# Skip all tests if fastapi is not installed
pytestmark = pytest.mark.skipif(not HAS_FASTAPI, reason="fastapi not installed")


class TestCalibrationController:
    """Tests for CalibrationController class."""

    def test_init_with_mock_controller(self):
        """Test initialization with mock servo controller."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                assert controller.use_hardware is False
                assert controller.servo is not None
                assert controller.calibration == {}

    def test_init_loads_existing_calibration(self):
        """Test that existing calibration is loaded on init."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_data = {"0,0": 1, "1,1": 5}
            cal_file.write_text(json.dumps(cal_data), encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                assert controller.calibration == cal_data

    def test_set_servo_angle(self):
        """Test setting servo angle."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                result = controller.set_servo_angle(0, 90.0)

                assert result["success"] is True
                assert result["channel"] == 0
                assert result["angle"] == 90.0
                assert controller.current_angles[0] == 90.0

    def test_set_servo_angle_clamps_high(self):
        """Test that angle is clamped to 180 max."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                result = controller.set_servo_angle(0, 200.0)

                assert result["success"] is True
                assert result["angle"] == 180.0

    def test_set_servo_angle_clamps_low(self):
        """Test that angle is clamped to 0 min."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                result = controller.set_servo_angle(0, -10.0)

                assert result["success"] is True
                assert result["angle"] == 0.0

    def test_set_mapping(self):
        """Test setting leg/joint to channel mapping."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                result = controller.set_mapping(0, 1, 5)

                assert result["success"] is True
                assert result["key"] == "0,1"
                assert result["channel"] == 5
                assert controller.calibration["0,1"] == 5

    def test_get_mapping(self):
        """Test getting channel for leg/joint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_data = {"2,1": 10}
            cal_file.write_text(json.dumps(cal_data), encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                assert controller.get_mapping(2, 1) == 10
                assert controller.get_mapping(0, 0) is None

    def test_remove_mapping(self):
        """Test removing a mapping."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_data = {"0,0": 1}
            cal_file.write_text(json.dumps(cal_data), encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                result = controller.remove_mapping(0, 0)
                assert result["success"] is True
                assert "0,0" not in controller.calibration

    def test_remove_nonexistent_mapping(self):
        """Test removing a mapping that doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                result = controller.remove_mapping(5, 2)
                assert result["success"] is False
                assert "not found" in result["error"]

    def test_save_calibration(self):
        """Test saving calibration to file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)
                controller.set_mapping(0, 0, 5)

                result = controller.save()

                assert result["success"] is True
                assert cal_file.exists()
                saved = json.loads(cal_file.read_text(encoding='utf-8'))
                assert saved["0,0"] == 5

    def test_reload_calibration(self):
        """Test reloading calibration from file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text('{}', encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                # Modify in-memory
                controller.calibration["0,0"] = 99

                # Write new data to file
                cal_file.write_text('{"1,1": 10}', encoding='utf-8')

                result = controller.reload()

                assert result["success"] is True
                assert controller.calibration == {"1,1": 10}

    def test_get_status(self):
        """Test getting calibration status."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text('{"0,0": 1}', encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)
                controller.set_servo_angle(0, 45.0)

                status = controller.get_status()

                assert status["hardware"] is False
                assert status["calibration"] == {"0,0": 1}
                assert status["current_angles"] == {0: 45.0}

    def test_set_all_to_neutral(self):
        """Test setting all configured servos to neutral."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_data = {"0,0": 0, "0,1": 1, "1,0": 2}
            cal_file.write_text(json.dumps(cal_data), encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import CalibrationController
                controller = CalibrationController(use_hardware=False)

                result = controller.set_all_to_neutral()

                assert result["success"] is True
                assert len(result["results"]) == 3
                assert controller.current_angles[0] == 90.0
                assert controller.current_angles[1] == 90.0
                assert controller.current_angles[2] == 90.0


class TestCalibrationAPI:
    """Tests for calibration REST API endpoints."""

    def test_get_status_endpoint(self):
        """Test GET /api/status endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.get("/api/status")

                assert response.status_code == 200
                data = response.json()
                assert "hardware" in data
                assert "calibration" in data

    def test_get_calibration_endpoint(self):
        """Test GET /api/calibration endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text('{"0,0": 5}', encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.get("/api/calibration")

                assert response.status_code == 200
                data = response.json()
                assert data["calibration"] == {"0,0": 5}

    def test_set_mapping_endpoint(self):
        """Test POST /api/mapping endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.post("/api/mapping", json={"leg": 0, "joint": 1, "channel": 5})

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert data["key"] == "0,1"

    def test_set_mapping_missing_params(self):
        """Test POST /api/mapping with missing parameters."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.post("/api/mapping", json={"leg": 0})

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is False

    def test_set_servo_angle_endpoint(self):
        """Test POST /api/servo/angle endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.post("/api/servo/angle", json={"channel": 0, "angle": 90})

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert data["angle"] == 90.0

    def test_set_neutral_endpoint(self):
        """Test POST /api/servo/neutral endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text('{"0,0": 0}', encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.post("/api/servo/neutral")

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True

    def test_save_calibration_endpoint(self):
        """Test POST /api/calibration/save endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                # First set a mapping
                client.post("/api/mapping", json={"leg": 0, "joint": 0, "channel": 5})

                # Then save
                response = client.post("/api/calibration/save")

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True
                assert cal_file.exists()

    def test_reload_calibration_endpoint(self):
        """Test POST /api/calibration/reload endpoint."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text('{"2,2": 15}', encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.post("/api/calibration/reload")

                assert response.status_code == 200
                data = response.json()
                assert data["success"] is True

    def test_index_serves_html(self):
        """Test that index serves calibrate.html."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / ".hexapod_calibration.json"):
                from hexapod.calibrate_web import create_calibration_app
                app = create_calibration_app(use_hardware=False)
                client = TestClient(app)

                response = client.get("/")

                # Should either serve HTML or 404 if file not found
                assert response.status_code in [200, 404]


class TestLoadSaveCalibration:
    """Tests for module-level load/save functions."""

    def test_load_calibration_nonexistent(self):
        """Test loading when file doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('hexapod.calibrate_web.CALIBRATION_FILE', Path(tmpdir) / "nonexistent.json"):
                from hexapod.calibrate_web import load_calibration
                result = load_calibration()
                assert result == {}

    def test_load_calibration_existing(self):
        """Test loading existing calibration."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text('{"0,0": 1, "1,1": 2}', encoding='utf-8')

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import load_calibration
                result = load_calibration()
                assert result == {"0,0": 1, "1,1": 2}

    def test_save_calibration_creates_file(self):
        """Test that save creates file if it doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"

            with patch('hexapod.calibrate_web.CALIBRATION_FILE', cal_file):
                from hexapod.calibrate_web import save_calibration
                save_calibration({"test": 123})

                assert cal_file.exists()
                saved = json.loads(cal_file.read_text(encoding='utf-8'))
                assert saved == {"test": 123}
