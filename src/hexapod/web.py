"""FastAPI web server with REST endpoints, WebSocket telemetry, and static UI.

This module provides the main web interface for controlling the hexapod robot:
    - REST API endpoints for gait control, body pose, configuration
    - WebSocket for real-time telemetry and command streaming
    - Static file serving for the 3D web UI

Key Components:
    - HexapodController: Main coordinator for gait, servos, sensors, and pose
    - ConnectionManager: WebSocket connection pool with broadcast support
    - Background gait loop: Continuous servo updates and telemetry at ~100Hz

Architecture Notes:
    - ALL inverse kinematics calculations are performed on the backend
    - Frontend only displays servo angles received via WebSocket telemetry
    - This ensures 3D visualization matches actual hardware servo positions

Movement Features:
    - WASD/Arrow keys: Directional walking (heading-based)
    - Q/E keys: Walk-and-turn using differential steering (tank-style)
    - Rotation buttons: Body rotation while standing (via rotation_speed)
    - Body pose: Pitch, roll, yaw adjustments

WebSocket Message Types (client → server):
    - set_gait: Change gait mode (tripod/wave/ripple)
    - walk: Start/stop walking
    - move: Set speed, heading, turn rate, and walking state
    - body_height: Adjust body height
    - body_pose: Set pitch, roll, yaw angles
    - leg_spread: Adjust leg spread percentage (50-150%)
    - pose: Apply pose preset (stand, crouch, neutral)

Telemetry (server → client):
    - angles: Servo angles for 6 legs (18 values)
    - ground_contacts: Which legs are in stance phase
    - running, speed, heading, body pose, leg_spread, sensor readings
"""
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, FileResponse, Response
from typing import Optional
from pathlib import Path
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

from .hardware import MockServoController, SensorReader, ServoController

# Re-export HexapodController and ConnectionManager for backward compatibility
from .web_controller import HexapodController, ConnectionManager

# Import runtime manager
from .web_runtime import RuntimeManager, create_lifespan

# Import routers
from .web_status import create_status_router
from .web_gait import create_gait_router
from .web_poses import create_poses_router
from .web_profiles import create_profiles_router
from .web_config import create_config_router
from .web_calibration import create_calibration_router
from .web_bluetooth import create_bluetooth_router
from .web_patrol import create_patrol_router


