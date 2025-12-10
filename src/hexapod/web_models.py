"""Pydantic models for web API request/response payloads.

These models provide type safety and automatic validation for all API endpoints.
The external JSON shape remains compatible with existing clients and tests.
"""

from typing import Optional, List, Dict, Any, Literal
from pydantic import BaseModel, Field


# ============ Gait Models ============

class SetGaitRequest(BaseModel):
    """Request to set the active gait mode."""
    mode: str = Field(..., description="Gait mode: tripod, wave, ripple, creep")


class SetGaitParamsRequest(BaseModel):
    """Request to update gait parameters."""
    step_height: Optional[float] = Field(None, ge=10.0, le=50.0, description="Vertical lift during swing (mm)")
    step_length: Optional[float] = Field(None, ge=10.0, le=80.0, description="Forward/backward swing distance (mm)")
    cycle_time: Optional[float] = Field(None, ge=0.5, le=3.0, description="Duration of one gait cycle (seconds)")


class ManageGaitsRequest(BaseModel):
    """Request to manage gait configurations."""
    action: Literal["enable", "disable", "update"]
    gait: str = Field(..., description="Gait ID")
    updates: Optional[Dict[str, Any]] = Field(None, description="Updates for 'update' action")


# ============ Run/Stop Models ============

class RunStopRequest(BaseModel):
    """Request to start or stop walking."""
    run: bool = Field(False, description="True to start walking, False to stop")


# ============ Body Pose Models ============

class SetBodyHeightRequest(BaseModel):
    """Request to set body height."""
    height: float = Field(60.0, ge=30.0, le=200.0, description="Body height in mm")


class SetBodyPoseRequest(BaseModel):
    """Request to set body pose angles."""
    pitch: Optional[float] = Field(None, ge=-30.0, le=30.0, description="Forward/backward tilt in degrees")
    roll: Optional[float] = Field(None, ge=-30.0, le=30.0, description="Side-to-side tilt in degrees")
    yaw: Optional[float] = Field(None, ge=-45.0, le=45.0, description="Rotation around vertical axis in degrees")


class SetLegSpreadRequest(BaseModel):
    """Request to set leg spread percentage."""
    spread: float = Field(100.0, ge=50.0, le=150.0, description="Leg spread percentage (100=default)")


class SetRotationRequest(BaseModel):
    """Request to set rotation speed."""
    speed: float = Field(0.0, ge=-180.0, le=180.0, description="Rotation speed in degrees/second")


# ============ Pose Management Models ============

class PoseCreateRequest(BaseModel):
    """Request to create a new pose."""
    action: Literal["create"] = "create"
    name: str = Field(..., min_length=1, description="Display name for the pose")
    category: str = Field("operation", description="Category: operation, rest, debug")
    height: float = Field(120.0, ge=30.0, le=200.0, description="Body height in mm")
    roll: float = Field(0.0, ge=-30.0, le=30.0, description="Roll angle in degrees")
    pitch: float = Field(0.0, ge=-30.0, le=30.0, description="Pitch angle in degrees")
    yaw: float = Field(0.0, ge=-45.0, le=45.0, description="Yaw angle in degrees")
    leg_spread: float = Field(100.0, ge=50.0, le=150.0, description="Leg spread percentage")


class PoseUpdateRequest(BaseModel):
    """Request to update an existing pose."""
    action: Literal["update"] = "update"
    pose_id: str = Field(..., description="ID of the pose to update")
    name: Optional[str] = None
    category: Optional[str] = None
    height: Optional[float] = Field(None, ge=30.0, le=200.0)
    roll: Optional[float] = Field(None, ge=-30.0, le=30.0)
    pitch: Optional[float] = Field(None, ge=-30.0, le=30.0)
    yaw: Optional[float] = Field(None, ge=-45.0, le=45.0)
    leg_spread: Optional[float] = Field(None, ge=50.0, le=150.0)


class PoseDeleteRequest(BaseModel):
    """Request to delete a pose."""
    action: Literal["delete"] = "delete"
    pose_id: str = Field(..., description="ID of the pose to delete")


