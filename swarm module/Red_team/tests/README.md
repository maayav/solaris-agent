# Swarm Module Pipeline Test Suite

Comprehensive test suite for the entire Swarm Module pipeline covering critical bugs, high priority issues, regression tests, tool-specific tests, and exploit coverage.

## 📁 Test Structure

```
tests/
├── conftest.py              # Shared fixtures and configuration
├── pytest.ini               # Pytest configuration
├── run_tests.py             # Test runner script
├── test_swarm_pipeline.py   # Main test suite (800+ lines)
├── test_agents.py           # Existing agent tests
├── test_blue_team_integration.py  # Blue team integration tests
├── test_messaging.py        # Messaging tests
└── README.md               # This file
```

## 🚀 Quick Start

### Install Dependencies

```bash
# Install test dependencies
pip install pytest pytest-asyncio

# Optional: For coverage reports
pip install pytest-cov

# Optional: For HTML reports
pip install pytest-html
```

### Important Configuration Notes

The test suite uses `asyncio_mode = auto` in `pytest.ini`, which means:
- Async tests **do not** require `@pytest.mark.asyncio` decorator in most cases
- However, explicit `@pytest.mark.asyncio` is still recommended for clarity
- The decorator is included on all async tests in this suite for compatibility

All imports use **lazy loading** with `pytest.skip()` for missing modules:
- Tests will skip gracefully if dependencies are not available
- No collection errors even if entire modules are missing
- Use `pytest.importorskip()` alternative for cleaner skip messages

### Run All Tests

```bash
# Run all tests
pytest tests/test_swarm_pipeline.py -v

# Or use the test runner
python tests/run_tests.py
```

### Run Specific Test Categories

```bash
# Critical bug tests (Supabase, Redis, Qdrant)
python tests/run_tests.py -c

# Regression tests
python tests/run_tests.py -r

# Tool tests only
python tests/run_tests.py -t

# Unit tests only (fast, no external services)
python tests/run_tests.py -u
```

### Run with Options

```bash
# Verbose output
pytest tests/test_swarm_pipeline.py -v

# Stop on first failure
pytest tests/test_swarm_pipeline.py -x

# Run tests matching pattern
pytest tests/test_swarm_pipeline.py -k "test_redis"

# Run with coverage
pytest tests/test_swarm_pipeline.py --cov=agents --cov=core --cov-report=html

# Generate HTML report
pytest tests/test_swarm_pipeline.py --html=report.html --self-contained-html
```

## 📊 Test Categories

### 🔴 Critical Bugs (`TestCriticalBugs`)

Tests for bugs that break functionality:

- **Supabase/Event Bus**
  - `test_event_type_constraint_violation`: Critic event type violates constraint
  - `test_mission_id_validation`: Mission context lost in async forks
  - `test_agent_state_upsert_consistency`: Inconsistent upsert behavior

- **Redis Stream**
  - `test_xack_on_completion`: Message acknowledgment
  - `test_xack_on_exception`: XACK in exception handling
  - `test_claim_pending_messages`: Message recovery from crashed workers

- **Qdrant Memory**
  - `test_exploit_type_label_preservation`: XXE vs info_disclosure labeling
  - `test_duplicate_point_prevention`: Deduplication before upsert

### 🟠 High Priority Bugs (`TestHighPriorityBugs`)

Tests for incorrect behavior or missed vulnerabilities:

- **Critic Agent**
  - `test_exit_code_18_handling`: Curl partial transfer (exit 18)
  - `test_deterministic_pre_check_aggressiveness`: LLM review for ambiguous responses
  - `test_stealthier_recommendation_feedback_loop`: Critic→Commander feedback

- **Commander**
  - `test_phase_complete_task_count`: Meaningless tasks when phase=complete
  - `test_strategy_field_leakage`: Strategy text in reports
  - `test_idor_enumeration_plateau`: Probing beyond ID 1-5
  - `test_compromised_endpoint_counter`: Accurate counter logic
  - `test_temperature_zero_determinism`: Deterministic LLM output

