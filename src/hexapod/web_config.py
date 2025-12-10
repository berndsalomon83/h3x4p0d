"""Configuration API router.

This module provides endpoints for:
    - Getting configuration
    - Updating configuration
    - Setting servo offsets
    - Saving/resetting configuration
"""

import logging
from typing import TYPE_CHECKING, Optional, Dict, Any, Tuple

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

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


def create_config_router(controller: "HexapodController") -> APIRouter:
    """Create the config API router.

    Args:
        controller: HexapodController instance

    Returns:
        FastAPI router with config endpoints
    """
    router = APIRouter(prefix="/api", tags=["config"])

    @router.get("/config")
    async def get_config_endpoint(request: Request):
        """Get configuration for a profile."""
        from .config import get_profile_manager
        pm = get_profile_manager()

        # Check for profile query parameter
        profile = request.query_params.get("profile")
        cfg = pm.get_config(profile)
        return JSONResponse(cfg.to_dict())

    @router.post("/config")
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

    @router.post("/config/servo_offset")
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

    @router.post("/config/save")
    async def save_config_endpoint():
        """Explicitly save configuration to file."""
        from .config import get_config
        cfg = get_config()
        cfg.save()
        logger.info("Configuration saved to file")
        return {"ok": True, "message": "Configuration saved"}

    @router.post("/config/reset")
    async def reset_config_endpoint():
        """Reset configuration to factory defaults."""
        from .config import get_profile_manager
        pm = get_profile_manager()
        cfg = pm.get_config()
        cfg.reset_to_defaults()
        cfg.save()
        logger.info("Configuration reset to defaults")
        return {"ok": True, "message": "Configuration reset to defaults"}

    return router
