Hexapod Controller for Raspberry Pi
====================================

A complete Python-based hexapod (6-legged robot) controller with:

- **Hardware abstraction**: servo control (PCA9685 I2C driver) and sensor reading (temperature, battery)
- **Gait engine**: tripod, wave, and ripple walking modes with configurable step height/length
- **Web interface**: FastAPI server with real-time 3D simulator (Three.js) and telemetry dashboard
- **Body pose control**: pitch, roll, and yaw adjustments for dynamic body positioning
- **Emergency stop**: hardware-style safety button with keyboard shortcut
- **Controller input**: Bluetooth/joystick gamepad support or keyboard
- **Full simulation**: test and tune your hexapod in software before running on hardware

Requirements
============

- **Python**: 3.10+
- **Poetry**: https://python-poetry.org/
- **Hardware** (optional):
  - Raspberry Pi (4B+ recommended)
  - PCA9685 PWM driver (I2C, 16-channel servo controller)
  - 6x 3-joint hexapod leg assembly with servos
  - Battery and power management (12V typical for servo-grade hardware)
  - Optional: DS18B20 temperature sensor, ADC for battery voltage monitoring

Quick Start (Development)
=========================

1. **Clone/enter the project directory**:
   ```bash
   cd hexapod
   ```

2. **Install dependencies** using Poetry:
   ```bash
   poetry install
   ```

3. **Run the web server** (on your development machine or Raspberry Pi):
   ```bash
   poetry run python -m hexapod.main
   ```

   This starts two servers:
   - **Main UI**: `http://localhost:8000` - 3D simulator and controls
   - **Configuration**: `http://localhost:8001` - Geometry, gaits, servo calibration, and profiles

4. **Open in a browser**:
   - Navigate to `http://localhost:8000` for the main control interface
   - Use the **Gait Mode** dropdown to select walk pattern
   - Click **Start** to begin simulation
   - Watch the 3D hexapod simulator move
   - Monitor **Temperature** and **Battery** voltage
   - Open `http://localhost:8001` to configure geometry, calibration, and profiles

5. **Test the code**:
   ```bash
   poetry run pytest tests -v
   ```

   The repository also includes `run_tests.sh` for a one-command run with coverage output.

Hardware Setup (Raspberry Pi)
=============================

### 1. Install Hardware Dependencies

On a Raspberry Pi with the optional extras:

```bash
poetry install --extras pi
```

This installs:
- `adafruit-pca9685` - I2C PWM driver library
- `adafruit-motor` - servo control helpers
- `pigpio` - low-level GPIO (optional)
- `RPi.GPIO` - GPIO alternative (optional)

### 2. Wire the PCA9685

Connect PCA9685 via I2C to Raspberry Pi:
- **GND** → GND
- **V+ (power)** → 5V (or separate 5V supply)
- **SDA** → GPIO 2 (I2C SDA)
- **SCL** → GPIO 3 (I2C SCL)
- **Servo channels 0-17**: attach 18 servos (6 legs × 3 joints)

### 3. Configure & Calibrate (Dedicated page)

The configuration workspace lives at **http://localhost:8000/config.html** and opens alongside the controller UI. Use it to:
- Select a profile (Default, Outdoor Rough, Indoor Demo, Calibration) and target (Simulation/Real/Both)
- Walk through tabs for Geometry, Servos & Calibration, Body Posture, Gaits, Safety & Limits, System & Network, and Logging
- Map servo channels to leg joints, set offsets/limits, and test angles with sliders
- Adjust body/leg dimensions, stance width/height, gait cycle time, and step length/height
- Configure safety limits, E-Stop behavior, and logging levels
- Save changes directly to `~/.hexapod/config.json` so they persist across restarts

**Configuration Tabs:**

| Tab | Description |
|-----|-------------|
| Geometry | Body dimensions, leg lengths, attachment points |
| Servos & Calibration | Channel mapping, angle offsets, limits |
| Body Posture | Height, roll, pitch, yaw, leg spread |
| Gaits | Templates (tripod, wave, ripple), cycle time, step parameters |
| Sensors & Cameras | IMU device/filter settings, foot contact sensors, camera configuration |
| Control & Input | Control modes (keyboard/gamepad/autonomous), gamepad mapping, input tuning |
| Safety & Limits | Speed limits, temperature threshold, tilt correction, E-Stop |
| System & Network | Hostname, port, authentication, timezone |
| Logging | Per-module log levels (kinematics, servo, sensors, gait, network) |

The controller UI remains available at `http://localhost:8000` for live driving once configuration is saved.

For CLI-based calibration (legacy):
```bash
poetry run python -c "from hexapod.calibrate import interactive_calibration; interactive_calibration()"
```

### 4. Adjust Leg Geometry

Leg dimensions are configured via the settings panel in the web UI, or by editing
`~/.hexapod/config.json`. Default values (in mm):

```json
{
  "leg_coxa_length": 15.0,
  "leg_femur_length": 50.0,
  "leg_tibia_length": 55.0
}
```

Per-leg dimensions can also be set individually (leg0_coxa_length, etc.)
for robots with asymmetric leg configurations.

