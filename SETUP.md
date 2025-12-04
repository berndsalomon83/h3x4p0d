HEXAPOD SETUP & CONFIGURATION GUIDE
====================================

This guide walks you through setting up the Hexapod Controller on your Raspberry Pi 
and configuring it for your specific robot hardware.

TABLE OF CONTENTS
=================
1. Prerequisites
2. Software Installation
3. Hardware Wiring
4. Servo Calibration
5. Testing & Validation
6. Troubleshooting

---

1. PREREQUISITES
================

### Raspberry Pi Setup

Minimum: Raspberry Pi 4B with 2GB RAM (4GB+ recommended)
Recommended OS: Raspberry Pi OS (Lite or Desktop, 32-bit or 64-bit)

Update your system:
```bash
sudo apt update
sudo apt upgrade
```

Enable I2C (for PCA9685):
```bash
sudo raspi-config
  # Interfacing Options → I2C → Enable
  # Reboot when prompted
```

Verify I2C is enabled:
```bash
i2cdetect -y 1
```

### Hardware Requirements

- **PCA9685 16-Channel PWM I2C Servo Controller**
  - Address: 0x40 (default)
  - Power: 5V
  - I2C: SCL (GPIO 3), SDA (GPIO 2)

- **Servo Motor Assembly**
  - 6 legs × 3 joints = 18 servos total
  - Power: typically 5-6V (check your servos)
  - Peak current: 5-10A (use quality power supply)

- **Power Supply**
  - 12V for main logic (or Raspberry Pi USB-C 5V)
  - 5-6V for servos (separate supply recommended)
  - Battery monitoring: optional ADC (MCP3008 or ADS1115)

- **Temperature Sensor (optional)**
  - DS18B20 on GPIO 4 (1-wire)
  - Or CPU temp reading (built-in)

---

2. SOFTWARE INSTALLATION
========================

### Step 1: Clone Project

```bash
cd ~
git clone <your-repo-url> hexapod
cd hexapod
```

Or if you already have the files:
```bash
cd ~/hexapod
```

### Step 2: Install Poetry

```bash
curl -sSL https://install.python-poetry.org | python3 -
export PATH="$HOME/.local/bin:$PATH"
```

Verify installation:
```bash
poetry --version
```

### Step 3: Install Python Dependencies

Standard installation (mock mode):
```bash
poetry install
```

With hardware support (PCA9685, GPIO):
```bash
poetry install --extras pi
```

This installs:
- FastAPI, Uvicorn (web framework)
- Bleak (Bluetooth)
- Inputs (joystick)
- Adafruit PCA9685 & motor libraries
- Pigpio (optional GPIO)
- RPi.GPIO (optional GPIO)

### Step 4: Test Installation

Run the test suite:
```bash
poetry run python -m hexapod.test_runner
```

Expected output:
```
============================================================
HEXAPOD TEST SUITE
============================================================

✓ MockServoController: basic operation
✓ SensorReader: mock readings and calibration
✓ InverseKinematics: reachability and solving
✓ GaitEngine: all modes, time progression
✓ GaitEngine: leg synchronization verified
✓ Continuous operation: 625 steps over 10.0s (simulated)

============================================================
Results: 6 passed, 0 failed
============================================================
```

---

3. HARDWARE WIRING
==================

### 3.1 PCA9685 I2C Wiring

```
Raspberry Pi          PCA9685
-----------           -------
GPIO 2 (SDA) -------- SDA
GPIO 3 (SCL) -------- SCL
GND -----+------------ GND
         |
         (shared with 5V supply)
5V -----+------------- V+ (VCC)
        |
        └--→ Servo Power Supply (5-6V @ 10A)
```

**IMPORTANT**: Use a separate 5V power supply for servos. The Pi cannot supply 
enough current for 18 servos. A 5A+ supply is typical for 6-legged robots.

### 3.2 Servo Connections

Each servo has 3 pins: GND, VCC, Signal

PCA9685 has 16 channels (CH0-CH15). Connect servos:
- **Channel 0-2**: Leg 0 (coxa, femur, tibia)
- **Channel 3-5**: Leg 1
- **Channel 6-8**: Leg 2
- **Channel 9-11**: Leg 3
- **Channel 12-14**: Leg 4
- **Channel 15-17**: Leg 5 (use external PWM for 17 if needed)

