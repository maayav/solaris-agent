"""
FastAPI backend for the Red Team Agent Swarm frontend.

This provides a REST API wrapper around the LangGraph agent system.
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import Dict, Set
import json
import threading
import time

# WebSocket connection manager
class ConnectionManager:
    """Manages WebSocket connections for real-time mission updates."""
    
    def __init__(self):
        # mission_id -> set of WebSocket connections
        self.active_connections: Dict[str, Set[WebSocket]] = {}
        self._lock = threading.Lock()
    
    async def connect(self, websocket: WebSocket, mission_id: str):
        """Accept a new WebSocket connection."""
        await websocket.accept()
        with self._lock:
            if mission_id not in self.active_connections:
                self.active_connections[mission_id] = set()
            self.active_connections[mission_id].add(websocket)
        logger.info(f"WebSocket client connected for mission {mission_id}")
    
    def disconnect(self, websocket: WebSocket, mission_id: str):
        """Remove a WebSocket connection."""
        with self._lock:
            if mission_id in self.active_connections:
                self.active_connections[mission_id].discard(websocket)
                if not self.active_connections[mission_id]:
                    del self.active_connections[mission_id]
        logger.info(f"WebSocket client disconnected from mission {mission_id}")
    
    async def broadcast_to_mission(self, mission_id: str, message: dict):
        """Broadcast a message to all connected clients for a mission."""
        if mission_id not in self.active_connections:
            return
        
        disconnected = []
        for connection in self.active_connections[mission_id]:
            try:
                await connection.send_json(message)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket message: {e}")
                disconnected.append(connection)
        
        # Clean up disconnected clients
        with self._lock:
            for conn in disconnected:
                self.active_connections[mission_id].discard(conn)

# Global connection manager
ws_manager = ConnectionManager()

# Add project root to path
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Supabase client for frontend data
try:
    from supabase import create_client, Client
    import os
    SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://nesjaodrrkefpmqdqtgv.supabase.co")
    SUPABASE_KEY = os.environ.get("SUPABASE_ANON_KEY", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lc2phb2RycmtlZnBtcWRxdGd2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExMTg0MjcsImV4cCI6MjA4NjY5NDQyN30.zbEAwOcZ7Tn-LVfGC8KdQeh3D3xEyzghZ-Mfg0VgnfE")
    supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
    SUPABASE_AVAILABLE = True
    logger.info("Supabase client initialized for API")
except Exception as e:
    supabase = None
    SUPABASE_AVAILABLE = False
    logger.warning(f"Could not initialize Supabase client: {e}")

# Configure logging BEFORE imports that might fail
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)-20s] %(levelname)-7s %(message)s",
)
logger = logging.getLogger("api")

# Try to import agent modules - wrap in try/except to handle import errors gracefully
try:
    from agents.graph import build_red_team_graph, create_initial_state
    from agents.state import RedTeamState
    from agents.tools.registry import tool_registry
    from agents.tools.nmap_tool import nmap_tool
    from agents.tools.nuclei_tool import nuclei_tool
    from agents.tools.curl_tool import curl_tool
    from agents.tools.python_exec import python_exec_tool
    from sandbox.sandbox_manager import sandbox_manager
    from core.config import settings
    
    # Register tools on import
    tool_registry.register(nmap_tool)
    tool_registry.register(nuclei_tool)
    tool_registry.register(curl_tool)
    tool_registry.register(python_exec_tool)
    logger.info("Tools registered: %s", tool_registry.list_names())
    
    AGENTS_AVAILABLE = True
    logger.info("Agent modules imported successfully")
except ImportError as e:
    logger.warning(f"Could not import agent modules: {e}")
    AGENTS_AVAILABLE = False
    # Create dummy functions for demo mode
    def build_red_team_graph():
        return None
    def create_initial_state(**kwargs):
        return {}
    class RedTeamState:
        pass
    class settings:
        pass

# Create FastAPI app
app = FastAPI(
    title="Red Team Agent Swarm API",
    description="REST API for the Red Team multi-agent penetration testing system",
    version="0.1.0",
)

# Add CORS middleware - more permissive for development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Allow all origins in development
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

logger.info("CORS middleware configured")

# In-memory storage for mission states (in production, use a database)
missions: dict[str, dict] = {}

# Redis subscriber for real-time events
_redis_subscriber_task = None

async def redis_event_subscriber():
    """Subscribe to Redis Blackboard events and broadcast to WebSocket clients.
    
    This runs as a background task and listens for EXPLOIT_RESULT and 
    INTELLIGENCE_REPORT events from the Redis bus, then broadcasts them
    to connected WebSocket clients.
    """
    try:
        # Import redis_bus
        from core.redis_bus import redis_bus, EXPLOIT_RESULT, INTELLIGENCE_REPORT
        
        logger.info("Starting Redis event subscriber for WebSocket broadcasting")
        
        # Subscribe to relevant channels
        channels = [EXPLOIT_RESULT, INTELLIGENCE_REPORT, "mission_events"]
        
        async for message in redis_bus.subscribe(channels):
            try:
                # Parse the message
                if isinstance(message, dict):
                    mission_id = message.get("mission_id") or message.get("payload", {}).get("mission_id")
                    event_type = message.get("type", "unknown")
                    payload = message.get("payload", message)
                    
                    if mission_id:
                        # Broadcast to WebSocket clients
                        await ws_manager.broadcast_to_mission(
                            mission_id,
                            {
                                "type": event_type,
                                "timestamp": datetime.utcnow().isoformat(),
                                "payload": payload,
                            }
                        )
                        logger.debug(f"Broadcasted {event_type} event for mission {mission_id}")
            except Exception as e:
                logger.error(f"Error processing Redis message: {e}")
                
    except ImportError:
        logger.warning("Redis bus not available - WebSocket real-time updates disabled")
    except Exception as e:
        logger.error(f"Redis subscriber error: {e}")


@app.on_event("startup")
async def startup_event():
    """Start background tasks on API startup."""
    global _redis_subscriber_task
    _redis_subscriber_task = asyncio.create_task(redis_event_subscriber())
    logger.info("API startup complete - WebSocket broadcaster ready")


@app.on_event("shutdown")
async def shutdown_event():
    """Clean up background tasks on API shutdown."""
    global _redis_subscriber_task
    if _redis_subscriber_task:
        _redis_subscriber_task.cancel()
        try:
            await _redis_subscriber_task
        except asyncio.CancelledError:
            pass
    logger.info("API shutdown complete")


# ── Request/Response Models ────────────────────────────────────────────────

class StartMissionRequest(BaseModel):
    target: str
    objective: Optional[str] = None
    mission_id: Optional[str] = None


class StartMissionResponse(BaseModel):
    mission_id: str
    message: str


class MissionStatusResponse(BaseModel):
    mission_id: str
    phase: str
    status: str
    progress: int
    current_agent: Optional[str]
    iteration: int
    max_iterations: int
    error_message: Optional[str]


class Vulnerability(BaseModel):
    id: str
    type: str
    severity: str
    title: str
    description: Optional[str]
    file_path: Optional[str]
    line_number: Optional[int]
    evidence: Optional[str]
    remediation: Optional[str]
    confirmed: bool


class MissionReportResponse(BaseModel):
    mission_id: str
    target: str
    objective: str
    phase: str
    report: dict
    recon_results: list
    exploit_results: list
    errors: list


# ── Helper Functions ────────────────────────────────────────────────────────

def calculate_progress(phase: str) -> int:
    """Calculate progress percentage based on phase."""
    phase_progress = {
        "planning": 10,
        "recon": 35,
        "exploitation": 65,
        "reporting": 90,
        "complete": 100,
    }
    return phase_progress.get(phase, 0)


async def run_mission_background(mission_id: str, target: str, objective: str):
    """Run the mission in the background."""
    try:
        missions[mission_id]["status"] = "running"
        
        if not AGENTS_AVAILABLE:
            # Demo mode - simulate a mission
            logger.info(f"Running mission {mission_id} in DEMO mode (agents not available)")
            await asyncio.sleep(2)  # Simulate planning
            
            missions[mission_id]["phase"] = "recon"
            missions[mission_id]["current_agent"] = "alpha_recon"
            missions[mission_id]["progress"] = 35
            await asyncio.sleep(3)  # Simulate recon
            
            missions[mission_id]["recon_results"] = [
                {"type": "port_scan", "data": f"Simulated scan results for {target}"},
                {"type": "service_detection", "data": "HTTP/80, HTTPS/443"},
            ]
            
            missions[mission_id]["phase"] = "exploitation"
            missions[mission_id]["current_agent"] = "gamma_exploit"
            missions[mission_id]["progress"] = 65
            await asyncio.sleep(2)  # Simulate exploitation
            
            missions[mission_id]["exploit_results"] = [
                {"type": "vulnerability", "data": "Simulated XSS vulnerability found"},
            ]
            
            missions[mission_id]["phase"] = "reporting"
            missions[mission_id]["current_agent"] = "report_generator"
            missions[mission_id]["progress"] = 90
            await asyncio.sleep(1)  # Simulate reporting
            
            missions[mission_id]["report"] = {
                "summary": f"Security assessment for {target}",
                "findings": ["Simulated XSS vulnerability"],
                "recommendations": ["Implement input validation"],
            }
        else:
            # Build the graph
            graph = build_red_team_graph()
            
            # Create initial state
            initial_state = create_initial_state(
                mission_id=mission_id,
                objective=objective,
                target=target,
            )
            
            # Run the graph
            logger.info(f"Starting mission {mission_id} for target {target}")
            
            # Stream events from the graph
            async for event in graph.astream(initial_state):
                # Update mission state based on event
                if "__end__" not in event:
                    node_name = list(event.keys())[0]
                    node_output = event[node_name]
                    
                    logger.info(f"Mission {mission_id}: Node {node_name} completed")
                    
                    # Update phase based on node
                    if node_name == "commander":
                        missions[mission_id]["phase"] = "planning"
                        missions[mission_id]["current_agent"] = "commander"
                    elif node_name == "alpha_recon":
                        missions[mission_id]["phase"] = "recon"
                        missions[mission_id]["current_agent"] = "alpha_recon"
                    elif node_name == "gamma_exploit":
                        missions[mission_id]["phase"] = "exploitation"
                        missions[mission_id]["current_agent"] = "gamma_exploit"
                    elif node_name == "report_generator":
                        missions[mission_id]["phase"] = "reporting"
                        missions[mission_id]["current_agent"] = "report_generator"
                    
                    missions[mission_id]["progress"] = calculate_progress(
                        missions[mission_id]["phase"]
                    )
                    
                    # Store results
                    if isinstance(node_output, dict):
                        # Update iteration tracking from commander node
                        if "iteration" in node_output:
                            missions[mission_id]["iteration"] = node_output["iteration"]
                            missions[mission_id]["max_iterations"] = node_output.get("max_iterations", 5)
                            logger.info(f"Mission {mission_id}: Iteration updated to {node_output['iteration']}/{missions[mission_id]['max_iterations']}")
                        
                        if "recon_results" in node_output:
                            missions[mission_id]["recon_results"].extend(
                                node_output.get("recon_results", [])
                            )
                        if "exploit_results" in node_output:
                            missions[mission_id]["exploit_results"].extend(
                                node_output.get("exploit_results", [])
                            )
                        if "report" in node_output and node_output["report"]:
                            missions[mission_id]["report"] = node_output["report"]
                        if "errors" in node_output:
                            missions[mission_id]["errors"].extend(
                                node_output.get("errors", [])
                            )
        
        # Mission completed
        missions[mission_id]["status"] = "completed"
        missions[mission_id]["phase"] = "complete"
        missions[mission_id]["progress"] = 100
        missions[mission_id]["current_agent"] = None
        missions[mission_id]["completed_at"] = datetime.utcnow().isoformat()
        
        logger.info(f"Mission {mission_id} completed successfully")
        
    except Exception as e:
        logger.error(f"Mission {mission_id} failed: {e}")
        missions[mission_id]["status"] = "failed"
        missions[mission_id]["errors"].append(str(e))


# ── API Endpoints ────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    """Root endpoint."""
    return {"message": "Red Team Agent Swarm API", "status": "running"}


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    logger.info("Health check called")
    return {"status": "healthy", "agents_available": AGENTS_AVAILABLE}


@app.post("/api/mission/start", response_model=StartMissionResponse)
async def start_mission(request: StartMissionRequest):
    """Start a new security assessment mission."""
    mission_id = request.mission_id or str(uuid.uuid4())
    objective = request.objective or f"Assess security of {request.target}"
    
    # Initialize mission state
    missions[mission_id] = {
        "mission_id": mission_id,
        "target": request.target,
        "objective": objective,
        "phase": "planning",
        "status": "pending",
        "progress": 5,
        "current_agent": "commander",
        "iteration": 0,
        "max_iterations": 5,
        "recon_results": [],
        "exploit_results": [],
        "report": None,
        "errors": [],
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }
    
    # Start mission in background
    asyncio.create_task(
        run_mission_background(mission_id, request.target, objective)
    )
    
    return StartMissionResponse(
        mission_id=mission_id,
        message=f"Mission started for target: {request.target}",
    )


@app.get("/api/mission/{mission_id}/status", response_model=MissionStatusResponse)
async def get_mission_status(mission_id: str):
    """Get the current status of a mission."""
    if mission_id not in missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    mission = missions[mission_id]
    
    return MissionStatusResponse(
        mission_id=mission_id,
        phase=mission["phase"],
        status=mission["status"],
        progress=mission["progress"],
        current_agent=mission["current_agent"],
        iteration=mission.get("iteration", 0),
        max_iterations=mission.get("max_iterations", 5),
        error_message=mission["errors"][0] if mission["errors"] else None,
    )


@app.websocket("/ws/missions/{mission_id}")
async def mission_websocket(websocket: WebSocket, mission_id: str):
    """WebSocket endpoint for real-time mission updates.
    
    Connect to this endpoint to receive live updates as the Red Team
    agents execute exploits and discover vulnerabilities.
    
    Events streamed:
    - exploit_result: When Gamma agent completes an exploit
    - intelligence_report: When Alpha agent discovers information
    - action: When Critic agent grades an exploit (with critic in message)
    - tool_execution: When a tool is executed
    - phase_transition: When mission phase changes
    
    Example JavaScript connection:
        const ws = new WebSocket('ws://localhost:8000/ws/missions/123');
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            console.log('Mission update:', data);
        };
    """
    await ws_manager.connect(websocket, mission_id)
    
    try:
        # Send initial connection confirmation
        await websocket.send_json({
            "type": "connection_established",
            "mission_id": mission_id,
            "timestamp": datetime.utcnow().isoformat(),
            "message": "Connected to mission event stream",
        })
        
        # Keep connection alive and handle client messages
        while True:
            try:
                # Wait for client messages (optional - clients can send commands)
                data = await websocket.receive_text()
                message = json.loads(data)
                
                # Handle client commands
                if message.get("action") == "ping":
                    await websocket.send_json({
                        "type": "pong",
                        "timestamp": datetime.utcnow().isoformat(),
                    })
                elif message.get("action") == "get_status":
                    # Send current mission status
                    if mission_id in missions:
                        await websocket.send_json({
                            "type": "mission_status",
                            "payload": missions[mission_id],
                        })
                    else:
                        await websocket.send_json({
                            "type": "error",
                            "message": f"Mission {mission_id} not found",
                        })
                        
            except json.JSONDecodeError:
                await websocket.send_json({
                    "type": "error",
                    "message": "Invalid JSON received",
                })
            except Exception as e:
                logger.error(f"WebSocket error for mission {mission_id}: {e}")
                break
                
    except WebSocketDisconnect:
        logger.info(f"WebSocket client disconnected from mission {mission_id}")
    except Exception as e:
        logger.error(f"WebSocket error: {e}")
    finally:
        ws_manager.disconnect(websocket, mission_id)


@app.get("/api/mission/{mission_id}/report", response_model=MissionReportResponse)
async def get_mission_report(mission_id: str):
    """Get the full mission report."""
    if mission_id not in missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    mission = missions[mission_id]
    
    return MissionReportResponse(
        mission_id=mission_id,
        target=mission["target"],
        objective=mission["objective"],
        phase=mission["phase"],
        report=mission["report"] or {},
        recon_results=mission["recon_results"],
        exploit_results=mission["exploit_results"],
        errors=mission["errors"],
    )


@app.get("/api/mission/{mission_id}/messages")
async def get_mission_messages(mission_id: str):
    """Get all agent messages for a mission."""
    if mission_id not in missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    # For now, return empty messages
    # In a full implementation, this would return A2A messages
    return {"messages": []}


@app.get("/api/mission/{mission_id}/blackboard")
async def get_mission_blackboard(mission_id: str):
    """Get the shared blackboard for a mission."""
    if mission_id not in missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    mission = missions[mission_id]
    
    # Extract blackboard data from results
    blackboard = {
        "target_info": {
            "url": mission["target"],
            "tech_stack": [],
            "open_ports": [],
            "services": {},
        },
        "vulnerabilities": [],
        "exploitation_results": mission["exploit_results"],
        "attack_paths": [],
    }
    
    # Extract vulnerabilities from recon results
    for result in mission["recon_results"]:
        if isinstance(result, dict) and "findings" in result:
            blackboard["vulnerabilities"].extend(result["findings"])
    
    return {"blackboard": blackboard}


@app.post("/api/mission/{mission_id}/cancel")
async def cancel_mission(mission_id: str):
    """Cancel a running mission."""
    if mission_id not in missions:
        raise HTTPException(status_code=404, detail="Mission not found")
    
    mission = missions[mission_id]
    if mission["status"] == "running":
        mission["status"] = "cancelled"
        return {"cancelled": True}
    
    return {"cancelled": False, "message": "Mission is not running"}


@app.get("/api/missions")
async def list_missions():
    """List all missions."""
    return {
        "missions": [
            {
                "mission_id": m["mission_id"],
                "target": m["target"],
                "status": m["status"],
                "phase": m["phase"],
                "created_at": m["created_at"],
            }
            for m in missions.values()
        ]
    }


# ============================================================
# SWARM FRONTEND API - Connect to Supabase
# ============================================================

@app.get("/api/swarm/missions")
async def list_swarm_missions(limit: int = 20, offset: int = 0):
    """List all swarm missions from Supabase."""
    if not SUPABASE_AVAILABLE or not supabase:
        # Fallback to in-memory missions
        return {
            "missions": [
                {
                    "id": m["mission_id"],
                    "target": m["target"],
                    "status": m["status"],
                    "phase": m.get("phase"),
                    "progress": m.get("progress", 0),
                    "iteration": m.get("iteration", 0),
                    "created_at": m["created_at"],
                }
                for m in list(missions.values())[:limit]
            ],
            "total": len(missions),
        }
    
    try:
        response = supabase.table("swarm_missions").select(
            "id, target, status, progress, current_phase, iteration, created_at, started_at, completed_at"
        ).order("created_at", desc=True).range(offset, offset + limit - 1).execute()
        
        return {
            "missions": response.data,
            "total": len(response.data),
        }
    except Exception as e:
        logger.error(f"Error fetching swarm missions: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/swarm/mission/{mission_id}")
async def get_swarm_mission(mission_id: str):
    """Get a specific swarm mission by ID."""
    if not SUPABASE_AVAILABLE or not supabase:
        # Fallback
        if mission_id in missions:
            m = missions[mission_id]
            return {
                "id": m["mission_id"],
                "target": m["target"],
                "status": m["status"],
                "progress": m.get("progress", 0),
                "iteration": m.get("iteration", 0),
                "phase": m.get("phase"),
                "created_at": m["created_at"],
            }
        raise HTTPException(status_code=404, detail="Mission not found")
    
    try:
        response = supabase.table("swarm_missions").select("*").eq("id", mission_id).execute()
        
        if not response.data:
            raise HTTPException(status_code=404, detail="Mission not found")
        
        return response.data[0]
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching mission {mission_id}: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/swarm/mission/{mission_id}/agents")
async def get_swarm_agent_states(mission_id: str):
    """Get all agent states for a mission."""
    if not SUPABASE_AVAILABLE or not supabase:
        return {"agents": []}
    
    try:
        response = supabase.table("swarm_agent_states").select(
            "id, agent_id, agent_name, agent_team, status, iter, task, last_updated, created_at"
        ).eq("mission_id", mission_id).execute()
        
        return {"agents": response.data}
    except Exception as e:
        logger.error(f"Error fetching agent states: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/swarm/mission/{mission_id}/events")
async def get_swarm_events(mission_id: str, limit: int = 100):
    """Get all events for a mission."""
    if not SUPABASE_AVAILABLE or not supabase:
        return {"events": []}
    
    try:
        response = supabase.table("swarm_events").select(
            "id, event_type, agent_name, stage, title, description, success, error_type, created_at, iteration"
        ).eq("mission_id", mission_id).order("created_at", desc=True).limit(limit).execute()
        
        return {"events": response.data}
    except Exception as e:
        logger.error(f"Error fetching events: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/swarm/mission/{mission_id}/findings")
async def get_swarm_findings(mission_id: str):
    """Get all findings for a mission."""
    if not SUPABASE_AVAILABLE or not supabase:
        return {"findings": []}
    
    try:
        response = supabase.table("swarm_findings").select(
            "id, title, severity, finding_type, confirmed, agent_name, target, endpoint, created_at"
        ).eq("mission_id", mission_id).execute()
        
        return {"findings": response.data}
    except Exception as e:
        logger.error(f"Error fetching findings: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/swarm/mission/{mission_id}/exploits")
async def get_swarm_exploit_attempts(mission_id: str, limit: int = 50):
    """Get exploit attempts for a mission."""
    if not SUPABASE_AVAILABLE or not supabase:
        return {"exploits": []}
    
    try:
        response = supabase.table("swarm_exploit_attempts").select(
            "id, exploit_type, target_url, success, response_code, error_type, created_at"
        ).eq("mission_id", mission_id).order("created_at", desc=True).limit(limit).execute()
        
        return {"exploits": response.data}
    except Exception as e:
        logger.error(f"Error fetching exploits: {e}")
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
