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

Week 2 Exit Criteria:
- Worker parses code with Tree-Sitter
- FalkorDB graph populated with nodes/edges
- N+1 detection query returns results
"""

import asyncio
import json
import logging
import os
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

# Configure logging with DEBUG level for more visibility
logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger(__name__)

# Log immediately to confirm module is loading
logger.info("=== SCAN WORKER MODULE LOADING ===")

settings = get_settings()
logger.info(f"Settings loaded - Redis URL: {settings.redis_url}")


class ScanWorker:
    """
    Worker that processes scan jobs from Redis Stream.
    
    Each scan job:
    1. Clones the repository to a temporary directory
    2. Parses the code structure with Tree-Sitter
    3. Builds a knowledge graph in FalkorDB
    4. Runs N+1 detection query
    5. Week 3: Semgrep static analysis
    6. Week 3: Semantic lifting with Ollama
    7. Week 3: LLM verification (two-tier)
    8. Week 3: Pattern propagation
    9. Reports results to Supabase
    """
    
    def __init__(self, worker_id: str | None = None) -> None:
        """
        Initialize the scan worker.
        
        Args:
            worker_id: Unique worker identifier (auto-generated if not provided)
        """
        logger.debug("ScanWorker.__init__ called")
        self.worker_id = worker_id or f"worker-{uuid4().hex[:8]}"
        self.running = False
        logger.debug(f"Worker ID: {self.worker_id}")
        
        logger.debug("Getting Redis bus instance...")
        self.redis_bus = get_redis_bus()
        logger.debug("Redis bus instance obtained")
        
        self.clone_base_dir = Path(settings.repo_clone_dir)
        logger.debug(f"Clone directory: {self.clone_base_dir}")
        
        # Ensure clone directory exists
        self.clone_base_dir.mkdir(parents=True, exist_ok=True)
        
        # Initialize Qdrant client (Week 3)
        self.qdrant_client = QdrantClient()
        logger.debug("Qdrant client initialized")
        logger.debug("Clone directory created/verified")
        
        # Initialize parser
        self.parser = CodeParser()
        logger.debug("CodeParser initialized")
        
        logger.info(f"Scan worker initialized: {self.worker_id}")
    
    async def start(self) -> None:
        """Start the worker and begin processing scan jobs."""
        logger.info(f"Starting scan worker: {self.worker_id}")
        self.running = True
        
        # Connect to Redis
        logger.debug("Attempting to connect to Redis...")
        try:
            await self.redis_bus.connect()
            logger.info("Connected to Redis successfully")
        except Exception as e:
            logger.error(f"Failed to connect to Redis: {e}", exc_info=True)
            raise
        
        # Connect to Qdrant and seed known patterns (Week 3)
        logger.debug("Connecting to Qdrant...")
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, self.qdrant_client.connect)
            logger.info("Connected to Qdrant successfully")
            
            # Seed known vulnerable patterns
            await self.qdrant_client.seed_known_patterns(embed_with_ollama)
            logger.info("Seeded known vulnerable patterns")
        except Exception as e:
            logger.error(f"Failed to initialize Qdrant: {e}", exc_info=True)
            # Continue anyway - Qdrant is optional for basic scanning
        
        # Claim any pending messages that have been idle too long (from crashed workers)
        logger.debug("Checking for pending messages to claim...")
        try:
            pending_messages = await self.redis_bus.claim_pending(
                stream_name=STREAM_SCAN_QUEUE,
                group_name=GROUP_SCAN_WORKERS,
                consumer_name=self.worker_id,
                min_idle_time=60000,  # 1 minute
                count=10,
            )
            if pending_messages:
                logger.info(f"Claimed {len(pending_messages)} pending messages")
                for msg in pending_messages:
                    await self.process_message(msg)
        except Exception as e:
            logger.error(f"Error claiming pending messages: {e}", exc_info=True)
        
        # Process messages
        logger.debug(f"Starting consume loop for stream: {STREAM_SCAN_QUEUE}")
        logger.debug(f"Consumer group: {GROUP_SCAN_WORKERS}")
        logger.debug(f"Consumer name: {self.worker_id}")
        
        try:
            iteration = 0
            async for message in self.redis_bus.consume(
                stream_name=STREAM_SCAN_QUEUE,
                group_name=GROUP_SCAN_WORKERS,
                consumer_name=self.worker_id,
                block=5000,  # 5 second timeout
                count=1,
            ):
                iteration += 1
                logger.debug(f"Consume iteration {iteration}, running={self.running}")
                
                if not self.running:
                    logger.info("Worker stopping (running=False)")
                    break
                
                logger.info(f"Received message: {message.get('id', 'unknown')}")
                await self.process_message(message)
                
        except asyncio.CancelledError:
            logger.info("Worker cancelled")
        except Exception as e:
            logger.error(f"Worker error: {e}", exc_info=True)
            raise
    
    async def stop(self) -> None:
        """Stop the worker gracefully."""
        logger.info(f"Stopping scan worker: {self.worker_id}")
        self.running = False
        await self.redis_bus.disconnect()
    
    async def process_message(self, message: dict[str, Any]) -> None:
        """
        Process a single scan job message.
        
        Args:
            message: Message from Redis Stream with id, stream, and data
        """
        msg_id = message["id"]
        data = message["data"]
        
        repo_url = data.get("repo_url")
        triggered_by = data.get("triggered_by", "unknown")
        
        logger.info(f"Processing scan job: {msg_id}")
        logger.info(f"  Repository: {repo_url}")
        logger.info(f"  Triggered by: {triggered_by}")
        
        # Use scan_id from message if provided (from API), otherwise generate new one
        # This ensures vulnerabilities are saved with the same ID created in Supabase
        scan_id = data.get("scan_id")
        if scan_id:
            logger.info(f"  Scan ID: {scan_id} (from API/Redis message)")
        else:
            scan_id = str(uuid4())
            logger.warning(f"  Scan ID: {scan_id} (GENERATED - not from API! FK may fail)")
            logger.warning("  >>> This scan was NOT triggered via API. Vulnerabilities may fail to save due to FK constraint!")
        
        try:
            # Initialize Supabase client for progress updates
            supabase = get_supabase_client()
            
            # Update status to running
            await supabase.update_scan_status(scan_id, "running", 0, current_stage="Starting scan")
            
            # Clone the repository
            clone_dir = await self.clone_repository(scan_id, repo_url)
            
            # Update progress: Clone complete (5%)
            await supabase.update_scan_status(
                scan_id, "running", 5,
                current_stage="Clone Repository",
                stage_output={"stage": "clone", "status": "completed", "repo_url": repo_url}
            )
            
            # Parse with Tree-Sitter (Week 2)
            logger.info("Parsing code with Tree-Sitter...")
            loop = asyncio.get_event_loop()
            nodes = await loop.run_in_executor(
                None,
                lambda: self.parser.parse_directory(clone_dir)
            )
            logger.info(f"Parsed {len(nodes)} nodes from {clone_dir}")
            
            # Update progress: Parse complete (15%)
            await supabase.update_scan_status(
                scan_id, "running", 15,
                current_stage="Parse Code",
                stage_output={"stage": "parse", "status": "completed", "nodes_parsed": len(nodes)}
            )
            
            # Build FalkorDB graph (Week 2)
            logger.info("Building FalkorDB graph...")
            falkordb = get_falkordb_client()
            graph = await loop.run_in_executor(
                None,
                lambda: falkordb.create_scan_graph(scan_id)
            )
            
            # Batch insert nodes
            await loop.run_in_executor(
                None,
                lambda: falkordb.add_nodes_batch(graph, nodes)
            )
            logger.info("Nodes inserted into graph")
            
            # Create edges
            await loop.run_in_executor(
                None,
                lambda: falkordb.create_edges(graph)
            )
            logger.info("Edges created in graph")
            
            # Update progress: Knowledge Graph complete (25%)
            await supabase.update_scan_status(
                scan_id, "running", 25,
                current_stage="Build Knowledge Graph",
                stage_output={"stage": "knowledge_graph", "status": "completed", "nodes_added": len(nodes)}
            )
            
            # Run N+1 detection
            logger.info("Running N+1 detection query...")
            n_plus_ones = await loop.run_in_executor(
                None,
                lambda: falkordb.detect_n_plus_1(graph)
            )
            logger.info(f"Found {len(n_plus_ones)} N+1 candidates")
            
            # Update progress: Detectors complete (35%)
            await supabase.update_scan_status(
                scan_id, "running", 35,
                current_stage="Run Detectors",
                stage_output={"stage": "detectors", "status": "completed", "n_plus_1_candidates": len(n_plus_ones)}
            )
            
            # ========================================
            # Week 3: Semgrep Static Analysis (Stage 5a)
            # ========================================
            logger.info("Running Semgrep static analysis...")
            semgrep_findings = run_semgrep(clone_dir, scan_id)
            logger.info(f"Semgrep found {len(semgrep_findings)} raw findings")
            
            # Convert Semgrep findings to parsed nodes
            semgrep_nodes = semgrep_to_parsed_nodes(semgrep_findings, scan_id)
            logger.info(f"Converted {len(semgrep_nodes)} Semgrep findings to parsed nodes")
            
            # Update progress: Semgrep complete (50%)
            await supabase.update_scan_status(
                scan_id, "running", 50,
                current_stage="Semgrep Analysis",
                stage_output={"stage": "semgrep", "status": "completed", "findings": len(semgrep_findings), "nodes_created": len(semgrep_nodes)}
            )
            
            # Extract unique file paths from Semgrep findings for targeted semantic lifting
            semgrep_target_files: set[str] = set()
            for node in semgrep_nodes:
                if isinstance(node, dict):
                    file_path = node.get("file_path", "")
                    if file_path:
                        semgrep_target_files.add(file_path)
            logger.info(f"Identified {len(semgrep_target_files)} unique files with Semgrep findings for semantic lifting")
            
            # ========================================
            # Week 3: Semantic Lifting (Stage 5b)
            # ========================================
            # CRITICAL: Skip semantic lifting entirely if no Semgrep findings
            # This prevents ~45 minutes of wasted work on large repos
            if not semgrep_target_files:
                logger.info("No Semgrep findings — skipping semantic lifting entirely")
                semantic_summaries = []
            else:
                logger.info(f"Lifting {len(semgrep_target_files)} files with findings...")
                # Place semantic output outside the cloned repo to avoid Semgrep scanning it
                semantic_clone_dir = self.clone_base_dir / "semantic" / scan_id
                semantic_summaries = await lift_directory(
                    str(clone_dir),
                    nodes,  # All parsed nodes from Tree-Sitter
                    str(semantic_clone_dir),
                    target_files=semgrep_target_files,
                )
            logger.info(f"Generated {len(semantic_summaries)} semantic summaries")
            
            # Update progress: Semantic lifting complete (65%)
            await supabase.update_scan_status(
                scan_id, "running", 65,
                current_stage="Semantic Lifting",
                stage_output={"stage": "semantic_lifting", "status": "completed", "summaries_generated": len(semantic_summaries), "files_lifted": len(semgrep_target_files)}
            )
            
            # Store function summaries in Qdrant for pattern matching
            if semantic_summaries:
                await self._store_function_summaries(semantic_summaries)
            
            # ========================================
            # Week 3: LLM Verification (Stage 5c)
            # ========================================
            all_candidates = []
            
            # Add N+1 candidates for verification
            for candidate in n_plus_ones:
                # Defensive type check
                if not isinstance(candidate, dict):
                    logger.warning(f"Skipping non-dict N+1 candidate: {type(candidate)}")
                    continue
                all_candidates.append({
                    "vuln_type": "n_plus_1",
                    "rule_id": "falkordb-n-plus-1-detection",
                    "code_snippet": candidate.get("code_snippet", ""),
                    "file_path": candidate.get("file", ""),
                    "line_start": candidate.get("line_start", 0),
                    "line_end": candidate.get("line_end", 0),
                    "function_name": candidate.get("function_name", ""),
                    **candidate,
                })
            
            # Add Semgrep findings for verification
            for node in semgrep_nodes:
                # Defensive type check
                if not isinstance(node, dict):
                    logger.warning(f"Skipping non-dict semgrep node: {type(node)}")
                    continue
                all_candidates.append({
                    "vuln_type": node.get("vuln_type", "unknown"),
                    "rule_id": node.get("rule_id", "semgrep"),
                    "code_snippet": node.get("code_snippet", ""),
                    "file_path": node.get("file_path", ""),
                    "line_start": node.get("line_start", 0),
                    "line_end": node.get("line_end", 0),
                    "function_name": node.get("function_name", ""),
                    **node,
                })
            
            logger.info(f"Verifying {len(all_candidates)} vulnerability candidates...")
            logger.info(f"  - N+1 candidates: {len(n_plus_ones)}")
            logger.info(f"  - Semgrep candidates: {len(semgrep_nodes)}")
            
            # Update progress: Starting LLM verification (70%)
            await supabase.update_scan_status(
                scan_id, "running", 70,
                current_stage="LLM Verification",
                stage_output={"stage": "llm_verification", "status": "in_progress", "total_candidates": len(all_candidates), "n_plus_1": len(n_plus_ones), "semgrep": len(semgrep_nodes)}
            )
            
            # Log first few candidates for debugging
            if all_candidates:
                logger.info("=" * 80)
                logger.info("SAMPLE CANDIDATES (first 5):")
                for i, c in enumerate(all_candidates[:5]):
                    logger.info(f"  [{i}] Type: {c.get('vuln_type', 'unknown')}")
                    logger.info(f"      File: {c.get('file_path', 'unknown')}:{c.get('line_start', 0)}")
                    logger.info(f"      Rule: {c.get('rule_id', 'unknown')}")
                    logger.info(f"      Snippet (first 100 chars): {str(c.get('code_snippet', ''))[:100]}...")
                logger.info("=" * 80)
            
            verified_vulns = []  # Only CONFIRMED vulnerabilities (for pattern propagation)
            all_verified_results = []  # ALL verified results (for saving to DB)
            verification_results = []  # Track all verification results for debugging
            
            # Process candidates in batches for parallel LLM verification
            BATCH_SIZE = 5  # Process 5 candidates in parallel
            
            for batch_start in range(0, len(all_candidates), BATCH_SIZE):
                batch = all_candidates[batch_start:batch_start + BATCH_SIZE]
                
                # Create tasks for parallel processing
                tasks = []
                for candidate in batch:
                    if not isinstance(candidate, dict):
                        continue
                    
                    logger.info(f"VERIFYING: {candidate.get('file_path', 'unknown')}:{candidate.get('line_start', 0)}")
                    tasks.append(verify_candidate(candidate))
                
                # Run all verifications in parallel
                batch_results = await asyncio.gather(*tasks, return_exceptions=True)
                
                # Process results
                for idx, result in enumerate(batch_results):
                    candidate = batch[idx]
                    
                    try:
                        if isinstance(result, Exception):
                            logger.warning(f"Verification failed: {result}")
                            verified = {
                                **candidate,
                                "confirmed": False,
                                "confidence": "low",
                                "verification_reason": f"LLM verification error: {str(result)}",
                                "needs_llm_verification": False,
                            }
                        else:
                            verified = result if isinstance(result, dict) else {
                                **candidate,
                                "confirmed": False,
                                "confidence": "low",
                                "verification_reason": "Invalid verification result",
                                "needs_llm_verification": False,
                            }
                        
                        all_verified_results.append(verified)
                        
                        # Track verification result
                        verification_results.append({
                            "file": verified.get('file_path', 'unknown'),
                            "line": verified.get('line_start', 0),
                            "type": verified.get('vuln_type', 'unknown'),
                            "confirmed": verified.get('confirmed', False),
                            "confidence": verified.get('confidence', 'unknown'),
                            "reason": verified.get('verification_reason', 'no reason'),
                        })
                        
                        if verified.get("confirmed"):
                            verified_vulns.append(verified)
                            logger.info(f"*** CONFIRMED VULNERABILITY ***")
                            logger.info(f"    Type: {verified.get('vuln_type')}")
                            logger.info(f"    File: {verified.get('file_path')}:{verified.get('line_start')}")
                            
                            # Pattern propagation
                            similar_funcs = await propagate_pattern(
                                verified,
                                self.qdrant_client.client,
                                embed_with_ollama,
                            )
                            if similar_funcs:
                                logger.info(f"Pattern propagation found {len(similar_funcs)} similar functions")
                        
                        # Defensive type check for verified result
                        # BUG FIX: Don't skip entirely - use fallback with default values
                        # This ensures candidates are still saved even if LLM verification fails
                        if verified is None:
                            logger.warning(f"verify_candidate returned None for {candidate.get('file_path', 'unknown')}")
                            verification_results.append({
                                "file": candidate.get('file_path', 'unknown'),
                                "line": candidate.get('line_start', 0),
                                "status": "ERROR",
                                "reason": "verify_candidate returned None"
                            })
                            # Use fallback instead of skipping entirely
                            verified = {
                                **candidate,
                                "confirmed": False,
                                "confidence": "low",
                                "verification_reason": "LLM verification failed - using default values",
                                "needs_llm_verification": False,
                            }
                        
                        if not isinstance(verified, dict):
                            logger.warning(f"verify_candidate returned non-dict: {type(verified)}")
                            verification_results.append({
                                "file": candidate.get('file_path', 'unknown'),
                                "line": candidate.get('line_start', 0),
                                "status": "ERROR",
                                "reason": f"verify_candidate returned {type(verified)}"
                            })
                            # Use fallback instead of skipping entirely
                            verified = {
                                **candidate,
                                "confirmed": False,
                                "confidence": "low",
                                "verification_reason": "LLM verification returned invalid type",
                                "needs_llm_verification": False,
                            }
                        
                        # Store ALL verified results for saving to DB
                        all_verified_results.append(verified)
                        
                        # Log the verification result
                        verification_results.append({
                            "file": verified.get('file_path', 'unknown'),
                            "line": verified.get('line_start', 0),
                            "type": verified.get('vuln_type', 'unknown'),
                            "confirmed": verified.get('confirmed', False),
                            "confidence": verified.get('confidence', 'unknown'),
                            "reason": verified.get('verification_reason', 'no reason'),
                            "is_test_fixture": verified.get('is_test_fixture', False)
                        })
                        
                        if verified.get("confirmed"):
                            verified_vulns.append(verified)
                            logger.info(f"*** CONFIRMED VULNERABILITY ***")
                            logger.info(f"    Type: {verified.get('vuln_type')}")
                            logger.info(f"    File: {verified.get('file_path')}:{verified.get('line_start')}")
                            logger.info(f"    Confidence: {verified.get('confidence')}")
                            logger.info(f"    Reason: {verified.get('verification_reason')}")
                            
                            # ========================================
                            # Week 3: Pattern Propagation (Stage 5d)
                            # ========================================
                            similar_funcs = await propagate_pattern(
                                verified,
                                self.qdrant_client.client,
                                embed_with_ollama,
                            )
                            if similar_funcs:
                                logger.info(f"Pattern propagation found {len(similar_funcs)} similar functions")
                        else:
                            logger.info(f"NOT CONFIRMED: {verified.get('verification_reason', 'no reason')}")
                            
                    except Exception as e:
                        logger.warning(f"Failed to verify candidate: {e}", exc_info=True)
                        verification_results.append({
                            "file": candidate.get('file_path', 'unknown') if isinstance(candidate, dict) else 'unknown',
                            "line": candidate.get('line_start', 0) if isinstance(candidate, dict) else 0,
                            "status": "EXCEPTION",
                            "reason": str(e)
                        })
            
            # Log summary of all verification results
            logger.info("")
            logger.info("=" * 80)
            logger.info("VERIFICATION SUMMARY:")
            logger.info(f"  Total candidates: {len(all_candidates)}")
            logger.info(f"  Confirmed vulnerabilities: {len(verified_vulns)}")
            logger.info(f"  Verification results count: {len(verification_results)}")
            
            # Count by status
            confirmed_count = sum(1 for r in verification_results if r.get('confirmed') == True)
            not_confirmed_count = sum(1 for r in verification_results if r.get('confirmed') == False)
            error_count = sum(1 for r in verification_results if r.get('status') in ['ERROR', 'EXCEPTION'])
            
            logger.info(f"  Confirmed: {confirmed_count}")
            logger.info(f"  Not confirmed: {not_confirmed_count}")
            logger.info(f"  Errors: {error_count}")
            
            # Log all results for debugging
            for r in verification_results:
                logger.info(f"    - {r.get('file', 'unknown')}:{r.get('line', 0)} | confirmed={r.get('confirmed', 'N/A')} | {r.get('reason', r.get('status', 'unknown'))}")
            logger.info("=" * 80)
            
            # ========================================
            # Save ALL candidates to Supabase with verification results merged
            # ========================================
            logger.info(f"Total candidates to save: {len(all_candidates)}")
            
            if all_candidates:
                logger.info("Saving ALL vulnerability candidates to Supabase...")
                supabase = get_supabase_client()
                
                # Build a lookup of ALL verified results by (file_path, line_start)
                # This ensures verification results are used when saving
                verified_lookup = {
                    (v.get("file_path"), v.get("line_start")): v
                    for v in all_verified_results
                    if isinstance(v, dict)
                }
                logger.info(f"Verified lookup has {len(verified_lookup)} entries (from {len(all_verified_results)} verified results)")
                
                # Convert all candidates to records, using verified data when available
                vulns = []
                for v in all_candidates:
                    # Defensive type check
                    if not isinstance(v, dict):
                        logger.warning(f"Skipping non-dict candidate: {type(v)}")
                        continue
                    
                    # Use verified version if available, otherwise use raw candidate
                    key = (v.get("file_path"), v.get("line_start"))
                    source = verified_lookup.get(key, v)
                    
                    # Log if we're using verified data
                    if key in verified_lookup:
                        logger.info(f"Using VERIFIED data for {key}: confirmed={source.get('confirmed')}")
                    
                    # BUG FIX: Properly propagate severity from verified result
                    # The LLM may return "critical" which should override the default "high"
                    severity = source.get("severity")
                    if not severity:
                        severity = self._map_severity(source.get("vuln_type", "unknown"))
                    
                    # BUG FIX: Create a deep copy of source for details to prevent
                    # mutable dict issues where one row's details overwrite another
                    import copy
                    source_copy = copy.deepcopy(source)
                    
                    # BUG FIX: Extract fix_suggestion from verified result (was only in details JSON)
                    fix_suggestion = source_copy.get("fix_suggestion", "") or ""
                    
                    # BUG FIX: Use actual confidence from LLM instead of hardcoded 0.8
                    # LLM returns confidence as string (high/medium/low), convert to score
                    confidence_str = source_copy.get("confidence", "medium")
                    if isinstance(confidence_str, (int, float)):
                        confidence_score = float(confidence_str)
                    elif confidence_str.lower() == "high":
                        confidence_score = 0.90
                    elif confidence_str.lower() == "medium":
                        confidence_score = 0.70
                    else:  # low
                        confidence_score = 0.50
                    
                    # BUG FIX: Detect false positives for safe Sequelize scalar lookups
                    # Pattern: Model.findOne({where: {key: req.body.x}}) is SAFE
                    # Only Model.findOne({where: req.body}) is dangerous (operator injection)
                    false_positive = False
                    rule_id = source_copy.get("rule_id", "")
                    snippet = source_copy.get("code_snippet", "") or ""
                    
                    # Check for safe Sequelize scalar lookup pattern
                    if rule_id == "taint-express-nosqli":
                        # Safe patterns: {where: {key: value}} - scalar lookup
                        # Dangerous patterns: {where: req.body} - whole object as where
                        import re
                        safe_pattern = r'\{where:\s*\{[^}]+\}\}'  # where: {key: value}
                        dangerous_pattern = r'\{where:\s*(req\.(body|params|query)|[^{])'  # where: req.body
                    
                        if re.search(safe_pattern, snippet) and not re.search(dangerous_pattern, snippet):
                            false_positive = True
                            logger.info(f"Marking as FP - safe Sequelize scalar lookup: {snippet[:50]}...")
                    
                    # BUG FIX: Strip trailing colon from vuln_type in title
                    vuln_type_clean = source_copy.get("vuln_type", "Unknown").replace(":", "").strip()
                    
                    vuln = {
                        "type": source_copy.get("vuln_type", "unknown"),
                        "severity": severity,
                        "category": source_copy.get("rule_id", ""),
                        "title": f"{vuln_type_clean}: {source_copy.get('function_name', source_copy.get('rule_id', 'unknown'))}",
                        "description": source_copy.get("verification_reason", source_copy.get("message", "Candidate vulnerability")),
                        "file_path": str(source_copy.get("file_path", "") or ""),
                        "line_start": source_copy.get("line_start", 0),
                        "line_end": source_copy.get("line_end", 0),
                        "code_snippet": str(source_copy.get("code_snippet", "") or ""),
                        "confirmed": bool(source_copy.get("confirmed", False)),
                        "confidence_score": confidence_score,
                        "false_positive": false_positive,
                        "fix_suggestion": fix_suggestion,
                        "details": json.loads(json.dumps(source_copy, default=str)),
                    }
                    vulns.append(vuln)
                
                logger.info(f"Prepared {len(vulns)} vulnerability records for insert")
                
                try:
                    result = await supabase.insert_vulnerabilities_batch(scan_id, vulns)
                    logger.info(f"Supabase insert result: {result}")
                    logger.info(f"Saved {len(vulns)} vulnerability candidates to Supabase")
                    
                    # Update progress: Results saved (95%)
                    await supabase.update_scan_status(
                        scan_id, "running", 95,
                        current_stage="Save Results",
                        stage_output={"stage": "save_results", "status": "completed", "vulnerabilities_saved": len(vulns)}
                    )
                except Exception as insert_error:
                    logger.error(f"Failed to insert vulnerabilities: {insert_error}", exc_info=True)
            else:
                logger.warning("No candidates to save - all_candidates is empty!")
            
            # Generate a minimal summary report (just the stats, not the file tree)
            reports_dir = self.clone_base_dir / "reports"
            reports_dir.mkdir(parents=True, exist_ok=True)
            report_path = reports_dir / f"scan_{scan_id}.md"
            
            # Write a minimal report with just vulnerability summary
            report_lines = [
                f"# Scan Report: {repo_url}",
                f"**Scan ID:** {scan_id}",
                f"**Timestamp:** {datetime.now(timezone.utc).isoformat()}",
                "",
                f"- Total candidates analyzed: {len(all_candidates)}",
                f"- Confirmed vulnerabilities: {len(verified_vulns)}",
            ]
            
            with open(report_path, 'w') as f:
                f.write('\n'.join(report_lines))
            
            logger.info(f"Report saved to: {report_path}")
            
            # Acknowledge the message
            await self.redis_bus.ack_message(
                stream_name=STREAM_SCAN_QUEUE,
                group_name=GROUP_SCAN_WORKERS,
                msg_id=msg_id,
            )
            
            logger.info(f"Scan job completed: {scan_id}")
            logger.info(f"Report saved to: {report_path}")
            
            # Update final status to completed
            await supabase.update_scan_status(
                scan_id, "completed", 100,
                current_stage="Completed",
                stage_output={"stage": "complete", "status": "completed", "report_path": str(report_path)}
            )
            
        except Exception as e:
            logger.error(f"Failed to process scan job: {e}", exc_info=True)
            # Update status to failed
            try:
                supabase = get_supabase_client()
                await supabase.update_scan_status(
                    scan_id, "failed", 0,
                    error_message=str(e),
                    current_stage="Failed",
                    stage_output={"stage": "error", "status": "failed", "error": str(e)}
                )
            except:
                pass
            # Message will be retried or claimed by another worker
    
    async def clone_repository(self, scan_id: str, repo_url: str) -> Path:
        """
        Clone a repository to a local directory.
        
        Args:
            scan_id: Unique scan identifier
            repo_url: Repository URL to clone
            
        Returns:
            Path to the cloned repository
        """
        # Create unique directory for this scan
        clone_dir = self.clone_base_dir / scan_id
        
        logger.info(f"Cloning repository to: {clone_dir}")
        
        # Remove existing directory if it exists
        if clone_dir.exists():
            def on_rm_error(func, path, exc_info):
                """Handle Windows permission errors when deleting .git directories"""
                import stat
                os.chmod(path, stat.S_IWRITE)
                func(path)
            
            try:
                shutil.rmtree(clone_dir, onerror=on_rm_error)
            except Exception as e:
                logger.warning(f"Could not remove existing clone dir: {e}. Trying to use existing...")
                # If we can't delete, try to rename it
                backup_dir = clone_dir.with_suffix(f".old_{int(time.time())}")
                try:
                    clone_dir.rename(backup_dir)
                except Exception:
                    pass
        
        # Clone the repository
        try:
            # Run git clone in a thread pool to not block
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: Repo.clone_from(repo_url, clone_dir, depth=1),
            )
            
            logger.info(f"Repository cloned successfully: {clone_dir}")
            return clone_dir
            
        except GitCommandError as e:
            logger.error(f"Failed to clone repository: {e}")
            raise RuntimeError(f"Failed to clone repository: {e}")
    
    async def print_file_tree(
        self,
        repo_path: Path,
        scan_id: str,
        repo_url: str,
        max_depth: int = 3,
        verified_vulns: list[dict[str, Any]] | None = None,
    ) -> Path:
        """
        Print the file tree of a repository and save to a report file.
        
        This is the Week 1 exit criteria - demonstrates that the worker
        can clone a repo and examine its structure.
        
        Args:
            repo_path: Path to the cloned repository
            scan_id: Unique scan identifier
            repo_url: Repository URL
            max_depth: Maximum depth to traverse
            verified_vulns: List of verified vulnerabilities to include in report
            
        Returns:
            Path to the generated report file
        """
        # Define at method level so it's accessible to both nested function and summary stats
        ignore_patterns = {".git", "__pycache__", "node_modules", ".venv", "venv", ".idea", ".vscode"}
        
        # Create reports directory
        reports_dir = self.clone_base_dir / "reports"
        reports_dir.mkdir(parents=True, exist_ok=True)
        
        # Report file path
        report_path = reports_dir / f"scan_{scan_id}.md"
        
        # Build report content
        report_lines: list[str] = []
        report_lines.append(f"# Scan Report: {repo_path.name}")
        report_lines.append("")
        report_lines.append(f"**Scan ID:** {scan_id}")
        report_lines.append(f"**Repository:** {repo_url}")
        report_lines.append(f"**Timestamp:** {datetime.now(timezone.utc).isoformat()}")
        report_lines.append("")
        report_lines.append("## File Tree")
        report_lines.append("")
        report_lines.append("```")
        
        logger.info("=" * 60)
        logger.info(f"FILE TREE: {repo_path.name}")
        logger.info("=" * 60)
        
        def process_tree(path: Path, prefix: str = "", depth: int = 0) -> None:
            if depth > max_depth:
                return
            
            try:
                entries = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name))
            except PermissionError:
                return
            
            for i, entry in enumerate(entries):
                if entry.name in ignore_patterns:
                    continue
                
                is_last = i == len(entries) - 1
                connector = "    " if is_last else "    "
                
                if entry.is_dir():
                    line = f"{prefix}{'    ' if is_last else '    '}{entry.name}/"
                    logger.info(line)
                    report_lines.append(line)
                    process_tree(entry, prefix + connector, depth + 1)
                else:
                    # Get file size
                    try:
                        size = entry.stat().st_size
                        size_str = self._format_size(size)
                        line = f"{prefix}{'    ' if is_last else '    '}{entry.name} ({size_str})"
                    except OSError:
                        line = f"{prefix}{'    ' if is_last else '    '}{entry.name}"
                    logger.info(line)
                    report_lines.append(line)
        
        # Run in executor to not block
        loop = asyncio.get_event_loop()
        await loop.run_in_executor(
            None,
            lambda: process_tree(repo_path),
        )
        
        # Calculate summary statistics
        total_files = sum(1 for _ in repo_path.rglob("*") if _.is_file() and not any(
            p.name in ignore_patterns for p in _.parents
        ))
        total_dirs = sum(1 for _ in repo_path.rglob("*") if _.is_dir() and not any(
            p.name in ignore_patterns for p in _.parents
        ))
        
        logger.info("-" * 60)
        logger.info(f"Total files: {total_files}")
        logger.info(f"Total directories: {total_dirs}")
        logger.info("=" * 60)
        
        # Complete report
        report_lines.append("```")
        report_lines.append("")
        report_lines.append("## Summary")
        report_lines.append("")
        report_lines.append(f"- **Total files:** {total_files}")
        report_lines.append(f"- **Total directories:** {total_dirs}")
        report_lines.append(f"- **Max depth traversed:** {max_depth}")
        
        # Add vulnerabilities section if provided
        if verified_vulns:
            report_lines.append("")
            report_lines.append("## Vulnerabilities Found")
            report_lines.append("")
            report_lines.append(f"**Total vulnerabilities:** {len(verified_vulns)}")
            report_lines.append("")
            
            # Group by severity
            severity_counts = {"critical": 0, "high": 0, "medium": 0, "low": 0}
            for vuln in verified_vulns:
                severity = vuln.get("severity", "medium").lower()
                if severity in severity_counts:
                    severity_counts[severity] += 1
            
            report_lines.append("### By Severity")
            report_lines.append("")
            report_lines.append(f"- **Critical:** {severity_counts['critical']}")
            report_lines.append(f"- **High:** {severity_counts['high']}")
            report_lines.append(f"- **Medium:** {severity_counts['medium']}")
            report_lines.append(f"- **Low:** {severity_counts['low']}")
            report_lines.append("")
            
            # List each vulnerability
            report_lines.append("### Details")
            report_lines.append("")
            for i, vuln in enumerate(verified_vulns, 1):
                vuln_type = vuln.get("vuln_type", "unknown")
                file_path = vuln.get("file_path", "unknown")
                line_start = vuln.get("line_start", 0)
                severity = vuln.get("severity", "medium")
                reason = vuln.get("verification_reason", "No description available")
                function_name = vuln.get("function_name", "")
                
                report_lines.append(f"#### {i}. {vuln_type}")
                report_lines.append("")
                report_lines.append(f"- **File:** `{file_path}`")
                if function_name:
                    report_lines.append(f"- **Function:** `{function_name}`")
                report_lines.append(f"- **Line:** {line_start}")
                report_lines.append(f"- **Severity:** {severity}")
                report_lines.append(f"- **Description:** {reason}")
                report_lines.append("")
        
        report_lines.append("---")
        report_lines.append("*Generated by VibeCheck MVP Week 2*")
        
        # Write report to file
        report_content = "\n".join(report_lines)
        await loop.run_in_executor(
            None,
            lambda: report_path.write_text(report_content, encoding="utf-8"),
        )
        
        logger.info(f"Report saved to: {report_path}")
        
        return report_path
    
    async def _store_function_summaries(self, summaries: list[dict[str, Any] | str]) -> None:
        """
        Store function summaries in Qdrant for pattern matching.
        
        Args:
            summaries: List of function summary dicts from semantic lifting
                       Note: lift_directory() returns list[str] (file paths),
                       so this method skips storage if strings are passed.
        """
        from qdrant_client.http import models
        
        # Skip if summaries is a list of strings (file paths from lift_directory)
        # The semantic files are already written to disk, so Qdrant storage is optional
        if not summaries:
            return
            
        # Check if first item is a string (file path) instead of dict
        if isinstance(summaries[0], str):
            logger.info("Semantic summaries are file paths (not dicts), skipping Qdrant storage")
            return
        
        try:
            stored_count = 0
            for summary in summaries:
                # Defensive type check
                if not isinstance(summary, dict):
                    logger.warning(f"Skipping non-dict summary: {type(summary)}")
                    continue
                    
                # Get embedding for the summary
                summary_text = summary.get("summary", "")
                if not summary_text:
                    continue
                
                vector = await embed_with_ollama(summary_text)
                
                # Create point for Qdrant
                point = models.PointStruct(
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
                )
                
                # Upsert to Qdrant
                self.qdrant_client.client.upsert(
                    collection_name="function_summaries",
                    points=[point],
                )
                stored_count += 1
            
            logger.info(f"Stored {stored_count} function summaries in Qdrant")
            
        except Exception as e:
            logger.error(f"Failed to store function summaries: {e}")
    
    def _map_severity(self, vuln_type: str) -> str:
        """
        Map vulnerability type to severity level.
        
        Args:
            vuln_type: Type of vulnerability
            
        Returns:
            Severity level string
        """
        severity_map = {
            "sql_injection": "critical",
            "sqli": "critical",
            "xss": "high",
            "cross-site scripting": "high",
            "ssrf": "high",
            "server-side request forgery": "high",
            "hardcoded_secret": "high",
            "hardcoded_jwt": "critical",
            "n_plus_1": "medium",
            "prototype_pollution": "high",
            "path_traversal": "high",
            "command_injection": "critical",
            "code_injection": "critical",
            "open_redirect": "medium",
            "csrf": "medium",
            # Additional mappings for Semgrep default types
            "security_misconfiguration": "medium",
            "jwt_issue": "high",
            "weak_crypto": "medium",
            "weak_random": "medium",
            "missing_auth": "high",
            "cors_misconfiguration": "medium",
        }
        
        vuln_lower = vuln_type.lower()
        for key, severity in severity_map.items():
            if key in vuln_lower:
                return severity
        
        return "medium"
    
    def _format_size(self, size: int) -> str:
        """Format file size in human-readable format."""
        for unit in ["B", "KB", "MB", "GB"]:
            if size < 1024:
                return f"{size:.1f}{unit}"
            size /= 1024
        return f"{size:.1f}TB"


# Global worker instance
_worker: ScanWorker | None = None


def signal_handler(signum: int, frame: Any) -> None:
    """Handle shutdown signals gracefully."""
    logger.info(f"Received signal {signum}, shutting down...")
    if _worker:
        asyncio.create_task(_worker.stop())


async def main() -> None:
    """Main entry point for the scan worker."""
    global _worker
    
    logger.info("=== MAIN FUNCTION STARTED ===")
    
    # Set up signal handlers
    logger.debug("Setting up signal handlers...")
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    logger.debug("Signal handlers set up")
    
    # Create and start worker
    logger.debug("Creating ScanWorker instance...")
    _worker = ScanWorker()
    logger.debug("ScanWorker instance created")
    
    try:
        logger.info("Calling worker.start()...")
        await _worker.start()
        logger.info("worker.start() returned")
    except KeyboardInterrupt:
        logger.info("Keyboard interrupt received")
    finally:
        logger.info("Calling worker.stop()...")
        if _worker:
            await _worker.stop()
        logger.info("Worker stopped, exiting...")


if __name__ == "__main__":
    logger.info("Running scan worker as main...")
    asyncio.run(main())