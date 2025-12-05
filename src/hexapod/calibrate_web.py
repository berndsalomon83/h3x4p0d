"""Web-based servo calibration tool.

Runs on a separate port (default 8001) from the main controller.
Provides a dedicated UI for servo calibration without gait interference.
"""

from contextlib import asynccontextmanager
from datetime import datetime
import argparse
import json
import logging
from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response

from .hardware import MockServoController, PCA9685ServoController

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(name)s: %(message)s')
logger = logging.getLogger(__name__)

# Calibration file path
CALIBRATION_FILE = Path.home() / ".hexapod_calibration.json"


JOINT_LABELS = ["Coxa", "Femur", "Tibia"]


def calibration_metadata(file_path: Path | None = None) -> dict:
    """Return metadata about the calibration file."""

    file_path = file_path or CALIBRATION_FILE
    exists = file_path.exists()
    return {
        "path": str(file_path),
        "exists": exists,
        "last_modified": datetime.fromtimestamp(file_path.stat().st_mtime).isoformat()
        if exists
        else None,
        "size": file_path.stat().st_size if exists else 0,
    }


def load_calibration() -> dict:
    """Load existing calibration from file."""
    if CALIBRATION_FILE.exists():
        with open(CALIBRATION_FILE, encoding='utf-8') as f:
            return json.load(f)
    return {}


def save_calibration(cal: dict):
    """Save calibration to file."""
    with open(CALIBRATION_FILE, "w", encoding='utf-8') as f:
        json.dump(cal, f, indent=2)


def calibration_coverage(calibration: dict) -> dict:
    """Return coverage info, unmapped joints, and free channels."""

    used_channels = {channel for channel in calibration.values() if isinstance(channel, int)}
    available_channels = [channel for channel in range(18) if channel not in used_channels]

    unmapped = []
    for leg in range(6):
        for joint in range(3):
            key = f"{leg},{joint}"
            if key not in calibration:
                unmapped.append({
                    "leg": leg,
                    "joint": joint,
                    "label": f"L{leg} {JOINT_LABELS[joint]}",
                })

    return {
        "mapped": len(calibration),
        "total": 18,
        "legs_configured": len({int(key.split(',')[0]) for key in calibration}),
        "unmapped": unmapped,
        "available_channels": available_channels,
    }


