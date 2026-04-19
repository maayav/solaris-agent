"""
file_index_builder.py — Builds the in-memory file index from Tree-Sitter output.

Your existing scan_worker already parses the repo with Tree-Sitter and builds
a FalkorDB graph. This module extends that to also maintain a simple
{rel_path: content} dict that MultiFileContextBuilder, SemanticLiftingAgent,
and BehavioralFlowAnalyzer all share — zero redundant disk reads.

USAGE in scan_worker.py:
    from worker.file_index_builder import build_file_index
    file_index = build_file_index(repo_dir)
    # Pass file_index to all three new modules
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# File extensions we care about for security analysis
SUPPORTED_EXTENSIONS = {".ts", ".js", ".tsx", ".jsx", ".mjs", ".cjs"}

# Max file size to index — skip minified bundles
MAX_FILE_SIZE_BYTES = 500_000  # 500KB

# Directories to skip
SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", ".next",
    "coverage", "__pycache__", ".cache", "vendor",
}


def build_file_index(repo_dir: str) -> dict[str, str]:
    """
    Walk repo_dir and build a dict of { relative_path: file_content }
    for all TypeScript/JavaScript source files.

    Args:
        repo_dir: Absolute path to the cloned repository root.

    Returns:
        Dictionary mapping relative file paths to their string content.
        Keys use forward slashes for cross-platform consistency.
    """
    root = Path(repo_dir)
    index: dict[str, str] = {}
    skipped_large = 0
    skipped_binary = 0

    for fpath in root.rglob("*"):
        # Skip directories themselves
        if not fpath.is_file():
            continue

        # Skip unwanted directory trees
        if any(part in SKIP_DIRS for part in fpath.parts):
            continue

        # Skip unsupported extensions
        if fpath.suffix.lower() not in SUPPORTED_EXTENSIONS:
            continue

        # Skip overly large files (minified bundles, generated code)
        try:
            size = fpath.stat().st_size
        except OSError:
            continue

        if size > MAX_FILE_SIZE_BYTES:
            skipped_large += 1
            continue

        # Read file
        try:
            content = fpath.read_text(encoding="utf-8", errors="replace")
        except Exception:
            skipped_binary += 1
            continue

        # Skip minified files heuristically (very long single lines)
        lines = content.splitlines()
        if lines and max(len(l) for l in lines[:10] if l) > 5000:
            skipped_large += 1
            continue

        rel = str(fpath.relative_to(root)).replace("\\", "/")
        index[rel] = content

    logger.info(
        f"[FileIndex] Indexed {len(index)} files "
        f"(skipped: {skipped_large} large, {skipped_binary} binary)"
    )
    return index


def get_file_content(index: dict[str, str], rel_path: str, repo_dir: str) -> str:
    """
    Get file content from index with fallback to disk read.
    Normalizes path separators.
    """
    normalized = rel_path.replace("\\", "/")
    if normalized in index:
        return index[normalized]

    # Fallback: disk read and cache
    try:
        full = Path(repo_dir) / normalized
        if full.exists():
            content = full.read_text(encoding="utf-8", errors="replace")
            index[normalized] = content
            return content
    except Exception:
        pass

    return ""