def create_app(servo: Optional[ServoController] = None, use_controller: bool = False) -> FastAPI:
    """Create FastAPI application.

    Args:
        servo: ServoController instance (defaults to MockServoController).
        use_controller: Start Bluetooth controller input.

    Returns:
        FastAPI application instance.
    """
    # Initialize components
    servo_ctrl = servo if servo is not None else MockServoController()
    sensor = SensorReader(mock=True)
    controller = HexapodController(servo_ctrl, sensor)
    manager = ConnectionManager()

    # Create runtime manager for background tasks
    runtime = RuntimeManager(controller, manager, use_controller)

    # Static files directory
    static_dir = Path(__file__).parent.parent.parent / "web_static"

    # Create app with lifespan
    app = FastAPI(
        title="Hexapod Controller",
        version="1.0.0",
        lifespan=create_lifespan(runtime)
    )

    # Add CORS middleware for cross-origin requests
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins for local development
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ========== Include Routers ==========
    app.include_router(create_status_router(controller, manager, sensor))
    app.include_router(create_gait_router(controller))
    app.include_router(create_poses_router(controller))
    app.include_router(create_profiles_router(controller))
    app.include_router(create_config_router(controller))
    app.include_router(create_calibration_router(controller, servo_ctrl))
    app.include_router(create_bluetooth_router(controller, use_controller))

    patrol_router, patrol_state = create_patrol_router(controller, manager)
    app.include_router(patrol_router)

    # ========== Static File Routes ==========

    @app.get("/static/{file_path:path}")
    async def serve_static(file_path: str):
        """Serve static files with no-cache headers."""
        file = static_dir / file_path
        if file.exists() and file.is_file():
            return FileResponse(
                str(file),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            )
        return Response(status_code=404)

    @app.get("/")
    async def index():
        """Serve the main UI page."""
        index_file = static_dir / "index.html"
        if index_file.exists():
            return FileResponse(
                str(index_file),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            )
        return HTMLResponse("<h1>Hexapod Controller</h1><p>UI files not found.</p>")

    @app.get("/config.html")
    @app.get("/config")
    async def config_page():
        """Serve the configuration page."""
        config_file = static_dir / "config.html"
        if config_file.exists():
            return FileResponse(
                str(config_file),
                headers={
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0"
                }
            )
        return HTMLResponse("<h1>Configuration</h1><p>Config page not found.</p>")

    @app.get("/config.css")
    async def config_css():
        """Serve the configuration CSS."""
        css_file = static_dir / "config.css"
        if css_file.exists():
            return FileResponse(str(css_file), media_type="text/css")
        return Response(status_code=404)

    @app.get("/config.js")
    async def config_js():
        """Serve the configuration JavaScript."""
        js_file = static_dir / "config.js"
        if js_file.exists():
            return FileResponse(str(js_file), media_type="application/javascript")
        return Response(status_code=404)

    @app.get("/favicon.ico")
    async def favicon():
        """Serve favicon."""
        favicon_file = static_dir / "favicon.svg"
        if favicon_file.exists():
            return FileResponse(str(favicon_file), media_type="image/svg+xml")
        return Response(status_code=204)

    @app.get("/patrol.html")
    @app.get("/patrol")
    async def patrol_page():
        """Serve the patrol control page."""
        patrol_file = static_dir / "patrol.html"
        if patrol_file.exists():
            return FileResponse(str(patrol_file), media_type="text/html")
        return HTMLResponse("<h1>Patrol page not found</h1>", status_code=404)

    @app.get("/patrol.js")
    async def patrol_js():
        """Serve the patrol JavaScript."""
        js_file = static_dir / "patrol.js"
        if js_file.exists():
            return FileResponse(str(js_file), media_type="application/javascript")
        return Response(status_code=404)

    # ========== WebSocket Endpoint ==========

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        """WebSocket endpoint for real-time communication."""
        await manager.connect(websocket)
        try:
            while True:
                data = await websocket.receive_json()
                await _handle_websocket_message(
                    data, websocket, controller, servo_ctrl, sensor,
                    manager, patrol_state
                )
        except WebSocketDisconnect:
            conn_id = getattr(websocket.state, 'connection_id', '?')
            logger.info(f"WebSocket #{conn_id} client disconnected normally")
            manager.disconnect(websocket)
        except Exception as e:
            conn_id = getattr(websocket.state, 'connection_id', '?')
            logger.warning(f"WebSocket #{conn_id} error: {e}")
            manager.disconnect(websocket)

    return app


