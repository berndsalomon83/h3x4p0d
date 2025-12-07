"""Centralized configuration for hexapod robot.

This module provides a single source of truth for all configuration values,
accessible via API, CLI, and Python code.

Profile System:
    - Profiles are stored in ~/.hexapod/profiles/ directory
    - Each profile is a separate JSON file (e.g., default.json, outdoor_rough.json)
    - Profile metadata (descriptions, default profile) stored in ~/.hexapod/profiles.json
    - The active profile is tracked and can be switched at runtime
"""

import copy
import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List


class HexapodConfig:
    """Centralized configuration manager for hexapod robot."""

    # Default configuration values
    DEFAULTS = {
        # Default leg geometry (mm) - used as fallback for per-leg config
        "leg_coxa_length": 15.0,
        "leg_femur_length": 50.0,
        "leg_tibia_length": 55.0,

        # Per-leg geometry (mm) - allows individual leg customization
        # Format: leg{N}_coxa_length, leg{N}_femur_length, leg{N}_tibia_length
        **{f"leg{leg}_coxa_length": 15.0 for leg in range(6)},
        **{f"leg{leg}_femur_length": 50.0 for leg in range(6)},
        **{f"leg{leg}_tibia_length": 55.0 for leg in range(6)},

        # Body dimensions (mm)
        "body_width": 250.0,
        "body_length": 300.0,
        "body_height_geo": 50.0,  # Body thickness (not standing height)

        # Per-leg attach points (mm and degrees)
        # X = forward/back, Y = left/right, Z = up/down, angle = leg pointing direction
        # Leg 0: Front-Right (FR)
        "leg_0_attach_x": 150.0,
        "leg_0_attach_y": 120.0,
        "leg_0_attach_z": 0.0,
        "leg_0_attach_angle": 45.0,
        # Leg 1: Mid-Right (MR)
        "leg_1_attach_x": 0.0,
        "leg_1_attach_y": 150.0,
        "leg_1_attach_z": 0.0,
        "leg_1_attach_angle": 90.0,
        # Leg 2: Rear-Right (RR)
        "leg_2_attach_x": -150.0,
        "leg_2_attach_y": 120.0,
        "leg_2_attach_z": 0.0,
        "leg_2_attach_angle": 135.0,
        # Leg 3: Rear-Left (RL)
        "leg_3_attach_x": -150.0,
        "leg_3_attach_y": -120.0,
        "leg_3_attach_z": 0.0,
        "leg_3_attach_angle": 225.0,
        # Leg 4: Mid-Left (ML)
        "leg_4_attach_x": 0.0,
        "leg_4_attach_y": -150.0,
        "leg_4_attach_z": 0.0,
        "leg_4_attach_angle": 270.0,
        # Leg 5: Front-Left (FL)
        "leg_5_attach_x": 150.0,
        "leg_5_attach_y": -120.0,
        "leg_5_attach_z": 0.0,
        "leg_5_attach_angle": 315.0,

        # Gait parameters
        "step_height": 25.0,
        "step_length": 40.0,
        "cycle_time": 1.2,
        "default_gait": "tripod",
        "gait_duty_factor": 65.0,  # percentage (40-80%)

        # Turn behavior
        "turn_mode": "in-place",  # in-place, arc, differential
        "max_yaw_rate": 60.0,     # degrees per second

        # Motion smoothing / acceleration limits
        "max_linear_accel": 0.5,     # m/s²
        "max_angular_accel": 90.0,   # deg/s²
        "input_smoothing_enabled": True,
        "input_smoothing_factor": 0.15,  # 0.05-0.5

        # Default posture
        "body_height": 90.0,      # standing height in mm (comfortable hexapod crouch)
        "leg_spread": 110.0,      # percentage (50-150%)
        "keep_body_level": False,  # auto-compensate using IMU

        # Gait definitions - each gait has phase offsets for legs 0-5
        # Phase offsets determine when each leg lifts relative to the cycle
        "gaits": {
            "tripod": {
                "name": "Tripod",
                "description": "Fast, stable gait with alternating groups of 3 legs",
                "enabled": True,
                "speed_range": "Medium - Fast",
                "stability": "Medium",
                "best_for": "Flat terrain, speed",
                "phase_offsets": [0.0, 0.5, 0.0, 0.5, 0.0, 0.5]  # legs 0,2,4 vs 1,3,5
            },
            "wave": {
                "name": "Wave",
                "description": "Smooth, elegant sequential leg movement",
                "enabled": True,
                "speed_range": "Slow",
                "stability": "High",
                "best_for": "Rough terrain, stability",
                "phase_offsets": [0.0, 0.167, 0.333, 0.5, 0.667, 0.833]  # sequential
            },
            "ripple": {
                "name": "Ripple",
                "description": "Balanced offset pattern between legs",
                "enabled": True,
                "speed_range": "Medium",
                "stability": "High",
                "best_for": "General purpose",
                "phase_offsets": [0.0, 0.25, 0.5, 0.75, 0.1, 0.6]
            },
            "creep": {
                "name": "Creep",
                "description": "Very slow, maximum stability gait",
                "enabled": True,
                "speed_range": "Very Slow",
                "stability": "Very High",
                "best_for": "Precision, obstacles",
                "phase_offsets": [0.0, 0.167, 0.333, 0.5, 0.667, 0.833]  # similar to wave
            }
        },

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
                "source_url": "",
                "hardware_camera_id": "",
                "display_mode": "pane"
            }
        ],

        # Hardware cameras (detected or manually configured)
        "hardware_cameras": [],

        # Safety limits
        "safety_max_translation_speed": 0.3,  # m/s
        "safety_max_rotation_speed": 60.0,    # deg/s
        "safety_max_joint_speed": 300.0,      # deg/s
        "safety_temperature_limit": 70.0,      # °C
        "safety_max_body_tilt_stop": 30.0,     # degrees (auto-stop threshold)
        "safety_max_body_tilt_correct": 15.0,  # degrees (auto-correct threshold)
        "safety_max_step_height": 50.0,        # mm
        "safety_min_ground_clearance": 30.0,   # mm
        "safety_low_battery_threshold": 9.5,   # V

        # E-Stop configuration
        "estop_action": "disable_torque",  # disable_torque, hold_pose, safe_collapse, cut_power
        "estop_on_comm_loss": True,
        "estop_comm_loss_timeout": 500,    # ms
        "estop_on_servo_error": True,
        "estop_on_tilt_exceeded": True,
        "estop_on_low_battery": True,

        # Fault recovery
        "fault_recovery_action": "stay_stopped",  # stay_stopped, return_safe, auto_resume

        # System settings
        "system_hostname": "hexapod-01",
        "system_web_port": 8000,
        "system_require_auth": False,
        "system_api_token": "",
        "system_timezone": "UTC",
        "system_ntp_servers": "pool.ntp.org, time.google.com",

        # Logging levels (ERROR, WARN, INFO, DEBUG)
        "log_level_kinematics": "INFO",
        "log_level_servo": "DEBUG",
        "log_level_sensors": "INFO",
        "log_level_gait": "INFO",
        "log_level_network": "WARN",

        # IMU configuration
        "imu_device": "MPU6050",        # MPU6050, BNO055, ICM20948
        "imu_filter_type": "complementary",  # complementary, ekf, madgwick
        "imu_sample_rate": 100,         # Hz
        "imu_roll_offset": 0.0,         # degrees
        "imu_pitch_offset": 0.0,        # degrees
        "imu_yaw_offset": 0.0,          # degrees

        # Foot contact sensor settings
        "foot_sensor_enabled": True,
        "foot_sensor_type": "current",  # current, force, switch
        "foot_sensor_threshold": 150,   # mA for current type

        # Control mode settings
        "control_mode": "keyboard",     # keyboard, gamepad, autonomous, scripted
        "control_default_mode": "keyboard",

        # Gamepad input settings
        "gamepad_deadzone": 10,         # percent (0-30)
        "gamepad_expo_curve": 1.5,      # exponential curve (1.0-3.0)
        "gamepad_left_x_action": "strafe",    # strafe, yaw, disabled
        "gamepad_left_y_action": "forward",   # forward, pitch, disabled
        "gamepad_right_x_action": "yaw",      # strafe, yaw, disabled
        "gamepad_right_y_action": "height",   # height, pitch, disabled
        "gamepad_a_action": "toggle_gait",    # toggle_gait, start_stop, disabled
        "gamepad_b_action": "crouch",         # crouch, estop, disabled
        "gamepad_x_action": "camera",         # camera, toggle_gait, disabled
        "gamepad_y_action": "pose",           # pose, record, disabled

        # Saved poses for quick recall
        # Each pose stores body posture parameters
        "poses": {
            "default_stance": {
                "name": "Default Stance",
                "category": "operation",
                "height": 90.0,
                "roll": 0.0,
                "pitch": 0.0,
                "yaw": 0.0,
                "leg_spread": 110.0,
                "builtin": True
            },
            "low_stance": {
                "name": "Low Stance",
                "category": "operation",
                "height": 70.0,
                "roll": 0.0,
                "pitch": 0.0,
                "yaw": 0.0,
                "leg_spread": 115.0,
                "builtin": False
            },
            "high_stance": {
                "name": "High Stance",
                "category": "operation",
                "height": 120.0,
                "roll": 0.0,
                "pitch": 0.0,
                "yaw": 0.0,
                "leg_spread": 105.0,
                "builtin": False
            },
            "rest_pose": {
                "name": "Rest Pose",
                "category": "rest",
                "height": 50.0,
                "roll": 0.0,
                "pitch": 0.0,
                "yaw": 0.0,
                "leg_spread": 130.0,
                "builtin": False
            },
            "power_off": {
                "name": "Power Off",
                "category": "rest",
                "height": 40.0,
                "roll": 0.0,
                "pitch": 0.0,
                "yaw": 0.0,
                "leg_spread": 110.0,
                "builtin": False
            }
        },
    }

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
        self._config = self.DEFAULTS.copy()

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
                self._config = {**self.DEFAULTS, **loaded}

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

    def get_leg_attach_point(self, leg: int) -> tuple:
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

    def get_all_leg_attach_points(self) -> list:
        """Get attach points for all legs.

        Returns:
            List of (x, y, z, angle) tuples for legs 0-5
        """
        return [self.get_leg_attach_point(leg) for leg in range(6)]

    def get_gaits(self) -> dict:
        """Get all gait definitions.

        Returns:
            Dictionary of gait_id -> gait configuration
        """
        return self.get("gaits", {})

    def get_enabled_gaits(self) -> dict:
        """Get only enabled gait definitions.

        Returns:
            Dictionary of enabled gait_id -> gait configuration
        """
        gaits = self.get_gaits()
        return {k: v for k, v in gaits.items() if v.get("enabled", True)}

    def get_gait_phase_offsets(self, gait_id: str) -> list:
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

    def update_gait(self, gait_id: str, updates: dict) -> bool:
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

    def get_poses(self) -> dict:
        """Get all saved poses.

        Returns:
            Dictionary of pose_id -> pose configuration
        """
        return self.get("poses", {})

    def get_pose(self, pose_id: str) -> Optional[dict]:
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

        # Check if pose_id already exists
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

    def update_pose(self, pose_id: str, updates: dict) -> bool:
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

        # Cannot delete builtin poses
        if poses[pose_id].get("builtin", False):
            return False

        # Cannot delete if only one pose remains
        if len(poses) <= 1:
            return False

        del poses[pose_id]
        self.set("poses", poses)
        return True


