"""Entry point for the hexapod controller app."""

from hexapod.web import create_app
from hexapod.calibrate_web import create_calibration_app
import uvicorn
import subprocess
import argparse
import os
import time
import threading


def kill_existing_servers():
    """Kill any existing hexapod server instances on port 8000."""
    current_pid = os.getpid()
    try:
        # Find processes using port 8000
        result = subprocess.run(
            ["lsof", "-ti", ":8000"],
            capture_output=True,
            text=True
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                try:
                    pid_int = int(pid)
                    # Don't kill ourselves
                    if pid_int != current_pid:
                        # First try graceful termination with SIGTERM
                        subprocess.run(["kill", "-15", pid])
                        print(f"Sent SIGTERM to server process: {pid}")
                        # Give it a moment to shut down gracefully
                        time.sleep(0.5)
                        # Check if still running, then force kill
                        check = subprocess.run(
                            ["kill", "-0", pid],
                            capture_output=True
                        )
                        if check.returncode == 0:
                            subprocess.run(["kill", "-9", pid])
                            print(f"Force killed server process: {pid}")
                except ValueError:
                    pass
    except FileNotFoundError:
        # lsof not available (e.g., on Windows)
        pass
    except Exception as e:
        print(f"Warning: Could not check for existing servers: {e}")


def start_calibration_server(host: str, port: int, use_hardware: bool):
    """Start the calibration server in a background thread."""
    calibration_app = create_calibration_app(use_hardware=use_hardware)
    config = uvicorn.Config(
        calibration_app,
        host=host,
        port=port,
        log_level="warning"  # Reduce log noise from calibration server
    )
    server = uvicorn.Server(config)
    server.run()


def kill_servers_on_port(port: int):
    """Kill any existing server instances on a specific port."""
    current_pid = os.getpid()
    try:
        result = subprocess.run(
            ["lsof", "-ti", f":{port}"],
            capture_output=True,
            text=True
        )
        if result.stdout.strip():
            pids = result.stdout.strip().split('\n')
            for pid in pids:
                try:
                    pid_int = int(pid)
                    if pid_int != current_pid:
                        subprocess.run(["kill", "-15", pid])
                        time.sleep(0.3)
                        check = subprocess.run(
                            ["kill", "-0", pid],
                            capture_output=True
                        )
                        if check.returncode == 0:
                            subprocess.run(["kill", "-9", pid])
                except ValueError:
                    pass
    except (FileNotFoundError, Exception):
        pass


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hexapod robot controller server")
    parser.add_argument("--controller", action="store_true",
                       help="Enable gamepad/controller input handling")
    parser.add_argument("--port", type=int, default=8000,
                       help="Port to run server on (default: 8000)")
    parser.add_argument("--calibration-port", type=int, default=8001,
                       help="Port for calibration server (default: 8001)")
    parser.add_argument("--host", type=str, default="0.0.0.0",
                       help="Host address to bind to (default: 0.0.0.0)")
    parser.add_argument("--hardware", action="store_true",
                       help="Use real PCA9685 servo hardware")
    args = parser.parse_args()

    # Kill any existing servers on both ports
    kill_existing_servers()
    kill_servers_on_port(args.calibration_port)

    print("=" * 50)
    print("HEXAPOD CONTROLLER")
    print("=" * 50)
    print(f"Main UI:      http://localhost:{args.port}")
    print(f"Calibration:  http://localhost:{args.calibration_port}")
    if args.controller:
        print("✓ Gamepad/controller input enabled")
    if args.hardware:
        print("✓ Hardware servo mode enabled")
    else:
        print("○ Using mock servos (simulation mode)")
    print("Press Ctrl+C to stop")
    print("=" * 50)

    # Start calibration server in background thread
    calibration_thread = threading.Thread(
        target=start_calibration_server,
        args=(args.host, args.calibration_port, args.hardware),
        daemon=True
    )
    calibration_thread.start()

    # Create and run main app
    app = create_app(use_controller=args.controller)
    uvicorn.run(app, host=args.host, port=args.port)
