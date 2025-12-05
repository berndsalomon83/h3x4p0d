# Changelog

## 2025-12-11

### Test Suite Quality Review

- Strengthened calibration API tests by removing duplicated fixtures and asserting coverage/metadata returned by status and mapping endpoints. (tests/test_calibrate_web.py)
- Added new process-safety tests for server shutdown routines and calibration server bootstrap coverage to exercise host/port wiring. (tests/test_main.py)
- All new tests executed alongside the existing suite to guard against regressions. (tests)

## 2025-12-07

### Testing Improvements

- Added property-based tests for configuration and mock servo calibration to cover clamp boundaries, JSON round-trips, and calibration-aware servo commands using Hypothesis. (tests/test_config_properties.py)
- Declared Hypothesis and Ruff as development dependencies to support property-based testing and linting. (pyproject.toml)

## 2025-12-06

### Fixes

- Wired Q/E turn commands through the backend gait loop so walking turns are calculated server-side (rotation speed derived from differential steering) and reflected consistently in telemetry. Also added backend ground-contact telemetry derived from gait swing states to keep the UI indicators in sync with actual stance phases. (web_static/app.js, src/hexapod/web.py, src/hexapod/gait.py)

## 2025-12-05

### Architecture Changes

#### Removed Frontend IK Calculations - Backend-Only IK Architecture
- **Issue**: Frontend was calculating its own inverse kinematics (IK) in `computeNeutralAngles()` which could drift from the actual hexapod servo positions calculated by the backend
- **Symptom**: When adjusting body height slider, legs looked correct while dragging but became "malformed" when slider stopped (backend telemetry would override with different angles)
- **Root Cause**: Two separate IK implementations existed - one in Python backend (`gait.py`) and one in JavaScript frontend (`app.js`). The telemetry handler also incorrectly applied a sign flip for left-side legs.
- **Fix**:
  - Removed `computeNeutralAngles()` function from frontend
  - Replaced `applyNeutralPose()` with `applyDefaultVisualPose()` that uses fixed default angles (no IK calculation)
  - Removed sign flip in telemetry handler for femur/tibia angles (Three.js leg group rotations already handle left/right mirroring)
  - Added prominent architecture documentation comment at top of relevant section
- **Architecture Rule**: ALL inverse kinematics calculations MUST be performed on the backend (Python). The frontend ONLY displays what the backend sends via WebSocket telemetry. This ensures the 3D visualization accurately mirrors actual servo positions and prevents drift between simulated display and real hardware.
- **Files changed**: `web_static/app.js`

#### Fixed: Legs Flying in Air (IK Stance Width Calculation)
- **Issue**: Hexapod legs appeared to float in the air or IK failed with "out of reach" errors
- **Root Cause**: Backend IK used hardcoded stance_width values that didn't account for actual leg geometry. With custom leg lengths, the target could exceed the leg's maximum reach.
- **Fix**: Stance width is now calculated dynamically based on actual leg geometry from the IK solver:
  - Gets actual coxa, femur, tibia lengths from `self.gait.ik.L1/L2/L3`
  - Calculates maximum horizontal reach: `sqrt((0.85 * max_reach)² - vertical_drop²)`
  - Ensures foot position is always within reachable range
- **Files changed**: `src/hexapod/web.py`

#### Fixed: Q/E Keys and Rotation Controls
- **Issue**: Q/E keys did not work, rotation buttons didn't rotate the hexapod
- **Fix**:
  - **Q/E keys**: Walk-and-turn using differential steering (like a tank). Pressing Q walks forward while turning left, E walks forward while turning right. Different from A/D which strafe sideways without turning.
  - **Implementation**: Backend gait engine now supports `turn_rate` parameter (-1 to +1) that applies differential swing angles to left vs right legs. Right legs step less when turning right (and vice versa), creating a natural turning motion.
  - **Frontend**: Q/E set `currentTurnRate` and send it via the `turn` parameter in the move message.
  - **Rotation buttons** (mouse only): Body rotation while standing. Gait loop integrates `rotation_speed` over time to update `heading`, applied to all coxa angles.
  - **Duplicate handler removed**: Removed duplicate Q/E handlers from "Extended Keyboard Shortcuts" section.
