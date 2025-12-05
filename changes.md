# Changelog

## 2025-12-05

### Bug Fixes

#### Fixed: Hexapod not rendering and camera feature broken
- **Issue**: The hexapod 3D model was not showing up and camera features were broken
- **Cause**: JavaScript `ReferenceError` due to `webcamStream` variable being accessed before its declaration (temporal dead zone for `let` declarations)
- **Fix**: Moved `webcamStream` and `webcamOverlay` variable declarations before the `renderCameraDock()` function call in `web_static/app.js`
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

### Summary of Changes

| File | Changes |
|------|---------|
| `web_static/app.js` | Fixed webcamStream declaration order; Added disconnected state management; Added draggable floating camera panes; Per-leg configuration support |
| `web_static/index.html` | Camera dock moved right with proper grid ordering; Settings z-index increased; Added disconnected state CSS; Added favicon link |
| `web_static/favicon.svg` | New hexapod favicon icon |
| `src/hexapod/config.py` | Fixed config loading to merge with defaults; Added per-leg dimension storage |
| `src/hexapod/web.py` | Added favicon.ico route |
