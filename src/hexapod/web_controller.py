"""HexapodController and ConnectionManager classes.

This module provides the core controller and WebSocket management classes:
    - HexapodController: Main coordinator for gait, servos, sensors, and pose
    - ConnectionManager: WebSocket connection pool with broadcast support

Architecture Notes:
    - ALL inverse kinematics calculations are performed on the backend
    - Frontend only displays servo angles received via WebSocket telemetry
    - This ensures 3D visualization matches actual hardware servo positions
"""

import math
import logging
from typing import List, Tuple

from fastapi import WebSocket

from .hardware import ServoController, SensorReader
from .gait import GaitEngine
from .controller_bluetooth import GenericController, MotionCommand

logger = logging.getLogger(__name__)


class ConnectionManager:
    """Manages WebSocket connections for broadcasting telemetry.

    Provides:
        - Connection tracking with unique IDs
        - Graceful handling of duplicate connections
        - Automatic removal of disconnected/broken websockets
        - Broadcast to all active connections with error handling
    """

    def __init__(self):
        self.active: List[WebSocket] = []
        self._connection_id = 0

    async def connect(self, websocket: WebSocket):
        """Accept and track a new WebSocket connection.

        Args:
            websocket: The WebSocket to accept and track
        """
        # Check for duplicate connection
        if websocket in self.active:
            logger.warning("Duplicate WebSocket connection attempt ignored")
            return

        await websocket.accept()
        self._connection_id += 1
        websocket.state.connection_id = self._connection_id
        client = websocket.client
        client_info = f"{client.host}:{client.port}" if client else "unknown"
        self.active.append(websocket)
        logger.info(f"WebSocket #{self._connection_id} connected from {client_info} (total: {len(self.active)})")

    def disconnect(self, websocket: WebSocket):
        """Remove a WebSocket from the active connections.

        Args:
            websocket: The WebSocket to remove
        """
        if websocket in self.active:
            self.active.remove(websocket)
            conn_id = getattr(websocket.state, 'connection_id', '?')
            logger.info(f"WebSocket #{conn_id} disconnected (remaining: {len(self.active)})")

    async def broadcast(self, message: dict):
        """Broadcast a message to all active WebSocket connections.

        Handles errors gracefully by removing broken connections.

        Args:
            message: Dictionary to broadcast as JSON
        """
        # Use list copy to allow modification during iteration
        for ws in list(self.active):
            try:
                await ws.send_json(message)
            except Exception as e:
                logger.debug(f"WebSocket send failed, disconnecting client: {e}")
                self.disconnect(ws)


