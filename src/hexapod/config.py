"""Centralized configuration for hexapod robot.

This module provides a single source of truth for all configuration values,
accessible via API, CLI, and Python code.

Profile System:
    - Profiles are stored in ~/.hexapod/profiles/ directory
    - Each profile is a separate JSON file (e.g., default.json, outdoor_rough.json)
    - Profile metadata (descriptions, default profile) stored in ~/.hexapod/profiles.json
    - The active profile is tracked and can be switched at runtime

This module re-exports all public APIs from the internal config modules:
    - config_defaults: Default configuration values
    - config_core: HexapodConfig class
    - config_profiles: ProfileManager class
"""

from typing import Optional

# Re-export from config_core
from .config_core import HexapodConfig

# Re-export from config_profiles
from .config_profiles import ProfileManager

# Re-export default values for convenience
from .config_defaults import (
    DEFAULTS,
    DEFAULT_STEP_HEIGHT,
    DEFAULT_STEP_LENGTH,
    DEFAULT_CYCLE_TIME,
    DEFAULT_BODY_HEIGHT,
    DEFAULT_LEG_SPREAD,
    DEFAULT_GAITS,
    DEFAULT_POSES,
)

# Global instances for singleton pattern
_global_config: Optional[HexapodConfig] = None
_profile_manager: Optional[ProfileManager] = None


def get_profile_manager() -> ProfileManager:
    """Get global profile manager instance.

    Returns:
        Global ProfileManager instance
    """
    global _profile_manager
    if _profile_manager is None:
        _profile_manager = ProfileManager()
    return _profile_manager


def reset_profile_manager() -> None:
    """Reset global profile manager (for testing).

    This resets both the profile manager and any cached global config
    to ensure a clean slate for tests.
    """
    global _profile_manager, _global_config
    _profile_manager = None
    _global_config = None


def get_config(profile: Optional[str] = None) -> HexapodConfig:
    """Get configuration for a profile.

    This function provides the main entry point for accessing configuration.

    Behavior:
        - If a config was explicitly set via set_config(), returns that config
          (unless a specific profile is requested)
        - Otherwise, returns the config for the specified profile (or current profile)

    Args:
        profile: Profile name (uses current if None)

    Returns:
        HexapodConfig instance
    """
    # If a config was explicitly set via set_config(), use it
    global _global_config
    if _global_config is not None and profile is None:
        return _global_config

    return get_profile_manager().get_config(profile)


def set_config(config: HexapodConfig) -> None:
    """Set global configuration instance.

    This is used for testing and legacy compatibility.
    The set config will be returned by get_config() until reset.

    Args:
        config: HexapodConfig instance
    """
    global _global_config
    _global_config = config


# Ensure backward compatibility by defining all exports
__all__ = [
    # Classes
    'HexapodConfig',
    'ProfileManager',
    # Functions
    'get_config',
    'set_config',
    'get_profile_manager',
    'reset_profile_manager',
    # Default values
    'DEFAULTS',
    'DEFAULT_STEP_HEIGHT',
    'DEFAULT_STEP_LENGTH',
    'DEFAULT_CYCLE_TIME',
    'DEFAULT_BODY_HEIGHT',
    'DEFAULT_LEG_SPREAD',
    'DEFAULT_GAITS',
    'DEFAULT_POSES',
]
