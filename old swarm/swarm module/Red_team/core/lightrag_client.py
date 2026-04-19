"""
LightRAG client for Red Team semantic/GraphRAG analysis.
Stores semantic clones and enables architectural reasoning.
"""
from __future__ import annotations

import asyncio
import logging
import os
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

# Optional LightRAG import
try:
    from lightrag import LightRAG, QueryParam
    from lightrag.llm import ollama_model_complete, ollama_embedding
    HAS_LIGHTRAG = True
except ImportError:
    HAS_LIGHTRAG = False
    logger.warning("lightrag not installed - GraphRAG integration disabled")


class LightRAGClient:
    """
    LightRAG client for semantic analysis and GraphRAG.
    Stores semantic clones and enables architectural queries.
    """
    
    def __init__(self, working_dir: str = "./lightrag_redteam"):
        self._working_dir = Path(working_dir)
        self._working_dir.mkdir(parents=True, exist_ok=True)
        self._rag: Any = None
        self._enabled = False
        self._mission_rags: dict[str, Any] = {}  # Per-mission RAG instances
        
        if HAS_LIGHTRAG:
            try:
                # Default RAG instance for general use
                self._rag = LightRAG(
                    working_dir=str(self._working_dir / "default"),
                    llm_model_func=ollama_model_complete,
                    llm_model_name="qwen2.5-coder:7b",
                    embedding_func=ollama_embedding,
                    embedding_model_name="nomic-embed-text:v1.5",
                )
                self._enabled = True
                logger.info(f"LightRAG initialized at {self._working_dir}")
            except Exception as e:
                logger.error(f"Failed to initialize LightRAG: {e}")
        else:
            logger.warning("LightRAG not available - using fallback")
    
    def _get_mission_rag(self, mission_id: str) -> Any:
        """Get or create RAG instance for a mission."""
        if not self._enabled:
            return None
        
        if mission_id not in self._mission_rags:
            mission_dir = self._working_dir / f"mission_{mission_id}"
            mission_dir.mkdir(parents=True, exist_ok=True)
            
            try:
                self._mission_rags[mission_id] = LightRAG(
                    working_dir=str(mission_dir),
                    llm_model_func=ollama_model_complete,
                    llm_model_name="qwen2.5-coder:7b",
                    embedding_func=ollama_embedding,
                    embedding_model_name="nomic-embed-text:v1.5",
                )
            except Exception as e:
                logger.error(f"Failed to create mission RAG: {e}")
                return None
        
        return self._mission_rags[mission_id]
    
    async def ingest_recon_data(
        self,
        mission_id: str,
        recon_data: dict[str, Any],
    ) -> bool:
        """
        Ingest reconnaissance data into LightRAG.
        
        Args:
            mission_id: Mission identifier
            recon_data: Recon findings, endpoints, assets
        """
        if not self._enabled:
            return False
        
        try:
            rag = self._get_mission_rag(mission_id)
            if not rag:
                return False
            
            # Convert recon data to text for ingestion
            texts = []
            
            # Add findings
            for finding in recon_data.get("findings", []):
                text = f"""
                Finding: {finding.get('finding', '')}
                Asset: {finding.get('asset', '')}
                Confidence: {finding.get('confidence', 0)}
                Evidence: {finding.get('evidence', '')}
                """.strip()
                texts.append(text)
            
            # Add endpoints
            for endpoint in recon_data.get("endpoints", []):
                texts.append(f"Endpoint discovered: {endpoint}")
            
            # Ingest into RAG
            loop = asyncio.get_event_loop()
            for text in texts:
                await loop.run_in_executor(None, lambda: rag.insert(text))
            
            logger.info(f"Ingested {len(texts)} recon items into LightRAG for mission {mission_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to ingest recon data: {e}")
            return False
    
    async def query_attack_surface(
        self,
        mission_id: str,
        query: str,
        mode: str = "hybrid",  # naive, local, global, hybrid
    ) -> str:
        """
        Query the attack surface using GraphRAG.
        
        Args:
            mission_id: Mission identifier
            query: Natural language query about attack surface
            mode: Query mode (naive, local, global, hybrid)
            
        Returns:
            LLM-generated analysis of attack surface
        """
        if not self._enabled:
            return "LightRAG not available - query cannot be answered"
        
        try:
            rag = self._get_mission_rag(mission_id)
            if not rag:
                return "Failed to initialize RAG for mission"
            
            loop = asyncio.get_event_loop()
            result = await loop.run_in_executor(
                None,
                lambda: rag.query(query, param=QueryParam(mode=mode))
            )
            
            return result
        except Exception as e:
            logger.error(f"Failed to query attack surface: {e}")
            return f"Query failed: {str(e)}"
    
    async def suggest_attack_vectors(
        self,
        mission_id: str,
        exploit_type: str | None = None,
    ) -> list[dict[str, Any]]:
        """
        Suggest attack vectors based on ingested data.
        
        Args:
            mission_id: Mission identifier
            exploit_type: Optional filter for specific exploit type
            
        Returns:
            List of suggested attack vectors with confidence
        """
        if not self._enabled:
            return []
        
        query = "What are the most vulnerable endpoints and why?"
        if exploit_type:
            query = f"What endpoints are vulnerable to {exploit_type} attacks?"
        
        try:
            response = await self.query_attack_surface(mission_id, query, mode="global")
            
            # Parse response into structured suggestions
            # This is a simplified parsing - real implementation would be more robust
            suggestions = []
            lines = response.split('\n')
            current_suggestion = {}
            
            for line in lines:
                line = line.strip()
                if line.startswith('- ') or line.startswith('* '):
                    if current_suggestion:
                        suggestions.append(current_suggestion)
                    current_suggestion = {
                        'description': line[2:],
                        'confidence': 0.7,  # Default confidence
                        'technique': exploit_type or 'unknown',
                    }
                elif ':' in line and current_suggestion:
                    key, value = line.split(':', 1)
                    key = key.strip().lower()
                    value = value.strip()
                    if 'confidence' in key:
                        try:
                            current_suggestion['confidence'] = float(value.replace('%', '')) / 100
                        except:
                            pass
                    elif 'endpoint' in key or 'target' in key:
                        current_suggestion['target'] = value
            
            if current_suggestion:
                suggestions.append(current_suggestion)
            
            return suggestions
        except Exception as e:
            logger.error(f"Failed to suggest attack vectors: {e}")
            return []
    
    async def generate_semantic_clone(
        self,
        mission_id: str,
        code_snippets: list[dict[str, str]],
    ) -> str:
        """
        Generate a semantic clone (compressed code representation).
        
        Args:
            mission_id: Mission identifier
            code_snippets: List of {file, code} dictionaries
            
        Returns:
            Semantic clone summary
        """
        if not self._enabled:
            return "LightRAG not available"
        
        try:
            # Combine code snippets
            combined = []
            for snippet in code_snippets:
                combined.append(f"File: {snippet.get('file', 'unknown')}\n```\n{snippet.get('code', '')}\n```")
            
            code_text = "\n\n".join(combined)
            
            # Query for semantic summary
            query = f"Summarize the security-relevant aspects of this codebase:\n{code_text[:10000]}"
            
            return await self.query_attack_surface(mission_id, query, mode="global")
        except Exception as e:
            logger.error(f"Failed to generate semantic clone: {e}")
            return f"Failed: {str(e)}"


# Singleton instance
_lightrag_instance: LightRAGClient | None = None


def get_lightrag_client(working_dir: str = "./lightrag_redteam") -> LightRAGClient:
    """Get or create LightRAG client singleton."""
    global _lightrag_instance
    if _lightrag_instance is None:
        _lightrag_instance = LightRAGClient(working_dir)
    return _lightrag_instance
