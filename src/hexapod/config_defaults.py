"""Default configuration values for hexapod robot.

This module contains all default values used when no configuration file exists
or when specific keys are missing. These serve as the baseline for all profiles.
"""

from typing import Dict, Any

# Default leg geometry (mm) - used as fallback for per-leg config
DEFAULT_LEG_COXA_LENGTH = 15.0
DEFAULT_LEG_FEMUR_LENGTH = 50.0
DEFAULT_LEG_TIBIA_LENGTH = 55.0

# Default body dimensions (mm)
DEFAULT_BODY_WIDTH = 250.0
DEFAULT_BODY_LENGTH = 300.0
DEFAULT_BODY_HEIGHT_GEO = 50.0  # Body thickness (not standing height)

# Default gait parameters
DEFAULT_STEP_HEIGHT = 25.0
DEFAULT_STEP_LENGTH = 40.0
DEFAULT_CYCLE_TIME = 1.2

# Default posture
DEFAULT_BODY_HEIGHT = 90.0  # standing height in mm
DEFAULT_LEG_SPREAD = 110.0  # percentage (50-150%)

# Gait definitions - phase offsets determine when each leg lifts
DEFAULT_GAITS: Dict[str, Dict[str, Any]] = {
    "tripod": {
        "name": "Tripod",
        "description": "Fast, stable gait with alternating groups of 3 legs",
        "enabled": True,
        "speed_range": "Medium - Fast",
        "stability": "Medium",
        "best_for": "Flat terrain, speed",
        "phase_offsets": [0.0, 0.5, 0.0, 0.5, 0.0, 0.5]
    },
    "wave": {
        "name": "Wave",
        "description": "Smooth, elegant sequential leg movement",
        "enabled": True,
        "speed_range": "Slow",
        "stability": "High",
        "best_for": "Rough terrain, stability",
        "phase_offsets": [0.0, 0.167, 0.333, 0.5, 0.667, 0.833]
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
        "phase_offsets": [0.0, 0.167, 0.333, 0.5, 0.667, 0.833]
    }
}

# Default poses for quick recall
DEFAULT_POSES: Dict[str, Dict[str, Any]] = {
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
}

# Default patrol configuration
DEFAULT_PATROL_SETTINGS: Dict[str, Any] = {
    "speed": 50,
    "mode": "loop",
    "zone_pattern": "lawnmower",
    "pause_on_detection": True,
    "detection_pause_time": 10,
}

DEFAULT_PATROL_DETECTION_TARGETS: Dict[str, bool] = {
    "snails": True,
    "people": False,
    "animals": False,
    "vehicles": False,
    "packages": False,
}

DEFAULT_PATROL_ALERTS: Dict[str, bool] = {
    "sound": True,
    "notification": True,
    "email": False,
    "photo": True,
}

DEFAULT_PATROL_SCHEDULE: Dict[str, Any] = {
    "enabled": False,
    "start_time": "08:00",
    "end_time": "18:00",
    "days": ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
}

# Default camera views
DEFAULT_CAMERA_VIEWS = [
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
]


