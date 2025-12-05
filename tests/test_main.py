"""Tests for main.py entry point and process management."""

import pytest
import os
from unittest.mock import patch, MagicMock

# Check if fastapi is available - main.py imports web.py which needs it
try:
    import fastapi
    HAS_FASTAPI = True
except ImportError:
    HAS_FASTAPI = False

# Skip all tests in this module if fastapi is not installed
pytestmark = pytest.mark.skipif(not HAS_FASTAPI, reason="fastapi not installed")


class TestKillExistingServers:
    """Tests for kill_existing_servers() function."""

    def test_no_existing_servers(self):
        """Test when no servers are running on port 8000."""
        with patch('subprocess.run') as mock_run:
            # lsof returns empty (no processes)
            mock_run.return_value = MagicMock(stdout='', returncode=0)

            # Import after patching
            from hexapod.main import kill_existing_servers
            kill_existing_servers()

            # Should only call lsof once
            assert mock_run.call_count == 1
            assert 'lsof' in mock_run.call_args_list[0][0][0]

    def test_skips_own_process(self):
        """Test that kill_existing_servers doesn't kill its own process."""
        current_pid = os.getpid()

        with patch('subprocess.run') as mock_run:
            # lsof returns our own PID
            mock_run.return_value = MagicMock(stdout=str(current_pid), returncode=0)

            from hexapod.main import kill_existing_servers
            kill_existing_servers()

            # Should only call lsof, not kill (since it's our own PID)
            calls = [str(call) for call in mock_run.call_args_list]
            kill_calls = [c for c in calls if 'kill' in c and '-15' in c]
            assert len(kill_calls) == 0

    def test_kills_other_process_gracefully(self):
        """Test graceful termination with SIGTERM first."""
        other_pid = "99999"

        with patch('subprocess.run') as mock_run:
            with patch('time.sleep'):  # Skip actual sleep
                # First call: lsof returns a PID
                # Second call: kill -15 (SIGTERM)
                # Third call: kill -0 returns non-zero (process dead)
                mock_run.side_effect = [
                    MagicMock(stdout=other_pid, returncode=0),  # lsof
                    MagicMock(returncode=0),  # kill -15
                    MagicMock(returncode=1),  # kill -0 (process gone)
                ]

                from hexapod.main import kill_existing_servers
                kill_existing_servers()

                # Verify SIGTERM was sent
                calls = mock_run.call_args_list
                assert any('-15' in str(call) for call in calls)
                # Should NOT have sent SIGKILL since process died gracefully
                assert not any('-9' in str(call) for call in calls)

    def test_force_kills_stubborn_process(self):
        """Test SIGKILL is sent when process doesn't respond to SIGTERM."""
        other_pid = "99999"

        with patch('subprocess.run') as mock_run:
            with patch('time.sleep'):
                # Process doesn't die after SIGTERM
                mock_run.side_effect = [
                    MagicMock(stdout=other_pid, returncode=0),  # lsof
                    MagicMock(returncode=0),  # kill -15
                    MagicMock(returncode=0),  # kill -0 (still alive)
                    MagicMock(returncode=0),  # kill -9
                ]

                from hexapod.main import kill_existing_servers
                kill_existing_servers()

                # Verify both SIGTERM and SIGKILL were sent
                calls = mock_run.call_args_list
                assert any('-15' in str(call) for call in calls)
                assert any('-9' in str(call) for call in calls)

    def test_handles_multiple_processes(self):
        """Test killing multiple server processes."""
        with patch('subprocess.run') as mock_run:
            with patch('time.sleep'):
                # Two PIDs returned by lsof
                mock_run.side_effect = [
                    MagicMock(stdout="11111\n22222", returncode=0),  # lsof
                    MagicMock(returncode=0),  # kill -15 first
                    MagicMock(returncode=1),  # kill -0 (dead)
                    MagicMock(returncode=0),  # kill -15 second
                    MagicMock(returncode=1),  # kill -0 (dead)
                ]

                from hexapod.main import kill_existing_servers
                kill_existing_servers()

                # Should have attempted to kill both
                sigterm_calls = [c for c in mock_run.call_args_list if '-15' in str(c)]
                assert len(sigterm_calls) == 2

    def test_handles_lsof_not_found(self):
        """Test graceful handling when lsof is not available (e.g., Windows)."""
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = FileNotFoundError("lsof not found")

            from hexapod.main import kill_existing_servers
            # Should not raise, just silently handle
            kill_existing_servers()

    def test_handles_invalid_pid(self):
        """Test handling of invalid PID in lsof output."""
        with patch('subprocess.run') as mock_run:
            # lsof returns garbage
            mock_run.return_value = MagicMock(stdout="not_a_pid\n12345", returncode=0)

            with patch('time.sleep'):
                mock_run.side_effect = [
                    MagicMock(stdout="not_a_pid\n12345", returncode=0),
                    MagicMock(returncode=0),  # kill -15
                    MagicMock(returncode=1),  # kill -0
                ]

                from hexapod.main import kill_existing_servers
                # Should not raise, should skip invalid and process valid
                kill_existing_servers()

    def test_handles_subprocess_error(self):
        """Test handling of unexpected subprocess errors."""
        with patch('subprocess.run') as mock_run:
            mock_run.side_effect = Exception("Unexpected error")

            from hexapod.main import kill_existing_servers
            # Should not raise, just print warning
            kill_existing_servers()


