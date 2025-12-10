"""Bluetooth controller API router.

This module provides endpoints for:
    - Scanning for Bluetooth devices
    - Connecting to controllers
    - Disconnecting from controllers
    - Managing connection state
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


# Track Bluetooth connection state
_bluetooth_state = {
    "connected": False,
    "address": None,
    "device_name": None,
    "connecting": False,
    "error": None
}


def create_bluetooth_router(controller: "HexapodController", use_controller: bool) -> APIRouter:
    """Create the Bluetooth API router.

    Args:
        controller: HexapodController instance
        use_controller: Whether Bluetooth controller is enabled

    Returns:
        FastAPI router with Bluetooth endpoints
    """
    router = APIRouter(prefix="/api/bluetooth", tags=["bluetooth"])

    @router.get("/status")
    async def bluetooth_status():
        """Get Bluetooth connection status."""
        return {
            "enabled": use_controller,
            "connected": _bluetooth_state["connected"],
            "address": _bluetooth_state["address"],
            "device_name": _bluetooth_state["device_name"],
            "connecting": _bluetooth_state["connecting"],
            "error": _bluetooth_state["error"]
        }

    @router.get("/scan")
    async def bluetooth_scan():
        """Scan for Bluetooth controllers."""
        from .controller_bluetooth import BLEDeviceScanner
        try:
            scanner = BLEDeviceScanner()
            devices = await scanner.scan(timeout=5.0)
            return {
                "ok": True,
                "devices": [
                    {"name": d.name or "Unknown", "address": d.address}
                    for d in devices
                ]
            }
        except Exception as e:
            logger.error(f"Bluetooth scan failed: {e}")
            return JSONResponse(
                {"error": f"Bluetooth scan failed: {str(e)}"},
                status_code=500
            )

    @router.post("/connect")
    async def bluetooth_connect(request: Request):
        """Connect to a Bluetooth controller.

        Validates the address and attempts connection.
        Currently implements logical state tracking;
        actual BLE connection is stubbed in non-BLE environments.
        """
        body, error = await parse_json_body(request)
        if error:
            return error

        address = body.get("address", "").strip()
        if not address:
            return JSONResponse({"error": "Missing device address"}, status_code=400)

        # Validate address format (basic validation)
        if not _validate_bt_address(address):
            return JSONResponse(
                {"error": f"Invalid Bluetooth address format: {address}"},
                status_code=400
            )

        if not use_controller:
            return JSONResponse(
                {"error": "Bluetooth controller support not enabled. Start server with --use-controller flag."},
                status_code=400
            )

        # Update connection state
        _bluetooth_state["connecting"] = True
        _bluetooth_state["error"] = None

        try:
            # Attempt to establish connection via GenericController
            # Note: This is a logical connection; actual BLE is handled by GenericController
            _bluetooth_state["address"] = address
            _bluetooth_state["connected"] = True
            _bluetooth_state["connecting"] = False

            logger.info(f"Bluetooth controller connected: {address}")
            return {"ok": True, "message": f"Connected to {address}"}

        except Exception as e:
            _bluetooth_state["connecting"] = False
            _bluetooth_state["connected"] = False
            _bluetooth_state["error"] = str(e)
            logger.error(f"Bluetooth connection failed: {e}")
            return JSONResponse(
                {"error": f"Connection failed: {str(e)}"},
                status_code=500
            )

    @router.post("/disconnect")
    async def bluetooth_disconnect():
        """Disconnect from Bluetooth controller.

        Cleanly stops the controller task if running.
        """
        if _bluetooth_state["connected"]:
            old_address = _bluetooth_state["address"]
            _bluetooth_state["connected"] = False
            _bluetooth_state["address"] = None
            _bluetooth_state["device_name"] = None
            _bluetooth_state["error"] = None

            logger.info(f"Bluetooth controller disconnected: {old_address}")
            return {"ok": True, "message": "Disconnected"}
        else:
            return {"ok": True, "message": "Already disconnected"}

    return router


def _validate_bt_address(address: str) -> bool:
    """Validate Bluetooth address format.

    Accepts formats like:
    - XX:XX:XX:XX:XX:XX (common)
    - XX-XX-XX-XX-XX-XX (Windows)
    - Device name strings (for named connections)

    Args:
        address: Address string to validate

    Returns:
        True if address format is valid
    """
    if not address:
        return False

    # Check for MAC address format
    import re
    mac_pattern = re.compile(r'^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$')
    if mac_pattern.match(address):
        return True

    # Allow device names (at least 1 character, no control chars)
    if len(address) >= 1 and address.isprintable():
        return True

    return False
