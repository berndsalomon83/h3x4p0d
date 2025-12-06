"""Unit tests for controller and Bluetooth input handling."""
import asyncio
import pytest
import sys
from pathlib import Path
from types import SimpleNamespace

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

import hexapod.controller_bluetooth as controller_bluetooth
from hexapod.controller_bluetooth import MotionCommand, GenericController, BLEDeviceScanner


@pytest.mark.unit
class TestMotionCommand:
    """Test MotionCommand data structure."""

    def test_initialization(self):
        """Test MotionCommand initializes correctly."""
        cmd = MotionCommand("move", x=1.0, y=0.5)

        assert cmd.type == "move"
        assert cmd.data["x"] == 1.0
        assert cmd.data["y"] == 0.5

    def test_initialization_no_kwargs(self):
        """Test MotionCommand with no additional data."""
        cmd = MotionCommand("stop")

        assert cmd.type == "stop"
        assert cmd.data == {}

    def test_initialization_multiple_kwargs(self):
        """Test MotionCommand with multiple data fields."""
        cmd = MotionCommand("gait", mode="tripod", speed=0.8)

        assert cmd.type == "gait"
        assert cmd.data["mode"] == "tripod"
        assert cmd.data["speed"] == 0.8

    def test_different_command_types(self):
        """Test creating different command types."""
        move_cmd = MotionCommand("move", x=0, y=1)
        turn_cmd = MotionCommand("turn", angle=45)
        stop_cmd = MotionCommand("stop")
        gait_cmd = MotionCommand("gait", mode="wave")

        assert move_cmd.type == "move"
        assert turn_cmd.type == "turn"
        assert stop_cmd.type == "stop"
        assert gait_cmd.type == "gait"


@pytest.mark.unit
class TestGenericController:
    """Test GenericController functionality."""

    def test_initialization(self):
        """Test controller initializes correctly."""
        controller = GenericController()

        assert controller.running is False
        assert controller.joy_x == 0.0
        assert controller.joy_y == 0.0
        assert controller.buttons == {}

    def test_on_event_registration(self):
        """Test registering event callbacks."""
        controller = GenericController()
        called = []

        def callback(cmd):
            called.append(cmd)

        controller.on_event(callback)
        assert len(controller._callbacks) == 1

    def test_multiple_callbacks(self):
        """Test registering multiple event callbacks."""
        controller = GenericController()

        def callback1(cmd):
            pass

        def callback2(cmd):
            pass

        controller.on_event(callback1)
        controller.on_event(callback2)

        assert len(controller._callbacks) == 2

    def test_emit_calls_callbacks(self):
        """Test that _emit calls registered callbacks."""
        controller = GenericController()
        received = []

        def callback(cmd):
            received.append(cmd)

        controller.on_event(callback)

        cmd = MotionCommand("test", value=42)
        controller._emit(cmd)

        assert len(received) == 1
        assert received[0].type == "test"
        assert received[0].data["value"] == 42

    def test_emit_multiple_callbacks(self):
        """Test that _emit calls all registered callbacks."""
        controller = GenericController()
        received1 = []
        received2 = []

        def callback1(cmd):
            received1.append(cmd)

        def callback2(cmd):
            received2.append(cmd)

        controller.on_event(callback1)
        controller.on_event(callback2)

        cmd = MotionCommand("test")
        controller._emit(cmd)

        assert len(received1) == 1
        assert len(received2) == 1

    def test_emit_handles_callback_exception(self):
        """Test that _emit continues after callback exception."""
        controller = GenericController()
        received = []

        def bad_callback(cmd):
            raise Exception("Test error")

        def good_callback(cmd):
            received.append(cmd)

        controller.on_event(bad_callback)
        controller.on_event(good_callback)

        cmd = MotionCommand("test")
        controller._emit(cmd)

        # Good callback should still be called
        assert len(received) == 1

    def test_stop(self):
        """Test stopping the controller."""
        controller = GenericController()
        controller.running = True

        controller.stop()

        assert controller.running is False