class ProfileManager:
    """Manages multiple configuration profiles.

    Profiles are stored in ~/.hexapod/profiles/ directory.
    Profile metadata is stored in ~/.hexapod/profiles.json.
    """

    def __init__(self, base_dir: Optional[Path] = None):
        """Initialize profile manager.

        Args:
            base_dir: Base directory for hexapod config. Defaults to ~/.hexapod
        """
        self.base_dir = base_dir or Path.home() / ".hexapod"
        self.profiles_dir = self.base_dir / "profiles"
        self.metadata_file = self.base_dir / "profiles.json"
        self._current_profile = "default"
        self._config: Optional[HexapodConfig] = None
        self._metadata: Dict[str, Any] = {}

        # Ensure directories exist
        self.profiles_dir.mkdir(parents=True, exist_ok=True)

        # Load or initialize metadata
        self._load_metadata()

        # Migrate legacy config if needed
        self._migrate_legacy_config()

    def _load_metadata(self) -> None:
        """Load profile metadata from file."""
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r', encoding='utf-8') as f:
                    self._metadata = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._metadata = {}

        # Ensure required structure
        if "profiles" not in self._metadata:
            self._metadata["profiles"] = {}
        if "default_profile" not in self._metadata:
            self._metadata["default_profile"] = "default"
        if "current_profile" not in self._metadata:
            self._metadata["current_profile"] = "default"

        self._current_profile = self._metadata.get("current_profile", "default")

    def _save_metadata(self) -> None:
        """Save profile metadata to file."""
        self._metadata["current_profile"] = self._current_profile
        self.base_dir.mkdir(parents=True, exist_ok=True)
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(self._metadata, f, indent=2)

    def _migrate_legacy_config(self) -> None:
        """Migrate legacy single config.json to profiles system."""
        legacy_config = self.base_dir / "config.json"
        default_profile = self.profiles_dir / "default.json"

        # If legacy config exists but no default profile, migrate it
        if legacy_config.exists() and not default_profile.exists():
            shutil.copy(legacy_config, default_profile)
            # Add metadata for migrated profile
            self._metadata["profiles"]["default"] = {
                "name": "default",
                "description": "Default configuration (migrated)",
                "lastModified": datetime.now().isoformat(),
                "isDefault": True
            }
            self._save_metadata()

        # Ensure default profile exists
        if not default_profile.exists():
            # Create default profile with default values
            config = HexapodConfig(default_profile)
            config.save()
            self._metadata["profiles"]["default"] = {
                "name": "default",
                "description": "Default configuration",
                "lastModified": datetime.now().isoformat(),
                "isDefault": True
            }
            self._save_metadata()

    def _get_profile_path(self, name: str) -> Path:
        """Get path to a profile's config file."""
        # Sanitize name to prevent path traversal
        safe_name = "".join(c for c in name if c.isalnum() or c in "_-").lower()
        return self.profiles_dir / f"{safe_name}.json"

    def list_profiles(self) -> List[Dict[str, Any]]:
        """List all available profiles with metadata.

        Returns:
            List of profile info dictionaries
        """
        profiles = []

        # Scan profiles directory for JSON files
        for profile_file in self.profiles_dir.glob("*.json"):
            name = profile_file.stem

            # Get metadata or create default
            meta = self._metadata.get("profiles", {}).get(name, {})

            profiles.append({
                "name": name,
                "description": meta.get("description", ""),
                "lastModified": meta.get("lastModified",
                    datetime.fromtimestamp(profile_file.stat().st_mtime).isoformat()),
                "isDefault": self._metadata.get("default_profile") == name
            })

        # Sort by name, with default first
        profiles.sort(key=lambda p: (not p["isDefault"], p["name"]))
        return profiles

    def get_profile_names(self) -> List[str]:
        """Get list of profile names."""
        return [p["name"] for p in self.list_profiles()]

    def profile_exists(self, name: str) -> bool:
        """Check if a profile exists."""
        return self._get_profile_path(name).exists()

    def get_current_profile(self) -> str:
        """Get the name of the currently active profile."""
        return self._current_profile

    def get_default_profile(self) -> str:
        """Get the name of the default profile."""
        return self._metadata.get("default_profile", "default")

    def set_default_profile(self, name: str) -> bool:
        """Set a profile as the default.

        Args:
            name: Profile name

        Returns:
            True if successful
        """
        if not self.profile_exists(name):
            return False

        # Update isDefault flags in metadata
        for pname in self._metadata.get("profiles", {}):
            self._metadata["profiles"][pname]["isDefault"] = (pname == name)

        self._metadata["default_profile"] = name
        self._save_metadata()
        return True

    def load_profile(self, name: str) -> HexapodConfig:
        """Load a profile's configuration.

        Args:
            name: Profile name

        Returns:
            HexapodConfig instance for the profile
        """
        profile_path = self._get_profile_path(name)

        if not profile_path.exists():
            # Profile doesn't exist, create it with defaults
            config = HexapodConfig(profile_path)
            config.save()
            self._update_profile_metadata(name, "New profile")
        else:
            config = HexapodConfig(profile_path)

        self._current_profile = name
        self._config = config
        self._save_metadata()

        return config

    def get_config(self, profile: Optional[str] = None) -> HexapodConfig:
        """Get configuration for a profile.

        Args:
            profile: Profile name (uses current if None)

        Returns:
            HexapodConfig instance
        """
        target = profile or self._current_profile

        # If requesting current profile and it's loaded, return it
        if target == self._current_profile and self._config is not None:
            return self._config

        return self.load_profile(target)

    def _update_profile_metadata(self, name: str, description: str = "") -> None:
        """Update metadata for a profile."""
        if "profiles" not in self._metadata:
            self._metadata["profiles"] = {}

        self._metadata["profiles"][name] = {
            "name": name,
            "description": description,
            "lastModified": datetime.now().isoformat(),
            "isDefault": self._metadata.get("default_profile") == name
        }
        self._save_metadata()

    def create_profile(self, name: str, copy_from: Optional[str] = None,
                      description: str = "") -> bool:
        """Create a new profile.

        Args:
            name: Name for the new profile
            copy_from: Optional profile to copy settings from
            description: Optional description

        Returns:
            True if successful
        """
        profile_path = self._get_profile_path(name)

        if profile_path.exists():
            return False  # Profile already exists

        if copy_from and self.profile_exists(copy_from):
            # Copy from existing profile
            source_path = self._get_profile_path(copy_from)
            shutil.copy(source_path, profile_path)
            if not description:
                description = f"Copy of {copy_from}"
        else:
            # Create with defaults
            config = HexapodConfig(profile_path)
            config.save()
            if not description:
                description = "New profile"

        self._update_profile_metadata(name, description)
        return True

    def delete_profile(self, name: str) -> bool:
        """Delete a profile.

        Args:
            name: Profile name to delete

        Returns:
            True if successful
        """
        # Prevent deleting the default profile
        if name == self._metadata.get("default_profile"):
            return False

        profile_path = self._get_profile_path(name)

        if not profile_path.exists():
            return False

        # Delete the file
        profile_path.unlink()

        # Remove from metadata
        if name in self._metadata.get("profiles", {}):
            del self._metadata["profiles"][name]

        # If we deleted the current profile, switch to default
        if self._current_profile == name:
            self._current_profile = self._metadata.get("default_profile", "default")
            self._config = None

        self._save_metadata()
        return True

    def rename_profile(self, old_name: str, new_name: str) -> bool:
        """Rename a profile.

        Args:
            old_name: Current profile name
            new_name: New profile name

        Returns:
            True if successful
        """
        old_path = self._get_profile_path(old_name)
        new_path = self._get_profile_path(new_name)

        if not old_path.exists() or new_path.exists():
            return False

        # Rename file
        old_path.rename(new_path)

        # Update metadata
        old_meta = self._metadata.get("profiles", {}).get(old_name, {})
        old_meta["name"] = new_name
        old_meta["lastModified"] = datetime.now().isoformat()

        if old_name in self._metadata.get("profiles", {}):
            del self._metadata["profiles"][old_name]
        self._metadata["profiles"][new_name] = old_meta

        # Update default if needed
        if self._metadata.get("default_profile") == old_name:
            self._metadata["default_profile"] = new_name

        # Update current if needed
        if self._current_profile == old_name:
            self._current_profile = new_name

        self._save_metadata()
        return True

    def update_profile_description(self, name: str, description: str) -> bool:
        """Update a profile's description.

        Args:
            name: Profile name
            description: New description

        Returns:
            True if successful
        """
        if not self.profile_exists(name):
            return False

        if "profiles" not in self._metadata:
            self._metadata["profiles"] = {}

        if name not in self._metadata["profiles"]:
            self._metadata["profiles"][name] = {"name": name}

        self._metadata["profiles"][name]["description"] = description
        self._metadata["profiles"][name]["lastModified"] = datetime.now().isoformat()
        self._save_metadata()
        return True

    def save_current(self) -> None:
        """Save the current profile's configuration."""
        if self._config:
            self._config.save()
            self._update_profile_metadata(
                self._current_profile,
                self._metadata.get("profiles", {}).get(
                    self._current_profile, {}
                ).get("description", "")
            )


# Global instances
_global_config: Optional[HexapodConfig] = None
_profile_manager: Optional[ProfileManager] = None


def get_profile_manager() -> ProfileManager:
    """Get global profile manager instance.

    Returns:
        Global ProfileManager instance
    """
    global _profile_manager
    if _profile_manager is None:
        _profile_manager = ProfileManager()
    return _profile_manager


def reset_profile_manager() -> None:
    """Reset global profile manager (for testing)."""
    global _profile_manager, _global_config
    _profile_manager = None
    _global_config = None


def get_config(profile: Optional[str] = None) -> HexapodConfig:
    """Get configuration for a profile.

    Args:
        profile: Profile name (uses current if None)

    Returns:
        HexapodConfig instance
    """
    # If a config was explicitly set via set_config(), use it
    global _global_config
    if _global_config is not None and profile is None:
        return _global_config

    return get_profile_manager().get_config(profile)


def set_config(config: HexapodConfig) -> None:
    """Set global configuration instance.

    This is used for testing and legacy compatibility.
    The set config will be returned by get_config() until reset.

    Args:
        config: HexapodConfig instance
    """
    global _global_config
    _global_config = config
