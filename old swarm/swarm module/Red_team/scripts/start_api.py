#!/usr/bin/env python
"""
Start the FastAPI backend server.

Usage:
    python scripts/start_api.py
"""

import os
import sys

# Add project root to path
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, project_root)

import uvicorn

if __name__ == "__main__":
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True,
        log_level="warning",
        reload_dirs=[project_root],
        access_log=False,  # Disable access logs to reduce noise from port scans
    )