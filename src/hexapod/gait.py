"""Gait generation and inverse kinematics for a 6-legged hexapod robot.

This module provides:
    - GaitEngine: Generates walking patterns with differential steering support
    - InverseKinematics: Solves for servo angles given foot target positions

Gait Modes:
    - tripod: Fast, stable - alternating groups of 3 legs
    - wave: Smooth, elegant - sequential leg movement
    - ripple: Balanced - offset pattern between legs

Features:
    - Differential steering (turn_rate) for tank-style turning while walking
    - Configurable step height, length, and cycle time
    - Ground contact tracking for telemetry
    - Centralized configuration via config.py

Default leg geometry (from config):
    - Coxa: 15mm (hip joint)
    - Femur: 50mm (upper leg)
    - Tibia: 55mm (lower leg)
"""
from typing import List, Tuple
import math

try:
    from .config import get_config
except ImportError:
    # Fallback for standalone usage (must match config.py defaults)
    class FallbackConfig:
        def get(self, key, default):
            defaults = {
                "leg_coxa_length": 15.0,
                "leg_femur_length": 50.0,
                "leg_tibia_length": 55.0,
                "body_width": 100.0,
                "body_length": 120.0,
            }
            return defaults.get(key, default)
    def get_config():
        return FallbackConfig()


def get_leg_geometry() -> Tuple[float, float, float]:
    """Get leg dimensions from config."""
    cfg = get_config()
    return (
        float(cfg.get("leg_coxa_length", 15.0)),
        float(cfg.get("leg_femur_length", 50.0)),
        float(cfg.get("leg_tibia_length", 55.0)),
    )


def get_leg_positions() -> List[Tuple[float, float]]:
    """Get leg attachment points from config."""
    cfg = get_config()
    body_length = float(cfg.get("body_length", 120.0))
    body_width = float(cfg.get("body_width", 100.0))

    return [
        (body_length / 2, body_width / 2),      # leg 0: front-right
        (0.0, body_width / 2),                   # leg 1: mid-right
        (-body_length / 2, body_width / 2),     # leg 2: rear-right
        (-body_length / 2, -body_width / 2),    # leg 3: rear-left
        (0.0, -body_width / 2),                  # leg 4: mid-left
        (body_length / 2, -body_width / 2),     # leg 5: front-left
    ]


# Backwards compatibility
LEG_COXA_LEN, LEG_FEMUR_LEN, LEG_TIBIA_LEN = get_leg_geometry()
LEG_POSITIONS = get_leg_positions()

