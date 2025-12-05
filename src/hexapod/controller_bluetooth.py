"""Bluetooth controller and joystick input handler.

Supports BLE device discovery, generic joystick input (via `inputs` library),
and a keyboard fallback for development. Emits high-level motion commands.
"""
import asyncio
from typing import Callable, Optional, List

try:
    from bleak import BleakScanner
    _HAS_BLEAK = True
except Exception:
    _HAS_BLEAK = False

try:
    import inputs
    _HAS_INPUTS = True
except Exception:
    _HAS_INPUTS = False


class MotionCommand:
    """Unified motion command issued by controller."""
    def __init__(self, cmd_type: str, **kwargs):
        self.type = cmd_type  # 'move', 'turn', 'gait', 'stop', etc.
        self.data = kwargs


class GenericController:
    """Generic joystick/gamepad input via inputs library."""
    def __init__(self):
        self._callbacks = []
        self.running = False
        self.joy_x = 0.0
        self.joy_y = 0.0
        self.buttons = {}

    def on_event(self, cb: Callable[[MotionCommand], None]):
        self._callbacks.append(cb)

    async def start(self):
        if not _HAS_INPUTS:
            print("inputs library not available; falling back to keyboard")
            await self._keyboard_loop()
            return
        self.running = True
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, self._inputs_loop)

    def _inputs_loop(self):
        """Read gamepad input in blocking loop."""
        print("🎮 GenericController: Searching for connected gamepads...")

        # Try to list available devices first
        try:
            devices = inputs.devices.gamepads
            if not devices:
                print("⚠️  No gamepads detected by inputs library!")
                print("   Make sure your controller is:")
                print("   1. Paired in System Settings → Bluetooth")
                print("   2. Connected (not just paired)")
                print("   3. Try pressing a button to wake it up")
                return
            print(f"✓ Found {len(devices)} gamepad(s):")
            for dev in devices:
                print(f"  - {dev.name}")
        except Exception as e:
            print(f"⚠️  Error listing gamepads: {e}")

        print("🎮 Waiting for controller input (move a stick or press a button)...")
        try:
            for evt in inputs.get_gamepad():
                if not self.running:
                    break
                # parse axis and button events
                if evt.ev_type == "Absolute":
                    # Axis motion
                    if evt.state == 0:
                        continue  # ignore zero events
                    # normalize joystick axes
                    axis_range = 32768
                    if evt.code in ("ABS_X", "ABS_RX"):
                        self.joy_x = evt.state / axis_range
                    elif evt.code in ("ABS_Y", "ABS_RY"):
                        self.joy_y = -evt.state / axis_range  # invert Y

                    if evt.code in ("ABS_X", "ABS_Y"):
                        self._emit(MotionCommand("move", x=self.joy_x, y=self.joy_y))

                elif evt.ev_type == "Key":
                    # Button press
                    btn = evt.code
                    pressed = evt.state == 1
                    self.buttons[btn] = pressed
                    if btn == "BTN_START" and pressed:
                        self._emit(MotionCommand("start"))
                    elif btn == "BTN_SELECT" and pressed:
                        self._emit(MotionCommand("stop"))
                    elif btn == "BTN_TL" and pressed:
                        self._emit(MotionCommand("gait", mode="wave"))
                    elif btn == "BTN_TR" and pressed:
                        self._emit(MotionCommand("gait", mode="tripod"))
        except Exception as e:
            print(f"❌ Inputs loop error: {e}")
            import traceback
            traceback.print_exc()

    async def _keyboard_loop(self):
        """Fallback: keyboard input for development."""
        print("GenericController fallback: w/a/s/d=move, space=stop, 1/2/3=gait, q=quit")
        self.running = True
        loop = asyncio.get_event_loop()
        while self.running:
            try:
                line = await loop.run_in_executor(None, input, ">")
            except Exception:
                break
            line = line.strip().lower()
            if line == "q":
                self._emit(MotionCommand("quit"))
                self.running = False
            elif line == "w":
                self._emit(MotionCommand("move", x=0, y=1.0))
            elif line == "s":
                self._emit(MotionCommand("move", x=0, y=-1.0))
            elif line == "a":
                self._emit(MotionCommand("move", x=-1.0, y=0))
            elif line == "d":
                self._emit(MotionCommand("move", x=1.0, y=0))
            elif line == " ":
                self._emit(MotionCommand("stop"))
            elif line == "1":
                self._emit(MotionCommand("gait", mode="tripod"))
            elif line == "2":
                self._emit(MotionCommand("gait", mode="wave"))
            elif line == "3":
                self._emit(MotionCommand("gait", mode="ripple"))

    def _emit(self, cmd: MotionCommand):
        for cb in self._callbacks:
            try:
                cb(cmd)
            except Exception as e:
                print(f"Callback error: {e}")

    def stop(self):
        self.running = False


class BLEDeviceScanner:
    """BLE device discovery and monitoring."""
    def __init__(self):
        self._callbacks = []
        self.devices = {}

    def on_device(self, cb: Callable[[dict], None]):
        self._callbacks.append(cb)

    async def scan(self, timeout: float = 5.0):
        if not _HAS_BLEAK:
            print("bleak not installed; BLE scan unavailable")
            return []
        try:
            devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
            device_list = []
            for address, (device, advertisement_data) in devices.items():
                device_info = {
                    "name": device.name or "Unknown",
                    "address": address,
                    "rssi": advertisement_data.rssi,
                }
                self.devices[address] = device_info
                device_list.append(device)
                self._emit(device_info)
            return device_list
        except Exception as e:
            print(f"BLE scan error: {e}")
            return []

    def _emit(self, device_info: dict):
        for cb in self._callbacks:
            try:
                cb(device_info)
            except Exception as e:
                print(f"Device callback error: {e}")


# backward-compat alias
BluetoothController = GenericController
