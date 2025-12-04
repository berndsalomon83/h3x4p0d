"""Hardware abstraction layer for servos and sensors.

Provides ServoController interface, PCA9685 driver, and sensor readers.
Supports Raspberry Pi with hardware or stub mode for development.
"""

from typing import Dict, Optional, Tuple
import time
import math
import json
import os

try:
    import pigpio
    _HAS_PIGPIO = True
except Exception:
    _HAS_PIGPIO = False

try:
    from adafruit_pca9685 import PCA9685
    from adafruit_motor import servo
    _HAS_ADAFRUIT = True
except Exception:
    _HAS_ADAFRUIT = False

class ServoController:
    """Abstract servo controller.

    Implementations should provide `set_servo_angle(leg_index, joint_index, angle_deg)`
    where joint_index 0..2 (coxa, femur, tibia) for each leg 0..5.
    """
    def set_servo_angle(self, leg_index: int, joint_index: int, angle_deg: float):
        raise NotImplementedError()

    def enable(self):
        pass

    def disable(self):
        pass

class MockServoController(ServoController):
    """Mock servo controller for development/testing without hardware."""
    def __init__(self, use_calibration: bool = True):
        self._angles: Dict[str, float] = {}
        self.use_calibration = use_calibration

    def set_servo_angle(self, leg_index: int, joint_index: int, angle_deg: float):
        key = f"leg{leg_index}_j{joint_index}"

        # Apply calibration offset if enabled
        if self.use_calibration:
            from .config import get_config
            config = get_config()
            angle_deg = config.apply_servo_calibration(leg_index, joint_index, angle_deg)

        clamped = max(0, min(180, angle_deg))  # servo range
        self._angles[key] = clamped

    def get_angle(self, leg_index: int, joint_index: int) -> Optional[float]:
        return self._angles.get(f"leg{leg_index}_j{joint_index}")

class PCA9685ServoController(ServoController):
    """PCA9685 PWM driver with I2C (16-channel servo controller).
    Requires: adafruit-pca9685, adafruit-motor.
    """
    def __init__(self, i2c=None, address: int = 0x40, freq: int = 50):
        if not _HAS_ADAFRUIT:
            raise RuntimeError("adafruit_pca9685 not installed; run: pip install adafruit-pca9685 adafruit-motor")
        try:
            import busio
            import board
            if i2c is None:
                i2c = busio.I2C(board.SCL, board.SDA)
        except Exception as e:
            print("Warning: I2C init failed:", e)
        self.pca = PCA9685(i2c, address=address)
        self.pca.frequency = freq
        self.servos = []
        # Create 16 servo instances
        for i in range(16):
            self.servos.append(servo.Servo(self.pca.channels[i]))
        self.calibration = self._load_calibration()

    def set_servo_angle(self, leg_index: int, joint_index: int, angle_deg: float):
        channel = self.calibration.get((leg_index, joint_index), None)
        if channel is None:
            raise KeyError(f"No calibration for leg {leg_index} joint {joint_index}")
        if channel >= len(self.servos):
            raise ValueError(f"Channel {channel} out of range")
        clamped = max(0, min(180, angle_deg))
        self.servos[channel].angle = clamped

    def _load_calibration(self) -> Dict[Tuple[int,int], int]:
        """Load servo channel mapping from JSON file."""
        cal_file = os.path.expanduser("~/.hexapod_calibration.json")
        if os.path.exists(cal_file):
            with open(cal_file) as f:
                data = json.load(f)
                # convert string keys back to tuples
                return {tuple(map(int, k.split(","))): v for k,v in data.items()}
        # default: legs 0-5, joints 0-2 map to channels 0-17 sequentially
        cal = {}
        for leg in range(6):
            for joint in range(3):
                cal[(leg, joint)] = leg*3 + joint
        return cal

    def save_calibration(self, cal: Dict[Tuple[int,int], int]):
        """Save calibration to JSON."""
        cal_file = os.path.expanduser("~/.hexapod_calibration.json")
        with open(cal_file, "w") as f:
            # convert tuples to string keys for JSON
            data = {f"{k[0]},{k[1]}": v for k,v in cal.items()}
            json.dump(data, f, indent=2)
        self.calibration = cal

class SensorReader:
    """Sensor abstraction for temperature and battery voltage."""
    def __init__(self, mock: bool = True):
        self.mock = mock
        self._temp_offset = 0.0
        self._battery_offset = 0.0

    def read_temperature_c(self) -> float:
        """Read temperature from DS18B20 or internal sensor."""
        if self.mock:
            import random
            return 25.0 + random.uniform(-1, 1) + self._temp_offset
        try:
            # real: read from /sys/class/thermal/thermal_zone0/temp (Raspberry Pi)
            with open("/sys/class/thermal/thermal_zone0/temp") as f:
                return int(f.read()) / 1000.0 + self._temp_offset
        except Exception:
            return 25.0

    def read_battery_voltage(self) -> float:
        """Read battery voltage from ADC (MCP3008 or similar)."""
        if self.mock:
            import random
            return 12.0 + random.uniform(-0.2, 0.2) + self._battery_offset
        try:
            # real: read ADC channel; stub assumes MCP3008 on SPI
            # Example: import Adafruit_ADS1x15; ads=Adafruit_ADS1x15.ADS1115(); ads.read_adc(0) * 4.096/32768
            return 12.0
        except Exception:
            return 12.0

    def set_calibration_offsets(self, temp_offset: float = 0.0, batt_offset: float = 0.0):
        self._temp_offset = temp_offset
        self._battery_offset = batt_offset

if __name__ == "__main__":
    s = MockServoController()
    s.set_servo_angle(0,0,45)
    s.set_servo_angle(0,1,30)
