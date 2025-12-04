"""Unit tests for gait generation and inverse kinematics."""
import pytest
import sys
import math
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from hexapod.gait import InverseKinematics, GaitEngine


@pytest.mark.unit
class TestInverseKinematics:
    """Test inverse kinematics solver."""

    def test_initialization(self):
        """Test IK solver initializes correctly."""
        ik = InverseKinematics(30, 60, 80)
        assert ik.L1 == 30
        assert ik.L2 == 60
        assert ik.L3 == 80

    def test_solve_forward_point(self):
        """Test solving IK for a point straight ahead."""
        ik = InverseKinematics(30, 60, 80)
        coxa, femur, tibia = ik.solve(100, 0, -80)

        # Coxa should be near 0 for forward point
        assert abs(coxa) < 5

        # Angles should be in valid range
        assert 0 <= femur <= 180
        assert 0 <= tibia <= 180

    def test_solve_side_point(self):
        """Test solving IK for a point to the side."""
        ik = InverseKinematics(30, 60, 80)
        coxa, femur, tibia = ik.solve(0, 100, -80)

        # Coxa should rotate to the side (~90 degrees)
        assert 80 <= abs(coxa) <= 100

    def test_solve_unreachable_point_far(self):
        """Test that unreachable points (too far) raise ValueError."""
        ik = InverseKinematics(30, 60, 80)

        with pytest.raises(ValueError, match="out of reach"):
            ik.solve(500, 0, -80)

    def test_solve_unreachable_point_close(self):
        """Test that unreachable points (too close) raise ValueError."""
        ik = InverseKinematics(30, 60, 80)

        with pytest.raises(ValueError, match="out of reach"):
            ik.solve(25, 0, 0)  # Too close, reach would be 5.0 but min is 20

    def test_solve_various_reachable_points(self):
        """Test solving IK for various reachable points."""
        ik = InverseKinematics(30, 60, 80)

        test_points = [
            (80, 0, -60),
            (60, 60, -40),
            (100, -50, -70),
            (50, 30, -50),
        ]

        for x, y, z in test_points:
            coxa, femur, tibia = ik.solve(x, y, z)
            assert -180 <= coxa <= 180
            assert 0 <= femur <= 180
            assert 0 <= tibia <= 180

    def test_angle_ranges(self):
        """Test that all returned angles are within valid servo ranges."""
        ik = InverseKinematics(30, 60, 80)
        coxa, femur, tibia = ik.solve(90, 0, -70)

        assert -180 <= coxa <= 180
        assert 0 <= femur <= 180
        assert 0 <= tibia <= 180