@pytest.mark.unit
class TestBLEDeviceScanner:
    """Test BLE device scanner functionality."""

    def test_initialization(self):
        """Test BLE scanner initializes correctly."""
        scanner = BLEDeviceScanner()

        assert scanner.devices == {}
        assert scanner._callbacks == []

    def test_on_device_registration(self):
        """Test registering device discovery callbacks."""
        scanner = BLEDeviceScanner()
        called = []

        def callback(device_info):
            called.append(device_info)

        scanner.on_device(callback)
        assert len(scanner._callbacks) == 1

    def test_emit_device_calls_callbacks(self):
        """Test that _emit calls registered callbacks with device info."""
        scanner = BLEDeviceScanner()
        received = []

        def callback(device_info):
            received.append(device_info)

        scanner.on_device(callback)

        device_info = {
            "name": "Test Device",
            "address": "00:11:22:33:44:55",
            "rssi": -50
        }
        scanner._emit(device_info)

        assert len(received) == 1
        assert received[0]["name"] == "Test Device"
        assert received[0]["address"] == "00:11:22:33:44:55"

    def test_emit_handles_callback_exception(self):
        """Test that _emit continues after callback exception."""
        scanner = BLEDeviceScanner()
        received = []

        def bad_callback(device_info):
            raise Exception("Test error")

        def good_callback(device_info):
            received.append(device_info)

        scanner.on_device(bad_callback)
        scanner.on_device(good_callback)

        device_info = {"name": "Test", "address": "00:11:22:33:44:55", "rssi": -50}
        scanner._emit(device_info)

        # Good callback should still be called
        assert len(received) == 1


@pytest.mark.asyncio
class TestGenericControllerKeyboardFallback:
    """Tests for the GenericController keyboard fallback loop."""

    async def test_keyboard_loop_emits_commands(self, monkeypatch):
        """Keyboard loop should emit move, gait, stop, and quit commands."""
        controller = GenericController()
        emitted = []

        controller.on_event(lambda cmd: emitted.append(cmd))

        commands = iter(["w", "2", " ", "q"])

        def fake_input(prompt: str = ""):
            _ = prompt
            try:
                return next(commands)
            except StopIteration:
                raise EOFError

        monkeypatch.setattr("builtins.input", fake_input)

        await controller._keyboard_loop()

        assert [cmd.type for cmd in emitted] == ["move", "gait", "stop", "quit"]
        assert emitted[0].data == {"x": 0, "y": 1.0}
        assert emitted[1].data == {"mode": "wave"}
        assert controller.running is False


@pytest.mark.asyncio
class TestBLEDeviceScannerScan:
    """Tests for BLEDeviceScanner.scan behavior when bleak is available."""

    async def test_scan_collects_and_emits_devices(self, monkeypatch):
        """Scanner should store devices and emit callbacks using Bleak results."""
        scanner = BLEDeviceScanner()
        received = []
        scanner.on_device(lambda info: received.append(info))

        async def fake_discover(timeout: float, return_adv: bool):
            _ = timeout
            _ = return_adv
            device = SimpleNamespace(name="Demo Device")
            advertisement = SimpleNamespace(rssi=-42)
            return {"AA:BB:CC:DD:EE:FF": (device, advertisement)}

        monkeypatch.setattr(controller_bluetooth, "_HAS_BLEAK", True)
        monkeypatch.setattr(controller_bluetooth, "BleakScanner", SimpleNamespace(discover=fake_discover))

        devices = await scanner.scan(timeout=0.1)

        assert len(devices) == 1
        assert scanner.devices["AA:BB:CC:DD:EE:FF"]["name"] == "Demo Device"
        assert scanner.devices["AA:BB:CC:DD:EE:FF"]["rssi"] == -42
        assert received[0]["address"] == "AA:BB:CC:DD:EE:FF"

    def test_scan_without_bleak(self):
        """Test scan gracefully handles missing bleak library."""
        scanner = BLEDeviceScanner()

        # Should not raise exception even if bleak not available

        asyncio.run(scanner.scan(timeout=0.1))


