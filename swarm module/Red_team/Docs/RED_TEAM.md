# Red Team Agent Swarm Documentation

## Overview

The Red Team module implements an autonomous security testing agent swarm using LangGraph for orchestration. The system follows a **Plan → Recon → Exploit → Observe → Report** loop inspired by the PentAGI architecture and Cyber Kill Chain framework.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         RED TEAM AGENT SWARM                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐               │
│   │  COMMANDER   │────▶│ ALPHA RECON  │────▶│GAMMA EXPLOIT │               │
│   │  (Planner)   │     │ (Recon Agent)│     │(Exploit Agent)│              │
│   └──────┬───────┘     └──────────────┘     └──────┬───────┘               │
│          │                                          │                       │
│          │                                          ▼                       │
│          │                                 ┌──────────────┐                │
│          │                                 │  HITL GATE   │                │
│          │                                 │ (Safety Check)│               │
│          │                                 └──────┬───────┘                │
│          │                                          │                       │
│          ▼                                          ▼                       │
│   ┌──────────────┐                         ┌──────────────┐                │
│   │  REPORT GEN  │◀────────────────────────│ COMMANDER    │                │
│   │  (Output)    │                         │  OBSERVE     │                │
│   └──────────────┘                         └──────────────┘                │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Commander Agent (`agents/commander.py`)

**Role**: Mission orchestrator and strategic planner

**Responsibilities**:
- Analyze mission objectives and generate task assignments
- Coordinate between Alpha (recon) and Gamma (exploit) agents
- Evaluate results and determine next actions
- Decide when mission is complete

**LLM Configuration**:
- Primary: OpenRouter (cloud LLM with fallback chain)
- Fallback: Ollama (local inference)

**Key Functions**:
- `commander_plan()`: Generates initial task assignments based on objective
- `commander_observe()`: Evaluates results and issues new tasks or declares completion

**Output Messages**:
- `TASK_ASSIGNMENT`: Directs agents to perform specific actions

---

### 2. Alpha Recon Agent (`agents/alpha_recon.py`)

**Role**: Reconnaissance and intelligence gathering

**Responsibilities**:
- Execute network scanning (nmap)
- Run vulnerability scans (nuclei)
- Perform HTTP requests (curl)
- Execute custom Python scripts
- Generate intelligence reports

**LLM Configuration**:
- Primary: Ollama (local inference for speed)

**Key Functions**:
- `alpha_recon()`: Processes task assignments and executes recon tools
- Tool selection based on task type

**Output Messages**:
- `INTELLIGENCE_REPORT`: Findings with confidence scores and CVE hints

---

### 3. Gamma Exploit Agent (`agents/gamma_exploit.py`)

**Role**: Exploitation and impact assessment

**Responsibilities**:
- Execute exploit attempts based on recon findings
- Self-reflect on failed exploits and retry with corrections
- Generate exploit results with impact assessment
- Trigger HITL approval for destructive payloads

**LLM Configuration**:
- Primary: Ollama (local inference)

**Key Functions**:
- `gamma_exploit()`: Processes intel and attempts exploitation
- `hitl_approval_gate()`: Safety check for destructive operations
- `_self_reflect_and_retry()`: Analyzes failures and corrects payloads

**Output Messages**:
- `EXPLOIT_RESULT`: Success/failure status with evidence

**Safety Features**:
- Destructive pattern detection (rm -rf, DROP TABLE, etc.)
- Human-in-the-loop approval gate
- Maximum reflection limit to prevent infinite loops

---

### 4. HITL Safety Gate (`agents/gamma_exploit.py`)

**Role**: Human-in-the-loop safety mechanism

**Purpose**: Prevent accidental damage from destructive payloads

**Detection Patterns**:
```python
DESTRUCTIVE_PATTERNS = [
    "rm -rf", "DROP TABLE", "DELETE FROM", "format disk",
    "shutdown", "reboot", "dd if=", "mkfs", "wipe",
    ":(){ :|:& };:",  # Fork bomb
]
```

**Flow**:
1. Gamma generates exploit payload
2. HITL gate scans for destructive patterns
3. If detected, mission pauses for human approval
4. Human can approve, deny, or modify

---

### 5. Report Generator (`agents/report_generator.py`)

**Role**: Mission documentation and reporting

**Responsibilities**:
- Generate comprehensive mission reports
- Calculate kill chain progress
- Provide actionable recommendations
- Save reports in JSON and text formats

**Report Contents**:
- Mission summary (objective, target, duration)
- Reconnaissance findings with confidence scores
- Exploitation results with success/failure status
- Kill chain progress percentage
- Statistics (messages, attempts, reflections)
- Security recommendations

