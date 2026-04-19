# VibeCheck Red Team - Windows Setup Guide

This guide covers setting up and running the Red Team swarm module on Windows.

## Quick Start

### 1. Prerequisites

- **Python 3.10+** - Download from [python.org](https://python.org)
- **Docker Desktop** - Download from [docker.com](https://docker.com/products/docker-desktop)
- **Git** - For cloning the repository
- **PowerShell** - Windows PowerShell 5.1 or PowerShell 7+

#### Optional: Visual C++ Build Tools

Some Python packages (like `zstandard`) may require compilation. If you encounter build errors during setup, you can either:
1. Install [Microsoft C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (recommended for developers)
2. Use the Windows-specific requirements file which skips packages needing compilation

### 2. Initial Setup

Open PowerShell and run the setup script:

```powershell
cd "swarm module\Red_team"
.\scripts\setup_windows.ps1
```

This will:
- Create a Python virtual environment (`.venv`)
- Install all required dependencies (using pre-built wheels when available)
- Check Docker installation
- Verify Redis connection
- Create a default `.env` file

#### Manual Installation (if setup script fails)

If the automated setup fails, you can install manually:

```powershell
cd "swarm module\Red_team"

# Create virtual environment
python -m venv .venv

# Activate it
.venv\Scripts\Activate.ps1

# Install dependencies (Windows-specific requirements)
pip install -r requirements-windows.txt

# Or install core packages individually
pip install pydantic pydantic-settings httpx pyyaml redis docker
pip install fastapi uvicorn
pip install langchain-core langchain langchain-openai langgraph
pip install openai ollama colorama
```

### 3. Configure Environment

Edit the `.env` file to configure your settings:

```powershell
notepad .env
```

Key settings to configure:
- `REDIS_URL` - Redis connection (default: `redis://localhost:6381`)
- `OLLAMA_BASE_URL` - Ollama LLM server (default: `http://localhost:11434`)
- `JUICE_SHOP_URL` - Target application (default: `http://localhost:8080`)
- `OPENROUTER_API_KEY` - Optional cloud LLM fallback

### 4. Start Dependencies (Blue Team Services)

The Red Team shares services with the Blue Team (vibecheck). Make sure the Blue Team's docker-compose is running:

```powershell
cd ..\..\vibecheck  # Navigate to vibecheck directory
docker compose up -d
```

This starts:
- **Redis** on port 6380 (message bus)
- **FalkorDB** on port 6379 (graph database)
- **Qdrant** on port 6333 (vector database)
- **Juice Shop** on port 8080 (target application)

Verify services are running:

```powershell
docker ps
```

### 5. Run Health Check

Verify all services are ready:

```powershell
.\scripts\health_check.ps1
```

Or directly with Python:

```powershell
python scripts/health_check.py
```

### 6. Run a Mission

Using PowerShell script (recommended):

```powershell
.\scripts\run_mission.ps1 -Objective "Scan for SQL injection" -Target "http://localhost:8080" -Iterations 5
```

Or directly with Python:

```powershell
python scripts/run_mission.py -o "Scan for SQL injection" -t "http://localhost:8080" -i 5
```

## File Structure

```
Red_team/
├── scripts/
│   ├── run_mission.py          # Main mission runner (cross-platform)
│   ├── run_mission_win.py      # Windows-optimized version
│   ├── health_check.py         # Health check (cross-platform)
│   ├── setup_windows.ps1       # Windows setup script
│   ├── run_mission.ps1         # PowerShell mission runner
│   └── health_check.ps1        # PowerShell health check
├── core/
│   ├── platform_compat.py      # Windows compatibility utilities
│   └── ...
└── WINDOWS_SETUP.md            # This file
```

## Shared Services Architecture

The Red Team (swarm module) shares infrastructure with the Blue Team (vibecheck):

```
┌─────────────────────────────────────────────────────────┐
│                    Blue Team (vibecheck)                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │  Redis      │  │  Qdrant     │  │  FalkorDB       │  │
│  │  Port 6380  │  │  Port 6333  │  │  Port 6379      │  │
│  └──────┬──────┘  └─────────────┘  └─────────────────┘  │
│         │                                                │
│  ┌──────┴──────┐                                         │
│  │ Juice Shop  │                                         │
│  │ Port 8080   │                                         │
│  └─────────────┘                                         │
└─────────┬───────────────────────────────────────────────┘
          │ Shared Services
┌─────────┴───────────────────────────────────────────────┐
│                    Red Team (swarm)                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Commander Agent → Alpha Recon → Gamma Exploit   │  │
│  └───────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Port Reference

| Service | Blue Team Container | Host Port | Red Team Config |
|---------|---------------------|-----------|-----------------|
| Redis | vibecheck-redis | 6380 | `redis://localhost:6380` |
| FalkorDB | vibecheck-falkordb | 6379 | `redis://localhost:6379` |
| Qdrant | vibecheck-qdrant | 6333 | `http://localhost:6333` |
| Juice Shop | vibecheck-juiceshop | 8080 | `http://localhost:8080` |

## Windows-Specific Changes

### Unicode/Encoding Fixes

The original Linux codebase used Unicode characters that don't render properly on Windows consoles:

- **Banner**: Replaced Korean glyphs and box-drawing characters with ASCII art
- **Status Icons**: Emoji replaced with `[OK]`, `[FAIL]`, `[WARN]` on Windows
- **Box Borders**: Unicode box-drawing replaced with ASCII `+`, `-`, `|`

### Platform Compatibility Module

The `core/platform_compat.py` module provides:

- `IS_WINDOWS`, `IS_MAC`, `IS_LINUX` platform detection
- `COLORS` dictionary with ANSI color codes
- `SYMBOLS` dictionary with platform-appropriate icons
- `safe_print()` function for encoding-safe output
- `print_banner()` for ASCII-only banner

### Path Handling

All file paths use `pathlib.Path` for cross-platform compatibility:

```python
from pathlib import Path
# Works on both Windows and Linux
config_path = Path(__file__).parent / "config.yaml"
```

## Troubleshooting

### "Python is not recognized"

Add Python to your PATH or use the full path:

```powershell
C:\Users\YourName\AppData\Local\Programs\Python\Python311\python.exe scripts/run_mission.py
```

### "Docker not found"

Make sure Docker Desktop is:
1. Installed
2. Running
3. Added to your PATH

### "Redis connection failed"

Start Redis with Docker:

```powershell
docker run -d --name redis -p 6381:6379 redis:latest
```

### Unicode Errors

If you see encoding errors, use the Windows-optimized scripts:

```powershell
python scripts/run_mission_win.py -o "Test" -t "http://localhost:8080"
```

### Virtual Environment Activation Fails

Try activating manually:

```powershell
.venv\Scripts\Activate.ps1
```

If you get an execution policy error, run:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

## API Usage

The Red Team exposes a FastAPI server for programmatic access:

### Start the API Server

```powershell
python scripts/start_api.py
```

Or use uvicorn directly:

```powershell
uvicorn api.main:app --reload --port 8000
```

### API Endpoints

- `POST /api/v1/missions` - Create a new mission
- `GET /api/v1/missions/{mission_id}` - Get mission status
- `GET /api/v1/missions/{mission_id}/events` - Get mission events
- `GET /api/v1/health` - Health check

## Docker Sandbox

The sandbox uses Docker containers for isolated tool execution:

**On Windows:**
- Uses `host.docker.internal` to reach host services
- Requires Docker Desktop with WSL2 backend
- Network mode is limited compared to Linux

**Build Sandbox Image:**

```powershell
cd sandbox
docker build -t vibecheck-sandbox:latest -f Dockerfile.sandbox .
```

## Development

### Adding New Scripts

When creating new scripts, use the platform compatibility module:

```python
from core.platform_compat import print_banner, COLORS, SYMBOLS, safe_print

# Use safe_print instead of print for Unicode content
safe_print(f"{SYMBOLS['check']} Success!", color="green")
```

### Running Tests

```powershell
python -m pytest tests/ -v
```

## Differences from Linux Version

| Feature | Linux | Windows |
|---------|-------|---------|
| Banner | Korean glyphs | ASCII art |
| Status icons | Emoji (✅ ❌ ⚠️) | Text ([OK] [FAIL] [WARN]) |
| ANSI colors | Full support | Requires modern terminal |
| Docker networking | Host mode | Bridge + host.docker.internal |
| Path separator | `/` | `\` (handled by pathlib) |
| Shebang | `#!/usr/bin/env python` | Ignored |
| Startup scripts | `.sh` | `.ps1` |

## Support

For issues specific to the Windows version:
1. Check this README first
2. Use the Windows-optimized scripts (`*_win.py`)
3. Verify all dependencies with `health_check.ps1`
4. Check Docker Desktop is running

## License

Same as the main project - MIT License.
