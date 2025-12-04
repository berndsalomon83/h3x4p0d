#!/bin/bash
# Run hexapod test suite

echo "================================"
echo "  Hexapod Test Suite Runner"
echo "================================"
echo

# Activate virtual environment if it exists
if [ -d ".venv" ]; then
    source .venv/bin/activate
    echo "✓ Virtual environment activated"
else
    echo "⚠ No virtual environment found at .venv/"
    echo "  Using system Python"
fi

# Check if pytest is installed
if ! command -v pytest &> /dev/null; then
    echo "✗ pytest not found. Installing..."
    pip install pytest pytest-asyncio pytest-cov httpx
fi

echo
echo "Running tests..."
echo "================================"
echo

# Run tests with coverage
python -m pytest tests/ -v --cov=hexapod --cov-report=term --cov-report=html

echo
echo "================================"
echo "Test run complete!"
echo
echo "HTML coverage report: htmlcov/index.html"
echo "================================"
