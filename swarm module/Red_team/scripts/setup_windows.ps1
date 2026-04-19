# VibeCheck Red Team - Windows Setup Script
# Run this in PowerShell as Administrator if needed

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "VibeCheck Red Team - Windows Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check Python version
Write-Host "[*] Checking Python installation..." -ForegroundColor Yellow
$pythonVersion = python --version 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "[X] Python is not installed or not in PATH" -ForegroundColor Red
    Write-Host "    Please install Python 3.10 or higher from https://python.org" -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Found $pythonVersion" -ForegroundColor Green

# Check if we're in the right directory
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$redTeamDir = Split-Path -Parent $scriptDir
Set-Location $redTeamDir

Write-Host "[*] Working directory: $redTeamDir" -ForegroundColor Yellow

# Create virtual environment
Write-Host "[*] Setting up Python virtual environment..." -ForegroundColor Yellow
if (Test-Path ".venv") {
    Write-Host "[!] Virtual environment already exists" -ForegroundColor Yellow
} else {
    python -m venv .venv
    Write-Host "[OK] Created virtual environment" -ForegroundColor Green
}

# Activate virtual environment
Write-Host "[*] Activating virtual environment..." -ForegroundColor Yellow
$venvPath = Join-Path $redTeamDir ".venv\Scripts\Activate.ps1"
if (Test-Path $venvPath) {
    & $venvPath
    Write-Host "[OK] Virtual environment activated" -ForegroundColor Green
} else {
    Write-Host "[X] Failed to find activation script" -ForegroundColor Red
    exit 1
}

# Upgrade pip
Write-Host "[*] Upgrading pip..." -ForegroundColor Yellow
python -m pip install --upgrade pip

# Use Windows-specific requirements if available
$reqFile = "requirements-windows.txt"
if (-not (Test-Path $reqFile)) {
    $reqFile = "requirements.txt"
}

Write-Host "[*] Installing Python dependencies from $reqFile..." -ForegroundColor Yellow

# Install packages that have pre-built wheels first (avoid compilation issues)
$corePackages = @(
    "pydantic",
    "pydantic-settings",
    "httpx",
    "pyyaml",
    "redis",
    "docker",
    "fastapi",
    "uvicorn",
    "pytest",
    "pytest-asyncio",
    "colorama"
)

foreach ($pkg in $corePackages) {
    Write-Host "  Installing $pkg..." -ForegroundColor Gray
    pip install $pkg --only-binary :all: 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  [!] Failed to install $pkg (binary), trying source..." -ForegroundColor Yellow
        pip install $pkg
    }
}

# Install LangChain packages (these usually have wheels)
$lcPackages = @(
    "langchain-core",
    "langchain",
    "langchain-openai",
    "langgraph",
    "langgraph-checkpoint"
)

foreach ($pkg in $lcPackages) {
    Write-Host "  Installing $pkg..." -ForegroundColor Gray
    pip install $pkg
}

# Install OpenAI and Ollama clients
Write-Host "  Installing OpenAI/Ollama clients..." -ForegroundColor Gray
pip install openai ollama

Write-Host "[OK] Installed core requirements" -ForegroundColor Green

# Install additional Windows-specific packages
Write-Host "[*] Installing Windows compatibility packages..." -ForegroundColor Yellow
pip install colorama

# Check Docker
Write-Host "[*] Checking Docker installation..." -ForegroundColor Yellow
$dockerVersion = docker --version 2>&1
if ($LASTEXITCODE -eq 0) {
    Write-Host "[OK] Docker found: $dockerVersion" -ForegroundColor Green
} else {
    Write-Host "[!] Docker not found - sandbox features will be unavailable" -ForegroundColor Yellow
    Write-Host "    Install Docker Desktop from https://docker.com/products/docker-desktop" -ForegroundColor Yellow
}

# Check Redis
Write-Host "[*] Checking Redis connection..." -ForegroundColor Yellow
try {
    $redisResult = python -c "import redis; r = redis.from_url('redis://localhost:6381'); print(r.ping())" 2>&1
    if ($redisResult -eq "True") {
        Write-Host "[OK] Redis is running on localhost:6381" -ForegroundColor Green
    } else {
        Write-Host "[!] Redis not responding on localhost:6381" -ForegroundColor Yellow
        Write-Host "    Start Redis: docker run -d -p 6381:6379 redis:latest" -ForegroundColor Yellow
    }
} catch {
    Write-Host "[!] Could not connect to Redis" -ForegroundColor Yellow
    Write-Host "    Start Redis: docker run -d -p 6381:6379 redis:latest" -ForegroundColor Yellow
}

# Create .env file if it doesn't exist
Write-Host "[*] Checking environment configuration..." -ForegroundColor Yellow
if (-not (Test-Path ".env")) {
    if (Test-Path ".env.example") {
        Copy-Item ".env.example" ".env"
        Write-Host "[OK] Created .env from .env.example" -ForegroundColor Green
        Write-Host "[!] Please edit .env and configure your API keys" -ForegroundColor Yellow
    } else {
        @"
# Red Team Configuration
REDIS_URL=redis://localhost:6381
OLLAMA_BASE_URL=http://localhost:11434
OPENROUTER_API_KEY=
JUICE_SHOP_URL=http://localhost:3000

# Models - all use qwen2.5-coder:7b-instruct
COMMANDER_MODEL=qwen2.5-coder:7b-instruct
RECON_MODEL=qwen2.5-coder:7b-instruct
EXPLOIT_MODEL=qwen2.5-coder:7b-instruct
CRITIC_MODEL=qwen2.5-coder:7b-instruct
"@ | Out-File -FilePath ".env" -Encoding utf8
        Write-Host "[OK] Created default .env file" -ForegroundColor Green
    }
} else {
    Write-Host "[OK] .env file already exists" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "To run a mission:" -ForegroundColor Yellow
Write-Host "  1. Activate virtual environment: .venv\Scripts\Activate.ps1" -ForegroundColor White
Write-Host "  2. Run health check: python scripts/health_check.py" -ForegroundColor White
Write-Host "  3. Run mission: python scripts/run_mission.py -o 'Recon target' -t http://localhost:3000" -ForegroundColor White
Write-Host ""
