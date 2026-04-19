"""
Test Runner for Swarm Module Pipeline Tests

Usage:
    python tests/run_tests.py                    # Run all tests
    python tests/run_tests.py -c                 # Run critical tests only
    python tests/run_tests.py -r                 # Run regression tests only
    python tests/run_tests.py -t                 # Run tool tests only
    python tests/run_tests.py -u                 # Run unit tests only (fast)
    python tests/run_tests.py -v                 # Verbose output
    python tests/run_tests.py -k "test_redis"    # Run tests matching pattern
    python tests/run_tests.py --cov              # Run with coverage

Exit Codes:
    0 - All tests passed
    1 - Some tests failed
    2 - Test execution error
"""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path


# Test categories with their markers
TEST_CATEGORIES = {
    "critical": "-m critical",
    "high": "-m high",
    "medium": "-m medium",
    "regression": "-m regression",
    "unit": "-m unit",
    "integration": "-m integration",
    "redis": "-m redis",
    "supabase": "-m supabase",
    "qdrant": "-m qdrant",
    "slow": "-m slow",
    "tools": '-k "TestTools"',
    "exploit": '-k "TestExploitCoverage"',
}


def run_pytest(args: list[str]) -> int:
    """Run pytest with the given arguments."""
    cmd = [sys.executable, "-m", "pytest"] + args
    print(f"Running: {' '.join(cmd)}")
    print("=" * 80)
    
    try:
        result = subprocess.run(cmd, cwd=Path(__file__).parent.parent)
        return result.returncode
    except KeyboardInterrupt:
        print("\n\nTest run interrupted by user")
        return 130
    except Exception as e:
        print(f"Error running tests: {e}")
        return 2


def main():
    parser = argparse.ArgumentParser(
        description="Run Swarm Module Pipeline Tests",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  %(prog)s                           # Run all tests
  %(prog)s -c                        # Run critical bug tests
  %(prog)s -r                        # Run regression tests
  %(prog)s -t                        # Run tool tests
  %(prog)s -u                        # Run unit tests only (fast)
  %(prog)s -v                        # Verbose output
  %(prog)s -k "test_redis"           # Run tests matching pattern
  %(prog)s --cov                     # Run with coverage report
  %(prog)s --html                    # Generate HTML report
        """,
    )
    
    # Category flags
    parser.add_argument(
        "-c", "--critical",
        action="store_true",
        help="Run critical bug tests only",
    )
    parser.add_argument(
        "-r", "--regression",
        action="store_true",
        help="Run regression tests only",
    )
    parser.add_argument(
        "-t", "--tools",
        action="store_true",
        help="Run tool tests only",
    )
    parser.add_argument(
        "-u", "--unit",
        action="store_true",
        help="Run unit tests only (fast, no external services)",
    )
    parser.add_argument(
        "-i", "--integration",
        action="store_true",
        help="Run integration tests only",
    )
    
    # General pytest options
    parser.add_argument(
        "-v", "--verbose",
        action="store_true",
        help="Verbose output",
    )
    parser.add_argument(
        "-k", "--keyword",
        metavar="EXPRESSION",
        help="Only run tests matching the given expression",
    )
    parser.add_argument(
        "-x", "--exitfirst",
        action="store_true",
        help="Exit instantly on first error or failed test",
    )
    parser.add_argument(
        "--lf", "--last-failed",
        action="store_true",
        help="Rerun only the tests that failed last time",
    )
    parser.add_argument(
        "--cov",
        action="store_true",
        help="Run with coverage report",
    )
    parser.add_argument(
        "--html",
        action="store_true",
        help="Generate HTML report",
    )
    parser.add_argument(
        "--junit",
        metavar="PATH",
        help="Generate JUnit XML report at the given path",
    )
    parser.add_argument(
        "--tb",
        choices=["auto", "long", "short", "no", "line", "native"],
        default="short",
        help="Traceback print mode",
    )
    
    args = parser.parse_args()
    
    # Build pytest arguments
    pytest_args = ["tests/test_swarm_pipeline.py"]
    
    # Add verbosity
    if args.verbose:
        pytest_args.append("-v")
    
    # Add traceback style
    pytest_args.extend(["--tb", args.tb])
    
    # Add category filters
    if args.critical:
        pytest_args.extend(["-m", "critical"])
    elif args.regression:
        pytest_args.extend(["-m", "regression"])
    elif args.tools:
        pytest_args.extend(["-k", "TestTools"])
    elif args.unit:
        pytest_args.extend(["-m", "unit"])
    elif args.integration:
        pytest_args.extend(["-m", "integration"])
    
    # Add keyword filter
    if args.keyword:
        pytest_args.extend(["-k", args.keyword])
    
    # Add exitfirst
    if args.exitfirst:
        pytest_args.append("-x")
    
    # Add last-failed
    if args.last_failed:
        pytest_args.append("--lf")
    
    # Add coverage
    if args.cov:
        pytest_args.extend([
            "--cov=agents",
            "--cov=core",
            "--cov=sandbox",
            "--cov-report=term-missing",
            "--cov-report=html:htmlcov",
        ])
    
    # Add HTML report
    if args.html:
        pytest_args.extend([
            "--html=report.html",
            "--self-contained-html",
        ])
    
    # Add JUnit report
    if args.junit:
        pytest_args.extend(["--junitxml", args.junit])
    
    # Run tests
    exit_code = run_pytest(pytest_args)
    
    # Print summary
    print("\n" + "=" * 80)
    if exit_code == 0:
        print("✅ All tests passed!")
    elif exit_code == 1:
        print("❌ Some tests failed")
    elif exit_code == 2:
        print("💥 Test execution error")
    elif exit_code == 130:
        print("⚠️  Test run interrupted")
    else:
        print(f"❓ Unknown exit code: {exit_code}")
    
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
