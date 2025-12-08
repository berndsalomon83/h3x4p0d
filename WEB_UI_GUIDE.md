# Hexapod Web UI - Complete Guide

## Overview

The hexapod web interface features **full movement controls**, **real-time 3D visualization**, **body pose controls**, and **interactive gait selection**. You can drive the hexapod robot using keyboard, on-screen buttons, or speed/direction controls.

### Key Features
- **Movement controls**: Forward, backward, left, right, rotation in place
- **Body pose**: Pitch, roll, yaw adjustments for body tilting
- **Camera presets**: Front, side, top, and isometric views
- **Emergency stop**: Instantly halt all movement
- **Keyboard shortcuts**: Full keyboard control with help modal

## Quick Start (2 minutes)

### 1. Start the Server
```bash
cd /Users/berndsalomon/Documents/hexapod
poetry run python -m hexapod.main
# or
./.venv/bin/python3 -m hexapod.main
```

### 2. Open Browser
Navigate to: **http://localhost:8000**

### 3. Start Walking
1. Click **"Start Walking"** (green button)
2. Press arrow keys or **WASD** to move
3. Watch the 3D hexapod walk in real-time!

---

## Control Methods

### Method 1: Keyboard Controls (Recommended)

| Key | Action |
|-----|--------|
| **W** or **Arrow Up** | Move forward |
| **S** or **Arrow Down** | Move backward |
| **A** or **Arrow Left** | Strafe left (sideways) |
| **D** or **Arrow Right** | Strafe right (sideways) |
| **Q** | Walk and turn left (differential steering) |
| **E** | Walk and turn right (differential steering) |
| **Space** | Toggle walking on/off |
| **Tab** | Open/close settings panel |
| **Escape** | Emergency stop |
| **?** | Show keyboard shortcuts help |

**Combining keys:**
- **W + A**: Forward-left diagonal
- **W + D**: Forward-right diagonal

**Q/E vs A/D difference:**
- **A/D**: Strafe sideways (body faces forward, moves left/right)
- **Q/E**: Walk and turn (body rotates while walking forward, like a tank)

### Method 2: On-Screen Arrow Buttons 🎮

Located in the **"Movement Controls"** section:
- **↑ FWD**: Move forward
- **↓ BACK**: Move backward
- **← LEFT**: Turn left
- **→ RIGHT**: Turn right

Click and hold buttons, or click multiple buttons simultaneously for diagonal movement.

### Method 3: Rotation Controls

Located below the directional arrows:
- **Rotate Left button**: Rotate body counter-clockwise (while standing)
- **Rotate Right button**: Rotate body clockwise (while standing)

Click and hold for continuous rotation in place (body rotation only, no walking).

Note: For walk-and-turn motion (like a tank), use the **Q/E** keyboard keys instead.

### Method 4: Speed Slider

The **Speed** slider (0-100%) controls movement speed when no keyboard input is active.

**How it works:**
1. Move slider to desired speed
2. Use keyboard/buttons to move
3. Movement uses keyboard-controlled speed (slider is overridden)
4. Release all keys and movement will use slider speed

---

## Gait Selection

Three walking modes available via dropdown menu:

### 1. **Tripod Gait** (Default)
- **Speed**: Fast ⚡⚡⚡
- **Stability**: Very stable ⭐⭐⭐⭐⭐
- **Use case**: Rough terrain, speed priority
- **Appearance**: Two legs lift together, fast stepping

### 2. **Wave Gait**
- **Speed**: Slow ⚡
- **Stability**: Ultra-smooth ⭐⭐⭐⭐⭐
- **Use case**: Elegant movement, smooth video
- **Appearance**: Legs move sequentially, ballet-like

### 3. **Ripple Gait**
- **Speed**: Medium ⚡⚡
- **Stability**: Very stable ⭐⭐⭐⭐
- **Use case**: Balanced performance
- **Appearance**: Mixed leg groups, natural look

**To change gait:**
1. Select from dropdown (in settings panel, Gait tab)
2. Log shows: `[HH:MM:SS] Gait mode: [mode]`
3. Change takes effect immediately

---

## Emergency Stop

A large red **EMERGENCY STOP** button is always visible at the bottom-right of the screen.

**Activation methods:**
- Click the red emergency stop button
- Press **Escape** key

**What it does:**
- Immediately stops all walking
- Resets body pose (pitch, roll, yaw) to neutral
- Stops any rotation
- Resets speed to 0

---

## Camera Presets

A floating bar at the bottom-center provides quick camera view presets:

| Button | View | Description |
|--------|------|-------------|
| **Front** | 0° | View from front of hexapod |
| **Side** | 90° | View from right side |
| **Top** | Bird's eye | View from above |
| **Iso** | 45° | Isometric 3D view |

