"""
Scan worker for Project VibeCheck.

This is the main worker process that:
1. Subscribes to Redis Stream for scan jobs
2. Clones repositories using GitPython
3. Parses code with Tree-Sitter (Week 2)
4. Builds knowledge graphs in FalkorDB (Week 2)
5. Runs N+1 detection (Week 2)
6. Reports results to Supabase (Week 2)

Week 3 Additions:
- Semgrep static analysis (Stage 5a)
- Semantic lifting with Ollama (Stage 5b)
- LLM verification two-tier (Stage 5c)
- Pattern propagation via Qdrant (Stage 5d)
"""

import asyncio
import copy
import json
import logging
import os
import re
import shutil
import signal
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

import git
from git import Repo, GitCommandError

from core.config import get_settings
from core.parser import CodeParser
from core.falkordb import get_falkordb_client
from core.supabase_client import get_supabase_client
from core.qdrant import QdrantClient
from core.redis_bus import (
    GROUP_SCAN_WORKERS,
    STREAM_SCAN_QUEUE,
    get_redis_bus,
)
from worker.semgrep_runner import run_semgrep, semgrep_to_parsed_nodes
from worker.semantic_lifter import lift_directory
from worker.llm_verifier import verify_candidate, propagate_pattern, embed_with_ollama

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger(__name__)
logger.info("=== SCAN WORKER MODULE LOADING ===")

settings = get_settings()
logger.info(f"Settings loaded - Redis URL: {settings.redis_url}")


