#!/usr/bin/env python
"""Test script for the Tree-Sitter parser.

This script tests the parser on any source directory.
Set the TEST_SOURCE_DIR environment variable to test with a different repository.
"""
import os
import sys
from pathlib import Path

# Add vibecheck to path
sys.path.insert(0, str(Path(__file__).parent))

from core.parser import CodeParser

# Default test directory - can be overridden via environment variable
DEFAULT_TEST_DIR = Path(__file__).parent.parent / "vibecoded-test-app" / "targets" / "juice-shop-source"
TEST_SOURCE_DIR = Path(os.environ.get("TEST_SOURCE_DIR", DEFAULT_TEST_DIR))


def main():
    """Test the parser on source files."""
    parser = CodeParser()
    
    # Find source directory
    source_dir = TEST_SOURCE_DIR
    
    if not source_dir.exists():
        print(f"Source directory not found: {source_dir}")
        print("Set TEST_SOURCE_DIR environment variable to specify a different directory.")
        return 1
    
    print(f"Source directory: {source_dir}")
    
    # Parse all files in the directory
    print(f"\n=== Parsing directory: {source_dir} ===")
    nodes = parser.parse_directory(source_dir)
    print(f"Total nodes: {len(nodes)}")
    
    # Count by type
    from collections import Counter
    types = Counter(n.node_type for n in nodes)
    for t, count in types.most_common():
        print(f"  {t}: {count}")
    
    # Show first few endpoints
    endpoints = [n for n in nodes if n.node_type == "Endpoint"][:10]
    if endpoints:
        print(f"\nFirst 10 endpoints:")
        for e in endpoints:
            print(f"  {e.name} (line {e.line_start})")
    
    # Show loops
    loops = [n for n in nodes if n.node_type == "Loop"][:5]
    if loops:
        print(f"\nFirst 5 loops:")
        for l in loops:
            print(f"  {l.properties.get('type', 'unknown')} at line {l.line_start} (dynamic={l.properties.get('is_dynamic', False)})")
    
    # Show ORM calls
    orm_calls = [n for n in nodes if n.node_type == "ORMCall"][:5]
    if orm_calls:
        print(f"\nFirst 5 ORM calls:")
        for o in orm_calls:
            print(f"  {o.name} at line {o.line_start}")
    
    # Test specific files if they exist
    test_files = ["server.ts", "app.ts", "index.ts", "main.py", "app.py"]
    for test_file in test_files:
        file_path = source_dir / test_file
        if file_path.exists():
            print(f"\n=== Parsing {test_file} ===")
            file_nodes = parser.parse_file(file_path)
            print(f"Total nodes: {len(file_nodes)}")
            
            file_types = Counter(n.node_type for n in file_nodes)
            for t, count in file_types.most_common():
                print(f"  {t}: {count}")
    
    print("\n=== Parser test complete ===")
    return 0


if __name__ == "__main__":
    sys.exit(main())
