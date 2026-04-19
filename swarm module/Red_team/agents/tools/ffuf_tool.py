"""
ffuf Tool — Fast web fuzzer for directory and endpoint discovery

Delta Fuzzer Agent capabilities:
- Directory brute forcing
- API endpoint discovery
- Virtual host enumeration
- Parameter fuzzing
"""

from __future__ import annotations

import base64
import json
import logging
from typing import Any

from agents.tools.registry import ToolSpec
from sandbox.sandbox_manager import shared_sandbox_manager, ExecResult

logger = logging.getLogger(__name__)

CONTAINER_RESULTS_PATH = "/tmp/ffuf-results.json"

# Common API endpoint wordlist
API_ENDPOINTS = [
    "api", "api/v1", "api/v2", "api/v3",
    "admin", "administration", "manage", "management",
    "users", "user", "accounts", "account",
    "auth", "login", "logout", "register", "signup",
    "products", "items", "orders", "cart", "basket",
    "search", "filter", "query",
    "upload", "files", "file", "download",
    "config", "configuration", "settings",
    "health", "status", "ping", "ready",
    "docs", "documentation", "swagger", "openapi",
    "graphql", "graphiql",
    "webhook", "webhooks",
    "internal", "private", "debug", "test",
    "backup", "backups", "dump", "dumps",
    "wp-admin", "wp-login", "wp-content",
    "actuator", "env", "beans", "metrics", "trace",
    "api/admin", "api/users", "api/orders",
    "rest", "rest/v1", "rest/v2",
    "services", "service",
    "oauth", "oauth2", "token", "tokens",
    "session", "sessions",
    "password", "reset", "forgot",
    "notification", "notifications", "email", "sms",
    "payment", "payments", "billing", "invoice",
    "report", "reports", "analytics", "stats",
    "media", "static", "assets", "public",
    "robots.txt", "sitemap.xml", ".well-known",
]

# Common parameter names for fuzzing
PARAMETERS = [
    "id", "user", "user_id", "username", "email",
    "page", "limit", "offset", "sort", "order",
    "search", "q", "query", "filter", "category",
    "token", "api_key", "key", "secret",
    "redirect", "url", "link", "next", "return",
    "callback", "cb",
    "file", "filename", "path", "dir", "folder",
    "action", "cmd", "command", "exec",
    "data", "json", "xml", "payload",
    "role", "permission", "admin", "root",
    "debug", "test", "dev", "development",
    "version", "v", "api_version",
]


async def ffuf_scan(
    mission_id: str,
    target: str,
    mode: str = "directories",
    wordlist: str = "",
    extensions: str = "",
    threads: int = 10,
    timeout: int = 10,
) -> ExecResult:
    """
    Run ffuf fuzzer against a target.
    
    Args:
        mission_id: Active mission ID
        target: Target URL with FUZZ placeholder (e.g., http://target/FUZZ)
        mode: Type of fuzzing (directories, endpoints, vhosts, params)
        wordlist: Custom wordlist (uses built-in if empty)
        extensions: File extensions to test (e.g., "php,txt,json")
        threads: Number of concurrent threads
        timeout: Request timeout in seconds
    """
    # Replace localhost for Docker
    docker_target = target.replace("localhost", "host.docker.internal").replace("127.0.0.1", "host.docker.internal")
    
    # Ensure FUZZ placeholder exists
    if "FUZZ" not in docker_target:
        docker_target = docker_target.rstrip("/") + "/FUZZ"
    
    # Build wordlist
    if wordlist:
        wordlist_path = f"/tmp/ffuf-wordlist-{mission_id[:8]}.txt"
        wordlist_content = wordlist.replace(",", "\n")
    else:
        wordlist_path = f"/tmp/ffuf-wordlist-{mission_id[:8]}.txt"
        if mode == "directories" or mode == "endpoints":
            wordlist_content = "\n".join(API_ENDPOINTS)
        elif mode == "params":
            wordlist_content = "\n".join(PARAMETERS)
        else:
            wordlist_content = "\n".join(API_ENDPOINTS)
    
    # Create wordlist file in container
    await shared_sandbox_manager.exec_in_sandbox(
        f"echo '{wordlist_content}' > {wordlist_path}",
        timeout=5,
    )
    
    parts = [
        "ffuf",
        f"-u {docker_target}",
        f"-w {wordlist_path}",
        f"-t {threads}",
        "-timeout", str(timeout),
        "-o", CONTAINER_RESULTS_PATH,
        "-of json",
        "-fc 404",  # Filter out 404 responses
        "-recursion",  # Enable recursion
        "-recursion-depth 2",
    ]
    
    if extensions:
        parts.append(f"-e .{extensions.replace(',', ',.')}")
    
    cmd = " ".join(parts)
    logger.info(f"Running ffuf: {cmd[:100]}...")
    
    result = await shared_sandbox_manager.exec_in_sandbox(cmd, timeout=120)
    
    if result.exit_code != 0 and result.exit_code != 1:  # ffuf returns 1 on completion
        logger.warning(f"ffuf scan may have issues: {result.stderr}")
    
    # Read results
    read_result = await shared_sandbox_manager.exec_in_sandbox(
        f"python3 -c 'import base64; f=open(\"{CONTAINER_RESULTS_PATH}\",\"rb\"); print(base64.b64encode(f.read()).decode())' 2>/dev/null || echo 'e30='",
        timeout=10,
    )
    
    try:
        if read_result.exit_code == 0 and read_result.stdout:
            json_data = base64.b64decode(read_result.stdout.strip()).decode("utf-8", errors="ignore")
            findings = json.loads(json_data)
            
            # Simplify results for agent consumption
            simplified = {
                "total_found": len(findings.get("results", [])),
                "endpoints": [],
            }
            
            for r in findings.get("results", []):
                simplified["endpoints"].append({
                    "url": r.get("url"),
                    "status": r.get("status"),
                    "size": r.get("length"),
                    "words": r.get("words"),
                })
            
            return ExecResult(
                exit_code=0,
                stdout=json.dumps(simplified, indent=2),
                stderr=result.stderr,
                command="ffuf",
            )
    except Exception as e:
        logger.error(f"Failed to parse ffuf results: {e}")
    
    return result


# Tool specification
ffuf_tool = ToolSpec(
    name="ffuf",
    description="Fast web fuzzer for directory and API endpoint discovery",
    args_schema={
        "target": "Target URL with FUZZ placeholder",
        "mode": "Fuzzing mode: directories, endpoints, vhosts, params",
        "wordlist": "Custom wordlist (optional, uses built-in if empty)",
        "extensions": "File extensions to test (e.g., 'php,txt,json')",
        "threads": "Number of threads (default: 10)",
        "timeout": "Request timeout in seconds (default: 10)",
    },
    execute=ffuf_scan,
)


async def ffuf_quick_scan(
    mission_id: str,
    target: str,
) -> ExecResult:
    """Quick scan for common API endpoints and directories."""
    # Remove FUZZ if present and add it back
    base_target = target.replace("/FUZZ", "").replace("FUZZ", "")
    base_target = base_target.rstrip("/")
    
    return await ffuf_scan(
        mission_id=mission_id,
        target=f"{base_target}/FUZZ",
        mode="directories",
        threads=20,
        timeout=5,
    )


ffuf_quick_tool = ToolSpec(
    name="ffuf_quick",
    description="Quick directory and endpoint scan with default settings",
    args_schema={
        "target": "Target URL (e.g., http://target.com)",
    },
    execute=ffuf_quick_scan,
)
