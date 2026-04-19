# VibeCheck Backend Startup Script (PowerShell)
# Run this from the vibecheck directory

Write-Host "Starting VibeCheck Backend..." -ForegroundColor Green

# Check if .venv exists
if (-not (Test-Path ".venv")) {
    Write-Host "Creating virtual environment..." -ForegroundColor Yellow
    python -m venv .venv
}

# Activate virtual environment
Write-Host "Activating virtual environment..." -ForegroundColor Yellow
& .\.venv\Scripts\Activate.ps1

# Install dependencies
Write-Host "Installing dependencies..." -ForegroundColor Yellow
pip install -r requirements.txt

# Start the API server
Write-Host "Starting API server on http://localhost:8000" -ForegroundColor Green
python -m api.main
