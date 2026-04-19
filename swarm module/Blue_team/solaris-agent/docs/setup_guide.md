# Project VibeCheck - Setup Guide

**Dual-Agent Autonomous Security System for AI-Generated Code**

---

## Table of Contents

1. [Introduction](#introduction)
2. [Prerequisites and System Requirements](#prerequisites-and-system-requirements)
3. [Step-by-Step Installation Instructions](#step-by-step-installation-instructions)
4. [Configuration](#configuration)
5. [Verification Steps](#verification-steps)
6. [Troubleshooting FAQ](#troubleshooting-faq)

---

## Introduction

Project VibeCheck is a security ecosystem designed to audit and attack AI-generated ("vibecoded") software. It leverages a Knowledge Graph + GraphRAG pipeline to expose hidden dependencies and architectural vulnerabilities invisible to traditional linters, combined with a hierarchical multi-agent swarm to simulate real adversary kill chains.

### Key Features

- **Blue Team (Analyst Agent):** Detects N+1 queries, hardcoded secrets, and architectural drift using Knowledge Graph analysis
- **Red Team (Multi-Agent Swarm):** Performs reconnaissance, social engineering simulation, and exploit generation
- **Real-time Dashboard:** Visualizes kill chains and vulnerability reports via React Flow

### Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                    Local Infrastructure (Docker)            │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  FalkorDB   │  │   Qdrant    │  │   Redis     │         │
│  │ (Graph DB)  │  │ (Vector DB) │  │ (Msg Bus)   │         │
│  │  Port 6379  │  │  Port 6333  │  │  Port 6380  │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Application Layer                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐         │
│  │  FastAPI    │  │   Worker    │  │   Ollama    │         │
│  │   Server    │  │  (Scanner)  │  │  (Local LLM)│         │
│  │  Port 8000  │  │             │  │  Port 11434 │         │
│  └─────────────┘  └─────────────┘  └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────┐
│                    Cloud Services (Free Tier)               │
│  ┌─────────────────────┐  ┌─────────────────────┐          │
│  │      Supabase       │  │     OpenRouter      │          │
│  │ (Postgres + Realtime)│  │ (Cloud LLM Fallback)│          │
│  └─────────────────────┘  └─────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
```

---

## Prerequisites and System Requirements

### Hardware Requirements

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 4 cores | 8+ cores |
| RAM | 8 GB | 16+ GB |
| Disk Space | 10 GB | 20+ GB SSD |
| GPU | Optional | NVIDIA GPU with 8GB+ VRAM (for faster LLM inference) |

### Software Requirements

| Software | Version | Purpose | Installation Link |
|----------|---------|---------|-------------------|
| **Docker Desktop** | 4.0+ | Container runtime for local services | [Download](https://www.docker.com/products/docker-desktop/) |
| **Python** | 3.12+ | Application runtime | [Download](https://www.python.org/downloads/) |
| **Ollama** | Latest | Local LLM inference | [Download](https://ollama.ai/) |
| **Git** | 2.0+ | Repository operations | [Download](https://git-scm.com/downloads/) |

### Operating System Compatibility

| OS | Status | Notes |
|----|--------|-------|
| Windows 10/11 | ✅ Supported | WSL2 recommended for Docker |
| macOS 12+ | ✅ Supported | Native Docker Desktop support |
| Ubuntu 22.04+ | ✅ Supported | Native Docker support |
| Other Linux | ⚠️ Community | May require additional configuration |

### Cloud Services (Free Tier)

| Service | Purpose | Sign Up |
|---------|---------|---------|
| **Supabase** | PostgreSQL database + Realtime subscriptions | [Sign up](https://supabase.com) |
| **OpenRouter** | Cloud LLM fallback (optional) | [Sign up](https://openrouter.ai) |

---

## Step-by-Step Installation Instructions

### Step 1: Clone the Repository

```bash
# Navigate to your projects directory
cd /path/to/your/projects

# Clone the repository
git clone https://github.com/your-org/solaris-agent.git

# Navigate to the vibecheck directory
cd solaris-agent/vibecheck
```

### Step 2: Install Docker Desktop

#### Windows

1. Download Docker Desktop from [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Run the installer and follow the setup wizard
3. Enable WSL2 integration when prompted
4. Restart your computer if required
5. Verify installation:

```powershell
docker --version
docker compose version
```

#### macOS

1. Download Docker Desktop from [https://www.docker.com/products/docker-desktop/](https://www.docker.com/products/docker-desktop/)
2. Drag Docker.app to Applications folder
3. Launch Docker Desktop from Applications
4. Verify installation:

```bash
docker --version
docker compose version
```

#### Linux (Ubuntu)

```bash
# Update package index
sudo apt-get update

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER

# Log out and back in for group changes to take effect

# Verify installation
docker --version
docker compose version
```

### Step 3: Install Python 3.12+

#### Windows

```powershell
# Download from python.org or use winget
winget install Python.Python.3.12

# Verify installation
python --version
pip --version
```

#### macOS

```bash
# Using Homebrew (recommended)
brew install python@3.12

# Verify installation
python3.12 --version
pip3.12 --version
```

#### Linux (Ubuntu)

```bash
# Install Python 3.12
sudo apt-get update
sudo apt-get install python3.12 python3.12-venv python3-pip

# Verify installation
python3.12 --version
pip3.12 --version
```

### Step 4: Install Ollama

#### Windows

1. Download Ollama from [https://ollama.ai/](https://ollama.ai/)
2. Run the installer
3. Verify installation:

```powershell
ollama --version
```

#### macOS

```bash
# Using Homebrew
brew install ollama

# Or download from website
# https://ollama.ai/download

# Verify installation
ollama --version
```

#### Linux

```bash
# Install via script
curl -fsSL https://ollama.com/install.sh | sh

# Start Ollama service
ollama serve

# Verify installation
ollama --version
```

### Step 5: Start Docker Services

```bash
# Navigate to the vibecheck directory
cd /path/to/solaris-agent/vibecheck

# Start all services in detached mode
docker compose up -d

# Verify all containers are running
docker compose ps
```

Expected output:

```
NAME                    STATUS    PORTS
vibecheck-falkordb      running   0.0.0.0:6379->6379/tcp
vibecheck-qdrant        running   0.0.0.0:6333->6333/tcp, 0.0.0.0:6334->6334/tcp
vibecheck-redis         running   0.0.0.0:6380->6379/tcp
```

### Step 6: Pull Ollama Models

```bash
# Pull the code analysis model (~4.7 GB)
ollama pull qwen2.5-coder:7b-instruct

# Pull the embedding model (~274 MB)
ollama pull nomic-embed-text

# Verify models are installed
ollama list
```

### Step 7: Create Python Virtual Environments

Project VibeCheck requires **two separate virtual environments** to avoid dependency conflicts:

| Virtual Environment | Python Version | Purpose |
|---------------------|----------------|---------|
| `.venv/` | 3.10+ | Main application (FastAPI, workers, database clients) |
| `.semgrep-venv/` | 3.14+ | Isolated Semgrep security scanner |

#### 7.1 Create Main Application Virtual Environment

```bash
# Navigate to the project root directory
cd /path/to/solaris-agent

# Create main virtual environment (Python 3.10+)
python -m venv .venv

# Activate virtual environment
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1

# Windows (CMD):
.\.venv\Scripts\activate.bat

# macOS/Linux:
source .venv/bin/activate
```

#### 7.2 Create Semgrep Virtual Environment

Semgrep requires an isolated environment to avoid dependency conflicts with the main application.

```bash
# Navigate to the project root directory (if not already there)
cd /path/to/solaris-agent

# Ensure you have Python 3.14 installed
# Windows: Download from python.org
# macOS: brew install python@3.14
# Linux: sudo apt-get install python3.14

# Create Semgrep virtual environment (Python 3.14)
# Windows:
C:\Python314\python.exe -m venv .semgrep-venv

# macOS/Linux:
python3.14 -m venv .semgrep-venv

# Activate Semgrep virtual environment
# Windows (PowerShell):
.\.semgrep-venv\Scripts\Activate.ps1

# Windows (CMD):
.\.semgrep-venv\Scripts\activate.bat

# macOS/Linux:
source .semgrep-venv/bin/activate
```

### Step 8: Install Python Dependencies

#### 8.1 Install Main Application Dependencies

```bash
# Activate main virtual environment
# Windows (PowerShell):
.\.venv\Scripts\Activate.ps1

# macOS/Linux:
source .venv/bin/activate

# You should see (.venv) in your terminal prompt

# Upgrade pip
pip install --upgrade pip

# Navigate to vibecheck directory
cd vibecheck

# Install the package in editable mode
pip install -e .

# Or install from requirements.txt
pip install -r requirements.txt

# Install development dependencies (optional)
pip install -e ".[dev]"

# Install parser dependencies (for Week 2+ features)
pip install -e ".[parser]"

# Install security tools (optional)
pip install -e ".[security]"
```

#### 8.2 Install Semgrep in Isolated Environment

```bash
# Activate Semgrep virtual environment
# Windows (PowerShell):
.\.semgrep-venv\Scripts\Activate.ps1

# macOS/Linux:
source .semgrep-venv/bin/activate

# You should see (.semgrep-venv) in your terminal prompt

# Upgrade pip
pip install --upgrade pip

# Install Semgrep
pip install semgrep

# Verify Semgrep installation
semgrep --version
```

#### 8.3 Configure Semgrep Path

Update your `.env` file to point to the Semgrep binary:

```bash
# Windows
SEMGREP_BIN=d:/Projects/Prawin/solaris/solaris-agent/.semgrep-venv/Scripts/semgrep.exe

# macOS/Linux
SEMGREP_BIN=/path/to/solaris-agent/.semgrep-venv/bin/semgrep
```

### Step 9: Configure Environment Variables

```bash
# Copy the example environment file
cp .env.example .env

# Edit the .env file with your credentials
# Windows:
notepad .env

# macOS/Linux:
nano .env
```

### Step 10: Set Up Supabase Database

1. **Create a Supabase Project:**
   - Go to [https://supabase.com](https://supabase.com)
   - Click "New Project"
   - Enter a project name (e.g., "vibecheck")
   - Set a secure database password
   - Choose a region close to you
   - Click "Create new project"

2. **Get Your Credentials:**
   - Navigate to Settings → API
   - Copy the **Project URL** (this is your `SUPABASE_URL`)
   - Copy the **anon public** key (this is your `SUPABASE_ANON_KEY`)

3. **Update Your `.env` File:**
   ```bash
   SUPABASE_URL=https://your-project-id.supabase.co
   SUPABASE_ANON_KEY=your-anon-key-here
   ```

4. **Run Database Migrations:**
   - Go to SQL Editor in Supabase Dashboard
   - Click "New Query"
   - Copy the contents of `migrations/001_supabase_schema.sql`
   - Paste and click "Run"

---

## Configuration

### Environment Variables Reference

Create a `.env` file in the `vibecheck/` directory with the following variables:

```bash
# ===========================================
# Project VibeCheck - Environment Configuration
# ===========================================

# -------------------------------------------
# Supabase Configuration (Required)
# -------------------------------------------
SUPABASE_URL=https://your-project-id.supabase.co
SUPABASE_ANON_KEY=your-anon-key-here

# -------------------------------------------
# OpenRouter Configuration (Optional)
# -------------------------------------------
# Used for cloud LLM fallback when Ollama is unavailable
OPENROUTER_API_KEY=your-openrouter-api-key-here

# -------------------------------------------
# Local Services (Docker)
# -------------------------------------------
FALKORDB_URL=redis://localhost:6379
QDRANT_URL=http://localhost:6333
REDIS_URL=redis://localhost:6380

# -------------------------------------------
# Ollama Configuration
# -------------------------------------------
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_CODER_MODEL=qwen2.5-coder:7b-instruct
OLLAMA_EMBED_MODEL=nomic-embed-text

# -------------------------------------------
# Application Settings
# -------------------------------------------
ENVIRONMENT=development
LOG_LEVEL=INFO
API_PORT=8000

# -------------------------------------------
# Scan Settings
# -------------------------------------------
MAX_CONCURRENT_SCANS=3
REPO_CLONE_DIR=/tmp/vibecheck/repos
MAX_REPO_SIZE_MB=500

# Semgrep binary path (isolated venv to avoid dependency conflicts)
# Windows:
SEMGREP_BIN=d:/Projects/Prawin/solaris/solaris-agent/.semgrep-venv/Scripts/semgrep.exe
# macOS/Linux:
# SEMGREP_BIN=/path/to/solaris-agent/.semgrep-venv/bin/semgrep
```

### Configuration Details

#### Supabase Settings

| Variable | Required | Description |
|----------|----------|-------------|
| `SUPABASE_URL` | ✅ Yes | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | ✅ Yes | Public anonymous key for API access |

#### OpenRouter Settings (Optional)

| Variable | Required | Description |
|----------|----------|-------------|
| `OPENROUTER_API_KEY` | ❌ No | API key for cloud LLM fallback |
| `OPENROUTER_BASE_URL` | ❌ No | OpenRouter API endpoint (default: `https://openrouter.ai/api/v1`) |

#### Local Services

| Variable | Default | Description |
|----------|---------|-------------|
| `FALKORDB_URL` | `redis://localhost:6379` | FalkorDB connection URL |
| `QDRANT_URL` | `http://localhost:6333` | Qdrant vector database URL |
| `REDIS_URL` | `redis://localhost:6380` | Redis message bus URL |

#### Ollama Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama API endpoint |
| `OLLAMA_CODER_MODEL` | `qwen2.5-coder:7b-instruct` | Model for code analysis |
| `OLLAMA_EMBED_MODEL` | `nomic-embed-text` | Model for embeddings |

#### Application Settings

| Variable | Default | Valid Values |
|----------|---------|--------------|
| `ENVIRONMENT` | `development` | `development`, `staging`, `production` |
| `LOG_LEVEL` | `INFO` | `DEBUG`, `INFO`, `WARNING`, `ERROR`, `CRITICAL` |
| `API_PORT` | `8000` | Any valid port number |

#### Scan Settings

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CONCURRENT_SCANS` | `3` | Maximum parallel scan jobs |
| `REPO_CLONE_DIR` | `/tmp/vibecheck/repos` | Directory for cloned repositories |
| `MAX_REPO_SIZE_MB` | `500` | Maximum repository size in MB |
| `SEMGREP_BIN` | (auto-detect) | Path to Semgrep binary in isolated venv |

#### Semgrep Configuration

The `SEMGREP_BIN` variable must point to the Semgrep binary in the isolated virtual environment:

```bash
# Windows
SEMGREP_BIN=d:/Projects/Prawin/solaris/solaris-agent/.semgrep-venv/Scripts/semgrep.exe

# macOS/Linux
SEMGREP_BIN=/path/to/solaris-agent/.semgrep-venv/bin/semgrep
```

### Docker Service Ports

| Service | Container Port | Host Port | Purpose |
|---------|---------------|-----------|---------|
| FalkorDB | 6379 | 6379 | Graph database |
| Qdrant | 6333 | 6333 | Vector database REST API |
| Qdrant | 6334 | 6334 | Vector database gRPC API |
| Redis | 6379 | 6380 | Message bus (mapped to avoid conflict) |

---

## Verification Steps

### Step 1: Verify Docker Services

```bash
# Check container status
docker compose ps

# All containers should show "running" status
```

Expected output:

```
NAME                    COMMAND                  SERVICE             STATUS              PORTS
vibecheck-falkordb      "redis-server --save…"   falkordb            running             0.0.0.0:6379->6379/tcp
vibecheck-qdrant        "/entrypoint.sh"         qdrant              running             0.0.0.0:6333-6334->6333-6334/tcp
vibecheck-redis         "docker-entrypoint.s…"   redis               running             0.0.0.0:6380->6379/tcp
```

### Step 2: Verify FalkorDB Connection

```bash
# Connect to FalkorDB using redis-cli
docker exec -it vibecheck-falkordb redis-cli ping

# Expected output: PONG
```

### Step 3: Verify Qdrant Connection

```bash
# Check Qdrant health endpoint
curl http://localhost:6333/health

# Expected output: {"status":"ok"}
```

### Step 4: Verify Redis Connection

```bash
# Connect to Redis using redis-cli
docker exec -it vibecheck-redis redis-cli -p 6379 ping

# Expected output: PONG
```

### Step 5: Verify Ollama Models

```bash
# List installed models
ollama list

# Expected output should include:
# qwen2.5-coder:7b-instruct
# nomic-embed-text
```

### Step 6: Start the API Server

```bash
# Activate virtual environment if not already active
source .venv/bin/activate  # macOS/Linux
# or
.\.venv\Scripts\Activate.ps1  # Windows

# Start the API server
python -m api.main

# Or use the installed script
vibecheck-api
```

Expected output:

```
INFO:     Started server process
INFO:     Waiting for application startup.
INFO:     Application startup complete.
INFO:     Uvicorn running on http://0.0.0.0:8000
```

### Step 7: Verify API Documentation

Open your browser and navigate to:

- **Swagger UI:** [http://localhost:8000/docs](http://localhost:8000/docs)
- **ReDoc:** [http://localhost:8000/redoc](http://localhost:8000/redoc)

### Step 8: Start the Scan Worker

In a new terminal:

```bash
# Navigate to vibecheck directory
cd /path/to/solaris-agent/vibecheck

# Activate virtual environment
source .venv/bin/activate  # macOS/Linux
# or
.\.venv\Scripts\Activate.ps1  # Windows

# Start the worker
python -m worker.scan_worker

# Or use the installed script
vibecheck-worker
```

### Step 9: Trigger a Test Scan

```bash
# Trigger a scan using curl
curl -X POST http://localhost:8000/scan/trigger \
  -H "Content-Type: application/json" \
  -d '{"repo_url": "https://github.com/juice-shop/juice-shop"}'

# Expected response:
# {"job_id": "uuid-here", "status": "pending", "message": "Scan triggered successfully"}
```

### Step 10: Run Tests

```bash
# Run all tests
pytest tests/ -v

# Run with coverage
pytest tests/ -v --cov=. --cov-report=html
```

---

## Troubleshooting FAQ

### Docker Issues

#### Q: Docker containers fail to start with port conflicts

**A:** Check if another service is using the required ports:

```bash
# Windows (PowerShell)
netstat -ano | findstr :6379
netstat -ano | findstr :6333
netstat -ano | findstr :6380

# macOS/Linux
lsof -i :6379
lsof -i :6333
lsof -i :6380
```

To resolve, either stop the conflicting service or modify the port mappings in [`docker-compose.yml`](vibecheck/docker-compose.yml).

#### Q: Docker Desktop is slow on Windows

**A:** Ensure WSL2 is enabled:

1. Open PowerShell as Administrator
2. Run: `wsl --install`
3. Enable WSL2 integration in Docker Desktop settings

#### Q: Containers show "unhealthy" status

**A:** Check container logs:

```bash
# View logs for a specific container
docker compose logs falkordb
docker compose logs qdrant
docker compose logs redis

# Follow logs in real-time
docker compose logs -f
```

### Python Issues

#### Q: `ModuleNotFoundError: No module named 'xxx'`

**A:** Ensure you've activated the virtual environment and installed dependencies:

```bash
# Activate virtual environment
source .venv/bin/activate  # macOS/Linux
.\.venv\Scripts\Activate.ps1  # Windows

# Reinstall dependencies
pip install -e .
```

#### Q: Python version mismatch

**A:** Verify Python version:

```bash
python --version  # Should be 3.12 or higher

# If wrong version, create venv with specific Python
python3.12 -m venv .venv
```

#### Q: pip install fails with compilation errors

**A:** Install build dependencies:

```bash
# macOS (with Homebrew)
brew install python@3.12

# Linux (Ubuntu)
sudo apt-get install python3.12-dev build-essential

# Windows - Use pre-built wheels
pip install --upgrade pip
pip install -e . --prefer-binary
```

### Ollama Issues

#### Q: Ollama models fail to download

**A:** Check your internet connection and try again:

```bash
# Retry model pull
ollama pull qwen2.5-coder:7b-instruct

# Check Ollama logs
# macOS/Linux
ollama logs

# Windows - Check Docker Desktop logs if running in container
```

#### Q: `Error: model 'xxx' not found`

**A:** Ensure the model is installed:

```bash
# List installed models
ollama list

# Pull missing model
ollama pull qwen2.5-coder:7b-instruct
ollama pull nomic-embed-text
```

#### Q: Ollama runs out of memory

**A:** Try a smaller model or increase available memory:

```bash
# Use a smaller model
ollama pull qwen2.5-coder:1.5b

# Update .env
OLLAMA_CODER_MODEL=qwen2.5-coder:1.5b
```

### Supabase Issues

#### Q: `Invalid API key` error

**A:** Verify your credentials:

1. Go to Supabase Dashboard → Settings → API
2. Ensure you're using the **anon public** key, not the service_role key
3. Check that the URL format is correct: `https://your-project-id.supabase.co`

#### Q: Database tables don't exist

**A:** Run the migration SQL:

1. Go to Supabase Dashboard → SQL Editor
2. Create a new query
3. Copy and paste the contents of [`migrations/001_supabase_schema.sql`](vibecheck/migrations/001_supabase_schema.sql)
4. Click "Run"

#### Q: Realtime subscriptions not working

**A:** Enable Realtime in Supabase:

1. Go to Database → Replication
2. Enable replication for the tables you want to subscribe to

### API Issues

#### Q: `Connection refused` when accessing API

**A:** Verify the API server is running:

```bash
# Check if port 8000 is in use
lsof -i :8000  # macOS/Linux
netstat -ano | findstr :8000  # Windows

# Start the API server
python -m api.main
```

#### Q: API returns 500 Internal Server Error

**A:** Check the API logs for details:

```bash
# Run API with debug logging
LOG_LEVEL=DEBUG python -m api.main
```

Common causes:
- Missing environment variables
- Database connection issues
- Invalid configuration

#### Q: Scan jobs stuck in "pending" status

**A:** Ensure the worker is running:

```bash
# Start the worker
python -m worker.scan_worker

# Check Redis connection
docker exec -it vibecheck-redis redis-cli -p 6379 ping
```

### Network Issues

#### Q: Cannot connect to localhost services from Docker

**A:** Use the correct host address:

- **Windows/macOS:** Use `host.docker.internal`
- **Linux:** Use `172.17.0.1` or add `--add-host=host.docker.internal:host-gateway`

#### Q: Firewall blocking connections

**A:** Allow the required ports through your firewall:

- Port 6379 (FalkorDB)
- Port 6333 (Qdrant)
- Port 6380 (Redis)
- Port 8000 (API)
- Port 11434 (Ollama)

### Performance Issues

#### Q: Scans are very slow

**A:** Optimize performance:

1. Reduce repository size limit:
   ```bash
   MAX_REPO_SIZE_MB=100
   ```

2. Increase concurrent scans (if you have resources):
   ```bash
   MAX_CONCURRENT_SCANS=5
   ```

3. Use a GPU for Ollama inference

#### Q: High memory usage

**A:** Monitor and adjust:

```bash
# Check Docker resource usage
docker stats

# Reduce Docker memory limit in Docker Desktop settings
# Or use smaller models
OLLAMA_CODER_MODEL=qwen2.5-coder:1.5b
```

### Virtual Environment Issues

#### Q: Which virtual environment should I activate?

**A:** It depends on what you're doing:

| Task | Virtual Environment | Activate Command |
|------|---------------------|------------------|
| Running API server | `.venv` | `.\.venv\Scripts\Activate.ps1` (Windows) |
| Running scan worker | `.venv` | `.\.venv\Scripts\Activate.ps1` (Windows) |
| Installing app dependencies | `.venv` | `.\.venv\Scripts\Activate.ps1` (Windows) |
| Installing/updating Semgrep | `.semgrep-venv` | `.\.semgrep-venv\Scripts\Activate.ps1` (Windows) |

#### Q: `Semgrep not found` or `SEMGREP_BIN` error

**A:** Ensure Semgrep is installed in the isolated environment:

```bash
# Activate Semgrep virtual environment
.\.semgrep-venv\Scripts\Activate.ps1  # Windows
source .semgrep-venv/bin/activate     # macOS/Linux

# Install Semgrep
pip install semgrep

# Verify installation
semgrep --version

# Update .env with correct path
# Windows:
SEMGREP_BIN=d:/Projects/Prawin/solaris/solaris-agent/.semgrep-venv/Scripts/semgrep.exe

# macOS/Linux:
SEMGREP_BIN=/path/to/solaris-agent/.semgrep-venv/bin/semgrep
```

#### Q: Python version mismatch between venvs

**A:** Verify each virtual environment's Python version:

```bash
# Check main venv Python version
.\.venv\Scripts\python.exe --version    # Windows
.venv/bin/python --version              # macOS/Linux
# Expected: Python 3.10.x

# Check Semgrep venv Python version
.\.semgrep-venv\Scripts\python.exe --version    # Windows
.semgrep-venv/bin/python --version              # macOS/Linux
# Expected: Python 3.14.x
```

If versions are incorrect, recreate the virtual environment:

```bash
# Remove incorrect venv
rm -rf .venv  # macOS/Linux
rmdir /s .venv  # Windows

# Recreate with correct Python version
python3.10 -m venv .venv          # Main venv
python3.14 -m venv .semgrep-venv  # Semgrep venv
```

#### Q: Dependency conflicts between venvs

**A:** This is expected - the separate virtual environments are designed to prevent conflicts:

- **`.venv`** contains the main application dependencies (FastAPI, Redis, Qdrant clients, etc.)
- **`.semgrep-venv`** contains only Semgrep and its dependencies

Never mix dependencies between these environments. The worker calls Semgrep via subprocess using the `SEMGREP_BIN` path.

### Getting Help

If you encounter issues not covered in this guide:

1. **Check the logs:**
   ```bash
   # API logs
   LOG_LEVEL=DEBUG python -m api.main

   # Worker logs
   LOG_LEVEL=DEBUG python -m worker.scan_worker

   # Docker logs
   docker compose logs -f
   ```

2. **Search existing issues:** [GitHub Issues](https://github.com/your-org/solaris-agent/issues)

3. **Create a new issue:** Include:
   - Operating system and version
   - Python version (`python --version`)
   - Docker version (`docker --version`)
   - Error messages and logs
   - Steps to reproduce

---

## Quick Reference Commands

```bash
# Start all services
docker compose up -d

# Stop all services
docker compose down

# View logs
docker compose logs -f

# Rebuild containers
docker compose up -d --build

# Start API server
python -m api.main

# Start scan worker
python -m worker.scan_worker

# Run tests
pytest tests/ -v

# Pull Ollama models
ollama pull qwen2.5-coder:7b-instruct
ollama pull nomic-embed-text

# Check service health
curl http://localhost:6333/health  # Qdrant
docker exec -it vibecheck-falkordb redis-cli ping  # FalkorDB
docker exec -it vibecheck-redis redis-cli ping  # Redis
```

---

*Last Updated: February 2026 | Version 1.0*
