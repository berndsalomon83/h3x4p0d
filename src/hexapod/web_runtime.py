"""Runtime management for the hexapod web server.

This module provides:
    - Background gait loop for continuous servo updates and telemetry
    - Lifespan context manager for startup and shutdown events
    - Task management for background operations

The gait loop runs at ~100Hz and broadcasts telemetry at ~20Hz.
"""

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import Optional

from fastapi import FastAPI

from .web_controller import HexapodController, ConnectionManager

logger = logging.getLogger(__name__)


class RuntimeManager:
    """Manages background tasks and lifecycle for the hexapod web server.

    This class handles:
        - Starting/stopping the gait loop
        - Managing Bluetooth controller task
        - Graceful shutdown of background tasks

    Attributes:
        controller: HexapodController instance
        manager: ConnectionManager for WebSocket broadcasting
        use_controller: Whether to start Bluetooth controller input
        _gait_task: Background task for gait loop
        _controller_task: Background task for Bluetooth controller
    """

    def __init__(self, controller: HexapodController, manager: ConnectionManager,
                 use_controller: bool = False):
        """Initialize runtime manager.

        Args:
            controller: HexapodController instance
            manager: ConnectionManager for WebSocket broadcasting
            use_controller: Whether to start Bluetooth controller input
        """
        self.controller = controller
        self.manager = manager
        self.use_controller = use_controller
        self._gait_task: Optional[asyncio.Task] = None
        self._controller_task: Optional[asyncio.Task] = None
        self._shutdown = False

    async def gait_loop(self):
        """Background loop: update servos and broadcast telemetry.

        Runs at approximately 100Hz for servo updates.
        Broadcasts telemetry at approximately 20Hz (every 50ms).
        """
        last_time = asyncio.get_event_loop().time()
        telemetry_interval = 0.05  # broadcast every 50ms
        last_telemetry = 0

        while not self._shutdown:
            now = asyncio.get_event_loop().time()
            dt = now - last_time
            last_time = now

            # Apply rotation speed to heading (degrees per second)
            if self.controller.rotation_speed != 0:
                self.controller.heading += self.controller.rotation_speed * dt
                # Normalize heading to -180 to 180
                while self.controller.heading > 180:
                    self.controller.heading -= 360
                while self.controller.heading < -180:
                    self.controller.heading += 360

            # Only update gait time when running
            if self.controller.running and self.controller.speed > 0:
                self.controller.gait.update(dt * self.controller.speed)

            # Update servo angles (always returns angles for visualization)
            angles = self.controller.update_servos()

            # Broadcast telemetry periodically
            if now - last_telemetry > telemetry_interval:
                last_telemetry = now
                telem = self.controller.get_telemetry()
                telem["type"] = "telemetry"
                if angles:
                    telem["angles"] = angles
                await self.manager.broadcast(telem)

            await asyncio.sleep(0.01)

    async def start(self):
        """Start all background tasks."""
        if self.use_controller:
            self._controller_task = asyncio.create_task(
                self.controller.start_controller()
            )
            logger.info("Controller input task started")

        self._gait_task = asyncio.create_task(self.gait_loop())
        logger.info("Gait loop started")

    async def stop(self):
        """Stop all background tasks gracefully."""
        self._shutdown = True

        # Cancel gait task
        if self._gait_task and not self._gait_task.done():
            self._gait_task.cancel()
            try:
                await self._gait_task
            except asyncio.CancelledError:
                pass
            logger.info("Gait loop stopped")

        # Cancel controller task
        if self._controller_task and not self._controller_task.done():
            self._controller_task.cancel()
            try:
                await self._controller_task
            except asyncio.CancelledError:
                pass
            logger.info("Controller task stopped")


def create_lifespan(runtime: RuntimeManager):
    """Create a lifespan context manager for FastAPI.

    Args:
        runtime: RuntimeManager instance

    Returns:
        Async context manager for FastAPI lifespan
    """
    @asynccontextmanager
    async def lifespan(app: FastAPI):
        """Lifespan context manager for startup and shutdown events."""
        # Startup
        await runtime.start()

        yield

        # Shutdown
        await runtime.stop()
        logger.info("Shutdown complete")

    return lifespan
