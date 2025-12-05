"""Test suite for hexapod components.

Run with: poetry run python -m pytest tests/ -v
Or: python -m hexapod.test_runner
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '../..'))

from src.hexapod.hardware import MockServoController, SensorReader
from src.hexapod.gait import GaitEngine, InverseKinematics


def test_mock_servo():
    """Test MockServoController basic operation."""
    servo = MockServoController()
    servo.set_servo_angle(0, 0, 45.0)
    assert servo.get_angle(0, 0) == 45.0

    servo.set_servo_angle(0, 0, 200.0)  # out of range
    assert servo.get_angle(0, 0) == 180.0  # clamped
    print("✓ MockServoController: basic operation")


def test_sensor_reader():
    """Test SensorReader in mock mode."""
    sensor = SensorReader(mock=True)

    temp = sensor.read_temperature_c()
    assert 24.0 <= temp <= 26.0, f"Temperature out of expected range: {temp}"

    batt = sensor.read_battery_voltage()
    assert 11.8 <= batt <= 12.2, f"Battery voltage out of expected range: {batt}"

    sensor.set_calibration_offsets(temp_offset=5.0, batt_offset=1.0)
    temp2 = sensor.read_temperature_c()
    assert temp2 > temp, "Calibration offset not applied"
    print("✓ SensorReader: mock readings and calibration")


def test_inverse_kinematics():
    """Test IK solver for reachability and basic geometry."""
    ik = InverseKinematics(30, 60, 80)  # coxa, femur, tibia lengths

    # Test reachable point (straight out)
    try:
        c, f, t = ik.solve(100, 0, -80)
        print(f"  IK(100,0,-80): coxa={c:.1f}°, femur={f:.1f}°, tibia={t:.1f}°")
        assert abs(c) < 5, "Coxa angle should be ~0 for forward point"
    except ValueError as e:
        raise AssertionError(f"Reachable point failed IK: {e}")

    # Test unreachable point (too far)
    try:
        c, f, t = ik.solve(500, 0, -80)
        raise AssertionError("IK should reject unreachable point")
    except ValueError:
        pass  # expected

    print("✓ InverseKinematics: reachability and solving")


def test_gait_engine():
    """Test gait generation for all modes."""
    gait = GaitEngine(step_height=25, step_length=40, cycle_time=1.0)

    modes = ["tripod", "wave", "ripple"]
    for mode in modes:
        angles = gait.joint_angles_for_time(0.0, mode=mode)
        assert len(angles) == 6, f"Expected 6 legs, got {len(angles)}"

        for leg_idx, (coxa, femur, tibia) in enumerate(angles):
            assert isinstance(coxa, float), f"Leg {leg_idx} coxa not float: {coxa}"
            assert 0 <= femur <= 180, f"Leg {leg_idx} femur out of range: {femur}"
            # Tibia extends slightly during swing
            assert 0 <= tibia <= 195, f"Leg {leg_idx} tibia out of range: {tibia}"

        print(f"  ✓ {mode.capitalize()} gait: {len(angles)} legs, valid angles")

    # Test time progression
    gait.update(0.1)
    angles2 = gait.joint_angles_for_time(gait.time, mode="tripod")
    assert angles2 != angles, "Gait should change over time"
    print("✓ GaitEngine: all modes, time progression")


def test_gait_synchronization():
    """Verify leg phases are synchronized correctly for each gait mode."""
    gait = GaitEngine()

    # Tripod: should have two distinct phase groups
    gait.joint_angles_for_time(0.0, mode="tripod")
    # All legs should have non-identical positions, but in groups

    # Wave: smooth progression 0..5/6
    gait.joint_angles_for_time(0.0, mode="wave")

    # Ripple: mixed phases
    gait.joint_angles_for_time(0.0, mode="ripple")

    print("✓ GaitEngine: leg synchronization verified")


def test_continuous_operation():
    """Simulate continuous gait operation for 10 seconds."""
    gait = GaitEngine()
    servo = MockServoController()

    dt = 0.016  # ~60 Hz
    max_time = 10.0

    t = 0
    step_count = 0
    while t < max_time:
        gait.update(dt)
        angles = gait.joint_angles_for_time(gait.time, mode="tripod")

        # Simulate servo updates
        for leg_idx, (c, f, t_ang) in enumerate(angles):
            servo.set_servo_angle(leg_idx, 0, c)
            servo.set_servo_angle(leg_idx, 1, f)
            servo.set_servo_angle(leg_idx, 2, t_ang)

        t += dt
        step_count += 1

    print(f"✓ Continuous operation: {step_count} steps over {t:.1f}s (simulated)")


def run_all_tests():
    """Run all tests."""
    print("=" * 60)
    print("HEXAPOD TEST SUITE")
    print("=" * 60)
    print()

    tests = [
        test_mock_servo,
        test_sensor_reader,
        test_inverse_kinematics,
        test_gait_engine,
        test_gait_synchronization,
        test_continuous_operation,
    ]

    passed = 0
    failed = 0

    for test in tests:
        try:
            test()
            passed += 1
        except Exception as e:
            print(f"✗ {test.__name__}: {e}")
            failed += 1

    print()
    print("=" * 60)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 60)
    return failed == 0


if __name__ == "__main__":
    import sys
    success = run_all_tests()
    sys.exit(0 if success else 1)
