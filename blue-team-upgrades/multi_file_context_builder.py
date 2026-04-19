"""
multi_file_context_builder.py — Blue Team Pipeline Stage 2.5

Builds cross-file semantic context for a given candidate so the LLM verifier
and behavioral flow analyzer can see the full call chain, not just the
isolated snippet Semgrep matched.

Key outputs for each candidate:
  - caller_chain: list of files/functions that call the flagged function
  - callee_chain: list of files/functions called from the flagged function
  - import_context: files imported by the flagged file that may sanitize/transform data
  - middleware_chain: express/hono middleware applied before the handler
  - full_function_src: the complete source of the function containing the finding
  - related_files_src: truncated source of directly related files (importers, imports)
"""

from __future__ import annotations

import ast
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Max characters per related file we pass to the LLM — keeps context bounded
RELATED_FILE_MAX_CHARS = 3000
# Max characters for the primary function full source
FULL_FUNCTION_MAX_CHARS = 6000
# How many related files to include before we truncate
MAX_RELATED_FILES = 6


@dataclass
class FileContext:
    """All cross-file context for a single vulnerability candidate."""
    candidate_file: str
    candidate_line: int
    full_function_src: str = ""          # complete source of the flagged function
    caller_files: list[str] = field(default_factory=list)   # files that import/call this file
    callee_files: list[str] = field(default_factory=list)   # files imported by this file
    middleware_chain: list[str] = field(default_factory=list)  # middleware registered before handler
    related_sources: dict[str, str] = field(default_factory=dict)  # path → truncated src
    import_aliases: dict[str, str] = field(default_factory=dict)   # local alias → real path
    summary: str = ""                    # human-readable context summary for the LLM prompt


