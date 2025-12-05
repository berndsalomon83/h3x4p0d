"""Servo calibration tool.

Interactive CLI to map servo channels and test angles.
Saves calibration to ~/.hexapod_calibration.json
"""

import json
import os
from pathlib import Path
from .hardware import PCA9685ServoController, MockServoController


def load_existing_calibration() -> dict:
    """Load existing calibration if available."""
    cal_file = Path.home() / ".hexapod_calibration.json"
    if cal_file.exists():
        with open(cal_file, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_calibration(cal: dict):
    """Save calibration to JSON file."""
    cal_file = Path.home() / ".hexapod_calibration.json"
    with open(cal_file, "w", encoding='utf-8') as f:
        json.dump(cal, f, indent=2)
    print(f"Calibration saved to {cal_file}")


def test_servo(servo, channel: int, angle: float):
    """Test a single servo at given angle."""
    try:
        # Create a dummy (leg, joint) pair and set angle
        servo.servos[channel].angle = max(0, min(180, angle))
        print(f"  ✓ Channel {channel} set to {angle}°")
    except Exception as e:
        print(f"  ✗ Error: {e}")


def interactive_calibration():
    """Interactive servo calibration wizard."""
    print("=" * 60)
    print("HEXAPOD SERVO CALIBRATION TOOL")
    print("=" * 60)
    
    use_pca = input("\nUse PCA9685 hardware? (y/n, default: n): ").strip().lower() == "y"
    
    if use_pca:
        try:
            servo = PCA9685ServoController()
            print("✓ PCA9685 connected")
        except Exception as e:
            print(f"✗ PCA9685 init failed: {e}")
            print("Falling back to mock mode")
            servo = MockServoController()
    else:
        servo = MockServoController()
        print("Using mock servo controller (no hardware)")
    
    calibration = load_existing_calibration()
    
    # Interactive mapping
    print("\nLeg/joint → servo channel mapping:")
    print("(Enter channel number or press Enter to skip)")
    print()
    
    legs_joints = []
    for leg in range(6):
        for joint in range(3):
            joint_name = ["coxa", "femur", "tibia"][joint]
            key = f"{leg},{joint}"
            current = calibration.get(key)
            prompt = f"Leg {leg} ({joint_name})"
            
            if current is not None:
                default = f"[{current}]"
                inp = input(f"  {prompt} → channel {default}: ").strip()
                if inp:
                    try:
                        calibration[key] = int(inp)
                    except ValueError:
                        print(f"    Skipped (invalid input)")
            else:
                inp = input(f"  {prompt} → channel: ").strip()
                if inp:
                    try:
                        calibration[key] = int(inp)
                    except ValueError:
                        print(f"    Skipped")
            
            legs_joints.append((leg, joint, key))
    
    # Test servos
    print("\n" + "=" * 60)
    print("SERVO TEST")
    print("=" * 60)
    print("Testing each configured servo at 90° (neutral)...\n")
    
    for leg, joint, key in legs_joints:
        if key in calibration:
            ch = calibration[key]
            if use_pca and hasattr(servo, 'servos') and ch < len(servo.servos):
                test_servo(servo, ch, 90.0)
    
    # Save
    print("\n" + "=" * 60)
    save_response = input("Save calibration? (y/n, default: y): ").strip().lower() != "n"
    if save_response:
        save_calibration(calibration)
        print("\nCalibration saved!")
    else:
        print("Calibration discarded.")
    
    print("\nCalibration tool complete.")


if __name__ == "__main__":
    interactive_calibration()