Click any preset to instantly snap the camera to that view. You can still manually rotate the view after selecting a preset.

---

## Body Pose Controls

Located in the Settings panel (Gait tab), body pose controls let you tilt and rotate the hexapod's body:

| Control | Range | Description |
|---------|-------|-------------|
| **Pitch** | -30° to +30° | Forward/backward tilt |
| **Roll** | -30° to +30° | Side-to-side tilt |
| **Yaw** | -45° to +45° | Rotation around vertical axis |

**Use cases:**
- Tilting forward to look down
- Leaning into turns
- Compensating for uneven terrain
- Creating dynamic postures

---

## Connection Status & Disconnected State

The web UI provides clear visual feedback about the server connection status:

### Connected State
- Connection status shows "Connected" in green
- All controls are fully interactive
- Telemetry updates in real-time

### Disconnected State
When the server connection is lost:
- A red **"SERVER DISCONNECTED - Reconnecting..."** banner appears at the top of the control panel
- All control sections are grayed out and become non-interactive
- The connection status shows "Disconnected" or "Reconnecting (n)..." in red/orange
- The activity log remains visible to show reconnection attempts
- Controls automatically become active again when connection is restored

**Auto-reconnection:**
- The UI automatically attempts to reconnect with exponential backoff
- Up to 10 reconnection attempts are made
- After max attempts, click "Click to reconnect" to manually retry

---

## Status Indicators

Located in the **"Status"** section of the control panel:

### Direction 🧭
Shows the heading in degrees:
- **0°** = Moving forward
- **90°** = Moving right
- **180°** = Moving backward
- **270°** = Moving left

### Speed 📈
Shows percentage of maximum movement speed:
- **0%** = Stationary
- **50%** = Half speed
- **100%** = Full speed

### Temperature 🌡️
Real-time temperature reading from hexapod system (mock: ~25°C in simulation)

### Battery 🔋
Power level in volts (mock: ~12V in simulation)
- **12.0-12.5V**: Good
- **11.5-12.0V**: OK
- **<11.5V**: Low (warning)

---

## Activity Log

The green text area at bottom shows activity log with timestamps:

```
[14:32:45] Connected to hexapod controller
[14:32:46] Gait mode: tripod
[14:32:47] Walking started
[14:32:48] Movement: heading=45°, speed=85%
[14:32:49] Gait mode: wave
```

**Log entries include:**
- Connection status
- Gait changes
- Walk start/stop
- Speed/direction changes
- Error messages (if any)

---

## 3D Visualization

### What You See
- **Ground**: Green base plane
- **Hexapod body**: Dark gray rectangular body
- **Legs**: Color-coded segments:
  - Brown: Coxa (base joint)
  - Purple: Femur (upper leg)
  - Green: Tibia (lower leg)

### Animation
The 3D model updates in real-time as the hexapod walks:
- Legs rotate smoothly based on selected gait
- Body remains relatively stable
- Shadows help visualize leg depth

### Camera Control
View can be adjusted using your browser's three.js controls (if enabled). Default view is an angled top-down perspective.

### Visual Settings Persistence

Visual settings are automatically saved to your browser's localStorage and restored when you refresh the page:

| Setting | Description |
|---------|-------------|
| **Ground Color** | Color of the ground plane |
| **Body Color** | Color of the hexapod body |
| **Sky Color** | Background color of the 3D scene |
| **Show Grid** | Toggle ground grid visibility |
| **Show Shadows** | Toggle shadow rendering |

**How it works:**
- Settings are saved automatically when changed
- Restored automatically on page load
- Use "Reset All Settings" in the Settings panel to restore defaults
- Settings persist per browser (stored in localStorage)

---

## Live Camera Views

The web UI supports multiple live camera feeds displayed in a dock at the bottom of the screen.

### Camera Dock Layout
- Camera views are displayed on the **right side** of the screen (to avoid overlaying the control panel on the left)
- Multiple cameras can be configured via the Settings panel (Camera tab)
- Cameras are ordered by position:
  - **Front** cameras appear at the top
  - **Left/Right** cameras appear in the middle row
  - **Rear** cameras appear at the bottom
  - **Floating** cameras can be dragged anywhere on screen

### Floating Camera Panes
- Set a camera's position to "Floating" to make it freely movable
- **Drag** the floating pane by clicking and holding its header bar
- Position is remembered during your session
- Floating panes appear above other UI elements

### Camera Configuration (Settings > Camera tab)
1. Click **"Add Camera"** to create a new camera view
2. Configure each camera:
   - **Label**: Display name for the camera
   - **Source Type**: "Local webcam" or "Stream URL"
   - **Stream URL**: RTSP or HTTP stream URL (for external cameras)
   - **Pane Position**: Where to display the camera (front/left/right/rear/floating)
   - **Enabled**: Toggle to show/hide the camera view