Standard servo pinout:
```
Brown/Black = GND
Red = VCC
Yellow/Orange = Signal → PCA9685 channel
```

### 3.3 Optional: Temperature Sensor

DS18B20 (1-wire, on GPIO 4):
```
Pi GPIO 4 ----[4.7kΩ]---+--- VCC (3.3V)
                         |
                    DS18B20
                     1 | | 3
                  GND--| |--Data
                       | |
                       +--
(Typical pinout: 1=GND, 2=Data, 3=VCC)
```

Load 1-wire module:
```bash
sudo modprobe w1-gpio
sudo modprobe w1-therm
```

Read temperature:
```bash
cat /sys/bus/w1/devices/28-*/w1_slave
```

### 3.4 Optional: Battery Voltage Monitoring

Use MCP3008 ADC on SPI or ADS1115 on I2C:

MCP3008 (SPI):
```
Pi SPI0         MCP3008
-------         -------
GPIO 11 (MOSI) -- DIN
GPIO 9 (MISO)  -- DOUT
GPIO 10 (CLK)  -- CLK
GPIO 8 (CS0)   -- CS
GND ----------- VSS
3.3V ---------- VDD
Analog 0 ------ Battery voltage (via voltage divider)
```

---

4. SERVO CALIBRATION
====================

### Step 1: Verify Hardware

After wiring, test that PCA9685 is detected:

```bash
i2cdetect -y 1
```

Output should show `40` at address 0x40:
```
     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f
00:          -- -- -- -- -- -- -- -- -- -- -- -- --
10: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
20: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
30: -- -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
40: 40 -- -- -- -- -- -- -- -- -- -- -- -- -- -- --
```

### Step 2: Run Calibration Tool

```bash
poetry run python -c "from hexapod.calibrate import interactive_calibration; interactive_calibration()"
```

This interactive tool:
1. Detects PCA9685 or uses mock mode
2. Maps each leg/joint to a servo channel
3. Tests each servo at 90° (neutral)
4. Saves configuration to `~/.hexapod_calibration.json`

Example session:
```
============================================================
HEXAPOD SERVO CALIBRATION TOOL
============================================================

Use PCA9685 hardware? (y/n, default: n): y
✓ PCA9685 connected

Leg/joint → servo channel mapping:
(Enter channel number or press Enter to skip)

  Leg 0 (coxa) → channel [0]: 
  Leg 0 (femur) → channel [1]: 
  Leg 0 (tibia) → channel [2]: 
  ...
```

### Step 3: Manual Testing

Once calibrated, test individual servos:

```bash
python3 << 'EOF'
from hexapod.hardware import PCA9685ServoController

servo = PCA9685ServoController()
# Test leg 0, coxa (channel 0)
servo.set_servo_angle(0, 0, 90)  # set to 90° (neutral)
EOF
```

You should hear/see the servo move to neutral position.

### Step 4: Adjust Leg Geometry

Edit `src/hexapod/gait.py` and set your actual leg dimensions:

```python
LEG_COXA_LEN = 30.0    # horizontal segment (mm)
LEG_FEMUR_LEN = 60.0   # upper leg segment (mm)
LEG_TIBIA_LEN = 80.0   # lower leg segment (mm)

# Leg attachment points on body (relative to center)
LEG_POSITIONS = [
    (60, 50),    # leg 0: front-right
    (0, 50),     # leg 1: mid-right
    (-60, 50),   # leg 2: rear-right
    (-60, -50),  # leg 3: rear-left
    (0, -50),    # leg 4: mid-left
    (60, -50),   # leg 5: front-left
]
```

---

5. TESTING & VALIDATION
=======================

### Run Unit Tests

```bash
poetry run python -m hexapod.test_runner
```

All 6 tests should pass. Verify:
- Servo controller operation
- Sensor readings
- Inverse kinematics
- Gait generation
- Continuous simulation

### Start Web Server

Development (mock mode):
```bash
poetry run python -m hexapod.main
```

Hardware mode:
```bash
HEXAPOD_USE_HARDWARE=1 poetry run python -m hexapod.main
```

Output should show:
```
INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)
```

### Open Web UI

From another machine on the same network:
```
http://<raspberry-pi-ip>:8000
```

