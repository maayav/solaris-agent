# 🛡️ VibeCheck - Red Team + Blue Team Integration

**VibeCheck** is a unified autonomous security testing platform that combines offensive (Red Team) and defensive (Blue Team) capabilities into a single, cohesive system. This integration enables real-time adaptation where the Red Team adjusts its attack strategy based on Blue Team defensive analytics.

## 🎯 Core Concept

```
┌─────────────────────────────────────────────────────────────────┐
│                        VibeCheck Platform                        │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐              ┌─────────────┐                   │
│  │  Red Team   │◄────────────►│  Blue Team  │                   │
│  │  (Attack)   │  Redis IPC   │  (Defense)  │                   │
│  └─────────────┘              └─────────────┘                   │
│         │                              │                        │
│         ▼                              ▼                        │
│  ┌─────────────────────────────────────────────────┐            │
│  │           Shared Docker Sandbox                  │            │
│  │         (vibecheck-sandbox container)            │            │
│  └─────────────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
vibecheck/
├── Red_team/              # Offensive security engine
│   ├── agents/            # Attack agents (Commander, Gamma, Alpha)
│   ├── core/              # Redis bus, config, LLM clients
│   ├── sandbox/           # Shared sandbox manager
│   └── missions/          # Attack mission definitions
│
├── Blue_team/             # Defensive security engine
│   └── solaris-agent/     # VibeCheck Blue Team agent
│       ├── core/          # Blue team core modules
│       └── ...
│
├── shared/                # Shared resources
│   ├── requirements.txt   # Python dependencies
│   └── setup.sh          # Setup script
│
├── scripts/               # Execution scripts
│   ├── run_blue_team.py       # Standalone Blue Team launcher
│   ├── run_combined_engine.py # Unified Red+Blue launcher
│   └── battle_drill.py        # Integration test
│
└── tests/                 # Test suite
```

## 🚀 Quick Start

### Prerequisites

- Python 3.10+
- Docker (for sandbox execution)
- Redis server running on `localhost:6381`
- Target application (e.g., OWASP Juice Shop) on `localhost:3000`

### 1. Setup

```bash
cd /home/gman/vibecheck
chmod +x shared/setup.sh
./shared/setup.sh
```

### 2. Start Redis

```bash
redis-server --port 6381
```

### 3. Start Target Application

```bash
# Example: OWASP Juice Shop
docker run -d -p 3000:3000 bkimminich/juice-shop
```

### 4. Run Blue Team (Terminal 1)

```bash
./venv/bin/python scripts/run_blue_team.py
```

### 5. Run Red Team + Integration (Terminal 2)

```bash
./venv/bin/python scripts/run_combined_engine.py
```

## 🔧 Architecture Details

### Red Team (Offensive)

The Red Team uses a LangGraph-based multi-agent system:

- **Commander Agent**: Orchestrates the attack, adapts strategy based on Blue Team intel
- **Alpha Recon**: Performs reconnaissance and vulnerability scanning
- **Gamma Exploit**: Executes exploits and payload delivery
- **Critic Agent**: Reviews and validates findings

**Key Features:**
- Dynamic strategy adaptation based on Blue Team analytics
- `FORBIDDEN` endpoint tracking (5-iteration cooldown on HIGH severity detections)
- Shared Docker sandbox for safe tool execution

### Blue Team (Defensive)

The Blue Team monitors traffic and generates defensive analytics:

- Real-time request analysis
- Attack signature detection (SQLi, XSS, etc.)
- Severity classification (LOW, MEDIUM, HIGH, CRITICAL)
- Redis stream publishing for Red Team consumption

**Key Features:**
- Mock database fallback (no external dependencies required)
- Cross-platform compatibility (Linux/Windows)
- VibeCheck branding and visual feedback

### Integration Bridge

The Red and Blue teams communicate via Redis Streams:

```python
# Blue Team publishes:
stream: "defense_analytics"
data: {
    "timestamp": "...",
    "source_ip": "...",
    "attack_type": "SQL_INJECTION",
    "severity": "HIGH",
    "target_endpoint": "/api/login",
    "blocked": True
}

# Red Team consumes and adapts:
- HIGH severity → Mark endpoint FORBIDDEN for 5 iterations
- Adjusts strategy in Commander's OBSERVE_PROMPT
- Routes Gamma to alternative endpoints
```

### Shared Sandbox