3. Click **"Save Layout"** to persist camera configuration

### Starting the Webcam
1. Open Settings > Camera tab
2. Click **"Start"** under "Webcam Feed"
3. Allow browser camera access when prompted
4. Camera will appear in configured camera panes

---

## Web Interface Layout

```
╔═══════════════════════════════════════════════════════════════╗
║  3D CANVAS (occupies full screen)                             ║
║                                                               ║
║  ┌─── CONTROL PANEL ───┐                    ┌─ SETTINGS ─┐   ║
║  │ ↑ FWD  ← →  ↓ BACK │                    │ (gear icon)│   ║
║  │                     │                    └────────────┘   ║
║  │ Gait: [Tripod ▼]   │                                      ║
║  │ Speed: [===●===]   │                                      ║
║  │                     │                                      ║
║  │ Status: Connected   │                                      ║
║  │ Direction: 0°       │                                      ║
║  │ [Start Walking]     │                                      ║
║  │                     │                                      ║
║  │ Temp: 25.0°C        │                                      ║
║  │ Battery: 12.00V     │                                      ║
║  │                     │                                      ║
║  │ [Activity Log]      │                                      ║
║  └─────────────────────┘                                      ║
║                                                               ║
║             [Front] [Side] [Top] [Iso]  <-- Camera Presets   ║
║                         ┌──────────────────────────────────┐ ║
║                         │ CAMERA DOCK (bottom-right)       │ ║
║                         │ [Camera 1] [Camera 2] ...        │ ║
║                         └──────────────────────────────────┘ ║
║                                              [EMERGENCY STOP] ║
╚═══════════════════════════════════════════════════════════════╝
```

---

## Tips & Tricks

### Smooth Movement
- Tap arrow keys rhythmically for smooth walking
- Hold keys for continuous movement
- Combine keys for diagonal movement

### Camera View
- Adjust your browser zoom (Ctrl/Cmd +/-) to see legs better
- Scroll to get different angles

### Debugging
- Check browser console (F12) for WebSocket errors
- Check activity log for command confirmation
- If hexapod doesn't move, check "Walking started" message

### Performance
- Movement updates at 100Hz
- Telemetry broadcasts at 20Hz (every 50ms)
- 3D rendering at ~60 FPS

---

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| **W / Arrow Up** | Move forward |
| **S / Arrow Down** | Move backward |
| **A / Arrow Left** | Strafe left (sideways) |
| **D / Arrow Right** | Strafe right (sideways) |
| **Q** | Walk and turn left (differential steering) |
| **E** | Walk and turn right (differential steering) |
| **Space** | Toggle walking on/off |
| **Tab** | Open/close settings panel |
| **Escape** | Emergency stop |
| **?** | Show keyboard shortcuts help |

**Browser shortcuts:**
| **Ctrl/Cmd +** | Zoom in browser |
| **Ctrl/Cmd -** | Zoom out browser |
| **F12** | Open browser developer tools |

### Keyboard Help Modal

Press **?** at any time to open a help modal showing all available keyboard shortcuts. Click anywhere outside the modal or press **?** again to close it.

---

## Troubleshooting

### Hexapod Not Moving
✅ **Solution:**
1. Click **"Start Walking"** (should turn red)
2. Log should show: `[HH:MM:SS] Walking started`
3. Press arrow keys
4. Check direction/speed displays update
5. If still not moving, check browser console (F12) for errors

### 3D Model Not Updating
✅ **Solution:**
1. Check WebSocket is connected (green "Connected" log message)
2. Press arrow keys to trigger movement
3. Check browser console for errors
4. Try refreshing page (Ctrl/Cmd + R)

### Server Not Starting
✅ **Solution:**
```bash
# Check Python is correct
cd /Users/berndsalomon/Documents/hexapod
./.venv/bin/python3 --version  # Should be 3.9+

# Try running directly
./.venv/bin/python3 -m hexapod.main

# Check port 8000 is free
lsof -i :8000
```

### Slow Performance
✅ **Solution:**
1. Close other browser tabs
2. Reduce browser zoom to default
3. Check CPU usage (Activity Monitor)
4. Try different gait mode (ripple is lighter than tripod)

---

## API Endpoints (Advanced)

For developers integrating with other systems:

```bash
# Get status
curl http://localhost:8000/api/status | jq

# Get sensor data
curl http://localhost:8000/api/sensors | jq

# Set gait
curl -X POST http://localhost:8000/api/gait \
  -H "Content-Type: application/json" \
  -d '{"mode": "wave"}'

# Start walking
curl -X POST http://localhost:8000/api/run \
  -H "Content-Type: application/json" \
  -d '{"run": true}'

# Stop walking
curl -X POST http://localhost:8000/api/stop

# Emergency stop (resets everything)
curl -X POST http://localhost:8000/api/emergency_stop

# Set body pose
curl -X POST http://localhost:8000/api/body_pose \
  -H "Content-Type: application/json" \
  -d '{"pitch": 10.0, "roll": 0.0, "yaw": 5.0}'

# Get body pose
curl http://localhost:8000/api/body_pose | jq

# Set rotation speed (degrees per second)
curl -X POST http://localhost:8000/api/rotation \
  -H "Content-Type: application/json" \
  -d '{"speed": 30.0}'
```

