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

Telemetry (server → client):
    - angles: Servo angles for 6 legs (18 values)
    - ground_contacts: Which legs are in stance phase
    - running, speed, heading, body pose, sensor readings
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
import time
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

from .hardware import MockServoController, SensorReader, ServoController
from .gait import GaitEngine
from .controller_bluetooth import GenericController, MotionCommand

try:
    from adafruit_pca9685 import PCA9685
    _HAS_I2C = True
except Exception:
    _HAS_I2C = False


class ConnectionManager:
    """Manages WebSocket connections for broadcasting telemetry."""
    def __init__(self):
        self.active: List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active.append(websocket)

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active:
            self.active.remove(websocket)

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
        body_height: Height of body above ground in mm (30-90mm)
        body_pitch/roll/yaw: Body pose angles in degrees
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

        # Rotation in place (degrees per second, 0 = no rotation)
        self.rotation_speed = 0.0  # positive = clockwise, negative = counter-clockwise

        # Track ground contact state for telemetry (True = stance/grounded)
        self.ground_contacts: List[bool] = [True] * 6

        # motion command handler
        self.bt_controller = GenericController()
        self.bt_controller.on_event(self._handle_motion_cmd)

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
            if mode in ("tripod", "wave", "ripple"):
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
        """Calculate IK for standing pose at current body height.

        Returns list of (coxa, femur, tibia) angles in degrees for all 6 legs.
        Uses servo convention: 90° = neutral/horizontal.
        """
        angles = []
        ground_level = -10.0  # mm
        vertical_drop = self.body_height - ground_level

        # Calculate stance width dynamically based on actual leg geometry
        # IK solver has the actual leg lengths: L1=coxa, L2=femur, L3=tibia
        coxa_len = self.gait.ik.L1
        femur_len = self.gait.ik.L2
        tibia_len = self.gait.ik.L3
        max_leg_reach = femur_len + tibia_len  # Maximum reach from femur pivot

        # Calculate max horizontal reach at current body height
        # reach² = horizontal² + vertical²  =>  horizontal = sqrt(reach² - vertical²)
        # Use 85% of max reach to stay within comfortable range
        usable_reach = max_leg_reach * 0.85
        if vertical_drop >= usable_reach:
            # Body too high, use minimum horizontal spread
            horizontal_from_femur = max_leg_reach * 0.3
        else:
            horizontal_from_femur = math.sqrt(usable_reach**2 - vertical_drop**2)

        # Stance width = distance from body center to foot = coxa + horizontal reach from femur
        stance_width = coxa_len + horizontal_from_femur

        for leg_idx in range(6):
            # For standing pose, use IK in leg-local coordinates
            # After frontend leg group rotation, each leg points radially outward
            # So target in leg-local frame is:
            # - stance_width radially (IK's x-axis)
            # - 0 tangentially (IK's y-axis)
            # - vertical_drop down (IK's z-axis)

            try:
                # IK solve in leg-local frame
                ik_coxa, ik_femur, ik_tibia = self.gait.ik.solve(
                    stance_width,  # radial distance
                    0.0,           # no tangential offset
                    -vertical_drop # down
                )

                # Convert IK's absolute coxa angle to servo convention
                # IK returns atan2(0, stance_width) = 0° for straight ahead
                # Servo convention: 90° = neutral (straight), so add 90°
                coxa = 90.0  # Neutral for standing (legs point straight out)

                # Femur and tibia are already in correct convention from IK
                femur = ik_femur
                tibia = ik_tibia

                angles.append((coxa, femur, tibia))
            except ValueError as e:
                # Target unreachable, use safe default angles
                print(f"IK failed for leg {leg_idx} at height {self.body_height}mm: {e}")
                angles.append((90.0, 70.0, 90.0))  # neutral standing position

        return angles

    def update_servos(self):
        """Update servo positions based on current gait time or standing pose."""
        if self.running:
            # Walking: use gait generator
            base_angles = self.gait.joint_angles_for_time(self.gait.time, mode=self.gait_mode)
            # stance phase when swing=False inside gait engine
            self.ground_contacts = [not swing for swing in self.gait.last_swing_states]
        else:
            # Standing: use IK for body height
            base_angles = self.calculate_standing_pose()
            self.ground_contacts = [True] * 6

        # Apply heading rotation to all coxa angles and update servos
        angles = []
        for leg_idx, (coxa, femur, tibia) in enumerate(base_angles):
            # Add heading rotation to coxa
            coxa_adjusted = coxa + self.heading
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

    @app.get("/favicon.ico")
    async def favicon():
        """Serve favicon."""
        favicon_file = Path(__file__).parent.parent.parent / "web_static" / "favicon.svg"
        if favicon_file.exists():
            return FileResponse(str(favicon_file), media_type="image/svg+xml")
        return Response(status_code=204)  # No content if favicon doesn't exist

    @app.get("/api/health")
    async def health_check():
        """Health check endpoint for monitoring."""
        return {
            "status": "ok",
            "running": controller.running,
            "gait_mode": controller.gait_mode,
            "websocket_clients": len(manager.active)
        }

    @app.post("/api/gait")
    async def set_gait(request: Request):
        body, error = await parse_json_body(request)
        if error:
            return error
        mode = body.get("mode")
        if mode not in ("tripod", "wave", "ripple"):
            return JSONResponse({"error": "unsupported mode"}, status_code=400)
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
        # Clamp to safe range
        height = max(30.0, min(90.0, height))
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

    @app.get("/api/config")
    async def get_config_endpoint():
        """Get current configuration."""
        from .config import get_config
        cfg = get_config()
        return JSONResponse(cfg.to_dict())

    @app.post("/api/config")
    async def update_config_endpoint(request: Request):
        """Update configuration values."""
        from .config import get_config
        cfg = get_config()
        body, error = await parse_json_body(request)
        if error:
            return error
        cfg.update(body)
        cfg.save()
        logger.info(f"Configuration updated: {list(body.keys())}")

        # Refresh IK solver if leg dimensions were updated
        leg_keys = [k for k in body.keys() if 'leg' in k and 'length' in k]
        if leg_keys:
            controller.gait.refresh_leg_geometry()
            logger.info("Refreshed leg geometry for IK solver")

        return {"ok": True, "message": "Configuration updated"}

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

    @app.post("/api/servo/test")
    async def test_servo(request: Request):
        """Manually set a servo angle for testing."""
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

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        await manager.connect(websocket)
        try:
            while True:
                data = await websocket.receive_json()
                typ = data.get("type")
                if typ == "set_gait":
                    controller.gait_mode = data.get("mode", "tripod")
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
                    height = max(30.0, min(90.0, height))
                    controller.body_height = height
        except WebSocketDisconnect:
            manager.disconnect(websocket)

    return app


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(create_app(), host="0.0.0.0", port=8000)
