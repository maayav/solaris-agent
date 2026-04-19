# Red Team Infrastructure Health Check for Windows
# Usage: .\health_check.ps1

$ErrorActionPreference = "Stop"

# Get the script directory and set working directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$redTeamDir = Split-Path -Parent $scriptDir
Set-Location $redTeamDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VibeCheck Red Team - Health Check" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if virtual environment exists and activate it
$venvPath = Join-Path $redTeamDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    & $venvPath
} else {
    Write-Host "[!] Virtual environment not found - some checks may fail" -ForegroundColor Yellow
}

# Run the health check
python scripts/health_check.py

$exitCode = $LASTEXITCODE

Write-Host ""
if ($exitCode -eq 0) {
    Write-Host "[OK] All systems operational!" -ForegroundColor Green
} else {
    Write-Host "[!] Some services are not available" -ForegroundColor Yellow
}
