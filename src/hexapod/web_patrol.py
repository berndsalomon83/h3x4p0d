"""Patrol control API router.

This module provides endpoints for:
    - Patrol status and control
    - Route management
    - Detection logging
    - Patrol settings
"""

import asyncio
import logging
from typing import TYPE_CHECKING, Optional, Dict, Any, Tuple, List

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

if TYPE_CHECKING:
    from .web_controller import HexapodController, ConnectionManager

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


class PatrolState:
    """Encapsulates patrol state management."""

    def __init__(self):
        self.status = "stopped"  # stopped, running, paused
        self.active_route: Optional[str] = None
        self.current_waypoint = 0
        self.routes: List[Dict[str, Any]] = []
        self.detections: List[Dict[str, Any]] = []
        self.settings = {
            "speed": 50,
            "mode": "loop",
            "pattern": "lawnmower",
            "waypoint_pause": 2,
            "detection_targets": ["snail"],
            "detection_sensitivity": 70
        }

    def load_from_config(self):
        """Load patrol state from config."""
        from .config import get_config
        cfg = get_config()
        routes = cfg.get("patrol_routes", [])
        if routes:
            self.routes = routes
        settings = cfg.get("patrol_settings", {})
        if settings:
            self.settings.update(settings)

    def save_to_config(self):
        """Save patrol state to config."""
        from .config import get_config
        cfg = get_config()
        cfg.set("patrol_routes", self.routes)
        cfg.set("patrol_settings", self.settings)
        cfg.save()

    def to_dict(self) -> Dict[str, Any]:
        """Convert state to dictionary."""
        return {
            "status": self.status,
            "active_route": self.active_route,
            "current_waypoint": self.current_waypoint,
            "settings": self.settings
        }


def create_patrol_router(
    controller: "HexapodController",
    manager: "ConnectionManager"
) -> Tuple[APIRouter, PatrolState]:
    """Create the patrol API router.

    Args:
        controller: HexapodController instance
        manager: ConnectionManager for broadcasting detections

    Returns:
        Tuple of (FastAPI router, PatrolState instance)
    """
    router = APIRouter(prefix="/api/patrol", tags=["patrol"])
    patrol = PatrolState()

    # Load initial state from config
    patrol.load_from_config()

    @router.get("/status")
    async def patrol_status():
        """Get current patrol status."""
        return patrol.to_dict()

    @router.get("/routes")
    async def get_patrol_routes():
        """Get all patrol routes and zones."""
        return {"routes": patrol.routes}

    @router.post("/routes")
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
        existing_idx = next(
            (i for i, r in enumerate(patrol.routes) if r["id"] == route["id"]),
            -1
        )
        if existing_idx >= 0:
            patrol.routes[existing_idx] = route
        else:
            patrol.routes.append(route)

        patrol.save_to_config()
        return {"ok": True, "route": route}

    @router.delete("/routes/{route_id}")
    async def delete_patrol_route(route_id: str):
        """Delete a patrol route."""
        patrol.routes = [r for r in patrol.routes if r["id"] != route_id]
        patrol.save_to_config()
        return {"ok": True}

    @router.post("/start")
    async def start_patrol(request: Request):
        """Start patrolling a route."""
        body, error = await parse_json_body(request)
        if error:
            return error

        route_id = body.get("route_id")
        route = next((r for r in patrol.routes if r["id"] == route_id), None)

        if not route:
            return JSONResponse({"error": "Route not found"}, status_code=404)

        patrol.status = "running"
        patrol.active_route = route_id
        patrol.current_waypoint = 0

        # Update settings from request
        if "speed" in body:
            patrol.settings["speed"] = body["speed"]
        if "mode" in body:
            patrol.settings["mode"] = body["mode"]
        if "pattern" in body:
            patrol.settings["pattern"] = body["pattern"]
        if "detection_targets" in body:
            patrol.settings["detection_targets"] = body["detection_targets"]
        if "detection_sensitivity" in body:
            patrol.settings["detection_sensitivity"] = body["detection_sensitivity"]

        # Start the hexapod walking
        controller.running = True
        controller.speed = patrol.settings["speed"] / 100.0

        logger.info(f"Patrol started on route: {route['name']}")
        return {"ok": True, "status": "running", "route": route}

    @router.post("/stop")
    async def stop_patrol():
        """Stop the current patrol."""
        patrol.status = "stopped"
        patrol.active_route = None
        patrol.current_waypoint = 0

        # Stop the hexapod
        controller.running = False
        controller.speed = 0

        logger.info("Patrol stopped")
        return {"ok": True, "status": "stopped"}

    @router.post("/pause")
    async def pause_patrol():
        """Pause the current patrol."""
        if patrol.status == "running":
            patrol.status = "paused"
            controller.running = False
            logger.info("Patrol paused")

        return {"ok": True, "status": patrol.status}

    @router.post("/resume")
    async def resume_patrol():
        """Resume a paused patrol."""
        if patrol.status == "paused":
            patrol.status = "running"
            controller.running = True
            controller.speed = patrol.settings["speed"] / 100.0
            logger.info("Patrol resumed")

        return {"ok": True, "status": patrol.status}

    @router.get("/detections")
    async def get_detections():
        """Get recent detections."""
        return {"detections": patrol.detections[-100:]}  # Last 100

    @router.post("/detections")
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

        patrol.detections.append(detection)

        # Broadcast to WebSocket clients
        await manager.broadcast({
            "type": "detection",
            **detection
        })

        return {"ok": True, "detection": detection}

    @router.delete("/detections")
    async def clear_detections():
        """Clear all detections."""
        patrol.detections = []
        return {"ok": True}

    @router.post("/settings")
    async def update_patrol_settings(request: Request):
        """Update patrol settings."""
        body, error = await parse_json_body(request)
        if error:
            return error

        patrol.settings.update(body)
        patrol.save_to_config()

        return {"ok": True, "settings": patrol.settings}

    return router, patrol