class HexapodController:
    """Main controller coordinating gait, servo, sensor, and body pose state.

    This class is the central coordinator for all hexapod operations:
        - Gait generation via GaitEngine (tripod, wave, ripple modes)
        - Servo control with heading rotation applied to coxa angles
        - Body height and pose (pitch, roll, yaw) management
        - Sensor telemetry (temperature, battery)
        - Bluetooth/joystick input handling via GenericController

    Movement Modes:
        - Walking: Gait engine generates leg angles, heading applied to coxa
        - Standing: IK calculates pose based on body_height
        - Turning while walking: Uses differential steering (turn_rate)
        - Rotation in place: rotation_speed integrated into heading

    Gait/Config Synchronization:
        - Initial gait params (step_height, step_length, cycle_time) are loaded from config
        - User-set values via /api/gait/params override config for the running session
        - Profile switches refresh gait params from the new profile's config

    Attributes:
        servo: ServoController instance for hardware/mock servo control
        sensor: SensorReader for temperature and battery readings
        gait: GaitEngine instance for walking pattern generation
        running: Whether the hexapod is actively walking
        gait_mode: Current gait ("tripod", "wave", or "ripple")
        speed: Movement speed multiplier (0.0 to 1.0)
        heading: Current heading/direction in degrees
        body_height: Height of body above ground in mm (30-200mm)
        body_pitch/roll/yaw: Body pose angles in degrees
        leg_spread: Leg spread percentage (50-150%, 100 = default stance width)
        rotation_speed: Rotation rate in degrees per second
        ground_contacts: List of 6 booleans for leg stance state
    """

    def __init__(self, servo: ServoController, sensor: SensorReader):
        """Initialize the hexapod controller.

        Args:
            servo: ServoController instance for hardware/mock servo control
            sensor: SensorReader for temperature and battery readings
        """
        self.servo = servo
        self.sensor = sensor

        # Load gait parameters from config (with fallback to defaults)
        gait_params = self._load_gait_params_from_config()
        self.gait = GaitEngine(
            step_height=gait_params.get("step_height", 25.0),
            step_length=gait_params.get("step_length", 40.0),
            cycle_time=gait_params.get("cycle_time", 1.2)
        )

        self.running = False
        self.gait_mode = "tripod"
        self.speed = 1.0  # multiplier for cycle time
        self.heading = 0.0  # rotation in degrees
        self.body_height = 60.0  # mm - height of body above ground

        # Body pose (degrees) - for tilting/rotating body while standing
        self.body_pitch = 0.0  # forward/backward tilt (-30 to +30)
        self.body_roll = 0.0   # side-to-side tilt (-30 to +30)
        self.body_yaw = 0.0    # rotation around vertical axis (-45 to +45)

        # Leg spread percentage (50-150%, 100 = default stance width)
        self.leg_spread = 100.0

        # Rotation in place (degrees per second, 0 = no rotation)
        self.rotation_speed = 0.0  # positive = clockwise, negative = counter-clockwise

        # Track ground contact state for telemetry (True = stance/grounded)
        self.ground_contacts: List[bool] = [True] * 6

        # Motion command handler for Bluetooth/joystick input
        self.bt_controller = GenericController()
        self.bt_controller.on_event(self._handle_motion_cmd)

    def _load_gait_params_from_config(self) -> dict:
        """Load gait parameters from the active profile's config.

        Returns:
            Dictionary with step_height, step_length, and cycle_time
        """
        try:
            from .config import get_config
            cfg = get_config()
            return cfg.get_gait_params()
        except Exception as e:
            logger.warning(f"Could not load gait params from config: {e}")
            return {
                "step_height": 25.0,
                "step_length": 40.0,
                "cycle_time": 1.2
            }

    def refresh_gait_params_from_config(self):
        """Refresh gait parameters from the current profile's config.

        Call this after switching profiles to sync gait params.
        Does not override user-set values if they differ from defaults.
        """
        gait_params = self._load_gait_params_from_config()
        self.gait.step_height = gait_params.get("step_height", self.gait.step_height)
        self.gait.step_length = gait_params.get("step_length", self.gait.step_length)
        self.gait.cycle_time = gait_params.get("cycle_time", self.gait.cycle_time)
        logger.info(f"Gait params refreshed from config: {gait_params}")

    def _get_leg_mount_positions(self) -> List[Tuple[float, float]]:
        """Get leg mount positions from config.

        Returns list of (x, y) tuples for legs 0-5, where:
        - x = front/back position (positive = front)
        - y = left/right position (positive = right)
        """
        from .config import get_config
        cfg = get_config()
        positions = []
        for leg in range(6):
            x = cfg.get(f"leg_{leg}_attach_x", 0.0)
            y = cfg.get(f"leg_{leg}_attach_y", 0.0)
            positions.append((x, y))
        return positions

    def _handle_motion_cmd(self, cmd: MotionCommand):
        """Handle motion commands from controller.

        Args:
            cmd: Motion command from Bluetooth/joystick input
        """
        if cmd.type == "move":
            x, y = cmd.data.get("x", 0), cmd.data.get("y", 0)
            # convert to heading and speed
            if abs(x) > 0.1 or abs(y) > 0.1:
                mag = math.sqrt(x**2 + y**2)
                self.speed = min(1.0, mag)
                if y != 0:
                    self.heading = math.degrees(math.atan2(x, y))
        elif cmd.type == "gait":
            mode = cmd.data.get("mode", "tripod")
            from .config import get_config
            cfg = get_config()
            enabled_gaits = cfg.get_enabled_gaits()
            if mode in enabled_gaits:
                self.gait_mode = mode
        elif cmd.type == "start":
            self.running = True
        elif cmd.type == "stop":
            self.running = False
        elif cmd.type == "quit":
            self.running = False

    async def start_controller(self):
        """Start the Bluetooth/joystick input handler."""
        try:
            await self.bt_controller.start()
        except Exception as e:
            logger.error(f"Controller error: {e}")

    def calculate_standing_pose(self) -> List[Tuple[float, float, float]]:
        """Calculate IK for standing pose at current body height and pose.

        Applies body pitch, roll, and yaw to keep feet grounded while body tilts.
        Returns list of (coxa, femur, tibia) angles in degrees for all 6 legs.
        Uses servo convention: 90 = neutral/horizontal.
        """
        angles = []
        ground_level = -10.0  # mm

        # Get leg mount positions from config (X=front/back, Y=left/right)
        leg_mount_positions = self._get_leg_mount_positions()

        # Calculate stance width dynamically based on actual leg geometry
        coxa_len = self.gait.ik.L1
        femur_len = self.gait.ik.L2
        tibia_len = self.gait.ik.L3
        max_leg_reach = femur_len + tibia_len

        # Base vertical drop (body height to ground)
        base_vertical_drop = self.body_height - ground_level

        # Use 85% of max reach to stay within comfortable range
        usable_reach = max_leg_reach * 0.85

        # Convert body pose angles to radians
        pitch_rad = math.radians(self.body_pitch)  # forward tilt (+pitch = nose down)
        roll_rad = math.radians(self.body_roll)    # side tilt (+roll = right side down)

        for leg_idx in range(6):
            mount_x, mount_z = leg_mount_positions[leg_idx]

            # Calculate height offset at this leg's position due to body tilt
            # When body pitches forward (positive), front goes down, rear goes up
            # When body rolls right (positive), right side goes down, left side goes up
            # Height change at position (x,z) = x*sin(pitch) + z*sin(roll)
            height_offset = mount_x * math.sin(pitch_rad) + mount_z * math.sin(roll_rad)

            # Adjusted vertical drop for this leg (positive = leg needs to reach further down)
            vertical_drop = base_vertical_drop + height_offset

            # Clamp vertical drop to valid range
            vertical_drop = max(10.0, min(vertical_drop, usable_reach * 0.95))

            # Recalculate horizontal reach for this leg's vertical drop
            if vertical_drop >= usable_reach:
                leg_horizontal = max_leg_reach * 0.3
            else:
                leg_horizontal = math.sqrt(usable_reach**2 - vertical_drop**2)

            # Apply leg spread factor (percentage, 100 = default)
            spread_factor = self.leg_spread / 100.0
            leg_stance_width = coxa_len + (leg_horizontal * spread_factor)

            # Apply yaw to the coxa angle (all legs rotate together)
            coxa_yaw_offset = self.body_yaw

            try:
                # IK solve in leg-local frame
                ik_coxa, ik_femur, ik_tibia = self.gait.ik.solve(
                    leg_stance_width,  # radial distance (adjusted for this leg)
                    0.0,               # no tangential offset
                    -vertical_drop     # down (adjusted for body tilt)
                )

                # Base coxa is 90 (neutral), add yaw offset
                coxa = 90.0 + coxa_yaw_offset
                femur = ik_femur
                tibia = ik_tibia

                angles.append((coxa, femur, tibia))
            except ValueError as e:
                # Target unreachable, use safe default angles
                logger.debug(f"IK failed for leg {leg_idx} at height {self.body_height}mm, "
                      f"pose p={self.body_pitch} r={self.body_roll}: {e}")
                angles.append((90.0 + coxa_yaw_offset, 70.0, 90.0))

        return angles

    def update_servos(self):
        """Update servo positions based on current gait time or standing pose.

        Returns:
            List of (coxa, femur, tibia) angle tuples for all 6 legs
        """
        if self.running:
            # Walking: use gait generator
            base_angles = self.gait.joint_angles_for_time(self.gait.time, mode=self.gait_mode)
            # stance phase when swing=False inside gait engine
            self.ground_contacts = [not swing for swing in self.gait.last_swing_states]
        else:
            # Standing: use IK for body height (already includes body pose)
            base_angles = self.calculate_standing_pose()
            self.ground_contacts = [True] * 6

        # Get leg mount positions from config for body pose adjustment during walking
        leg_mount_positions = self._get_leg_mount_positions()

        # Convert body pose to radians for walking adjustments
        pitch_rad = math.radians(self.body_pitch)
        roll_rad = math.radians(self.body_roll)

        # Apply heading rotation, yaw, and body pose to all angles
        angles = []
        for leg_idx, (coxa, femur, tibia) in enumerate(base_angles):
            # Add heading rotation and yaw to coxa
            coxa_adjusted = coxa + self.heading + self.body_yaw

            # Apply body pitch/roll adjustments during walking
            # (Standing pose already includes these via IK)
            if self.running:
                mount_x, mount_z = leg_mount_positions[leg_idx]

                # Calculate femur angle adjustment based on body tilt
                # Pitch: front legs need to lower femur (larger angle), rear legs raise femur
                # Roll: right legs adjust for roll, left legs opposite
                # Approximate: 1 degree of body tilt = ~0.5 degree femur adjustment
                femur_pitch_adj = mount_x * math.sin(pitch_rad) * 0.3
                femur_roll_adj = mount_z * math.sin(roll_rad) * 0.3

                femur += femur_pitch_adj + femur_roll_adj

                # Clamp femur to safe range
                femur = max(30.0, min(150.0, femur))

            angles.append((coxa_adjusted, femur, tibia))
            try:
                self.servo.set_servo_angle(leg_idx, 0, coxa_adjusted)
                self.servo.set_servo_angle(leg_idx, 1, femur)
                self.servo.set_servo_angle(leg_idx, 2, tibia)
            except Exception as e:
                logger.error(f"Servo error leg {leg_idx}: {e}")

        return angles

    def get_telemetry(self) -> dict:
        """Return current state for UI.

        Returns:
            Dictionary containing all telemetry fields
        """
        return {
            "running": self.running,
            "gait_mode": self.gait_mode,
            "time": self.gait.time,
            "speed": self.speed,
            "heading": self.heading,
            "body_height": self.body_height,
            "body_pitch": self.body_pitch,
            "body_roll": self.body_roll,
            "body_yaw": self.body_yaw,
            "leg_spread": self.leg_spread,
            "rotation_speed": self.rotation_speed,
            "temperature_c": self.sensor.read_temperature_c(),
            "battery_v": self.sensor.read_battery_voltage(),
            "ground_contacts": self.ground_contacts,
        }

    def emergency_stop(self):
        """Emergency stop - immediately halt all movement."""
        self.running = False
        self.speed = 0.0
        self.rotation_speed = 0.0
        self.body_pitch = 0.0
        self.body_roll = 0.0
        self.body_yaw = 0.0
        logger.warning("EMERGENCY STOP activated")
