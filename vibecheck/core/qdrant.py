"""
Qdrant client for Project VibeCheck.

Qdrant is a high-performance vector database used for:
- Storing code embeddings (function bodies, file contents)
- Semantic search for similar code patterns
- Retrieval-augmented generation (RAG) for LLM context
"""

import logging
from typing import Any

from qdrant_client import QdrantClient as QdrantClientSDK
from qdrant_client.http import models
from qdrant_client.http.exceptions import UnexpectedResponse

from core.config import get_settings

logger = logging.getLogger(__name__)

# Collection names
COLLECTION_CODE_CHUNKS = "code_chunks"
COLLECTION_FUNCTION_SUMMARIES = "function_summaries"
COLLECTION_KNOWN_PATTERNS = "known_vulnerable_patterns"


class QdrantClient:
    """
    Client for interacting with Qdrant vector database.

    Manages collections for code embeddings and provides
    search functionality for semantic code retrieval.
    """

    def __init__(self, url: str | None = None) -> None:
        """
        Initialize Qdrant client.

        Args:
            url: Qdrant server URL (e.g., http://localhost:6333)
        """
        settings = get_settings()
        self._url = url or settings.qdrant_url
        self._client: QdrantClientSDK | None = None

    def connect(self) -> None:
        """Establish connection to Qdrant."""
        if self._client is None:
            logger.info(f"Connecting to Qdrant at {self._url}")
            self._client = QdrantClientSDK(url=self._url)
            # Test connection by listing collections
            self._client.get_collections()
            logger.info("Qdrant connection established")

    def disconnect(self) -> None:
        """Close connection to Qdrant."""
        if self._client:
            self._client.close()
            self._client = None
            logger.info("Qdrant connection closed")

    @property
    def client(self) -> QdrantClientSDK:
        """Get the Qdrant client, connecting if necessary."""
        if self._client is None:
            self.connect()
        assert self._client is not None
        return self._client

    def create_collection(
        self,
        collection_name: str,
        vector_size: int = 768,
        distance: models.Distance = models.Distance.COSINE,
    ) -> None:
        """
        Create a new collection for embeddings.

        Args:
            collection_name: Name of the collection
            vector_size: Dimension of vectors (768 for nomic-embed-text)
            distance: Distance metric (COSINE, EUCLID, DOT)
        """
        try:
            self.client.create_collection(
                collection_name=collection_name,
                vectors_config=models.VectorParams(
                    size=vector_size,
                    distance=distance,
                ),
            )
            logger.info(f"Created collection: {collection_name}")
        except UnexpectedResponse as e:
            if "already exists" in str(e):
                logger.debug(f"Collection already exists: {collection_name}")
            else:
                raise

    def ensure_collections_exist(self) -> None:
        """Ensure all required collections exist."""
        # Code chunks collection (file-level embeddings)
        self.create_collection(COLLECTION_CODE_CHUNKS, vector_size=768)

        # Function summaries collection (function-level embeddings)
        self.create_collection(COLLECTION_FUNCTION_SUMMARIES, vector_size=768)

        # Known vulnerable patterns collection (seeded at startup)
        self.create_collection(COLLECTION_KNOWN_PATTERNS, vector_size=768)

    async def seed_known_patterns(self, embed_fn) -> None:
        """
        Seed the known_vulnerable_patterns collection with common vulnerability patterns.

        This should be called once at worker startup. If the collection already has
        >= 6 points, it skips seeding.

        Args:
            embed_fn: Async function that takes text and returns embedding vector.
                      Should call Ollama nomic-embed-text model.
        """
        import uuid

        # Check if already seeded
        info = self.get_collection_info(COLLECTION_KNOWN_PATTERNS)
        if info and info.points_count >= 6:
            logger.info(
                f"Collection {COLLECTION_KNOWN_PATTERNS} already has "
                f"{info.points_count} points, skipping seed"
            )
            return

        # Known vulnerable patterns to seed
        # Note: Qdrant requires UUID or integer IDs, so we generate deterministic UUIDs
        patterns = [
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "n-plus-1-orm-in-loop")),
                "name": "n-plus-1-orm-in-loop",
                "code": "for (const id of ids) { const user = await User.findByPk(id); }",
                "vuln_type": "n_plus_1",
                "severity": "high",
                "cwe": "CWE-1048",
                "description": "N+1 query pattern - ORM call inside loop",
            },
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "sqli-string-concat")),
                "name": "sqli-string-concat",
                "code": "db.query('SELECT * FROM users WHERE id = ' + req.params.id)",
                "vuln_type": "sql_injection",
                "severity": "critical",
                "cwe": "CWE-89",
                "description": "SQL injection via string concatenation",
            },
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "hardcoded-jwt-secret")),
                "name": "hardcoded-jwt-secret",
                "code": "jwt.sign(payload, 'mysecretkey123')",
                "vuln_type": "hardcoded_secret",
                "severity": "high",
                "cwe": "CWE-798",
                "description": "Hardcoded JWT secret key",
            },
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "prototype-pollution")),
                "name": "prototype-pollution",
                "code": "Object.assign(target, JSON.parse(req.body))",
                "vuln_type": "prototype_pollution",
                "severity": "high",
                "cwe": "CWE-1321",
                "description": "Prototype pollution via Object.assign",
            },
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "path-traversal")),
                "name": "path-traversal",
                "code": "fs.readFile(path.join(__dirname, req.params.file))",
                "vuln_type": "path_traversal",
                "severity": "high",
                "cwe": "CWE-22",
                "description": "Path traversal via user input to file path",
            },
            {
                "id": str(uuid.uuid5(uuid.NAMESPACE_DNS, "unguarded-admin-route")),
                "name": "unguarded-admin-route",
                "code": "app.get('/api/admin/users', (req, res) => { /* no auth check */ })",
                "vuln_type": "missing_auth",
                "severity": "critical",
                "cwe": "CWE-306",
                "description": "Unguarded admin route without authentication",
            },
        ]

        logger.info(f"Seeding {len(patterns)} known vulnerable patterns...")

        points = []
        for pattern in patterns:
            try:
                # Get embedding for the code pattern
                vector = await embed_fn(pattern["code"])

                # Create point
                point = models.PointStruct(
                    id=pattern["id"],
                    vector=vector,
                    payload={
                        "name": pattern["name"],
                        "code": pattern["code"],
                        "vuln_type": pattern["vuln_type"],
                        "severity": pattern["severity"],
                        "cwe": pattern["cwe"],
                        "description": pattern["description"],
                    },
                )
                points.append(point)

            except Exception as e:
                logger.error(f"Failed to embed pattern {pattern['name']}: {e}")
                continue

        # Upsert all patterns
        if points:
            self.upsert_vectors(COLLECTION_KNOWN_PATTERNS, points)
            logger.info(f"Seeded {len(points)} known vulnerable patterns")

    def upsert_vectors(
        self,
        collection_name: str,
        points: list[models.PointStruct],
    ) -> None:
        """
        Upsert (insert or update) vectors into a collection.

        Args:
            collection_name: Name of the collection
            points: List of PointStruct objects with id, vector, and payload
        """
        self.client.upsert(
            collection_name=collection_name,
            points=points,
        )
        logger.debug(f"Upserted {len(points)} vectors into {collection_name}")

    def search(
        self,
        collection_name: str,
        query_vector: list[float],
        limit: int = 10,
        score_threshold: float | None = None,
        query_filter: models.Filter | None = None,
    ) -> list[models.ScoredPoint]:
        """
        Search for similar vectors in a collection.

        Args:
            collection_name: Name of the collection
            query_vector: Query vector to search for
            limit: Maximum number of results
            score_threshold: Minimum similarity score
            query_filter: Optional filter conditions

        Returns:
            List of scored points with payload
        """
        results = self.client.search(
            collection_name=collection_name,
            query_vector=query_vector,
            limit=limit,
            score_threshold=score_threshold,
            query_filter=query_filter,
        )
        return list(results)

    def delete_collection(self, collection_name: str) -> None:
        """
        Delete a collection and all its vectors.

        Args:
            collection_name: Name of the collection to delete
        """
        try:
            self.client.delete_collection(collection_name)
            logger.info(f"Deleted collection: {collection_name}")
        except UnexpectedResponse as e:
            if "Not found" in str(e):
                logger.debug(f"Collection not found: {collection_name}")
            else:
                raise

    def get_collection_info(self, collection_name: str) -> models.CollectionInfo | None:
        """
        Get information about a collection.

        Args:
            collection_name: Name of the collection

        Returns:
            Collection info or None if not found
        """
        try:
            return self.client.get_collection(collection_name)
        except UnexpectedResponse:
            return None

    def list_collections(self) -> list[str]:
        """
        List all collections.

        Returns:
            List of collection names
        """
        collections = self.client.get_collections()
        return [c.name for c in collections.collections]

    def delete_vectors_by_scan(self, scan_id: str) -> None:
        """
        Delete all vectors associated with a scan.

        Args:
            scan_id: Scan identifier to filter by
        """
        for collection_name in [COLLECTION_CODE_CHUNKS, COLLECTION_FUNCTION_SUMMARIES]:
            try:
                self.client.delete(
                    collection_name=collection_name,
                    points_selector=models.FilterSelector(
                        filter=models.Filter(
                            must=[
                                models.FieldCondition(
                                    key="scan_id",
                                    match=models.MatchValue(value=scan_id),
                                )
                            ]
                        )
                    )
                )
                logger.info(f"Deleted vectors for scan {scan_id} from {collection_name}")
            except UnexpectedResponse as e:
                if "Not found" not in str(e):
                    raise


# Singleton instance
_client: QdrantClient | None = None


def get_qdrant_client() -> QdrantClient:
    """Get the Qdrant client singleton."""
    global _client
    if _client is None:
        _client = QdrantClient()
    return _client