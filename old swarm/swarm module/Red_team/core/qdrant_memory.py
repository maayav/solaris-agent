"""
Qdrant episodic memory for Red Team successful exploits.
Stores winning payloads for future agents to learn from.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import uuid
from typing import Any

logger = logging.getLogger(__name__)

# Optional Qdrant import
try:
    from qdrant_client import QdrantClient as QdrantClientSDK
    from qdrant_client.models import Distance, VectorParams, PointStruct
    HAS_QDRANT = True
except ImportError:
    HAS_QDRANT = False
    logger.warning("qdrant-client not installed - episodic memory disabled")


class EpisodicMemory:
    """
    PentAGI-style episodic memory for successful exploits.
    Stores winning payloads in Qdrant for retrieval by future agents.
    """
    
    COLLECTION_NAME = "successful_exploits"
    VECTOR_SIZE = 768  # For nomic-embed-text
    
    def __init__(self, host: str = "localhost", port: int = 6333):
        self._host = host
        self._port = port
        self._client: Any = None
        self._enabled = False
        
        if HAS_QDRANT:
            try:
                self._client = QdrantClientSDK(host=host, port=port)
                self._ensure_collection()
                self._enabled = True
                logger.info(f"Episodic memory connected to Qdrant at {host}:{port}")
            except Exception as e:
                logger.error(f"Failed to connect to Qdrant: {e}")
        else:
            logger.warning("Qdrant not available - episodic memory disabled")
    
    def _ensure_collection(self):
        """Create collection if it doesn't exist."""
        try:
            collections = self._client.get_collections().collections
            collection_names = [c.name for c in collections]
            
            if self.COLLECTION_NAME not in collection_names:
                self._client.create_collection(
                    collection_name=self.COLLECTION_NAME,
                    vectors_config=VectorParams(
                        size=self.VECTOR_SIZE,
                        distance=Distance.COSINE
                    )
                )
                logger.info(f"Created Qdrant collection: {self.COLLECTION_NAME}")
        except Exception as e:
            logger.error(f"Failed to ensure collection: {e}")
            raise
    
    async def store_successful_exploit(
        self,
        mission_id: str,
        exploit_type: str,
        target: str,
        payload: str,
        tool_used: str,
        evidence: str,
        technique: str | None = None,
    ) -> bool:
        """
        Store a successful exploit in episodic memory.
        
        Args:
            mission_id: Unique mission identifier
            exploit_type: sqli, xss, idor, etc.
            target: Target URL/endpoint
            payload: The successful payload
            tool_used: curl, python, nuclei, etc.
            evidence: Proof of success (response data)
            technique: Specific technique used (e.g., "union_based_sqli")
        """
        if not self._enabled:
            logger.debug("Episodic memory disabled - exploit not stored")
            return False
        
        # Create a unique ID based on mission and payload hash (must be valid UUID for Qdrant)
        payload_hash = hashlib.md5(f"{mission_id}:{payload}".encode()).hexdigest()
        # Convert hash to UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
        point_id = f"{payload_hash[:8]}-{payload_hash[8:12]}-{payload_hash[12:16]}-{payload_hash[16:20]}-{payload_hash[20:32]}"
        
        # Create embedding text
        embedding_text = f"""
        Exploit Type: {exploit_type}
        Target: {target}
        Technique: {technique or exploit_type}
        Tool: {tool_used}
        Payload: {payload[:500]}
        """.strip()
        
        # For now, use a simple hash-based vector (in production, use Ollama embeddings)
        # This is a placeholder - real implementation would call Ollama
        vector = self._generate_simple_vector(embedding_text)
        
        point = PointStruct(
            id=point_id,
            vector=vector,
            payload={
                "mission_id": mission_id,
                "exploit_type": exploit_type,
                "target": target,
                "payload": payload,
                "tool_used": tool_used,
                "evidence": evidence[:1000],  # Truncate
                "technique": technique,
                "embedding_text": embedding_text,
            }
        )
        
        try:
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(
                None,
                lambda: self._client.upsert(
                    collection_name=self.COLLECTION_NAME,
                    points=[point]
                )
            )
            logger.info(f"Stored successful exploit in memory: {exploit_type} on {target}")
            return True
        except Exception as e:
            logger.error(f"Failed to store exploit in memory: {e}")
            return False
    
    async def search_similar_exploits(
        self,
        exploit_type: str | None = None,
        target_pattern: str | None = None,
        limit: int = 5,
    ) -> list[dict[str, Any]]:
        """
        Search for similar successful exploits.
        
        Args:
            exploit_type: Filter by type (sqli, xss, etc.)
            target_pattern: Filter by target pattern
            limit: Max results
            
        Returns:
            List of similar exploits with payloads
        """
        if not self._enabled:
            return []
        
        # Build filter
        filter_conditions = []
        if exploit_type:
            filter_conditions.append(
                models.FieldCondition(
                    key="exploit_type",
                    match=models.MatchValue(value=exploit_type)
                )
            )
        
        try:
            # For now, scroll all points and filter
            # In production, this would use vector similarity search
            loop = asyncio.get_event_loop()
            results = await loop.run_in_executor(
                None,
                lambda: self._client.scroll(
                    collection_name=self.COLLECTION_NAME,
                    limit=limit * 2,  # Get more for filtering
                    with_payload=True,
                )
            )
            
            exploits = []
            for point in results[0]:  # results is (points, next_page_offset)
                payload = point.payload
                if target_pattern and target_pattern not in payload.get("target", ""):
                    continue
                exploits.append(payload)
                if len(exploits) >= limit:
                    break
            
            return exploits
        except Exception as e:
            logger.error(f"Failed to search episodic memory: {e}")
            return []
    
    def _generate_simple_vector(self, text: str) -> list[float]:
        """
        Generate a simple deterministic vector from text.
        In production, use Ollama nomic-embed-text instead.
        """
        # Simple hash-based vector for demonstration
        # Real implementation would call Ollama for embeddings
        hash_val = hashlib.md5(text.encode()).hexdigest()
        vector = []
        for i in range(0, len(hash_val), 2):
            val = int(hash_val[i:i+2], 16) / 255.0
            vector.append(val)
        
        # Pad or truncate to VECTOR_SIZE
        if len(vector) < self.VECTOR_SIZE:
            vector.extend([0.0] * (self.VECTOR_SIZE - len(vector)))
        return vector[:self.VECTOR_SIZE]


# Singleton instance
_memory_instance: EpisodicMemory | None = None


def get_episodic_memory(host: str = "localhost", port: int = 6333) -> EpisodicMemory:
    """Get or create episodic memory singleton."""
    global _memory_instance
    if _memory_instance is None:
        _memory_instance = EpisodicMemory(host, port)
    return _memory_instance
