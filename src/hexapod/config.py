"""Centralized configuration for hexapod robot.

This module provides a single source of truth for all configuration values,
accessible via API, CLI, and Python code.
"""

import json
from pathlib import Path
from typing import Dict, Any, Optional


class HexapodConfig:
    """Centralized configuration manager for hexapod robot."""

    # Default configuration values
    DEFAULTS = {
        # Leg geometry (mm) - must match frontend DEFAULT_LEG_CONFIG in app.js
        "leg_coxa_length": 15.0,
        "leg_femur_length": 50.0,
        "leg_tibia_length": 55.0,

        # Body dimensions (mm)
        "body_width": 100.0,
        "body_length": 120.0,

        # Gait parameters
        "step_height": 25.0,
        "step_length": 40.0,
        "cycle_time": 1.2,
        "default_gait": "tripod",

        # Servo configuration
        "servo_min_pulse": 500,
        "servo_max_pulse": 2500,
        "servo_frequency": 50,

        # Update rates (Hz)
        "servo_update_rate": 100,
        "telemetry_rate": 20,

        # Visualization (for web UI)
        "viz_coxa_radius": 4.0,
        "viz_femur_radius": 4.0,
        "viz_tibia_radius": 3.5,
        "viz_joint_radius": 5.0,
        "viz_foot_radius": 4.0,

        # Servo calibration offsets (degrees) - 18 servos total
        # Format: servo_offset_leg{leg}_joint{joint} where leg=0-5, joint=0-2
        # These offsets compensate for mechanical variations between servos
        **{f"servo_offset_leg{leg}_joint{joint}": 0.0
           for leg in range(6) for joint in range(3)},

        # Camera view angle (degrees: 0=front, 90=right, 180=back, 270=left)
        "camera_view_angle": 0.0,

        # Live camera layout for the dashboard
        "camera_views": [
            {
                "id": "front",
                "label": "Front",
                "enabled": True,
                "position": "front",
                "source_type": "local",
                "source_url": ""
            }
        ],
    }

    def __init__(self, config_file: Optional[Path] = None):
        """Initialize configuration.

        Args:
            config_file: Path to JSON config file. If None, uses defaults.
        """
        self.config_file = config_file or Path.home() / ".hexapod" / "config.json"
        self._config = self.DEFAULTS.copy()

        # Load from file if exists
        if self.config_file.exists():
            self.load()

    def get(self, key: str, default: Any = None) -> Any:
        """Get configuration value.

        Args:
            key: Configuration key
            default: Default value if key not found

        Returns:
            Configuration value (returns default if key not found)
        """
        value = self._config.get(key)
        return value if value is not None else default

    def set(self, key: str, value: Any) -> None:
        """Set configuration value.

        Args:
            key: Configuration key
            value: Configuration value
        """
        self._config[key] = value

    def update(self, config_dict: Dict[str, Any]) -> None:
        """Update multiple configuration values.

        Args:
            config_dict: Dictionary of configuration values
        """
        self._config.update(config_dict)

    def reset_to_defaults(self) -> None:
        """Reset all configuration to default values."""
        self._config = self.DEFAULTS.copy()

    def load(self) -> None:
        """Load configuration from file."""
        if self.config_file.exists():
            with open(self.config_file, 'r') as f:
                loaded = json.load(f)
                self._config.update(loaded)

    def save(self) -> None:
        """Save configuration to file."""
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_file, 'w') as f:
            json.dump(self._config, f, indent=2)

    def to_dict(self) -> Dict[str, Any]:
        """Export configuration as dictionary.

        Returns:
            Configuration dictionary
        """
        return self._config.copy()

    def to_json(self) -> str:
        """Export configuration as JSON string.

        Returns:
            JSON string
        """
        return json.dumps(self._config, indent=2)

    def get_servo_offset(self, leg: int, joint: int) -> float:
        """Get calibration offset for a specific servo.

        Args:
            leg: Leg index (0-5)
            joint: Joint index (0=coxa, 1=femur, 2=tibia)

        Returns:
            Offset angle in degrees
        """
        key = f"servo_offset_leg{leg}_joint{joint}"
        return self.get(key, 0.0)

    def set_servo_offset(self, leg: int, joint: int, offset: float) -> None:
        """Set calibration offset for a specific servo.

        Args:
            leg: Leg index (0-5)
            joint: Joint index (0=coxa, 1=femur, 2=tibia)
            offset: Offset angle in degrees (-90 to +90)
        """
        key = f"servo_offset_leg{leg}_joint{joint}"
        # Clamp offset to reasonable range
        offset = max(-90.0, min(90.0, offset))
        self.set(key, offset)

    def apply_servo_calibration(self, leg: int, joint: int, angle: float) -> float:
        """Apply calibration offset to a servo angle.

        Args:
            leg: Leg index (0-5)
            joint: Joint index (0=coxa, 1=femur, 2=tibia)
            angle: Target angle in degrees

        Returns:
            Calibrated angle in degrees
        """
        offset = self.get_servo_offset(leg, joint)
        calibrated = angle + offset
        # Clamp to servo range
        return max(0.0, min(180.0, calibrated))


# Global configuration instance
_global_config: Optional[HexapodConfig] = None


def get_config() -> HexapodConfig:
    """Get global configuration instance.

    Returns:
        Global HexapodConfig instance
    """
    global _global_config
    if _global_config is None:
        _global_config = HexapodConfig()
    return _global_config


def set_config(config: HexapodConfig) -> None:
    """Set global configuration instance.

    Args:
        config: HexapodConfig instance
    """
    global _global_config
    _global_config = config
