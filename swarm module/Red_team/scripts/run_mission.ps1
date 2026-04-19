# Run a Red Team Mission on Windows
# Usage: .\run_mission.ps1 -Objective "Scan for SQLi" -Target "http://localhost:3000" [-Iterations 5]

param(
    [Parameter(Mandatory=$false)]
    [string]$Objective = "Reconnaissance and vulnerability scan",
    
    [Parameter(Mandatory=$false)]
    [string]$Target = "http://localhost:8080",
    
    [Parameter(Mandatory=$false)]
    [int]$Iterations = 5,
    
    [Parameter(Mandatory=$false)]
    [string]$MissionFile = ""
)

$ErrorActionPreference = "Stop"

# Get the script directory and set working directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$redTeamDir = Split-Path -Parent $scriptDir
Set-Location $redTeamDir

Write-Host "========================================" -ForegroundColor Magenta
Write-Host "VibeCheck Red Team - Mission Runner" -ForegroundColor Magenta
Write-Host "========================================" -ForegroundColor Magenta

# Check if virtual environment exists and activate it
$venvPath = Join-Path $redTeamDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    Write-Host "[*] Activating virtual environment..." -ForegroundColor Yellow
    & $venvPath
} else {
    Write-Host "[!] Virtual environment not found at .venv" -ForegroundColor Yellow
    Write-Host "    Run setup_windows.ps1 first" -ForegroundColor Yellow
}

# Build command arguments
$pythonArgs = @()
if ($MissionFile -and (Test-Path $MissionFile)) {
    $pythonArgs += "--mission"
    $pythonArgs += $MissionFile
} else {
    $pythonArgs += "--objective"
    $pythonArgs += $Objective
    $pythonArgs += "--target"
    $pythonArgs += $Target
    $pythonArgs += "--iterations"
    $pythonArgs += $Iterations.ToString()
}

Write-Host ""
Write-Host "Mission Configuration:" -ForegroundColor Cyan
Write-Host "  Objective: $Objective" -ForegroundColor White
Write-Host "  Target: $Target" -ForegroundColor White
Write-Host "  Max Iterations: $Iterations" -ForegroundColor White
Write-Host ""

# Run the mission
Write-Host "Starting mission..." -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Magenta
Write-Host ""

try {
    python scripts/run_mission.py @pythonArgs
} catch {
    Write-Host ""
    Write-Host "[X] Mission failed with error:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    
    # Try the Windows-compatible version as fallback
    Write-Host ""
    Write-Host "[*] Attempting to run Windows-compatible version..." -ForegroundColor Yellow
    python scripts/run_mission_win.py @pythonArgs
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Magenta
Write-Host "Mission Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Magenta