---

## Patrol Control System

The hexapod includes an autonomous patrol system for property protection and garden pest control (e.g., snail detection).

### Accessing Patrol Control
Navigate to: **http://localhost:8000/patrol** or click the **"Patrol"** link in the main UI navigation.

### Features

#### Interactive Map
- Uses Leaflet.js with OpenStreetMap tiles
- Pan and zoom to your property location
- Real-time hexapod position tracking marker

#### Creating Patrol Routes
1. Click **"Create Route"** button
2. Click on the map to add waypoints
3. Double-click or click the first vertex (pulsing red "1") to finish
4. Name your route and save

#### Creating Patrol Zones
1. Click **"Create Zone"** button
2. Click to add polygon vertices
3. Double-click or click the first vertex to close the polygon
4. Name your zone and save

#### Route/Zone Management
- Click any route or zone to select it
- Edit name, description, priority, and color
- Delete routes/zones you no longer need
- Routes and zones are saved to your config file

#### Detection Targets
Configure what the hexapod should look for:
- **Snails** - Garden pest control
- **People** - Property security
- **Animals** - Wildlife monitoring
- **Vehicles** - Driveway monitoring
- **Packages** - Delivery detection

#### Patrol Modes
- **Loop** - Continuously patrol the route
- **Bounce** - Go back and forth along the route
- **Once** - Single patrol run
- **Random** - Visit waypoints in random order

#### Zone Coverage Patterns
- **Lawnmower** - Systematic back-and-forth coverage
- **Spiral** - Outward or inward spiral pattern
- **Perimeter** - Walk the zone boundary
- **Random** - Random movement within zone

#### Alert Settings
Configure notifications when targets are detected:
- Sound alerts
- Browser notifications
- Email notifications
- Photo capture

#### Quick Actions
Manual navigation commands for immediate control during patrol.

### Patrol API Endpoints

```bash
# Get patrol status
curl http://localhost:8000/api/patrol/status | jq

# Get all routes/zones
curl http://localhost:8000/api/patrol/routes | jq

# Start patrol on a route
curl -X POST http://localhost:8000/api/patrol/start \
  -H "Content-Type: application/json" \
  -d '{"route_id": "route_123", "speed": 50, "mode": "loop"}'

# Stop patrol
curl -X POST http://localhost:8000/api/patrol/stop

# Pause patrol
curl -X POST http://localhost:8000/api/patrol/pause

# Resume patrol
curl -X POST http://localhost:8000/api/patrol/resume

# Get detections
curl http://localhost:8000/api/patrol/detections | jq

# Clear detections
curl -X DELETE http://localhost:8000/api/patrol/detections
```

### Current Limitations
The patrol UI is fully functional for route/zone creation and management. The following backend features are not yet implemented:
- Actual GPS-based waypoint navigation (requires GPS hardware)
- AI object detection (requires camera and ML model integration)
- Email alert delivery
- Scheduled patrol automation

---

## Limitations & Future Enhancements

### Current Limitations
- Mobile/touch controls not optimized
- Gamepad support not yet implemented in web UI
- Speed slider overridden by keyboard input

### Implemented Features
- Emergency stop button and keyboard shortcut
- Rotation in place (Q/E keys)
- Body pose controls (pitch, roll, yaw)
- Camera presets (front, side, top, iso)
- Keyboard shortcuts help modal
- Settings panel with gait configuration

### Planned Features
- Gamepad/joystick support in web UI
- Mobile-optimized touch controls
- Acceleration curves and momentum
- Telemetry recording and playback
- Custom gait editor
- Real hardware servo feedback visualization
- Obstacle avoidance visualization

---

## Next Steps

1. **Experiment with gaits**: Try all three and see which you prefer
2. **Customize speed**: Adjust slider to find your preferred speed
3. **Deploy to Pi**: Follow SETUP.md to run on actual Raspberry Pi
4. **Calibrate servos**: Use calibration tool for real hardware
5. **Extend features**: Check PROJECT_SUMMARY.md for extension points

---

## Support

For detailed architecture and troubleshooting:
- **README.md** - Main documentation
- **SETUP.md** - Hardware setup guide
- **PROJECT_SUMMARY.md** - Architecture and design
- **QUICK_REFERENCE.md** - API and command reference

---

**Happy hexapod walking!**