class ScanWorker:
    """
    Worker that processes scan jobs from Redis Stream.
    """

    def __init__(self, worker_id: str | None = None) -> None:
        self.worker_id = worker_id or f"worker-{uuid4().hex[:8]}"
        self.running = False
        self.redis_bus = get_redis_bus()
        self.clone_base_dir = Path(settings.repo_clone_dir)
        self.clone_base_dir.mkdir(parents=True, exist_ok=True)
        self.qdrant_client = QdrantClient()
        self.parser = CodeParser()
        logger.info(f"Scan worker initialized: {self.worker_id}")

    async def start(self) -> None:
        """Start the worker and begin processing scan jobs."""
        logger.info(f"Starting scan worker: {self.worker_id}")
        self.running = True

        await self.redis_bus.connect()
        logger.info("Connected to Redis successfully")

        loop = asyncio.get_event_loop()
        try:
            await loop.run_in_executor(None, self.qdrant_client.connect)
            await self.qdrant_client.seed_known_patterns(embed_with_ollama)
            logger.info("Qdrant initialized and patterns seeded")
        except Exception as e:
            logger.error(f"Failed to initialize Qdrant: {e}", exc_info=True)
            # Continue — Qdrant is optional for basic scanning

        try:
            pending_messages = await self.redis_bus.claim_pending(
                stream_name=STREAM_SCAN_QUEUE,
                group_name=GROUP_SCAN_WORKERS,
                consumer_name=self.worker_id,
                min_idle_time=60000,
                count=10,
            )
            if pending_messages:
                logger.info(f"Claimed {len(pending_messages)} pending messages")
                for msg in pending_messages:
                    await self.process_message(msg)
        except Exception as e:
            logger.error(f"Error claiming pending messages: {e}", exc_info=True)

        try:
            async for message in self.redis_bus.consume(
                stream_name=STREAM_SCAN_QUEUE,
                group_name=GROUP_SCAN_WORKERS,
                consumer_name=self.worker_id,
                block=5000,
                count=1,
            ):
                if not self.running:
                    break
                logger.info(f"Received message: {message.get('id', 'unknown')}")
                await self.process_message(message)
        except asyncio.CancelledError:
            logger.info("Worker cancelled")
        except Exception as e:
            logger.error(f"Worker error: {e}", exc_info=True)
            raise

    async def stop(self) -> None:
        logger.info(f"Stopping scan worker: {self.worker_id}")
        self.running = False
        await self.redis_bus.disconnect()

    async def process_message(self, message: dict[str, Any]) -> None:
        """Process a single scan job message."""
        msg_id = message["id"]
        data = message["data"]

        repo_url = data.get("repo_url")
        triggered_by = data.get("triggered_by", "unknown")
        scan_id = data.get("scan_id")

        if scan_id:
            logger.info(f"Scan ID: {scan_id} (from API/Redis message)")
        else:
            scan_id = str(uuid4())
            logger.warning(f"Scan ID: {scan_id} (GENERATED — not from API, FK may fail)")

        logger.info(f"Processing scan job: {msg_id} | repo={repo_url} | triggered_by={triggered_by}")

        try:
            supabase = get_supabase_client()
            await supabase.update_scan_status(scan_id, "running", 0, current_stage="Starting scan")

            # ── Stage 1: Clone ─────────────────────────────────────────────────
            clone_dir = await self.clone_repository(scan_id, repo_url)
            await supabase.update_scan_status(
                scan_id, "running", 5, current_stage="Clone Repository",
                stage_output={"stage": "clone", "status": "completed", "repo_url": repo_url},
            )

            # ── Stage 2: Tree-Sitter parse ────────────────────────────────────
            logger.info("Parsing code with Tree-Sitter...")
            loop = asyncio.get_event_loop()
            nodes = await loop.run_in_executor(None, lambda: self.parser.parse_directory(clone_dir))
            logger.info(f"Parsed {len(nodes)} nodes")
            await supabase.update_scan_status(
                scan_id, "running", 15, current_stage="Parse Code",
                stage_output={"stage": "parse", "status": "completed", "nodes_parsed": len(nodes)},
            )

            # ── Stage 3: FalkorDB graph ───────────────────────────────────────
            logger.info("Building FalkorDB graph...")
            falkordb = get_falkordb_client()
            graph = await loop.run_in_executor(None, lambda: falkordb.create_scan_graph(scan_id))
            await loop.run_in_executor(None, lambda: falkordb.add_nodes_batch(graph, nodes))
            await loop.run_in_executor(None, lambda: falkordb.create_edges(graph))
            await supabase.update_scan_status(
                scan_id, "running", 25, current_stage="Build Knowledge Graph",
                stage_output={"stage": "knowledge_graph", "status": "completed", "nodes_added": len(nodes)},
            )

            # ── Stage 4: N+1 detection ────────────────────────────────────────
            logger.info("Running N+1 detection...")
            n_plus_ones = await loop.run_in_executor(None, lambda: falkordb.detect_n_plus_1(graph))
            logger.info(f"Found {len(n_plus_ones)} N+1 candidates")
            await supabase.update_scan_status(
                scan_id, "running", 35, current_stage="Run Detectors",
                stage_output={"stage": "detectors", "status": "completed", "n_plus_1_candidates": len(n_plus_ones)},
            )

            # ── Stage 5a: Semgrep ─────────────────────────────────────────────
            logger.info("Running Semgrep static analysis...")
            semgrep_findings = run_semgrep(clone_dir, scan_id)
            semgrep_nodes = semgrep_to_parsed_nodes(semgrep_findings, scan_id)
            logger.info(f"Semgrep: {len(semgrep_findings)} raw → {len(semgrep_nodes)} candidates")
            await supabase.update_scan_status(
                scan_id, "running", 50, current_stage="Semgrep Analysis",
                stage_output={"stage": "semgrep", "status": "completed", "findings": len(semgrep_findings), "nodes_created": len(semgrep_nodes)},
            )

            semgrep_target_files: set[str] = {
                node["file_path"] for node in semgrep_nodes
                if isinstance(node, dict) and node.get("file_path")
            }

            # ── Stage 5b: Semantic lifting ────────────────────────────────────
            if not semgrep_target_files:
                logger.info("No Semgrep findings — skipping semantic lifting")
                semantic_summaries = []
            else:
                logger.info(f"Lifting {len(semgrep_target_files)} files with findings...")
                semantic_clone_dir = self.clone_base_dir / "semantic" / scan_id
                semantic_summaries = await lift_directory(
                    str(clone_dir), nodes, str(semantic_clone_dir),
                    target_files=semgrep_target_files,
                )
            logger.info(f"Generated {len(semantic_summaries)} semantic summaries")
            await supabase.update_scan_status(
                scan_id, "running", 65, current_stage="Semantic Lifting",
                stage_output={"stage": "semantic_lifting", "status": "completed", "summaries_generated": len(semantic_summaries), "files_lifted": len(semgrep_target_files)},
            )

            if semantic_summaries:
                await self._store_function_summaries(semantic_summaries)

            # ── Stage 5c: LLM Verification ───────────────────────────────────
            all_candidates: list[dict] = []

            for candidate in n_plus_ones:
                if not isinstance(candidate, dict):
                    continue
                all_candidates.append({
                    **candidate,
                    "vuln_type": "n_plus_1",
                    "rule_id": "falkordb-n-plus-1-detection",
                    "code_snippet": candidate.get("code_snippet", ""),
                    "file_path": candidate.get("file", ""),
                    "line_start": candidate.get("line_start", 0),
                    "line_end": candidate.get("line_end", 0),
                    "function_name": candidate.get("function_name", ""),
                })

            for node in semgrep_nodes:
                if not isinstance(node, dict):
                    continue
                all_candidates.append({
                    **node,
                    "vuln_type": node.get("vuln_type", "unknown"),
                    "rule_id": node.get("rule_id", "semgrep"),
                    "code_snippet": node.get("code_snippet", ""),
                    "file_path": node.get("file_path", ""),
                    "line_start": node.get("line_start", 0),
                    "line_end": node.get("line_end", 0),
                    "function_name": node.get("function_name", ""),
                })

            logger.info(f"Verifying {len(all_candidates)} candidates ({len(n_plus_ones)} N+1 + {len(semgrep_nodes)} Semgrep)")
            if all_candidates:
                logger.info("SAMPLE CANDIDATES (first 5):")
                for i, c in enumerate(all_candidates[:5]):
                    logger.info(f"  [{i}] {c.get('vuln_type')} | {c.get('file_path')}:{c.get('line_start')} | {c.get('rule_id')}")

            await supabase.update_scan_status(
                scan_id, "running", 70, current_stage="LLM Verification",
                stage_output={"stage": "llm_verification", "status": "in_progress", "total_candidates": len(all_candidates)},
            )

            all_verified_results, confirmed_vulns = await self._run_llm_verification(all_candidates)

            logger.info("=" * 80)
            logger.info("VERIFICATION SUMMARY:")
            logger.info(f"  Total candidates:          {len(all_candidates)}")
            logger.info(f"  Confirmed vulnerabilities: {len(confirmed_vulns)}")
            confirmed_ct = sum(1 for v in all_verified_results if v.get("confirmed"))
            logger.info(f"  Confirmed (cross-check):   {confirmed_ct}")
            for v in all_verified_results:
                status = "✓ CONFIRMED" if v.get("confirmed") else "✗ rejected "
                logger.info(f"    {status} | {v.get('file_path', 'unknown')}:{v.get('line_start', 0)} | {v.get('verification_reason', '')[:80]}")
            logger.info("=" * 80)

            # ── Stage 5d: Save to Supabase ────────────────────────────────────
            if all_verified_results:
                vulns_to_save = [self._build_vuln_record(v) for v in all_verified_results]
                vulns_to_save = [v for v in vulns_to_save if v is not None]
                logger.info(f"Saving {len(vulns_to_save)} vulnerability records to Supabase...")
                try:
                    result = await supabase.insert_vulnerabilities_batch(scan_id, vulns_to_save)
                    logger.info(f"Saved {len(vulns_to_save)} records. Supabase result: {result}")
                except Exception as e:
                    logger.error(f"Failed to insert vulnerabilities: {e}", exc_info=True)

                await supabase.update_scan_status(
                    scan_id, "running", 95, current_stage="Save Results",
                    stage_output={"stage": "save_results", "status": "completed", "vulnerabilities_saved": len(vulns_to_save)},
                )
            else:
                logger.warning("No verified results to save.")

            # ── Stage 6: Report ───────────────────────────────────────────────
            report_path = await self.generate_report(
                repo_path=clone_dir,
                scan_id=scan_id,
                repo_url=repo_url,
                all_verified=all_verified_results,
            )
            logger.info(f"Report saved to: {report_path}")

            await self.redis_bus.ack_message(
                stream_name=STREAM_SCAN_QUEUE,
                group_name=GROUP_SCAN_WORKERS,
                msg_id=msg_id,
            )

            await supabase.update_scan_status(
                scan_id, "completed", 100, current_stage="Completed",
                stage_output={"stage": "complete", "status": "completed", "report_path": str(report_path)},
            )
            logger.info(f"Scan job completed: {scan_id}")

        except Exception as e:
            logger.error(f"Failed to process scan job {scan_id}: {e}", exc_info=True)
            try:
                supabase = get_supabase_client()
                await supabase.update_scan_status(
                    scan_id, "failed", 0, error_message=str(e),
                    current_stage="Failed",
                    stage_output={"stage": "error", "status": "failed", "error": str(e)},
                )
            except Exception:
                pass

    # ── LLM verification ─────────────────────────────────────────────────────

    async def _run_llm_verification(
        self,
        candidates: list[dict],
    ) -> tuple[list[dict], list[dict]]:
        """
        Run LLM verification on all candidates in parallel batches.

        Returns:
            (all_verified_results, confirmed_only) — two separate lists so
            callers can save everything while still knowing what was confirmed.
        """
        BATCH_SIZE = 5
        all_verified: list[dict] = []
        confirmed: list[dict] = []

        for batch_start in range(0, len(candidates), BATCH_SIZE):
            batch = [c for c in candidates[batch_start:batch_start + BATCH_SIZE] if isinstance(c, dict)]
            if not batch:
                continue

            logger.info(f"Verifying batch {batch_start // BATCH_SIZE + 1} ({len(batch)} candidates)...")
            raw_results = await asyncio.gather(
                *[verify_candidate(c) for c in batch],
                return_exceptions=True,
            )

            for idx, result in enumerate(raw_results):
                candidate = batch[idx]

                # Normalise — result may be Exception, None, non-dict, or valid dict
                if isinstance(result, Exception):
                    logger.warning(f"Verification raised exception for {candidate.get('file_path')}:{candidate.get('line_start')}: {result}")
                    verified = self._fallback_verified(candidate, reason=f"LLM error: {result}")
                elif result is None:
                    logger.warning(f"verify_candidate returned None for {candidate.get('file_path')}:{candidate.get('line_start')}")
                    verified = self._fallback_verified(candidate, reason="verify_candidate returned None")
                elif not isinstance(result, dict):
                    logger.warning(f"verify_candidate returned {type(result)} for {candidate.get('file_path')}:{candidate.get('line_start')}")
                    verified = self._fallback_verified(candidate, reason=f"verify_candidate returned {type(result)}")
                else:
                    verified = result

                all_verified.append(verified)

                if verified.get("confirmed"):
                    confirmed.append(verified)
                    logger.info(
                        f"  ✓ CONFIRMED {verified.get('vuln_type')} "
                        f"@ {verified.get('file_path')}:{verified.get('line_start')} "
                        f"[{verified.get('confidence', 'unknown')} confidence]"
                    )
                    # Pattern propagation — fire and forget errors
                    try:
                        similar = await propagate_pattern(verified, self.qdrant_client.client, embed_with_ollama)
                        if similar:
                            logger.info(f"    Pattern propagation: {len(similar)} similar functions found")
                    except Exception as e:
                        logger.warning(f"    Pattern propagation failed: {e}")
                else:
                    logger.info(
                        f"  ✗ rejected  {verified.get('vuln_type')} "
                        f"@ {verified.get('file_path')}:{verified.get('line_start')} "
                        f"— {verified.get('verification_reason', '')[:80]}"
                    )

        return all_verified, confirmed

    @staticmethod
    def _fallback_verified(candidate: dict, reason: str) -> dict:
        """Build a safe fallback verified record when LLM verification fails."""
        return {
            **candidate,
            "confirmed": False,
            "confidence": "low",
            "verification_reason": reason,
            "needs_llm_verification": False,
        }

    # ── Record building ───────────────────────────────────────────────────────

    def _build_vuln_record(self, source: dict) -> dict | None:
        """Convert a verified candidate into a Supabase-ready record."""
        if not isinstance(source, dict):
            return None

        source = copy.deepcopy(source)

        # Severity: prefer LLM-returned value, fall back to type-based mapping
        severity = source.get("severity") or self._map_severity(source.get("vuln_type", "unknown"))

        # Confidence: LLM returns string (high/medium/low), convert to float
        confidence_str = source.get("confidence", "medium")
        if isinstance(confidence_str, (int, float)):
            confidence_score = float(confidence_str)
        else:
            confidence_score = {"high": 0.90, "medium": 0.70}.get(confidence_str.lower(), 0.50)

        # False positive heuristic: safe Sequelize scalar lookups
        false_positive = False
        if source.get("rule_id") == "taint-express-nosqli":
            snippet = source.get("code_snippet", "") or ""
            safe_pattern = r"\{where:\s*\{[^}]+\}\}"
            dangerous_pattern = r"\{where:\s*(req\.(body|params|query)|[^{])"
            if re.search(safe_pattern, snippet) and not re.search(dangerous_pattern, snippet):
                false_positive = True
                logger.info(f"Marking as FP — safe Sequelize scalar lookup: {snippet[:60]}...")

        vuln_type_clean = (source.get("vuln_type") or "unknown").replace(":", "").strip()
        title = f"{vuln_type_clean}: {source.get('function_name') or source.get('rule_id') or 'unknown'}"

        return {
            "type": source.get("vuln_type", "unknown"),
            "severity": severity,
            "category": source.get("rule_id", ""),
            "title": title,
            "description": source.get("verification_reason") or source.get("message") or "Candidate vulnerability",
            "file_path": str(source.get("file_path") or ""),
            "line_start": source.get("line_start", 0),
            "line_end": source.get("line_end", 0),
            "code_snippet": str(source.get("code_snippet") or ""),
            "confirmed": bool(source.get("confirmed", False)),
            "confidence_score": confidence_score,
            "false_positive": false_positive,
            "fix_suggestion": source.get("fix_suggestion") or "",
            "details": json.loads(json.dumps(source, default=str)),
        }

    # ── Report generation ─────────────────────────────────────────────────────

    async def generate_report(
        self,
        repo_path: Path,
        scan_id: str,
        repo_url: str,
        all_verified: list[dict],
        max_depth: int = 3,
    ) -> Path:
        """
        Generate a full markdown scan report including file tree and findings.

        This replaces both the old inline minimal-report and the unused
        print_file_tree method, merging them into one coherent output.
        """
        reports_dir = self.clone_base_dir / "reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        report_path = reports_dir / f"scan_{scan_id}.md"

        ignore_patterns = {".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode"}

        # ── File tree ─────────────────────────────────────────────────────────
        tree_lines: list[str] = []

        def build_tree(path: Path, prefix: str = "", depth: int = 0) -> None:
            if depth > max_depth:
                return
            try:
                entries = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name))
            except PermissionError:
                return

            visible = [e for e in entries if e.name not in ignore_patterns]
            for i, entry in enumerate(visible):
                is_last = (i == len(visible) - 1)
                connector = "└── " if is_last else "├── "
                child_prefix = prefix + ("    " if is_last else "│   ")

                if entry.is_dir():
                    tree_lines.append(f"{prefix}{connector}{entry.name}/")
                    build_tree(entry, child_prefix, depth + 1)
                else:
                    try:
                        size_str = self._format_size(entry.stat().st_size)
                        tree_lines.append(f"{prefix}{connector}{entry.name} ({size_str})")
                    except OSError:
                        tree_lines.append(f"{prefix}{connector}{entry.name}")

        loop = asyncio.get_event_loop()
        await loop.run_in_executor(None, lambda: build_tree(repo_path))

        total_files = sum(
            1 for f in repo_path.rglob("*")
            if f.is_file() and not any(p.name in ignore_patterns for p in f.parents)
        )
        total_dirs = sum(
            1 for d in repo_path.rglob("*")
            if d.is_dir() and not any(p.name in ignore_patterns for p in d.parents)
        )

        # ── Severity breakdown ────────────────────────────────────────────────
        severity_counts: dict[str, int] = {"critical": 0, "high": 0, "medium": 0, "low": 0}
        confirmed_list = [v for v in all_verified if v.get("confirmed")]
        for v in all_verified:
            sev = (v.get("severity") or "medium").lower()
            if sev in severity_counts:
                severity_counts[sev] += 1

        # ── Assemble report ───────────────────────────────────────────────────
        lines: list[str] = [
            f"# VibeCheck Scan Report",
            f"",
            f"| Field | Value |",
            f"|-------|-------|",
            f"| Scan ID | `{scan_id}` |",
            f"| Repository | {repo_url} |",
            f"| Timestamp | {datetime.now(timezone.utc).isoformat()} |",
            f"| Total Candidates | {len(all_verified)} |",
            f"| Confirmed | {len(confirmed_list)} |",
            f"",
            f"---",
            f"",
            f"## Repository Structure",
            f"",
            f"- **Total files:** {total_files}",
            f"- **Total directories:** {total_dirs}",
            f"- **Max depth traversed:** {max_depth}",
            f"",
            f"```",
            f"{repo_path.name}/",
        ] + tree_lines + [
            f"```",
            f"",
            f"---",
            f"",
            f"## Vulnerability Summary",
            f"",
            f"| Severity | Count |",
            f"|----------|-------|",
            f"| 🔴 Critical | {severity_counts['critical']} |",
            f"| 🟠 High | {severity_counts['high']} |",
            f"| 🟡 Medium | {severity_counts['medium']} |",
            f"| 🟢 Low | {severity_counts['low']} |",
            f"| **Total** | **{len(all_verified)}** |",
            f"",
        ]

        if all_verified:
            lines += [
                f"---",
                f"",
                f"## Findings",
                f"",
            ]

            # Sort: confirmed first, then by severity, then by file path
            severity_order = {"critical": 0, "high": 1, "medium": 2, "low": 3}
            sorted_findings = sorted(
                all_verified,
                key=lambda v: (
                    0 if v.get("confirmed") else 1,
                    severity_order.get((v.get("severity") or "medium").lower(), 2),
                    v.get("file_path", ""),
                )
            )

            for i, v in enumerate(sorted_findings, 1):
                status = "✅ Confirmed" if v.get("confirmed") else "⚠️ Unconfirmed"
                sev = (v.get("severity") or "medium").capitalize()
                vuln_type = (v.get("vuln_type") or "unknown").replace("_", " ").title()
                file_path = v.get("file_path", "unknown")
                line_start = v.get("line_start", 0)
                confidence = (v.get("confidence") or "unknown").capitalize()
                reason = v.get("verification_reason") or v.get("message") or "No description"
                fix = v.get("fix_suggestion") or ""
                snippet = v.get("code_snippet") or ""
                fp_note = " *(false positive)*" if v.get("false_positive") else ""

                lines += [
                    f"### {i}. {vuln_type}{fp_note}",
                    f"",
                    f"| | |",
                    f"|---|---|",
                    f"| Status | {status} |",
                    f"| Severity | {sev} |",
                    f"| Confidence | {confidence} |",
                    f"| File | `{file_path}` |",
                    f"| Line | {line_start} |",
                    f"| Rule | `{v.get('rule_id', '')}` |",
                    f"",
                    f"**Description:** {reason}",
                    f"",
                ]

                if snippet:
                    lang = "typescript" if file_path.endswith((".ts", ".tsx")) else \
                           "javascript" if file_path.endswith((".js", ".jsx")) else \
                           "php" if file_path.endswith(".php") else "python" if file_path.endswith(".py") else ""
                    lines += [
                        f"```{lang}",
                        snippet.strip(),
                        f"```",
                        f"",
                    ]

                if fix:
                    lines += [
                        f"**Fix:** {fix}",
                        f"",
                    ]

        lines += [
            f"---",
            f"",
            f"*Generated by VibeCheck · {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}*",
        ]

        report_content = "\n".join(lines)
        await loop.run_in_executor(None, lambda: report_path.write_text(report_content, encoding="utf-8"))

        logger.info(f"Report written: {report_path} ({len(lines)} lines, {len(all_verified)} findings)")
        return report_path

    # ── Repository cloning ────────────────────────────────────────────────────

    async def clone_repository(self, scan_id: str, repo_url: str) -> Path:
        clone_dir = self.clone_base_dir / scan_id
        logger.info(f"Cloning {repo_url} → {clone_dir}")

        if clone_dir.exists():
            shutil.rmtree(clone_dir)

        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, lambda: Repo.clone_from(repo_url, clone_dir, depth=1))
            logger.info(f"Repository cloned successfully: {clone_dir}")
            return clone_dir
        except GitCommandError as e:
            raise RuntimeError(f"Failed to clone repository: {e}")

    # ── Qdrant storage ────────────────────────────────────────────────────────

    async def _store_function_summaries(self, summaries: list[dict[str, Any] | str]) -> None:
        if not summaries or isinstance(summaries[0], str):
            logger.info("Semantic summaries are file paths — skipping Qdrant storage")
            return

        from qdrant_client.http import models
        stored = 0
        for summary in summaries:
            if not isinstance(summary, dict):
                continue
            summary_text = summary.get("summary", "")
            if not summary_text:
                continue
            try:
                vector = await embed_with_ollama(summary_text)
                self.qdrant_client.client.upsert(
                    collection_name="function_summaries",
                    points=[models.PointStruct(
                        id=summary.get("id", str(uuid4())),
                        vector=vector,
                        payload={
                            "file": summary.get("file"),
                            "name": summary.get("name"),
                            "line_start": summary.get("line_start"),
                            "line_end": summary.get("line_end"),
                            "summary": summary_text,
                            "imports": summary.get("imports", []),
                            "endpoints": summary.get("endpoints", []),
                        },
                    )],
                )
                stored += 1
            except Exception as e:
                logger.warning(f"Failed to store summary for {summary.get('name')}: {e}")

        logger.info(f"Stored {stored}/{len(summaries)} function summaries in Qdrant")

    # ── Utilities ─────────────────────────────────────────────────────────────

    def _map_severity(self, vuln_type: str) -> str:
        severity_map = {
            "sql_injection": "critical",
            "sqli": "critical",
            "command_injection": "critical",
            "code_injection": "critical",
            "hardcoded_jwt": "critical",
            "xss": "high",
            "ssrf": "high",
            "hardcoded_secret": "high",
            "prototype_pollution": "high",
            "path_traversal": "high",
            "missing_auth": "high",
            "jwt_issue": "high",
            "mass_assignment": "high",
            "open_redirect": "medium",
            "n_plus_1": "medium",
            "csrf": "medium",
            "security_misconfiguration": "medium",
            "weak_crypto": "medium",
            "weak_random": "medium",
            "cors_misconfiguration": "medium",
        }
        vuln_lower = (vuln_type or "").lower()
        for key, severity in severity_map.items():
            if key in vuln_lower:
                return severity
        return "medium"

    def _format_size(self, size: int) -> str:
        for unit in ["B", "KB", "MB", "GB"]:
            if size < 1024:
                return f"{size:.1f}{unit}"
            size //= 1024
        return f"{size:.1f}TB"


# ── Entry point ───────────────────────────────────────────────────────────────

_worker: ScanWorker | None = None


def signal_handler(signum: int, frame: Any) -> None:
    logger.info(f"Received signal {signum}, shutting down...")
    if _worker:
        asyncio.create_task(_worker.stop())


async def main() -> None:
    global _worker
    logger.info("=== MAIN FUNCTION STARTED ===")
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    _worker = ScanWorker()
    try:
        await _worker.start()
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        if _worker:
            await _worker.stop()
        logger.info("Worker stopped, exiting...")


if __name__ == "__main__":
    asyncio.run(main())