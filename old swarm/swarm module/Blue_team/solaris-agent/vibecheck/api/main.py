"""
FastAPI main application for Project VibeCheck.

Entry point for the API server providing:
- Scan triggering and management endpoints
- Vulnerability report endpoints
- Red team mission control endpoints
- Health checks and status endpoints
"""

import logging
import sys
from contextlib import asynccontextmanager
from typing import Any

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import scan, report, chat
from core.config import get_settings
from core.falkordb import get_falkordb_client
from core.qdrant import get_qdrant_client
from core.redis_bus import get_redis_bus
from core.ollama import get_ollama_client

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)

logger = logging.getLogger(__name__)
settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application lifespan manager.
    
    Handles startup and shutdown of connections to:
    - FalkorDB (Graph Database)
    - Qdrant (Vector Database)
    - Redis (Message Bus)
    - Ollama (Local LLM)
    """
    # Startup
    logger.info("Starting VibeCheck API server...")
    
    # Initialize connections
    try:
        # Connect to Redis (message bus)
        redis_bus = get_redis_bus()
        await redis_bus.connect()
        logger.info("Redis connection established")
        
        # Connect to FalkorDB (graph database)
        falkordb = get_falkordb_client()
        falkordb.connect()
        logger.info("FalkorDB connection established")
        
        # Connect to Qdrant (vector database)
        qdrant = get_qdrant_client()
        qdrant.connect()
        qdrant.ensure_collections_exist()
        logger.info("Qdrant connection established")
        
        # Check Ollama health
        ollama = get_ollama_client()
        if ollama.is_healthy():
            logger.info("Ollama server is healthy")
            # Ensure models are available (non-blocking)
            # ollama.ensure_models_exist()  # Uncomment to auto-pull models
        else:
            logger.warning("Ollama server is not responding - some features may not work")
        
        logger.info("All services initialized successfully")
        
    except Exception as e:
        logger.error(f"Failed to initialize services: {e}")
        raise
    
    yield
    
    # Shutdown
    logger.info("Shutting down VibeCheck API server...")
    
    try:
        redis_bus = get_redis_bus()
        await redis_bus.disconnect()
        logger.info("Redis connection closed")
        
        falkordb = get_falkordb_client()
        falkordb.disconnect()
        logger.info("FalkorDB connection closed")
        
        qdrant = get_qdrant_client()
        qdrant.disconnect()
        logger.info("Qdrant connection closed")
        
    except Exception as e:
        logger.error(f"Error during shutdown: {e}")
    
    logger.info("Shutdown complete")


# Create FastAPI application
app = FastAPI(
    title="VibeCheck API",
    description="Dual-agent autonomous security system for auditing and red-teaming AI-generated code",
    version="0.1.0",
    docs_url="/docs",
    redoc_url="/redoc",
    openapi_url="/openapi.json",
    lifespan=lifespan,
)

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"] if settings.is_development else [],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers
app.include_router(scan.router, prefix="/scan", tags=["Scans"])
app.include_router(report.router, prefix="/report", tags=["Reports"])
app.include_router(chat.router, prefix="/chat", tags=["Chat"])


# -------------------------------------------
# Health Check Endpoints
# -------------------------------------------

@app.get("/", tags=["Root"])
async def root() -> dict[str, str]:
    """Root endpoint - API information."""
    return {
        "name": "VibeCheck API",
        "version": "0.1.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health", tags=["Health"])
async def health_check() -> dict[str, Any]:
    """
    Health check endpoint.
    
    Returns status of all connected services.
    """
    health_status = {
        "status": "healthy",
        "services": {},
    }
    
    # Check Redis
    try:
        redis_bus = get_redis_bus()
        if redis_bus._client:
            await redis_bus.client.ping()
            health_status["services"]["redis"] = "healthy"
        else:
            health_status["services"]["redis"] = "not_connected"
    except Exception as e:
        health_status["services"]["redis"] = f"error: {str(e)}"
        health_status["status"] = "degraded"
    
    # Check FalkorDB
    try:
        falkordb = get_falkordb_client()
        if falkordb.ping():
            health_status["services"]["falkordb"] = "healthy"
        else:
            health_status["services"]["falkordb"] = "not_connected"
    except Exception as e:
        health_status["services"]["falkordb"] = f"error: {str(e)}"
        health_status["status"] = "degraded"
    
    # Check Qdrant
    try:
        qdrant = get_qdrant_client()
        if qdrant._client:
            qdrant.client.get_collections()
            health_status["services"]["qdrant"] = "healthy"
        else:
            health_status["services"]["qdrant"] = "not_connected"
    except Exception as e:
        health_status["services"]["qdrant"] = f"error: {str(e)}"
        health_status["status"] = "degraded"
    
    # Check Ollama
    try:
        ollama = get_ollama_client()
        if ollama.is_healthy():
            health_status["services"]["ollama"] = "healthy"
        else:
            health_status["services"]["ollama"] = "not_responding"
    except Exception as e:
        health_status["services"]["ollama"] = f"error: {str(e)}"
        health_status["status"] = "degraded"
    
    return health_status


@app.get("/health/ready", tags=["Health"])
async def readiness_check() -> dict[str, str]:
    """
    Readiness check endpoint.
    
    Returns 200 only if all critical services are ready.
    """
    health = await health_check()
    if health["status"] == "healthy":
        return {"status": "ready"}
    return {"status": "not_ready", "details": str(health)}


# -------------------------------------------
# Main Entry Point
# -------------------------------------------

def run_server() -> None:
    """Run the API server (entry point for poetry script)."""
    uvicorn.run(
        "api.main:app",
        host="0.0.0.0",
        port=settings.api_port,
        reload=settings.is_development,
        log_level=settings.log_level.lower(),
    )


if __name__ == "__main__":
    run_server()