class GaitEngine:
    """Generates walking gait patterns for a 6-legged hexapod robot.

    Supports tripod, wave, and ripple gaits with configurable step parameters.
    Uses direct angle-based gait generation for reliable servo control.

    Features:
        - Differential steering via turn_rate for smooth turning while walking
        - Configurable step height, length, and cycle time
        - Ground contact tracking for telemetry

    Attributes:
        step_height: Vertical lift during swing phase (10-50mm, affects femur angle)
        step_length: Forward/backward swing distance (10-80mm, affects coxa angle)
        cycle_time: Duration of one complete gait cycle in seconds
        time: Current position in the gait cycle
        turn_rate: Differential steering rate (-1.0 to 1.0). Negative = turn left,
                   positive = turn right. Applied by modifying swing angles differently
                   for left vs right legs (tank-style steering).
        ik: InverseKinematics solver instance for standing pose calculations
        last_swing_states: List of 6 booleans tracking which legs are in swing phase
    """

    def __init__(self, step_height=30.0, step_length=40.0, cycle_time=1.0):
        """Initialize the gait engine.

        Args:
            step_height: Vertical lift during swing phase in mm (default: 30.0)
            step_length: Forward/backward swing distance in mm (default: 40.0)
            cycle_time: Duration of one gait cycle in seconds (default: 1.0)
        """
        self.step_height = step_height
        self.step_length = step_length
        self.cycle_time = cycle_time
        self.time = 0.0
        self.turn_rate = 0.0  # -1.0 to 1.0: negative = left, positive = right
        # Initialize IK solver with current config values (not stale module constants)
        coxa, femur, tibia = get_leg_geometry()
        self.ik = InverseKinematics(coxa, femur, tibia)
        # Track whether each leg is currently in swing phase for telemetry/ground contact
        self.last_swing_states = [False] * 6

    def refresh_leg_geometry(self):
        """Refresh the IK solver with current leg dimensions from config.

        Call this method after leg dimensions are changed via the UI or config
        to ensure IK calculations use the updated values.
        """
        coxa, femur, tibia = get_leg_geometry()
        self.ik = InverseKinematics(coxa, femur, tibia)

    def update(self, dt: float):
        """Advance the gait time by delta time.

        Args:
            dt: Time delta in seconds to advance the gait cycle
        """
        self.time += dt

    def joint_angles_for_time(self, t: float, mode: str = "tripod") -> List[Tuple[float,float,float]]:
        """Calculate joint angles for all 6 legs at a given time in the gait cycle.

        Uses direct angle-based gait for reliable visualization and servo control.
        Applies differential steering based on turn_rate to create smooth turns.

        Servo convention:
            - Coxa: 90° = neutral/horizontal (legs pointing outward)
            - Femur: ~67° for ground contact at normal standing height
            - Tibia: 180° for standing (90° relative knee bend)

        Gait phases:
            - Swing phase (0-0.5): Leg lifts and moves forward
            - Stance phase (0.5-1.0): Leg pushes backward on ground

        Differential steering:
            - turn_rate > 0 (right turn): Right legs step less, left legs step more
            - turn_rate < 0 (left turn): Left legs step less, right legs step more
            - Right legs: indices 0, 1, 2 | Left legs: indices 3, 4, 5

        Args:
            t: Time in the gait cycle (seconds)
            mode: Gait mode - "tripod", "wave", or "ripple"

        Returns:
            List of 6 tuples, each containing (coxa, femur, tibia) angles in degrees.
            Also updates self.last_swing_states with current swing/stance state per leg.
        """
        # Convert step_height (10-50mm) to femur lift angle (5-25 degrees)
        # Higher step_height = more lift during swing phase
        lift_angle = 5.0 + (self.step_height - 10.0) / 40.0 * 20.0  # 5-25 degrees
        lift_angle = max(5.0, min(25.0, lift_angle))

        # Convert step_length (10-80mm) to coxa swing angle (3-15 degrees)
        # Longer step = wider coxa swing front-to-back
        base_swing_angle = 3.0 + (self.step_length - 10.0) / 70.0 * 12.0  # 3-15 degrees
        base_swing_angle = max(3.0, min(15.0, base_swing_angle))

        angles = []
        swing_states = []
        for leg in range(6):
            phase = self._phase_for_leg(leg, mode)
            local_t = ((t / self.cycle_time) + phase) % 1.0

            # swing phase (0-0.5): lift leg up and forward
            # stance phase (0.5-1.0): push down and backward
            swing = local_t < 0.5
            swing_states.append(swing)
            cycle_pos = (local_t * 2.0) if swing else ((local_t - 0.5) * 2.0)

            # Apply differential steering based on turn_rate
            # Right legs: 0, 1, 2 | Left legs: 3, 4, 5
            # turn_rate > 0 (right): right legs step less, left legs step more
            # turn_rate < 0 (left): left legs step less, right legs step more
            is_right_leg = leg in (0, 1, 2)
            if is_right_leg:
                # Right leg: reduce swing when turning right, increase when turning left
                turn_modifier = 1.0 - self.turn_rate * 0.8  # 0.2 to 1.8
            else:
                # Left leg: increase swing when turning right, reduce when turning left
                turn_modifier = 1.0 + self.turn_rate * 0.8  # 0.2 to 1.8
            turn_modifier = max(0.1, min(2.0, turn_modifier))
            swing_angle = base_swing_angle * turn_modifier

            # Coxa angle: swing forward during swing phase, backward during stance
            # This creates the forward stepping motion based on step_length
            if swing:
                # Swing phase: move forward (increase from 90)
                coxa = 90.0 + math.sin(cycle_pos * math.pi) * swing_angle
            else:
                # Stance phase: push backward (decrease from 90)
                coxa = 90.0 - math.sin(cycle_pos * math.pi) * swing_angle

            # Femur angle: lift leg during swing, lower during stance
            # Match standing IK convention: ~67° for ground contact
            if swing:
                # During swing: lift up based on step_height parameter
                femur = 75.0 + math.sin(cycle_pos * math.pi) * lift_angle
            else:
                # During stance: match standing pose
                femur = 67.0  # Matches IK for body height ~60mm

            # Tibia angle: MUST match standing IK convention
            # Standing uses tibia=180° (90° relative knee bend)
            # This is CRITICAL for smooth transitions and correct foot positioning
            if swing:
                # During swing: extend slightly based on step height for clearance
                tibia_extend = lift_angle * 0.5  # Proportional to lift
                tibia = 180.0 + math.sin(cycle_pos * math.pi) * tibia_extend
            else:
                # During stance: match standing pose (90° relative knee bend)
                tibia = 180.0  # Matches IK for ground contact

            angles.append((coxa, femur, tibia))

        # Persist swing states so the controller can expose ground contact telemetry
        self.last_swing_states = swing_states
        return angles

    def _phase_for_leg(self, leg: int, mode: str) -> float:
        """Get the phase offset for a leg in the specified gait mode.

        Phase determines when each leg starts its swing/stance cycle relative
        to other legs. A phase of 0.5 means the leg is 180° out of phase.

        Gait modes:
            - tripod: Two groups (0,2,4 and 1,3,5) alternate, phase = 0 or 0.5
            - wave: Sequential front-to-back, phase = leg/6
            - ripple: Offset pattern for smooth ripple effect

        Args:
            leg: Leg index (0-5)
            mode: Gait mode string

        Returns:
            Phase offset (0.0 to 1.0)
        """
        if mode == "tripod":
            # two groups 180 degrees apart
            return 0.0 if leg in (0, 2, 4) else 0.5
        elif mode == "wave":
            # evenly distributed front-to-back
            return leg / 6.0
        elif mode == "ripple":
            # ripple: neighboring legs offset slightly
            mapping = [0.0, 0.25, 0.5, 0.75, 0.1, 0.6]
            return mapping[leg % 6]
        return 0.0


