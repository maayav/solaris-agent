"""
FalkorDB client for Red Team structural graph storage.
Stores kill chains, attack paths, and discovered assets.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import Any

logger = logging.getLogger(__name__)

# Optional FalkorDB import
try:
    import redis
    from redis.commands.graph import Node, Edge
    HAS_FALKORDB = True
except ImportError:
    HAS_FALKORDB = False
    logger.warning("redis package not installed - FalkorDB integration disabled")


class FalkorDBClient:
    """
    FalkorDB client for Red Team structural analysis.
    Stores attack graphs with nodes (assets, vulnerabilities) and edges (attack paths).
    """
    
    def __init__(self, host: str = "localhost", port: int = 6379):
        self._host = host
        self._port = port
        self._client = None
        self._enabled = False
        
        if HAS_FALKORDB:
            try:
                self._client = redis.Redis(host=host, port=port, decode_responses=True)
                self._client.ping()
                self._enabled = True
                logger.info(f"FalkorDB connected at {host}:{port}")
            except Exception as e:
                logger.error(f"Failed to connect to FalkorDB: {e}")
        else:
            logger.warning("FalkorDB not available - using fallback")
    
    def _get_graph(self, mission_id: str):
        """Get or create a graph for the mission."""
        if not self._enabled:
            return None
        graph_name = f"redteam_mission_{mission_id}"
        return self._client.graph(graph_name)
    
    async def create_attack_graph(self, mission_id: str, target: str) -> bool:
        """
        Initialize attack graph for a mission.
        
        Args:
            mission_id: Unique mission identifier
            target: Target URL/hostname
        """
        if not self._enabled:
            return False
        
        try:
            loop = asyncio.get_event_loop()
            graph = self._get_graph(mission_id)
            
            # Create target node
            query = """
            CREATE (t:Target {
                url: $url,
                created_at: $created_at,
                status: 'active'
            })
            RETURN t
            """
            
            await loop.run_in_executor(
                None,
                lambda: graph.query(
                    query,
                    {'url': target, 'created_at': datetime.utcnow().isoformat()}
                )
            )
            
            logger.info(f"Created attack graph for mission {mission_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to create attack graph: {e}")
            return False
    
    async def add_asset(
        self,
        mission_id: str,
        asset_type: str,  # endpoint, service, credential, vulnerability
        identifier: str,  # URL, IP:port, username, CVE
        properties: dict[str, Any] | None = None,
    ) -> bool:
        """
        Add discovered asset to the attack graph.
        
        Args:
            mission_id: Mission identifier
            asset_type: Type of asset discovered
            identifier: Unique identifier for the asset
            properties: Additional properties (ports, versions, etc.)
        """
        if not self._enabled:
            return False
        
        try:
            loop = asyncio.get_event_loop()
            graph = self._get_graph(mission_id)
            
            props = properties or {}
            props['identifier'] = identifier
            props['discovered_at'] = datetime.utcnow().isoformat()
            
            # Convert props to Cypher parameters
            props_str = ', '.join([f"{k}: ${k}" for k in props.keys()])
            
            query = f"""
            MATCH (t:Target)
            CREATE (a:{asset_type} {{{props_str}}})
            CREATE (t)-[:HAS]->(a)
            RETURN a
            """
            
            await loop.run_in_executor(
                None,
                lambda: graph.query(query, props)
            )
            
            logger.debug(f"Added {asset_type} asset: {identifier}")
            return True
        except Exception as e:
            logger.error(f"Failed to add asset: {e}")
            return False
    
    async def add_attack_path(
        self,
        mission_id: str,
        from_asset: str,
        to_asset: str,
        technique: str,  # exploit_type
        success: bool,
        evidence: str | None = None,
    ) -> bool:
        """
        Add an attack path (edge) between two assets.
        
        Args:
            mission_id: Mission identifier
            from_asset: Source asset identifier
            to_asset: Target asset identifier
            technique: Attack technique used
            success: Whether the attack succeeded
            evidence: Proof/evidence of the attack
        """
        if not self._enabled:
            return False
        
        try:
            loop = asyncio.get_event_loop()
            graph = self._get_graph(mission_id)
            
            query = """
            MATCH (a {identifier: $from_asset})
            MATCH (b {identifier: $to_asset})
            CREATE (a)-[r:ATTACKS {
                technique: $technique,
                success: $success,
                evidence: $evidence,
                timestamp: $timestamp
            }]->(b)
            RETURN r
            """
            
            params = {
                'from_asset': from_asset,
                'to_asset': to_asset,
                'technique': technique,
                'success': success,
                'evidence': evidence or '',
                'timestamp': datetime.utcnow().isoformat(),
            }
            
            await loop.run_in_executor(
                None,
                lambda: graph.query(query, params)
            )
            
            logger.debug(f"Added attack path: {from_asset} -> {to_asset}")
            return True
        except Exception as e:
            logger.error(f"Failed to add attack path: {e}")
            return False
    
    async def query_attack_paths(
        self,
        mission_id: str,
        from_target: str | None = None,
        successful_only: bool = True,
    ) -> list[dict[str, Any]]:
        """
        Query attack paths in the graph.
        
        Args:
            mission_id: Mission identifier
            from_target: Optional source target filter
            successful_only: Only return successful attacks
            
        Returns:
            List of attack paths with source, target, and technique
        """
        if not self._enabled:
            return []
        
        try:
            loop = asyncio.get_event_loop()
            graph = self._get_graph(mission_id)
            
            if successful_only:
                query = """
                MATCH (a)-[r:ATTACKS {success: true}]->(b)
                RETURN a.identifier as source, b.identifier as target,
                       r.technique as technique, r.evidence as evidence
                """
            else:
                query = """
                MATCH (a)-[r:ATTACKS]->(b)
                RETURN a.identifier as source, b.identifier as target,
                       r.technique as technique, r.evidence as evidence,
                       r.success as success
                """
            
            result = await loop.run_in_executor(
                None,
                lambda: graph.query(query)
            )
            
            paths = []
            for record in result.result_set:
                paths.append({
                    'source': record[0],
                    'target': record[1],
                    'technique': record[2],
                    'evidence': record[3],
                })
            
            return paths
        except Exception as e:
            logger.error(f"Failed to query attack paths: {e}")
            return []
    
    async def get_kill_chain_summary(self, mission_id: str) -> dict[str, Any]:
        """
        Get summary statistics for the kill chain.
        
        Returns:
            Dictionary with node counts, edge counts, successful attacks, etc.
        """
        if not self._enabled:
            return {'enabled': False}
        
        try:
            loop = asyncio.get_event_loop()
            graph = self._get_graph(mission_id)
            
            # Count nodes by type
            node_query = """
            MATCH (n)
            RETURN labels(n)[0] as node_type, count(n) as count
            """
            
            # Count successful attacks
            attack_query = """
            MATCH ()-[r:ATTACKS {success: true}]->()
            RETURN count(r) as successful_attacks
            """
            
            node_result = await loop.run_in_executor(
                None, lambda: graph.query(node_query)
            )
            attack_result = await loop.run_in_executor(
                None, lambda: graph.query(attack_query)
            )
            
            summary = {
                'enabled': True,
                'nodes': {r[0]: r[1] for r in node_result.result_set},
                'successful_attacks': attack_result.result_set[0][0] if attack_result.result_set else 0,
            }
            
            return summary
        except Exception as e:
            logger.error(f"Failed to get kill chain summary: {e}")
            return {'enabled': True, 'error': str(e)}


# Singleton instance
_falkordb_instance: FalkorDBClient | None = None


def get_falkordb_client(host: str = "localhost", port: int = 6379) -> FalkorDBClient:
    """Get or create FalkorDB client singleton."""
    global _falkordb_instance
    if _falkordb_instance is None:
        _falkordb_instance = FalkorDBClient(host, port)
    return _falkordb_instance
