# Project VibeCheck

**Dual-Agent Autonomous Security System for AI-Generated Code**

VibeCheck is a security ecosystem that audits and attacks AI-generated ("vibecoded") software. It uses a Knowledge Graph + GraphRAG pipeline to expose hidden dependencies and architectural timebombs invisible to linters, and a hierarchical multi-agent swarm to simulate real adversary kill chains.

## Features

- **Blue Team (Analyst Agent):** Detects N+1 queries, hardcoded secrets, and architectural drift using Knowledge Graph analysis
- **Red Team (Multi-Agent Swarm):** Performs reconnaissance, social engineering simulation, and exploit generation
- **Real-time Dashboard:** Visualizes kill chains and vulnerability reports via React Flow

## Architecture

```
Local Infrastructure (Docker)
  - FalkorDB (Graph Database) - Port 6379
  - Qdrant (Vector Database) - Port 6333
  - Redis (Message Bus) - Port 6380
  - Ollama (Local LLM) - Port 11434

Cloud Services (Free Tier)
  - Supabase (Postgres + Realtime)
  - OpenRouter (Cloud LLM fallback)
```

## Quick Start

### Prerequisites

1. **Docker Desktop** - [Install](https://www.docker.com/products/docker-desktop/)
2. **Python 3.12+** - [Install](https://www.python.org/downloads/)
3. **Ollama** - [Install](https://ollama.ai/)
4. **Supabase Account** - [Sign up](https://supabase.com) (free tier)

### Setup

1. **Clone the repository:**
   ```bash
   cd vibecheck
   ```

2. **Start Docker services:**
   ```bash
   docker compose up -d
   ```

3. **Install Python dependencies:**
   ```bash
   pip install -e .
   ```

4. **Pull Ollama models:**
   ```bash
   ollama pull qwen2.5-coder:7b-instruct
   ollama pull nomic-embed-text
   ```

5. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your Supabase credentials
   ```

6. **Run Supabase migrations:**
   - Go to Supabase SQL Editor
   - Run the contents of `migrations/001_supabase_schema.sql`

### Running the Application

1. **Start the API server:**
   ```bash
   python -m api.main
   # or
   vibecheck-api
   ```

2. **Start the scan worker (in another terminal):**
   ```bash
   python -m worker.scan_worker
   # or
   vibecheck-worker
   ```

3. **Trigger a scan:**
   ```bash
   curl -X POST http://localhost:8000/scan/trigger \
     -H "Content-Type: application/json" \
     -d '{"repo_url": "https://github.com/juice-shop/juice-shop"}'
   ```

4. **Check the API docs:**
   - Open http://localhost:8000/docs

## Project Structure

```
vibecheck/
  api/                    # FastAPI application
    main.py               # API entry point
    routes/
      scan.py             # Scan endpoints
      report.py           # Report endpoints
  core/                   # Core clients
    config.py             # Settings management
    falkordb.py           # Graph database client
    qdrant.py             # Vector database client
    redis_bus.py          # Message bus client
    ollama.py             # LLM client
  worker/                 # Background workers
    scan_worker.py        # Scan job processor
  migrations/             # Database migrations
    001_supabase_schema.sql
  docker-compose.yml      # Local infrastructure
  pyproject.toml          # Python project config
```

## Week 1 Exit Criteria

- [x] `docker compose up` starts all services (FalkorDB, Qdrant, Redis)
- [x] `POST /scan/trigger` with a repo URL writes job to Redis Stream
- [x] Worker reads job, clones repo, prints file tree
- [ ] No analysis yet - just infrastructure working

## Development Status

| Week | Focus | Status |
|------|-------|--------|
| 1 | Foundation (Local Brain) | In Progress |
| 2 | Tree-Sitter Parser + FalkorDB Graph | Pending |
| 3 | LightRAG + LLM Verification | Pending |
| 4 | Red Team MVP | Pending |
| 5 | Next.js Dashboard | Pending |
| 6 | Integration + Demo | Pending |

## Testing

Run tests with pytest:
```bash
pytest tests/ -v
```

## License

MIT License - See [LICENSE](LICENSE) for details.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## References

- [OWASP Juice Shop](https://github.com/juice-shop/juice-shop) - Canonical test target
- [FalkorDB](https://falkordb.com/) - Graph database
- [Qdrant](https://qdrant.tech/) - Vector database
- [LightRAG](https://github.com/HKUDS/LightRAG) - GraphRAG engine
- [LangGraph](https://langchain-ai.github.io/langgraph/) - Agent framework