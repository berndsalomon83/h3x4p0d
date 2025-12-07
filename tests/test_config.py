"""Unit tests for configuration management."""
import pytest
import sys
import json
import tempfile
from pathlib import Path

# Add src to path
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from hexapod.config import HexapodConfig, get_config, set_config


@pytest.mark.unit
class TestHexapodConfig:
    """Test HexapodConfig functionality."""

    def test_initialization_defaults(self):
        """Test config initializes with default values."""
        config = HexapodConfig(config_file=Path("/tmp/nonexistent.json"))

        assert config.get("leg_coxa_length") == 15.0
        assert config.get("leg_femur_length") == 50.0
        assert config.get("leg_tibia_length") == 55.0
        assert config.get("default_gait") == "tripod"

    def test_get_existing_key(self):
        """Test getting an existing configuration key."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        value = config.get("step_height")
        assert value == 25.0

    def test_get_nonexistent_key_with_default(self):
        """Test getting nonexistent key returns default."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        value = config.get("nonexistent_key", "default_value")
        assert value == "default_value"

    def test_get_nonexistent_key_without_default(self):
        """Test getting nonexistent key without default returns None."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        value = config.get("nonexistent_key")
        assert value is None

    def test_set_value(self):
        """Test setting a configuration value."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        config.set("step_height", 30.0)
        assert config.get("step_height") == 30.0

    def test_set_new_key(self):
        """Test setting a new configuration key."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        config.set("new_key", "new_value")
        assert config.get("new_key") == "new_value"

    def test_update_multiple_values(self):
        """Test updating multiple configuration values at once."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        config.update({
            "step_height": 35.0,
            "step_length": 50.0,
            "cycle_time": 1.5
        })

        assert config.get("step_height") == 35.0
        assert config.get("step_length") == 50.0
        assert config.get("cycle_time") == 1.5

    def test_reset_to_defaults(self):
        """Test resetting configuration to defaults."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        config.set("step_height", 100.0)
        assert config.get("step_height") == 100.0

        config.reset_to_defaults()
        assert config.get("step_height") == 25.0

    def test_to_dict(self):
        """Test exporting configuration as dictionary."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        config_dict = config.to_dict()
        assert isinstance(config_dict, dict)
        assert "leg_coxa_length" in config_dict
        assert "step_height" in config_dict

    def test_to_json(self):
        """Test exporting configuration as JSON string."""
        config = HexapodConfig(config_file=Path("/tmp/test.json"))

        config_json = config.to_json()
        assert isinstance(config_json, str)

        # Verify it's valid JSON
        parsed = json.loads(config_json)
        assert isinstance(parsed, dict)
        assert "leg_coxa_length" in parsed

    def test_save_and_load(self):
        """Test saving and loading configuration from file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "test_config.json"

            # Create and save config
            config1 = HexapodConfig(config_file=config_file)
            config1.set("step_height", 42.0)
            config1.set("custom_value", "test123")
            config1.save()

            # Load config in new instance
            config2 = HexapodConfig(config_file=config_file)

            assert config2.get("step_height") == 42.0
            assert config2.get("custom_value") == "test123"

    def test_load_preserves_defaults(self):
        """Test that loading config preserves unmodified defaults."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "test_config.json"

            # Save config with one changed value
            config1 = HexapodConfig(config_file=config_file)
            config1.set("step_height", 99.0)
            config1.save()

            # Load and verify defaults still present
            config2 = HexapodConfig(config_file=config_file)
            assert config2.get("step_height") == 99.0
            assert config2.get("leg_coxa_length") == 15.0  # default preserved

    def test_save_creates_directory(self):
        """Test that save creates parent directory if it doesn't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            config_file = Path(tmpdir) / "subdir" / "config.json"

            config = HexapodConfig(config_file=config_file)
            config.save()

            assert config_file.exists()
            assert config_file.parent.exists()


@pytest.mark.unit
class TestGlobalConfig:
    """Test global configuration instance management."""

    def test_get_config_creates_instance(self):
        """Test that get_config creates a global instance."""
        config = get_config()
        assert isinstance(config, HexapodConfig)

    def test_get_config_returns_same_instance(self):
        """Test that multiple calls to get_config return same instance."""
        config1 = get_config()
        config2 = get_config()
        assert config1 is config2

    def test_set_config(self):
        """Test setting the global config instance."""
        new_config = HexapodConfig(config_file=Path("/tmp/custom.json"))
        new_config.set("custom_key", "custom_value")

        set_config(new_config)

        retrieved = get_config()
        assert retrieved.get("custom_key") == "custom_value"

    def test_get_config_values(self):
        """Test accessing values through global config."""
        config = get_config()

        # Should have default values
        assert config.get("leg_coxa_length") is not None
        assert config.get("step_height") is not None


@pytest.mark.unit
class TestHexapodConfigPoses:
    """Test HexapodConfig pose management functionality."""

    def test_get_poses_returns_default_poses(self):
        """Test that get_poses returns default poses."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        poses = config.get_poses()

        assert isinstance(poses, dict)
        assert "default_stance" in poses
        assert "low_stance" in poses
        assert "high_stance" in poses
        assert "rest_pose" in poses
        assert "power_off" in poses

    def test_get_pose_existing(self):
        """Test getting an existing pose by ID."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        pose = config.get_pose("default_stance")

        assert pose is not None
        assert pose["name"] == "Default Stance"
        assert pose["height"] == 90.0
        assert pose["builtin"] is True

    def test_get_pose_nonexistent(self):
        """Test getting a nonexistent pose returns None."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        pose = config.get_pose("nonexistent_pose")

        assert pose is None

    def test_create_pose_success(self):
        """Test creating a new pose."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        result = config.create_pose(
            pose_id="test_pose",
            name="Test Pose",
            category="debug",
            height=100.0,
            roll=5.0,
            pitch=10.0,
            yaw=15.0,
            leg_spread=110.0
        )

        assert result is True
        pose = config.get_pose("test_pose")
        assert pose is not None
        assert pose["name"] == "Test Pose"
        assert pose["category"] == "debug"
        assert pose["height"] == 100.0
        assert pose["roll"] == 5.0
        assert pose["pitch"] == 10.0
        assert pose["yaw"] == 15.0
        assert pose["leg_spread"] == 110.0
        assert pose["builtin"] is False

    def test_create_pose_duplicate_fails(self):
        """Test creating a pose with existing ID fails."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        # Try to create a pose with an existing ID
        result = config.create_pose(
            pose_id="default_stance",
            name="Duplicate",
            category="operation",
            height=100.0,
            roll=0.0,
            pitch=0.0,
            yaw=0.0,
            leg_spread=100.0
        )

        assert result is False

    def test_update_pose_success(self):
        """Test updating an existing pose."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        # Create a pose first
        config.create_pose(
            pose_id="update_test",
            name="Original Name",
            category="operation",
            height=100.0,
            roll=0.0,
            pitch=0.0,
            yaw=0.0,
            leg_spread=100.0
        )

        # Update the pose
        result = config.update_pose("update_test", {
            "name": "Updated Name",
            "height": 150.0,
            "roll": 10.0
        })

        assert result is True
        pose = config.get_pose("update_test")
        assert pose["name"] == "Updated Name"
        assert pose["height"] == 150.0
        assert pose["roll"] == 10.0
        # Unchanged fields should remain
        assert pose["pitch"] == 0.0

    def test_update_pose_nonexistent_fails(self):
        """Test updating a nonexistent pose fails."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        result = config.update_pose("nonexistent", {"name": "New Name"})

        assert result is False

    def test_update_pose_ignores_disallowed_fields(self):
        """Test that update_pose ignores disallowed fields like builtin."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        # Create a pose
        config.create_pose(
            pose_id="protected_test",
            name="Protected",
            category="operation",
            height=100.0,
            roll=0.0,
            pitch=0.0,
            yaw=0.0,
            leg_spread=100.0
        )

        # Try to update builtin field (should be ignored)
        config.update_pose("protected_test", {"builtin": True})

        pose = config.get_pose("protected_test")
        assert pose["builtin"] is False

    def test_delete_pose_success(self):
        """Test deleting a non-builtin pose."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        # Create a pose to delete
        config.create_pose(
            pose_id="to_delete",
            name="To Delete",
            category="debug",
            height=100.0,
            roll=0.0,
            pitch=0.0,
            yaw=0.0,
            leg_spread=100.0
        )

        result = config.delete_pose("to_delete")

        assert result is True
        assert config.get_pose("to_delete") is None

    def test_delete_pose_builtin_fails(self):
        """Test that deleting a builtin pose fails."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        result = config.delete_pose("default_stance")

        assert result is False
        # Pose should still exist
        assert config.get_pose("default_stance") is not None

    def test_delete_pose_nonexistent_fails(self):
        """Test that deleting a nonexistent pose fails."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        result = config.delete_pose("nonexistent")

        assert result is False

    def test_delete_pose_last_remaining_fails(self):
        """Test that deleting the last remaining pose fails."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))

        # Delete all non-builtin poses
        poses = config.get_poses()
        for pose_id, pose in list(poses.items()):
            if not pose.get("builtin", False):
                config.delete_pose(pose_id)

        # Now only default_stance (builtin) should remain
        # Try to delete it - should fail because it's builtin AND last
        result = config.delete_pose("default_stance")
        assert result is False

        # Verify at least one pose remains
        assert len(config.get_poses()) >= 1

    def test_pose_values_are_floats(self):
        """Test that pose values are stored as floats."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))
        config.create_pose(
            pose_id="float_test",
            name="Float Test",
            category="operation",
            height=100,  # int
            roll=5,  # int
            pitch=10,  # int
            yaw=15,  # int
            leg_spread=110  # int
        )

        pose = config.get_pose("float_test")
        assert isinstance(pose["height"], float)
        assert isinstance(pose["roll"], float)
        assert isinstance(pose["pitch"], float)
        assert isinstance(pose["yaw"], float)
        assert isinstance(pose["leg_spread"], float)

    def test_pose_default_values(self):
        """Test default pose values are correct."""
        config = HexapodConfig(config_file=Path("/tmp/test_poses.json"))

        # Check default_stance
        default = config.get_pose("default_stance")
        assert default["height"] == 90.0
        assert default["roll"] == 0.0
        assert default["pitch"] == 0.0
        assert default["yaw"] == 0.0
        assert default["leg_spread"] == 110.0

        # Check low_stance
        low = config.get_pose("low_stance")
        assert low["height"] == 70.0

        # Check high_stance
        high = config.get_pose("high_stance")
        assert high["height"] == 120.0

        # Check rest_pose
        rest = config.get_pose("rest_pose")
        assert rest["height"] == 50.0
        assert rest["leg_spread"] == 130.0

        # Check power_off
        power_off = config.get_pose("power_off")
        assert power_off["height"] == 40.0
