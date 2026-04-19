"""
Tree-Sitter based code parser for VibeCheck.

Uses Tree-Sitter v0.24.0 API to parse JavaScript, TypeScript, and Python files
and extract code entities for vulnerability analysis.

Node types extracted:
- Functions: function_declaration, arrow_function, method_definition
- Express routes: call_expression with app.get/post/put/delete/patch/use
- Loops: for_statement, while_statement, for_in_statement
- ORM calls: .find(), .findAll(), .where(), .query()
- SQL template literals: tagged_template_expression with SQL keywords
- Requires/imports: import_statement, call_expression (require)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import tree_sitter_javascript as tsjs
import tree_sitter_typescript as tstypes
import tree_sitter_python as tspy
from tree_sitter import Language, Parser, Node, Tree

logger = logging.getLogger(__name__)


# Tree-Sitter queries for extracting nodes

# Express route detection query
# Captures: @obj (router object), @method (HTTP method), @route_path, @handler
# TypeScript AST structure:
# call_expression
#   [0] member_expression: app.get
#         [0] identifier: app
#         [1] .: .
#         [2] property_identifier: get
#   [1] arguments: (...)
#         [0] string/array: route path
#         [1+] handlers
ROUTE_QUERY = """
(call_expression
  function: (member_expression
    object: (identifier) @obj
    property: (property_identifier) @method
    (#match? @method "^(get|post|put|delete|patch|use)$"))
  arguments: (arguments
    [(string) @route_path
     (array) @route_paths]
    [(identifier) @handler
     (arrow_function) @handler
     (function_expression) @handler])) @call
"""

# ORM call detection query
# Matches: .find(), .findAll(), .findOne(), .findByPk(), .findById(), etc.
ORM_CALL_QUERY = """
(call_expression
  function: (member_expression
    property: (property_identifier) @method
    (#match? @method "^(find|findAll|findOne|findByPk|findById|save|create|update|destroy)$"))
  arguments: (arguments) @args)
"""

# SQL template literal detection - disabled due to tree-sitter query limitations
# We'll detect SQL patterns in call expressions instead
SQL_TEMPLATE_QUERY = None  # Will use manual detection in _extract_sql_queries


@dataclass
class ParsedNode:
    """Represents a parsed code entity."""
    
    node_type: str  # Function, Endpoint, Loop, ORMCall, SQLQuery, Module
    name: str | None
    file_path: str
    line_start: int
    line_end: int
    properties: dict[str, Any] = field(default_factory=dict)
    source_code: str | None = None
    
    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for FalkorDB insertion."""
        return {
            "name": self.name,
            "file": self.file_path,
            "line_start": self.line_start,
            "line_end": self.line_end,
            **self.properties,
        }


class CodeParser:
    """Tree-Sitter based code parser."""
    
    # File size limit (1MB) to prevent memory issues
    MAX_FILE_SIZE = 1_048_576
    
    # Supported extensions and their parsers
    EXTENSION_MAP = {
        ".js": "javascript",
        ".jsx": "javascript",
        ".ts": "typescript",
        ".tsx": "typescript",
        ".py": "python",
    }
    
    def __init__(self):
        """Initialize parsers for all supported languages."""
        # JavaScript parser (v0.24.0 API)
        self.js_language = Language(tsjs.language())
        self.js_parser = Parser(self.js_language)
        
        # TypeScript parser
        self.ts_language = Language(tstypes.language_typescript())
        self.ts_parser = Parser(self.ts_language)
        
        # Python parser
        self.py_language = Language(tspy.language())
        self.py_parser = Parser(self.py_language)
        
        # Compile queries for JavaScript
        self._js_route_query = self.js_language.query(ROUTE_QUERY)
        self._js_orm_query = self.js_language.query(ORM_CALL_QUERY)
        # SQL template detection done manually in _extract_sql_queries
        
        # Compile queries for TypeScript
        self._ts_route_query = self.ts_language.query(ROUTE_QUERY)
        self._ts_orm_query = self.ts_language.query(ORM_CALL_QUERY)
        # SQL template detection done manually in _extract_sql_queries
        
        logger.info("CodeParser initialized with JavaScript, TypeScript, Python support")
    
    def parse_file(self, file_path: Path) -> list[ParsedNode]:
        """Parse a single file and extract all nodes.
        
        Args:
            file_path: Path to the file to parse
            
        Returns:
            List of ParsedNode objects representing code entities
        """
        file_path = Path(file_path)
        
        # Check file size
        if file_path.stat().st_size > self.MAX_FILE_SIZE:
            logger.warning(f"File too large, skipping: {file_path}")
            return []
        
        # Determine language from extension
        ext = file_path.suffix.lower()
        if ext not in self.EXTENSION_MAP:
            logger.debug(f"Unsupported extension: {ext}")
            return []
        
        language = self.EXTENSION_MAP[ext]
        
        # Read file content
        try:
            source = file_path.read_bytes()
        except Exception as e:
            logger.error(f"Failed to read file {file_path}: {e}")
            return []
        
        # Parse with appropriate parser
        if language == "javascript":
            tree = self.js_parser.parse(source)
            return self._parse_js_ts(tree, source, str(file_path), is_typescript=False)
        elif language == "typescript":
            tree = self.ts_parser.parse(source)
            return self._parse_js_ts(tree, source, str(file_path), is_typescript=True)
        elif language == "python":
            tree = self.py_parser.parse(source)
            return self._parse_python(tree, source, str(file_path))
        
        return []
    
    def parse_directory(
        self,
        dir_path: Path,
        extensions: list[str] | None = None,
        exclude_patterns: list[str] | None = None,
    ) -> list[ParsedNode]:
        """Parse all files in a directory.
        
        Args:
            dir_path: Path to the directory
            extensions: File extensions to include (default: all supported)
            exclude_patterns: Glob patterns to exclude (e.g., ['node_modules', '*.test.js'])
            
        Returns:
            List of ParsedNode objects from all parsed files
        """
        dir_path = Path(dir_path)
        
        if extensions is None:
            extensions = list(self.EXTENSION_MAP.keys())
        
        if exclude_patterns is None:
            exclude_patterns = ["node_modules", ".git", "__pycache__", "dist", "build"]
        
        all_nodes: list[ParsedNode] = []
        file_count = 0
        
        # Walk directory
        for file_path in dir_path.rglob("*"):
            # Skip excluded patterns
            if any(pattern in str(file_path) for pattern in exclude_patterns):
                continue
            
            # Check extension
            if file_path.suffix.lower() not in extensions:
                continue
            
            # Skip directories
            if not file_path.is_file():
                continue
            
            # Parse file
            nodes = self.parse_file(file_path)
            all_nodes.extend(nodes)
            file_count += 1
            
            # Log progress every 100 files
            if file_count % 100 == 0:
                logger.info(f"Parsed {file_count} files, {len(all_nodes)} nodes extracted")
        
        logger.info(f"Completed: {file_count} files, {len(all_nodes)} nodes")
        return all_nodes
    
    def _parse_js_ts(
        self,
        tree: Tree,
        source: bytes,
        file_path: str,
        is_typescript: bool = False,
    ) -> list[ParsedNode]:
        """Parse JavaScript/TypeScript file.
        
        Args:
            tree: Tree-sitter parse tree
            source: Source code bytes
            file_path: File path string
            is_typescript: Whether this is TypeScript
            
        Returns:
            List of ParsedNode objects
        """
        nodes: list[ParsedNode] = []
        root = tree.root_node
        
        # Select appropriate queries
        if is_typescript:
            route_query = self._ts_route_query
            orm_query = self._ts_orm_query
        else:
            route_query = self._js_route_query
            orm_query = self._js_orm_query
        # SQL queries use manual detection, no query object needed
        sql_query = None
        
        # Select appropriate language for queries
        language = self.ts_language if is_typescript else self.js_language
        
        # Extract functions
        nodes.extend(self._extract_functions(root, source, file_path, language))
        
        # Extract endpoints (Express routes)
        nodes.extend(self._extract_endpoints(root, source, file_path, route_query))
        
        # Extract loops
        nodes.extend(self._extract_loops(root, source, file_path, language))
        
        # Extract ORM calls
        nodes.extend(self._extract_orm_calls(root, source, file_path, orm_query))
        
        # Extract SQL queries
        nodes.extend(self._extract_sql_queries(root, source, file_path, sql_query))
        
        # Extract imports
        nodes.extend(self._extract_imports(root, source, file_path, language))
        
        return nodes
    
    def _parse_python(
        self,
        tree: Tree,
        source: bytes,
        file_path: str,
    ) -> list[ParsedNode]:
        """Parse Python file.
        
        Args:
            tree: Tree-sitter parse tree
            source: Source code bytes
            file_path: File path string
            
        Returns:
            List of ParsedNode objects
        """
        nodes: list[ParsedNode] = []
        root = tree.root_node
        
        # Extract function definitions
        nodes.extend(self._extract_py_functions(root, source, file_path))
        
        # Extract class definitions (as potential models)
        nodes.extend(self._extract_py_classes(root, source, file_path))
        
        # Extract imports
        nodes.extend(self._extract_py_imports(root, source, file_path))
        
        # Extract loops
        nodes.extend(self._extract_py_loops(root, source, file_path))
        
        return nodes
    
    def _extract_functions(
        self,
        root: Node,
        source: bytes,
        file_path: str,
        language: Language,
    ) -> list[ParsedNode]:
        """Extract function declarations, arrow functions, and methods."""
        nodes: list[ParsedNode] = []
        
        # Query for function declarations
        query = language.query("""
            [
                (function_declaration
                    name: (identifier) @name)
                (method_definition
                    name: (property_identifier) @name)
                (variable_declarator
                    name: (identifier) @name
                    value: (arrow_function))
            ]
        """)
        
        captures = query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            if capture_name != "name":
                continue
            for node in capture_nodes:
                func_node = node.parent
                if func_node is None:
                    continue
                
                # Get function name
                name = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                
                # Check if async
                is_async = False
                if func_node.children:
                    for child in func_node.children:
                        if child.type == "async":
                            is_async = True
                            break
                
                # Get parameters
                params = self._extract_params(func_node, source)
                
                nodes.append(ParsedNode(
                    node_type="Function",
                    name=name,
                    file_path=file_path,
                    line_start=func_node.start_point[0] + 1,
                    line_end=func_node.end_point[0] + 1,
                    properties={
                        "is_async": is_async,
                        "params": params,
                    },
                ))
        
        return nodes
    
    def _extract_params(self, func_node: Node, source: bytes) -> list[str]:
        """Extract parameter names from a function node."""
        params: list[str] = []
        
        for child in func_node.children:
            if child.type == "parameters":
                for param in child.children:
                    if param.type == "identifier":
                        params.append(source[param.start_byte:param.end_byte].decode("utf-8", errors="replace"))
                    elif param.type == "required_parameter":
                        # TypeScript: param: type
                        for p in param.children:
                            if p.type == "identifier":
                                params.append(source[p.start_byte:p.end_byte].decode("utf-8", errors="replace"))
                                break
        
        return params
    
    def _extract_endpoints(
        self,
        root: Node,
        source: bytes,
        file_path: str,
        query,
    ) -> list[ParsedNode]:
        """Extract Express route definitions."""
        nodes: list[ParsedNode] = []
        
        captures = query.captures(root)
        
        # Group captures by call_expression node
        # Use start_byte as unique identifier since id() can vary for same logical node
        call_nodes: dict[int, dict[str, Node]] = {}
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                # The @call capture IS the call_expression itself
                if capture_name == "call":
                    call_node = node
                    # Use start_byte as unique identifier for this AST node
                    call_id = call_node.start_byte
                    if call_id not in call_nodes:
                        call_nodes[call_id] = {"node": call_node}
                    continue
                
                # For other captures, find the parent call_expression
                # Since captures are nested within the call_expression, walk up
                call_node = node
                while call_node and call_node.type != "call_expression":
                    call_node = call_node.parent
                
                if call_node is None:
                    continue
                
                # Use start_byte as unique identifier
                call_id = call_node.start_byte
                if call_id not in call_nodes:
                    call_nodes[call_id] = {"node": call_node}
                
                call_nodes[call_id][capture_name] = node
        
        # Process each call_expression
        # Router objects to include (Express routers and app)
        ROUTER_OBJECTS = {"app", "router", "route", "api", "server"}
        
        for call_data in call_nodes.values():
            if "method" not in call_data:
                continue
            
            # Check for route_path (string) or route_paths (array)
            if "route_path" not in call_data and "route_paths" not in call_data:
                continue
            
            # Filter by object name to exclude false positives like config.get()
            if "obj" in call_data:
                obj_name = source[call_data["obj"].start_byte:call_data["obj"].end_byte].decode("utf-8", errors="replace")
                # Only include known router objects or objects that look like routers
                # (starts with lowercase, not common utility objects)
                if obj_name.lower() in {"config", "console", "fs", "path", "util", "crypto", "http", "https", "url", "querystring", "os", "buffer", "stream", "events", "child_process"}:
                    continue
                # Include if it's a known router object or looks like one
                if obj_name not in ROUTER_OBJECTS and not obj_name.endswith("Router") and not obj_name.endswith("Route"):
                    # Skip if it doesn't look like a router (e.g., config.get, cache.get)
                    # But allow through if it has a path-like string argument
                    if "route_path" in call_data:
                        path = source[call_data["route_path"].start_byte:call_data["route_path"].end_byte].decode("utf-8", errors="replace")
                        # Skip if the "path" doesn't look like a route (doesn't start with /)
                        if not path.strip("\"'").startswith("/"):
                            continue
            
            call_node = call_data["node"]
            method = source[call_data["method"].start_byte:call_data["method"].end_byte].decode("utf-8", errors="replace").upper()
            
            # Extract handler name if present
            handler_name = None
            if "handler" in call_data:
                handler_node = call_data["handler"]
                if handler_node.type == "identifier":
                    handler_name = source[handler_node.start_byte:handler_node.end_byte].decode("utf-8", errors="replace")
                elif handler_node.type == "arrow_function":
                    # Arrow function - check if it has a name in variable assignment
                    # e.g., const handler = (req, res) => {...}
                    handler_name = None  # Anonymous arrow function
                elif handler_node.type == "function_expression":
                    # Named function expression
                    for child in handler_node.children:
                        if child.type == "identifier":
                            handler_name = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
                            break
            
            # Handle single path (string)
            if "route_path" in call_data:
                path = source[call_data["route_path"].start_byte:call_data["route_path"].end_byte].decode("utf-8", errors="replace")
                path = path.strip("\"'")
                
                nodes.append(ParsedNode(
                    node_type="Endpoint",
                    name=f"{method} {path}",
                    file_path=file_path,
                    line_start=call_node.start_point[0] + 1,
                    line_end=call_node.end_point[0] + 1,
                    properties={
                        "method": method,
                        "path": path,
                        "handler": handler_name,
                    },
                ))
            
            # Handle multiple paths (array)
            elif "route_paths" in call_data:
                array_node = call_data["route_paths"]
                # Extract each string from the array
                for child in array_node.children:
                    if child.type == "string":
                        path = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
                        path = path.strip("\"'")
                        
                        nodes.append(ParsedNode(
                            node_type="Endpoint",
                            name=f"{method} {path}",
                            file_path=file_path,
                            line_start=call_node.start_point[0] + 1,
                            line_end=call_node.end_point[0] + 1,
                            properties={
                                "method": method,
                                "path": path,
                                "handler": handler_name,
                            },
                        ))
        
        return nodes
    
    def _extract_loops(
        self,
        root: Node,
        source: bytes,
        file_path: str,
        language: Language,
    ) -> list[ParsedNode]:
        """Extract for/while loops."""
        nodes: list[ParsedNode] = []
        
        # Note: for_in_statement covers both for...in and for...of loops in tree-sitter JS grammar
        # IMPORTANT: Each pattern MUST have @loop capture name - captures() ignores uncaptured nodes
        query = language.query("""
            [
                (for_statement) @loop
                (while_statement) @loop
                (for_in_statement) @loop
            ]
        """)
        
        captures = query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        # For this query, there's no capture name, so we iterate over all nodes
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                # Determine if loop is dynamic (iterates over variable)
                is_dynamic = self._is_dynamic_loop(node, source)
                
                # Get iterator variable
                iterator_var = self._get_loop_iterator(node, source)
                
                nodes.append(ParsedNode(
                    node_type="Loop",
                    name=None,
                    file_path=file_path,
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    properties={
                        "type": node.type,
                        "is_dynamic": is_dynamic,
                        "iterator_var": iterator_var,
                    },
                ))
        
        return nodes
    
    def _is_dynamic_loop(self, node: Node, source: bytes) -> bool:
        """Determine if a loop iterates over dynamic data (user input)."""
        # Check for patterns like:
        # - for (const x of req.body.items)
        # - for (const x of req.query.ids)
        # - for (const x in data) where data comes from request
        
        # The node itself is the loop statement (for_statement, for_in_statement, while_statement)
        # For for_in_statement, we need to find the iterable expression
        if node.type == "for_in_statement":
            # for_in_statement structure: left side (iterator), right side (iterable)
            # Children typically: ["for", "(", variable_declarator/identifier, "in"/"of", expression, ")"]
            for child in node.children:
                # Look for the iterable expression (right side of in/of)
                if child.type in ["member_expression", "call_expression", "identifier"]:
                    expr_text = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
                    # Check if it references request data
                    if "req." in expr_text or "request." in expr_text:
                        return True
                    if ".body" in expr_text or ".query" in expr_text or ".params" in expr_text:
                        return True
        
        # For regular for_statement, check the condition
        elif node.type == "for_statement":
            # Walk through all children looking for member expressions
            def walk_for_expr(n: Node):
                if n.type == "member_expression":
                    expr_text = source[n.start_byte:n.end_byte].decode("utf-8", errors="replace")
                    if "req." in expr_text or "request." in expr_text:
                        return True
                    if ".body" in expr_text or ".query" in expr_text or ".params" in expr_text:
                        return True
                for c in n.children:
                    if walk_for_expr(c):
                        return True
                return False
            
            if walk_for_expr(node):
                return True
        
        return False
    
    def _get_loop_iterator(self, node: Node, source: bytes) -> str | None:
        """Get the iterator variable name from a loop."""
        for child in node.children:
            if child.type == "variable_declarator":
                for subchild in child.children:
                    if subchild.type == "identifier":
                        return source[subchild.start_byte:subchild.end_byte].decode("utf-8", errors="replace")
            elif child.type == "identifier":
                # for (x in ...)
                return source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
        
        return None
    
    def _extract_orm_calls(
        self,
        root: Node,
        source: bytes,
        file_path: str,
        query,
    ) -> list[ParsedNode]:
        """Extract ORM method calls (Sequelize/Mongoose patterns)."""
        nodes: list[ParsedNode] = []
        
        captures = query.captures(root)
        
        # Group captures by call_expression
        call_nodes: dict[int, dict[str, Node]] = {}
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                call_node = node
                while call_node and call_node.type != "call_expression":
                    call_node = call_node.parent
                
                if call_node is None:
                    continue
                
                call_id = id(call_node)
                if call_id not in call_nodes:
                    call_nodes[call_id] = {"node": call_node}
                
                call_nodes[call_id][capture_name] = node
        
        # Process each call_expression
        for call_data in call_nodes.values():
            if "method" not in call_data:
                continue
            
            call_node = call_data["node"]
            method = source[call_data["method"].start_byte:call_data["method"].end_byte].decode("utf-8", errors="replace")
            
            # Try to get the model name (object on which method is called)
            # call_node.children[0] is the function part (member_expression for Model.find())
            # member_expression.children[0] is the model identifier
            model = None
            if call_node.children:
                func_child = call_node.children[0]
                if func_child.type == "member_expression" and func_child.children:
                    obj_node = func_child.children[0]
                    if obj_node.type == "identifier":
                        model = source[obj_node.start_byte:obj_node.end_byte].decode("utf-8", errors="replace")
            
            # Check if has where clause
            has_where = False
            if "args" in call_data:
                args_text = source[call_data["args"].start_byte:call_data["args"].end_byte].decode("utf-8", errors="replace")
                has_where = "where" in args_text
            
            nodes.append(ParsedNode(
                node_type="ORMCall",
                name=f"{model}.{method}()" if model else f"{method}()",
                file_path=file_path,
                line_start=call_node.start_point[0] + 1,
                line_end=call_node.end_point[0] + 1,
                properties={
                    "method": method,
                    "model": model,
                    "has_where": has_where,
                },
            ))
        
        return nodes
    
    def _extract_sql_queries(
        self,
        root: Node,
        source: bytes,
        file_path: str,
        query,  # Not used, kept for signature compatibility
    ) -> list[ParsedNode]:
        """Extract SQL template literals by walking the tree manually."""
        nodes: list[ParsedNode] = []
        
        # Walk the tree to find call expressions that might be SQL queries
        def walk(node: Node):
            # Check for call expressions with SQL-like patterns
            if node.type == "call_expression":
                # Get the function name
                for child in node.children:
                    if child.type == "function":
                        func_text = source[child.start_byte:child.end_byte].decode("utf-8", errors="replace")
                        # Check for SQL-related function calls
                        if any(sql_kw in func_text.upper() for sql_kw in ["SQL", "QUERY", "EXECUTE", "RAW"]):
                            # Get arguments
                            for arg in node.children:
                                if arg.type == "arguments":
                                    arg_text = source[arg.start_byte:arg.end_byte].decode("utf-8", errors="replace")
                                    nodes.append(ParsedNode(
                                        node_type="SQLQuery",
                                        name=None,
                                        file_path=file_path,
                                        line_start=node.start_point[0] + 1,
                                        line_end=node.end_point[0] + 1,
                                        properties={
                                            "query": arg_text[:500],  # Truncate long queries
                                        },
                                    ))
                                    break
            
            # Check for template strings with SQL keywords
            if node.type == "template_string":
                template_text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                # Check if it looks like SQL
                sql_keywords = ["SELECT", "INSERT", "UPDATE", "DELETE", "FROM", "WHERE", "JOIN"]
                if any(kw in template_text.upper() for kw in sql_keywords):
                    # Only add if not already captured as part of a call expression
                    parent = node.parent
                    if parent and parent.type != "call_expression":
                        nodes.append(ParsedNode(
                            node_type="SQLQuery",
                            name=None,
                            file_path=file_path,
                            line_start=node.start_point[0] + 1,
                            line_end=node.end_point[0] + 1,
                            properties={
                                "query": template_text[:500],
                            },
                        ))
            
            # Recurse into children
            for child in node.children:
                walk(child)
        
        walk(root)
        return nodes
    
    def _extract_imports(
        self,
        root: Node,
        source: bytes,
        file_path: str,
        language: Language,
    ) -> list[ParsedNode]:
        """Extract import/require statements."""
        nodes: list[ParsedNode] = []
        
        # ES6 imports
        import_query = language.query("""
            (import_statement
                source: (string) @source)
        """)
        
        captures = import_query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                import_node = node.parent
                if import_node is None:
                    continue
                
                source_text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                source_text = source_text.strip("\"'")
                
                nodes.append(ParsedNode(
                    node_type="Module",
                    name=source_text,
                    file_path=file_path,
                    line_start=import_node.start_point[0] + 1,
                    line_end=import_node.end_point[0] + 1,
                    properties={
                        "source": source_text,
                        "type": "import",
                    },
                ))
        
        # CommonJS requires
        require_query = language.query("""
            (call_expression
                function: (identifier) @fn
                (#eq? @fn "require")
                arguments: (arguments (string) @source))
        """)
        
        captures = require_query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            if capture_name == "source":
                for node in capture_nodes:
                    call_node = node.parent
                    if call_node is None:
                        continue
                    
                    while call_node and call_node.type != "call_expression":
                        call_node = call_node.parent
                    
                    if call_node is None:
                        continue
                    
                    source_text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                    source_text = source_text.strip("\"'")
                    
                    nodes.append(ParsedNode(
                        node_type="Module",
                        name=source_text,
                        file_path=file_path,
                        line_start=call_node.start_point[0] + 1,
                        line_end=call_node.end_point[0] + 1,
                        properties={
                            "source": source_text,
                            "type": "require",
                        },
                    ))
        
        return nodes
    
    def _extract_py_functions(
        self,
        root: Node,
        source: bytes,
        file_path: str,
    ) -> list[ParsedNode]:
        """Extract Python function definitions."""
        nodes: list[ParsedNode] = []
        
        query = self.py_language.query("""
            (function_definition
                name: (identifier) @name)
        """)
        
        captures = query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                func_node = node.parent
                if func_node is None:
                    continue
                
                name = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                
                # Check if async
                is_async = False
                if func_node.children:
                    for child in func_node.children:
                        if child.type == "async":
                            is_async = True
                            break
                
                nodes.append(ParsedNode(
                    node_type="Function",
                    name=name,
                    file_path=file_path,
                    line_start=func_node.start_point[0] + 1,
                    line_end=func_node.end_point[0] + 1,
                    properties={
                        "is_async": is_async,
                    },
                ))
        
        return nodes
    
    def _extract_py_classes(
        self,
        root: Node,
        source: bytes,
        file_path: str,
    ) -> list[ParsedNode]:
        """Extract Python class definitions (potential ORM models)."""
        nodes: list[ParsedNode] = []
        
        query = self.py_language.query("""
            (class_definition
                name: (identifier) @name)
        """)
        
        captures = query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                class_node = node.parent
                if class_node is None:
                    continue
                
                name = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                
                nodes.append(ParsedNode(
                    node_type="Module",
                    name=name,
                    file_path=file_path,
                    line_start=class_node.start_point[0] + 1,
                    line_end=class_node.end_point[0] + 1,
                    properties={
                        "type": "class",
                    },
                ))
        
        return nodes
    
    def _extract_py_imports(
        self,
        root: Node,
        source: bytes,
        file_path: str,
    ) -> list[ParsedNode]:
        """Extract Python import statements."""
        nodes: list[ParsedNode] = []
        
        query = self.py_language.query("""
            [
                (import_statement)
                (import_from_statement)
            ]
        """)
        
        captures = query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                # Get the imported module name
                import_text = source[node.start_byte:node.end_byte].decode("utf-8", errors="replace")
                
                # Extract module name
                match = re.search(r'(?:from\s+(\S+)\s+)?import\s+(\S+)', import_text)
                if match:
                    module = match.group(1) or match.group(2)
                    module = module.strip("\"'")
                    
                    nodes.append(ParsedNode(
                        node_type="Module",
                        name=module,
                        file_path=file_path,
                        line_start=node.start_point[0] + 1,
                        line_end=node.end_point[0] + 1,
                        properties={
                            "source": module,
                            "type": "import",
                        },
                    ))
        
        return nodes
    
    def _extract_py_loops(
        self,
        root: Node,
        source: bytes,
        file_path: str,
    ) -> list[ParsedNode]:
        """Extract Python for/while loops."""
        nodes: list[ParsedNode] = []
        
        # IMPORTANT: Each pattern MUST have @loop capture name - captures() ignores uncaptured nodes
        query = self.py_language.query("""
            [
                (for_statement) @loop
                (while_statement) @loop
            ]
        """)
        
        captures = query.captures(root)
        
        # tree-sitter v0.24 returns dict: {capture_name: [nodes]}
        for capture_name, capture_nodes in captures.items():
            for node in capture_nodes:
                nodes.append(ParsedNode(
                    node_type="Loop",
                    name=None,
                    file_path=file_path,
                    line_start=node.start_point[0] + 1,
                    line_end=node.end_point[0] + 1,
                    properties={
                        "type": node.type,
                        "is_dynamic": True,  # Assume dynamic for Python
                    },
                ))
        
        return nodes


# Convenience function for quick parsing
def parse_code(path: str | Path) -> list[ParsedNode]:
    """Parse a file or directory and return extracted nodes.
    
    Args:
        path: Path to file or directory
        
    Returns:
        List of ParsedNode objects
    """
    parser = CodeParser()
    path = Path(path)
    
    if path.is_file():
        return parser.parse_file(path)
    elif path.is_dir():
        return parser.parse_directory(path)
    else:
        raise ValueError(f"Path does not exist: {path}")