"""Entry point for the hexapod controller app."""

from hexapod.web import create_app
import uvicorn
import subprocess
import sys
import argparse

def kill_existing_servers():
    """Kill any existing hexapod server instances on port 8000."""
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
                    # Don't kill ourselves
                    import os
                    if int(pid) != os.getpid():
                        subprocess.run(["kill", "-9", pid])
                        print(f"Killed existing server process: {pid}")
                except ValueError:
                    pass
    except FileNotFoundError:
        # lsof not available (e.g., on Windows)
        pass
    except Exception as e:
        print(f"Warning: Could not check for existing servers: {e}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Hexapod robot controller server")
    parser.add_argument("--controller", action="store_true",
                       help="Enable gamepad/controller input handling")
    parser.add_argument("--port", type=int, default=8000,
                       help="Port to run server on (default: 8000)")
    parser.add_argument("--host", type=str, default="0.0.0.0",
                       help="Host address to bind to (default: 0.0.0.0)")
    args = parser.parse_args()

    kill_existing_servers()

    print(f"Starting hexapod server on http://localhost:{args.port}")
    if args.controller:
        print("✓ Gamepad/controller input enabled")
    print("Press Ctrl+C to stop")

    # Create app with controller support if requested
    app = create_app(use_controller=args.controller)
    uvicorn.run(app, host=args.host, port=args.port)