- **Report Generator**
  - `test_severity_field_population`: Severity scoring
  - `test_dedup_stability`: Consistent deduplication
  - `test_kill_chain_stage_7_trigger`: Stage 7 completion
  - `test_recon_findings_determinism`: Deterministic recon
  - `test_evidence_truncation_consistency`: Consistent truncation
  - `test_json_txt_report_parity`: JSON vs TXT parity

### 🔧 Tool Tests (`TestTools`)

Tests for individual tools:

- **Curl Tool**: Basic requests, headers, exit code handling, localhost replacement
- **Nmap Tool**: URL parsing, custom args, duplicate flag handling
- **Ffuf Tool**: Wordlist population, FUZZ placeholder
- **Sqlmap Tool**: Payload list, basic scan
- **Nuclei Tool**: Template map, training app skip, invalid target handling
- **JWT Tool**: Base64 decoding, token parsing, signature creation, alg:none forgery

### 🟡 Exploit Coverage (`TestExploitCoverage`)

Tests for vulnerability coverage gaps:

- **Auth Bypass**: Angular route vs backend privilege
- **File Upload**: Multipart boundary formatting
- **JWT Algorithm**: Alg:none on authenticated endpoints
- **Password Reset**: Security question IDOR chain
- **SSRF**: Product image URL field
- **DOM XSS**: URL hash fragment testing
- **Chaining**: Admin JWT reuse, password hash extraction, git config extraction

### 🧪 Regression Tests (`TestRegression`)

Tests to prevent previously fixed bugs:

- `test_no_stuck_pending_messages`: Redis XACK bug
- `test_cross_mission_exploit_count_growth`: Qdrant memory persistence
- `test_exit_18_with_valid_body`: Critic exit code handling
- `test_all_event_types_in_allowlist`: Supabase event types
- `test_same_input_same_output`: Commander determinism
- `test_security_question_to_password_reset_chain`: IDOR chain
- `test_same_findings_same_dedup_count`: Report dedup stability

## 🎯 Test Markers

Use markers to run specific test categories:

| Marker | Description | Usage |
|--------|-------------|-------|
| `critical` | Critical bug tests | `pytest -m critical` |
| `high` | High priority tests | `pytest -m high` |
| `medium` | Medium priority tests | `pytest -m medium` |
| `regression` | Regression tests | `pytest -m regression` |
| `unit` | Unit tests | `pytest -m unit` |
| `integration` | Integration tests | `pytest -m integration` |
| `redis` | Redis tests | `pytest -m redis` |
| `supabase` | Supabase tests | `pytest -m supabase` |
| `qdrant` | Qdrant tests | `pytest -m qdrant` |
| `slow` | Slow tests | `pytest -m slow` |

## 🔧 Fixtures

### Session Fixtures

- `mock_juice_shop_responses`: Sample responses from Juice Shop
- `exploit_payloads`: Common exploit payloads (SQLi, XSS, IDOR, etc.)

### Function Fixtures

- `sample_mission_id`: Valid UUID for mission ID
- `sample_target`: Sample target URL
- `mock_exec_result`: Factory for mock execution results
- `sample_state`: Sample RedTeamState
- `mock_jwt_token`: Sample JWT token

### Async Fixtures

- `redis_bus`: Connected RedisBus instance
- `mock_supabase_client`: Mock Supabase client

## 🏗️ Test Design Principles

### Import Handling
All tests use **lazy imports** to prevent collection errors:

```python
def test_something():
    try:
        from core.redis_bus import RedisBus
    except ImportError:
        pytest.skip("core.redis_bus not available")
    # Test code here...
```

This ensures:
- Tests skip gracefully if dependencies are missing
- No collection failures when modules are unavailable
- CI can run partial test suites without full environment setup