**Output**:
- Console output (formatted text)
- File output (`reports/mission_{id}_{timestamp}.json` and `.txt`)

---

## State Management

### RedTeamState Schema (`agents/state.py`)

```python
class RedTeamState(TypedDict):
    # Mission Identity
    mission_id: str
    objective: str
    target: str

    # Phase Tracking
    phase: Literal["planning", "recon", "exploitation", "reporting", "complete"]

    # Message Accumulator
    messages: Annotated[list[A2AMessage], operator.add]

    # Shared Intelligence
    blackboard: dict[str, Any]

    # Agent Outputs
    recon_results: list[dict[str, Any]]
    exploit_results: list[dict[str, Any]]

    # Commander Strategy
    current_tasks: list[dict[str, Any]]
    strategy: str

    # Control Flow
    iteration: int
    max_iterations: int
    needs_human_approval: bool
    human_response: str | None

    # Self-Reflection
    reflection_count: int
    max_reflections: int
    pending_exploit: dict[str, Any] | None

    # Mission Report
    report: dict[str, Any] | None
    report_path: str | None

    # Error Handling
    errors: list[str]
```

---

## A2A Messaging System

### Message Types (`agents/a2a/messages.py`)

```python
class MessageType(Enum):
    TASK_ASSIGNMENT = "task_assignment"      # Commander → Agents
    INTELLIGENCE_REPORT = "intel_report"     # Alpha → Commander
    EXPLOIT_RESULT = "exploit_result"        # Gamma → Commander
    STATUS_UPDATE = "status_update"          # Agent → Blackboard
    ERROR = "error"                          # Any → Error handler
```

### Message Schema

```python
class A2AMessage(TypedDict):
    id: str                    # UUID
    type: MessageType          # Message category
    sender: AgentRole          # COMMANDER, ALPHA, GAMMA
    recipient: AgentRole       # Target agent or ALL
    priority: Priority         # LOW, MEDIUM, HIGH, CRITICAL
    payload: dict[str, Any]    # Message content
    timestamp: str             # ISO 8601
    mission_id: str            # Mission reference
```

---

## Tool System

### Available Tools (`agents/tools/`)

| Tool | File | Purpose |
|------|------|---------|
| **nmap** | `nmap_tool.py` | Network port scanning, service detection |
| **nuclei** | `nuclei_tool.py` | Vulnerability scanning with templates |
| **curl** | `curl_tool.py` | HTTP requests, API probing |
| **python** | `python_exec.py` | Custom script execution |

### Tool Registry (`agents/tools/registry.py`)

```python
# Get tool by name
tool = get_tool("nmap")

# Execute tool
result = await tool.execute(target="localhost", ports="80,443", scan_type="syn")
```

### Sandbox Execution

All tools execute inside a Docker sandbox for isolation:

```python
# Sandbox configuration (sandbox/Dockerfile.sandbox)
FROM kalilinux/kali-rolling
RUN apt-get update && apt-get install -y nmap nuclei curl python3
```

---

## Execution Flow

### 1. Mission Initialization

```python
from agents.graph import build_red_team_graph, create_initial_state

# Create initial state
state = create_initial_state(
    objective="Assess web application security",
    target="http://localhost:3000",
    max_iterations=5,
)

# Build and run graph
graph = build_red_team_graph()
result = await graph.ainvoke(state)
```

### 2. Planning Phase

```
Commander receives objective → Generates strategy → Creates task assignments
```

### 3. Reconnaissance Phase

```
Alpha receives tasks → Executes tools → Generates intelligence reports
```

### 4. Exploitation Phase

```
Gamma receives intel → Attempts exploits → Self-reflects on failures → Reports results
```

### 5. Observation Phase

```
Commander evaluates results → Issues new tasks OR declares completion
```

### 6. Reporting Phase

```
Generate report → Print to console → Save to files → END
```

---

## Configuration

### Environment Variables (`.env`)

```bash
# LLM Configuration
OPENROUTER_API_KEY=your_key_here
OLLAMA_BASE_URL=http://localhost:11434

# Model Selection
COMMANDER_MODEL=openrouter:deepseek/deepseek-r1-0528:free
ALPHA_MODEL=ollama:qwen2.5-coder:7b-instruct
GAMMA_MODEL=ollama:qwen2.5-coder:7b-instruct

# Redis (for A2A messaging)
REDIS_URL=redis://localhost:6379

# Sandbox
SANDBOX_IMAGE=red-team-sandbox:latest
SANDBOX_TIMEOUT=300
```

### Mission Configuration (`missions/*.yaml`)

