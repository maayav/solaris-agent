"""Test script for Week 3 implementation.

This script tests the Week 3 components with configurable paths.
Set environment variables to customize:
- TEST_SOURCE_DIR: Path to the repository to scan
- QDRANT_URL: Qdrant server URL
"""
import asyncio
import sys
import os
from pathlib import Path

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from worker.semgrep_runner import run_semgrep, semgrep_to_parsed_nodes
from core.qdrant import QdrantClient
from core.config import get_settings
from worker.semantic_lifter import lift_directory
from worker.llm_verifier import verify_candidate, embed_with_ollama

# Default test directory - can be overridden via environment variable
DEFAULT_TEST_DIR = Path(__file__).parent.parent / "vibecoded-test-app" / "targets" / "juice-shop-source"
TEST_SOURCE_DIR = Path(os.environ.get("TEST_SOURCE_DIR", DEFAULT_TEST_DIR))


async def test_semgrep():
    """Test 1: Semgrep runner."""
    print("\n" + "="*60)
    print("TEST 1: Semgrep Runner")
    print("="*60)
    
    # Use configurable path
    repo_path = TEST_SOURCE_DIR
    scan_id = "test-scan-001"
    
    if not repo_path.exists():
        print(f"[SKIP] Test source directory not found: {repo_path}")
        print("Set TEST_SOURCE_DIR environment variable to specify a directory.")
        return []
    
    print(f"Running Semgrep on: {repo_path}")
    try:
        findings = run_semgrep(repo_path, scan_id)
        print(f"[PASS] Semgrep returned {len(findings)} raw findings")
        
        if len(findings) >= 10:
            print("[PASS] ACCEPTANCE CRITERIA MET: >= 10 raw findings")
        else:
            print(f"[FAIL] ACCEPTANCE CRITERIA NOT MET: Expected >= 10, got {len(findings)}")
        
        # Show sample findings
        print("\nSample findings (first 5):")
        for i, f in enumerate(findings[:5]):
            print(f"  {i+1}. {f.get('check_id', 'unknown')} in {f.get('path', 'unknown')}")
        
        return findings
    except Exception as e:
        print(f"[FAIL] Semgrep test failed: {e}")
        import traceback
        traceback.print_exc()
        return []


async def test_qdrant_patterns():
    """Test 2: Qdrant known patterns seeding."""
    print("\n" + "="*60)
    print("TEST 2: Qdrant Known Patterns Seeding")
    print("="*60)
    
    try:
        settings = get_settings()
        client = QdrantClient()
        print("[PASS] Qdrant client created")
        
        # Seed patterns
        await client.seed_known_patterns(embed_with_ollama)
        print("[PASS] Patterns seeded")
        
        # Check collection using configured URL
        from qdrant_client import QdrantClient as QC
        qc = QC(url=settings.qdrant_url)
        result = qc.get_collection("known_vulnerable_patterns")
        point_count = result.points_count
        print(f"[PASS] known_vulnerable_patterns collection has {point_count} points")
        
        if point_count == 6:
            print("[PASS] ACCEPTANCE CRITERIA MET: exactly 6 points")
        else:
            print(f"[FAIL] ACCEPTANCE CRITERIA NOT MET: Expected 6, got {point_count}")
        
        return point_count
    except Exception as e:
        print(f"[FAIL] Qdrant patterns test failed: {e}")
        import traceback
        traceback.print_exc()
        return 0


async def test_semantic_lifter():
    """Test 3: Semantic lifter."""
    print("\n" + "="*60)
    print("TEST 3: Semantic Lifter")
    print("="*60)
    
    try:
        # Create test parsed nodes
        parsed_nodes = [
            {
                "type": "endpoint",
                "file_path": "server.ts",
                "line_start": 10,
                "line_end": 15,
                "code_snippet": "app.get('/api/users', (req, res) => { ... })",
                "scan_id": "test-scan-001"
            },
            {
                "type": "function",
                "file_path": "server.ts",
                "line_start": 20,
                "line_end": 30,
                "code_snippet": "function getUser(id) { return db.query('SELECT * FROM users WHERE id = ' + id); }",
                "name": "getUser",
                "scan_id": "test-scan-001"
            }
        ]
        
        output_dir = "semantic_clone_test"
        os.makedirs(output_dir, exist_ok=True)
        
        results = await lift_directory(".", parsed_nodes, output_dir)
        print(f"[PASS] Semantic lifting returned {len(results)} results")
        
        # Check if output directory was created
        if os.path.exists(output_dir):
            print(f"[PASS] Output directory created: {output_dir}")
            # List files
            files = os.listdir(output_dir)
            print(f"  Files created: {len(files)}")
            for f in files[:5]:
                print(f"    - {f}")
        
        return results
    except Exception as e:
        print(f"[FAIL] Semantic lifter test failed: {e}")
        import traceback
        traceback.print_exc()
        return []


async def test_llm_verifier():
    """Test 4: LLM verifier."""
    print("\n" + "="*60)
    print("TEST 4: LLM Verifier")
    print("="*60)
    
    try:
        # Create test candidate
        candidate = {
            "vuln_type": "sql_injection",
            "file_path": "server.ts",
            "line_start": 20,
            "line_end": 25,
            "code_snippet": "const query = 'SELECT * FROM users WHERE id = ' + req.params.id; db.query(query);",
            "confidence": 0.8
        }
        
        print(f"Verifying candidate: {candidate['vuln_type']}")
        result = await verify_candidate(candidate)
        
        print(f"[PASS] Verification result:")
        print(f"  - confirmed: {result.get('confirmed')}")
        print(f"  - confidence: {result.get('confidence')}")
        print(f"  - reasoning: {result.get('reasoning', 'N/A')[:100]}...")
        
        return result
    except Exception as e:
        print(f"[FAIL] LLM verifier test failed: {e}")
        import traceback
        traceback.print_exc()
        return {}


async def main():
    """Run all tests."""
    print("\n" + "#"*60)
    print("# WEEK 3 IMPLEMENTATION TESTS")
    print("#"*60)
    print(f"Test source directory: {TEST_SOURCE_DIR}")
    
    # Test 1: Semgrep
    findings = await test_semgrep()
    
    # Test 2: Qdrant patterns
    pattern_count = await test_qdrant_patterns()
    
    # Test 3: Semantic lifter (skip if no findings)
    # lifter_results = await test_semantic_lifter()
    
    # Test 4: LLM verifier (skip if Ollama not available)
    # verifier_result = await test_llm_verifier()
    
    print("\n" + "#"*60)
    print("# TEST SUMMARY")
    print("#"*60)
    print(f"Semgrep findings: {len(findings)} (target: >= 10)")
    print(f"Qdrant patterns: {pattern_count} (target: 6)")
    print("\nNote: Semantic lifter and LLM verifier tests skipped in quick mode.")
    print("Run full scan to test complete pipeline.")


if __name__ == "__main__":
    asyncio.run(main())
