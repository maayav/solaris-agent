# Submit a new mission to the swarm
# Usage: .\submit_mission.ps1 [target_url] [objective]

param(
    [string]$Target = "http://localhost:8080",
    [string]$Objective = "Comprehensive security audit"
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$redTeamDir = Split-Path -Parent $scriptDir
Set-Location $redTeamDir

# Activate virtual environment
$venvPath = Join-Path $redTeamDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    & $venvPath
}

Write-Host "Submitting mission..." -ForegroundColor Cyan
Write-Host "  Target: $Target"
Write-Host "  Objective: $Objective"

try {
    python scripts\submit_mission.py $Target $Objective
} catch {
    Write-Host "Error: $_" -ForegroundColor Red
}
