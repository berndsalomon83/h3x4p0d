# Hexapod Configuration & Calibration Guide

## Overview

Your hexapod now has a complete configuration system for servo calibration, Bluetooth controllers, and camera settings.

### Dedicated Configuration Page

The configuration workspace is available at **http://localhost:8000/config.html** whenever the web server is running. It provides:
- Profile switching (Default, Outdoor Rough, Indoor Demo, Calibration) and target selection (Simulation/Real/Both)
- Navigation tabs for **Overview & Profiles**, **Geometry & Frames**, **Servos & Calibration**, **Body Posture & Poses**, **Gaits & Timing**, **Power & Safety**, and **Networks & Telemetry**
- Live connection status with an E-STOP control and battery indicator so you can verify the robot is reachable before applying changes

**How to use it**
1. Start the server (`poetry run python -m hexapod.main`) and open `http://localhost:8000/config.html` in your browser.
2. Pick a profile and target in the header, then walk through each tab:
   - **Geometry & Frames**: set body dimensions, leg link lengths, and coordinate frames.
   - **Servos & Calibration**: map channels, set offsets/limits, and run the calibration wizard.
   - **Body Posture & Poses**: tune stance height/width and save named poses.
   - **Gaits & Timing**: choose gait mode and adjust step length/height and cycle time.
   - **Power & Safety**: review battery state, enable/disable power rails, and configure E-STOP behavior.
   - **Networks & Telemetry**: configure camera feeds, logging, and BLE diagnostics.
3. Use **Save/Apply** buttons within each tab to persist settings; the backend writes to `~/.hexapod/config.json` so values survive restarts.
4. Switch to the Controller UI (`http://localhost:8000`) to drive the robot with the new configuration.

## What's Been Fixed

### ✅ 1. Camera Orientation
- **Before**: Camera showed side view (diagonal angle)
- **After**: Camera now shows **front view** by default
- You can still rotate the camera by dragging with the mouse

### ✅ 2. Coxa Visualization
- **Before**: Legs appeared disconnected from body
- **After**: Legs now properly connect to the body at the coxa joints

### ✅ 3. Leg Animation
- **Before**: Legs were horizontal/squashed (IK solver bug)
- **After**: Legs point downward in proper hexapod stance
- Walking animation works correctly for all gait modes (tripod, wave, ripple)

## New Features

### 🆕 Servo Calibration System

Each of your 18 servos (6 legs × 3 joints) can have individual offset calibration:

**Purpose**: Compensate for mechanical variations between servos
- Some servos might be mounted slightly off-angle
- Manufacturing tolerances vary between servos
- This system lets you fine-tune each servo individually

**How it works**:
1. Servo offsets are stored in `~/.hexapod/config.json`
2. Offsets are automatically applied to ALL servo commands
3. Range: -90° to +90° offset per servo

**API Endpoints**:

```bash
# Get current configuration
GET /api/config

# Set servo offset for Leg 0, Coxa joint (+5°)
POST /api/config/servo_offset
{
  "leg": 0,
  "joint": 0,
  "offset": 5.0
}

# Test a servo manually (set Leg 0, Femur to 90°)
POST /api/servo/test
{
  "leg": 0,
  "joint": 1,
  "angle": 90.0
}
```

### 🆕 Bluetooth Controller Support

Control your hexapod with Bluetooth gamepads/controllers!

**Important**: Game controllers use **Classic Bluetooth** (not BLE), so they must be paired through your operating system's Bluetooth settings, not programmatically via the web UI.

**Setup Process**:

1. **Pair Controller via System Settings**:
   - Put your controller in pairing mode (hold pairing button)
   - Open **System Settings → Bluetooth** on your computer
   - Pair the controller there (appears as "Xbox Wireless Controller", "PS5 Controller", etc.)

2. **Start Server with Controller Support**:
   ```bash
   python -m hexapod.main --controller
   ```

3. **Controller Works Automatically**:
   - The `inputs` library will detect the paired controller
   - No additional configuration needed in the web UI

**Supported Controllers**:
- Xbox controllers (Xbox One, Series X/S)
- PlayStation controllers (PS4, PS5)
- Generic Bluetooth gamepads
- Any HID-compliant game controller

**Control Mapping** (from [controller_bluetooth.py](src/hexapod/controller_bluetooth.py)):
- **Left Stick**: Forward/backward movement
- **Right Stick**: Turning
- **LB/RB**: Change gait mode
- **Start**: Begin walking
- **Select**: Stop

**BLE Device Scanner** (diagnostic only):
The web UI includes a BLE device scanner for diagnostic purposes. This can show nearby Bluetooth Low Energy devices, but game controllers cannot be paired through this interface.

## Configuration Settings

All settings are stored in `~/.hexapod/config.json`:

