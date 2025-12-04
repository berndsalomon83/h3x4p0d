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

- **Python**: 3.11+
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
   
   The server starts at `http://localhost:8000` or `http://<pi-ip>:8000` if on a Pi.

4. **Open in a browser**:
   - Navigate to `http://localhost:8000` 
   - Use the **Gait Mode** dropdown to select walk pattern
   - Click **Start** to begin simulation
   - Watch the 3D hexapod simulator move
   - Monitor **Temperature** and **Battery** voltage

5. **Test the code** (optional):
   ```bash
   poetry run python -m hexapod.test_runner
   ```

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

### 3. Calibrate Servos

Use the interactive calibration tool to map servo channels and test angles:

```bash
poetry run python -c "from hexapod.calibrate import interactive_calibration; interactive_calibration()"
```

This creates `~/.hexapod_calibration.json` with your servo mapping.

### 4. Adjust Leg Geometry

Edit `src/hexapod/gait.py` and set your leg segment lengths:

```python
LEG_COXA_LEN = 30.0    # mm - horizontal coxa segment
LEG_FEMUR_LEN = 60.0   # mm - upper leg segment
LEG_TIBIA_LEN = 80.0   # mm - lower leg segment
```

Also verify `LEG_POSITIONS` array matches your physical leg attachment points.

### 5. Run on Hardware

```bash
poetry run python -m hexapod.main
```

Then access the web UI from any device on your network.

Controller Input
================

### Web UI Keyboard Controls

When using the web interface:
- **W/A/S/D** or **Arrow Keys**: Move forward/left/back/right
- **Q/E**: Rotate left/right in place
- **SPACE**: Toggle walking on/off
- **TAB**: Open/close settings panel
- **ESCAPE**: Emergency stop
- **?**: Show keyboard shortcuts help

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
│   ├── main.py                 # Entry point (runs web server)
│   ├── hardware.py             # Servo and sensor abstraction
│   ├── gait.py                 # Gait engine and inverse kinematics
│   ├── controller_bluetooth.py # Input controller (joystick/keyboard)
│   ├── web.py                  # FastAPI server + WebSocket
│   ├── calibrate.py            # Interactive servo calibration
│   └── test_runner.py          # Unit tests
└── web_static/
    ├── index.html              # Web UI (HTML)
    └── app.js                  # 3D simulator and controls (JavaScript)
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
- **`InverseKinematics`**: solves for servo angles given target (x, y, z) foot positions
- Supports **tripod**, **wave**, and **ripple** gaits with configurable speed/height

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

Run the unit test suite:

```bash
poetry run python -m hexapod.test_runner
```

Tests cover:
- Servo controller basic operation
- Sensor reading and calibration
- Inverse kinematics (reachability, solving)
- Gait generation for all modes
- Continuous simulation operation

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
3. **Calibration UI**: Build a web page for servo tuning without CLI
4. **Vision**: integrate camera + OpenCV for obstacle detection
5. **SLAM**: add lidar/SLAM for autonomous navigation
6. **Logging**: persistent telemetry recording and playback
7. **Advanced gaits**: implement metachronal wave or insect-inspired patterns
8. **Mobile UI**: optimize touch controls for tablets and phones

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