class InverseKinematics:
    """Simple 2D inverse kinematics for a 3-link leg.
    
    Solves for coxa (yaw), femur, tibia angles given target (x,y,z) position.
    """
    def __init__(self, coxa_len: float, femur_len: float, tibia_len: float):
        self.L1 = coxa_len
        self.L2 = femur_len
        self.L3 = tibia_len

    def solve(self, x: float, y: float, z: float) -> Tuple[float, float, float]:
        """Solve IK for foot target (x,y,z) relative to hip.
        
        Returns: (coxa_deg, femur_deg, tibia_deg)
        Raises ValueError if target unreachable.
        """
        # coxa rotation: yaw around vertical axis
        coxa_rad = math.atan2(y, x)
        coxa_deg = math.degrees(coxa_rad)
        
        # project to 2D side view: (horizontal distance, vertical)
        r_horiz = math.sqrt(x**2 + y**2) - self.L1  # distance from coxa joint
        r_vert = z
        r = math.sqrt(r_horiz**2 + r_vert**2)
        
        # check reachability
        reach_min = abs(self.L2 - self.L3)
        reach_max = self.L2 + self.L3
        if r < reach_min or r > reach_max:
            raise ValueError(f"Target {(x,y,z)} out of reach [reach={r}, min={reach_min}, max={reach_max}]")
        
        # law of cosines for femur-tibia internal angle
        cos_tibia = (r**2 - self.L2**2 - self.L3**2) / (2.0 * self.L2 * self.L3)
        cos_tibia = max(-1.0, min(1.0, cos_tibia))  # clamp
        tibia_internal_rad = math.acos(cos_tibia)  # 0..pi (internal angle between femur and tibia)

        # angle from hip to target
        target_angle_rad = math.atan2(r_vert, r_horiz)

        # femur angle using law of sines or direct calc
        k1 = self.L2 + self.L3 * math.cos(tibia_internal_rad)
        k2 = self.L3 * math.sin(tibia_internal_rad)
        elbow_offset_rad = math.atan2(k2, k1)
        # elbow_offset is angle at hip between femur and target line
        # femur is above target line (toward horizontal), so ADD the offset
        femur_rad = target_angle_rad + elbow_offset_rad

        # Convert femur angle to servo convention where 90° is horizontal
        # IK calculates angle from horizontal (0° = horizontal, negative = down)
        # Servo expects: 90° = horizontal, <90° = down/forward, >90° = down/backward
        femur_deg = 90.0 + math.degrees(femur_rad)

        # Tibia angle RELATIVE to femur (for Three.js hierarchical rotations)
        # Frontend expects: tibiaAngle = π - kneeAngle (matches frontend compute2LinkIK)
        # This is the relative rotation angle, NOT absolute angle
        # Positive rotation bends the knee forward/outward
        tibia_relative_rad = math.pi - tibia_internal_rad
        tibia_deg = 90.0 + math.degrees(tibia_relative_rad)

        # clamp all angles to servo range [0, 180]
        coxa_deg = float(max(0, min(180, coxa_deg)))
        femur_deg = float(max(0, min(180, femur_deg)))
        tibia_deg = float(max(0, min(180, tibia_deg)))
        
        return (coxa_deg, femur_deg, tibia_deg)

if __name__ == "__main__":
    ik = InverseKinematics(LEG_COXA_LEN, LEG_FEMUR_LEN, LEG_TIBIA_LEN)
    # test IK for a point 30mm away horizontally, 80mm down
    try:
        c, f, t = ik.solve(30, 0, -80)
        print(f"IK solve (30,0,-80): coxa={c:.1f}, femur={f:.1f}, tibia={t:.1f}")
    except Exception as e:
        print(f"IK solve failed: {e}")
    
    g = GaitEngine()
    for i in range(0, 11):
        t = i*0.1
        angles = g.joint_angles_for_time(t, mode="tripod")
        print(f"t={t:.1f}: {angles[0]}")