### Servo Calibration
```json
{
  "servo_offset_leg0_joint0": 0.0,
  "servo_offset_leg0_joint1": 5.0,
  "servo_offset_leg0_joint2": -2.5,
  ...  // 18 servos total
}
```

### Leg Geometry
```json
{
  "leg_coxa_length": 30.0,
  "leg_femur_length": 60.0,
  "leg_tibia_length": 80.0
}
```

### Gait Parameters
```json
{
  "step_height": 25.0,
  "step_length": 40.0,
  "cycle_time": 1.2,
  "default_gait": "tripod"
}
```

### Camera View
```json
{
  "camera_view_angle": 0.0  // 0=front, 90=right, 180=back, 270=left
}
```

### Live Camera Layout
```json
{
  "camera_views": [
    {
      "id": "front",
      "label": "Front",
      "enabled": true,
      "position": "front",
      "source_type": "local",
      "source_url": ""
    }
  ]
}
```

## Calibration Process

### Step 1: Visual Inspection
1. Start the hexapod web interface
2. Watch the legs in standing position
3. Identify any legs that look misaligned

### Step 2: Individual Servo Adjustment
For each misaligned servo:

```python
# Example: Leg 2, Femur is 5° off
curl -X POST http://localhost:8000/api/config/servo_offset \
  -H "Content-Type: application/json" \
  -d '{"leg": 2, "joint": 1, "offset": 5.0}'
```

### Step 3: Test Mode
Test individual servos:

```python
# Move Leg 2, Femur to 90° (horizontal)
curl -X POST http://localhost:8000/api/servo/test \
  -H "Content-Type: application/json" \
  -d '{"leg": 2, "joint": 1, "angle": 90.0}'
```

### Step 4: Walking Test
1. Click "Run" in the web UI
2. Observe the walking gait
3. Adjust servo offsets if legs don't synchronize properly
4. Repeat until smooth

### Step 5: Save Configuration
Configuration is automatically saved when you make changes via the API.

## Bluetooth Controller Setup

### Pairing Process

**Game controllers must be paired through your operating system**, not the web UI:

1. Put controller in pairing mode (usually hold the pairing button for 3-5 seconds)
2. Open **System Settings → Bluetooth**
3. Wait for controller to appear in the list
4. Click to pair (it will show as "Xbox Wireless Controller", "PS5 Controller", etc.)
5. Once paired, start the hexapod server with the `--controller` flag:
   ```bash
   python -m hexapod.main --controller
   ```

### BLE Device Scanner (Optional)

The web UI includes a diagnostic BLE scanner. This is useful for:
- Discovering nearby BLE devices
- Testing Bluetooth functionality
- Debugging connectivity issues

```javascript
// In browser console (optional):
fetch('/api/bluetooth/scan')
  .then(r => r.json())
  .then(data => console.log('Found BLE devices:', data.devices));
```

**Note**: Game controllers won't appear in BLE scans or be connectable via this interface, as they use Classic Bluetooth.

## Next Steps

### TODO: Web UI Components (Future Enhancement)
The API endpoints are ready, but the web UI still needs visual components:

1. **Calibration Tab** (in settings panel):
   - 6 legs × 3 sliders per leg = 18 sliders
   - Live preview of servo angles
   - "Test Mode" button to manually move servos
   - "Reset All" button

2. **Bluetooth Tab** (in settings panel):
   - "Scan" button
   - List of discovered devices
   - "Connect/Disconnect" buttons
   - Connection status indicator

3. **Configuration Tab**:
   - Leg geometry inputs
   - Gait parameter sliders
   - Camera angle selector
   - "Save/Load Config" buttons

These can be added to [index.html](web_static/index.html) and [app.js](web_static/app.js) as needed.

## Testing

Start the server and test the endpoints:

```bash
# Start server
python -m hexapod.main --mock

# In another terminal, test calibration:
curl http://localhost:8000/api/config | jq

# Test servo:
curl -X POST http://localhost:8000/api/servo/test \
  -H "Content-Type: application/json" \
  -d '{"leg": 0, "joint": 1, "angle": 60}'

# Test Bluetooth scan:
curl http://localhost:8000/api/bluetooth/scan | jq
```

## Summary of Changes

| Component | Status | Description |
|-----------|--------|-------------|
| Camera View | ✅ Fixed | Now shows front view instead of side |
| Coxa Connection | ✅ Fixed | Legs connect to body properly |
| Leg Animation | ✅ Fixed | Proper standing/walking poses |
| Servo Calibration | ✅ Complete | API + backend ready |
| Bluetooth API | ✅ Complete | Scan/connect/disconnect endpoints |
| Config System | ✅ Complete | Save/load all settings |
| Web UI | 🔧 Partial | API ready, visual components pending |

The backend is **production-ready**. You can control everything via API calls. The frontend UI components for calibration and Bluetooth are next on the roadmap!