@pytest.mark.unit
class TestMotionCommandValidation:
    """Test MotionCommand validation and edge cases."""

    def test_motion_command_empty_data(self):
        """Test MotionCommand with explicitly empty data dict."""
        cmd = MotionCommand("test")
        assert cmd.data == {}

    def test_motion_command_numeric_type(self):
        """Test MotionCommand with numeric type (converted to string)."""
        cmd = MotionCommand("test123")
        assert cmd.type == "test123"

    def test_motion_command_nested_data(self):
        """Test MotionCommand with nested data structures."""
        cmd = MotionCommand("complex", data={"nested": {"value": 42}})
        assert cmd.data["data"]["nested"]["value"] == 42

    def test_motion_command_overwrite_existing_key(self):
        """Test that kwargs can include 'data' key."""
        cmd = MotionCommand("test", data={"value": 1}, extra={"value": 2})
        assert "data" in cmd.data
        assert "extra" in cmd.data

    def test_motion_command_boolean_values(self):
        """Test MotionCommand with boolean data."""
        cmd = MotionCommand("toggle", enabled=True, active=False)
        assert cmd.data["enabled"] is True
        assert cmd.data["active"] is False

    def test_motion_command_none_values(self):
        """Test MotionCommand with None values."""
        cmd = MotionCommand("clear", value=None, target=None)
        assert cmd.data["value"] is None
        assert cmd.data["target"] is None


@pytest.mark.unit
class TestGenericControllerEdgeCases:
    """Test GenericController edge cases and error handling."""

    def test_controller_emit_with_no_callbacks(self):
        """Test that _emit works with no callbacks registered."""
        controller = GenericController()
        cmd = MotionCommand("test")

        # Should not raise
        controller._emit(cmd)

    def test_controller_multiple_stops(self):
        """Test calling stop multiple times."""
        controller = GenericController()
        controller.running = True

        controller.stop()
        assert controller.running is False

        controller.stop()
        assert controller.running is False

    def test_controller_callback_order(self):
        """Test that callbacks are called in registration order."""
        controller = GenericController()
        call_order = []

        def callback1(cmd):
            call_order.append(1)

        def callback2(cmd):
            call_order.append(2)

        def callback3(cmd):
            call_order.append(3)

        controller.on_event(callback1)
        controller.on_event(callback2)
        controller.on_event(callback3)

        cmd = MotionCommand("test")
        controller._emit(cmd)

        assert call_order == [1, 2, 3]

    def test_controller_joy_state(self):
        """Test controller joystick state initialization."""
        controller = GenericController()

        assert controller.joy_x == 0.0
        assert controller.joy_y == 0.0

    def test_controller_buttons_state(self):
        """Test controller buttons state initialization."""
        controller = GenericController()

        assert controller.buttons == {}
        assert isinstance(controller.buttons, dict)

    def test_controller_emit_preserves_command(self):
        """Test that _emit doesn't modify the original command."""
        controller = GenericController()
        received = []

        def callback(cmd):
            received.append(cmd)

        controller.on_event(callback)

        cmd = MotionCommand("test", value=42)
        original_type = cmd.type
        original_data = cmd.data.copy()

        controller._emit(cmd)

        # Original command should be unchanged
        assert cmd.type == original_type
        assert cmd.data == original_data

    def test_controller_callback_with_return_value(self):
        """Test that callback return values are ignored."""
        controller = GenericController()

        def callback(cmd):
            return "some value"

        controller.on_event(callback)

        cmd = MotionCommand("test")
        # Should not raise or behave differently
        controller._emit(cmd)

    def test_controller_emit_multiple_commands(self):
        """Test emitting multiple different commands."""
        controller = GenericController()
        received = []

        def callback(cmd):
            received.append(cmd.type)

        controller.on_event(callback)

        controller._emit(MotionCommand("move"))
        controller._emit(MotionCommand("stop"))
        controller._emit(MotionCommand("gait"))

        assert received == ["move", "stop", "gait"]