class CalibrationController:
    """Controller for servo calibration operations."""

    def __init__(self, use_hardware: bool = False):
        self.use_hardware = use_hardware
        self.servo = None
        self.calibration = load_calibration()
        self.current_angles = {}  # Track current servo positions
        self._init_servo()

    def _init_servo(self):
        """Initialize servo controller."""
        if self.use_hardware:
            try:
                self.servo = PCA9685ServoController()
                logger.info("PCA9685 hardware controller initialized")
            except Exception as e:
                logger.warning(f"PCA9685 init failed: {e}, using mock")
                self.servo = MockServoController()
                self.use_hardware = False
        else:
            self.servo = MockServoController()
            logger.info("Using mock servo controller")

    def set_servo_angle(self, channel: int, angle: float) -> dict:
        """Set a servo to a specific angle."""
        try:
            if not 0 <= channel < 18:
                return {"success": False, "error": f"Invalid channel: {channel} (must be 0-17)"}

            clamped = max(0, min(180, angle))

            # For hardware mode with PCA9685
            if hasattr(self.servo, 'servos') and self.servo.servos:
                if channel < len(self.servo.servos):
                    self.servo.servos[channel].angle = clamped

            # Always track the angle (for both mock and hardware)
            self.current_angles[channel] = clamped
            return {"success": True, "channel": channel, "angle": clamped}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def set_all_to_neutral(self) -> dict:
        """Set all configured servos to 90 degrees (neutral)."""
        results = []
        for key, channel in self.calibration.items():
            result = self.set_servo_angle(channel, 90.0)
            results.append({"key": key, "channel": channel, **result})
        return {"success": True, "results": results}

    def test_servo_range(self, channel: int) -> dict:
        """Test servo by sweeping through range."""
        try:
            # This would be called from frontend with sequential calls
            return {"success": True, "channel": channel, "message": "Use UI to test range"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_mapping(self, leg: int, joint: int) -> int | None:
        """Get channel mapping for a leg/joint."""
        key = f"{leg},{joint}"
        return self.calibration.get(key)

    def set_mapping(self, leg: int, joint: int, channel: int) -> dict:
        """Set channel mapping for a leg/joint."""
        key = f"{leg},{joint}"
        self.calibration[key] = channel
        return {
            "success": True,
            "key": key,
            "channel": channel,
            "coverage": calibration_coverage(self.calibration),
        }

    def remove_mapping(self, leg: int, joint: int) -> dict:
        """Remove channel mapping for a leg/joint."""
        key = f"{leg},{joint}"
        if key in self.calibration:
            del self.calibration[key]
            return {
                "success": True,
                "key": key,
                "coverage": calibration_coverage(self.calibration),
            }
        return {"success": False, "error": "Mapping not found"}

    def save(self) -> dict:
        """Save current calibration to file."""
        try:
            save_calibration(self.calibration)
            return {
                "success": True,
                "path": str(CALIBRATION_FILE),
                "metadata": calibration_metadata(),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def reload(self) -> dict:
        """Reload calibration from file."""
        try:
            self.calibration = load_calibration()
            return {
                "success": True,
                "calibration": self.calibration,
                "metadata": calibration_metadata(),
                "coverage": calibration_coverage(self.calibration),
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    def get_status(self) -> dict:
        """Get current calibration status."""
        return {
            "hardware": self.use_hardware,
            "calibration": self.calibration,
            "current_angles": self.current_angles,
            "calibration_file": str(CALIBRATION_FILE),
            "metadata": calibration_metadata(),
            "coverage": calibration_coverage(self.calibration),
        }


def create_calibration_app(use_hardware: bool = False):
    """Create the calibration FastAPI application."""

    controller = CalibrationController(use_hardware=use_hardware)
    static_dir = Path(__file__).parent.parent.parent / "web_static"

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        logger.info("Calibration server started")
        yield
        logger.info("Calibration server stopped")

    app = FastAPI(title="Hexapod Calibration", version="1.0.0", lifespan=lifespan)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/")
    async def index():
        """Serve configuration UI."""
        config_file = static_dir / "config.html"
        if config_file.exists():
            return FileResponse(
                str(config_file),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )
        return HTMLResponse("<h1>Configuration UI not found</h1>", status_code=404)

    @app.get("/config.css")
    async def config_css():
        """Serve configuration CSS."""
        css_file = static_dir / "config.css"
        if css_file.exists():
            return FileResponse(
                str(css_file),
                media_type="text/css",
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )
        return Response(status_code=404)

    @app.get("/config.js")
    async def config_js():
        """Serve configuration JavaScript."""
        js_file = static_dir / "config.js"
        if js_file.exists():
            return FileResponse(
                str(js_file),
                media_type="application/javascript",
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )
        return Response(status_code=404)

    @app.get("/static/{file_path:path}")
    async def serve_static(file_path: str):
        """Serve static files."""
        file = static_dir / file_path
        if file.exists() and file.is_file():
            return FileResponse(
                str(file),
                headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
            )
        return Response(status_code=404)

    @app.get("/api/status")
    async def get_status():
        """Get calibration status."""
        return JSONResponse(controller.get_status())

    @app.get("/api/calibration")
    async def get_calibration():
        """Get current calibration mapping."""
        return JSONResponse({
            "calibration": controller.calibration,
            "hardware": controller.use_hardware,
            "metadata": calibration_metadata(),
            "coverage": calibration_coverage(controller.calibration),
        })

    @app.post("/api/calibration/save")
    async def save_calibration_endpoint():
        """Save calibration to file."""
        return JSONResponse(controller.save())

    @app.post("/api/calibration/reload")
    async def reload_calibration():
        """Reload calibration from file."""
        return JSONResponse(controller.reload())

    @app.post("/api/mapping")
    async def set_mapping(data: dict):
        """Set a leg/joint to channel mapping."""
        leg = data.get("leg")
        joint = data.get("joint")
        channel = data.get("channel")
        if leg is None or joint is None or channel is None:
            return JSONResponse({"success": False, "error": "Missing parameters"})
        return JSONResponse(controller.set_mapping(int(leg), int(joint), int(channel)))

    @app.delete("/api/mapping")
    async def remove_mapping(leg: int, joint: int):
        """Remove a leg/joint mapping."""
        return JSONResponse(controller.remove_mapping(leg, joint))

    @app.post("/api/servo/angle")
    async def set_servo_angle(data: dict):
        """Set a servo to a specific angle."""
        channel = data.get("channel")
        angle = data.get("angle")
        if channel is None or angle is None:
            return JSONResponse({"success": False, "error": "Missing parameters"})
        return JSONResponse(controller.set_servo_angle(int(channel), float(angle)))

    @app.post("/api/servo/neutral")
    async def set_all_neutral():
        """Set all configured servos to neutral (90 degrees)."""
        return JSONResponse(controller.set_all_to_neutral())

    @app.websocket("/ws")
    async def websocket_endpoint(websocket: WebSocket):
        """WebSocket for real-time servo control."""
        await websocket.accept()
        try:
            while True:
                data = await websocket.receive_json()
                cmd = data.get("type")

                if cmd == "set_angle":
                    result = controller.set_servo_angle(
                        int(data.get("channel", 0)),
                        float(data.get("angle", 90))
                    )
                    await websocket.send_json(result)

                elif cmd == "set_mapping":
                    result = controller.set_mapping(
                        int(data.get("leg", 0)),
                        int(data.get("joint", 0)),
                        int(data.get("channel", 0))
                    )
                    await websocket.send_json(result)

                elif cmd == "get_status":
                    await websocket.send_json(controller.get_status())

                elif cmd == "save":
                    result = controller.save()
                    await websocket.send_json(result)

                elif cmd == "neutral_all":
                    result = controller.set_all_to_neutral()
                    await websocket.send_json(result)

        except WebSocketDisconnect:
            pass

    return app


def main():
    """Entry point for calibration server."""
    parser = argparse.ArgumentParser(description="Hexapod Calibration Server")
    parser.add_argument("--port", type=int, default=8001, help="Port to run on (default: 8001)")
    parser.add_argument("--host", type=str, default="0.0.0.0", help="Host to bind to")
    parser.add_argument("--hardware", action="store_true", help="Use PCA9685 hardware")
    args = parser.parse_args()

    print("=" * 60)
    print("HEXAPOD CONFIGURATION SERVER")
    print("=" * 60)
    print(f"Running on http://localhost:{args.port}")
    print(f"Hardware mode: {'enabled' if args.hardware else 'disabled (mock)'}")
    print("Press Ctrl+C to stop")
    print("=" * 60)

    import uvicorn
    app = create_calibration_app(use_hardware=args.hardware)
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
