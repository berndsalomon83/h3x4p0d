#!/usr/bin/env python3
"""CLI tool for querying and setting the hexapod API.

Usage:
    python -m hexapod.cli_api status              # Get current status
    python -m hexapod.cli_api sensors             # Get sensor readings
    python -m hexapod.cli_api poses               # List all poses
    python -m hexapod.cli_api pose default_stance # Get specific pose
    python -m hexapod.cli_api apply low_stance    # Apply a pose
    python -m hexapod.cli_api gait tripod         # Set gait mode
    python -m hexapod.cli_api run true            # Start walking
    python -m hexapod.cli_api run false           # Stop walking
    python -m hexapod.cli_api config              # Get full config
    python -m hexapod.cli_api set body_height 100 # Set a config value
    python -m hexapod.cli_api profiles            # List profiles
    python -m hexapod.cli_api gaits               # List gaits
"""

import argparse
import json
import sys
from urllib.request import urlopen, Request
from urllib.error import URLError, HTTPError


DEFAULT_HOST = "localhost"
DEFAULT_PORT = 8000


def make_request(
    method: str, endpoint: str, data: dict = None, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT
) -> dict:
    """Make an HTTP request to the API."""
    url = f"http://{host}:{port}{endpoint}"

    headers = {"Content-Type": "application/json"} if data else {}
    body = json.dumps(data).encode() if data else None

    req = Request(url, data=body, headers=headers, method=method)

    try:
        with urlopen(req, timeout=10) as response:
            return json.loads(response.read().decode())
    except HTTPError as e:
        try:
            error_body = json.loads(e.read().decode())
            return {"error": error_body.get("error", str(e)), "status_code": e.code}
        except Exception:
            return {"error": str(e), "status_code": e.code}
    except URLError as e:
        return {"error": f"Connection failed: {e.reason}"}
    except Exception as e:
        return {"error": str(e)}