@pytest.mark.unit
class TestBLEDeviceScannerEdgeCases:
    """Test BLE device scanner edge cases."""

    def test_scanner_devices_initialization(self):
        """Test scanner devices dict is properly initialized."""
        scanner = BLEDeviceScanner()
        assert scanner.devices == {}
        assert isinstance(scanner.devices, dict)

    def test_scanner_callbacks_initialization(self):
        """Test scanner callbacks list is properly initialized."""
        scanner = BLEDeviceScanner()
        assert scanner._callbacks == []
        assert isinstance(scanner._callbacks, list)

    def test_scanner_multiple_device_callbacks(self):
        """Test registering multiple device callbacks."""
        scanner = BLEDeviceScanner()

        def callback1(device_info):
            pass

        def callback2(device_info):
            pass

        scanner.on_device(callback1)
        scanner.on_device(callback2)

        assert len(scanner._callbacks) == 2

    def test_scanner_emit_with_no_callbacks(self):
        """Test that _emit works with no callbacks registered."""
        scanner = BLEDeviceScanner()

        # Should not raise
        scanner._emit({"name": "Test", "address": "00:11:22:33:44:55", "rssi": -50})

    def test_scanner_device_info_structure(self):
        """Test emitting various device info structures."""
        scanner = BLEDeviceScanner()
        received = []

        def callback(device_info):
            received.append(device_info)

        scanner.on_device(callback)

        # Emit minimal info
        scanner._emit({"address": "00:11:22:33:44:55"})

        # Emit full info
        scanner._emit({
            "name": "GameController",
            "address": "AA:BB:CC:DD:EE:FF",
            "rssi": -45,
            "manufacturer": "Acme"
        })

        assert len(received) == 2
        assert received[0]["address"] == "00:11:22:33:44:55"
        assert received[1]["name"] == "GameController"

    def test_scanner_callback_order(self):
        """Test that scanner callbacks are called in registration order."""
        scanner = BLEDeviceScanner()
        call_order = []

        def callback1(device_info):
            call_order.append(1)

        def callback2(device_info):
            call_order.append(2)

        scanner.on_device(callback1)
        scanner.on_device(callback2)

        scanner._emit({"address": "00:11:22:33:44:55"})

        assert call_order == [1, 2]

    def test_scanner_multiple_scans(self):
        """Test running scan multiple times."""
        scanner = BLEDeviceScanner()

        # Should not raise

        asyncio.run(scanner.scan(timeout=0.01))
        asyncio.run(scanner.scan(timeout=0.01))
        asyncio.run(scanner.scan(timeout=0.01))

    def test_scanner_emit_preserves_device_info(self):
        """Test that _emit doesn't modify original device info."""
        scanner = BLEDeviceScanner()
        received = []

        def callback(device_info):
            received.append(device_info)

        scanner.on_device(callback)

        original_info = {
            "name": "Test",
            "address": "00:11:22:33:44:55",
            "rssi": -50
        }
        original_copy = original_info.copy()

        scanner._emit(original_info)

        # Original should be unchanged
        assert original_info == original_copy


@pytest.mark.unit
class TestControllerIntegration:
    """Test integration between controller components."""

    def test_motion_command_and_controller_flow(self):
        """Test complete flow from motion command to controller."""
        controller = GenericController()
        received_commands = []

        def handler(cmd):
            received_commands.append((cmd.type, cmd.data))

        controller.on_event(handler)

        # Emit various commands
        controller._emit(MotionCommand("move", x=0.5, y=0.8))
        controller._emit(MotionCommand("gait", mode="wave"))
        controller._emit(MotionCommand("stop"))

        assert len(received_commands) == 3
        assert received_commands[0][0] == "move"
        assert received_commands[1][0] == "gait"
        assert received_commands[2][0] == "stop"

    def test_controller_state_persistence(self):
        """Test that controller state persists across events."""
        controller = GenericController()

        controller.joy_x = 0.5
        controller.joy_y = 0.8
        controller.buttons = {"A": True, "B": False}
        controller.running = True

        # Emit some events
        controller._emit(MotionCommand("test"))

        # State should persist
        assert controller.joy_x == 0.5
        assert controller.joy_y == 0.8
        assert controller.buttons == {"A": True, "B": False}
        assert controller.running is True
