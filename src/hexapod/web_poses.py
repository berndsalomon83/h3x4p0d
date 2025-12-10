"""Pose management API router.

This module provides endpoints for:
    - Listing saved poses
    - Creating new poses
    - Updating existing poses
    - Deleting poses
    - Applying poses to the controller
    - Recording current position as a pose
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


def create_poses_router(controller: "HexapodController") -> APIRouter:
    """Create the poses API router.

    Args:
        controller: HexapodController instance

    Returns:
        FastAPI router with pose endpoints
    """
    router = APIRouter(prefix="/api", tags=["poses"])

    @router.get("/poses")
    async def list_poses():
        """List all saved poses."""
        from .config import get_config
        cfg = get_config()
        poses = cfg.get_poses()
        return {"poses": poses}

    @router.post("/poses")
    async def manage_poses(request: Request):
        """Manage poses (create, update, delete, apply, record)."""
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

    return router
