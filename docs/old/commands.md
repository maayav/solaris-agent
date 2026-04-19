backend:
python -m api.main
py -m uvicorn api.main:app --host 0.0.0.0 --port 8002 --app-dir vibecheck

python -c "
import redis
r = redis.from_url('redis://localhost:6380')

# How many messages in the stream
length = r.xlen('scan_queue')
print(f'Jobs in scan_queue: {length}')

# Show the latest message
msgs = r.xrevrange('scan_queue', count=3)
for id, data in msgs:
    print(f'  ID: {id}')
    print(f'  Data: {data}')

# Show pending (claimed but not ACKed)
pending = r.xpending('scan_queue', 'scan_workers')
print(f'Pending (stuck): {pending}')
"



python -c "
import redis
r = redis.from_url('redis://localhost:6380')

# ACK all 4 stuck pending messages
stuck_ids = [
    '1772273891633-0'
]
for id in stuck_ids:
    r.xack('scan_queue', 'scan_workers', id)
    print(f'ACKed {id}')

# Delete the entire stream to wipe all 19 jobs
r.delete('scan_queue')
print('Stream deleted - clean slate')
"


Get-WmiObject Win32_Process | Where-Object {$_.CommandLine -like "*scan_worker*"} | Select-Object ProcessId, CommandLine

Stop-Process -Id 34888 -Force



╔══════════════════════════════════════════════════════════════════╗
║            VibeCheck Setup Complete for macOS!                   ║
╠══════════════════════════════════════════════════════════════════╣
║                                                                  ║
║  NEXT STEPS:                                                     ║
║                                                                  ║
║  1. Configure environment:                                       ║
║     nano vibecheck/.env                                          ║
║                                                                  ║
║     Add your:                                                    ║
║     - Supabase URL and Anon Key                                  ║
║     - OpenRouter API Key                                         ║
║                                                                  ║
║  2. Run Supabase migrations:                                     ║
║     Go to Supabase SQL Editor and run:                           ║
║     migrations/001_supabase_schema.sql                           ║
║                                                                  ║
║  3. Start all services:                                          ║
║     cd vibecheck && ./start-all.sh                               ║
║                                                                  ║
║  4. Test the scan:                                               ║
║     ./test-scan.sh https://github.com/juice-shop/juice-shop      ║
║                                                                  ║
║  AVAILABLE COMMANDS:                                             ║
║                                                                  ║
║  ./start-all.sh      - Start all services                        ║
║  ./stop-all.sh       - Stop all services                         ║
║  ./test-scan.sh      - Trigger a test scan                       ║
║  ./verify-setup.py   - Verify installation                       ║
║  docker compose up -d - Start Docker services only               ║
║                                                                  ║
║  ACCESS POINTS:                                                  ║
║                                                                  ║
║  API Server:      http://localhost:8000                          ║
║  API Docs:        http://localhost:8000/docs                     ║
║  FalkorDB:        redis://localhost:6379                         ║
║  Qdrant:          http://localhost:6333                          ║
║  Redis:           redis://localhost:6380                         ║
║  Ollama:          http://localhost:11434                         ║
║                                                                  ║
╚══════════════════════════════════════════════════════════════════╝

NOTE FOR macOS:
- Ollama runs as a service via 'brew services'
- Docker Desktop must be kept running
- The setup uses isolated Semgrep venv (.semgrep-venv/bin/semgrep)


pkill -f "scan_worker" 2>/dev/null && echo "✅ All scan workers killed" || echo "ℹ️ No scan workers found running"


## Mission Management Script Created ✅

I've created tools to check and manage pending missions in Redis.

### 📋 New Scripts

1. **`scripts/check_missions.py`** - Python script to manage missions
2. **`scripts/check_missions.ps1`** - PowerShell wrapper for Windows

### 🚀 Usage

#### Check Pending Missions (Default)
```powershell
.\scripts\check_missions.ps1
```
Shows:
- Pending missions count
- Message details
- Consumer groups
- Stream statistics

#### List All Redis Streams
```powershell
.\scripts\check_missions.ps1 -Streams
```
Shows all streams and their consumer groups.

#### Show Recent Missions
```powershell
.\scripts\check_missions.ps1 -Recent
# Or with count
.\scripts\check_missions.ps1 -Recent -Count 20
```

#### Claim Stuck Missions
```powershell
.\scripts\check_missions.ps1 -Claim
```
Claims pending missions and acknowledges them. Use this when missions are stuck because a worker crashed.

#### Clear All Pending (Danger!)
```powershell
.\scripts\check_missions.ps1 -Clear
```
**Warning:** This permanently clears all pending missions!

### 📊 Understanding Mission States

| State | Description | Action |
|-------|-------------|--------|
| **Pending** | Mission sent to worker but not acknowledged | Check if worker is running |
| **Claimed** | Mission claimed by a worker | Normal - being processed |
| **Acknowledged** | Mission completed | Removed from pending |

### 🔧 Common Issues

**Missions stuck in pending:**
1. Worker crashed or was stopped
2. Use `-Claim` to recover and reprocess

**No missions showing:**
1. Redis is empty - no missions were triggered
2. Wrong Redis port - check `.env` has port 6380

**Can't connect to Redis:**
1. Make sure Blue Team's docker-compose is running:
   ```powershell
   cd ..\..\vibecheck
   docker compose up -d
   ```



.\scripts\swarm_worker.ps1 -Once
.\scripts\health_check.ps1
.\scripts\check_missions.ps1
.\scripts\run_mission.ps1 -Objective "Scan for SQLi" -Target "http://localhost:8080"

cd "swarm module\Red_team"
python -c "
import redis
import json
r = redis.Redis(host='localhost', port=6380, decode_responses=True)
mission = {
    'action': 'start',
    'target': 'http://localhost:8080',
    'objective': 'Scan Juice Shop for vulnerabilities',
    'mode': 'live'
}
r.xadd('swarm_missions', {'data': json.dumps(mission)})
print('Mission submitted!')
"


# Run all tests
pytest tests/test_swarm_pipeline.py -v

# Run specific categories
pytest tests/test_swarm_pipeline.py -m critical -v
pytest tests/test_swarm_pipeline.py -m regression -v
pytest tests/test_swarm_pipeline.py -m unit -v

# Run specific test
pytest tests/test_swarm_pipeline.py::TestCriticalBugs::TestRedisStream::test_xack_on_completion -v

# With coverage
pytest tests/test_swarm_pipeline.py --cov=agents --cov=core --cov-report=html
