"""Tests to verify IK consistency and foot positioning."""
import pytest
import math
import sys
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from hexapod.gait import InverseKinematics, GaitEngine
from hexapod.config import HexapodConfig, set_config


@pytest.fixture
def ik():
    """Create IK solver with correct leg dimensions."""
    # Reset config to defaults
    config = HexapodConfig()
    set_config(config)
    return InverseKinematics(coxa_len=15, femur_len=50, tibia_len=55)


@pytest.fixture
def gait_engine():
    """Create gait engine."""
    config = HexapodConfig()
    set_config(config)
    return GaitEngine()


def calculate_foot_position(femur_deg, tibia_deg, coxa_len=15, femur_len=50, tibia_len=55):
    """Calculate foot position from servo angles (measuring from vertical).

    Returns (x, y) in mm where x is horizontal (after coxa) and y is vertical.
    """
    # Convert servo angles to Three.js rotations (relative to 90°)
    femur_rot = math.radians(femur_deg - 90)
    tibia_rot = math.radians(tibia_deg - 90)

    # Calculate positions (angles from vertical downward)
    # After coxa: coxa_len mm out
    x_after_coxa = coxa_len

    # After femur: femur_len at angle femur_rot from vertical
    x_after_femur = x_after_coxa + femur_len * math.sin(femur_rot)
    y_after_femur = -femur_len * math.cos(femur_rot)

    # After tibia: tibia_len at angle (femur_rot + tibia_rot) from vertical
    tibia_abs = femur_rot + tibia_rot
    foot_x = x_after_femur + tibia_len * math.sin(tibia_abs)
    foot_y = y_after_femur - tibia_len * math.cos(tibia_abs)

    return foot_x, foot_y


class TestIKConsistency:
    """Test IK produces correct foot positions."""

    def test_standing_ik_reaches_ground(self, ik):
        """Test that standing IK places foot at ground level."""
        # Body at 60mm, ground at -10mm, stance width 40mm (after 15mm coxa)
        body_height = 60.0
        ground_level = -10.0
        stance_width = 40.0

        coxa, femur, tibia = ik.solve(stance_width, 0, -(body_height - ground_level))

        # Calculate actual foot position
        foot_x, foot_y = calculate_foot_position(femur, tibia)

        # Foot should be near (40mm horizontal, -70mm vertical)
        assert abs(foot_x - stance_width) < 10, f"Foot x={foot_x:.1f} should be ~{stance_width}mm"
        assert abs(foot_y - (ground_level - body_height)) < 10, f"Foot y={foot_y:.1f} should be ~{ground_level - body_height}mm"

        print(f"Standing IK: femur={femur:.1f}° tibia={tibia:.1f}° → foot=({foot_x:.1f}, {foot_y:.1f})")

    def test_walking_vs_standing_consistency(self, gait_engine):
        """Test that walking gait angles are consistent with standing."""
        # Get standing pose (from controller.calculate_standing_pose simulation)
        # This would use IK with body_height=60, stance_width=40
        standing_tibia = 180.0  # From our IK fix

        # Get walking angles at stance phase (leg should be on ground)
        walking_angles = gait_engine.joint_angles_for_time(0.75, mode="tripod")
        leg0_coxa, leg0_femur, leg0_tibia = walking_angles[0]

        # Check tibia angle difference
        tibia_diff = abs(leg0_tibia - standing_tibia)

        print(f"Standing tibia: {standing_tibia:.1f}°")
        print(f"Walking tibia (stance): {leg0_tibia:.1f}°")
        print(f"Difference: {tibia_diff:.1f}°")

        # CURRENTLY FAILS: walking uses ~75° but standing uses 180°
        # This 105° jump causes legs to fly up!
        assert tibia_diff < 30, f"Tibia angle difference {tibia_diff:.1f}° is too large (causes legs to fly!)"

    def test_walking_foot_position(self, gait_engine):
        """Test that walking stance phase places foot near ground."""
        # Get angles during stance phase (t=0.75)
        walking_angles = gait_engine.joint_angles_for_time(0.75, mode="tripod")
        leg0_coxa, leg0_femur, leg0_tibia = walking_angles[0]

        # Calculate foot position
        foot_x, foot_y = calculate_foot_position(leg0_femur, leg0_tibia)

        print(f"Walking stance: femur={leg0_femur:.1f}° tibia={leg0_tibia:.1f}° → foot=({foot_x:.1f}, {foot_y:.1f})")

        # During stance, foot should be near ground level (~-70mm below hip)
        # CURRENTLY FAILS: foot is probably way above ground
        assert foot_y < -50, f"Foot y={foot_y:.1f}mm should be below -50mm (near ground)"