class MultiFileContextBuilder:
    """
    Builds rich cross-file context from a Tree-Sitter parsed file graph.

    Args:
        repo_dir: Absolute path to the cloned repository root.
        falkor_graph: Optional FalkorDB graph client (the existing graph from scan_worker).
                      If None, we fall back to pure filesystem analysis.
        file_index: Pre-built dict mapping relative file paths to their full content
                    (populated by scan_worker after Tree-Sitter parsing). If None we
                    read files lazily from disk.
    """

    def __init__(
        self,
        repo_dir: str,
        falkor_graph=None,
        file_index: Optional[dict[str, str]] = None,
    ):
        self.repo_dir = Path(repo_dir)
        self.graph = falkor_graph
        self._file_index: dict[str, str] = file_index or {}
        self._reverse_import_map: dict[str, list[str]] = {}  # path → [files that import it]
        self._forward_import_map: dict[str, list[str]] = {}  # path → [files it imports]
        self._router_middleware_map: dict[str, list[str]] = {}  # route file → middleware list
        self._index_built = False

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def build_index(self) -> None:
        """
        Walk the repo and build forward/reverse import maps.
        Call this once per scan before calling get_context() per candidate.
        Runs in ~0.5–2s for repos up to 10k files.
        """
        logger.info("[ContextBuilder] Building cross-file import index...")
        ts_js_files = list(self.repo_dir.rglob("*.ts")) + list(self.repo_dir.rglob("*.js"))
        ts_js_files = [f for f in ts_js_files if not _is_node_modules(f)]

        for fpath in ts_js_files:
            rel = str(fpath.relative_to(self.repo_dir))
            try:
                src = self._read_file(rel)
            except Exception:
                continue
            imports = _extract_imports(src, fpath, self.repo_dir)
            self._forward_import_map[rel] = imports
            for imp in imports:
                self._reverse_import_map.setdefault(imp, []).append(rel)

        self._router_middleware_map = _extract_middleware_chains(
            ts_js_files, self.repo_dir, self._file_index
        )
        self._index_built = True
        logger.info(
            f"[ContextBuilder] Index built: {len(self._forward_import_map)} files, "
            f"{sum(len(v) for v in self._reverse_import_map.values())} import edges"
        )

    def get_context(self, candidate: dict) -> FileContext:
        """
        Given a candidate dict (from Semgrep or semantic lifting), return a
        FileContext with all cross-file context populated.
        """
        if not self._index_built:
            self.build_index()

        file_path = candidate.get("file_path", "")
        line_start = int(candidate.get("line_start", 0))

        ctx = FileContext(candidate_file=file_path, candidate_line=line_start)

        # 1. Extract the full function body containing the finding
        ctx.full_function_src = self._extract_full_function(file_path, line_start)

        # 2. Direct callers (files that import this file)
        ctx.caller_files = self._reverse_import_map.get(file_path, [])[:MAX_RELATED_FILES]

        # 3. Direct callees (files this file imports)
        ctx.callee_files = self._forward_import_map.get(file_path, [])[:MAX_RELATED_FILES]

        # 4. Middleware chain for the route
        ctx.middleware_chain = self._router_middleware_map.get(file_path, [])

        # 5. Collect source snippets for related files
        related_paths = list(dict.fromkeys(ctx.caller_files + ctx.callee_files))[:MAX_RELATED_FILES]
        for rel_path in related_paths:
            try:
                src = self._read_file(rel_path)
                ctx.related_sources[rel_path] = src[:RELATED_FILE_MAX_CHARS]
                if len(src) > RELATED_FILE_MAX_CHARS:
                    ctx.related_sources[rel_path] += "\n... [truncated]"
            except Exception:
                pass

        # 6. Build the summary string used in LLM prompts
        ctx.summary = self._build_summary(ctx, candidate)
        return ctx

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _read_file(self, rel_path: str) -> str:
        if rel_path in self._file_index:
            return self._file_index[rel_path]
        full = self.repo_dir / rel_path
        if full.exists():
            content = full.read_text(errors="replace")
            self._file_index[rel_path] = content
            return content
        return ""

    def _extract_full_function(self, rel_path: str, line_start: int) -> str:
        """
        Heuristically extract the full function/method containing line_start.
        Works for JS/TS arrow functions, function declarations, and async methods.
        Returns up to FULL_FUNCTION_MAX_CHARS characters.
        """
        src = self._read_file(rel_path)
        if not src:
            return ""

        lines = src.splitlines()
        if line_start < 1 or line_start > len(lines):
            return src[:FULL_FUNCTION_MAX_CHARS]

        # Walk backwards from the flagged line to find the function start
        fn_start = _find_function_start(lines, line_start - 1)
        fn_end = _find_function_end(lines, fn_start)

        extracted = "\n".join(lines[fn_start:fn_end])
        if len(extracted) > FULL_FUNCTION_MAX_CHARS:
            extracted = extracted[:FULL_FUNCTION_MAX_CHARS] + "\n... [function truncated]"
        return extracted

    def _build_summary(self, ctx: FileContext, candidate: dict) -> str:
        parts = []

        if ctx.caller_files:
            parts.append(f"CALLERS (files that use {ctx.candidate_file}):\n  " + "\n  ".join(ctx.caller_files))

        if ctx.callee_files:
            parts.append(f"IMPORTS (files imported by {ctx.candidate_file}):\n  " + "\n  ".join(ctx.callee_files))

        if ctx.middleware_chain:
            parts.append("MIDDLEWARE CHAIN (applied before this handler):\n  " + "\n  ".join(ctx.middleware_chain))

        if ctx.full_function_src:
            parts.append(f"FULL FUNCTION SOURCE (containing line {ctx.candidate_line}):\n```\n{ctx.full_function_src}\n```")

        if ctx.related_sources:
            for rpath, rsrc in ctx.related_sources.items():
                parts.append(f"RELATED FILE [{rpath}]:\n```\n{rsrc}\n```")

        return "\n\n".join(parts)


# ------------------------------------------------------------------
# Module-level pure helpers
# ------------------------------------------------------------------

def _is_node_modules(path: Path) -> bool:
    return "node_modules" in path.parts or ".git" in path.parts


