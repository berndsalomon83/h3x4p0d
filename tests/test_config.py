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

        assert config.get("leg_coxa_length") == 30.0
        assert config.get("leg_femur_length") == 60.0
        assert config.get("leg_tibia_length") == 80.0
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
            assert config2.get("leg_coxa_length") == 30.0  # default preserved

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
