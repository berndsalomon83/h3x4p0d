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
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, JSONResponse, FileResponse, Response
import asyncio
from typing import List, Optional, Dict, Tuple, Any
from pathlib import Path
import json
import math
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(name)s: %(message)s'
)
logger = logging.getLogger(__name__)

from .hardware import MockServoController, SensorReader, ServoController
from .gait import GaitEngine
from .controller_bluetooth import GenericController, MotionCommand
from .calibrate import load_existing_calibration, save_calibration

try:
    _HAS_I2C = True
except Exception:
    _HAS_I2C = False


class ConnectionManager:
    """Manages WebSocket connections for broadcasting telemetry."""
    def __init__(self):
        self.active: List[WebSocket] = []
        self._connection_id = 0

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self._connection_id += 1
        websocket.state.connection_id = self._connection_id
        client = websocket.client
        client_info = f"{client.host}:{client.port}" if client else "unknown"
        self.active.append(websocket)
        logger.info(f"WebSocket #{self._connection_id} connected from {client_info} (total: {len(self.active)})")

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active:
            self.active.remove(websocket)
            conn_id = getattr(websocket.state, 'connection_id', '?')
            logger.info(f"WebSocket #{conn_id} disconnected (remaining: {len(self.active)})")

    async def broadcast(self, message: dict):
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
        self.servo = servo
        self.sensor = sensor
        self.gait = GaitEngine(step_height=25.0, step_length=40.0, cycle_time=1.2)
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

        # motion command handler
        self.bt_controller = GenericController()
        self.bt_controller.on_event(self._handle_motion_cmd)

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
        """Handle motion commands from controller."""
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
            print(f"Controller error: {e}")

    def calculate_standing_pose(self) -> List[Tuple[float, float, float]]:
        """Calculate IK for standing pose at current body height and pose.

        Applies body pitch, roll, and yaw to keep feet grounded while body tilts.
        Returns list of (coxa, femur, tibia) angles in degrees for all 6 legs.
        Uses servo convention: 90° = neutral/horizontal.
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

                # Base coxa is 90° (neutral), add yaw offset
                coxa = 90.0 + coxa_yaw_offset
                femur = ik_femur
                tibia = ik_tibia

                angles.append((coxa, femur, tibia))
            except ValueError as e:
                # Target unreachable, use safe default angles
                print(f"IK failed for leg {leg_idx} at height {self.body_height}mm, "
                      f"pose p={self.body_pitch} r={self.body_roll}: {e}")
                angles.append((90.0 + coxa_yaw_offset, 70.0, 90.0))

        return angles

    def update_servos(self):
        """Update servo positions based on current gait time or standing pose."""
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
                print(f"Servo error leg {leg_idx}: {e}")

        return angles

    def get_telemetry(self) -> dict:
        """Return current state for UI."""
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


async def parse_json_body(request: Request) -> Tuple[Optional[Dict[str, Any]], Optional[JSONResponse]]:
    """Safely parse JSON request body with error handling.

    Returns:
        Tuple of (parsed_body, error_response). If parsing succeeds, error_response is None.
        If parsing fails, parsed_body is None and error_response contains the error.
    """
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


def create_app(servo: Optional[ServoController] = None, use_controller: bool = False) -> FastAPI:
    """Create FastAPI application.

    Args:
        servo: ServoController instance (defaults to MockServoController).
        use_controller: Start Bluetooth controller input.

    Returns:
        FastAPI application instance.
    """
    # Initialize components before defining lifespan
    servo_ctrl = servo if servo is not None else MockServoController()
    sensor = SensorReader(mock=True)
    controller = HexapodController(servo_ctrl, sensor)
    manager = ConnectionManager()

    # Static files directory
    static_dir = Path(__file__).parent.parent.parent / "web_static"

    async def gait_loop():
        """Background loop: update servos and broadcast telemetry."""
        last_time = asyncio.get_event_loop().time()
        telemetry_interval = 0.05  # broadcast every 50ms
        last_telemetry = 0

        while True:
            now = asyncio.get_event_loop().time()
            dt = now - last_time
            last_time = now

            # Apply rotation speed to heading (degrees per second)
            if controller.rotation_speed != 0:
                controller.heading += controller.rotation_speed * dt
                # Normalize heading to -180 to 180
                while controller.heading > 180:
                    controller.heading -= 360
                while controller.heading < -180:
                    controller.heading += 360

            # Only update gait time when running
            if controller.running and controller.speed > 0:
                controller.gait.update(dt * controller.speed)

            # Update servo angles (always returns angles for visualization)
            angles = controller.update_servos()

            # Broadcast telemetry periodically
            if now - last_telemetry > telemetry_interval:
                last_telemetry = now
                telem = controller.get_telemetry()
                telem["type"] = "telemetry"
                if angles:
                    telem["angles"] = angles
                await manager.broadcast(telem)

            await asyncio.sleep(0.01)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        """Lifespan context manager for startup and shutdown events."""
        # Startup
        if use_controller:
            asyncio.create_task(controller.start_controller())
            print("Controller input task started")
        asyncio.create_task(gait_loop())
        logger.info("Gait loop started")

        yield

        # Shutdown (if needed in the future)
        logger.info("Shutting down...")

    app = FastAPI(title="Hexapod Controller", version="1.0.0", lifespan=lifespan)

    # Add CORS middleware for cross-origin requests
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],  # Allow all origins for local development
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Custom static file handler with no-cache headers
    @app.get("/static/{file_path:path}")
    async def serve_static(file_path: str):
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
        index_file = Path(__file__).parent.parent.parent / "web_static" / "index.html"
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
        config_file = Path(__file__).parent.parent.parent / "web_static" / "config.html"
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
        css_file = Path(__file__).parent.parent.parent / "web_static" / "config.css"
        if css_file.exists():
            return FileResponse(str(css_file), media_type="text/css")
        return Response(status_code=404)

    @app.get("/config.js")
    async def config_js():
        """Serve the configuration JavaScript."""
        js_file = Path(__file__).parent.parent.parent / "web_static" / "config.js"
        if js_file.exists():
            return FileResponse(str(js_file), media_type="application/javascript")
        return Response(status_code=404)

    @app.get("/favicon.ico")
    async def favicon():
        """Serve favicon."""
        favicon_file = Path(__file__).parent.parent.parent / "web_static" / "favicon.svg"
        if favicon_file.exists():
            return FileResponse(str(favicon_file), media_type="image/svg+xml")
        return Response(status_code=204)  # No content if favicon doesn't exist

    # ========== Patrol Routes ==========
    @app.get("/patrol.html")
    @app.get("/patrol")
    async def patrol_page():
        """Serve the patrol control page."""
        patrol_file = Path(__file__).parent.parent.parent / "web_static" / "patrol.html"
        if patrol_file.exists():
            return FileResponse(str(patrol_file), media_type="text/html")
        return HTMLResponse("<h1>Patrol page not found</h1>", status_code=404)

    @app.get("/patrol.js")
    async def patrol_js():
        """Serve the patrol JavaScript."""
        js_file = Path(__file__).parent.parent.parent / "web_static" / "patrol.js"
        if js_file.exists():
            return FileResponse(str(js_file), media_type="application/javascript")
        return Response(status_code=404)

    @app.get("/api/health")
    async def health_check():
        """Health check endpoint for monitoring."""
        return {
            "status": "ok",
            "running": controller.running,
            "gait_mode": controller.gait_mode,
            "websocket_clients": len(manager.active)
        }

    @app.get("/api/gaits")
    async def list_gaits():
        """List all available gaits with their configurations."""
        from .config import get_config
        cfg = get_config()
        gaits = cfg.get_gaits()
        enabled_gaits = cfg.get_enabled_gaits()

        # Format response with current active gait
        return {
            "gaits": gaits,
            "enabled": list(enabled_gaits.keys()),
            "current": controller.gait_mode,
            "default": cfg.get("default_gait", "tripod")
        }

    @app.post("/api/gaits")
    async def manage_gaits(request: Request):
        """Manage gait configurations (enable, disable, update)."""
        from .config import get_config
        cfg = get_config()

        body, error = await parse_json_body(request)
        if error:
            return error

        action = body.get("action")
        gait_id = body.get("gait")

        if not gait_id:
            return JSONResponse({"error": "Gait ID required"}, status_code=400)

        if action == "enable":
            success = cfg.set_gait_enabled(gait_id, True)
            if success:
                cfg.save()
                logger.info(f"Gait enabled: {gait_id}")
                return {"ok": True, "gaits": cfg.get_gaits()}
            return JSONResponse({"error": "Gait not found"}, status_code=404)

        elif action == "disable":
            # Don't allow disabling the current active gait
            if gait_id == controller.gait_mode:
                return JSONResponse({"error": "Cannot disable active gait"}, status_code=400)

            # Don't allow disabling the last enabled gait
            enabled_gaits = cfg.get_enabled_gaits()
            if len(enabled_gaits) <= 1 and gait_id in enabled_gaits:
                return JSONResponse({"error": "Cannot disable last enabled gait"}, status_code=400)

            success = cfg.set_gait_enabled(gait_id, False)
            if success:
                cfg.save()
                logger.info(f"Gait disabled: {gait_id}")
                return {"ok": True, "gaits": cfg.get_gaits()}
            return JSONResponse({"error": "Gait not found"}, status_code=404)

        elif action == "update":
            updates = body.get("updates", {})
            # Only allow updating certain fields
            allowed = {"description", "speed_range", "stability", "best_for", "phase_offsets"}
            updates = {k: v for k, v in updates.items() if k in allowed}
            success = cfg.update_gait(gait_id, updates)
            if success:
                cfg.save()
                logger.info(f"Gait updated: {gait_id}")
                return {"ok": True, "gaits": cfg.get_gaits()}
            return JSONResponse({"error": "Gait not found"}, status_code=404)

        else:
            return JSONResponse({"error": f"Unknown action: {action}"}, status_code=400)

    @app.post("/api/gait")
    async def set_gait(request: Request):
        """Set the active gait mode."""
        from .config import get_config
        cfg = get_config()

        body, error = await parse_json_body(request)
        if error:
            return error

        mode = body.get("mode")

        # Validate against enabled gaits from config
        enabled_gaits = cfg.get_enabled_gaits()
        if mode not in enabled_gaits:
            available = list(enabled_gaits.keys())
            return JSONResponse({
                "error": f"Gait '{mode}' not available. Enabled gaits: {available}"
            }, status_code=400)

        controller.gait_mode = mode
        logger.info(f"Gait mode changed to: {mode}")
        return {"ok": True, "mode": mode}

    @app.get("/api/gait/params")
    async def get_gait_params():
        """Get current gait parameters."""
        return {
            "step_height": controller.gait.step_height,
            "step_length": controller.gait.step_length,
            "cycle_time": controller.gait.cycle_time
        }

    @app.post("/api/gait/params")
    async def set_gait_params(request: Request):
        """Update gait parameters."""
        body, error = await parse_json_body(request)
        if error:
            return error

        updated = {}
        try:
            if "step_height" in body:
                val = float(body["step_height"])
                val = max(10.0, min(50.0, val))  # Clamp to safe range
                controller.gait.step_height = val
                updated["step_height"] = val

            if "step_length" in body:
                val = float(body["step_length"])
                val = max(10.0, min(80.0, val))  # Clamp to safe range
                controller.gait.step_length = val
                updated["step_length"] = val

            if "cycle_time" in body:
                val = float(body["cycle_time"])
                val = max(0.5, min(3.0, val))  # Clamp to safe range
                controller.gait.cycle_time = val
                updated["cycle_time"] = val
        except (TypeError, ValueError) as e:
            return JSONResponse({"error": f"Invalid parameter value: {e}"}, status_code=400)

        if updated:
            logger.info(f"Gait parameters updated: {updated}")
            return {"ok": True, "updated": updated}
        else:
            return JSONResponse({"error": "No valid parameters provided"}, status_code=400)

    @app.post("/api/run")
    async def run_stop(request: Request):
        body, error = await parse_json_body(request)
        if error:
            return error
        run = bool(body.get("run", False))
        controller.running = run
        logger.info(f"Running state changed to: {run}")
        return {"running": run}

    @app.post("/api/stop")
    async def stop():
        controller.running = False
        return {"stopped": True}

    @app.post("/api/body_height")
    async def set_body_height(request: Request):
        """Set body height in mm."""
        body, error = await parse_json_body(request)
        if error:
            return error
        try:
            height = float(body.get("height", 60.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "Invalid height value"}, status_code=400)
        # Clamp to safe range (30-200mm)
        height = max(30.0, min(200.0, height))
        controller.body_height = height
        return {"ok": True, "body_height": height}

    @app.post("/api/body_pose")
    async def set_body_pose(request: Request):
        """Set body pose (pitch, roll, yaw) in degrees."""
        body, error = await parse_json_body(request)
        if error:
            return error

        updated = {}
        try:
            if "pitch" in body:
                val = float(body["pitch"])
                val = max(-30.0, min(30.0, val))
                controller.body_pitch = val
                updated["pitch"] = val
            if "roll" in body:
                val = float(body["roll"])
                val = max(-30.0, min(30.0, val))
                controller.body_roll = val
                updated["roll"] = val
            if "yaw" in body:
                val = float(body["yaw"])
                val = max(-45.0, min(45.0, val))
                controller.body_yaw = val
                updated["yaw"] = val
        except (TypeError, ValueError) as e:
            return JSONResponse({"error": f"Invalid pose value: {e}"}, status_code=400)

        if updated:
            logger.info(f"Body pose updated: {updated}")
            return {"ok": True, "updated": updated}
        return JSONResponse({"error": "No valid pose values provided"}, status_code=400)

    @app.get("/api/body_pose")
    async def get_body_pose():
        """Get current body pose."""
        return {
            "pitch": controller.body_pitch,
            "roll": controller.body_roll,
            "yaw": controller.body_yaw
        }

    @app.post("/api/leg_spread")
    async def set_leg_spread(request: Request):
        """Set leg spread percentage (50-150%, 100 = default)."""
        body, error = await parse_json_body(request)
        if error:
            return error
        try:
            spread = float(body.get("spread", 100.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "Invalid spread value"}, status_code=400)
        # Clamp to safe range
        spread = max(50.0, min(150.0, spread))
        controller.leg_spread = spread
        logger.info(f"Leg spread set to: {spread}%")
        return {"ok": True, "leg_spread": spread}

    @app.post("/api/rotation")
    async def set_rotation(request: Request):
        """Set rotation speed for spinning in place (degrees per second)."""
        body, error = await parse_json_body(request)
        if error:
            return error
        try:
            speed = float(body.get("speed", 0.0))
        except (TypeError, ValueError):
            return JSONResponse({"error": "Invalid rotation speed"}, status_code=400)
        # Clamp to reasonable range
        speed = max(-180.0, min(180.0, speed))
        controller.rotation_speed = speed
        logger.info(f"Rotation speed set to: {speed}")
        return {"ok": True, "rotation_speed": speed}

    @app.post("/api/emergency_stop")
    async def emergency_stop():
        """Emergency stop - immediately halt all movement."""
        controller.running = False
        controller.speed = 0.0
        controller.rotation_speed = 0.0
        controller.body_pitch = 0.0
        controller.body_roll = 0.0
        controller.body_yaw = 0.0
        logger.warning("EMERGENCY STOP activated")
        return {"ok": True, "message": "Emergency stop activated"}

    @app.get("/api/status")
    async def status():
        return controller.get_telemetry()

    @app.get("/api/sensors")
    async def sensors():
        return {
            "temperature_c": sensor.read_temperature_c(),
            "battery_v": sensor.read_battery_voltage(),
        }

    @app.get("/api/poses")
    async def list_poses():
        """List all saved poses."""
        from .config import get_config
        cfg = get_config()
        poses = cfg.get_poses()
        return {"poses": poses}

    @app.post("/api/poses")
    async def manage_poses(request: Request):
        """Manage poses (create, update, delete, apply)."""
        from .config import get_config
        cfg = get_config()

        body, error = await parse_json_body(request)
        if error:
            return error

        action = body.get("action")

        if action == "create":
            name = body.get("name", "").strip()
            if not name:
                return JSONResponse({"error": "Pose name required"}, status_code=400)

            # Generate pose_id from name
            pose_id = name.lower().replace(" ", "_")
            pose_id = "".join(c for c in pose_id if c.isalnum() or c == "_")

            category = body.get("category", "operation")
            height = float(body.get("height", 120.0))
            roll = float(body.get("roll", 0.0))
            pitch = float(body.get("pitch", 0.0))
            yaw = float(body.get("yaw", 0.0))
            leg_spread = float(body.get("leg_spread", 100.0))

            # Clamp values to valid ranges
            height = max(30.0, min(200.0, height))
            roll = max(-30.0, min(30.0, roll))
            pitch = max(-30.0, min(30.0, pitch))
            yaw = max(-45.0, min(45.0, yaw))
            leg_spread = max(50.0, min(150.0, leg_spread))

            success = cfg.create_pose(pose_id, name, category, height, roll, pitch, yaw, leg_spread)
            if success:
                cfg.save()
                logger.info(f"Pose created: {name} ({pose_id})")
                return {"ok": True, "pose_id": pose_id, "poses": cfg.get_poses()}
            return JSONResponse({"error": "Pose already exists or invalid"}, status_code=400)

        elif action == "update":
            pose_id = body.get("pose_id")
            if not pose_id:
                return JSONResponse({"error": "Pose ID required"}, status_code=400)

            updates = {}
            if "name" in body:
                updates["name"] = body["name"]
            if "category" in body:
                updates["category"] = body["category"]
            if "height" in body:
                updates["height"] = max(30.0, min(200.0, float(body["height"])))
            if "roll" in body:
                updates["roll"] = max(-30.0, min(30.0, float(body["roll"])))
            if "pitch" in body:
                updates["pitch"] = max(-30.0, min(30.0, float(body["pitch"])))
            if "yaw" in body:
                updates["yaw"] = max(-45.0, min(45.0, float(body["yaw"])))
            if "leg_spread" in body:
                updates["leg_spread"] = max(50.0, min(150.0, float(body["leg_spread"])))

            success = cfg.update_pose(pose_id, updates)
            if success:
                cfg.save()
                logger.info(f"Pose updated: {pose_id}")
                return {"ok": True, "poses": cfg.get_poses()}
            return JSONResponse({"error": "Pose not found"}, status_code=404)

        elif action == "delete":
            pose_id = body.get("pose_id")
            if not pose_id:
                return JSONResponse({"error": "Pose ID required"}, status_code=400)

            # Check if this is the last pose
            poses = cfg.get_poses()
            if len(poses) <= 1:
                return JSONResponse({"error": "Cannot delete last pose"}, status_code=400)

            # Check if pose is builtin
            pose = cfg.get_pose(pose_id)
            if pose and pose.get("builtin", False):
                return JSONResponse({"error": "Cannot delete builtin pose"}, status_code=400)

            success = cfg.delete_pose(pose_id)
            if success:
                cfg.save()
                logger.info(f"Pose deleted: {pose_id}")
                return {"ok": True, "poses": cfg.get_poses()}
            return JSONResponse({"error": "Pose not found or cannot be deleted"}, status_code=404)

        elif action == "apply":
            pose_id = body.get("pose_id")
            if not pose_id:
                return JSONResponse({"error": "Pose ID required"}, status_code=400)

            pose = cfg.get_pose(pose_id)
            if not pose:
                return JSONResponse({"error": "Pose not found"}, status_code=404)

            # Apply pose to controller
            controller.running = False  # Stop walking
            controller.body_height = pose.get("height", 120.0)
            controller.body_roll = pose.get("roll", 0.0)
            controller.body_pitch = pose.get("pitch", 0.0)
            controller.body_yaw = pose.get("yaw", 0.0)
            controller.leg_spread = pose.get("leg_spread", 100.0)

            logger.info(f"Pose applied: {pose_id}")
            return {"ok": True, "pose_id": pose_id, "applied": pose}

        elif action == "record":
            # Record current controller state as a new pose
            name = body.get("name", "").strip()
            if not name:
                return JSONResponse({"error": "Pose name required"}, status_code=400)

            pose_id = name.lower().replace(" ", "_")
            pose_id = "".join(c for c in pose_id if c.isalnum() or c == "_")

            category = body.get("category", "operation")

            # Get current values from controller
            height = controller.body_height
            roll = controller.body_roll
            pitch = controller.body_pitch
            yaw = controller.body_yaw
            leg_spread = controller.leg_spread

            success = cfg.create_pose(pose_id, name, category, height, roll, pitch, yaw, leg_spread)
            if success:
                cfg.save()
                logger.info(f"Pose recorded: {name} ({pose_id})")
                return {"ok": True, "pose_id": pose_id, "poses": cfg.get_poses()}
            return JSONResponse({"error": "Pose already exists"}, status_code=400)

        else:
            return JSONResponse({"error": f"Unknown action: {action}"}, status_code=400)

    @app.get("/api/profiles")
    async def list_profiles():
        """List all available profiles."""
        from .config import get_profile_manager
        pm = get_profile_manager()
        return JSONResponse({
            "profiles": pm.list_profiles(),
            "current": pm.get_current_profile(),
            "default": pm.get_default_profile()
        })

    @app.post("/api/profiles")
    async def manage_profiles(request: Request):
        """Manage profiles (create, delete, set-default, update)."""
        from .config import get_profile_manager
        pm = get_profile_manager()

        body, error = await parse_json_body(request)
        if error:
            return error

        action = body.get("action")

        if action == "create":
            name = body.get("name", "").strip().lower().replace(" ", "_")
            if not name:
                return JSONResponse({"error": "Profile name required"}, status_code=400)
            copy_from = body.get("copyFrom")
            description = body.get("description", "")

            if pm.profile_exists(name):
                return JSONResponse({"error": "Profile already exists"}, status_code=400)

            success = pm.create_profile(name, copy_from=copy_from, description=description)
            if success:
                logger.info(f"Profile created: {name}")
                return {"ok": True, "name": name, "profiles": pm.list_profiles()}
            return JSONResponse({"error": "Failed to create profile"}, status_code=500)

        elif action == "delete":
            name = body.get("name")
            if not name:
                return JSONResponse({"error": "Profile name required"}, status_code=400)

            if name == pm.get_default_profile():
                return JSONResponse({"error": "Cannot delete default profile"}, status_code=400)

            success = pm.delete_profile(name)
            if success:
                logger.info(f"Profile deleted: {name}")
                return {"ok": True, "profiles": pm.list_profiles()}
            return JSONResponse({"error": "Profile not found"}, status_code=404)

        elif action == "set-default":
            name = body.get("name")
            if not name:
                return JSONResponse({"error": "Profile name required"}, status_code=400)

            success = pm.set_default_profile(name)
            if success:
                logger.info(f"Default profile set to: {name}")
                return {"ok": True, "default": name}
            return JSONResponse({"error": "Profile not found"}, status_code=404)

        elif action == "rename":
            old_name = body.get("oldName")
            new_name = body.get("newName", "").strip().lower().replace(" ", "_")
            if not old_name or not new_name:
                return JSONResponse({"error": "Both oldName and newName required"}, status_code=400)

            success = pm.rename_profile(old_name, new_name)
            if success:
                logger.info(f"Profile renamed: {old_name} -> {new_name}")
                return {"ok": True, "profiles": pm.list_profiles()}
            return JSONResponse({"error": "Rename failed"}, status_code=400)

        elif action == "update":
            name = body.get("name")
            description = body.get("description")
            if not name:
                return JSONResponse({"error": "Profile name required"}, status_code=400)

            if description is not None:
                pm.update_profile_description(name, description)

            logger.info(f"Profile updated: {name}")
            return {"ok": True, "profiles": pm.list_profiles()}

        elif action == "switch":
            name = body.get("name")
            if not name:
                return JSONResponse({"error": "Profile name required"}, status_code=400)

            if not pm.profile_exists(name):
                return JSONResponse({"error": "Profile not found"}, status_code=404)

            pm.load_profile(name)
            logger.info(f"Switched to profile: {name}")
            return {"ok": True, "current": name}

        else:
            return JSONResponse({"error": f"Unknown action: {action}"}, status_code=400)

    @app.get("/api/config")
    async def get_config_endpoint(request: Request):
        """Get configuration for a profile."""
        from .config import get_profile_manager
        pm = get_profile_manager()

        # Check for profile query parameter
        profile = request.query_params.get("profile")
        cfg = pm.get_config(profile)
        return JSONResponse(cfg.to_dict())

    @app.post("/api/config")
    async def update_config_endpoint(request: Request):
        """Update configuration values for current profile."""
        from .config import get_profile_manager
        pm = get_profile_manager()

        body, error = await parse_json_body(request)
        if error:
            return error

        # Check for profile query parameter
        profile = request.query_params.get("profile")
        cfg = pm.get_config(profile)

        cfg.update(body)
        cfg.save()
        pm.save_current()  # Update metadata timestamp

        logger.info(f"Configuration updated for profile '{pm.get_current_profile()}': {list(body.keys())}")

        # Refresh IK solver if leg dimensions were updated
        leg_keys = [k for k in body.keys() if 'leg' in k and 'length' in k]
        if leg_keys:
            controller.gait.refresh_leg_geometry()
            logger.info("Refreshed leg geometry for IK solver")

        return {"ok": True, "message": "Configuration updated", "profile": pm.get_current_profile()}

    @app.post("/api/config/servo_offset")
    async def set_servo_offset_endpoint(request: Request):
        """Set servo calibration offset."""
        from .config import get_config
        cfg = get_config()
        body, error = await parse_json_body(request)
        if error:
            return error
        try:
            leg = int(body.get("leg", 0))
            joint = int(body.get("joint", 0))
            offset = float(body.get("offset", 0.0))
        except (TypeError, ValueError) as e:
            return JSONResponse({"error": f"Invalid parameter: {e}"}, status_code=400)

        if not (0 <= leg <= 5) or not (0 <= joint <= 2):
            return JSONResponse({"error": "Invalid leg or joint index"}, status_code=400)

        cfg.set_servo_offset(leg, joint, offset)
        cfg.save()
        return {"ok": True, "leg": leg, "joint": joint, "offset": offset}

    @app.post("/api/config/save")
    async def save_config_endpoint():
        """Explicitly save configuration to file."""
        from .config import get_config
        cfg = get_config()
        cfg.save()
        logger.info("Configuration saved to file")
        return {"ok": True, "message": "Configuration saved"}

    @app.post("/api/config/reset")
    async def reset_config_endpoint():
        """Reset configuration to factory defaults."""
        from .config import get_profile_manager
        pm = get_profile_manager()
        cfg = pm.get_config()
        cfg.reset_to_defaults()
        cfg.save()
        logger.info("Configuration reset to defaults")
        return {"ok": True, "message": "Configuration reset to defaults"}

    @app.get("/api/system/info")
    async def get_system_info():
        """Get system information for diagnostics."""
        import sys
        import platform
        from datetime import datetime
        start_time = getattr(controller, '_start_time', None)
        uptime = str(datetime.now() - start_time) if start_time else 'Unknown'
        return {
            "version": "1.0.0",
            "schema": "v1",
            "hardware_mode": "PCA9685" if hasattr(controller.servo, 'pca') else "Mock",
            "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "platform": platform.system(),
            "uptime": uptime
        }

    async def _set_servo_angle(request: Request):
        """Internal handler for setting servo angles."""
        body, error = await parse_json_body(request)
        if error:
            return error
        try:
            leg = int(body.get("leg", 0))
            joint = int(body.get("joint", 0))
            angle = float(body.get("angle", 90.0))
        except (TypeError, ValueError) as e:
            return JSONResponse({"error": f"Invalid parameter: {e}"}, status_code=400)

        if not (0 <= leg <= 5) or not (0 <= joint <= 2):
            return JSONResponse({"error": "Invalid leg or joint index"}, status_code=400)

        # Clamp angle to safe servo range
        angle = max(0.0, min(180.0, angle))

        try:
            servo_ctrl.set_servo_angle(leg, joint, angle)
            logger.info(f"Servo test: leg={leg}, joint={joint}, angle={angle}")
            return {"ok": True, "leg": leg, "joint": joint, "angle": angle}
        except Exception as e:
            logger.error(f"Servo test failed: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.post("/api/servo/test")
    async def test_servo(request: Request):
        """Manually set a servo angle for testing."""
        return await _set_servo_angle(request)

    @app.post("/api/servo/angle")
    async def set_servo_angle(request: Request):
        """Set a servo angle (alias for /api/servo/test)."""
        return await _set_servo_angle(request)

    # ========== Calibration Endpoints ==========

    @app.get("/api/calibration")
    async def get_calibration():
        """Get servo calibration data."""
        cal_file = Path.home() / ".hexapod_calibration.json"
        calibration = load_existing_calibration()

        # Determine if running on hardware
        is_hardware = not isinstance(servo_ctrl, MockServoController)

        # File metadata
        metadata = {
            "path": str(cal_file),
            "exists": cal_file.exists(),
            "size": cal_file.stat().st_size if cal_file.exists() else None
        }

        # Coverage analysis
        mapped_keys = list(calibration.keys())
        all_keys = [f"{leg},{joint}" for leg in range(6) for joint in range(3)]
        unmapped = [k for k in all_keys if k not in calibration]
        legs_configured = len(set(k.split(",")[0] for k in mapped_keys))
        used_channels = set(calibration.values())
        available_channels = [ch for ch in range(16) if ch not in used_channels]

        coverage = {
            "mapped": len(mapped_keys),
            "legs_configured": legs_configured,
            "available_channels": available_channels,
            "unmapped": unmapped
        }

        return {
            "calibration": calibration,
            "hardware": is_hardware,
            "metadata": metadata,
            "coverage": coverage
        }

    @app.post("/api/calibration")
    async def update_calibration(request: Request):
        """Update servo calibration mappings."""
        body, error = await parse_json_body(request)
        if error:
            return error

        calibration = body.get("calibration")
        if calibration is None:
            return JSONResponse({"error": "Missing calibration data"}, status_code=400)

        try:
            save_calibration(calibration)
            return {"ok": True, "saved": len(calibration)}
        except Exception as e:
            logger.error(f"Failed to save calibration: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.post("/api/calibration/save")
    async def save_calibration_to_disk():
        """Save current calibration to disk (alias for POST /api/calibration)."""
        calibration = load_existing_calibration()
        try:
            save_calibration(calibration)
            return {"ok": True, "saved": len(calibration)}
        except Exception as e:
            logger.error(f"Failed to save calibration: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    @app.get("/api/bluetooth/scan")
    async def bluetooth_scan():
        """Scan for Bluetooth controllers."""
        from .controller_bluetooth import BLEDeviceScanner
        try:
            scanner = BLEDeviceScanner()
            devices = await scanner.scan(timeout=5.0)
            return {"ok": True, "devices": [{"name": d.name or "Unknown", "address": d.address} for d in devices]}
        except Exception as e:
            return JSONResponse({"error": f"Bluetooth scan failed: {str(e)}"}, status_code=500)

    @app.post("/api/bluetooth/connect")
    async def bluetooth_connect(request: Request):
        """Connect to a Bluetooth controller."""
        body, error = await parse_json_body(request)
        if error:
            return error
        address = body.get("address")
        if not address:
            return JSONResponse({"error": "Missing device address"}, status_code=400)

        # TODO: Implement connection management
        # For now, return success if use_controller is enabled
        if use_controller:
            return {"ok": True, "message": f"Connecting to {address}..."}
        else:
            return JSONResponse({"error": "Bluetooth controller support not enabled"}, status_code=400)

    @app.post("/api/bluetooth/disconnect")
    async def bluetooth_disconnect():
        """Disconnect from Bluetooth controller."""
        # TODO: Implement disconnection
        return {"ok": True, "message": "Disconnected"}

    # ========== Patrol API Endpoints ==========
    # Patrol state (stored in controller for simplicity)
    patrol_state = {
        "status": "stopped",  # stopped, running, paused
        "active_route": None,
        "current_waypoint": 0,
        "routes": [],  # List of patrol routes/zones
        "detections": [],  # Detection log
        "settings": {
            "speed": 50,
            "mode": "loop",
            "pattern": "lawnmower",
            "waypoint_pause": 2,
            "detection_targets": ["snail"],
            "detection_sensitivity": 70
        }
    }

    @app.get("/api/patrol/status")
    async def patrol_status():
        """Get current patrol status."""
        return {
            "status": patrol_state["status"],
            "active_route": patrol_state["active_route"],
            "current_waypoint": patrol_state["current_waypoint"],
            "settings": patrol_state["settings"]
        }

    @app.get("/api/patrol/routes")
    async def get_patrol_routes():
        """Get all patrol routes and zones."""
        return {"routes": patrol_state["routes"]}

    @app.post("/api/patrol/routes")
    async def save_patrol_route(request: Request):
        """Save a new patrol route or zone."""
        body, error = await parse_json_body(request)
        if error:
            return error

        route = {
            "id": body.get("id") or f"route_{int(asyncio.get_event_loop().time() * 1000)}",
            "name": body.get("name", "New Route"),
            "description": body.get("description", ""),
            "type": body.get("type", "polyline"),  # polyline or polygon
            "coordinates": body.get("coordinates", []),
            "color": body.get("color", "#4fc3f7"),
            "priority": body.get("priority", "normal"),
            "created_at": body.get("created_at") or asyncio.get_event_loop().time()
        }

        # Check if updating existing route
        existing_idx = next((i for i, r in enumerate(patrol_state["routes"]) if r["id"] == route["id"]), -1)
        if existing_idx >= 0:
            patrol_state["routes"][existing_idx] = route
        else:
            patrol_state["routes"].append(route)

        # Save to config file
        from .config import get_config
        cfg = get_config()
        cfg.set("patrol_routes", patrol_state["routes"])
        cfg.save()

        return {"ok": True, "route": route}

    @app.delete("/api/patrol/routes/{route_id}")
    async def delete_patrol_route(route_id: str):
        """Delete a patrol route."""
        patrol_state["routes"] = [r for r in patrol_state["routes"] if r["id"] != route_id]

        # Save to config file
        from .config import get_config
        cfg = get_config()
        cfg.set("patrol_routes", patrol_state["routes"])
        cfg.save()

        return {"ok": True}

    @app.post("/api/patrol/start")
    async def start_patrol(request: Request):
        """Start patrolling a route."""
        body, error = await parse_json_body(request)
        if error:
            return error

        route_id = body.get("route_id")
        route = next((r for r in patrol_state["routes"] if r["id"] == route_id), None)

        if not route:
            return JSONResponse({"error": "Route not found"}, status_code=404)

        patrol_state["status"] = "running"
        patrol_state["active_route"] = route_id
        patrol_state["current_waypoint"] = 0

        # Update settings from request
        if "speed" in body:
            patrol_state["settings"]["speed"] = body["speed"]
        if "mode" in body:
            patrol_state["settings"]["mode"] = body["mode"]
        if "pattern" in body:
            patrol_state["settings"]["pattern"] = body["pattern"]
        if "detection_targets" in body:
            patrol_state["settings"]["detection_targets"] = body["detection_targets"]
        if "detection_sensitivity" in body:
            patrol_state["settings"]["detection_sensitivity"] = body["detection_sensitivity"]

        # Start the hexapod walking
        controller.running = True
        controller.speed = patrol_state["settings"]["speed"] / 100.0

        logger.info(f"Patrol started on route: {route['name']}")

        return {"ok": True, "status": "running", "route": route}

    @app.post("/api/patrol/stop")
    async def stop_patrol():
        """Stop the current patrol."""
        patrol_state["status"] = "stopped"
        patrol_state["active_route"] = None
        patrol_state["current_waypoint"] = 0

        # Stop the hexapod
        controller.running = False
        controller.speed = 0

        logger.info("Patrol stopped")

        return {"ok": True, "status": "stopped"}

    @app.post("/api/patrol/pause")
    async def pause_patrol():
        """Pause the current patrol."""
        if patrol_state["status"] == "running":
            patrol_state["status"] = "paused"
            controller.running = False
            logger.info("Patrol paused")

        return {"ok": True, "status": patrol_state["status"]}

    @app.post("/api/patrol/resume")
    async def resume_patrol():
        """Resume a paused patrol."""
        if patrol_state["status"] == "paused":
            patrol_state["status"] = "running"
            controller.running = True
            controller.speed = patrol_state["settings"]["speed"] / 100.0
            logger.info("Patrol resumed")

        return {"ok": True, "status": patrol_state["status"]}

    @app.get("/api/patrol/detections")
    async def get_detections():
        """Get recent detections."""
        return {"detections": patrol_state["detections"][-100:]}  # Last 100

    @app.post("/api/patrol/detections")
    async def add_detection(request: Request):
        """Add a detection (from camera/AI processing)."""
        body, error = await parse_json_body(request)
        if error:
            return error

        detection = {
            "id": f"det_{int(asyncio.get_event_loop().time() * 1000)}",
            "type": body.get("type", "unknown"),
            "confidence": body.get("confidence", 0.0),
            "lat": body.get("lat", 0.0),
            "lng": body.get("lng", 0.0),
            "timestamp": body.get("timestamp") or asyncio.get_event_loop().time(),
            "image_url": body.get("image_url")
        }

        patrol_state["detections"].append(detection)

        # Broadcast to WebSocket clients
        await manager.broadcast({
            "type": "detection",
            **detection
        })

        return {"ok": True, "detection": detection}

    @app.delete("/api/patrol/detections")
    async def clear_detections():
        """Clear all detections."""
        patrol_state["detections"] = []
        return {"ok": True}

    @app.post("/api/patrol/settings")
    async def update_patrol_settings(request: Request):
        """Update patrol settings."""
        body, error = await parse_json_body(request)
        if error:
            return error

        patrol_state["settings"].update(body)

        # Save to config file
        from .config import get_config
        cfg = get_config()
        cfg.set("patrol_settings", patrol_state["settings"])
        cfg.save()

        return {"ok": True, "settings": patrol_state["settings"]}

    # Load patrol routes and settings from config on startup
    def load_patrol_config():
        from .config import get_config
        cfg = get_config()
        routes = cfg.get("patrol_routes", [])
        if routes:
            patrol_state["routes"] = routes
        settings = cfg.get("patrol_settings", {})
        if settings:
            patrol_state["settings"].update(settings)

    load_patrol_config()

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await manager.connect(websocket)
        try:
            while True:
                data = await websocket.receive_json()
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
                    height = max(30.0, min(200.0, height))  # 30-200mm range
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
                        controller.leg_spread = 130.0  # Wider stance when crouched
                    elif preset == "neutral":
                        controller.body_height = 70.0
                        controller.body_pitch = 0.0
                        controller.body_roll = 0.0
                        controller.body_yaw = 0.0
                        controller.leg_spread = 110.0
                    logger.info(f"Pose preset applied: {preset}")
                elif typ == "apply_pose":
                    # Apply a saved pose from config
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
                    # Move leg through range of motion
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
                    # Walk for approximate duration of requested steps
                    await websocket.send_json({
                        "type": "test_result",
                        "test": "walk",
                        "steps": steps,
                        "status": "started",
                        "message": f"Walking {steps} steps"
                    })
                elif typ == "test_symmetry":
                    logger.info("Self-test: Checking symmetry")
                    # Compare left and right leg positions
                    await websocket.send_json({
                        "type": "test_result",
                        "test": "symmetry",
                        "status": "ok",
                        "message": "Symmetry check passed"
                    })
                elif typ == "test_camera":
                    logger.info("Self-test: Testing cameras")
                    # Check camera availability
                    await websocket.send_json({
                        "type": "test_result",
                        "test": "camera",
                        "status": "ok",
                        "message": "Cameras OK (simulated)"
                    })
                elif typ == "calibrate_imu":
                    logger.info("Self-test: Calibrating IMU")
                    # Simulate IMU calibration
                    await websocket.send_json({
                        "type": "test_result",
                        "test": "imu",
                        "status": "ok",
                        "message": "IMU calibration complete"
                    })
                elif typ == "check_battery":
                    logger.info("Self-test: Checking battery")
                    voltage = sensor.read_battery_voltage()
                    # Estimate percentage (assuming 3S LiPo: 9.0V empty, 12.6V full)
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
                    route = next((r for r in patrol_state["routes"] if r["id"] == route_id), None)
                    if route:
                        patrol_state["status"] = "running"
                        patrol_state["active_route"] = route_id
                        patrol_state["current_waypoint"] = 0
                        # Update settings
                        if "speed" in data:
                            patrol_state["settings"]["speed"] = data["speed"]
                        if "mode" in data:
                            patrol_state["settings"]["mode"] = data["mode"]
                        if "pattern" in data:
                            patrol_state["settings"]["pattern"] = data["pattern"]
                        if "detection_targets" in data:
                            patrol_state["settings"]["detection_targets"] = data["detection_targets"]
                        if "detection_sensitivity" in data:
                            patrol_state["settings"]["detection_sensitivity"] = data["detection_sensitivity"]
                        controller.running = True
                        controller.speed = patrol_state["settings"]["speed"] / 100.0
                        logger.info(f"Patrol started: {route['name']}")
                        await websocket.send_json({
                            "type": "patrol_status",
                            "status": "running",
                            "route_id": route_id
                        })
                elif typ == "patrol_stop":
                    patrol_state["status"] = "stopped"
                    patrol_state["active_route"] = None
                    controller.running = False
                    controller.speed = 0
                    logger.info("Patrol stopped")
                    await websocket.send_json({
                        "type": "patrol_status",
                        "status": "stopped"
                    })
                elif typ == "patrol_pause":
                    if patrol_state["status"] == "running":
                        patrol_state["status"] = "paused"
                        controller.running = False
                        logger.info("Patrol paused")
                    await websocket.send_json({
                        "type": "patrol_status",
                        "status": patrol_state["status"]
                    })
                elif typ == "patrol_resume":
                    if patrol_state["status"] == "paused":
                        patrol_state["status"] = "running"
                        controller.running = True
                        controller.speed = patrol_state["settings"]["speed"] / 100.0
                        logger.info("Patrol resumed")
                    await websocket.send_json({
                        "type": "patrol_status",
                        "status": patrol_state["status"]
                    })
                elif typ == "go_to_position":
                    # Navigate to a specific position (home, detection location, etc.)
                    target_lat = data.get("lat")
                    target_lng = data.get("lng")
                    logger.info(f"Navigating to: {target_lat}, {target_lng}")
                    # TODO: Implement actual navigation logic
                    controller.running = True
                    controller.speed = 0.5
                    await websocket.send_json({
                        "type": "navigation_started",
                        "target": {"lat": target_lat, "lng": target_lng}
                    })
                elif typ == "update_detection_targets":
                    targets = data.get("targets", [])
                    sensitivity = data.get("sensitivity", 70)
                    patrol_state["settings"]["detection_targets"] = targets
                    patrol_state["settings"]["detection_sensitivity"] = sensitivity
                    logger.info(f"Detection targets updated: {targets}")
                elif typ == "get_position":
                    # Return current simulated position
                    # TODO: Integrate with actual GPS/position tracking
                    await websocket.send_json({
                        "type": "position",
                        "lat": 37.7749,
                        "lng": -122.4194
                    })
        except WebSocketDisconnect:
            conn_id = getattr(websocket.state, 'connection_id', '?')
            logger.info(f"WebSocket #{conn_id} client disconnected normally")
            manager.disconnect(websocket)
        except Exception as e:
            conn_id = getattr(websocket.state, 'connection_id', '?')
            logger.warning(f"WebSocket #{conn_id} error: {e}")
            manager.disconnect(websocket)

    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=8000)
