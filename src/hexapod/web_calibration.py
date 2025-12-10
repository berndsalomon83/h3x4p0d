"""Calibration and servo testing API router.

This module provides endpoints for:
    - Getting calibration data
    - Updating calibration mappings
    - Testing individual servos
"""

import logging
from pathlib import Path
from typing import TYPE_CHECKING, Optional, Dict, Any, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from .hardware import ServoController, MockServoController
from .calibrate import load_existing_calibration, save_calibration

if TYPE_CHECKING:
    from .web_controller import HexapodController

logger = logging.getLogger(__name__)


async def parse_json_body(request: Request) -> Tuple[Optional[Dict[str, Any]], Optional[JSONResponse]]:
    """Safely parse JSON request body with error handling."""
    import json
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


def create_calibration_router(controller: "HexapodController", servo: ServoController) -> APIRouter:
    """Create the calibration API router.

    Args:
        controller: HexapodController instance
        servo: ServoController instance for testing

    Returns:
        FastAPI router with calibration endpoints
    """
    router = APIRouter(prefix="/api", tags=["calibration"])

    @router.get("/calibration")
    async def get_calibration():
        """Get servo calibration data."""
        cal_file = Path.home() / ".hexapod_calibration.json"
        calibration = load_existing_calibration()

        # Determine if running on hardware
        is_hardware = not isinstance(servo, MockServoController)

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

    @router.post("/calibration")
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

    @router.post("/calibration/save")
    async def save_calibration_to_disk():
        """Save current calibration to disk (alias for POST /api/calibration)."""
        calibration = load_existing_calibration()
        try:
            save_calibration(calibration)
            return {"ok": True, "saved": len(calibration)}
        except Exception as e:
            logger.error(f"Failed to save calibration: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

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
            servo.set_servo_angle(leg, joint, angle)
            logger.info(f"Servo test: leg={leg}, joint={joint}, angle={angle}")
            return {"ok": True, "leg": leg, "joint": joint, "angle": angle}
        except Exception as e:
            logger.error(f"Servo test failed: {e}")
            return JSONResponse({"error": str(e)}, status_code=500)

    @router.post("/servo/test")
    async def test_servo(request: Request):
        """Manually set a servo angle for testing."""
        return await _set_servo_angle(request)

    @router.post("/servo/angle")
    async def set_servo_angle(request: Request):
        """Set a servo angle (alias for /api/servo/test)."""
        return await _set_servo_angle(request)

    return router
