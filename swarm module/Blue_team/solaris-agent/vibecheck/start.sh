#!/bin/bash
# VibeCheck Backend Startup Script (Linux/macOS)
# Run this from the vibecheck directory

set -e

echo "Starting VibeCheck Backend..."

# Check if .venv exists
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
echo "Activating virtual environment..."
source .venv/bin/activate

# Install dependencies
echo "Installing dependencies..."
pip install -r requirements.txt

# Start the API server
echo "Starting API server on http://localhost:8000"
python -m api.main
