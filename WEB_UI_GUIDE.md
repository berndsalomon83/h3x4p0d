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
| **A** or **Arrow Left** | Turn left |
| **D** or **Arrow Right** | Turn right |
| **Q** | Rotate in place (counter-clockwise) |
| **E** | Rotate in place (clockwise) |
| **Space** | Toggle walking on/off |
| **Tab** | Open/close settings panel |
| **Escape** | Emergency stop |
| **?** | Show keyboard shortcuts help |

**Combining keys:**
- **W + A**: Forward-left diagonal
- **W + D**: Forward-right diagonal
- **Q/E**: Rotate without forward movement

### Method 2: On-Screen Arrow Buttons 🎮

Located in the **"Movement Controls"** section:
- **↑ FWD**: Move forward
- **↓ BACK**: Move backward
- **← LEFT**: Turn left
- **→ RIGHT**: Turn right

Click and hold buttons, or click multiple buttons simultaneously for diagonal movement.

### Method 3: Rotation Controls

Located below the directional arrows:
- **Q button**: Rotate counter-clockwise (left)
- **E button**: Rotate clockwise (right)

Click and hold for continuous rotation in place.

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

---

## Web Interface Layout

```
╔════════════════════════════════════════╗
║  3D CANVAS (occupies full screen)      ║
║                                        ║
║  ┌────────── CONTROL PANEL ────────┐  ║
║  │ ↑ FWD    ← LEFT  RIGHT →        │  ║
║  │ ↓ BACK                           │  ║
║  │                                  │  ║
║  │ Gait: [Tripod ▼]                │  ║
║  │ Speed: [====●========] 50%       │  ║
║  │                                  │  ║
║  │ Direction: 0°  Speed: 0%         │  ║
║  │ [Start Walking]                  │  ║
║  │                                  │  ║
║  │ Temperature: 25.0°C              │  ║
║  │ Battery: 12.00V                  │  ║
║  │                                  │  ║
║  │ [Activity Log - last 10 lines]   │  ║
║  └──────────────────────────────────┘  ║
╚════════════════════════════════════════╝
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
| **A / Arrow Left** | Turn left |
| **D / Arrow Right** | Turn right |
| **Q** | Rotate left (in place) |
| **E** | Rotate right (in place) |
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
