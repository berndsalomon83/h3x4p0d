"""Profile management for hexapod configuration.

This module provides the ProfileManager class which handles:
- Multiple configuration profiles stored in ~/.hexapod/profiles/
- Profile metadata stored in ~/.hexapod/profiles.json
- Profile switching, creation, deletion, and renaming
"""

import json
import shutil
from datetime import datetime
from pathlib import Path
from typing import Dict, Any, Optional, List

from .config_core import HexapodConfig


class ProfileManager:
    """Manages multiple configuration profiles.

    Profiles are stored in ~/.hexapod/profiles/ directory.
    Profile metadata is stored in ~/.hexapod/profiles.json.

    Each profile is a separate JSON file containing HexapodConfig values.
    The active profile can be switched at runtime.

    Attributes:
        base_dir: Base directory for hexapod config (~/.hexapod)
        profiles_dir: Directory containing profile files
        metadata_file: Path to profiles.json metadata file
    """

    def __init__(self, base_dir: Optional[Path] = None):
        """Initialize profile manager.

        Args:
            base_dir: Base directory for hexapod config. Defaults to ~/.hexapod
        """
        self.base_dir = base_dir or Path.home() / ".hexapod"
        self.profiles_dir = self.base_dir / "profiles"
        self.metadata_file = self.base_dir / "profiles.json"
        self._current_profile = "default"
        self._config: Optional[HexapodConfig] = None
        self._metadata: Dict[str, Any] = {}

        # Ensure directories exist
        self.profiles_dir.mkdir(parents=True, exist_ok=True)

        # Load or initialize metadata
        self._load_metadata()

        # Migrate legacy config if needed
        self._migrate_legacy_config()

    def _load_metadata(self) -> None:
        """Load profile metadata from file."""
        if self.metadata_file.exists():
            try:
                with open(self.metadata_file, 'r', encoding='utf-8') as f:
                    self._metadata = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._metadata = {}

        # Ensure required structure
        if "profiles" not in self._metadata:
            self._metadata["profiles"] = {}
        if "default_profile" not in self._metadata:
            self._metadata["default_profile"] = "default"
        if "current_profile" not in self._metadata:
            self._metadata["current_profile"] = "default"

        self._current_profile = self._metadata.get("current_profile", "default")

    def _save_metadata(self) -> None:
        """Save profile metadata to file."""
        self._metadata["current_profile"] = self._current_profile
        self.base_dir.mkdir(parents=True, exist_ok=True)
        with open(self.metadata_file, 'w', encoding='utf-8') as f:
            json.dump(self._metadata, f, indent=2)

    def _migrate_legacy_config(self) -> None:
        """Migrate legacy single config.json to profiles system."""
        legacy_config = self.base_dir / "config.json"
        default_profile = self.profiles_dir / "default.json"

        # If legacy config exists but no default profile, migrate it
        if legacy_config.exists() and not default_profile.exists():
            shutil.copy(legacy_config, default_profile)
            # Add metadata for migrated profile
            self._metadata["profiles"]["default"] = {
                "name": "default",
                "description": "Default configuration (migrated)",
                "lastModified": datetime.now().isoformat(),
                "isDefault": True
            }
            self._save_metadata()

        # Ensure default profile exists
        if not default_profile.exists():
            # Create default profile with default values
            config = HexapodConfig(default_profile)
            config.save()
            self._metadata["profiles"]["default"] = {
                "name": "default",
                "description": "Default configuration",
                "lastModified": datetime.now().isoformat(),
                "isDefault": True
            }
            self._save_metadata()

    def _get_profile_path(self, name: str) -> Path:
        """Get path to a profile's config file.

        Args:
            name: Profile name

        Returns:
            Path to the profile's JSON file
        """
        # Sanitize name to prevent path traversal
        safe_name = "".join(c for c in name if c.isalnum() or c in "_-").lower()
        return self.profiles_dir / f"{safe_name}.json"

    def list_profiles(self) -> List[Dict[str, Any]]:
        """List all available profiles with metadata.

        Returns:
            List of profile info dictionaries containing:
            - name: Profile name
            - description: Profile description
            - lastModified: ISO timestamp of last modification
            - isDefault: True if this is the default profile
        """
        profiles = []

        # Scan profiles directory for JSON files
        for profile_file in self.profiles_dir.glob("*.json"):
            name = profile_file.stem

            # Get metadata or create default
            meta = self._metadata.get("profiles", {}).get(name, {})

            profiles.append({
                "name": name,
                "description": meta.get("description", ""),
                "lastModified": meta.get("lastModified",
                    datetime.fromtimestamp(profile_file.stat().st_mtime).isoformat()),
                "isDefault": self._metadata.get("default_profile") == name
            })

        # Sort by name, with default first
        profiles.sort(key=lambda p: (not p["isDefault"], p["name"]))
        return profiles

    def get_profile_names(self) -> List[str]:
        """Get list of profile names.

        Returns:
            List of profile name strings
        """
        return [p["name"] for p in self.list_profiles()]

    def profile_exists(self, name: str) -> bool:
        """Check if a profile exists.

        Args:
            name: Profile name

        Returns:
            True if the profile exists
        """
        return self._get_profile_path(name).exists()

    def get_current_profile(self) -> str:
        """Get the name of the currently active profile.

        Returns:
            Current profile name
        """
        return self._current_profile

    def get_default_profile(self) -> str:
        """Get the name of the default profile.

        Returns:
            Default profile name
        """
        return self._metadata.get("default_profile", "default")

    def set_default_profile(self, name: str) -> bool:
        """Set a profile as the default.

        Args:
            name: Profile name

        Returns:
            True if successful
        """
        if not self.profile_exists(name):
            return False

        # Update isDefault flags in metadata
        for pname in self._metadata.get("profiles", {}):
            self._metadata["profiles"][pname]["isDefault"] = (pname == name)

        self._metadata["default_profile"] = name
        self._save_metadata()
        return True

    def load_profile(self, name: str) -> HexapodConfig:
        """Load a profile's configuration.

        Args:
            name: Profile name

        Returns:
            HexapodConfig instance for the profile
        """
        profile_path = self._get_profile_path(name)

        if not profile_path.exists():
            # Profile doesn't exist, create it with defaults
            config = HexapodConfig(profile_path)
            config.save()
            self._update_profile_metadata(name, "New profile")
        else:
            config = HexapodConfig(profile_path)

        self._current_profile = name
        self._config = config
        self._save_metadata()

        return config

    def get_config(self, profile: Optional[str] = None) -> HexapodConfig:
        """Get configuration for a profile.

        Args:
            profile: Profile name (uses current if None)

        Returns:
            HexapodConfig instance
        """
        target = profile or self._current_profile

        # If requesting current profile and it's loaded, return it
        if target == self._current_profile and self._config is not None:
            return self._config

        return self.load_profile(target)

    def _update_profile_metadata(self, name: str, description: str = "") -> None:
        """Update metadata for a profile.

        Args:
            name: Profile name
            description: Profile description
        """
        if "profiles" not in self._metadata:
            self._metadata["profiles"] = {}

        self._metadata["profiles"][name] = {
            "name": name,
            "description": description,
            "lastModified": datetime.now().isoformat(),
            "isDefault": self._metadata.get("default_profile") == name
        }
        self._save_metadata()

    def create_profile(self, name: str, copy_from: Optional[str] = None,
                      description: str = "") -> bool:
        """Create a new profile.

        Args:
            name: Name for the new profile
            copy_from: Optional profile to copy settings from
            description: Optional description

        Returns:
            True if successful
        """
        profile_path = self._get_profile_path(name)

        if profile_path.exists():
            return False  # Profile already exists

        if copy_from and self.profile_exists(copy_from):
            # Copy from existing profile
            source_path = self._get_profile_path(copy_from)
            shutil.copy(source_path, profile_path)
            if not description:
                description = f"Copy of {copy_from}"
        else:
            # Create with defaults
            config = HexapodConfig(profile_path)
            config.save()
            if not description:
                description = "New profile"

        self._update_profile_metadata(name, description)
        return True

    def delete_profile(self, name: str) -> bool:
        """Delete a profile.

        Args:
            name: Profile name to delete

        Returns:
            True if successful
        """
        # Prevent deleting the default profile
        if name == self._metadata.get("default_profile"):
            return False

        profile_path = self._get_profile_path(name)

        if not profile_path.exists():
            return False

        # Delete the file
        profile_path.unlink()

        # Remove from metadata
        if name in self._metadata.get("profiles", {}):
            del self._metadata["profiles"][name]

        # If we deleted the current profile, switch to default
        if self._current_profile == name:
            self._current_profile = self._metadata.get("default_profile", "default")
            self._config = None

        self._save_metadata()
        return True

    def rename_profile(self, old_name: str, new_name: str) -> bool:
        """Rename a profile.

        Args:
            old_name: Current profile name
            new_name: New profile name

        Returns:
            True if successful
        """
        old_path = self._get_profile_path(old_name)
        new_path = self._get_profile_path(new_name)

        if not old_path.exists() or new_path.exists():
            return False

        # Rename file
        old_path.rename(new_path)

        # Update metadata
        old_meta = self._metadata.get("profiles", {}).get(old_name, {})
        old_meta["name"] = new_name
        old_meta["lastModified"] = datetime.now().isoformat()

        if old_name in self._metadata.get("profiles", {}):
            del self._metadata["profiles"][old_name]
        self._metadata["profiles"][new_name] = old_meta

        # Update default if needed
        if self._metadata.get("default_profile") == old_name:
            self._metadata["default_profile"] = new_name

        # Update current if needed
        if self._current_profile == old_name:
            self._current_profile = new_name

        self._save_metadata()
        return True

    def update_profile_description(self, name: str, description: str) -> bool:
        """Update a profile's description.

        Args:
            name: Profile name
            description: New description

        Returns:
            True if successful
        """
        if not self.profile_exists(name):
            return False

        if "profiles" not in self._metadata:
            self._metadata["profiles"] = {}

        if name not in self._metadata["profiles"]:
            self._metadata["profiles"][name] = {"name": name}

        self._metadata["profiles"][name]["description"] = description
        self._metadata["profiles"][name]["lastModified"] = datetime.now().isoformat()
        self._save_metadata()
        return True

    def save_current(self) -> None:
        """Save the current profile's configuration."""
        if self._config:
            self._config.save()
            self._update_profile_metadata(
                self._current_profile,
                self._metadata.get("profiles", {}).get(
                    self._current_profile, {}
                ).get("description", "")
            )
