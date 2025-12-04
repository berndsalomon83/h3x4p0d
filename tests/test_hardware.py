"""Unit tests for hardware module (servo and sensor control)."""
import pytest
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from hexapod.hardware import MockServoController, SensorReader


@pytest.mark.unit
class TestMockServoController:
    """Test MockServoController functionality."""

    def test_initialization(self):
        """Test controller initializes correctly."""
        servo = MockServoController()
        assert servo is not None

    def test_set_servo_angle_valid(self):
        """Test setting valid servo angles."""
        servo = MockServoController()
        servo.set_servo_angle(0, 0, 45.0)
        assert servo.get_angle(0, 0) == 45.0

        servo.set_servo_angle(2, 1, 90.0)
        assert servo.get_angle(2, 1) == 90.0

    def test_set_servo_angle_clamping_upper(self):
        """Test servo angle clamping at upper bound."""
        servo = MockServoController()
        servo.set_servo_angle(0, 0, 200.0)
        assert servo.get_angle(0, 0) == 180.0

    def test_set_servo_angle_clamping_lower(self):
        """Test servo angle clamping at lower bound."""
        servo = MockServoController()
        servo.set_servo_angle(0, 0, -50.0)
        assert servo.get_angle(0, 0) == 0.0

    def test_set_servo_angle_all_legs(self):
        """Test setting angles for all 6 legs."""
        servo = MockServoController()
        for leg in range(6):
            for joint in range(3):
                angle = leg * 10 + joint * 5
                servo.set_servo_angle(leg, joint, angle)
                assert servo.get_angle(leg, joint) == angle

    def test_get_angle_default(self):
        """Test getting angle for unset servo returns None."""
        servo = MockServoController()
        angle = servo.get_angle(3, 2)
        assert angle is None  # Not set yet


