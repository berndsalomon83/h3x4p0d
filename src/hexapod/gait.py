"""Gait generation and inverse kinematics for a 6-legged hexapod robot.

Supports multiple gait modes (tripod, wave, ripple) and basic IK based on
leg geometry. Uses centralized configuration system.
"""
from typing import List, Tuple
import math

try:
    from .config import get_config
except ImportError:
    # Fallback for standalone usage
    class FallbackConfig:
        def get(self, key, default):
            defaults = {
                "leg_coxa_length": 30.0,
                "leg_femur_length": 60.0,
                "leg_tibia_length": 80.0,
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
        float(cfg.get("leg_coxa_length", 30.0)),
        float(cfg.get("leg_femur_length", 60.0)),
        float(cfg.get("leg_tibia_length", 80.0)),
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
    def __init__(self, step_height=30.0, step_length=40.0, cycle_time=1.0):
        self.step_height = step_height
        self.step_length = step_length
        self.cycle_time = cycle_time
        self.time = 0.0
        self.ik = InverseKinematics(LEG_COXA_LEN, LEG_FEMUR_LEN, LEG_TIBIA_LEN)

    def update(self, dt: float):
        self.time += dt

    def joint_angles_for_time(self, t: float, mode: str = "tripod") -> List[Tuple[float,float,float]]:
        """Return list of (coxa, femur, tibia) angles in degrees for 6 legs.

        Uses direct angle-based gait for reliable visualization.
        Servo convention: 90° = neutral/horizontal for coxa, femur pointing down for standing.
        """
        # Convert step_height (10-50mm) to femur lift angle (5-25 degrees)
        # Higher step_height = more lift during swing phase
        lift_angle = 5.0 + (self.step_height - 10.0) / 40.0 * 20.0  # 5-25 degrees
        lift_angle = max(5.0, min(25.0, lift_angle))

        # Convert step_length (10-80mm) to coxa swing angle (3-15 degrees)
        # Longer step = wider coxa swing front-to-back
        swing_angle = 3.0 + (self.step_length - 10.0) / 70.0 * 12.0  # 3-15 degrees
        swing_angle = max(3.0, min(15.0, swing_angle))

        angles = []
        for leg in range(6):
            phase = self._phase_for_leg(leg, mode)
            local_t = ((t / self.cycle_time) + phase) % 1.0

            # swing phase (0-0.5): lift leg up and forward
            # stance phase (0.5-1.0): push down and backward
            swing = local_t < 0.5
            cycle_pos = (local_t * 2.0) if swing else ((local_t - 0.5) * 2.0)

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

        return angles

    def _phase_for_leg(self, leg: int, mode: str) -> float:
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