def build_defaults() -> Dict[str, Any]:
    """Build the complete default configuration dictionary.

    Returns:
        Dictionary containing all default configuration values.
    """
    defaults = {
        # Default leg geometry (mm)
        "leg_coxa_length": DEFAULT_LEG_COXA_LENGTH,
        "leg_femur_length": DEFAULT_LEG_FEMUR_LENGTH,
        "leg_tibia_length": DEFAULT_LEG_TIBIA_LENGTH,

        # Per-leg geometry (mm)
        **{f"leg{leg}_coxa_length": DEFAULT_LEG_COXA_LENGTH for leg in range(6)},
        **{f"leg{leg}_femur_length": DEFAULT_LEG_FEMUR_LENGTH for leg in range(6)},
        **{f"leg{leg}_tibia_length": DEFAULT_LEG_TIBIA_LENGTH for leg in range(6)},

        # Body dimensions (mm)
        "body_width": DEFAULT_BODY_WIDTH,
        "body_length": DEFAULT_BODY_LENGTH,
        "body_height_geo": DEFAULT_BODY_HEIGHT_GEO,

        # Per-leg attach points (mm and degrees)
        "leg_0_attach_x": 150.0,
        "leg_0_attach_y": 120.0,
        "leg_0_attach_z": 0.0,
        "leg_0_attach_angle": 45.0,
        "leg_1_attach_x": 0.0,
        "leg_1_attach_y": 150.0,
        "leg_1_attach_z": 0.0,
        "leg_1_attach_angle": 90.0,
        "leg_2_attach_x": -150.0,
        "leg_2_attach_y": 120.0,
        "leg_2_attach_z": 0.0,
        "leg_2_attach_angle": 135.0,
        "leg_3_attach_x": -150.0,
        "leg_3_attach_y": -120.0,
        "leg_3_attach_z": 0.0,
        "leg_3_attach_angle": 225.0,
        "leg_4_attach_x": 0.0,
        "leg_4_attach_y": -150.0,
        "leg_4_attach_z": 0.0,
        "leg_4_attach_angle": 270.0,
        "leg_5_attach_x": 150.0,
        "leg_5_attach_y": -120.0,
        "leg_5_attach_z": 0.0,
        "leg_5_attach_angle": 315.0,

        # Gait parameters
        "step_height": DEFAULT_STEP_HEIGHT,
        "step_length": DEFAULT_STEP_LENGTH,
        "cycle_time": DEFAULT_CYCLE_TIME,
        "default_gait": "tripod",
        "gait_duty_factor": 65.0,

        # Turn behavior
        "turn_mode": "in-place",
        "max_yaw_rate": 60.0,

        # Motion smoothing
        "max_linear_accel": 0.5,
        "max_angular_accel": 90.0,
        "input_smoothing_enabled": True,
        "input_smoothing_factor": 0.15,

        # Default posture
        "body_height": DEFAULT_BODY_HEIGHT,
        "leg_spread": DEFAULT_LEG_SPREAD,
        "keep_body_level": False,

        # Gait definitions
        "gaits": DEFAULT_GAITS.copy(),

        # Servo configuration
        "servo_min_pulse": 500,
        "servo_max_pulse": 2500,
        "servo_frequency": 50,

        # Update rates (Hz)
        "servo_update_rate": 100,
        "telemetry_rate": 20,

        # Visualization
        "viz_coxa_radius": 4.0,
        "viz_femur_radius": 4.0,
        "viz_tibia_radius": 3.5,
        "viz_joint_radius": 5.0,
        "viz_foot_radius": 4.0,

        # Servo calibration offsets
        **{f"servo_offset_leg{leg}_joint{joint}": 0.0
           for leg in range(6) for joint in range(3)},

        # Camera
        "camera_view_angle": 0.0,
        "camera_views": DEFAULT_CAMERA_VIEWS.copy(),
        "hardware_cameras": [],

        # Safety limits
        "safety_max_translation_speed": 0.3,
        "safety_max_rotation_speed": 60.0,
        "safety_max_joint_speed": 300.0,
        "safety_temperature_limit": 70.0,
        "safety_max_body_tilt_stop": 30.0,
        "safety_max_body_tilt_correct": 15.0,
        "safety_max_step_height": 50.0,
        "safety_min_ground_clearance": 30.0,
        "safety_low_battery_threshold": 9.5,

        # E-Stop configuration
        "estop_action": "disable_torque",
        "estop_on_comm_loss": True,
        "estop_comm_loss_timeout": 500,
        "estop_on_servo_error": True,
        "estop_on_tilt_exceeded": True,
        "estop_on_low_battery": True,

        # Fault recovery
        "fault_recovery_action": "stay_stopped",

        # System settings
        "system_hostname": "hexapod-01",
        "system_web_port": 8000,
        "system_require_auth": False,
        "system_api_token": "",
        "system_timezone": "UTC",
        "system_ntp_servers": "pool.ntp.org, time.google.com",

        # Logging levels
        "log_level_kinematics": "INFO",
        "log_level_servo": "DEBUG",
        "log_level_sensors": "INFO",
        "log_level_gait": "INFO",
        "log_level_network": "WARN",

        # IMU configuration
        "imu_device": "MPU6050",
        "imu_filter_type": "complementary",
        "imu_sample_rate": 100,
        "imu_roll_offset": 0.0,
        "imu_pitch_offset": 0.0,
        "imu_yaw_offset": 0.0,

        # Foot contact sensor
        "foot_sensor_enabled": True,
        "foot_sensor_type": "current",
        "foot_sensor_threshold": 150,

        # Control mode settings
        "control_mode": "keyboard",
        "control_default_mode": "keyboard",

        # Gamepad settings
        "gamepad_deadzone": 10,
        "gamepad_expo_curve": 1.5,
        "gamepad_left_x_action": "strafe",
        "gamepad_left_y_action": "forward",
        "gamepad_right_x_action": "yaw",
        "gamepad_right_y_action": "height",
        "gamepad_a_action": "toggle_gait",
        "gamepad_b_action": "crouch",
        "gamepad_x_action": "camera",
        "gamepad_y_action": "pose",

        # Saved poses
        "poses": DEFAULT_POSES.copy(),

        # Patrol configuration
        "patrol_settings": DEFAULT_PATROL_SETTINGS.copy(),
        "patrol_detection_targets": DEFAULT_PATROL_DETECTION_TARGETS.copy(),
        "patrol_alerts": DEFAULT_PATROL_ALERTS.copy(),
        "patrol_schedule": DEFAULT_PATROL_SCHEDULE.copy(),
        "patrol_routes": [],
    }
    return defaults


# Pre-built defaults for import
DEFAULTS = build_defaults()
