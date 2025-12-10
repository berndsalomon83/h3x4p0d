"""Core HexapodConfig class for centralized configuration management.

This module provides the HexapodConfig class which serves as the single source
of truth for all configuration values.
"""

import copy
import json
from pathlib import Path
from typing import Dict, Any, Optional, List, Tuple

from .config_defaults import DEFAULTS


class HexapodConfig:
    """Centralized configuration manager for hexapod robot.

    This class manages all configuration values, supporting:
    - Loading/saving from JSON files
    - Per-leg geometry and servo offsets
    - Gait configurations and phase offsets
    - Pose management
    - Validation helpers for common parameters

    Attributes:
        config_file: Path to the configuration JSON file
        DEFAULTS: Class-level dictionary of default configuration values
    """

    DEFAULTS = DEFAULTS

    def __init__(self, config_file: Optional[Path] = None):
        """Initialize configuration.

        Args:
            config_file: Path to JSON config file. If None, uses defaults.
        """
        self.config_file = config_file or Path.home() / ".hexapod" / "config.json"
        # Use deepcopy to properly copy nested structures like gaits
        self._config = copy.deepcopy(self.DEFAULTS)

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
        self._config = copy.deepcopy(self.DEFAULTS)

    def load(self) -> None:
        """Load configuration from file.

        Merges file values with defaults, preserving any new default keys
        that may have been added since the file was created.
        """
        if self.config_file.exists():
            with open(self.config_file, 'r', encoding='utf-8') as f:
                loaded = json.load(f)
                # Start with defaults, then overlay with loaded values
                # This ensures new default keys are preserved
                self._config = copy.deepcopy(self.DEFAULTS)
                self._config.update(loaded)

    def save(self) -> None:
        """Save configuration to file."""
        self.config_file.parent.mkdir(parents=True, exist_ok=True)
        with open(self.config_file, 'w', encoding='utf-8') as f:
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

    # ============ Servo Calibration Methods ============

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

    # ============ Leg Geometry Methods ============

    def get_leg_attach_point(self, leg: int) -> Tuple[float, float, float, float]:
        """Get attach point for a specific leg.

        Args:
            leg: Leg index (0-5)

        Returns:
            Tuple of (x, y, z, angle) in mm and degrees
        """
        x = self.get(f"leg_{leg}_attach_x", 0.0)
        y = self.get(f"leg_{leg}_attach_y", 0.0)
        z = self.get(f"leg_{leg}_attach_z", 0.0)
        angle = self.get(f"leg_{leg}_attach_angle", 0.0)
        return (x, y, z, angle)

    def get_all_leg_attach_points(self) -> List[Tuple[float, float, float, float]]:
        """Get attach points for all legs.

        Returns:
            List of (x, y, z, angle) tuples for legs 0-5
        """
        return [self.get_leg_attach_point(leg) for leg in range(6)]

    def get_leg_geometry(self, leg: int) -> Tuple[float, float, float]:
        """Get leg segment lengths for a specific leg.

        Args:
            leg: Leg index (0-5)

        Returns:
            Tuple of (coxa_length, femur_length, tibia_length) in mm
        """
        coxa = self.get(f"leg{leg}_coxa_length", self.get("leg_coxa_length", 15.0))
        femur = self.get(f"leg{leg}_femur_length", self.get("leg_femur_length", 50.0))
        tibia = self.get(f"leg{leg}_tibia_length", self.get("leg_tibia_length", 55.0))
        return (coxa, femur, tibia)

    # ============ Gait Methods ============

    def get_gaits(self) -> Dict[str, Any]:
        """Get all gait definitions.

        Returns:
            Dictionary of gait_id -> gait configuration
        """
        return self.get("gaits", {})

    def get_enabled_gaits(self) -> Dict[str, Any]:
        """Get only enabled gait definitions.

        Returns:
            Dictionary of enabled gait_id -> gait configuration
        """
        gaits = self.get_gaits()
        return {k: v for k, v in gaits.items() if v.get("enabled", True)}

    def get_gait_phase_offsets(self, gait_id: str) -> List[float]:
        """Get phase offsets for a specific gait.

        Args:
            gait_id: Gait identifier (tripod, wave, ripple, creep)

        Returns:
            List of 6 phase offsets (0.0-1.0), or default tripod if not found
        """
        gaits = self.get_gaits()
        gait = gaits.get(gait_id, {})
        return gait.get("phase_offsets", [0.0, 0.5, 0.0, 0.5, 0.0, 0.5])

    def set_gait_enabled(self, gait_id: str, enabled: bool) -> bool:
        """Enable or disable a gait.

        Args:
            gait_id: Gait identifier
            enabled: Whether to enable the gait

        Returns:
            True if successful
        """
        gaits = self.get_gaits()
        if gait_id in gaits:
            gaits[gait_id]["enabled"] = enabled
            self.set("gaits", gaits)
            return True
        return False

    def update_gait(self, gait_id: str, updates: Dict[str, Any]) -> bool:
        """Update a gait's configuration.

        Args:
            gait_id: Gait identifier
            updates: Dictionary of fields to update

        Returns:
            True if successful
        """
        gaits = self.get_gaits()
        if gait_id in gaits:
            gaits[gait_id].update(updates)
            self.set("gaits", gaits)
            return True
        return False

    def get_gait_params(self) -> Dict[str, float]:
        """Get current gait parameters from config.

        Returns:
            Dictionary with step_height, step_length, and cycle_time
        """
        return {
            "step_height": self.get("step_height", 25.0),
            "step_length": self.get("step_length", 40.0),
            "cycle_time": self.get("cycle_time", 1.2),
        }

    # ============ Pose Methods ============

    def get_poses(self) -> Dict[str, Any]:
        """Get all saved poses.

        Returns:
            Dictionary of pose_id -> pose configuration
        """
        return self.get("poses", {})

    def get_pose(self, pose_id: str) -> Optional[Dict[str, Any]]:
        """Get a specific pose by ID.

        Args:
            pose_id: Pose identifier

        Returns:
            Pose configuration dict or None if not found
        """
        poses = self.get_poses()
        return poses.get(pose_id)

    def create_pose(self, pose_id: str, name: str, category: str,
                   height: float, roll: float, pitch: float, yaw: float,
                   leg_spread: float) -> bool:
        """Create a new pose.

        Args:
            pose_id: Unique identifier for the pose
            name: Display name
            category: Category (operation, rest, debug)
            height: Body height in mm
            roll: Roll angle in degrees
            pitch: Pitch angle in degrees
            yaw: Yaw angle in degrees
            leg_spread: Leg spread percentage

        Returns:
            True if successful
        """
        poses = self.get_poses()

        if pose_id in poses:
            return False

        poses[pose_id] = {
            "name": name,
            "category": category,
            "height": float(height),
            "roll": float(roll),
            "pitch": float(pitch),
            "yaw": float(yaw),
            "leg_spread": float(leg_spread),
            "builtin": False
        }
        self.set("poses", poses)
        return True

    def update_pose(self, pose_id: str, updates: Dict[str, Any]) -> bool:
        """Update a pose's configuration.

        Args:
            pose_id: Pose identifier
            updates: Dictionary of fields to update

        Returns:
            True if successful
        """
        poses = self.get_poses()
        if pose_id not in poses:
            return False

        # Only allow updating certain fields
        allowed = {"name", "category", "height", "roll", "pitch", "yaw", "leg_spread"}
        for key, value in updates.items():
            if key in allowed:
                poses[pose_id][key] = value

        self.set("poses", poses)
        return True

    def delete_pose(self, pose_id: str) -> bool:
        """Delete a pose.

        Args:
            pose_id: Pose identifier

        Returns:
            True if successful, False if pose not found or is builtin
        """
        poses = self.get_poses()

        if pose_id not in poses:
            return False

        if poses[pose_id].get("builtin", False):
            return False

        if len(poses) <= 1:
            return False

        del poses[pose_id]
        self.set("poses", poses)
        return True

    # ============ Validation Helpers ============

    def validate_body_height(self, value: float) -> float:
        """Validate and clamp body height to safe range.

        Args:
            value: Proposed body height in mm

        Returns:
            Clamped value within safe range (30-200mm)
        """
        return max(30.0, min(200.0, float(value)))

    def validate_leg_spread(self, value: float) -> float:
        """Validate and clamp leg spread to safe range.

        Args:
            value: Proposed leg spread percentage

        Returns:
            Clamped value within safe range (50-150%)
        """
        return max(50.0, min(150.0, float(value)))

    def validate_body_pose(self, pitch: Optional[float] = None,
                          roll: Optional[float] = None,
                          yaw: Optional[float] = None) -> Dict[str, float]:
        """Validate and clamp body pose values.

        Args:
            pitch: Forward/backward tilt in degrees
            roll: Side-to-side tilt in degrees
            yaw: Rotation around vertical axis in degrees

        Returns:
            Dictionary with clamped values
        """
        result = {}
        if pitch is not None:
            result['pitch'] = max(-30.0, min(30.0, float(pitch)))
        if roll is not None:
            result['roll'] = max(-30.0, min(30.0, float(roll)))
        if yaw is not None:
            result['yaw'] = max(-45.0, min(45.0, float(yaw)))
        return result

    def validate_step_height(self, value: float) -> float:
        """Validate and clamp step height.

        Args:
            value: Proposed step height in mm

        Returns:
            Clamped value (10-50mm)
        """
        return max(10.0, min(50.0, float(value)))

    def validate_step_length(self, value: float) -> float:
        """Validate and clamp step length.

        Args:
            value: Proposed step length in mm

        Returns:
            Clamped value (10-80mm)
        """
        return max(10.0, min(80.0, float(value)))

    def validate_cycle_time(self, value: float) -> float:
        """Validate and clamp cycle time.

        Args:
            value: Proposed cycle time in seconds

        Returns:
            Clamped value (0.5-3.0 seconds)
        """
        return max(0.5, min(3.0, float(value)))