class PoseApplyRequest(BaseModel):
    """Request to apply a pose."""
    action: Literal["apply"] = "apply"
    pose_id: str = Field(..., description="ID of the pose to apply")


class PoseRecordRequest(BaseModel):
    """Request to record current position as a pose."""
    action: Literal["record"] = "record"
    name: str = Field(..., min_length=1, description="Name for the recorded pose")
    category: str = Field("operation", description="Category: operation, rest, debug")


# ============ Profile Management Models ============

class ProfileCreateRequest(BaseModel):
    """Request to create a new profile."""
    action: Literal["create"] = "create"
    name: str = Field(..., min_length=1, description="Profile name")
    copyFrom: Optional[str] = Field(None, description="Profile to copy settings from")
    description: Optional[str] = Field("", description="Profile description")


class ProfileDeleteRequest(BaseModel):
    """Request to delete a profile."""
    action: Literal["delete"] = "delete"
    name: str = Field(..., description="Profile name to delete")


class ProfileRenameRequest(BaseModel):
    """Request to rename a profile."""
    action: Literal["rename"] = "rename"
    oldName: str = Field(..., description="Current profile name")
    newName: str = Field(..., min_length=1, description="New profile name")


class ProfileSetDefaultRequest(BaseModel):
    """Request to set default profile."""
    action: Literal["set-default"] = "set-default"
    name: str = Field(..., description="Profile name to set as default")


class ProfileSwitchRequest(BaseModel):
    """Request to switch active profile."""
    action: Literal["switch"] = "switch"
    name: str = Field(..., description="Profile name to switch to")


class ProfileUpdateRequest(BaseModel):
    """Request to update profile metadata."""
    action: Literal["update"] = "update"
    name: str = Field(..., description="Profile name")
    description: Optional[str] = None


# ============ Config Models ============

class ConfigSetRequest(BaseModel):
    """Request to set configuration values."""
    # Allow arbitrary keys for config updates
    class Config:
        extra = "allow"


class ServoOffsetRequest(BaseModel):
    """Request to set servo calibration offset."""
    leg: int = Field(..., ge=0, le=5, description="Leg index (0-5)")
    joint: int = Field(..., ge=0, le=2, description="Joint index (0-2)")
    offset: float = Field(0.0, ge=-90.0, le=90.0, description="Offset angle in degrees")


class ServoAngleRequest(BaseModel):
    """Request to set a servo angle for testing."""
    leg: int = Field(..., ge=0, le=5, description="Leg index (0-5)")
    joint: int = Field(..., ge=0, le=2, description="Joint index (0-2)")
    angle: float = Field(90.0, ge=0.0, le=180.0, description="Servo angle in degrees")


# ============ Calibration Models ============

class CalibrationUpdateRequest(BaseModel):
    """Request to update servo calibration mappings."""
    calibration: Dict[str, int] = Field(..., description="Mapping of 'leg,joint' to channel number")


# ============ Bluetooth Models ============

class BluetoothConnectRequest(BaseModel):
    """Request to connect to a Bluetooth device."""
    address: str = Field(..., min_length=1, description="Bluetooth device address")


# ============ Patrol Models ============

class PatrolRouteRequest(BaseModel):
    """Request to create/update a patrol route."""
    id: Optional[str] = None
    name: str = Field("New Route", description="Route name")
    description: str = Field("", description="Route description")
    type: Literal["polyline", "polygon"] = Field("polyline", description="Route type")
    coordinates: List[Dict[str, float]] = Field(default_factory=list, description="Route coordinates")
    color: str = Field("#4fc3f7", description="Display color")
    priority: Literal["low", "normal", "high"] = Field("normal", description="Priority level")
    created_at: Optional[float] = None


class PatrolStartRequest(BaseModel):
    """Request to start patrol on a route."""
    route_id: str = Field(..., description="Route ID to patrol")
    speed: Optional[int] = Field(None, ge=0, le=100, description="Patrol speed percentage")
    mode: Optional[Literal["loop", "bounce", "once", "random"]] = None
    pattern: Optional[Literal["lawnmower", "spiral", "perimeter", "random"]] = None
    detection_targets: Optional[List[str]] = None
    detection_sensitivity: Optional[int] = Field(None, ge=0, le=100)


