"""Profile management API router.

This module provides endpoints for:
    - Listing profiles
    - Creating new profiles
    - Deleting profiles
    - Renaming profiles
    - Setting default profile
    - Switching active profile
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


def create_profiles_router(controller: "HexapodController") -> APIRouter:
    """Create the profiles API router.

    Args:
        controller: HexapodController instance (for refreshing gait params on switch)

    Returns:
        FastAPI router with profile endpoints
    """
    router = APIRouter(prefix="/api", tags=["profiles"])

    @router.get("/profiles")
    async def list_profiles():
        """List all available profiles."""
        from .config import get_profile_manager
        pm = get_profile_manager()
        return JSONResponse({
            "profiles": pm.list_profiles(),
            "current": pm.get_current_profile(),
            "default": pm.get_default_profile()
        })

    @router.post("/profiles")
    async def manage_profiles(request: Request):
        """Manage profiles (create, delete, set-default, rename, update, switch)."""
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

            # Refresh gait parameters from the new profile's config
            controller.refresh_gait_params_from_config()

            return {"ok": True, "current": name}

        else:
            return JSONResponse({"error": f"Unknown action: {action}"}, status_code=400)

    return router
