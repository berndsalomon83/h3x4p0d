#!/bin/bash
# Quick start script for Hexapod Controller
# Usage: bash start.sh [--hardware] [--port 8000]

set -e

HARDWARE=false
PORT=8000

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --hardware) HARDWARE=true; shift ;;
    --port) PORT=$2; shift 2 ;;
    *) shift ;;
  esac
done

echo "======================================"
echo "Hexapod Controller - Quick Start"
echo "======================================"
echo ""

# Check for Poetry
if ! command -v poetry &> /dev/null; then
  echo "❌ Poetry not found. Install with:"
  echo "   curl -sSL https://install.python-poetry.org | python3 -"
  exit 1
fi

echo "✓ Poetry found"

# Install dependencies
echo ""
echo "Installing dependencies..."
if [ "$HARDWARE" = true ]; then
  echo "  (with hardware extras: pigpio, adafruit-pca9685, etc.)"
  poetry install --extras pi
else
  echo "  (mock mode only)"
  poetry install
fi

# Run tests
echo ""
echo "Running tests..."
poetry run python -m hexapod.test_runner

# Start server
echo ""
echo "======================================"
echo "Starting web server on port $PORT"
echo "======================================"
echo ""
echo "Open in browser:"
echo "  http://localhost:$PORT"
echo ""
echo "Press Ctrl+C to stop"
echo ""

poetry run python -c "from hexapod.web import create_app; import uvicorn; uvicorn.run(create_app(), host='0.0.0.0', port=$PORT)"