- **Files changed**: `web_static/app.js`, `src/hexapod/web.py`, `src/hexapod/gait.py`

### Bug Fixes

#### Fixed: Hexapod not rendering and camera feature broken
- **Issue**: The hexapod 3D model was not showing up and camera features were broken
- **Cause**: JavaScript `ReferenceError` due to `webcamStream` variable being accessed before its declaration (temporal dead zone for `let` declarations)
- **Fix**: Moved `webcamStream` and `webcamOverlay` variable declarations before the `renderCameraDock()` function call in `web_static/app.js`
- **Files changed**: `web_static/app.js`

#### Fixed: Reconnect button disabled when server disconnected
- **Issue**: When the server connection was lost, clicking "Click to reconnect" didn't work because the entire control panel had pointer-events disabled
- **Cause**: The `.disconnected` CSS class disabled pointer-events on all elements, including the connectionStatus span used for reconnection
- **Fix**: Added CSS rule to keep `#connectionStatus` clickable even when disconnected (`pointer-events: auto`)
- **Files changed**: `web_static/index.html`

#### Fixed: Empty camera window showing on startup
- **Issue**: A camera pane would appear on startup without any video feed, showing only a placeholder
- **Cause**: Camera panes were rendered for all enabled camera views, even when the webcam wasn't started
- **Fix**: Modified `renderCameraDock()` to skip local camera panes when webcamStream is not active, and skip URL cameras when no source URL is configured
- **Files changed**: `web_static/app.js`

### UI Improvements

#### Camera Dock Layout Improvements
- **Issue**: Camera dock was overlaying the left control panel, and settings panel was behind camera views
- **Changes**:
  - Moved camera dock to the right side of the screen (starts at 310px from left) to avoid overlaying the left control panel
  - Increased settings panel z-index from 100 to 600 so it appears above camera views
  - Changed camera video `object-fit` from `cover` to `contain` to show full camera image without truncation
  - Simplified camera pane positioning to use CSS Grid auto-fit layout
- **Files changed**: `web_static/index.html`

#### Disconnected State Indicator
- **Feature**: Controls are now grayed out when the server connection is lost
- **Details**:
  - Added visual "disconnected" state that grays out the control panel when WebSocket connection is lost
  - Added a red "SERVER DISCONNECTED - Reconnecting..." banner at the top of the control panel
  - Controls become non-interactive (pointer-events disabled) when disconnected
  - The log section remains visible to show connection status
  - State automatically clears when connection is re-established
- **Files changed**: `web_static/index.html`, `web_static/app.js`

#### Camera Settings Persistence
- **Issue**: Camera settings were not persisted when server was restarted
- **Cause**: Config file created before `camera_views` feature was added didn't include it, and the load function wasn't merging defaults properly
- **Fix**: Updated `config.py` `load()` function to merge file values with defaults, ensuring new default keys (like `camera_views`) are preserved
- **Files changed**: `src/hexapod/config.py`

#### Camera Feed Ordering
- **Feature**: Camera feeds are now properly ordered in the dock
- **Details**:
  - Front camera feeds appear at the top of the dock
  - Left/Right camera feeds appear in the middle row
  - Rear camera feeds appear at the bottom
  - Uses CSS Grid template areas for consistent positioning
- **Files changed**: `web_static/index.html`

#### Draggable Floating Camera Panes
- **Feature**: Floating camera panes can now be dragged to any position on screen
- **Details**:
  - Drag floating panes by their header bar
  - Position is remembered during the session
  - Works with both mouse and touch input
  - Constrained to stay within viewport bounds
- **Files changed**: `web_static/app.js`

#### Favicon Added
- **Issue**: Browser was showing 404 error for `/favicon.ico`
- **Fix**:
  - Created SVG favicon with hexapod robot icon (`web_static/favicon.svg`)
  - Added favicon link tags in HTML head
  - Added `/favicon.ico` route in backend to serve the SVG