You should see:
- 3D hexapod simulator
- Gait mode selector (Tripod, Wave, Ripple)
- Start/Stop button
- Live temperature and battery voltage
- Control log

### Test Motion

1. Select a gait mode (start with "Wave" for smooth, slow movement)
2. Click "Start"
3. Watch the 3D simulator
4. Observe real servos on hardware

Expected behavior:
- **Tripod**: 3 legs move together, very stable
- **Wave**: smooth front-to-back motion, slowest
- **Ripple**: balanced between speed and stability

---

6. TROUBLESHOOTING
==================

### "I2C device not found" or i2cdetect shows no 0x40

**Causes:**
- I2C not enabled (check raspi-config)
- PCA9685 not powered
- Wrong I2C bus (should be bus 1)
- Address jumpers set incorrectly

**Fix:**
```bash
# Enable I2C
sudo raspi-config
# Interfacing Options → I2C → Enable

# Check PCA9685 is powered (red LED should be on)
# Verify wiring: SDA=GPIO2, SCL=GPIO3

# Re-detect
i2cdetect -y 1
```

### Servos not moving on hardware

**Causes:**
- Calibration missing or incorrect
- Servo power supply not connected
- Channel mapping wrong
- Servo signal pin not connected

**Fix:**
```bash
# Verify calibration file exists
cat ~/.hexapod_calibration.json

# Check servo power (should be 5-6V, 0A idle)
# Re-run calibration tool
poetry run python -c "from hexapod.calibrate import interactive_calibration; interactive_calibration()"

# Test individual servo in Python
python3 << 'EOF'
from hexapod.hardware import PCA9685ServoController
servo = PCA9685ServoController()
servo.set_servo_angle(0, 0, 90)  # should move
EOF
```

### Jerky or incorrect servo movement

**Causes:**
- Servo calibration off (min/max angles)
- Power supply sag (insufficient current)
- Servo mechanical issue (stiff or broken)

**Fix:**
- Measure min/max pulse width for your servo (typically 500-2500 µs)
- Upgrade power supply (5A+ recommended)
- Test servo in isolation (pulse directly with oscilloscope)

### 3D Simulator not updating

**Causes:**
- WebSocket connection failed
- Browser console errors
- Server not running

**Fix:**
```bash
# Check server is running
ps aux | grep hexapod

# View browser console (F12)
# Check for WebSocket errors

# Restart server
poetry run python -m hexapod.main
```

### Temperature/battery readings wrong

**Causes:**
- Sensor not connected
- Wrong ADC channel
- Software reading wrong pin

**Fix:**
- Verify DS18B20 or ADC wiring
- Update sensor code in `hardware.py` with correct GPIO/I2C address
- Test sensor directly:
  ```bash
  # DS18B20
  cat /sys/bus/w1/devices/28-*/w1_slave
  
  # ADS1115
  python3 << 'EOF'
  import board
  import busio
  import adafruit_ads1x15.analog_in as AnalogIn
  from adafruit_ads1x15.analog_in import AnalogIn
  import adafruit_ads1x15.ads1115 as ADS
  
  i2c = busio.I2C(board.SCL, board.SDA)
  ads = ADS.ADS1115(i2c)
  channel = AnalogIn(ads, ADS.P0)
  print(f"Channel 0: {channel.value} ({channel.voltage:.2f}V)")
  EOF
  ```

### Performance/lag issues

- Reduce gait frequency in `GaitEngine.__init__()`
- Close other processes on Pi
- Upgrade to Pi 4B or 5B
- Use wired Ethernet instead of WiFi

---

NEXT STEPS
==========

1. Run hardware calibration and validate servo ranges
2. Adjust leg geometry parameters for your specific robot
3. Fine-tune gait parameters (step height, length, cycle time)
4. Add safety limits (servo position min/max, current monitoring)
5. Implement advanced gaits (insect gaits, turning, etc.)
6. Add vision/lidar for autonomous navigation
7. Package as systemd service for auto-startup

---

SUPPORT
=======

For questions or issues:
1. Check test output: `poetry run python -m hexapod.test_runner`
2. Review logs: `journalctl -u hexapod.service` (if using systemd)
3. Check hardware wiring and power supplies
4. Consult PCA9685 and servo datasheets
5. Open an issue with error messages and hardware details

Good luck with your hexapod! 🦗
