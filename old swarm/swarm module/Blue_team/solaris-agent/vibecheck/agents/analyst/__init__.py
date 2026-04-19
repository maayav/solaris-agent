"""
Analyst Agent (Blue Team) for Project VibeCheck.

The Analyst Agent performs security analysis:
1. Parse code with Tree-Sitter
2. Build knowledge graph in FalkorDB
3. Run N+1 detection queries
4. Verify vulnerabilities with LLM
5. Generate reports

Implemented in Week 2-3.
"""

__all__ = []