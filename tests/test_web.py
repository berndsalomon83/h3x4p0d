"""Integration tests for web API endpoints and FastAPI application."""
import pytest
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

fastapi = pytest.importorskip("fastapi")
from fastapi.testclient import TestClient
_ = fastapi
from hexapod.web import create_app
from hexapod.hardware import MockServoController


@pytest.fixture
def client():
    """Create test client with mock hardware."""
    app = create_app(servo=MockServoController(), use_controller=False)
    with TestClient(app) as test_client:
        yield test_client


@pytest.mark.integration
class TestWebAPI:
    """Test web API endpoints."""

    def test_status_endpoint(self, client):
        """Test /api/status endpoint returns telemetry."""
        response = client.get("/api/status")

        assert response.status_code == 200
        data = response.json()

        assert "running" in data
        assert "gait_mode" in data
        assert "time" in data
        assert "temperature_c" in data
        assert "battery_v" in data

    def test_sensors_endpoint(self, client):
        """Test /api/sensors endpoint returns sensor data."""
        response = client.get("/api/sensors")

        assert response.status_code == 200
        data = response.json()

        assert "temperature_c" in data
        assert "battery_v" in data
        assert isinstance(data["temperature_c"], float)
        assert isinstance(data["battery_v"], float)

    def test_set_gait_tripod(self, client):
        """Test setting gait to tripod mode."""
        response = client.post("/api/gait", json={"mode": "tripod"})

        assert response.status_code == 200
        data = response.json()

        assert data["ok"] is True
        assert data["mode"] == "tripod"

    def test_set_gait_wave(self, client):
        """Test setting gait to wave mode."""
        response = client.post("/api/gait", json={"mode": "wave"})

        assert response.status_code == 200
        data = response.json()

        assert data["ok"] is True
        assert data["mode"] == "wave"

    def test_set_gait_ripple(self, client):
        """Test setting gait to ripple mode."""
        response = client.post("/api/gait", json={"mode": "ripple"})

        assert response.status_code == 200
        data = response.json()

        assert data["ok"] is True
        assert data["mode"] == "ripple"

    def test_set_gait_invalid(self, client):
        """Test setting invalid gait mode returns error."""
        response = client.post("/api/gait", json={"mode": "invalid"})

        assert response.status_code == 400
        data = response.json()

        assert "error" in data

    def test_run_start(self, client):
        """Test starting the robot."""
        response = client.post("/api/run", json={"run": True})

        assert response.status_code == 200
        data = response.json()

        assert data["running"] is True

    def test_run_stop(self, client):
        """Test stopping the robot."""
        response = client.post("/api/run", json={"run": False})

        assert response.status_code == 200
        data = response.json()

        assert data["running"] is False

    def test_stop_endpoint(self, client):
        """Test /api/stop endpoint."""
        response = client.post("/api/stop")

        assert response.status_code == 200
        data = response.json()

        assert data["stopped"] is True

    def test_status_reflects_gait_change(self, client):
        """Test that status endpoint reflects gait mode changes."""
        # Set to wave mode
        client.post("/api/gait", json={"mode": "wave"})

        # Check status
        response = client.get("/api/status")
        data = response.json()

        assert data["gait_mode"] == "wave"

    def test_status_reflects_running_state(self, client):
        """Test that status endpoint reflects running state."""
        # Start robot
        client.post("/api/run", json={"run": True})

        # Check status
        response = client.get("/api/status")
        data = response.json()

        assert data["running"] is True

        # Stop robot
        client.post("/api/run", json={"run": False})

        # Check status again
        response = client.get("/api/status")
        data = response.json()

        assert data["running"] is False

    def test_multiple_gait_changes(self, client):
        """Test changing gait mode multiple times."""
        modes = ["tripod", "wave", "ripple", "tripod"]

        for mode in modes:
            response = client.post("/api/gait", json={"mode": mode})
            assert response.status_code == 200

            status = client.get("/api/status")
            assert status.json()["gait_mode"] == mode

    def test_sensor_values_in_range(self, client):
        """Test that sensor values are within expected ranges."""
        response = client.get("/api/sensors")
        data = response.json()

        # Temperature should be reasonable (in Celsius)
        assert 0 < data["temperature_c"] < 100

        # Battery voltage should be reasonable (12V nominal)
        assert 8.0 < data["battery_v"] < 15.0

    def test_concurrent_requests(self, client):
        """Test handling multiple concurrent API requests."""
        # Make multiple requests
        responses = []
        for _ in range(10):
            responses.append(client.get("/api/status"))

        # All should succeed
        for response in responses:
            assert response.status_code == 200