class PatrolSettingsRequest(BaseModel):
    """Request to update patrol settings."""
    speed: Optional[int] = Field(None, ge=0, le=100)
    mode: Optional[Literal["loop", "bounce", "once", "random"]] = None
    pattern: Optional[Literal["lawnmower", "spiral", "perimeter", "random"]] = None
    waypoint_pause: Optional[int] = Field(None, ge=0)
    detection_targets: Optional[List[str]] = None
    detection_sensitivity: Optional[int] = Field(None, ge=0, le=100)


class PatrolDetectionRequest(BaseModel):
    """Request to add a detection."""
    type: str = Field("unknown", description="Detection type")
    confidence: float = Field(0.0, ge=0.0, le=1.0, description="Confidence score")
    lat: float = Field(0.0, description="Latitude")
    lng: float = Field(0.0, description="Longitude")
    timestamp: Optional[float] = None
    image_url: Optional[str] = None


# ============ WebSocket Message Models ============

class WSSetGaitMessage(BaseModel):
    """WebSocket message to set gait mode."""
    type: Literal["set_gait"] = "set_gait"
    mode: str


class WSWalkMessage(BaseModel):
    """WebSocket message to start/stop walking."""
    type: Literal["walk"] = "walk"
    walking: bool = False


class WSMoveMessage(BaseModel):
    """WebSocket message for movement control."""
    type: Literal["move"] = "move"
    walking: bool = False
    speed: float = Field(0.5, ge=0.0, le=1.0)
    heading: float = 0.0
    turn: float = Field(0.0, ge=-1.0, le=1.0)


class WSBodyHeightMessage(BaseModel):
    """WebSocket message to set body height."""
    type: Literal["body_height"] = "body_height"
    height: float = Field(60.0, ge=30.0, le=200.0)


class WSLegSpreadMessage(BaseModel):
    """WebSocket message to set leg spread."""
    type: Literal["leg_spread"] = "leg_spread"
    spread: float = Field(100.0, ge=50.0, le=150.0)


class WSBodyPoseMessage(BaseModel):
    """WebSocket message to set body pose."""
    type: Literal["body_pose"] = "body_pose"
    pitch: Optional[float] = Field(None, ge=-30.0, le=30.0)
    roll: Optional[float] = Field(None, ge=-30.0, le=30.0)
    yaw: Optional[float] = Field(None, ge=-45.0, le=45.0)


class WSPosePresetMessage(BaseModel):
    """WebSocket message to apply a pose preset."""
    type: Literal["pose"] = "pose"
    preset: Literal["stand", "crouch", "neutral"] = "neutral"


class WSApplyPoseMessage(BaseModel):
    """WebSocket message to apply a saved pose."""
    type: Literal["apply_pose"] = "apply_pose"
    pose_id: str


# ============ Validation Helpers ============

def validate_body_height(value: float) -> float:
    """Validate and clamp body height to safe range."""
    return max(30.0, min(200.0, value))


def validate_body_pose(pitch: Optional[float] = None, roll: Optional[float] = None,
                       yaw: Optional[float] = None) -> Dict[str, float]:
    """Validate and clamp body pose values."""
    result = {}
    if pitch is not None:
        result['pitch'] = max(-30.0, min(30.0, pitch))
    if roll is not None:
        result['roll'] = max(-30.0, min(30.0, roll))
    if yaw is not None:
        result['yaw'] = max(-45.0, min(45.0, yaw))
    return result


def validate_leg_spread(value: float) -> float:
    """Validate and clamp leg spread to safe range."""
    return max(50.0, min(150.0, value))


def validate_gait_params(step_height: Optional[float] = None,
                        step_length: Optional[float] = None,
                        cycle_time: Optional[float] = None) -> Dict[str, float]:
    """Validate and clamp gait parameters."""
    result = {}
    if step_height is not None:
        result['step_height'] = max(10.0, min(50.0, step_height))
    if step_length is not None:
        result['step_length'] = max(10.0, min(80.0, step_length))
    if cycle_time is not None:
        result['cycle_time'] = max(0.5, min(3.0, cycle_time))
    return result
