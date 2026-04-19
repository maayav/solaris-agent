"""
Cross-platform compatibility utilities for Windows/Linux/macOS.

Handles:
- ANSI color code initialization for Windows
- Unicode encoding fixes
- Terminal capability detection
"""

from __future__ import annotations

import sys
import os

# Platform detection
IS_WINDOWS = sys.platform == "win32"
IS_MAC = sys.platform == "darwin"
IS_LINUX = sys.platform.startswith("linux")

# Try to enable ANSI colors on Windows
def _enable_windows_colors():
    """Enable ANSI escape codes on Windows 10+"""
    if IS_WINDOWS:
        try:
            import ctypes
            kernel32 = ctypes.windll.kernel32
            kernel32.SetConsoleMode(kernel32.GetStdHandle(-11), 7)
        except Exception:
            pass

_enable_windows_colors()

# ANSI Color codes - these work on modern Windows terminals
colors = {
    "commander": "\033[1;35m",   # Bold Magenta
    "agent_alpha": "\033[1;36m", # Bold Cyan
    "agent_gamma": "\033[1;31m", # Bold Red
    "agent_critic": "\033[1;32m", # Bold Green
    "system": "\033[1;33m",      # Bold Yellow
    "reset": "\033[0m",
    "green": "\033[1;32m",
    "red": "\033[1;31m",
    "yellow": "\033[1;33m",
}

# Unicode symbols - use ASCII fallbacks on Windows if needed
symbols = {
    "check": "✅" if not IS_WINDOWS else "[OK]",
    "cross": "❌" if not IS_WINDOWS else "[FAIL]",
    "warn": "⚠️" if not IS_WINDOWS else "[WARN]",
    "info": "ℹ️" if not IS_WINDOWS else "[INFO]",
    "rocket": "🚀" if not IS_WINDOWS else ">>>",
    "shield": "🛡️" if not IS_WINDOWS else "[*]",
    "bug": "🐛" if not IS_WINDOWS else "[BUG]",
    "stop": "⛔" if not IS_WINDOWS else "[STOP]",
    "gear": "⚙️" if not IS_WINDOWS else "[*]",
    "target": "🎯" if not IS_WINDOWS else "[TARGET]",
    "fire": "🔥" if not IS_WINDOWS else "[*]",
    "hourglass": "⏳" if not IS_WINDOWS else "[...]",
    "magnifier": "🔍" if not IS_WINDOWS else "[SEARCH]",
}

def get_banner() -> str:
    """Get ASCII banner that works on all platforms."""
    return f"""{colors['system']}
    ____            __       _____                ____
   / __ \\___  _____/ /__    /__  /  ___  ___     / __ )____  ____
  / /_/ / _ \\/ ___/ //_/      / /  / _ \/ _ \\   / __  / __ \/ __ \\
 / _, _/  __/ /__/ ,<       / /__/  __/  __/  / /_/ / /_/ / /_/ /
/_/ |_|\\___/\\___/_/|_|     /____/\\___/\\___/  /_____/\\____/ .___/
                                                        /_/
    ================================================================
               RED TEAM AGENT SWARM - Mission Control
    ================================================================
{colors['reset']}"""

def print_banner():
    """Print the ASCII banner."""
    print(get_banner())

def get_status_icon(status: str) -> str:
    """Get platform-appropriate status icon."""
    status = status.lower()
    if status in ("ok", "pass", "success", "true"):
        return symbols["check"]
    elif status in ("fail", "error", "false"):
        return symbols["cross"]
    elif status in ("warn", "warning"):
        return symbols["warn"]
    return ""

def safe_print(text: str, color: str = "", end: str = "\n"):
    """Print text safely handling encoding issues on Windows."""
    try:
        if color and color in colors:
            text = f"{colors[color]}{text}{colors['reset']}"
        print(text, end=end)
    except UnicodeEncodeError:
        # Fallback to ASCII
        text = text.encode('ascii', 'ignore').decode('ascii')
        print(text, end=end)

def format_box(title: str, content: str, width: int = 60) -> str:
    """Format text in a box (ASCII only for Windows compatibility)."""
    lines = content.split('\n')
    result = []
    result.append(f"+{'-' * (width - 2)}+")
    result.append(f"| {title:<{width-4}} |")
    result.append(f"+{'-' * (width - 2)}+")
    for line in lines:
        # Truncate long lines
        if len(line) > width - 4:
            line = line[:width-7] + "..."
        result.append(f"| {line:<{width-4}} |")
    result.append(f"+{'-' * (width - 2)}+")
    return '\n'.join(result)

# Export commonly used values
COLORS = colors
SYMBOLS = symbols
