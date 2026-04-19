"""
Worker module for Project VibeCheck.

Long-running processes that:
- Process scan jobs from Redis Streams
- Clone repositories
- Parse code with Tree-Sitter
- Build knowledge graphs
- Run security analysis
"""

__all__ = []