### Test Isolation
- Each test uses unique identifiers (via `sample_mission_id` fixture)
- Redis stream names incorporate mission ID: `f"test_stream_{sample_mission_id[:8]}"`
- Mock clients prevent external service calls in unit tests

### Unimplemented Feature Handling
Tests for known gaps use `pytest.skip()` with descriptive messages:

```python
def test_feature_not_yet_implemented(self):
    pytest.skip("Not implemented: Need to add feature X for scenario Y")
```

This is preferred over `assert True` because:
- Skipped tests are visible in reports
- Shows honest status vs false confidence
- Easy to find and enable when feature is implemented

## 📈 Coverage

### Current Test Coverage Areas

| Component | Coverage Areas |
|-----------|---------------|
| **Agents** | Alpha, Commander, Critic, Gamma, Report Generator |
| **Tools** | curl, nmap, ffuf, sqlmap, nuclei, JWT |
| **Core** | Redis bus, Supabase client, Qdrant memory |
| **State** | Mission state, routing, graph construction |
| **Exploits** | SQLi, XSS, IDOR, LFI, XXE, SSRF, auth bypass |

### Coverage Report

```bash
# Generate coverage report
pytest tests/test_swarm_pipeline.py --cov=agents --cov=core --cov=sandbox --cov-report=term-missing

# Generate HTML coverage report
pytest tests/test_swarm_pipeline.py --cov=agents --cov=core --cov=sandbox --cov-report=html:htmlcov
```

## 🐛 Debugging Tests

### Debug Specific Test

```bash
# Run single test with verbose output
pytest tests/test_swarm_pipeline.py::TestCriticalBugs::TestRedisStream::test_xack_on_completion -v --tb=long

# Run with Python debugger
pytest tests/test_swarm_pipeline.py::TestCriticalBugs::TestRedisStream::test_xack_on_completion --pdb
```

### Debug Output

```python
# Add to test for debugging
import pytest

def test_example():
    result = some_function()
    print(f"DEBUG: result = {result}")  # Use -s flag to see output
    assert result
```

## 📝 Adding New Tests

### Test Template

```python
class TestNewFeature:
    """Tests for new feature."""

    def test_basic_functionality(self, sample_mission_id):
        """Test basic functionality."""
        # Arrange
        mission_id = sample_mission_id
        
        # Act
        result = some_function(mission_id)
        
        # Assert
        assert result is not None

    @pytest.mark.asyncio
    async def test_async_functionality(self, sample_mission_id):
        """Test async functionality."""
        result = await some_async_function(sample_mission_id)
        assert result.success
```

### Test Naming Convention

- Test classes: `Test<Feature>` (e.g., `TestCriticAgent`)
- Test methods: `test_<what>_<condition>` (e.g., `test_exit_code_18_handling`)
- Use descriptive docstrings explaining the bug/behavior being tested

## 🔗 CI/CD Integration

### GitHub Actions Example

```yaml
name: Test Swarm Pipeline

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    
    services:
      redis:
        image: redis:7
        ports:
          - 6379:6379
    
    steps:
      - uses: actions/checkout@v3
      
      - name: Set up Python
        uses: actions/setup-python@v4
        with:
          python-version: '3.11'
      
      - name: Install dependencies
        run: |
          pip install -r requirements.txt
          pip install pytest pytest-asyncio
      
      - name: Run unit tests
        run: pytest tests/test_swarm_pipeline.py -m unit -v
      
      - name: Run critical tests
        run: pytest tests/test_swarm_pipeline.py -m critical -v
```

## 📚 Related Documentation

- [Main Project README](../README.md)
- [API Documentation](../api/main.py)
- [Agent Documentation](../agents/)

## 🤝 Contributing

When adding new tests:

1. Follow the existing test structure
2. Use appropriate markers (`critical`, `high`, `regression`, etc.)
3. Add descriptive docstrings explaining what bug/feature is being tested
4. Use fixtures from `conftest.py` for consistency
5. Run the full test suite before submitting

## 📝 License

See main project LICENSE file.