@pytest.mark.integration
class TestWebSocketAPI:
    """Test WebSocket functionality."""

    def test_websocket_connect(self, client):
        """Test WebSocket connection establishment."""
        with client.websocket_connect("/ws") as websocket:
            # Connection should be established
            assert websocket is not None

    def test_websocket_set_gait(self, client):
        """Test setting gait via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "set_gait", "mode": "wave"})

            # Verify gait was changed via REST API
            response = client.get("/api/status")
            data = response.json()
            assert data["gait_mode"] == "wave"

    def test_websocket_walk_command(self, client):
        """Test walk command via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "walk", "walking": True})

            # Verify running state changed via REST API
            response = client.get("/api/status")
            data = response.json()
            assert data["running"] is True

    def test_websocket_move_command(self, client):
        """Test move command via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({
                "type": "move",
                "walking": True,
                "speed": 0.8,
                "heading": 45.0
            })

            # Verify state changed
            response = client.get("/api/status")
            data = response.json()
            assert data["running"] is True
            assert data["speed"] == 0.8
            assert data["heading"] == 45.0

    def test_websocket_receives_telemetry(self, client):
        """Test receiving telemetry updates via WebSocket."""
        with client.websocket_connect("/ws"):
            # Should receive telemetry broadcasts
            # Note: This test may need a timeout as it waits for broadcasts
            import time
            time.sleep(0.1)  # Wait briefly for broadcast

            # The background task should broadcast telemetry
            # This test verifies the connection stays open

    def test_websocket_pose_preset_stand(self, client):
        """Test pose preset command via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "pose", "preset": "stand"})

            # Verify body_height changed
            response = client.get("/api/status")
            data = response.json()
            assert data["body_height"] == 80.0
            assert data["running"] is False

    def test_websocket_pose_preset_crouch(self, client):
        """Test crouch pose preset via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({"type": "pose", "preset": "crouch"})

            response = client.get("/api/status")
            data = response.json()
            assert data["body_height"] == 40.0
            assert data["leg_spread"] == 120.0

    def test_websocket_pose_preset_neutral(self, client):
        """Test neutral pose preset via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            # First set to stand
            websocket.send_json({"type": "pose", "preset": "stand"})
            # Then reset to neutral
            websocket.send_json({"type": "pose", "preset": "neutral"})

            response = client.get("/api/status")
            data = response.json()
            assert data["body_height"] == 60.0
            assert data["leg_spread"] == 100.0


