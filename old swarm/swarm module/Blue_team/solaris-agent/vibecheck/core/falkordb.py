"""
FalkorDB client for Project VibeCheck.

FalkorDB is a Redis-compatible graph database that supports Cypher queries.
Used for storing code entities (Functions, Endpoints, Loops, SQLQueries) and their relationships.

Week 2 Updates:
- Uses official falkordb package instead of raw redis-py
- Batch insert with UNWIND queries (one per label)
- Edge creation using Cypher containment detection
- N+1 detection query
"""

import logging
from collections import defaultdict
from typing import Any

from falkordb import FalkorDB

from core.config import get_settings

logger = logging.getLogger(__name__)

# Allowed node types for Cypher queries (security: prevent injection)
ALLOWED_NODE_TYPES = frozenset({
    "Function",
    "Endpoint", 
    "Loop",
    "ORMCall",
    "SQLQuery",
    "Module",
    "Class",
    "Method",
    "Import",
    "Variable",
})


class FalkorDBClient:
    """
    Client for interacting with FalkorDB graph database.

    Uses the official falkordb Python package.
    Each scan gets its own namespaced graph (e.g., 'scan_abc123').
    """

    def __init__(self, url: str | None = None) -> None:
        """
        Initialize FalkorDB client.

        Args:
            url: Redis connection URL (e.g., redis://localhost:6379)
        """
        settings = get_settings()
        self._url = url or settings.falkordb_url
        self._client: FalkorDB | None = None
        self._connected = False

    def connect(self) -> None:
        """Establish connection to FalkorDB."""
        if self._client is None:
            logger.info(f"Connecting to FalkorDB at {self._url}")
            # Parse URL to extract host and port
            # URL format: redis://localhost:6379
            url = self._url.replace("redis://", "")
            if ":" in url:
                host, port_str = url.split(":")
                port = int(port_str)
            else:
                host = url
                port = 6379
            
            self._client = FalkorDB(host=host, port=port)
            self._connected = True
            logger.info("FalkorDB connection established")

    def disconnect(self) -> None:
        """Close connection to FalkorDB."""
        if self._client:
            self._client = None
            self._connected = False
            logger.info("FalkorDB connection closed")

    @property
    def client(self) -> FalkorDB:
        """Get the FalkorDB client, connecting if necessary."""
        if self._client is None:
            self.connect()
        assert self._client is not None
        return self._client

    def ping(self) -> bool:
        """
        Check if FalkorDB connection is healthy.
        
        The FalkorDB client wraps a Redis connection, so we can
        use the underlying Redis client to ping.
        
        Returns:
            True if connection is healthy
        """
        if self._client is None:
            return False
        try:
            # FalkorDB client has a _client attribute that is the Redis connection
            # Try to list graphs as a health check
            self._client.list_graphs()
            return True
        except Exception as e:
            logger.error(f"FalkorDB ping failed: {e}")
            return False

    def create_scan_graph(self, scan_id: str):
        """
        Create/select graph for a scan and create indexes.

        CRITICAL: Create indexes BEFORE any data insert.

        Args:
            scan_id: Unique scan identifier

        Returns:
            Graph object for the scan
        """
        graph_name = f"scan_{scan_id}"
        graph = self.client.select_graph(graph_name)
        
        logger.info(f"Created/selected graph: {graph_name}")
        
        # Create indexes for better query performance
        index_queries = [
            "CREATE INDEX FOR (f:Function) ON (f.file)",
            "CREATE INDEX FOR (l:Loop) ON (l.file)",
            "CREATE INDEX FOR (o:ORMCall) ON (o.file)",
            "CREATE INDEX FOR (e:Endpoint) ON (e.path)",
            "CREATE INDEX FOR (s:SQLQuery) ON (s.file)",
            "CREATE INDEX FOR (m:Module) ON (m.name)",
        ]
        
        for query in index_queries:
            try:
                graph.query(query)
                logger.debug(f"Created index: {query}")
            except Exception as e:
                # Index might already exist
                logger.debug(f"Index creation note: {e}")
        
        return graph

    def add_nodes_batch(self, graph, nodes: list) -> None:
        """
        Batch insert nodes grouped by type.

        CRITICAL: Labels cannot be dynamic in Cypher.
        Group nodes by type and run one UNWIND per label.
        Never use CREATE (n:node.type) - this is invalid!

        Args:
            graph: FalkorDB graph object
            nodes: List of ParsedNode objects
        """
        if not nodes:
            logger.info("No nodes to insert")
            return
        
        # Group nodes by their type
        nodes_by_type: dict[str, list] = defaultdict(list)
        for node in nodes:
            nodes_by_type[node.node_type].append(node)
        
        total_inserted = 0
        
        # Run one UNWIND query per label
        for node_type, typed_nodes in nodes_by_type.items():
            # Security: Validate node_type against allowlist to prevent Cypher injection
            if node_type not in ALLOWED_NODE_TYPES:
                logger.error(f"Invalid node type rejected: {node_type}")
                raise ValueError(f"Invalid node type: {node_type}. Must be one of: {ALLOWED_NODE_TYPES}")
            
            # Prepare node data for Cypher
            node_data = []
            for n in typed_nodes:
                data = n.to_dict()
                # Ensure all values are JSON-serializable
                for key, value in list(data.items()):
                    if value is None:
                        data[key] = "null"
                    elif isinstance(value, (list, dict)):
                        # Convert complex types to JSON string
                        import json
                        data[key] = json.dumps(value)
                node_data.append(data)
            
            # Build UNWIND query - label is static, data is parameterized
            query = f"""
            UNWIND $nodes AS node
            CREATE (n:{node_type})
            SET n += node
            """
            
            try:
                result = graph.query(query, {"nodes": node_data})
                total_inserted += len(typed_nodes)
                logger.debug(f"Inserted {len(typed_nodes)} {node_type} nodes")
            except Exception as e:
                logger.error(f"Failed to insert {node_type} nodes: {e}")
                raise
        
        logger.info(f"Total nodes inserted: {total_inserted}")

    def create_edges(self, graph) -> None:
        """
        Create all edges using Cypher queries for containment detection.

        CRITICAL: Do ALL containment detection inside single Cypher queries,
        not Python nested loops. Use WHERE f.file = l.file AND line range overlap.
        """
        edges_created = 0
        
        # CONTAINS edges: Function -> Loop (using Cypher for containment)
        try:
            result = graph.query("""
                MATCH (f:Function), (l:Loop)
                WHERE f.file = l.file 
                  AND l.line_start >= f.line_start 
                  AND l.line_end <= f.line_end
                CREATE (f)-[:CONTAINS]->(l)
                RETURN count(*) as edges
            """)
            count = result.result_set[0][0] if result.result_set else 0
            edges_created += count
            logger.debug(f"Created {count} Function->Loop CONTAINS edges")
        except Exception as e:
            logger.warning(f"Error creating Function->Loop edges: {e}")
        
        # CONTAINS edges: Loop -> ORMCall (using Cypher for containment)
        try:
            result = graph.query("""
                MATCH (l:Loop), (o:ORMCall)
                WHERE l.file = o.file 
                  AND o.line_start >= l.line_start 
                  AND o.line_end <= l.line_end
                CREATE (l)-[:CONTAINS]->(o)
                RETURN count(*) as edges
            """)
            count = result.result_set[0][0] if result.result_set else 0
            edges_created += count
            logger.debug(f"Created {count} Loop->ORMCall CONTAINS edges")
        except Exception as e:
            logger.warning(f"Error creating Loop->ORMCall edges: {e}")
        
        # CONTAINS edges: Loop -> SQLQuery (using Cypher for containment)
        try:
            result = graph.query("""
                MATCH (l:Loop), (s:SQLQuery)
                WHERE l.file = s.file 
                  AND s.line_start >= l.line_start 
                  AND s.line_end <= l.line_end
                CREATE (l)-[:CONTAINS]->(s)
                RETURN count(*) as edges
            """)
            count = result.result_set[0][0] if result.result_set else 0
            edges_created += count
            logger.debug(f"Created {count} Loop->SQLQuery CONTAINS edges")
        except Exception as e:
            logger.warning(f"Error creating Loop->SQLQuery edges: {e}")
        
        # HAS_ROUTE edges: Endpoint -> Function (match handler name or line overlap)
        try:
            # First, try to match by handler name
            result = graph.query("""
                MATCH (e:Endpoint), (f:Function)
                WHERE e.handler = f.name AND e.file = f.file
                CREATE (e)-[:HAS_ROUTE]->(f)
                RETURN count(*) as edges
            """)
            count = result.result_set[0][0] if result.result_set else 0
            edges_created += count
            logger.debug(f"Created {count} Endpoint->Function HAS_ROUTE edges by handler name")
            
            # Second, match by line overlap (for inline arrow functions)
            # An endpoint's line range overlaps with a function in the same file
            result = graph.query("""
                MATCH (e:Endpoint), (f:Function)
                WHERE e.file = f.file 
                  AND f.line_start >= e.line_start 
                  AND f.line_end <= e.line_end
                  AND NOT (e)-[:HAS_ROUTE]->(f)
                CREATE (e)-[:HAS_ROUTE]->(f)
                RETURN count(*) as edges
            """)
            count2 = result.result_set[0][0] if result.result_set else 0
            edges_created += count2
            logger.debug(f"Created {count2} Endpoint->Function HAS_ROUTE edges by line overlap")
        except Exception as e:
            logger.warning(f"Error creating Endpoint->Function edges: {e}")
        
        # IMPORTS edges: Module -> Module
        try:
            result = graph.query("""
                MATCH (m1:Module), (m2:Module)
                WHERE m1.source = m2.name
                CREATE (m1)-[:IMPORTS]->(m2)
                RETURN count(*) as edges
            """)
            count = result.result_set[0][0] if result.result_set else 0
            edges_created += count
            logger.debug(f"Created {count} Module->Module IMPORTS edges")
        except Exception as e:
            logger.warning(f"Error creating Module->Module edges: {e}")
        
        logger.info(f"Total edges created: {edges_created}")

    def detect_n_plus_1(self, graph) -> list[dict[str, Any]]:
        """
        Run N+1 detection query.

        Finds:
        1. Endpoints that call functions
        2. Those functions contain loops
        3. The loops contain ORM calls
        4. Optionally: The loops are dynamic (iterate over user input)

        Returns:
            List of vulnerability candidates
        """
        logger.info("Running N+1 detection query...")
        
        # Query for N+1 pattern: Endpoint -> Loop -> ORMCall
        # Note: We use CONTAINS relationship which we created earlier
        # Removed strict is_dynamic filter - Tree-Sitter may not detect Sequelize patterns
        query = """
        MATCH (e:Endpoint)-[:HAS_ROUTE]->(f:Function)-[:CONTAINS]->(l:Loop)-[:CONTAINS]->(q:ORMCall)
        RETURN e.path as endpoint_path, 
               e.method as method, 
               l.file as file, 
               l.line_start as line_start, 
               l.line_end as line_end,
               q.method as orm_method, 
               q.model as model,
               f.name as function_name,
               l.is_dynamic as is_dynamic
        """
        
        try:
            result = graph.query(query)
            vulnerabilities = []
            
            if result.result_set:
                # Get column names from result
                columns = [col[0] for col in result.header] if result.header else []
                
                for row in result.result_set:
                    vuln = dict(zip(columns, row))
                    vulnerabilities.append(vuln)
            
            logger.info(f"Found {len(vulnerabilities)} N+1 candidates")
            return vulnerabilities
            
        except Exception as e:
            logger.error(f"N+1 detection query failed: {e}")
            return []

    def execute_query(self, graph, query: str, params: dict | None = None) -> list[dict[str, Any]]:
        """
        Execute a Cypher query on a graph.

        Args:
            graph: FalkorDB graph object
            query: Cypher query string
            params: Optional query parameters

        Returns:
            List of result records as dictionaries
        """
        logger.debug(f"Executing query: {query[:100]}...")
        
        try:
            result = graph.query(query, params or {})
            
            if result.result_set:
                columns = [col[0] for col in result.header] if result.header else []
                return [dict(zip(columns, row)) for row in result.result_set]
            
            return []
            
        except Exception as e:
            logger.error(f"Query execution failed: {e}")
            raise

    def delete_graph(self, graph_name: str) -> None:
        """
        Delete a graph and all its data.

        Args:
            graph_name: Name of the graph to delete
        """
        try:
            # Use the underlying connection to delete
            self.client.connection.execute_command("GRAPH.DELETE", graph_name)
            logger.info(f"Deleted graph: {graph_name}")
        except Exception as e:
            if "not found" not in str(e).lower():
                raise

    def list_graphs(self) -> list[str]:
        """
        List all graphs in the database.

        Returns:
            List of graph names
        """
        try:
            # FalkorDB stores graphs with a specific prefix
            keys = self.client.connection.keys("*")
            # Filter to only graph keys (exclude system keys)
            graphs = [k for k in keys if not k.startswith("_")]
            return graphs
        except Exception as e:
            logger.error(f"Failed to list graphs: {e}")
            return []


# Singleton instance
_client: FalkorDBClient | None = None


def get_falkordb_client() -> FalkorDBClient:
    """Get the FalkorDB client singleton."""
    global _client
    if _client is None:
        _client = FalkorDBClient()
    return _client