@pytest.mark.unit
class TestSensorReader:
    """Test SensorReader functionality."""

    def test_initialization_mock(self):
        """Test sensor reader initializes in mock mode."""
        sensor = SensorReader(mock=True)
        assert sensor is not None

    def test_read_temperature_mock(self):
        """Test reading temperature in mock mode."""
        sensor = SensorReader(mock=True)
        temp = sensor.read_temperature_c()
        assert isinstance(temp, float)
        assert 20.0 <= temp <= 30.0

    def test_read_battery_voltage_mock(self):
        """Test reading battery voltage in mock mode."""
        sensor = SensorReader(mock=True)
        voltage = sensor.read_battery_voltage()
        assert isinstance(voltage, float)
        assert 10.0 <= voltage <= 13.0

    def test_calibration_offsets(self):
        """Test applying calibration offsets."""
        sensor = SensorReader(mock=True)

        sensor.set_calibration_offsets(temp_offset=5.0, batt_offset=1.0)

        temp = sensor.read_temperature_c()
        batt = sensor.read_battery_voltage()

        # Temperature should be around 25 + 5 = 30C
        assert 28.0 <= temp <= 32.0
        # Battery should be around 12 + 1 = 13V
        assert 12.5 <= batt <= 13.5

    def test_calibration_negative_offsets(self):
        """Test applying negative calibration offsets."""
        sensor = SensorReader(mock=True)

        sensor.set_calibration_offsets(temp_offset=-2.0)
        temp = sensor.read_temperature_c()

        # Temperature should be around 25 - 2 = 23C
        assert 21.0 <= temp <= 25.0

    def test_multiple_reads_consistency(self):
        """Test that multiple reads return consistent values."""
        sensor = SensorReader(mock=True)

        temps = [sensor.read_temperature_c() for _ in range(5)]
        batts = [sensor.read_battery_voltage() for _ in range(5)]

        # All readings should be within reasonable range
        assert all(20.0 <= t <= 30.0 for t in temps)
        assert all(10.0 <= b <= 13.0 for b in batts)

    def test_servo_angle_persistence(self):
        """Test that servo angles persist across reads."""
        servo = MockServoController()

        # Set multiple servos
        servo.set_servo_angle(0, 0, 45.0)
        servo.set_servo_angle(0, 1, 90.0)
        servo.set_servo_angle(1, 2, 135.0)

        # Verify angles persist
        assert servo.get_angle(0, 0) == 45.0
        assert servo.get_angle(0, 1) == 90.0
        assert servo.get_angle(1, 2) == 135.0

    def test_servo_angle_update(self):
        """Test updating existing servo angles."""
        servo = MockServoController()

        servo.set_servo_angle(0, 0, 45.0)
        assert servo.get_angle(0, 0) == 45.0

        # Update the same servo
        servo.set_servo_angle(0, 0, 90.0)
        assert servo.get_angle(0, 0) == 90.0

    def test_servo_boundary_values(self):
        """Test servo angles at exact boundary values."""
        servo = MockServoController()

        # Test exact boundaries
        servo.set_servo_angle(0, 0, 0.0)
        assert servo.get_angle(0, 0) == 0.0

        servo.set_servo_angle(0, 1, 180.0)
        assert servo.get_angle(0, 1) == 180.0

    def test_servo_fractional_angles(self):
        """Test servo angles with fractional values."""
        servo = MockServoController()

        servo.set_servo_angle(0, 0, 45.5)
        assert servo.get_angle(0, 0) == 45.5

        servo.set_servo_angle(1, 1, 123.456)
        assert servo.get_angle(1, 1) == pytest.approx(123.456)

    def test_servo_negative_angle_clamping(self):
        """Test that negative angles are properly clamped."""
        servo = MockServoController()

        servo.set_servo_angle(0, 0, -100.0)
        assert servo.get_angle(0, 0) == 0.0

        servo.set_servo_angle(1, 1, -0.1)
        assert servo.get_angle(1, 1) == 0.0

    def test_servo_large_angle_clamping(self):
        """Test that angles above 180 are properly clamped."""
        servo = MockServoController()

        servo.set_servo_angle(0, 0, 250.0)
        assert servo.get_angle(0, 0) == 180.0

        servo.set_servo_angle(1, 1, 180.1)
        assert servo.get_angle(1, 1) == 180.0

    def test_servo_all_joints_independently(self):
        """Test that all joints on all legs work independently."""
        servo = MockServoController()

        # Set unique angle for each joint
        for leg in range(6):
            for joint in range(3):
                angle = (leg * 30) + (joint * 10)
                servo.set_servo_angle(leg, joint, angle)

        # Verify each joint maintained its unique angle
        for leg in range(6):
            for joint in range(3):
                expected = (leg * 30) + (joint * 10)
                # Account for clamping
                expected = max(0.0, min(180.0, expected))
                assert servo.get_angle(leg, joint) == expected

    def test_sensor_calibration_zero_offsets(self):
        """Test sensor calibration with zero offsets."""
        sensor = SensorReader(mock=True)

        sensor.set_calibration_offsets(temp_offset=0.0, batt_offset=0.0)

        temp = sensor.read_temperature_c()
        batt = sensor.read_battery_voltage()

        # Should be within normal mock range
        assert 20.0 <= temp <= 30.0
        assert 10.0 <= batt <= 13.0

    def test_sensor_large_positive_offsets(self):
        """Test sensor with large positive calibration offsets."""
        sensor = SensorReader(mock=True)

        sensor.set_calibration_offsets(temp_offset=50.0, batt_offset=10.0)

        temp = sensor.read_temperature_c()
        batt = sensor.read_battery_voltage()

        # Temperature should be around 25 + 50 = 75C
        assert 70.0 <= temp <= 80.0
        # Battery should be around 12 + 10 = 22V
        assert 20.0 <= batt <= 23.0

    def test_sensor_large_negative_offsets(self):
        """Test sensor with large negative calibration offsets."""
        sensor = SensorReader(mock=True)

        sensor.set_calibration_offsets(temp_offset=-20.0, batt_offset=-8.0)

        temp = sensor.read_temperature_c()
        batt = sensor.read_battery_voltage()

        # Temperature should be around 25 - 20 = 5C
        assert 0.0 <= temp <= 10.0
        # Battery should be around 12 - 8 = 4V
        assert 2.0 <= batt <= 5.0

    def test_sensor_partial_calibration(self):
        """Test setting only temperature or battery offset."""
        sensor = SensorReader(mock=True)

        # Set only temperature offset
        sensor.set_calibration_offsets(temp_offset=10.0)
        temp = sensor.read_temperature_c()
        batt = sensor.read_battery_voltage()

        assert 33.0 <= temp <= 37.0  # ~25 + 10
        assert 10.0 <= batt <= 13.0  # Normal range

        # Set only battery offset
        sensor.set_calibration_offsets(batt_offset=2.0)
        batt2 = sensor.read_battery_voltage()
        assert 13.5 <= batt2 <= 15.0  # ~12 + 2

    def test_sensor_repeated_calibration(self):
        """Test changing calibration multiple times."""
        sensor = SensorReader(mock=True)

        sensor.set_calibration_offsets(temp_offset=5.0)
        temp1 = sensor.read_temperature_c()

        sensor.set_calibration_offsets(temp_offset=10.0)
        temp2 = sensor.read_temperature_c()

        sensor.set_calibration_offsets(temp_offset=0.0)
        temp3 = sensor.read_temperature_c()

        # Each calibration should produce different results
        assert temp2 > temp1
        assert temp3 < temp2

    def test_servo_get_unset_angle_all_joints(self):
        """Test getting angles for all unset servos returns None."""
        servo = MockServoController()

        for leg in range(6):
            for joint in range(3):
                assert servo.get_angle(leg, joint) is None

    def test_servo_partial_leg_configuration(self):
        """Test setting only some joints on a leg."""
        servo = MockServoController()

        # Set only coxa and tibia, not femur
        servo.set_servo_angle(0, 0, 45.0)
        servo.set_servo_angle(0, 2, 135.0)

        assert servo.get_angle(0, 0) == 45.0
        assert servo.get_angle(0, 1) is None
        assert servo.get_angle(0, 2) == 135.0

    def test_sensor_initialization_without_mock(self):
        """Test sensor reader can initialize in non-mock mode."""
        # This should not crash even without hardware
        sensor = SensorReader(mock=False)
        assert sensor is not None

    def test_sensor_mock_randomness(self):
        """Test that mock sensor values have some variation."""
        sensor = SensorReader(mock=True)

        temps = [sensor.read_temperature_c() for _ in range(20)]

        # Should have at least some variation (not all identical)
        unique_temps = set(temps)
        assert len(unique_temps) > 1

    @pytest.mark.slow
    def test_servo_rapid_updates(self):
        """Test rapid servo angle updates."""
        servo = MockServoController()

        for i in range(1000):
            angle = (i % 180)
            servo.set_servo_angle(0, 0, angle)

        # Final angle should be set correctly
        final_angle = (999 % 180)
        assert servo.get_angle(0, 0) == final_angle

    @pytest.mark.slow
    def test_sensor_rapid_reads(self):
        """Test rapid sensor reading."""
        sensor = SensorReader(mock=True)

        temps = []
        batts = []
        for _ in range(1000):
            temps.append(sensor.read_temperature_c())
            batts.append(sensor.read_battery_voltage())

        # All readings should be valid
        assert all(0 <= t <= 100 for t in temps)
        assert all(0 <= b <= 20 for b in batts)