Body dimensions in `src/hexapod/config.py`:
- `body_width`: 100.0mm (lateral distance between leg attachment points)
- `body_length`: 120.0mm (longitudinal distance)

### 5. Run on Hardware

```bash
poetry run python -m hexapod.main
```

Then access the web UI from any device on your network.

Command-Line API Tool
=====================

The `hexapod-api` CLI provides full control over the robot from the terminal:

### Basic Usage
```bash
hexapod-api status              # Get current status
hexapod-api sensors             # Get sensor readings
hexapod-api run true            # Start walking
hexapod-api run false           # Stop walking
hexapod-api stop                # Emergency stop
hexapod-api gait wave           # Set gait mode
```

### Configuration
```bash
hexapod-api config              # Get full configuration
hexapod-api keys                # List all config keys (grouped)
hexapod-api keys leg            # Filter keys containing 'leg'
hexapod-api get step_height     # Get a specific value
hexapod-api set body_height 100 # Set body height to 100mm
hexapod-api set step_length 50  # Set step length
hexapod-api set cycle_time 1.5  # Set gait cycle time
```

### Poses
```bash
hexapod-api poses               # List all poses
hexapod-api pose low_stance     # Get specific pose details
hexapod-api apply low_stance    # Apply a pose
hexapod-api create-pose "My Pose" --height 100 --leg-spread 110
hexapod-api record-pose "Current"  # Record current position as pose
hexapod-api delete-pose my_pose    # Delete a pose
```

### Profiles
```bash
hexapod-api profiles            # List profiles
hexapod-api profile-switch outdoor     # Switch to profile
hexapod-api profile-create myprofile   # Create new profile
hexapod-api profile-create myprofile --copy-from outdoor
hexapod-api profile-delete myprofile   # Delete a profile
hexapod-api profile-default outdoor    # Set default profile
```

### Options
- `--host / -H` - API host (default: localhost)
- `--port / -p` - API port (default: 8000)
- `--compact / -c` - Compact JSON output (for scripting)

Controller Input
================

### Web UI Keyboard Controls

When using the web interface:
- **W/A/S/D** or **Arrow Keys**: Move forward/left/back/right
- **Q/E**: Walk and turn left/right (differential steering, like a tank)
- **SPACE**: Toggle walking on/off
- **TAB**: Open/close settings panel
- **ESCAPE**: Emergency stop
- **?**: Show keyboard shortcuts help

Note: Q/E keys make the hexapod walk forward while turning (differential steering).
A/D or Left/Right arrows strafe sideways without turning the body.

### CLI Keyboard (Development)

When running in keyboard mode from terminal:
- **W/A/S/D**: Move forward/left/back/right
- **SPACE**: Stop motion
- **1/2/3**: Switch to tripod/wave/ripple gait
- **Q**: Quit

### Joystick/Gamepad (Bluetooth or USB)

If `inputs` library is installed and a gamepad is connected:
- **Left stick (Y-axis)**: forward/backward
- **Left stick (X-axis)**: turn left/right
- **LB/RB buttons**: switch gait modes
- **Start**: run
- **Select**: stop

Install joystick support:
```bash
pip install inputs
```

File Structure
==============

```
hexapod/
├── pyproject.toml              # Poetry project config
├── README.md                   # This file
├── src/hexapod/
│   ├── __init__.py
│   ├── main.py                 # Entry point (runs both web servers)
│   ├── config.py               # Centralized configuration manager
│   ├── hardware.py             # Servo and sensor abstraction
│   ├── gait.py                 # Gait engine and inverse kinematics
│   ├── controller_bluetooth.py # Input controller (joystick/keyboard)
│   ├── web.py                  # Main FastAPI server + WebSocket
│   ├── calibrate_web.py        # Web-based servo calibration server
│   ├── calibrate.py            # CLI servo calibration (legacy)
│   ├── cli_api.py              # Command-line API tool (hexapod-api)
│   └── test_runner.py          # Legacy test entry point (pytest preferred)
├── web_static/
│   ├── index.html              # Main web UI (3D simulator and controls)
│   ├── config.html             # Configuration web UI (geometry, gaits, profiles)
│   ├── config.css              # Configuration page styles
│   ├── config.js               # Configuration page JavaScript
│   ├── calibrate.html          # Servo calibration web UI
│   ├── app.js                  # 3D simulator and controls (JavaScript)
│   └── favicon.svg             # Hexapod icon
└── tests/                      # pytest suite (unit + integration)
```

Key Modules
===========

### hardware.py

- **`ServoController`**: abstract base for servo drivers
- **`MockServoController`**: in-memory stub for testing
- **`PCA9685ServoController`**: real I2C PWM driver for Raspberry Pi
- **`SensorReader`**: temperature and battery voltage reading (mock or real)

### gait.py

- **`GaitEngine`**: generates leg joint angles over time for a selected walking mode
  - Supports differential steering via `turn_rate` for tank-style turning
  - Tracks ground contact state for telemetry
- **`InverseKinematics`**: solves for servo angles given target (x, y, z) foot positions
- Supports **tripod**, **wave**, and **ripple** gaits with configurable speed/height