def get(endpoint: str, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> dict:
    """GET request."""
    return make_request("GET", endpoint, host=host, port=port)


def post(endpoint: str, data: dict, host: str = DEFAULT_HOST, port: int = DEFAULT_PORT) -> dict:
    """POST request."""
    return make_request("POST", endpoint, data=data, host=host, port=port)


def print_json(data: dict, compact: bool = False):
    """Print JSON data."""
    if compact:
        print(json.dumps(data))
    else:
        print(json.dumps(data, indent=2))


def cmd_status(args):
    """Get current status."""
    result = get("/api/status", args.host, args.port)
    print_json(result, args.compact)


def cmd_sensors(args):
    """Get sensor readings."""
    result = get("/api/sensors", args.host, args.port)
    print_json(result, args.compact)


def cmd_poses(args):
    """List all poses."""
    result = get("/api/poses", args.host, args.port)
    if "poses" in result and not args.compact:
        print(f"Found {len(result['poses'])} poses:\n")
        for pose_id, pose in result["poses"].items():
            builtin = " [builtin]" if pose.get("builtin") else ""
            print(f"  {pose_id}: {pose['name']} ({pose['category']}){builtin}")
            print(f"    height={pose['height']}mm, spread={pose['leg_spread']}%, "
                  f"roll={pose['roll']}°, pitch={pose['pitch']}°, yaw={pose['yaw']}°")
    else:
        print_json(result, args.compact)


def cmd_pose(args):
    """Get or apply a specific pose."""
    result = get("/api/poses", args.host, args.port)
    if "poses" in result:
        pose = result["poses"].get(args.pose_id)
        if pose:
            print_json({args.pose_id: pose}, args.compact)
        else:
            print(f"Pose '{args.pose_id}' not found")
            print(f"Available: {', '.join(result['poses'].keys())}")
            sys.exit(1)
    else:
        print_json(result, args.compact)


def cmd_apply(args):
    """Apply a pose."""
    result = post("/api/poses", {"action": "apply", "pose_id": args.pose_id}, args.host, args.port)
    if result.get("ok"):
        print(f"Applied pose: {args.pose_id}")
        if "applied" in result:
            print_json(result["applied"], args.compact)
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")
        sys.exit(1)


def cmd_gait(args):
    """Set gait mode."""
    result = post("/api/gait", {"mode": args.mode}, args.host, args.port)
    if result.get("ok"):
        print(f"Gait set to: {result.get('mode', args.mode)}")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")
        sys.exit(1)


def cmd_run(args):
    """Start or stop walking."""
    running = args.state.lower() in ("true", "1", "yes", "on", "start")
    result = post("/api/run", {"run": running}, args.host, args.port)
    print_json(result, args.compact)


def cmd_stop(args):
    """Emergency stop."""
    result = post("/api/stop", {}, args.host, args.port)
    if result.get("stopped"):
        print("Robot stopped")
    else:
        print_json(result, args.compact)


def cmd_config(args):
    """Get full configuration."""
    result = get("/api/config", args.host, args.port)
    print_json(result, args.compact)


def cmd_set(args):
    """Set a configuration value."""
    # Try to parse value as number or bool
    value = args.value
    if value.lower() == "true":
        value = True
    elif value.lower() == "false":
        value = False
    else:
        try:
            value = float(value)
            if value.is_integer():
                value = int(value)
        except ValueError:
            pass  # Keep as string

    result = post("/api/config", {args.key: value}, args.host, args.port)
    if result.get("ok"):
        print(f"Set {args.key} = {value}")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")
        sys.exit(1)


def cmd_profiles(args):
    """List profiles."""
    result = get("/api/profiles", args.host, args.port)
    if "profiles" in result and not args.compact:
        current = result.get("current", "")
        print(f"Profiles (current: {current}):\n")
        for profile in result["profiles"]:
            marker = " *" if profile["name"] == current else ""
            default = " [default]" if profile.get("isDefault") else ""
            print(f"  {profile['name']}{marker}{default}")
            if profile.get("description"):
                print(f"    {profile['description']}")
    else:
        print_json(result, args.compact)


def cmd_gaits(args):
    """List gaits."""
    result = get("/api/gaits", args.host, args.port)
    if "gaits" in result and not args.compact:
        print("Available gaits:\n")
        for gait_id, gait in result["gaits"].items():
            enabled = "enabled" if gait.get("enabled", True) else "disabled"
            print(f"  {gait_id}: {gait.get('name', gait_id)} [{enabled}]")
            if gait.get("description"):
                print(f"    {gait['description']}")
    else:
        print_json(result, args.compact)


def cmd_create_pose(args):
    """Create a new pose."""
    data = {
        "action": "create",
        "name": args.name,
        "category": args.category,
        "height": args.height,
        "roll": args.roll,
        "pitch": args.pitch,
        "yaw": args.yaw,
        "leg_spread": args.leg_spread,
    }
    result = post("/api/poses", data, args.host, args.port)
    if result.get("ok"):
        print(f"Created pose: {result.get('pose_id', args.name)}")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")
        sys.exit(1)


def cmd_delete_pose(args):
    """Delete a pose."""
    result = post("/api/poses", {"action": "delete", "pose_id": args.pose_id}, args.host, args.port)
    if result.get("ok"):
        print(f"Deleted pose: {args.pose_id}")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")
        sys.exit(1)


def cmd_record_pose(args):
    """Record current position as a new pose."""
    data = {
        "action": "record",
        "name": args.name,
        "category": args.category,
    }
    result = post("/api/poses", data, args.host, args.port)
    if result.get("ok"):
        print(f"Recorded pose: {result.get('pose_id', args.name)}")
    else:
        print(f"Error: {result.get('error', 'Unknown error')}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(
        description="CLI tool for hexapod API",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s status                    Get current status
  %(prog)s sensors                   Get sensor readings
  %(prog)s poses                     List all poses
  %(prog)s pose low_stance           Get specific pose details
  %(prog)s apply low_stance          Apply a pose
  %(prog)s gait wave                 Set gait to wave
  %(prog)s run true                  Start walking
  %(prog)s run false                 Stop walking
  %(prog)s stop                      Emergency stop
  %(prog)s config                    Get full configuration
  %(prog)s set body_height 100       Set body height to 100mm
  %(prog)s profiles                  List configuration profiles
  %(prog)s gaits                     List available gaits
  %(prog)s create-pose "My Pose"     Create a new pose
  %(prog)s delete-pose my_pose       Delete a pose
  %(prog)s record-pose "Current"     Record current position as pose
"""
    )

    parser.add_argument("--host", "-H", default=DEFAULT_HOST, help=f"API host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", "-p", type=int, default=DEFAULT_PORT, help=f"API port (default: {DEFAULT_PORT})")
    parser.add_argument("--compact", "-c", action="store_true", help="Compact JSON output")

    subparsers = parser.add_subparsers(dest="command", help="Command to run")

    # Status
    sub = subparsers.add_parser("status", help="Get current status")
    sub.set_defaults(func=cmd_status)

    # Sensors
    sub = subparsers.add_parser("sensors", help="Get sensor readings")
    sub.set_defaults(func=cmd_sensors)

    # Poses
    sub = subparsers.add_parser("poses", help="List all poses")
    sub.set_defaults(func=cmd_poses)

    # Pose (single)
    sub = subparsers.add_parser("pose", help="Get specific pose")
    sub.add_argument("pose_id", help="Pose ID")
    sub.set_defaults(func=cmd_pose)

    # Apply pose
    sub = subparsers.add_parser("apply", help="Apply a pose")
    sub.add_argument("pose_id", help="Pose ID to apply")
    sub.set_defaults(func=cmd_apply)

    # Gait
    sub = subparsers.add_parser("gait", help="Set gait mode")
    sub.add_argument("mode", help="Gait mode (tripod, wave, ripple, creep)")
    sub.set_defaults(func=cmd_gait)

    # Run
    sub = subparsers.add_parser("run", help="Start/stop walking")
    sub.add_argument("state", help="true/false or on/off")
    sub.set_defaults(func=cmd_run)

    # Stop
    sub = subparsers.add_parser("stop", help="Emergency stop")
    sub.set_defaults(func=cmd_stop)

    # Config
    sub = subparsers.add_parser("config", help="Get full configuration")
    sub.set_defaults(func=cmd_config)

    # Set
    sub = subparsers.add_parser("set", help="Set a configuration value")
    sub.add_argument("key", help="Configuration key")
    sub.add_argument("value", help="Value to set")
    sub.set_defaults(func=cmd_set)

    # Profiles
    sub = subparsers.add_parser("profiles", help="List profiles")
    sub.set_defaults(func=cmd_profiles)

    # Gaits
    sub = subparsers.add_parser("gaits", help="List gaits")
    sub.set_defaults(func=cmd_gaits)

    # Create pose
    sub = subparsers.add_parser("create-pose", help="Create a new pose")
    sub.add_argument("name", help="Pose name")
    sub.add_argument("--category", "-cat", default="operation", help="Category (operation/rest/debug)")
    sub.add_argument("--height", type=float, default=120.0, help="Body height in mm")
    sub.add_argument("--roll", type=float, default=0.0, help="Roll angle in degrees")
    sub.add_argument("--pitch", type=float, default=0.0, help="Pitch angle in degrees")
    sub.add_argument("--yaw", type=float, default=0.0, help="Yaw angle in degrees")
    sub.add_argument("--leg-spread", type=float, default=100.0, dest="leg_spread", help="Leg spread percentage")
    sub.set_defaults(func=cmd_create_pose)

    # Delete pose
    sub = subparsers.add_parser("delete-pose", help="Delete a pose")
    sub.add_argument("pose_id", help="Pose ID to delete")
    sub.set_defaults(func=cmd_delete_pose)

    # Record pose
    sub = subparsers.add_parser("record-pose", help="Record current position as pose")
    sub.add_argument("name", help="Pose name")
    sub.add_argument("--category", "-cat", default="operation", help="Category (operation/rest/debug)")
    sub.set_defaults(func=cmd_record_pose)

    args = parser.parse_args()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    args.func(args)


if __name__ == "__main__":
    main()
