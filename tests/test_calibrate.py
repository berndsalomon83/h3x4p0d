"""Tests for calibrate.py servo calibration tool."""

import json
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock


class TestLoadExistingCalibration:
    """Tests for load_existing_calibration() function."""

    def test_load_nonexistent_file(self):
        """Test loading when no calibration file exists."""
        with patch('pathlib.Path.home') as mock_home:
            mock_home.return_value = Path(tempfile.mkdtemp())

            from hexapod.calibrate import load_existing_calibration
            result = load_existing_calibration()

            assert result == {}

    def test_load_existing_calibration(self):
        """Test loading existing calibration file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_data = {"0,0": 1, "0,1": 2, "1,0": 3}
            cal_file.write_text(json.dumps(cal_data), encoding='utf-8')

            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import load_existing_calibration
                result = load_existing_calibration()

                assert result == cal_data

    def test_load_empty_calibration_file(self):
        """Test loading empty calibration file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text("{}", encoding='utf-8')

            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import load_existing_calibration
                result = load_existing_calibration()

                assert result == {}

    def test_load_complex_calibration(self):
        """Test loading calibration with all 18 servos."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            # Create calibration for all 6 legs, 3 joints each
            cal_data = {f"{leg},{joint}": leg * 3 + joint
                        for leg in range(6) for joint in range(3)}
            cal_file.write_text(json.dumps(cal_data), encoding='utf-8')

            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import load_existing_calibration
                result = load_existing_calibration()

                assert len(result) == 18
                assert result["0,0"] == 0
                assert result["5,2"] == 17


class TestSaveCalibration:
    """Tests for save_calibration() function."""

    def test_save_calibration(self, capsys):
        """Test saving calibration to file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"

            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import save_calibration
                cal_data = {"0,0": 5, "1,1": 10}
                save_calibration(cal_data)

                # Verify file was created
                assert cal_file.exists()

                # Verify content
                saved = json.loads(cal_file.read_text(encoding='utf-8'))
                assert saved == cal_data

                # Verify print output
                captured = capsys.readouterr()
                assert "Calibration saved" in captured.out

    def test_save_empty_calibration(self):
        """Test saving empty calibration."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"

            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import save_calibration
                save_calibration({})

                saved = json.loads(cal_file.read_text(encoding='utf-8'))
                assert saved == {}

    def test_save_overwrites_existing(self):
        """Test that save overwrites existing calibration."""
        with tempfile.TemporaryDirectory() as tmpdir:
            cal_file = Path(tmpdir) / ".hexapod_calibration.json"
            cal_file.write_text('{"old": "data"}', encoding='utf-8')

            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import save_calibration
                new_data = {"new": "data"}
                save_calibration(new_data)

                saved = json.loads(cal_file.read_text(encoding='utf-8'))
                assert saved == new_data
                assert "old" not in saved

    def test_save_with_utf8_content(self):
        """Test saving calibration preserves UTF-8 encoding."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import save_calibration
                # Use special characters to test encoding
                cal_data = {"0,0": 90}
                save_calibration(cal_data)

                cal_file = Path(tmpdir) / ".hexapod_calibration.json"
                # Read with explicit encoding
                content = cal_file.read_text(encoding='utf-8')
                assert '"0,0": 90' in content


class TestTestServo:
    """Tests for test_servo() function."""

    def test_servo_within_range(self, capsys):
        """Test servo at valid angle."""
        from hexapod.calibrate import test_servo

        mock_servo = MagicMock()
        mock_servo.servos = [MagicMock() for _ in range(16)]

        test_servo(mock_servo, 0, 90.0)

        # Verify servo was set
        assert mock_servo.servos[0].angle == 90.0

        # Verify success message
        captured = capsys.readouterr()
        assert "✓" in captured.out

    def test_servo_clamps_high_angle(self, capsys):
        """Test servo clamps angle above 180."""
        from hexapod.calibrate import test_servo

        mock_servo = MagicMock()
        mock_servo.servos = [MagicMock() for _ in range(16)]

        test_servo(mock_servo, 0, 200.0)

        # Should be clamped to 180
        assert mock_servo.servos[0].angle == 180.0

    def test_servo_clamps_low_angle(self, capsys):
        """Test servo clamps angle below 0."""
        from hexapod.calibrate import test_servo

        mock_servo = MagicMock()
        mock_servo.servos = [MagicMock() for _ in range(16)]

        test_servo(mock_servo, 0, -10.0)

        # Should be clamped to 0
        assert mock_servo.servos[0].angle == 0.0

    def test_servo_error_handling(self, capsys):
        """Test error handling when servo fails."""
        from hexapod.calibrate import test_servo

        mock_servo = MagicMock()
        mock_servo.servos = [MagicMock() for _ in range(16)]
        # Make servo raise exception
        type(mock_servo.servos[0]).angle = property(
            fget=lambda s: 0,
            fset=lambda s, v: (_ for _ in ()).throw(Exception("Servo error"))
        )

        test_servo(mock_servo, 0, 90.0)

        # Should print error
        captured = capsys.readouterr()
        assert "✗" in captured.out or "Error" in captured.out


class TestCalibrationRoundTrip:
    """Integration tests for save/load calibration."""

    def test_save_load_roundtrip(self):
        """Test that saved calibration can be loaded back."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import save_calibration, load_existing_calibration

                original = {f"{leg},{joint}": leg * 3 + joint + 5
                            for leg in range(6) for joint in range(3)}

                save_calibration(original)
                loaded = load_existing_calibration()

                assert loaded == original

    def test_multiple_save_load_cycles(self):
        """Test multiple save/load cycles maintain data integrity."""
        with tempfile.TemporaryDirectory() as tmpdir:
            with patch('pathlib.Path.home') as mock_home:
                mock_home.return_value = Path(tmpdir)

                from hexapod.calibrate import save_calibration, load_existing_calibration

                for i in range(3):
                    data = {"0,0": i, "1,1": i * 2}
                    save_calibration(data)
                    loaded = load_existing_calibration()
                    assert loaded == data