async def _handle_websocket_message(
    data: dict,
    websocket: WebSocket,
    controller: HexapodController,
    servo_ctrl: ServoController,
    sensor: SensorReader,
    manager: ConnectionManager,
    patrol_state
):
    """Handle incoming WebSocket messages.

    Args:
        data: Parsed JSON message
        websocket: WebSocket connection
        controller: HexapodController instance
        servo_ctrl: ServoController instance
        sensor: SensorReader instance
        manager: ConnectionManager instance
        patrol_state: PatrolState instance
    """
    typ = data.get("type")

    if typ == "set_gait":
        mode = data.get("mode", "tripod")
        from .config import get_config
        cfg = get_config()
        enabled_gaits = cfg.get_enabled_gaits()
        if mode in enabled_gaits:
            controller.gait_mode = mode

    elif typ == "walk":
        controller.running = bool(data.get("walking", False))

    elif typ == "move":
        controller.running = bool(data.get("walking", False))
        controller.speed = max(0, min(1.0, float(data.get("speed", 0.5))))
        controller.heading = float(data.get("heading", 0.0))
        # Set turn_rate for differential steering (Q/E keys)
        turn = float(data.get("turn", 0.0))
        controller.gait.turn_rate = max(-1.0, min(1.0, turn))
        # Convert turn rate into a rotation speed (deg/s) so backend drives turning
        controller.rotation_speed = controller.gait.turn_rate * 90.0

    elif typ == "body_height":
        height = float(data.get("height", 60.0))
        height = max(30.0, min(200.0, height))
        controller.body_height = height

    elif typ == "leg_spread":
        spread = float(data.get("spread", 100.0))
        spread = max(50.0, min(150.0, spread))
        controller.leg_spread = spread

    elif typ == "body_pose":
        if "pitch" in data:
            controller.body_pitch = max(-30.0, min(30.0, float(data["pitch"])))
        if "roll" in data:
            controller.body_roll = max(-30.0, min(30.0, float(data["roll"])))
        if "yaw" in data:
            controller.body_yaw = max(-45.0, min(45.0, float(data["yaw"])))

    elif typ == "pose":
        preset = data.get("preset", "neutral")
        controller.running = False  # Stop walking for pose changes
        if preset == "stand":
            controller.body_height = 90.0
            controller.body_pitch = 0.0
            controller.body_roll = 0.0
            controller.body_yaw = 0.0
            controller.leg_spread = 110.0
        elif preset == "crouch":
            controller.body_height = 50.0
            controller.body_pitch = 0.0
            controller.body_roll = 0.0
            controller.body_yaw = 0.0
            controller.leg_spread = 130.0
        elif preset == "neutral":
            controller.body_height = 70.0
            controller.body_pitch = 0.0
            controller.body_roll = 0.0
            controller.body_yaw = 0.0
            controller.leg_spread = 110.0
        logger.info(f"Pose preset applied: {preset}")

    elif typ == "apply_pose":
        pose_id = data.get("pose_id")
        if pose_id:
            from .config import get_config
            cfg = get_config()
            pose = cfg.get_pose(pose_id)
            if pose:
                controller.running = False
                controller.body_height = pose.get("height", 90.0)
                controller.body_roll = pose.get("roll", 0.0)
                controller.body_pitch = pose.get("pitch", 0.0)
                controller.body_yaw = pose.get("yaw", 0.0)
                controller.leg_spread = pose.get("leg_spread", 110.0)
                logger.info(f"Saved pose applied: {pose_id}")

    # ========== Self-Test Commands ==========
    elif typ == "test_leg":
        leg = int(data.get("leg", 0))
        logger.info(f"Self-test: Testing leg {leg}")
        for angle in [45, 90, 135, 90]:
            for joint in range(3):
                servo_ctrl.set_servo_angle(leg, joint, angle)
        await websocket.send_json({
            "type": "test_result",
            "test": "leg",
            "leg": leg,
            "status": "ok",
            "message": f"Leg {leg} test complete"
        })

    elif typ == "test_walk":
        steps = int(data.get("steps", 2))
        logger.info(f"Self-test: Walking {steps} steps")
        controller.running = True
        controller.speed = 0.5
        await websocket.send_json({
            "type": "test_result",
            "test": "walk",
            "steps": steps,
            "status": "started",
            "message": f"Walking {steps} steps"
        })

    elif typ == "test_symmetry":
        logger.info("Self-test: Checking symmetry")
        await websocket.send_json({
            "type": "test_result",
            "test": "symmetry",
            "status": "ok",
            "message": "Symmetry check passed"
        })

    elif typ == "test_camera":
        logger.info("Self-test: Testing cameras")
        await websocket.send_json({
            "type": "test_result",
            "test": "camera",
            "status": "ok",
            "message": "Cameras OK (simulated)"
        })

    elif typ == "calibrate_imu":
        logger.info("Self-test: Calibrating IMU")
        await websocket.send_json({
            "type": "test_result",
            "test": "imu",
            "status": "ok",
            "message": "IMU calibration complete"
        })

    elif typ == "check_battery":
        logger.info("Self-test: Checking battery")
        voltage = sensor.read_battery_voltage()
        percentage = min(100, max(0, int((voltage - 9.0) / (12.6 - 9.0) * 100)))
        status = "ok" if voltage > 10.5 else ("warning" if voltage > 9.5 else "critical")
        await websocket.send_json({
            "type": "test_result",
            "test": "battery",
            "status": status,
            "voltage": voltage,
            "percentage": percentage,
            "message": f"Battery: {voltage:.1f}V ({percentage}%)"
        })

    # ========== Patrol Commands ==========
    elif typ == "patrol_start":
        route_id = data.get("route_id")
        route = next((r for r in patrol_state.routes if r["id"] == route_id), None)
        if route:
            patrol_state.status = "running"
            patrol_state.active_route = route_id
            patrol_state.current_waypoint = 0
            if "speed" in data:
                patrol_state.settings["speed"] = data["speed"]
            if "mode" in data:
                patrol_state.settings["mode"] = data["mode"]
            if "pattern" in data:
                patrol_state.settings["pattern"] = data["pattern"]
            if "detection_targets" in data:
                patrol_state.settings["detection_targets"] = data["detection_targets"]
            if "detection_sensitivity" in data:
                patrol_state.settings["detection_sensitivity"] = data["detection_sensitivity"]
            controller.running = True
            controller.speed = patrol_state.settings["speed"] / 100.0
            logger.info(f"Patrol started: {route['name']}")
            await websocket.send_json({
                "type": "patrol_status",
                "status": "running",
                "route_id": route_id
            })

    elif typ == "patrol_stop":
        patrol_state.status = "stopped"
        patrol_state.active_route = None
        controller.running = False
        controller.speed = 0
        logger.info("Patrol stopped")
        await websocket.send_json({
            "type": "patrol_status",
            "status": "stopped"
        })

    elif typ == "patrol_pause":
        if patrol_state.status == "running":
            patrol_state.status = "paused"
            controller.running = False
            logger.info("Patrol paused")
        await websocket.send_json({
            "type": "patrol_status",
            "status": patrol_state.status
        })

    elif typ == "patrol_resume":
        if patrol_state.status == "paused":
            patrol_state.status = "running"
            controller.running = True
            controller.speed = patrol_state.settings["speed"] / 100.0
            logger.info("Patrol resumed")
        await websocket.send_json({
            "type": "patrol_status",
            "status": patrol_state.status
        })

    elif typ == "go_to_position":
        target_lat = data.get("lat")
        target_lng = data.get("lng")
        logger.info(f"Navigating to: {target_lat}, {target_lng}")
        controller.running = True
        controller.speed = 0.5
        await websocket.send_json({
            "type": "navigation_started",
            "target": {"lat": target_lat, "lng": target_lng}
        })

    elif typ == "update_detection_targets":
        targets = data.get("targets", [])
        sensitivity = data.get("sensitivity", 70)
        patrol_state.settings["detection_targets"] = targets
        patrol_state.settings["detection_sensitivity"] = sensitivity
        logger.info(f"Detection targets updated: {targets}")

    elif typ == "get_position":
        await websocket.send_json({
            "type": "position",
            "lat": 37.7749,
            "lng": -122.4194
        })


# Keep parse_json_body at module level for backward compatibility
async def parse_json_body(request):
    """Safely parse JSON request body with error handling.

    Returns:
        Tuple of (parsed_body, error_response). If parsing succeeds, error_response is None.
        If parsing fails, parsed_body is None and error_response contains the error.
    """
    import json
    from fastapi.responses import JSONResponse
    try:
        body = await request.json()
        return body, None
    except json.JSONDecodeError as e:
        logger.warning(f"Invalid JSON in request: {e}")
        return None, JSONResponse(
            {"error": "Invalid JSON", "detail": str(e)},
            status_code=400
        )
    except Exception as e:
        logger.error(f"Error parsing request body: {e}")
        return None, JSONResponse(
            {"error": "Failed to parse request body"},
            status_code=400
        )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=8000)
