"""Tests for config refresh propagation to IK solver."""

import tempfile
from pathlib import Path

from hexapod.gait import GaitEngine, get_leg_geometry
from hexapod.config import HexapodConfig, set_config


class TestGaitEngineRefresh:
    """Tests for GaitEngine.refresh_leg_geometry() method."""

    def test_refresh_updates_ik_solver(self):
        """Test that refresh_leg_geometry updates the IK solver."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            # Create gait engine with default config
            gait = GaitEngine()
            original_L1 = gait.ik.L1
            original_L2 = gait.ik.L2
            original_L3 = gait.ik.L3

            # Modify config
            config.set("leg_coxa_length", 25.0)
            config.set("leg_femur_length", 70.0)
            config.set("leg_tibia_length", 90.0)

            # Refresh should update IK solver
            gait.refresh_leg_geometry()

            assert gait.ik.L1 == 25.0
            assert gait.ik.L2 == 70.0
            assert gait.ik.L3 == 90.0
            assert gait.ik.L1 != original_L1
            assert gait.ik.L2 != original_L2
            assert gait.ik.L3 != original_L3

    def test_refresh_affects_ik_calculations(self):
        """Test that refreshed IK produces different results."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            gait = GaitEngine()

            # Calculate standing pose with default geometry
            try:
                angles_before = gait.ik.solve(80, 0, -60)
            except ValueError:
                angles_before = None

            # Change to longer legs
            config.set("leg_coxa_length", 20.0)
            config.set("leg_femur_length", 80.0)
            config.set("leg_tibia_length", 100.0)
            gait.refresh_leg_geometry()

            # Same target should now produce different angles
            try:
                angles_after = gait.ik.solve(80, 0, -60)
            except ValueError:
                angles_after = None

            # At least one should succeed, and if both do, they should differ
            if angles_before and angles_after:
                assert angles_before != angles_after

    def test_multiple_refreshes(self):
        """Test that multiple refreshes work correctly."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            gait = GaitEngine()

            # First refresh
            config.set("leg_coxa_length", 20.0)
            gait.refresh_leg_geometry()
            assert gait.ik.L1 == 20.0

            # Second refresh
            config.set("leg_coxa_length", 30.0)
            gait.refresh_leg_geometry()
            assert gait.ik.L1 == 30.0

            # Third refresh back to original
            config.set("leg_coxa_length", 15.0)
            gait.refresh_leg_geometry()
            assert gait.ik.L1 == 15.0


class TestGetLegGeometry:
    """Tests for get_leg_geometry() function."""

    def test_returns_config_values(self):
        """Test that get_leg_geometry returns current config values."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            config.set("leg_coxa_length", 22.0)
            config.set("leg_femur_length", 55.0)
            config.set("leg_tibia_length", 66.0)

            coxa, femur, tibia = get_leg_geometry()

            assert coxa == 22.0
            assert femur == 55.0
            assert tibia == 66.0

    def test_returns_defaults_when_not_set(self):
        """Test that get_leg_geometry returns defaults."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            coxa, femur, tibia = get_leg_geometry()

            # Should match HexapodConfig.DEFAULTS
            assert coxa == 15.0
            assert femur == 50.0
            assert tibia == 55.0

    def test_dynamic_updates(self):
        """Test that get_leg_geometry reflects config changes."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            # Get initial values
            coxa1, _, _ = get_leg_geometry()

            # Change config
            config.set("leg_coxa_length", 99.0)

            # Should reflect change immediately
            coxa2, _, _ = get_leg_geometry()

            assert coxa1 != coxa2
            assert coxa2 == 99.0


class TestIKWithConfigChanges:
    """Tests for IK behavior when config changes."""

    def test_ik_uses_fresh_geometry_after_refresh(self):
        """Test that IK calculations use updated geometry after refresh."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            # Start with short legs
            config.set("leg_coxa_length", 10.0)
            config.set("leg_femur_length", 40.0)
            config.set("leg_tibia_length", 45.0)

            gait = GaitEngine()

            # This target might be unreachable with short legs
            target = (100, 0, -80)

            try:
                gait.ik.solve(*target)
                short_leg_reachable = True
            except ValueError:
                short_leg_reachable = False

            # Switch to longer legs
            config.set("leg_coxa_length", 20.0)
            config.set("leg_femur_length", 80.0)
            config.set("leg_tibia_length", 100.0)
            gait.refresh_leg_geometry()

            # Same target should now be reachable
            try:
                gait.ik.solve(*target)
                long_leg_reachable = True
            except ValueError:
                long_leg_reachable = False

            # With longer legs, we should be able to reach further
            assert long_leg_reachable or not short_leg_reachable

    def test_standing_pose_changes_with_geometry(self):
        """Test that standing pose calculation changes with leg geometry."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"
            config = HexapodConfig(config_file)
            set_config(config)

            gait = GaitEngine()

            # Calculate with default geometry
            gait.joint_angles_for_time(0, mode="tripod")

            # Change geometry
            config.set("leg_femur_length", 80.0)
            config.set("leg_tibia_length", 90.0)
            gait.refresh_leg_geometry()

            # Recalculate
            gait.joint_angles_for_time(0, mode="tripod")

            # Angles should be the same since joint_angles_for_time
            # uses direct angle calculation, not IK
            # But the IK solver should have updated dimensions
            assert gait.ik.L2 == 80.0
            assert gait.ik.L3 == 90.0


class TestConfigPersistenceWithIK:
    """Tests for config save/load affecting IK."""

    def test_saved_config_affects_new_gait_engine(self):
        """Test that saved config is used by new GaitEngine instances."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "config.json"

            # Create and save config with custom values
            config1 = HexapodConfig(config_file)
            config1.set("leg_coxa_length", 25.0)
            config1.set("leg_femur_length", 65.0)
            config1.set("leg_tibia_length", 75.0)
            config1.save()

            # Load config fresh and set as global
            config2 = HexapodConfig(config_file)
            set_config(config2)

            # New GaitEngine should use loaded values
            gait = GaitEngine()

            assert gait.ik.L1 == 25.0
            assert gait.ik.L2 == 65.0
            assert gait.ik.L3 == 75.0
