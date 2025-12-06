"""Pytest configuration and shared fixtures."""
import pytest
import sys
from pathlib import Path

# Add src to path for all tests
sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


@pytest.fixture(autouse=True)
def reset_global_config():
    """Reset global config state before and after each test."""
    from hexapod.config import reset_profile_manager
    reset_profile_manager()
    yield
    reset_profile_manager()


@pytest.fixture
def mock_servo():
    """Provide a MockServoController instance."""
    from hexapod.hardware import MockServoController
    return MockServoController()


@pytest.fixture
def mock_sensor():
    """Provide a SensorReader instance in mock mode."""
    from hexapod.hardware import SensorReader
    return SensorReader(mock=True)


@pytest.fixture
def inverse_kinematics():
    """Provide an InverseKinematics instance with standard leg dimensions."""
    from hexapod.gait import InverseKinematics
    return InverseKinematics(coxa_len=30, femur_len=60, tibia_len=80)


@pytest.fixture
def gait_engine():
    """Provide a GaitEngine instance with default parameters."""
    from hexapod.gait import GaitEngine
    return GaitEngine(step_height=25.0, step_length=40.0, cycle_time=1.0)


@pytest.fixture
def hexapod_config():
    """Provide a HexapodConfig instance with temporary file."""
    import tempfile
    from hexapod.config import HexapodConfig

    with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
        f.write('{}')  # Write valid empty JSON
        config_file = Path(f.name)

    config = HexapodConfig(config_file=config_file)
    yield config

    # Cleanup
    if config_file.exists():
        config_file.unlink()