def _extract_imports(src: str, fpath: Path, repo_root: Path) -> list[str]:
    """
    Parse ES module import/require statements and resolve to repo-relative paths.
    Returns a list of relative paths that actually exist in the repo.
    """
    resolved: list[str] = []
    # Match: import ... from '...' | require('...')
    patterns = [
        r"""(?:import\s+.*?\s+from|import)\s+['"]([^'"]+)['"]""",
        r"""require\s*\(\s*['"]([^'"]+)['"]\s*\)""",
    ]
    specifiers: list[str] = []
    for pat in patterns:
        specifiers.extend(re.findall(pat, src))

    for spec in specifiers:
        if not spec.startswith("."):
            continue  # skip node_modules / absolute imports
        try:
            candidate = (fpath.parent / spec).resolve()
            # Try with common TS/JS extensions
            for ext in ["", ".ts", ".js", ".tsx", ".jsx", "/index.ts", "/index.js"]:
                test = Path(str(candidate) + ext)
                if test.exists() and test.is_file():
                    rel = str(test.relative_to(repo_root))
                    resolved.append(rel)
                    break
        except Exception:
            pass
    return list(dict.fromkeys(resolved))  # dedup, preserve order


def _extract_middleware_chains(
    ts_js_files: list[Path],
    repo_root: Path,
    file_index: dict[str, str],
) -> dict[str, list[str]]:
    """
    Scan all router files for app.use() / router.use() calls to build a map of
    which middleware applies before which route handler files.
    
    Returns: { route_rel_path: [middleware_description, ...] }
    """
    result: dict[str, list[str]] = {}

    for fpath in ts_js_files:
        rel = str(fpath.relative_to(repo_root))
        try:
            src = file_index.get(rel) or fpath.read_text(errors="replace")
        except Exception:
            continue

        # Find app.use() / router.use() middleware registrations
        middleware_uses = re.findall(
            r"""(?:app|router)\.use\s*\(\s*([^)]{1,200})\)""", src
        )
        if not middleware_uses:
            continue

        # Find route handler imports in the same file to associate middleware
        imported_routes = re.findall(
            r"""(?:import|require)\s*.*?['"](\.\/routes\/[^'"]+|\.\/[^'"]*[Rr]outer[^'"]*|\.\/[^'"]*[Hh]andler[^'"]*)['"]\s*""",
            src,
        )
        for route_spec in imported_routes:
            for ext in ["", ".ts", ".js"]:
                test = (fpath.parent / route_spec).resolve()
                test_with_ext = Path(str(test) + ext)
                if test_with_ext.exists():
                    route_rel = str(test_with_ext.relative_to(repo_root))
                    result.setdefault(route_rel, [])
                    for mw in middleware_uses:
                        mw_clean = mw.strip().replace("\n", " ")[:120]
                        if mw_clean not in result[route_rel]:
                            result[route_rel].append(mw_clean)
                    break

    return result


def _find_function_start(lines: list[str], target_idx: int) -> int:
    """
    Walk backwards from target_idx to find the line that starts the enclosing
    function/arrow function/method declaration.
    """
    fn_patterns = [
        r"^\s*(async\s+)?function\b",
        r"^\s*(export\s+)?(async\s+)?function\b",
        r"(?:const|let|var)\s+\w+\s*=\s*(async\s*)?\(",
        r"(?:const|let|var)\s+\w+\s*=\s*(async\s*)?\w+\s*=>",
        r"^\s*(async\s+)?\w+\s*\([^)]*\)\s*\{",   # method shorthand
        r"^\s*router\.\w+\s*\(",                   # router.get/post/etc
        r"^\s*app\.\w+\s*\(",                      # app.get/post/etc
    ]
    for i in range(target_idx, max(-1, target_idx - 80), -1):
        line = lines[i]
        for pat in fn_patterns:
            if re.search(pat, line):
                return i
    return max(0, target_idx - 30)


def _find_function_end(lines: list[str], fn_start: int) -> int:
    """
    Walk forward from fn_start tracking brace depth to find the closing brace.
    Returns the line index AFTER the closing brace (exclusive).
    """
    depth = 0
    started = False
    for i in range(fn_start, min(len(lines), fn_start + 300)):
        for ch in lines[i]:
            if ch == "{":
                depth += 1
                started = True
            elif ch == "}" and started:
                depth -= 1
                if depth == 0:
                    return i + 1
    return min(len(lines), fn_start + 100)