- **Files changed**: `web_static/index.html`, `web_static/favicon.svg` (new), `src/hexapod/web.py`

#### Per-Leg Configuration Support
- **Issue**: Changing leg dimensions (coxa, femur, tibia) for one leg was applying to all legs
- **Fix**: Implemented per-leg configuration storage and UI
- **Details**:
  - Backend now stores individual leg dimensions: `leg{N}_coxa_length`, `leg{N}_femur_length`, `leg{N}_tibia_length` for legs 0-5
  - Frontend loads and saves per-leg configuration independently
  - Changing one leg's dimensions no longer affects other legs
  - Reset function now resets all legs individually to defaults
- **Files changed**: `src/hexapod/config.py`, `web_static/app.js`

#### Unified Legs & Calibration UI
- **Feature**: Merged Legs and Calibration tabs into a single unified interface
- **Details**:
  - Removed separate Calibration tab button; all leg configuration is now in the Legs tab
  - Click a leg on the hexapod diagram to select it
  - Selected leg shows both dimension sliders (Coxa/Femur/Tibia length) and servo offset calibration
  - Dimension sliders update 3D visualization in real-time as you drag
  - Visual servo gauges show current offset values
  - Action buttons:
    - **Test**: Toggle test mode to preview servo positions in 3D view
    - **Copy to All**: Copy dimensions and offsets from selected leg to all other legs
    - **Reset Leg**: Reset selected leg's dimensions and offsets to defaults
  - Global actions:
    - **Reset All Legs**: Reset all leg dimensions and servo offsets to defaults
    - **Save All**: Persist all configuration to file
- **Files changed**: `web_static/index.html`, `web_static/app.js`

### Summary of Changes

| File | Changes |
|------|---------|
| `web_static/app.js` | **Removed frontend IK** - all inverse kinematics now backend-only; **Added Q/E keyboard shortcuts** for rotation; Fixed webcamStream declaration order; Added disconnected state management; Added draggable floating camera panes; Per-leg configuration support; Merged Legs & Calibration UI with dimension sliders, servo offsets, test mode, copy-to-all, and reset functions; Fixed camera dock to hide empty local camera panes |
| `web_static/index.html` | Camera dock moved right with proper grid ordering; Settings z-index increased; Added disconnected state CSS with reconnect clickable; Added favicon link; Combined Legs tab with dimension and calibration sliders |
| `web_static/favicon.svg` | New hexapod favicon icon |
| `src/hexapod/config.py` | Fixed config loading to merge with defaults; Added per-leg dimension storage |
| `src/hexapod/web.py` | Added favicon.ico route; **Fixed IK stance width** - now calculated dynamically from actual leg geometry to ensure feet reach the ground |
## 2025-12-08

### Calibration UI Enhancements

- Added calibration file metadata (path, existence, last modified, size) to API responses so the port 8001 UI can surface disk status immediately. (src/hexapod/calibrate_web.py)
- Refreshed the calibration interface with a configuration overview showing server endpoint, calibration file state, and mapping coverage for quick diagnostics. (web_static/calibrate.html)
- Added FastAPI TestClient coverage to ensure calibration endpoints expose metadata and create the calibration file on save. (tests/test_calibrate_web.py)

## 2025-12-09

### Calibration Test Sweep Alignment

- Updated the leg joint test buttons to sweep around each joint's currently selected angle instead of a fixed range, keeping movements symmetric and clamped to the slider limits for safer validation. (web_static/calibrate.html)

## 2025-12-10

### Calibration Configuration Assistant

- Added calibration coverage snapshots (mapped counts, unmapped joints, free channels) to the calibration API so the UI can guide setup with real-time status. (src/hexapod/calibrate_web.py)
- Refreshed the calibration page with a color-themed configuration assistant that highlights unmapped joints, available channels, and provides an auto-assign action plus updated quick-test styling. (web_static/calibrate.html)
- Expanded calibration tests to assert coverage metadata in status responses and mapping endpoints, ensuring the helper data remains available to the UI. (tests/test_calibrate_web.py)

