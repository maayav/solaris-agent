# Check and manage pending missions in Redis
# Usage: .\check_missions.ps1 [options]

param(
    [switch]$Streams,
    [switch]$Recent,
    [switch]$Claim,
    [switch]$Clear,
    [int]$Count = 10
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$redTeamDir = Split-Path -Parent $scriptDir
Set-Location $redTeamDir

# Activate virtual environment if it exists
$venvPath = Join-Path $redTeamDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    & $venvPath
}

# Build arguments
$pythonArgs = @()
if ($Streams) { $pythonArgs += "--streams" }
if ($Recent) { $pythonArgs += "--recent" }
if ($Claim) { $pythonArgs += "--claim" }
if ($Clear) { $pythonArgs += "--clear" }
if ($Count -ne 10) { $pythonArgs += "--count"; $pythonArgs += $Count }

# Run the Python script
python scripts/check_missions.py @pythonArgs
