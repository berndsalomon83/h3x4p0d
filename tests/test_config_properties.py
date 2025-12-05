"""Property-based and edge-case tests for hexapod configuration logic."""

import json

import pytest

_hypothesis = pytest.importorskip("hypothesis")
from hypothesis import given, settings, HealthCheck, strategies as st

_ = _hypothesis

# Suppress health check for function-scoped fixtures with Hypothesis
fixture_settings = settings(suppress_health_check=[HealthCheck.function_scoped_fixture])

from hexapod.config import HexapodConfig, get_config, set_config
from hexapod.hardware import MockServoController


def _clamp(value: float, lower: float, upper: float) -> float:
    """Utility clamp used in property expectations."""

    return max(lower, min(upper, value))


@pytest.mark.unit
@fixture_settings
@given(
    offset=st.floats(min_value=-500, max_value=500, allow_nan=False, allow_infinity=False),
    leg=st.integers(min_value=0, max_value=5),
    joint=st.integers(min_value=0, max_value=2),
)
def test_set_servo_offset_clamps_and_persists(offset: float, leg: int, joint: int, hexapod_config: HexapodConfig):
    """Servo offsets are clamped to [-90, 90] and stored per leg/joint."""

    hexapod_config.set_servo_offset(leg, joint, offset)
    expected = _clamp(offset, -90.0, 90.0)

    assert hexapod_config.get_servo_offset(leg, joint) == pytest.approx(expected)


@pytest.mark.unit
@fixture_settings
@given(
    angle=st.floats(min_value=-360, max_value=360, allow_nan=False, allow_infinity=False),
    offset=st.floats(min_value=-500, max_value=500, allow_nan=False, allow_infinity=False),
    leg=st.integers(min_value=0, max_value=5),
    joint=st.integers(min_value=0, max_value=2),
)
def test_apply_servo_calibration_bounds(
    angle: float, offset: float, leg: int, joint: int, hexapod_config: HexapodConfig
):
    """Calibrated servo angles honor both offset clamping and servo angle bounds."""

    hexapod_config.set_servo_offset(leg, joint, offset)
    applied = hexapod_config.apply_servo_calibration(leg, joint, angle)

    expected_offset = _clamp(offset, -90.0, 90.0)
    expected_angle = _clamp(angle + expected_offset, 0.0, 180.0)

    assert applied == pytest.approx(expected_angle)


@pytest.mark.unit
@fixture_settings
@given(
    servo_angle=st.floats(min_value=-720, max_value=720, allow_nan=False, allow_infinity=False),
    offset=st.floats(min_value=-300, max_value=300, allow_nan=False, allow_infinity=False),
    leg=st.integers(min_value=0, max_value=5),
    joint=st.integers(min_value=0, max_value=2),
)
def test_mock_servo_controller_respects_calibration(
    servo_angle: float, offset: float, leg: int, joint: int, hexapod_config: HexapodConfig
):
    """Mock servo controller should apply calibration and clamp resulting angle."""

    previous_config = get_config()
    try:
        # Direct the controller to use an isolated config instance
        set_config(hexapod_config)
        hexapod_config.set_servo_offset(leg, joint, offset)

        controller = MockServoController(use_calibration=True)
        controller.set_servo_angle(leg, joint, servo_angle)

        expected_offset = _clamp(offset, -90.0, 90.0)
        expected_angle = _clamp(servo_angle + expected_offset, 0.0, 180.0)
        assert controller.get_angle(leg, joint) == pytest.approx(expected_angle)
    finally:
        set_config(previous_config)


@pytest.mark.unit
@fixture_settings
@given(
    step_height=st.floats(min_value=0.0, max_value=200.0, allow_nan=False, allow_infinity=False),
    step_length=st.floats(min_value=0.0, max_value=500.0, allow_nan=False, allow_infinity=False),
    cycle_time=st.floats(min_value=0.1, max_value=10.0, allow_nan=False, allow_infinity=False),
)
def test_to_json_round_trip_preserves_updates(
    step_height: float, step_length: float, cycle_time: float, hexapod_config: HexapodConfig
):
    """Exported JSON should round-trip back to the same configuration values."""

    hexapod_config.update(
        {
            "step_height": step_height,
            "step_length": step_length,
            "cycle_time": cycle_time,
        }
    )

    serialized = hexapod_config.to_json()
    round_tripped = json.loads(serialized)

    assert round_tripped["step_height"] == pytest.approx(step_height)
    assert round_tripped["step_length"] == pytest.approx(step_length)
    assert round_tripped["cycle_time"] == pytest.approx(cycle_time)

