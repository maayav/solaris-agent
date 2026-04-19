"""
VibeCheck branded logging utility.

Provides the signature Bold Yellow VibeCheck mark for all defensive status updates.
"""

import logging
import sys
from datetime import datetime

# ANSI escape codes
BOLD_YELLOW = "\033[1;33m"
RESET = "\033[0m"
BOLD_CYAN = "\033[1;36m"
CHECK_MARK = "✅"


class VibeFormatter(logging.Formatter):
    """Custom formatter with VibeCheck branding."""
    
    def format(self, record):
        # Create timestamp
        timestamp = datetime.fromtimestamp(record.created).strftime("%H:%M:%S")
        
        # Format: [14:15:22] ✅ [VibeCheck] Message
        formatted = f"[{timestamp}] {BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] {record.getMessage()}"
        return formatted


def get_vibe_logger(name: str = "vibecheck") -> logging.Logger:
    """Get a logger with VibeCheck branding."""
    logger = logging.getLogger(name)
    
    # Only add handler if not already configured
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(VibeFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)
    
    return logger


# Global VibeCheck logger instance
vibe_logger = get_vibe_logger()


def log_defense_alert(vulnerability_type: str, description: str, severity: str = "medium"):
    """Log a defensive alert with VibeCheck branding."""
    severity_colors = {
        "critical": "\033[1;31m",  # Bold Red
        "high": "\033[1;35m",      # Bold Magenta
        "medium": "\033[1;33m",    # Bold Yellow
        "low": "\033[1;32m",       # Bold Green
    }
    sev_color = severity_colors.get(severity.lower(), BOLD_YELLOW)
    
    timestamp = datetime.now().strftime("%H:%M:%S")
    alert_msg = f"[{timestamp}] {BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] Defense Alert: {sev_color}[{severity.upper()}]{RESET} {vulnerability_type} - {description}"
    print(alert_msg, flush=True)


def log_monitoring_status(status: str, details: str = ""):
    """Log monitoring status with VibeCheck branding."""
    timestamp = datetime.now().strftime("%H:%M:%S")
    if details:
        msg = f"[{timestamp}] {BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] {status}: {details}"
    else:
        msg = f"[{timestamp}] {BOLD_YELLOW}{CHECK_MARK}{RESET} [{BOLD_CYAN}VibeCheck{RESET}] {status}"
    print(msg, flush=True)
