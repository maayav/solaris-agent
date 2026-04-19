# Test OpenRouter API connectivity
# Usage: .\test_openrouter.ps1

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$redTeamDir = Split-Path -Parent $scriptDir
Set-Location $redTeamDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "OpenRouter API Test" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Activate virtual environment
$venvPath = Join-Path $redTeamDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    & $venvPath
}

# Run the test
try {
    python scripts/test_openrouter.py
} catch {
    Write-Host "Test failed: $_" -ForegroundColor Red
}