class TestGroundContact:
    """Test ground contact detection."""

    def test_standing_legs_touch_ground(self, ik):
        """Test that all standing legs should be at ground level."""
        body_height = 60.0
        ground_level = -10.0

        # Test multiple stance widths
        for stance_width in [30, 40, 50]:
            coxa, femur, tibia = ik.solve(stance_width, 0, -(body_height - ground_level))
            foot_x, foot_y = calculate_foot_position(femur, tibia)

            # Foot should be near ground level
            assert abs(foot_y - (ground_level - body_height)) < 15, \
                f"At stance {stance_width}mm: foot y={foot_y:.1f} should be near ground {ground_level - body_height}mm"


if __name__ == "__main__":
    # Run tests manually for debugging
    import sys

    # Reset config
    config = HexapodConfig()
    set_config(config)

    ik = InverseKinematics(coxa_len=15, femur_len=50, tibia_len=55)
    gait_engine = GaitEngine()

    print("=" * 60)
    print("IK CONSISTENCY TESTS")
    print("=" * 60)

    # Test 1: Standing IK
    print("\n1. Standing IK Test:")
    try:
        body_height = 60.0
        ground_level = -10.0
        stance_width = 40.0

        coxa, femur, tibia = ik.solve(stance_width, 0, -(body_height - ground_level))
        foot_x, foot_y = calculate_foot_position(femur, tibia)

        print(f"   Angles: femur={femur:.1f}° tibia={tibia:.1f}°")
        print(f"   Foot: ({foot_x:.1f}, {foot_y:.1f})")
        print(f"   Target: ({stance_width:.1f}, {ground_level - body_height:.1f})")
        print(f"   Error: {abs(foot_x - stance_width):.1f}mm horizontal, {abs(foot_y - (ground_level - body_height)):.1f}mm vertical")

        if abs(foot_x - stance_width) < 10 and abs(foot_y - (ground_level - body_height)) < 10:
            print("   ✓ PASS")
        else:
            print("   ✗ FAIL")
    except Exception as e:
        print(f"   ✗ ERROR: {e}")

    # Test 2: Walking vs Standing
    print("\n2. Walking vs Standing Consistency:")
    try:
        standing_tibia = 180.0
        walking_angles = gait_engine.joint_angles_for_time(0.75, mode="tripod")
        leg0_coxa, leg0_femur, leg0_tibia = walking_angles[0]

        tibia_diff = abs(leg0_tibia - standing_tibia)

        print(f"   Standing tibia: {standing_tibia:.1f}°")
        print(f"   Walking tibia: {leg0_tibia:.1f}°")
        print(f"   Difference: {tibia_diff:.1f}°")

        if tibia_diff < 30:
            print("   ✓ PASS")
        else:
            print(f"   ✗ FAIL: {tibia_diff:.1f}° difference will cause legs to fly!")
    except Exception as e:
        print(f"   ✗ ERROR: {e}")

    # Test 3: Walking foot position
    print("\n3. Walking Foot Position:")
    try:
        walking_angles = gait_engine.joint_angles_for_time(0.75, mode="tripod")
        leg0_coxa, leg0_femur, leg0_tibia = walking_angles[0]

        foot_x, foot_y = calculate_foot_position(leg0_femur, leg0_tibia)

        print(f"   Angles: femur={leg0_femur:.1f}° tibia={leg0_tibia:.1f}°")
        print(f"   Foot: ({foot_x:.1f}, {foot_y:.1f})")

        if foot_y < -50:
            print("   ✓ PASS: Foot near ground")
        else:
            print(f"   ✗ FAIL: Foot at {foot_y:.1f}mm is way above ground!")
    except Exception as e:
        print(f"   ✗ ERROR: {e}")

    print("\n" + "=" * 60)