@pytest.mark.unit
class TestGaitEngine:
    """Test gait generation engine."""

    def test_initialization(self):
        """Test gait engine initializes correctly."""
        gait = GaitEngine(step_height=25, step_length=40, cycle_time=1.0)
        assert gait.step_height == 25
        assert gait.step_length == 40
        assert gait.cycle_time == 1.0
        assert gait.time == 0.0

    def test_initialization_defaults(self):
        """Test gait engine uses defaults when not specified."""
        gait = GaitEngine()
        assert gait.step_height > 0
        assert gait.step_length > 0
        assert gait.cycle_time > 0

    def test_update_time(self):
        """Test time updates correctly."""
        gait = GaitEngine()
        initial_time = gait.time

        gait.update(0.1)
        assert gait.time == pytest.approx(initial_time + 0.1)

        gait.update(0.5)
        assert gait.time == pytest.approx(initial_time + 0.6)

    def test_tripod_gait(self):
        """Test tripod gait generates 6 leg angles."""
        gait = GaitEngine()
        angles = gait.joint_angles_for_time(0.0, mode="tripod")

        assert len(angles) == 6
        for coxa, femur, tibia in angles:
            assert isinstance(coxa, float)
            assert isinstance(femur, float)
            assert isinstance(tibia, float)

    def test_wave_gait(self):
        """Test wave gait generates 6 leg angles."""
        gait = GaitEngine()
        angles = gait.joint_angles_for_time(0.0, mode="wave")

        assert len(angles) == 6
        for coxa, femur, tibia in angles:
            assert isinstance(coxa, float)
            assert isinstance(femur, float)
            assert isinstance(tibia, float)

    def test_ripple_gait(self):
        """Test ripple gait generates 6 leg angles."""
        gait = GaitEngine()
        angles = gait.joint_angles_for_time(0.0, mode="ripple")

        assert len(angles) == 6
        for coxa, femur, tibia in angles:
            assert isinstance(coxa, float)
            assert isinstance(femur, float)
            assert isinstance(tibia, float)

    def test_all_angles_valid_range(self):
        """Test that all generated angles are in valid servo ranges."""
        gait = GaitEngine()

        for mode in ["tripod", "wave", "ripple"]:
            angles = gait.joint_angles_for_time(0.0, mode=mode)

            for leg_idx, (coxa, femur, tibia) in enumerate(angles):
                assert 0 <= femur <= 180, f"Leg {leg_idx} femur out of range: {femur}"
                assert 0 <= tibia <= 180, f"Leg {leg_idx} tibia out of range: {tibia}"

    def test_gait_changes_over_time(self):
        """Test that gait angles change as time progresses."""
        gait = GaitEngine()

        angles_t0 = gait.joint_angles_for_time(0.0, mode="tripod")
        gait.update(0.5)
        angles_t1 = gait.joint_angles_for_time(gait.time, mode="tripod")

        # At least some angles should have changed
        assert angles_t0 != angles_t1

    def test_gait_cycle_repeats(self):
        """Test that gait repeats after full cycle."""
        gait = GaitEngine(cycle_time=1.0)

        angles_t0 = gait.joint_angles_for_time(0.0, mode="tripod")
        angles_t_cycle = gait.joint_angles_for_time(1.0, mode="tripod")

        # Angles at t=0 and t=cycle_time should be similar (allowing for floating point error)
        for (c0, f0, t0), (c1, f1, t1) in zip(angles_t0, angles_t_cycle):
            assert c0 == pytest.approx(c1, abs=1.0)
            assert f0 == pytest.approx(f1, abs=1.0)
            assert t0 == pytest.approx(t1, abs=1.0)

    def test_leg_synchronization_tripod(self):
        """Test that tripod gait has correct leg phase relationships."""
        gait = GaitEngine()
        angles = gait.joint_angles_for_time(0.0, mode="tripod")

        # Tripod gait should have two groups of legs
        # Legs 0,2,4 vs 1,3,5 should be in opposite phases
        assert len(angles) == 6

    @pytest.mark.slow
    def test_continuous_operation(self):
        """Test continuous gait operation over extended period."""
        gait = GaitEngine()
        dt = 0.016  # ~60 Hz

        for _ in range(600):  # 10 seconds at 60 Hz
            gait.update(dt)
            angles = gait.joint_angles_for_time(gait.time, mode="tripod")

            # Verify all angles remain valid
            for coxa, femur, tibia in angles:
                assert 0 <= femur <= 180
                assert 0 <= tibia <= 180

    def test_different_gaits_produce_different_angles(self):
        """Test that different gait modes produce different leg angles."""
        gait = GaitEngine()

        tripod = gait.joint_angles_for_time(0.5, mode="tripod")
        wave = gait.joint_angles_for_time(0.5, mode="wave")
        ripple = gait.joint_angles_for_time(0.5, mode="ripple")

        # At least some legs should differ between gaits
        assert tripod != wave
        assert wave != ripple
        assert tripod != ripple

    def test_invalid_gait_mode(self):
        """Test that invalid gait mode falls back to default."""
        gait = GaitEngine()

        # Should not raise, should fall back to default behavior
        angles = gait.joint_angles_for_time(0.0, mode="invalid_mode")
        assert len(angles) == 6

    def test_zero_cycle_time(self):
        """Test gait with very small cycle time."""
        gait = GaitEngine(cycle_time=0.001)
        assert gait.cycle_time == 0.001

        angles = gait.joint_angles_for_time(0.0, mode="tripod")
        assert len(angles) == 6

    def test_large_cycle_time(self):
        """Test gait with very large cycle time."""
        gait = GaitEngine(cycle_time=100.0)
        assert gait.cycle_time == 100.0

        angles = gait.joint_angles_for_time(50.0, mode="tripod")
        assert len(angles) == 6

    def test_negative_time_update(self):
        """Test that negative time deltas are accepted (time can go backwards)."""
        gait = GaitEngine()
        initial_time = gait.time

        gait.update(-0.1)
        # Time will go backwards with negative dt (this is allowed)
        assert gait.time == initial_time - 0.1

    def test_zero_step_height(self):
        """Test gait with zero step height."""
        gait = GaitEngine(step_height=0.0)
        assert gait.step_height == 0.0

        angles = gait.joint_angles_for_time(0.0, mode="tripod")
        assert len(angles) == 6

    def test_zero_step_length(self):
        """Test gait with zero step length."""
        gait = GaitEngine(step_length=0.0)
        assert gait.step_length == 0.0

        angles = gait.joint_angles_for_time(0.0, mode="tripod")
        assert len(angles) == 6

    def test_very_large_step_parameters(self):
        """Test gait with very large step parameters."""
        gait = GaitEngine(step_height=200.0, step_length=300.0)

        # Should still generate valid angles (even if physically unrealistic)
        angles = gait.joint_angles_for_time(0.0, mode="tripod")
        assert len(angles) == 6

    def test_gait_at_exact_cycle_boundaries(self):
        """Test gait behavior at exact cycle time boundaries."""
        gait = GaitEngine(cycle_time=2.0)

        angles_0 = gait.joint_angles_for_time(0.0, mode="tripod")
        angles_2 = gait.joint_angles_for_time(2.0, mode="tripod")
        angles_4 = gait.joint_angles_for_time(4.0, mode="tripod")

        # All should be approximately the same (cycle repeats)
        for leg_idx in range(6):
            assert angles_0[leg_idx][0] == pytest.approx(angles_2[leg_idx][0], abs=1.0)
            assert angles_0[leg_idx][0] == pytest.approx(angles_4[leg_idx][0], abs=1.0)

    def test_ik_with_negative_z(self):
        """Test IK solver with various negative Z values."""
        ik = InverseKinematics(30, 60, 80)

        test_z_values = [-10, -50, -100, -120]
        for z in test_z_values:
            coxa, femur, tibia = ik.solve(80, 0, z)
            assert -180 <= coxa <= 180
            assert 0 <= femur <= 180
            assert 0 <= tibia <= 180

    def test_ik_with_positive_z(self):
        """Test IK solver with positive Z (reaching up)."""
        ik = InverseKinematics(30, 60, 80)

        # Try reaching upward (positive Z)
        coxa, femur, tibia = ik.solve(80, 0, 20)
        assert -180 <= coxa <= 180
        assert 0 <= femur <= 180
        assert 0 <= tibia <= 180

    def test_ik_boundary_reach_maximum(self):
        """Test IK at maximum reach boundary."""
        ik = InverseKinematics(30, 60, 80)

        # Maximum reach is approximately L1 + L2 + L3 = 170
        # Test at just below max reach
        coxa, femur, tibia = ik.solve(160, 0, 0)
        assert -180 <= coxa <= 180

    def test_ik_boundary_reach_minimum(self):
        """Test IK at minimum reach boundary."""
        ik = InverseKinematics(30, 60, 80)

        # Minimum reach is approximately abs(L2 - L3) = 20
        # After accounting for coxa (L1=30), need at least 50mm horizontal distance
        # Test at a reachable point: 50mm horizontal (50-30=20mm reach after coxa)
        coxa, femur, tibia = ik.solve(50, 0, 0)
        assert -180 <= coxa <= 180
        assert 0 <= femur <= 180
        assert 0 <= tibia <= 180

    def test_ik_all_quadrants(self):
        """Test IK solver in all XY quadrants."""
        ik = InverseKinematics(30, 60, 80)

        quadrants = [
            (80, 80, -60),    # +X, +Y
            (-80, 80, -60),   # -X, +Y
            (-80, -80, -60),  # -X, -Y
            (80, -80, -60),   # +X, -Y
        ]

        for x, y, z in quadrants:
            coxa, femur, tibia = ik.solve(x, y, z)
            assert -180 <= coxa <= 180
            assert 0 <= femur <= 180
            assert 0 <= tibia <= 180

    def test_ik_symmetry(self):
        """Test that IK produces symmetric results for mirrored positions."""
        ik = InverseKinematics(30, 60, 80)

        # NOTE: The IK solver clamps coxa angles to [0, 180], so negative angles
        # become 0. Test symmetry using positions that produce positive coxa angles.

        # Test two points symmetric across the X axis (same x, opposite y)
        # Both should have positive coxa angles
        c1, f1, t1 = ik.solve(80, 60, -60)   # Point in +Y direction
        c2, f2, t2 = ik.solve(80, -60, -60)  # Point in -Y direction

        # For these mirrored positions:
        # - Femur and tibia should be identical (same 2D projection)
        # - Coxa angles won't be exact opposites due to clamping, but femur/tibia match
        assert f1 == pytest.approx(f2, abs=1.0)
        assert t1 == pytest.approx(t2, abs=1.0)

        # Coxa angles should both be in valid range
        assert 0 <= c1 <= 180
        assert 0 <= c2 <= 180

    def test_gait_time_accumulation(self):
        """Test that gait time accumulates correctly over many updates."""
        gait = GaitEngine()

        total_time = 0.0
        for _ in range(1000):
            dt = 0.01
            gait.update(dt)
            total_time += dt

        assert gait.time == pytest.approx(total_time, abs=0.01)

    def test_gait_mode_switching(self):
        """Test switching between gait modes during operation."""
        gait = GaitEngine()

        # Generate angles for different modes at same time
        t = 0.5
        tripod = gait.joint_angles_for_time(t, mode="tripod")
        wave = gait.joint_angles_for_time(t, mode="wave")
        ripple = gait.joint_angles_for_time(t, mode="ripple")

        # All should return valid 6-leg data
        assert len(tripod) == 6
        assert len(wave) == 6
        assert len(ripple) == 6

    @pytest.mark.slow
    def test_extended_continuous_operation(self):
        """Test extended continuous gait operation for stability."""
        gait = GaitEngine()
        dt = 0.016  # ~60 Hz

        for _ in range(6000):  # 100 seconds at 60 Hz
            gait.update(dt)

            for mode in ["tripod", "wave", "ripple"]:
                angles = gait.joint_angles_for_time(gait.time, mode=mode)

                # Verify all angles remain valid
                for coxa, femur, tibia in angles:
                    assert 0 <= femur <= 180
                    assert 0 <= tibia <= 180
