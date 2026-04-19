"""Analyze source code AST to understand route patterns.

This is a development/debugging utility for understanding Tree-Sitter AST structure.
Set the ANALYZE_FILE environment variable to analyze a different file.
"""
import os
import sys
from pathlib import Path

import tree_sitter_python
import tree_sitter_javascript
import tree_sitter_typescript
from tree_sitter import Language, Parser, Node

# Default file to analyze - can be overridden via environment variable
DEFAULT_FILE = Path(__file__).parent.parent / "vibecoded-test-app" / "targets" / "juice-shop-source" / "server.ts"
ANALYZE_FILE = Path(os.environ.get("ANALYZE_FILE", DEFAULT_FILE))

# Read source file
if not ANALYZE_FILE.exists():
    print(f"File not found: {ANALYZE_FILE}")
    print("Set ANALYZE_FILE environment variable to specify a file to analyze.")
    sys.exit(1)

with open(ANALYZE_FILE, "rb") as f:
    source = f.read()

# Parse with appropriate language based on file extension
PY_LANGUAGE = Language(tree_sitter_python.language())
JS_LANGUAGE = Language(tree_sitter_javascript.language())
TS_LANGUAGE = Language(tree_sitter_typescript.language_typescript())

# Select parser based on file extension
ext = ANALYZE_FILE.suffix.lower()
if ext == ".py":
    parser = Parser(PY_LANGUAGE)
elif ext in [".ts", ".tsx"]:
    parser = Parser(TS_LANGUAGE)
else:
    parser = Parser(JS_LANGUAGE)

tree = parser.parse(source)
root = tree.root_node

print(f"Analyzing: {ANALYZE_FILE}")
print(f"Root: {root.type}, children: {len(root.children)}")

# Look for route patterns - app.get, app.post, router.get, etc.
# First, let's find all call expressions and see their structure

def walk(node: Node, depth: int = 0):
    indent = "  " * depth
    if depth > 4:  # Limit depth
        return
    
    # Show call expressions with their function names
    if node.type == "call_expression":
        func_text = source[node.children[0].start_byte:node.children[0].end_byte].decode("utf-8", errors="replace")[:80]
        print(f"{indent}{node.type}: {func_text}")
        
        # Show children structure
        for i, child in enumerate(node.children):
            child_text = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")[:50]
            print(f"{indent}  [{i}] {child.type}: {child_text}...")
    elif node.type in ["member_expression", "identifier", "arguments"]:
        text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")[:80]
        print(f"{indent}{node.type}: {text}")
    
    for child in node.children:
        walk(child, depth + 1)

# Find specific route patterns
print("\n=== Looking for route patterns (app.get, app.post, etc.) ===\n")

# Look for member expressions that look like routes
def find_routes(node: Node):
    if node.type == "call_expression":
        # Get the function part
        func_node = node.children[0] if node.children else None
        if func_node:
            func_text = source[func_node.start_byte:func_node.end_byte].decode("utf-8", errors="replace")
            
            # Check for route patterns
            route_patterns = ["app.get", "app.post", "app.put", "app.delete", "app.patch", 
                            "router.get", "router.post", "router.put", "router.delete", "router.patch",
                            ".get(", ".post(", ".put(", ".delete(", ".patch("]
            
            if any(p in func_text for p in route_patterns):
                print(f"\nRoute found: {func_text[:100]}")
                print(f"  Line: {node.start_point[0] + 1}")
                print(f"  Children:")
                for i, child in enumerate(node.children):
                    print(f"    [{i}] {child.type}")
                    if child.type == "arguments":
                        for j, arg in enumerate(child.children):
                            arg_text = source[arg.start_byte:arg.end_byte].decode("utf-8", errors="replace")[:60]
                            print(f"      [{j}] {arg.type}: {arg_text}...")
    
    for child in node.children:
        find_routes(child)

find_routes(root)

# Also look for the exact structure of member expressions
print("\n\n=== Member expression structure ===\n")

def find_member_expr(node: Node, depth=0):
    if depth > 10:
        return
        
    if node.type == "member_expression":
        text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
        if any(x in text for x in ["app.get", "app.post", "router"]):
            print(f"\nMember expression: {text[:80]}")
            print(f"  Children:")
            for i, child in enumerate(node.children):
                child_text = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")[:50]
                print(f"    [{i}] {child.type}: {child_text}")
    
    for child in node.children:
        find_member_expr(child, depth + 1)

find_member_expr(root)
