# Swarm Mission Worker - Process missions from Redis
# Usage: .\swarm_worker.ps1 [-Once]

param(
    [switch]$Once
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$redTeamDir = Split-Path -Parent $scriptDir
Set-Location $redTeamDir

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Swarm Mission Worker" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Activate virtual environment
$venvPath = Join-Path $redTeamDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    & $venvPath
} else {
    Write-Host "[!] Virtual environment not found" -ForegroundColor Yellow
}

# Build arguments
$pythonArgs = @()
if ($Once) { $pythonArgs += "--once" }

# Run the worker
Write-Host "Starting swarm worker..." -ForegroundColor Green
Write-Host "Press Ctrl+C to stop" -ForegroundColor Gray
Write-Host ""

try {
    python scripts/swarm_worker.py @pythonArgs
} catch {
    Write-Host "Worker stopped" -ForegroundColor Yellow
}