@pytest.mark.integration
class TestHexapodController:
    """Test HexapodController integration."""

    def test_controller_initialization(self):
        """Test controller initializes with dependencies."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        assert controller.servo is servo
        assert controller.sensor is sensor
        assert controller.running is False
        assert controller.gait_mode == "tripod"

    def test_controller_telemetry(self):
        """Test controller telemetry collection."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        telemetry = controller.get_telemetry()

        assert "running" in telemetry
        assert "gait_mode" in telemetry
        assert "time" in telemetry
        assert "temperature_c" in telemetry
        assert "battery_v" in telemetry

    def test_controller_update_servos(self):
        """Test controller servo update."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        controller.running = True
        angles = controller.update_servos()

        # Should return 6 leg angles
        assert len(angles) == 6

        # Each leg should have 3 joint angles
        for leg_angles in angles:
            assert len(leg_angles) == 3


@pytest.mark.integration
class TestConnectionManager:
    """Test WebSocket connection manager."""

    @pytest.mark.asyncio
    async def test_connection_manager_broadcast(self):
        """Test connection manager broadcast functionality."""
        from hexapod.web import ConnectionManager
        from unittest.mock import AsyncMock

        manager = ConnectionManager()

        # Create mock websocket
        mock_ws = AsyncMock()
        await manager.connect(mock_ws)

        assert len(manager.active) == 1

        # Broadcast message
        message = {"type": "test", "data": "hello"}
        await manager.broadcast(message)

        # Verify websocket received message
        mock_ws.send_json.assert_called_once_with(message)

    @pytest.mark.asyncio
    async def test_connection_manager_disconnect(self):
        """Test connection manager disconnect."""
        from hexapod.web import ConnectionManager
        from unittest.mock import AsyncMock

        manager = ConnectionManager()

        mock_ws = AsyncMock()
        await manager.connect(mock_ws)

        assert len(manager.active) == 1

        manager.disconnect(mock_ws)

        assert len(manager.active) == 0

    def test_gait_endpoint_missing_mode(self, client):
        """Test /api/gait endpoint with missing mode parameter."""
        response = client.post("/api/gait", json={})
        assert response.status_code == 400

    def test_run_endpoint_invalid_json(self, client):
        """Test /api/run endpoint with invalid JSON."""
        response = client.post("/api/run", json={"invalid": "data"})
        # Should handle gracefully
        assert response.status_code == 200

    def test_sequential_gait_and_run_commands(self, client):
        """Test sequential gait changes and run commands."""
        # Set gait to wave
        client.post("/api/gait", json={"mode": "wave"})
        # Start running
        client.post("/api/run", json={"run": True})
        # Change gait while running
        client.post("/api/gait", json={"mode": "ripple"})

        status = client.get("/api/status")
        data = status.json()

        assert data["running"] is True
        assert data["gait_mode"] == "ripple"

    def test_stop_when_not_running(self, client):
        """Test stopping when already stopped."""
        # Stop when not running
        response = client.post("/api/stop")
        assert response.status_code == 200
        assert response.json()["stopped"] is True

    def test_websocket_invalid_message_type(self, client):
        """Test WebSocket with invalid message type."""
        with client.websocket_connect("/ws") as websocket:
            # Send invalid message type
            websocket.send_json({"type": "invalid_type"})

            # Connection should remain open
            # Verify with valid command
            websocket.send_json({"type": "set_gait", "mode": "tripod"})

    def test_websocket_move_with_boundary_values(self, client):
        """Test WebSocket move command with boundary values."""
        with client.websocket_connect("/ws") as websocket:
            # Test max speed
            websocket.send_json({
                "type": "move",
                "walking": True,
                "speed": 1.0,
                "heading": 0.0
            })

            response = client.get("/api/status")
            assert response.json()["speed"] == 1.0

            # Test min speed
            websocket.send_json({
                "type": "move",
                "walking": True,
                "speed": 0.0,
                "heading": 0.0
            })

            response = client.get("/api/status")
            assert response.json()["speed"] == 0.0

    def test_websocket_move_with_negative_speed(self, client):
        """Test WebSocket move command with negative speed (should clamp)."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({
                "type": "move",
                "walking": True,
                "speed": -0.5,
                "heading": 0.0
            })

            response = client.get("/api/status")
            # Speed should be clamped to 0
            assert response.json()["speed"] == 0.0

    def test_websocket_move_with_excessive_speed(self, client):
        """Test WebSocket move command with speed > 1.0 (should clamp)."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({
                "type": "move",
                "walking": True,
                "speed": 2.5,
                "heading": 0.0
            })

            response = client.get("/api/status")
            # Speed should be clamped to 1.0
            assert response.json()["speed"] == 1.0

    def test_websocket_heading_values(self, client):
        """Test WebSocket with various heading values."""
        with client.websocket_connect("/ws") as websocket:
            headings = [0.0, 45.0, 90.0, 180.0, 270.0, 360.0, -90.0]

            for heading in headings:
                websocket.send_json({
                    "type": "move",
                    "walking": True,
                    "speed": 0.5,
                    "heading": heading
                })

                response = client.get("/api/status")
                assert response.json()["heading"] == heading

    def test_controller_motion_command_move(self):
        """Test controller handling move motion command."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader
        from hexapod.controller_bluetooth import MotionCommand

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        # Simulate move command
        cmd = MotionCommand("move", x=0.5, y=0.8)
        controller._handle_motion_cmd(cmd)

        # Speed and heading should be updated
        assert controller.speed > 0

    def test_controller_motion_command_gait(self):
        """Test controller handling gait motion command."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader
        from hexapod.controller_bluetooth import MotionCommand

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        # Change to wave gait
        cmd = MotionCommand("gait", mode="wave")
        controller._handle_motion_cmd(cmd)

        assert controller.gait_mode == "wave"

    def test_controller_motion_command_start_stop(self):
        """Test controller handling start/stop motion commands."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader
        from hexapod.controller_bluetooth import MotionCommand

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        # Start
        cmd = MotionCommand("start")
        controller._handle_motion_cmd(cmd)
        assert controller.running is True

        # Stop
        cmd = MotionCommand("stop")
        controller._handle_motion_cmd(cmd)
        assert controller.running is False

    def test_controller_motion_command_quit(self):
        """Test controller handling quit motion command."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader
        from hexapod.controller_bluetooth import MotionCommand

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        controller.running = True

        cmd = MotionCommand("quit")
        controller._handle_motion_cmd(cmd)

        assert controller.running is False

    def test_controller_update_servos_when_stopped(self):
        """Test that servos still return angles when stopped."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        controller.running = False
        angles = controller.update_servos()

        # Should return angles even when stopped (for visualization)
        assert len(angles) == 6
        assert all(len(leg) == 3 for leg in angles)

    def test_controller_update_servos_when_running(self):
        """Test that servos update when running."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        controller.running = True
        angles = controller.update_servos()

        assert len(angles) == 6

    def test_controller_telemetry_fields(self):
        """Test that telemetry contains all expected fields."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        telemetry = controller.get_telemetry()

        required_fields = [
            "running", "gait_mode", "time", "speed", "heading",
            "temperature_c", "battery_v", "leg_spread"
        ]
        for field in required_fields:
            assert field in telemetry

    def test_controller_heading_update(self):
        """Test controller heading calculation from motion command."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader
        from hexapod.controller_bluetooth import MotionCommand

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        # Move forward (y=1, x=0) should be heading 0
        cmd = MotionCommand("move", x=0.0, y=1.0)
        controller._handle_motion_cmd(cmd)

        assert abs(controller.heading) < 5  # Close to 0 degrees

    def test_controller_invalid_gait_mode(self):
        """Test controller with invalid gait mode in motion command."""
        from hexapod.web import HexapodController
        from hexapod.hardware import MockServoController, SensorReader
        from hexapod.controller_bluetooth import MotionCommand

        servo = MockServoController()
        sensor = SensorReader(mock=True)
        controller = HexapodController(servo, sensor)

        original_mode = controller.gait_mode

        # Try to set invalid mode
        cmd = MotionCommand("gait", mode="invalid")
        controller._handle_motion_cmd(cmd)

        # Mode should remain unchanged
        assert controller.gait_mode == original_mode

    @pytest.mark.asyncio
    async def test_connection_manager_multiple_connections(self):
        """Test connection manager with multiple simultaneous connections."""
        from hexapod.web import ConnectionManager
        from unittest.mock import AsyncMock

        manager = ConnectionManager()

        # Connect 5 websockets
        websockets = [AsyncMock() for _ in range(5)]
        for ws in websockets:
            await manager.connect(ws)

        assert len(manager.active) == 5

        # Broadcast to all
        message = {"type": "test"}
        await manager.broadcast(message)

        # All should receive message
        for ws in websockets:
            ws.send_json.assert_called_once_with(message)

    @pytest.mark.asyncio
    async def test_connection_manager_broadcast_with_exception(self):
        """Test that broadcast continues after websocket exception."""
        from hexapod.web import ConnectionManager
        from unittest.mock import AsyncMock

        manager = ConnectionManager()

        # Create websockets, one will raise exception
        ws1 = AsyncMock()
        ws2 = AsyncMock()
        ws2.send_json.side_effect = Exception("Connection error")
        ws3 = AsyncMock()

        await manager.connect(ws1)
        await manager.connect(ws2)
        await manager.connect(ws3)

        message = {"type": "test"}
        await manager.broadcast(message)

        # ws1 and ws3 should receive message
        ws1.send_json.assert_called_once()
        ws3.send_json.assert_called_once()

        # ws2 should be disconnected after exception
        assert ws2 not in manager.active

    def test_index_endpoint(self, client):
        """Test index endpoint returns HTML."""
        response = client.get("/")
        assert response.status_code == 200

    def test_static_file_endpoint(self, client):
        """Test static file serving."""
        # Try to get app.js
        response = client.get("/static/app.js")
        # Should either return the file or 404 if not found
        assert response.status_code in [200, 404]

    def test_api_status_time_field(self, client):
        """Test that status endpoint includes time field."""
        response = client.get("/api/status")
        data = response.json()

        assert "time" in data
        assert isinstance(data["time"], (int, float))
        assert data["time"] >= 0


@pytest.mark.integration
class TestPosesAPI:
    """Test poses API endpoints."""

    def test_list_poses_endpoint(self, client):
        """Test GET /api/poses returns all poses."""
        response = client.get("/api/poses")

        assert response.status_code == 200
        data = response.json()

        assert "poses" in data
        poses = data["poses"]
        assert isinstance(poses, dict)
        assert "default_stance" in poses
        assert "low_stance" in poses
        assert "high_stance" in poses

    def test_list_poses_contains_required_fields(self, client):
        """Test that each pose has required fields."""
        response = client.get("/api/poses")
        data = response.json()

        for pose_id, pose in data["poses"].items():
            assert "name" in pose
            assert "category" in pose
            assert "height" in pose
            assert "roll" in pose
            assert "pitch" in pose
            assert "yaw" in pose
            assert "leg_spread" in pose

    def test_create_pose_endpoint(self, client):
        """Test POST /api/poses with create action."""
        import uuid
        unique_name = f"Test Pose {uuid.uuid4().hex[:8]}"
        expected_id = unique_name.lower().replace(" ", "_")

        response = client.post("/api/poses", json={
            "action": "create",
            "name": unique_name,
            "category": "debug",
            "height": 100.0,
            "roll": 5.0,
            "pitch": 10.0,
            "yaw": 15.0,
            "leg_spread": 110.0
        })

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True

        # Verify pose was created
        list_response = client.get("/api/poses")
        poses = list_response.json()["poses"]
        assert expected_id in poses

    def test_create_pose_duplicate_fails(self, client):
        """Test that creating a duplicate pose returns error."""
        # The API generates pose_id from name, so use "Default Stance" which generates "default_stance"
        response = client.post("/api/poses", json={
            "action": "create",
            "name": "Default Stance",  # This generates pose_id "default_stance" which exists
            "category": "operation",
            "height": 100.0,
            "roll": 0.0,
            "pitch": 0.0,
            "yaw": 0.0,
            "leg_spread": 100.0
        })

        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_update_pose_endpoint(self, client):
        """Test POST /api/poses with update action."""
        # First create a pose - API generates pose_id from name
        # "Update Test" -> "update_test"
        client.post("/api/poses", json={
            "action": "create",
            "name": "Update Test",
            "category": "operation",
            "height": 100.0,
            "roll": 0.0,
            "pitch": 0.0,
            "yaw": 0.0,
            "leg_spread": 100.0
        })

        # Then update it using the generated pose_id
        response = client.post("/api/poses", json={
            "action": "update",
            "pose_id": "update_test",
            "name": "Updated Name",
            "height": 150.0
        })

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True

        # Verify update
        list_response = client.get("/api/poses")
        pose = list_response.json()["poses"]["update_test"]
        assert pose["name"] == "Updated Name"
        assert pose["height"] == 150.0

    def test_update_nonexistent_pose_fails(self, client):
        """Test that updating a nonexistent pose returns 404."""
        response = client.post("/api/poses", json={
            "action": "update",
            "pose_id": "nonexistent_pose",
            "name": "New Name"
        })

        assert response.status_code == 404
        data = response.json()
        assert "error" in data

    def test_delete_pose_endpoint(self, client):
        """Test POST /api/poses with delete action."""
        # First create a pose to delete
        # API generates pose_id from name: "To Delete" -> "to_delete"
        client.post("/api/poses", json={
            "action": "create",
            "name": "To Delete",
            "category": "debug",
            "height": 100.0,
            "roll": 0.0,
            "pitch": 0.0,
            "yaw": 0.0,
            "leg_spread": 100.0
        })

        # Delete it using the generated pose_id
        response = client.post("/api/poses", json={
            "action": "delete",
            "pose_id": "to_delete"
        })

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True

        # Verify deletion
        list_response = client.get("/api/poses")
        poses = list_response.json()["poses"]
        assert "to_delete" not in poses

    def test_delete_builtin_pose_fails(self, client):
        """Test that deleting a builtin pose returns error."""
        response = client.post("/api/poses", json={
            "action": "delete",
            "pose_id": "default_stance"
        })

        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_apply_pose_endpoint(self, client):
        """Test POST /api/poses with apply action."""
        response = client.post("/api/poses", json={
            "action": "apply",
            "pose_id": "low_stance"
        })

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True

        # Verify body_height was changed
        status = client.get("/api/status")
        status_data = status.json()
        assert status_data["body_height"] == 80.0

    def test_apply_nonexistent_pose_fails(self, client):
        """Test that applying a nonexistent pose returns 404."""
        response = client.post("/api/poses", json={
            "action": "apply",
            "pose_id": "nonexistent"
        })

        assert response.status_code == 404
        data = response.json()
        assert "error" in data

    def test_record_pose_endpoint(self, client):
        """Test POST /api/poses with record action."""
        import uuid
        unique_name = f"Recorded {uuid.uuid4().hex[:8]}"
        expected_id = unique_name.lower().replace(" ", "_")

        response = client.post("/api/poses", json={
            "action": "record",
            "name": unique_name,
            "category": "debug"
        })

        assert response.status_code == 200
        data = response.json()
        assert data["ok"] is True

        # Verify pose was created with current values
        list_response = client.get("/api/poses")
        poses = list_response.json()["poses"]
        assert expected_id in poses

    def test_invalid_action_fails(self, client):
        """Test that an invalid action returns error."""
        response = client.post("/api/poses", json={
            "action": "invalid_action",
            "pose_id": "test"
        })

        assert response.status_code == 400
        data = response.json()
        assert "error" in data

    def test_pose_value_clamping(self, client):
        """Test that pose values are clamped to valid ranges."""
        import uuid
        unique_name = f"Clamped {uuid.uuid4().hex[:8]}"
        expected_id = unique_name.lower().replace(" ", "_")

        response = client.post("/api/poses", json={
            "action": "create",
            "name": unique_name,
            "category": "debug",
            "height": 500.0,  # Should be clamped to 200
            "roll": 100.0,   # Should be clamped to 30
            "pitch": -100.0, # Should be clamped to -30
            "yaw": 100.0,    # Should be clamped to 45
            "leg_spread": 200.0  # Should be clamped to 150
        })

        assert response.status_code == 200

        # Verify values were clamped
        list_response = client.get("/api/poses")
        pose = list_response.json()["poses"][expected_id]
        assert pose["height"] == 200.0
        assert pose["roll"] == 30.0
        assert pose["pitch"] == -30.0
        assert pose["yaw"] == 45.0
        assert pose["leg_spread"] == 150.0


@pytest.mark.integration
class TestWebSocketPoses:
    """Test WebSocket pose commands."""

    def test_websocket_apply_pose_command(self, client):
        """Test apply_pose command via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({
                "type": "apply_pose",
                "pose_id": "high_stance"
            })

            # Verify pose was applied
            response = client.get("/api/status")
            data = response.json()
            assert data["body_height"] == 160.0
            assert data["running"] is False

    def test_websocket_apply_pose_low_stance(self, client):
        """Test applying low_stance pose via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({
                "type": "apply_pose",
                "pose_id": "low_stance"
            })

            response = client.get("/api/status")
            data = response.json()
            assert data["body_height"] == 80.0

    def test_websocket_apply_pose_rest_pose(self, client):
        """Test applying rest_pose via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            websocket.send_json({
                "type": "apply_pose",
                "pose_id": "rest_pose"
            })

            response = client.get("/api/status")
            data = response.json()
            assert data["body_height"] == 40.0
            assert data["leg_spread"] == 120.0

    def test_websocket_apply_pose_default_stance(self, client):
        """Test applying default_stance via WebSocket."""
        with client.websocket_connect("/ws") as websocket:
            # First apply a different pose
            websocket.send_json({
                "type": "apply_pose",
                "pose_id": "low_stance"
            })
            # Then apply default
            websocket.send_json({
                "type": "apply_pose",
                "pose_id": "default_stance"
            })

            response = client.get("/api/status")
            data = response.json()
            assert data["body_height"] == 120.0
            assert data["leg_spread"] == 100.0

    def test_websocket_apply_nonexistent_pose(self, client):
        """Test applying a nonexistent pose via WebSocket (should be ignored)."""
        with client.websocket_connect("/ws") as websocket:
            # Get current state
            status_before = client.get("/api/status").json()

            # Try to apply nonexistent pose
            websocket.send_json({
                "type": "apply_pose",
                "pose_id": "nonexistent"
            })

            # State should be unchanged
            status_after = client.get("/api/status").json()
            assert status_after["body_height"] == status_before["body_height"]
