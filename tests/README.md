# Hexapod Test Suite

Comprehensive test suite for the hexapod robot controller with **170 passing tests** (nearly doubled from original 88 tests).

## Test Coverage

### Unit Tests (123 tests)

#### Hardware Module ([test_hardware.py](test_hardware.py)) - 30 tests
- **MockServoController**: 18 tests
  - Initialization and basic operations
  - Setting and getting servo angles
  - Angle clamping (0-180 degrees)
  - Boundary value testing (0.0, 180.0)
  - Fractional angle precision
  - Multi-leg operations and independence
  - Angle persistence and updates
  - Partial leg configuration
  - Rapid update stress testing

- **SensorReader**: 12 tests
  - Mock mode initialization
  - Temperature and battery voltage reading
  - Calibration offsets (positive, negative, zero, large)
  - Partial calibration (temperature or battery only)
  - Repeated calibration changes
  - Mock value randomness and variation
  - Rapid read stress testing
  - Non-mock mode initialization

#### Gait Module ([test_gait.py](test_gait.py)) - 36 tests
- **InverseKinematics**: 15 tests
  - Initialization
  - Forward and side point solving
  - Reachability validation (too far/close)
  - Various reachable points across quadrants
  - Angle range validation
  - Negative and positive Z values
  - Boundary reach testing (maximum/minimum)
  - All XY quadrant coverage
  - Symmetry validation
  - Edge case handling

- **GaitEngine**: 21 tests
  - Initialization with defaults and custom parameters
  - Time progression and accumulation
  - All gait modes (tripod, wave, ripple)
  - Angle validity and range checking
  - Gait cycling and repetition
  - Leg synchronization
  - Continuous operation (600 and 6000 steps)
  - Gait mode differentiation and switching
  - Invalid gait mode handling
  - Zero and extreme parameter testing (cycle time, step height, step length)
  - Negative time delta handling
  - Exact cycle boundary behavior
  - Extended continuous operation testing

#### Config Module ([test_config.py](test_config.py)) - 17 tests
- **HexapodConfig**: 13 tests
  - Default initialization
  - Get/set operations
  - Bulk updates
  - Reset to defaults
  - Export (dict and JSON)
  - Save and load from file
  - Directory creation

- **Global Config**: 4 tests
  - Singleton instance management
  - Custom instance setting

#### Controller Module ([test_controller.py](test_controller.py)) - 40 tests
- **MotionCommand**: 10 tests
  - Initialization with various parameters
  - Different command types
  - Empty and nested data structures
  - Boolean and None values
  - Numeric types
  - Data key handling

- **GenericController**: 15 tests
  - Initialization and state management
  - Event callback registration (single and multiple)
  - Command emission and preservation
  - Exception handling in callbacks
  - Stop functionality (single and multiple)
  - Callback execution order
  - Joystick and button state
  - Return value handling
  - Multiple command emission

- **BLEDeviceScanner**: 10 tests
  - Initialization
  - Device callback registration
  - Callback emission and error handling
  - Graceful handling of missing dependencies
  - Device info structure validation
  - Callback order preservation
  - Multiple scan operations
  - Device info preservation

- **Integration**: 5 tests
  - Motion command to controller flow
  - State persistence across events

### Integration Tests (47 tests)

#### Web API ([test_web.py](test_web.py)) - 47 tests
- **REST Endpoints**: 20 tests
  - Status and sensor endpoints
  - Gait mode changes (tripod, wave, ripple)
  - Invalid gait handling
  - Missing parameters
  - Run/stop controls
  - State reflection and persistence
  - Multiple sequential operations
  - Sensor value validation and ranges
  - Concurrent request handling
  - Index and static file serving
  - Time field validation

- **WebSocket API**: 11 tests
  - Connection establishment
  - Gait commands via WebSocket
  - Walk commands
  - Move commands with speed/heading
  - Boundary value testing (min/max speed)
  - Speed clamping (negative and excessive values)
  - Various heading values
  - Invalid message type handling
  - Telemetry reception

- **HexapodController**: 11 tests
  - Initialization with dependencies
  - Telemetry collection and field validation
  - Servo update operations (running and stopped)
  - Motion command handling (move, gait, start, stop, quit)
  - Heading calculation
  - Invalid gait mode handling