```yaml
mission:
  id: juice-shop-recon
  objective: "Perform reconnaissance on OWASP Juice Shop"
  target: "http://localhost:3000"
  
execution:
  max_iterations: 5
  max_reflections: 3
  timeout: 600
  
tools:
  allowed:
    - nmap
    - nuclei
    - curl
    - python
  
safety:
  hitl_enabled: true
  destructive_patterns: true
```

---

## Running Missions

### Using the CLI

```bash
# Run with mission file
python scripts/run_mission.py --mission missions/juice_shop_recon.yaml

# Run with inline parameters
python scripts/run_mission.py --target http://localhost:3000 --objective "Security assessment"

# Run with custom iterations
python scripts/run_mission.py --mission missions/custom.yaml --max-iterations 10
```

### Health Check

```bash
# Verify all services are running
python scripts/health_check.py
```

---

## Output

### Console Output

```
============================================================
MISSION STARTED
============================================================
Mission ID: 1db2d070
Objective: Assess security of OWASP Juice Shop
Target: http://localhost:3000
============================================================

[COMMANDER] Planning phase...
[COMMANDER] Strategy: Begin with comprehensive reconnaissance...
[COMMANDER] Generated 2 tasks

[ALPHA] Executing nmap scan...
[ALPHA] Found: Open port 3000 (HTTP)
[ALPHA] Generated INTELLIGENCE_REPORT (confidence: 0.9)

[GAMMA] Attempting exploit: CVE-2021-45785
[GAMMA] Exploit failed - self-reflecting...
[GAMMA] Generated EXPLOIT_RESULT (success: false)

[HITL] No destructive patterns detected - proceeding

[COMMANDER] Observing results...
[COMMANDER] Issuing 1 new task

... (iterations continue) ...

============================================================
MISSION COMPLETE - Generating Report
============================================================

======================================================================
RED TEAM MISSION REPORT
======================================================================
...
```

### Report Files

Reports are saved to the `reports/` directory:

```
reports/
├── mission_1db2d070_20260224_160000.json
└── mission_1db2d070_20260224_160000.txt
```

---

## Error Handling

### Error Accumulation

Errors are collected in `state["errors"]` and included in the final report:

```python
# Errors are logged and accumulated
state["errors"].append(f"Tool execution failed: {error}")

# Included in report
report["errors"] = state["errors"]
```

### Fallback Mechanisms

1. **LLM Fallback**: OpenRouter → Ollama
2. **Tool Fallback**: Docker sandbox → Local execution (if configured)
3. **Iteration Limit**: Prevents infinite loops

---

## Security Considerations

### Sandbox Isolation

- All tools run in Docker containers
- Network access controlled via Docker networking
- No direct host filesystem access

### HITL Safety Gate

- Destructive patterns detected automatically
- Human approval required for dangerous operations
- Audit trail of all approvals/denials

### Rate Limiting

- Nuclei: `-rl 50` (50 requests/second)
- LLM API: Built-in retry with backoff

---

## Troubleshooting

### Common Issues

1. **Nuclei OOM Kill**
   - Symptom: Nuclei process killed during scan
   - Solution: Bulk size limit (`-bs 25`) reduces memory usage

2. **OpenRouter Rate Limits**
   - Symptom: 429 errors from API
   - Solution: Automatic fallback to Ollama

3. **Docker Connection Refused**
   - Symptom: Tools cannot connect to target
   - Solution: Use `--network host` for sandbox container

4. **Ollama Model Not Found**
   - Symptom: Model loading errors
   - Solution: `ollama pull qwen2.5-coder:7b-instruct`

---

## API Reference

### Graph Functions

```python
# Build the state machine
graph = build_red_team_graph()

# Create initial state
state = create_initial_state(objective, target, max_iterations)

# Run synchronously
result = graph.invoke(state)

# Run asynchronously
result = await graph.ainvoke(state)
```

### Report Functions

```python
from agents.report_generator import (
    generate_mission_report,
    format_report_text,
    save_report,
)

# Generate report dict
report = generate_mission_report(state)

# Format as text
text = format_report_text(report)

# Save to files
json_path, text_path = await save_report(report)
```

---

## Testing

### Run Tests

```bash
# All tests
pytest tests/ -v

# Specific test file
pytest tests/test_agents.py -v

# With coverage
pytest tests/ --cov=agents --cov=core
```

### Test Categories

- `test_agents.py`: State management, routing logic, graph construction
- `test_messaging.py`: A2A message serialization, payload schemas

---

## Future Enhancements

1. **Blue Team Integration**: Automated remediation suggestions
2. **Multi-Target Missions**: Parallel assessment of multiple targets
3. **Custom Tool Plugins**: User-defined tool integration
4. **Web Dashboard**: Real-time mission monitoring
5. **Report Templates**: Customizable report formats