### config.py

- **`HexapodConfig`**: centralized configuration manager
  - Leg geometry (per-leg customization supported)
  - Servo calibration offsets
  - Gait parameters and visualization settings
  - Safety limits and E-Stop configuration
  - System settings and logging levels
  - Persists to `~/.hexapod/config.json`
- **`get_config()`**: global configuration accessor

**Key Configuration Categories:**

| Category | Keys | Description |
|----------|------|-------------|
| Safety | `safety_max_translation_speed`, `safety_max_rotation_speed`, `safety_temperature_limit`, `safety_max_body_tilt_*` | Motion and thermal limits |
| E-Stop | `estop_action`, `estop_on_comm_loss`, `estop_on_servo_error`, `estop_on_tilt_exceeded` | Emergency stop triggers |
| System | `system_hostname`, `system_web_port`, `system_require_auth`, `system_api_token` | Network and authentication |
| Logging | `log_level_kinematics`, `log_level_servo`, `log_level_sensors`, `log_level_gait`, `log_level_network` | Per-module log verbosity |
| IMU | `imu_device`, `imu_filter_type`, `imu_sample_rate`, `imu_roll_offset`, `imu_pitch_offset`, `imu_yaw_offset` | IMU sensor configuration |
| Sensors | `foot_sensor_enabled`, `foot_sensor_type`, `foot_sensor_threshold` | Foot contact detection |
| Control | `control_mode`, `control_default_mode`, `gamepad_deadzone`, `gamepad_expo_curve` | Input mode and tuning |

### controller_bluetooth.py

- **`GenericController`**: unified input handler (joystick or keyboard)
- **`MotionCommand`**: structured command events (move, gait, start/stop)
- **`BLEDeviceScanner`**: optional BLE device discovery

### web.py

- **`HexapodController`**: main coordinator for gait, servo, sensor, and body pose state
- **`ConnectionManager`**: manages WebSocket clients for telemetry broadcast
- REST endpoints:
  - `/api/gait`, `/api/run`, `/api/stop`, `/api/status`, `/api/sensors`
  - `/api/body_pose` (GET/POST): body pitch, roll, yaw control
  - `/api/rotation` (POST): rotation in place speed
  - `/api/emergency_stop` (POST): halt all movement and reset
- WebSocket: `/ws` for real-time telemetry and servo angles
- Background loop updates servos and broadcasts state at ~50ms intervals

### web_static/ (UI)

- **`index.html`**: responsive web interface with control panel
- **`app.js`**: Three.js 3D simulator, WebSocket client, and event handlers
  - Real-time leg visualization with shadows
  - Gait mode selector and body pose controls
  - Camera presets (front, side, top, isometric)
  - Emergency stop button and keyboard shortcuts
  - Rotation in place controls
  - Live sensor telemetry display

Testing & Validation
====================

- **Unit + integration tests**: `poetry run pytest tests -v`
  - Covers hardware mocks, sensors, gait generation, IK reachability/solutions, Bluetooth controller events, FastAPI REST/WebSocket endpoints, poses, profiles, and configuration management.
  - **262 tests** covering all major functionality
- **Coverage/HTML report**: `./run_tests.sh`
- **Linting**: `ruff check .` (configuration in `pyproject.toml`)

The `tests/README.md` file documents the current test suite, markers, and coverage breakdown if you need more detail.

Troubleshooting
===============

**"I2C device not found"**
- Verify PCA9685 is connected and powered
- Run `i2cdetect -y 1` on Raspberry Pi to check (default address: 0x40)
- Check `~/.hexapod_calibration.json` exists and is valid JSON

**"adafruit_pca9685 not installed"**
- Run: `poetry install --extras pi`
- Or manually: `pip install adafruit-pca9685 adafruit-motor`

**Servos not moving on hardware**
- Run calibration tool to verify mapping
- Check servo power supply (servos draw significant current)
- Test individual channels with calibration tool

**3D simulator not moving**
- Check browser console for WebSocket errors (F12)
- Verify web server is running and accessible
- Ensure firewall allows port 8000

Next Steps & Improvements
=========================

1. **Tuning**: Adjust gait parameters via settings panel for smoother movement
2. **IK refinement**: Implement proper forward kinematics validation
3. **Vision**: Integrate camera + OpenCV for obstacle detection
4. **SLAM**: Add lidar/SLAM for autonomous navigation
5. **Logging**: Persistent telemetry recording and playback
6. **Advanced gaits**: Implement metachronal wave or insect-inspired patterns
7. **Mobile UI**: Optimize touch controls for tablets and phones

Contributing
============

This is a foundation framework. Extend with:
- Your leg geometry and servo mapping
- Real sensor drivers (DS18B20, ADC, etc.)
- Custom gaits and motion planners
- Vision-based navigation
- Safety and robustness features

License
=======

MIT (or your preferred license)

Author
======

Hexapod Controller - Python hexapod robotics framework
Created December 2025

Questions & Support
===================

For issues, clarifications, or contributions:
- Check test output and logs
- Verify calibration and wiring on hardware
- Review inline code comments for implementation details