- **ConnectionManager**: 5 tests
  - Message broadcasting
  - Connection management (single and multiple)
  - Disconnect handling
  - Broadcast exception handling

## Running Tests

### Run all tests:
```bash
.venv/bin/python -m pytest tests/ -v
```

### Run specific test file:
```bash
.venv/bin/python -m pytest tests/test_hardware.py -v
```

### Run with coverage:
```bash
.venv/bin/python -m pytest tests/ --cov=hexapod --cov-report=html
```

### Run specific marker:
```bash
.venv/bin/python -m pytest tests/ -v -m unit
.venv/bin/python -m pytest tests/ -v -m integration
```

### Run with detailed output:
```bash
.venv/bin/python -m pytest tests/ -vv --tb=long
```

## Test Markers

- `@pytest.mark.unit`: Unit tests for individual components
- `@pytest.mark.integration`: Integration tests for API endpoints
- `@pytest.mark.slow`: Slower running tests (e.g., continuous operation)
- `@pytest.mark.asyncio`: Async tests

## Code Coverage

Current coverage: **46%** overall

| Module | Coverage | Notes |
|--------|----------|-------|
| config.py | 100% | Fully tested |
| __init__.py | 100% | Fully tested |
| gait.py | 79% | Core functionality well tested |
| web.py | 68% | API endpoints tested |
| hardware.py | 47% | Mock mode tested, hardware mode untested |
| controller_bluetooth.py | 42% | Core tested, BLE/inputs integration untested |
| calibrate.py | 0% | Interactive tool, not unit tested |
| main.py | 0% | Entry point, integration tested manually |
| test_runner.py | 0% | Legacy test runner, superseded by pytest |

## Test Structure

```
tests/
├── __init__.py          # Empty module marker
├── conftest.py          # Shared fixtures and configuration
├── test_config.py       # Configuration management tests
├── test_controller.py   # Controller and Bluetooth tests
├── test_gait.py         # Gait generation and IK tests
├── test_hardware.py     # Hardware abstraction tests
├── test_web.py          # Web API and integration tests
└── README.md            # This file
```

## Dependencies

Testing requires the following packages (installed via pip or poetry):
- pytest ^7.4.0
- pytest-asyncio ^0.21.0
- pytest-cov ^4.1.0
- httpx ^0.24.0 (for FastAPI TestClient)

## Fixtures

Available fixtures in [conftest.py](conftest.py):
- `mock_servo`: MockServoController instance
- `mock_sensor`: SensorReader in mock mode
- `inverse_kinematics`: InverseKinematics with standard dimensions
- `gait_engine`: GaitEngine with default parameters
- `hexapod_config`: HexapodConfig with temporary file
- `client`: FastAPI TestClient (in test_web.py)

## Test Results

Latest test run:
- ✅ **170 tests** passed (increased from 88 tests)
- ❌ 0 tests failed
- ⏭️ 0 tests skipped

All tests pass successfully!

## Test Improvements Summary

The test suite has been significantly expanded to provide more comprehensive coverage:

### Expanded Test Areas:
1. **Gait Module** (+17 tests)
   - Added edge case testing for IK solver (all quadrants, boundaries, symmetry)
   - Added extreme parameter testing (zero/large cycle times, step heights)
   - Added extended continuous operation testing (6000 steps)
   - Added negative time delta and invalid mode handling

2. **Hardware Module** (+18 tests)
   - Added boundary value testing for servo angles
   - Added fractional angle precision testing
   - Added servo independence verification
   - Added calibration edge cases (zero, large offsets, partial calibration)
   - Added rapid update/read stress testing
   - Added sensor randomness validation

3. **Controller Module** (+24 tests)
   - Added motion command validation (nested data, booleans, None values)
   - Added controller edge cases (empty callbacks, multiple stops)
   - Added callback ordering verification
   - Added state preservation testing
   - Added BLE scanner edge cases (multiple scans, device info preservation)

4. **Web Module** (+22 tests)
   - Added WebSocket boundary value testing (speed clamping)
   - Added invalid message type handling
   - Added heading value testing
   - Added controller motion command integration
   - Added connection manager multi-client testing
   - Added broadcast exception handling
   - Added static file serving tests

### Test Quality Improvements:
- More comprehensive edge case coverage
- Better error condition testing
- Improved boundary value validation
- Enhanced integration test scenarios
- Stress testing for rapid operations
