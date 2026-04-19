# Project VibeCheck — Red Team Agent Swarm

Autonomous offensive security agent swarm that executes kill chains against web applications using LLM-powered agents.

## Architecture

- **Commander** (Qwen3-235B via OpenRouter) — Strategy & task decomposition
- **Agent Alpha** (Ollama local) — Reconnaissance (nmap, Nuclei, git mining)
- **Agent Gamma** (Ollama local) — Exploitation (payloads, SQLi, XSS)
- **Redis Streams** — Agent-to-agent messaging bus
- **Docker Sandbox** — Isolated Kali container for tool execution
- **PentAGI Loop** — Self-reflection on failed exploits + payload rewriting
- **HITL Gate** — Human approval required for destructive commands

## Quickstart

```bash
# 1. Copy env and fill in your keys
cp .env.example .env

# 2. Start infrastructure
docker compose up -d

# 3. Install Python deps
pip install -r requirements.txt

# 4. Verify connectivity
python scripts/health_check.py

# 5. Run a mission
python scripts/run_mission.py --objective "Recon and exploit Juice Shop at localhost:3000"
```

## Target

OWASP Juice Shop — the canonical intentionally vulnerable web application.