A single Docker container (`vibecheck-sandbox`) is shared between teams:

- **Privileged mode**: Required for advanced tooling
- **Network host mode**: Direct localhost access
- **Keep-Alive Rule**: Auto-restart on container failure (exit code -1)
- **Action Logging**: Real-time output streaming (first 10 lines)

## 🎮 Usage Examples

### Standalone Blue Team

```bash
./venv/bin/python scripts/run_blue_team.py
```

Output:
```
🛡️  VibeCheck Blue Team Agent Starting...
═══════════════════════════════════════════════════════════════
🔌 Redis: Connected to localhost:6381
🗄️  Database: Using MockDB (fallback mode)
🌐 Target: localhost:3000
───────────────────────────────────────────────────────────────
🚀 Blue Team Agent Active
   📡 Publishing to: defense_analytics
   🎯 Monitoring: localhost:3000
   ⏱️  Interval: 10s
───────────────────────────────────────────────────────────────
```

### Unified Red+Blue Engine

```bash
./venv/bin/python scripts/run_combined_engine.py
```

This launches:
1. Blue Team as subprocess
2. Red Team with integrated Blue Team intel
3. Redis bridge for real-time communication

### Battle Drill (Integration Test)

```bash
./venv/bin/python scripts/battle_drill.py
```

Simulates the full Red→Blue→Pivot flow to verify integration.

## 📝 Configuration

### Environment Variables

Create `.env` files in respective directories:

**Red Team** (`Red_team/.env`):
```env
REDIS_HOST=localhost
REDIS_PORT=6381
OLLAMA_URL=http://localhost:11434
OPENROUTER_API_KEY=your_key_here
```

**Blue Team** (`Blue_team/solaris-agent/.env`):
```env
REDIS_HOST=localhost
REDIS_PORT=6381
QDRANT_HOST=localhost
QDRANT_PORT=6333
FALKORDB_HOST=localhost
FALKORDB_PORT=6379
SUPABASE_URL=your_supabase_url
SUPABASE_KEY=your_supabase_key
```

### Redis Streams

| Stream | Publisher | Consumer | Purpose |
|--------|-----------|----------|---------|
| `agent_a2a` | All agents | All agents | Inter-agent messaging |
| `defense_analytics` | Blue Team | Red Team Commander | Defensive intel |
| `mission_events` | Red Team | API/Frontend | Mission status |

## 🧪 Testing

### Unit Tests

```bash
./venv/bin/python -m pytest tests/ -v
```

### Integration Test

```bash
./venv/bin/python scripts/battle_drill.py
```

### Manual Verification

1. Start Blue Team
2. Start Red Team mission
3. Watch for "🔴 Blue Team detected" messages
4. Verify endpoint is marked FORBIDDEN
5. Confirm Gamma pivots to alternative endpoint

## 🔒 Security Considerations

- **Sandbox Isolation**: All tools run in privileged Docker container
- **No Production Targets**: Designed for CTF/lab environments only
- **Redis Security**: Use AUTH and bind to localhost in production
- **API Keys**: Store in `.env` files, never commit to git

## 🐛 Troubleshooting

### Container Exit Code -1

The sandbox implements Keep-Alive Rule - it will auto-restart on failure.

### Redis Connection Failed

Ensure Redis is running:
```bash
redis-cli -p 6381 ping
```

### Import Errors

Ensure you're using the virtual environment:
```bash
source vibecheck/venv/bin/activate
```

### Blue Team Database Errors

Blue Team falls back to MockDB automatically if Qdrant/FalkorDB/Supabase are unavailable.

## 📚 Documentation

- `Red_team/Docs/PRD.md` - Product Requirements Document
- `Red_team/Docs/RED_TEAM.md` - Red Team architecture
- `Blue_team/solaris-agent/README.md` - Blue Team documentation

## 🤝 Contributing

This is an integrated security testing platform. When contributing:

1. Maintain separation between Red and Blue team logic
2. Use the Redis bridge for cross-team communication
3. Test on Linux environment
4. Follow existing code style and patterns

## 📄 License

MIT License - See individual component directories for details.

## 🙏 Acknowledgments

- Red Team: Angel-Engine autonomous pentesting framework
- Blue Team: Solaris-Agent defensive monitoring system
- Integration: VibeCheck unified platform

---

**⚠️ DISCLAIMER**: This tool is for authorized security testing only. Always obtain proper permission before testing any system you do not own.