class TestKillServersOnPort:
    """Tests for kill_servers_on_port() function."""

    def test_kills_server_on_specific_port(self):
        """Test killing a server on a specific port."""
        with patch('subprocess.run') as mock_run:
            with patch('time.sleep'):
                mock_run.side_effect = [
                    MagicMock(stdout="12345", returncode=0),  # lsof
                    MagicMock(returncode=0),  # kill -15
                    MagicMock(returncode=1),  # kill -0 (process gone)
                ]

                from hexapod.main import kill_servers_on_port
                kill_servers_on_port(8001)

                # Should have used port 8001
                calls = mock_run.call_args_list
                assert ":8001" in str(calls[0])

    def test_handles_empty_result(self):
        """Test handling when no servers running on port."""
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(stdout='', returncode=0)

            from hexapod.main import kill_servers_on_port
            kill_servers_on_port(9999)

            # Should only call lsof once
            assert mock_run.call_count == 1

    def test_skips_current_process(self):
        """Kill routine should not terminate the current process."""
        with patch('subprocess.run') as mock_run:
            mock_run.return_value = MagicMock(stdout=str(os.getpid()), returncode=0)

            from hexapod.main import kill_servers_on_port

            kill_servers_on_port(8123)

            # Only the discovery call should run; no kill attempts are made
            assert mock_run.call_count == 1

    def test_ignores_invalid_pid_entries(self):
        """Ignore malformed PIDs while still handling valid ones."""
        with patch('subprocess.run') as mock_run, patch('time.sleep'):
            mock_run.side_effect = [
                MagicMock(stdout="abc\n12345", returncode=0),  # lsof output with invalid + valid PID
                MagicMock(returncode=0),  # kill -15 for valid PID
                MagicMock(returncode=1),  # kill -0 indicates process already gone
            ]

            from hexapod.main import kill_servers_on_port

            kill_servers_on_port(8456)

            # Ensure lsof was scoped to the requested port and only valid PID led to kill attempts
            calls = mock_run.call_args_list
            assert any(":8456" in str(call) for call in calls)
            assert len(calls) == 3


class TestStartCalibrationServer:
    """Tests for start_calibration_server() behavior."""

    def test_start_calibration_server_uses_configured_host_and_port(self):
        """Ensure calibration server bootstraps uvicorn with provided arguments."""
        with (
            patch('hexapod.main.create_calibration_app') as mock_create_app,
            patch('hexapod.main.uvicorn.Config') as mock_config,
            patch('hexapod.main.uvicorn.Server') as mock_server,
        ):
            mock_app = MagicMock()
            mock_create_app.return_value = mock_app
            server_instance = MagicMock()
            mock_server.return_value = server_instance

            from hexapod.main import start_calibration_server

            start_calibration_server(host="127.0.0.1", port=9100, use_hardware=True)

            mock_create_app.assert_called_once_with(use_hardware=True)
            mock_config.assert_called_once_with(
                mock_app,
                host="127.0.0.1",
                port=9100,
                log_level="warning",
            )
            mock_server.assert_called_once_with(mock_config.return_value)
            server_instance.run.assert_called_once_with()


class TestMainModule:
    """Tests for main module structure."""

    def test_module_imports(self):
        """Test that main module can be imported."""
        import hexapod.main
        assert hasattr(hexapod.main, 'kill_existing_servers')
        assert hasattr(hexapod.main, 'kill_servers_on_port')
        assert hasattr(hexapod.main, 'start_calibration_server')

    def test_argparse_defaults(self):
        """Test argument parser default values."""
        import argparse

        # Create parser similar to main.py
        parser = argparse.ArgumentParser()
        parser.add_argument("--controller", action="store_true")
        parser.add_argument("--port", type=int, default=8000)
        parser.add_argument("--calibration-port", type=int, default=8001)
        parser.add_argument("--host", type=str, default="0.0.0.0")
        parser.add_argument("--hardware", action="store_true")

        args = parser.parse_args([])
        assert args.controller is False
        assert args.port == 8000
        assert args.calibration_port == 8001
        assert args.host == "0.0.0.0"
        assert args.hardware is False

    def test_argparse_with_controller(self):
        """Test argument parser with --controller flag."""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument("--controller", action="store_true")
        parser.add_argument("--port", type=int, default=8000)
        parser.add_argument("--calibration-port", type=int, default=8001)
        parser.add_argument("--host", type=str, default="0.0.0.0")
        parser.add_argument("--hardware", action="store_true")

        args = parser.parse_args(["--controller"])
        assert args.controller is True

    def test_argparse_with_hardware(self):
        """Test argument parser with --hardware flag."""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument("--controller", action="store_true")
        parser.add_argument("--hardware", action="store_true")

        args = parser.parse_args(["--hardware"])
        assert args.hardware is True

    def test_argparse_custom_port(self):
        """Test argument parser with custom port."""
        import argparse

        parser = argparse.ArgumentParser()
        parser.add_argument("--port", type=int, default=8000)
        parser.add_argument("--calibration-port", type=int, default=8001)

        args = parser.parse_args(["--port", "9000", "--calibration-port", "9001"])
        assert args.port == 9000
        assert args.calibration_port == 9001
