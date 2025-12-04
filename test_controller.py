#!/usr/bin/env python3
"""Diagnostic tool to test gamepad/controller detection.

Run this to verify your controller is properly detected before starting the hexapod server.
"""

def test_controller():
    """Test if gamepads are detected by the inputs library."""
    print("=" * 70)
    print("Controller Detection Test")
    print("=" * 70)
    print()

    # Check if inputs library is available
    try:
        import inputs
        print("✓ inputs library is installed")
    except ImportError:
        print("❌ inputs library is NOT installed")
        print("   Install it with: pip install inputs")
        return

    # Try to list gamepad devices
    print()
    print("Searching for gamepads...")
    try:
        devices = inputs.devices.gamepads
        if not devices:
            print("⚠️  No gamepads detected!")
            print()
            print("Troubleshooting:")
            print("  1. Make sure your controller is paired in System Settings → Bluetooth")
            print("  2. Check if it's shown as 'Connected' (not just 'Paired')")
            print("  3. Try pressing a button to wake it up")
            print("  4. Some controllers need to be reconnected after pairing")
            print()
            return

        print(f"✓ Found {len(devices)} gamepad(s):")
        for dev in devices:
            print(f"  - {dev.name}")
            print(f"    Path: {dev.device_path}")
    except Exception as e:
        print(f"❌ Error accessing gamepads: {e}")
        import traceback
        traceback.print_exc()
        return

    # Try to read input
    print()
    print("=" * 70)
    print("Testing input (press Ctrl+C to stop)")
    print("=" * 70)
    print("Move a stick or press a button on your controller...")
    print()

    try:
        for event in inputs.get_gamepad():
            if event.ev_type == "Absolute":
                print(f"Axis: {event.code:12s} = {event.state:6d}")
            elif event.ev_type == "Key":
                state = "PRESSED" if event.state == 1 else "RELEASED"
                print(f"Button: {event.code:12s} {state}")
    except KeyboardInterrupt:
        print()
        print("✓ Test completed successfully!")
        print("Your controller is working. You can now start the hexapod server with:")
        print("  python -m hexapod.main --controller")
    except Exception as e:
        print(f"❌ Error reading input: {e}")
        import traceback
        traceback.print_exc()


if __name__ == "__main__":
    test_controller()
