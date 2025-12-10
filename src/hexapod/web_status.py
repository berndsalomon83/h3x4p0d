"""Status and health check API router.

This module provides endpoints for:
    - Health check
    - System status and telemetry
    - Sensor readings
    - System information
"""

import sys
import platform
import logging
from datetime import datetime
from typing import TYPE_CHECKING

from fastapi import APIRouter

if TYPE_CHECKING:
    from .web_controller import HexapodController, ConnectionManager
    from .hardware import SensorReader

logger = logging.getLogger(__name__)


def create_status_router(
    controller: "HexapodController",
    manager: "ConnectionManager",
    sensor: "SensorReader"
) -> APIRouter:
    """Create the status API router.

    Args:
        controller: HexapodController instance
        manager: ConnectionManager for WebSocket tracking
        sensor: SensorReader for temperature/battery

    Returns:
        FastAPI router with status endpoints
    """
    router = APIRouter(prefix="/api", tags=["status"])

    @router.get("/health")
    async def health_check():
        """Health check endpoint for monitoring."""
        return {
            "status": "ok",
            "running": controller.running,
            "gait_mode": controller.gait_mode,
            "websocket_clients": len(manager.active)
        }

    @router.get("/status")
    async def status():
        """Get current hexapod status and telemetry."""
        return controller.get_telemetry()

    @router.get("/sensors")
    async def sensors():
        """Get sensor readings."""
        return {
            "temperature_c": sensor.read_temperature_c(),
            "battery_v": sensor.read_battery_voltage(),
        }

    @router.get("/system/info")
    async def get_system_info():
        """Get system information for diagnostics."""
        from .hardware import MockServoController
        start_time = getattr(controller, '_start_time', None)
        uptime = str(datetime.now() - start_time) if start_time else 'Unknown'
        return {
            "version": "1.0.0",
            "schema": "v1",
            "hardware_mode": "PCA9685" if not isinstance(controller.servo, MockServoController) else "Mock",
            "python_version": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}",
            "platform": platform.system(),
            "uptime": uptime
        }

    return router
