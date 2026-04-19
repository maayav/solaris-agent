# VibeCheck Real-Time Reporting Setup

This document describes how to set up and use the real-time reporting feature for VibeCheck.

## Overview

The real-time reporting system consists of:
1. **Supabase Backend** - Stores mission data and events
2. **WebSocket Broadcasting** - Streams live updates to connected clients
3. **Incremental Sync** - Non-blocking database writes during mission execution

## Step 1: Supabase Schema & Client Setup

### 1.1 Create Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project
2. Copy your Project URL and Anon/Public API Key
3. Add these to your `.env` file:
   ```
   SUPABASE_URL=https://your-project.supabase.co
   SUPABASE_KEY=eyJhbGciOiJIUzI1NiIs...
   ```

### 1.2 Run SQL Migrations

In the Supabase SQL Editor, run the migration file:

```bash
# File: migrations/001_supabase_reporting.sql
```

This creates:
- `missions` table - Stores mission metadata
- `mission_events` table - Stores real-time events (exploits, intelligence, etc.)
- Row Level Security policies
- Indexes for performance

### 1.3 Create Storage Bucket

1. Go to Storage in Supabase Dashboard
2. Create a new bucket named: `vibecheck_reports`
3. Set it as **Private** (requires authentication)
4. Allowed MIME types:
   - `application/pdf`
   - `text/plain`
   - `text/markdown`
   - `application/json`

### 1.4 Supabase Client Usage

```python
from core.supabase_client import get_supabase_client, fire_and_forget_log_event

# Get client instance
supabase = get_supabase_client(
    url="https://your-project.supabase.co",
    key="your-anon-key"
)

# Create a mission record
mission = await supabase.create_mission(
    mission_id="mission_001",
    target="http://localhost:3000",
    objective="Test for SQL injection",
    mode="live"
)

# Log an event (non-blocking)
await supabase.log_mission_event(
    mission_id="mission_001",
    event_type="exploit_result",
    payload_json={
        "tool": "curl",
        "target": "/api/login",
        "success": True,
        "vulnerability": "SQL Injection"
    }
)

# Fire-and-forget (won't block execution)
fire_and_forget_log_event(
    mission_id="mission_001",
    event_type="critic_analysis",
    payload_json={"grade": "A", "confidence": 0.95}
)

# Complete the mission
await supabase.complete_mission("mission_001", status="completed")

# Upload a report
url = await supabase.upload_report(
    mission_id="mission_001",
    file_content=b"Report content...",
    file_name="report.txt",
    content_type="text/plain"
)
```

## Step 2: WebSocket Real-Time Broadcasting

### 2.1 WebSocket Endpoint

The API provides a WebSocket endpoint for live mission updates:

```
ws://localhost:8000/ws/missions/{mission_id}
```

### 2.2 JavaScript Client Example

```javascript
const missionId = 'mission_001';
const ws = new WebSocket(`ws://localhost:8000/ws/missions/${missionId}`);

// Connection established
ws.onopen = () => {
    console.log('Connected to mission stream');
};

// Receive real-time updates
ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    console.log('Event type:', data.type);
    console.log('Payload:', data.payload);
    console.log('Timestamp:', data.timestamp);
    
    // Handle different event types
    switch(data.type) {
        case 'connection_established':
            console.log('Stream ready:', data.message);
            break;
        case 'exploit_result':
            displayExploitResult(data.payload);
            break;
        case 'intelligence_report':
            displayIntelligence(data.payload);
            break;
        case 'critic_analysis':
            displayCriticGrade(data.payload);
            break;
        case 'mission_status':
            updateMissionStatus(data.payload);
            break;
    }
};

// Send commands to server
ws.send(JSON.stringify({
    action: 'get_status'
}));

// Handle disconnection
ws.onclose = () => {
    console.log('Disconnected from mission stream');
};
```

### 2.3 Event Types

Events broadcasted via WebSocket:

| Event Type | Description | Payload Fields |
|------------|-------------|----------------|
| `connection_established` | Initial connection confirmation | `mission_id`, `message` |
| `exploit_result` | Gamma agent completed exploit | `tool`, `target`, `output`, `exit_code` |
| `intelligence_report` | Alpha agent discovered info | `findings`, `target_info` |
| `critic_analysis` | Critic graded an exploit | `grade`, `confidence`, `recommendations` |
| `tool_execution` | Tool was executed | `tool_name`, `command`, `duration_ms` |
| `phase_transition` | Mission phase changed | `from_phase`, `to_phase` |
| `mission_status` | Full mission status update | Full mission state object |
| `error` | Error occurred | `message`, `details` |

### 2.4 Python WebSocket Client Example

```python
import asyncio
import websockets
import json

async def watch_mission(mission_id):
    uri = f"ws://localhost:8000/ws/missions/{mission_id}"
    
    async with websockets.connect(uri) as websocket:
        print(f"Connected to mission {mission_id}")
        
        async for message in websocket:
            data = json.loads(message)
            print(f"[{data['type']}] {data.get('timestamp', '')}")
            
            if data['type'] == 'exploit_result':
                payload = data['payload']
                print(f"  Exploit: {payload.get('vulnerability', 'N/A')}")
                print(f"  Success: {payload.get('success', False)}")

# Run
asyncio.run(watch_mission("mission_001"))
```

## Architecture

```
┌─────────────────┐     WebSocket      ┌──────────────────┐
│   Web Client    │◄──────────────────►│   FastAPI API    │
│   (Dashboard)   │                    │   /ws/missions   │
└─────────────────┘                    └────────┬─────────┘
                                                │
                                                │ Subscribe
                                                ▼
                                       ┌──────────────────┐
                                       │   Redis Bus      │
                                       │  (Blackboard)    │
                                       └────────┬─────────┘
                                                │ Publish
                       ┌────────────────────────┼────────────────────────┐
                       ▼                        ▼                        ▼
               ┌───────────────┐      ┌───────────────┐      ┌───────────────┐
               │ Alpha Recon   │      │ Gamma Exploit │      │Critic Agent   │
               │               │      │               │      │               │
               └───────────────┘      └───────────────┘      └───────────────┘
                       │                        │                        │
                       └────────────────────────┼────────────────────────┘
                                                │
                                                ▼ Async (non-blocking)
                                       ┌──────────────────┐
                                       │   Supabase       │
                                       │  (mission_events)│
                                       └──────────────────┘
```

## Performance Considerations

- **Non-blocking writes**: Database operations use `asyncio.create_task()` to avoid blocking the mission execution
- **WebSocket broadcasting**: Happens asynchronously without waiting for client acknowledgment
- **Redis pub/sub**: Decouples agents from WebSocket clients, allowing multiple API instances

## Next Steps

- **Step 3**: Implement incremental state sync in `agents/graph.py` or A2A Blackboard
- **Step 4**: Refactor report generator to query Supabase and upload to storage

## Troubleshooting

### WebSocket Connection Refused
- Ensure the API server is running: `python -m api.main`
- Check the port (default: 8000)
- Verify CORS settings if connecting from browser

### Events Not Appearing
- Check Redis connection in `core/redis_bus.py`
- Verify `EXPLOIT_RESULT` and `INTELLIGENCE_REPORT` constants match
- Check Supabase client initialization logs

### Database Errors
- Verify SQL migrations ran successfully
- Check Supabase permissions (RLS policies)
- Ensure `supabase-py` is installed: `pip install supabase`
