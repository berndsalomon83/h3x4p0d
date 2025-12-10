"""Gait and movement control API router.

This module provides endpoints for:
    - Gait mode selection and management
    - Gait parameter configuration
    - Run/stop control
    - Body height and pose
    - Leg spread and rotation
    - Emergency stop
"""

import logging
from typing import TYPE_CHECKING, Optional, Dict, Any, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse


if TYPE_CHECKING:
    from .web_controller import HexapodController

logger = logging.getLogger(__name__)


async def parse_json_body(request: Request) -> Tuple[Optional[Dict[str, Any]], Optional[JSONResponse]]:
    """Safely parse JSON request body with error handling.

    Returns:
        Tuple of (parsed_body, error_response). If parsing succeeds, error_response is None.
        If parsing fails, parsed_body is None and error_response contains the error.
    """
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


def create_gait_router(controller: "HexapodController") -> APIRouter:
    """Create the gait API router.

    Args:
        controller: HexapodController instance

    Returns:
        FastAPI router with gait endpoints
    """
    router = APIRouter(prefix="/api", tags=["gait"])

    @router.get("/gaits")
    async def list_gaits():
        """List all available gaits with their configurations."""
        from .config import get_config
        cfg = get_config()
        gaits = cfg.get_gaits()
        enabled_gaits = cfg.get_enabled_gaits()

        return {
            "gaits": gaits,
            "enabled": list(enabled_gaits.keys()),
            "current": controller.gait_mode,
            "default": cfg.get("default_gait", "tripod")
        }

    @router.post("/gaits")
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

    @router.post("/gait")
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

    @router.get("/gait/params")
    async def get_gait_params():
        """Get current gait parameters."""
        return {
            "step_height": controller.gait.step_height,
            "step_length": controller.gait.step_length,
            "cycle_time": controller.gait.cycle_time
        }

    @router.post("/gait/params")
    async def set_gait_params(request: Request):
        """Update gait parameters.

        Note: These settings override config defaults for the running session.
        Switching profiles will refresh gait params from the new profile's config.
        """
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

    @router.post("/run")
    async def run_stop(request: Request):
        """Start or stop walking."""
        body, error = await parse_json_body(request)
        if error:
            return error
        run = bool(body.get("run", False))
        controller.running = run
        logger.info(f"Running state changed to: {run}")
        return {"running": run}

    @router.post("/stop")
    async def stop():
        """Stop walking."""
        controller.running = False
        return {"stopped": True}

    @router.post("/body_height")
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

    @router.post("/body_pose")
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

    @router.get("/body_pose")
    async def get_body_pose():
        """Get current body pose."""
        return {
            "pitch": controller.body_pitch,
            "roll": controller.body_roll,
            "yaw": controller.body_yaw
        }

    @router.post("/leg_spread")
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

    @router.post("/rotation")
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

    @router.post("/emergency_stop")
    async def emergency_stop():
        """Emergency stop - immediately halt all movement."""
        controller.emergency_stop()
        return {"ok": True, "message": "Emergency stop activated"}

    return router
