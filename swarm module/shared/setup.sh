#!/bin/bash
# VibeCheck Setup Script
# Sets up the virtual environment and installs dependencies

set -e

echo "======================================"
echo "VibeCheck - Red + Blue Team Setup"
echo "======================================"
echo ""

# Check if we're in the vibecheck directory
if [ ! -d "Red_team" ] || [ ! -d "Blue_team" ]; then
    echo "❌ Error: Please run this script from the vibecheck root directory"
    exit 1
fi

echo "📁 Creating virtual environment..."
python3 -m venv venv

echo "📦 Installing dependencies..."
./venv/bin/pip install --upgrade pip
./venv/bin/pip install -r shared/requirements.txt

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Ensure Redis is running on localhost:6381"
echo "  2. Ensure Juice Shop is running on localhost:3000"
echo "  3. Run: ./venv/bin/python scripts/run_blue_team.py"
echo "  4. Run: ./venv/bin/python scripts/run_combined_engine.py"
echo ""
