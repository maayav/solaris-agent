import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  triggerSwarmMission,
  getSwarmMission,
  getSwarmMissions,
  getSwarmAgentStates,
  getSwarmEvents,
  getSwarmFindings,
  getSwarmExploits,
  getSwarmTimelineEvents,
  getLatestSwarmMission,
  createSwarmWebSocket,
  type AgentStateResponse,
  type SwarmFindingResponse,
  type SwarmExploit,
  type SwarmExploitsResponse,
  type SwarmMission,
} from '../lib/api';
import { extractTokens, formatTokenDisplay } from '../lib/utils';

// Types
interface NodeDef {
  id: string;
  lbl: string;
  team: 'purple' | 'blue' | 'blue2' | 'red' | 'sand';
  x: number;
  y: number;
  z: number;
  r: number;
  desc: string;
}

interface EdgeDef {
  a: string;
  b: string;
  p: boolean;
}

interface AgentLog {
  t: string;
  k: string;
  m: string;
}

interface AgentData {
  team: string;
  eyebrow: string;
  name: string;
  status: string;
  iter: string;
  task: string;
  logs: AgentLog[];
}

interface Finding {
  sev: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  type: string;
  src: string;
  confirmed: boolean;
  agent: string;
  cve: string;
  description?: string;
  target?: string;
  endpoint?: string;
  evidence?: Record<string, any>;
}

// Constants
const NODES: NodeDef[] = [
  // Red Team - Attackers
  { id: 'red-cmd', lbl: 'COMMANDER', team: 'red', x: 0, y: 1.5, z: 0, r: 0.24, desc: 'Red Commander' },
  { id: 'alpha-recon', lbl: 'ALPHA RECON', team: 'red', x: -2.0, y: 0.0, z: 1.5, r: 0.18, desc: 'Alpha Recon' },
  { id: 'gamma-exploit', lbl: 'GAMMA EXPLOIT', team: 'red', x: 2.0, y: 0.0, z: 1.5, r: 0.18, desc: 'Gamma Exploit' },
  { id: 'critic', lbl: 'CRITIC', team: 'red', x: 0, y: -1.0, z: 2.0, r: 0.15, desc: 'Critic Agent' },
  // Sandbox - Testing Environment
  { id: 'sandbox', lbl: 'SANDBOX', team: 'sand', x: 0, y: -2.5, z: 0, r: 0.22, desc: 'vibecheck-sandbox' },
  // Supabase Bridge - Shows vuln data being pulled from DB
  { id: 'redis-pub', lbl: 'SUPABASE BRIDGE', team: 'blue2', x: -3.5, y: 0.5, z: -1.5, r: 0.16, desc: 'Vuln Data from Supabase' },
];

const EDGES: EdgeDef[] = [
  { a: 'redis-pub', b: 'red-cmd', p: true },
  { a: 'red-cmd', b: 'alpha-recon', p: false },
  { a: 'red-cmd', b: 'gamma-exploit', p: false },
  { a: 'red-cmd', b: 'critic', p: false },
  { a: 'alpha-recon', b: 'sandbox', p: true },
  { a: 'gamma-exploit', b: 'sandbox', p: true },
  { a: 'critic', b: 'sandbox', p: false },
];

// Team color configurations
const TC: Record<string, [number, number, number]> = {
  red: [0.92, 0.58, 0.58],
  blue2: [0.38, 0.56, 0.82],
  sand: [0.80, 0.70, 0.46],
};

const TC_CSS: Record<string, string> = {
  red: 'rgba(235,148,148,0.75)',
  blue2: 'rgba(97,143,210,0.65)',
  sand: 'rgba(200,175,118,0.80)',
};

// Shaders
const crystalVert = `
  attribute vec3 faceNormal;
  attribute float aFaceId;
  varying vec3 vFN;
  varying float vFaceId;
  void main() {
    vFN = normalize(normalMatrix * faceNormal);
    vFaceId = aFaceId;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const crystalFrag = `
  varying vec3 vFN;
  varying float vFaceId;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSelected;
  uniform float uPhase;
  void main() {
    vec3 N = normalize(vFN);
    float d1 = max(dot(N, normalize(vec3(-0.3, 1.0, 0.7))), 0.0);
    float d2 = max(dot(N, normalize(vec3(0.7, -0.4, 0.3))), 0.0) * 0.35;
    float d3 = max(dot(N, normalize(vec3(0.0, 0.0, 1.0))), 0.0) * 0.2;
    float light = 0.15 + d1 * 0.72 + d2 + d3;
    float fv = fract(sin(vFaceId * 127.1 + 311.7) * 43758.5) * 0.14;
    float spec = pow(max(dot(N, normalize(vec3(-0.3, 1.0, 0.7) + vec3(0.0, 0.0, 1.0))), 0.0), 32.0) * 0.55;
    float pulse = sin(uTime * 3.0 + uPhase) * 0.5 + 0.5;
    vec3 col = uColor * (light + fv + uSelected * pulse * 0.22);
    col += vec3(0.85, 0.92, 1.0) * spec * (0.4 + uSelected * 0.5);
    gl_FragColor = vec4(clamp(col, 0.0, 1.6), 0.78 + uSelected * 0.14);
  }
`;

const wireVert = `void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const wireFrag = `
  uniform vec3 uColor;
  uniform float uSelected;
  uniform float uTime;
  uniform float uPhase;
  void main() {
    float p = sin(uTime * 2.5 + uPhase) * 0.5 + 0.5;
    float a = 0.28 + uSelected * (0.28 + p * 0.22);
    gl_FragColor = vec4(uColor * 1.5, a);
  }
`;

const reticleVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const reticleFrag = `
  varying vec2 vUv;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSelected;
  uniform float uPhase;
  #define PI 3.14159265359
  #define TAU 6.28318530718
  void main() {
    vec2 uv = vUv - 0.5;
    float d = length(uv);
    float angle = atan(uv.y, uv.x);
    float norm = (angle + PI) / TAU;
    float rot1 = fract(norm + uTime * 0.07);
    float outerR = smoothstep(0.008, 0.0, abs(d - 0.44));
    float maj = step(fract(rot1 * 8.0), 0.05);
    float mino = step(fract(rot1 * 24.0), 0.03) * (1.0 - maj);
    float tickR = smoothstep(0.007, 0.0, abs(d - (0.44 + maj * 0.045 + mino * 0.022))) * (maj * 0.6 + mino * 0.35);
    float rot2 = fract(norm - uTime * 0.13 + uPhase);
    float dash = step(fract(rot2 * 12.0), 0.58);
    float innerR = smoothstep(0.007, 0.0, abs(d - 0.31)) * dash;
    float crossAngle = norm * 4.0;
    float crossA = fract(crossAngle + uTime * 0.29);
    float isCross = step(crossA, 0.06);
    float crossMask = step(0.32, d) * step(d, 0.42);
    float cross = isCross * crossMask * 0.45;
    float pipAngle = fract(norm * 4.0 + 0.125);
    float isPip = step(pipAngle, 0.08);
    float pipMask = smoothstep(0.008, 0.0, abs(d - 0.17)) * isPip;
    float a = (outerR * 0.65 + tickR + innerR * 0.5 + cross + pipMask * 0.8) * (0.38 + uSelected * 0.55);
    gl_FragColor = vec4(uColor + 0.2, a);
  }
`;

const bgVert = `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const bgFrag = `
  varying vec2 vUv;
  uniform float uTime;
  float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float n(vec2 p) { vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), u.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), u.x), u.y); }
  float fbm(vec2 p) { float v = 0.0, a = 0.5; for(int i = 0; i < 4; i++) { v += a * n(p); p *= 2.1; a *= 0.5; } return v; }
  void main() {
    vec2 uv = vUv;
    float n1 = fbm(uv * 2.2 + vec2(uTime * 0.012, uTime * 0.008));
    float n2 = fbm(uv * 4.5 - vec2(uTime * 0.007, uTime * 0.018));
    float blueZ = smoothstep(0.7, 0.1, uv.x) * smoothstep(0.0, 0.5, uv.y);
    float amberZ = smoothstep(0.3, 0.9, uv.x) * smoothstep(0.5, 0.9, uv.y);
    vec2 c = uv - 0.5;
    float vig = 1.0 - dot(c, c) * 1.1;
    vec3 col = vec3(0.010, 0.015, 0.022);
    col += vec3(0.02, 0.05, 0.12) * n1 * blueZ * 1.6;
    col += vec3(0.10, 0.06, 0.02) * n2 * amberZ * 0.8;
    col += vec3(0.005, 0.01, 0.025) * n1 * (1.0 - blueZ) * 0.5;
    col *= vig;
    gl_FragColor = vec4(col, 1.0);
  }
`;

function buildFlatGeo(baseGeo: THREE.BufferGeometry): THREE.BufferGeometry {
  const idx = baseGeo.toNonIndexed();
  const pos = idx.getAttribute('position');
  const count = pos.count;
  const faceNormals = new Float32Array(count * 3);
  const faceIds = new Float32Array(count);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), tmp = new THREE.Vector3();
  for (let i = 0; i < count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    tmp.crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize();
    const fid = i / 3;
    for (let v = 0; v < 3; v++) {
      faceNormals[(i + v) * 3] = tmp.x;
      faceNormals[(i + v) * 3 + 1] = tmp.y;
      faceNormals[(i + v) * 3 + 2] = tmp.z;
      faceIds[i + v] = fid;
    }
  }
  idx.setAttribute('faceNormal', new THREE.BufferAttribute(faceNormals, 3));
  idx.setAttribute('aFaceId', new THREE.BufferAttribute(faceIds, 1));
  return idx;
}

export function Swarm() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const tickerRef = useRef<HTMLDivElement>(null);
  const reportsBodyRef = useRef<HTMLDivElement>(null);
  const nodeMapRef = useRef<Record<string, {
    m: THREE.Mesh;
    wf: THREE.LineSegments;
    ret: THREE.Mesh;
    glow: THREE.Mesh;
    uniforms: { uColor: { value: THREE.Color }; uTime: { value: number }; uSelected: { value: number }; uPhase: { value: number } };
    wireUni: { uColor: { value: THREE.Color }; uTime: { value: number }; uSelected: { value: number }; uPhase: { value: number } };
    retUni: { uColor: { value: THREE.Color }; uTime: { value: number }; uSelected: { value: number }; uPhase: { value: number } };
    glowMat: THREE.MeshBasicMaterial;
    def: NodeDef;
  }>>({});
  const [selID, setSelID] = useState<string | null>('red-cmd');
  const selIDRef = useRef<string | null>('red-cmd');
  const [inspectorData, setInspectorData] = useState<AgentData | null>(null);
  const [inspectorId, setInspectorId] = useState<string>('red-cmd');
  const [logs, setLogs] = useState<AgentLog[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [terminalLines, setTerminalLines] = useState<{ t: string; s: string }[]>([]);
  const [execCount, setExecCount] = useState(0);
  const [findingsList, setFindingsList] = useState<Finding[]>([]);

  // Mission state
  const [missionId, setMissionId] = useState<string | null>(null);
  const [missionStatus, setMissionStatus] = useState<string>('idle');
  const [missionTarget, setMissionTarget] = useState<string>('');
  const [agentCount, setAgentCount] = useState<number>(0);
  const [confirmedFindingsCount, setConfirmedFindingsCount] = useState<number>(0);
  
  // Loading states
  const [isLoadingMission, setIsLoadingMission] = useState<boolean>(true);
  const [isLoadingFindings, setIsLoadingFindings] = useState<boolean>(false);
  const [isLoadingAgents, setIsLoadingAgents] = useState<boolean>(false);
  
  // Mission creation UI
  const [showMissionModal, setShowMissionModal] = useState<boolean>(false);
  const [isCreatingMission, setIsCreatingMission] = useState<boolean>(false);
  const [missionForm, setMissionForm] = useState({
    target: '',
    repoUrl: '',
    mode: 'live' as 'live' | 'static' | 'repo',
    objective: 'Execute a comprehensive security audit including: 1) Map attack surface, 2) Test for SQL injection, XSS, IDOR, auth bypass, 3) Attempt token hijacking and session manipulation, 4) Hunt for sensitive data exposure',
        maxIterations: 5
  });
  
  // Panel expand state
  const [terminalExpanded, setTerminalExpanded] = useState(false);
  const [findingsExpanded, setFindingsExpanded] = useState(false);
  const [reportsExpanded, setReportsExpanded] = useState(false);
  const [findingsFullscreen, setFindingsFullscreen] = useState(false);

  // Mission history
  const [missionHistory, setMissionHistory] = useState<SwarmMission[]>([]);
  const [showMissionHistory, setShowMissionHistory] = useState(false);
  const [loadingMissionHistory, setLoadingMissionHistory] = useState(false);
  const [historyStatusFilter, setHistoryStatusFilter] = useState<string>('all');
  const [historyOffset, setHistoryOffset] = useState(0);
  const [hasMoreMissions, setHasMoreMissions] = useState(true);
  const [loadingMoreMissions, setLoadingMoreMissions] = useState(false);

  // Expanded item state
  const [expandedFindingId, setExpandedFindingId] = useState<string | null>(null);
  const [expandedExploit, setExpandedExploit] = useState<SwarmExploit | null>(null);

  // Exploit data for reports
  const [exploitsList, setExploitsList] = useState<SwarmExploit[]>([]);
  const [isLoadingExploits, setIsLoadingExploits] = useState<boolean>(false);

  // Get mission ID from URL query params if provided
  const getMissionIdFromUrl = (): string | null => {
    const params = new URLSearchParams(window.location.search);
    return params.get('missionId');
  };

  // Load mission history
  const loadMissionHistory = async (loadMore = false) => {
    if (loadMore) {
      setLoadingMoreMissions(true);
    } else {
      setLoadingMissionHistory(true);
      setHistoryOffset(0);
    }
    
    try {
      const currentOffset = loadMore ? historyOffset : 0;
      const response = await getSwarmMissions(20, currentOffset);
      const missions = response.missions || [];
      
      // Apply status filter
      const filteredMissions = historyStatusFilter === 'all' 
        ? missions 
        : missions.filter(m => m.status === historyStatusFilter);
      
      if (loadMore) {
        setMissionHistory(prev => [...prev, ...filteredMissions]);
      } else {
        setMissionHistory(filteredMissions);
      }
      
      setHasMoreMissions(missions.length === 20);
      setHistoryOffset(currentOffset + missions.length);
    } catch (err) {
      console.error('[Swarm] Failed to load mission history:', err);
    } finally {
      setLoadingMissionHistory(false);
      setLoadingMoreMissions(false);
    }
  };
  
  // Handle status filter change
  const handleHistoryFilterChange = (filter: string) => {
    setHistoryStatusFilter(filter);
    setHistoryOffset(0);
    setHasMoreMissions(true);
    loadMissionHistory(false);
  };

  // View a mission from history
  const viewMissionFromHistory = async (mission: SwarmMission) => {
    console.log('[Swarm] Loading mission from history:', mission.id);
    setMissionId(mission.id);
    setMissionStatus(mission.status || 'pending');
    setMissionTarget(mission.target || '');
    setMissionProgress(mission.progress || 0);
    setShowMissionHistory(false);
    
    // Fetch full mission details
    try {
      const fullMission = await getSwarmMission(mission.id);
      setMissionStatus(fullMission.status || mission.status || 'pending');
      setMissionProgress(fullMission.progress || 0);
      setMissionTarget(fullMission.target || mission.target || '');
      
      // Fetch events
      const events = await getSwarmTimelineEvents(mission.id, 50);
      if (events.length > 0) {
        const newLines = events.slice(0, 20).map((e: any) => ({
          t: new Date(e.created_at).toLocaleTimeString(),
          s: `[${e.agent_name || 'system'}] ${e.title || e.event_type} ${e.description || ''}`
        }));
        setTerminalLines(newLines);
      }
      
      // Fetch findings
      const findings = await getSwarmFindings(mission.id);
      const findingsArray = Array.isArray(findings) ? findings : (findings?.findings || []);
      const mappedFindings: Finding[] = findingsArray.map((f: any) => ({
        sev: (f.severity || 'medium') as 'critical' | 'high' | 'medium' | 'low',
        title: f.title || 'Untitled Finding',
        type: f.finding_type || f.type || 'Unknown',
        src: f.source || 'Unknown',
        confirmed: f.confirmed || false,
        description: f.description || '',
        target: f.target || mission.target || '',
        endpoint: f.endpoint || '',
        evidence: f.evidence || {},
        createdAt: f.created_at || new Date().toISOString(),
      }));
      setFindingsList(mappedFindings);
      
      // Fetch exploits
      const exploitsResponse = await getSwarmExploits(mission.id, 500);
      const exploits = Array.isArray(exploitsResponse) ? exploitsResponse : (exploitsResponse?.exploits || []);
      setExploitsList(exploits);
      
      console.log('[Swarm] Loaded mission history:', fullMission.status, findingsArray.length, 'findings', exploits.length, 'exploits');
    } catch (err) {
      console.error('[Swarm] Failed to load mission details:', err);
    }
  };

  // Convert vertical wheel to horizontal scroll for Mission Reports
  useEffect(() => {
    const reportsBody = reportsBodyRef.current;
    if (!reportsBody) return;

    const handleWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        reportsBody.scrollLeft += e.deltaY;
      }
    };

    reportsBody.addEventListener('wheel', handleWheel, { passive: false });
    return () => reportsBody.removeEventListener('wheel', handleWheel);
  }, []);

  // Fetch latest mission with findings on page load
  useEffect(() => {
    const fetchLatestMission = async () => {
      try {
        setIsLoadingMission(true);
        console.log('[Swarm] Fetching missions from Supabase...');
        const missions = await getSwarmMissions(50, 0);
        
        // Check for mission ID in URL first
        const urlMissionId = getMissionIdFromUrl();
        if (urlMissionId) {
          console.log('[Swarm] Looking for mission from URL:', urlMissionId);
          const foundMission = missions.missions.find(m => m.id === urlMissionId);
          if (foundMission) {
            console.log('[Swarm] Found mission from URL:', foundMission.id, foundMission.status);
            setMissionId(foundMission.id);
            setMissionStatus(foundMission.status || 'running');
            setMissionTarget(foundMission.target || '');
            
            try {
              const mission = await getSwarmMission(foundMission.id);
              setMissionStatus(mission.status || 'running');
              setMissionProgress(mission.progress || 0);
              setMissionTarget(mission.target || '');
              console.log('[Swarm] Initial mission data:', mission.status, mission.progress);
              
              // Also fetch events and findings immediately
              const events = await getSwarmTimelineEvents(foundMission.id, 20);
              if (events.length > 0) {
                const newLines = events.slice(0, 10).map((e: any) => ({
                  t: new Date(e.created_at).toLocaleTimeString(),
                  s: `[${e.agent_name || 'system'}] ${e.title || e.event_type} ${e.description || ''}`
                }));
                setTerminalLines(newLines);
                console.log('[Swarm] Loaded initial events:', newLines.length);
              }
              
              const findings = await getSwarmFindings(foundMission.id);
              const findingsArray = Array.isArray(findings) ? findings : (findings?.findings || []);
              const mappedFindings: Finding[] = findingsArray.map((f: any) => ({
                sev: (f.severity || 'medium') as 'critical' | 'high' | 'medium' | 'low',
                title: f.title || 'Untitled Finding',
                type: f.finding_type || f.type || 'Unknown',
                src: f.source || 'Unknown',
                confirmed: f.confirmed || false,
                agent: f.agent_name || f.agent || 'Unknown',
                cve: f.cve_id || f.cve || '',
                description: f.description,
                target: f.target,
                endpoint: f.endpoint,
                evidence: f.evidence,
              }));
              setFindingsList(mappedFindings);
              setConfirmedFindingsCount(mappedFindings.filter(f => f.confirmed).length);
              console.log('[Swarm] Loaded findings:', mappedFindings.length);
            } catch (e) {
              console.error('[Swarm] Failed to fetch initial mission data:', e);
            }
            return;
          } else {
            console.log('[Swarm] Mission from URL not found in list, falling back to auto-select');
          }
        }
        
        // Find the latest mission (newest by created_at) - Remove hardcoded mission ID
        let autoSelectedMission = null;
        if (missions.missions.length > 0) {
          // Sort by created_at descending to get the newest first
          autoSelectedMission = missions.missions[0];
        }
        
        if (autoSelectedMission) {
          console.log('[Swarm] Selected latest mission:', autoSelectedMission.id, autoSelectedMission.status);
          setMissionId(autoSelectedMission.id);
          setMissionStatus(autoSelectedMission.status || 'running');
          setMissionTarget(autoSelectedMission.target || '');
          
          // Fetch initial data immediately
          try {
            const mission = await getSwarmMission(autoSelectedMission.id);
            setMissionStatus(mission.status || 'running');
            setMissionProgress(mission.progress || 0);
            setMissionTarget(mission.target || '');
            console.log('[Swarm] Initial mission data:', mission.status, mission.progress);
            
            // Also fetch events and findings immediately
            const events = await getSwarmTimelineEvents(autoSelectedMission.id, 20);
            if (events.length > 0) {
              const newLines = events.slice(0, 10).map((e: any) => ({
                t: new Date(e.created_at).toLocaleTimeString(),
                s: `[${e.agent_name || 'system'}] ${e.title || e.event_type} ${e.description || ''}`
              }));
              setTerminalLines(newLines);
              console.log('[Swarm] Loaded initial events:', newLines.length);
            }
            
            const findings = await getSwarmFindings(autoSelectedMission.id);
            const findingsArray = Array.isArray(findings) ? findings : (findings?.findings || []);
            const mappedFindings: Finding[] = findingsArray.map((f: any) => ({
              sev: (f.severity || 'medium') as 'critical' | 'high' | 'medium' | 'low',
              title: f.title || 'Untitled Finding',
              type: f.finding_type || f.type || 'Unknown',
              src: f.source || 'Unknown',
              confirmed: f.confirmed || false,
              agent: f.agent_name || f.agent || 'Unknown',
              cve: f.cve_id || f.cve || '',
              description: f.description,
              target: f.target,
              endpoint: f.endpoint,
              evidence: f.evidence,
            }));
            setFindingsList(mappedFindings);
            setConfirmedFindingsCount(mappedFindings.filter(f => f.confirmed).length);
            console.log('[Swarm] Loaded findings:', mappedFindings.length);
          } catch (e) {
            console.error('[Swarm] Failed to fetch initial mission data:', e);
          }
        } else {
          console.log('[Swarm] No missions found in database');
        }
      } catch (error) {
        console.error('[Swarm] Failed to fetch latest mission:', error);
      } finally {
        setIsLoadingMission(false);
      }
    };
    fetchLatestMission();
  }, []);
  const [missionProgress, setMissionProgress] = useState(0);
  const [agentStates, setAgentStates] = useState<Record<string, AgentStateResponse>>({});
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  // Clock
  useEffect(() => {
    const timer = setInterval(() => setElapsed(e => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (sec: number) => {
    const h = String(Math.floor(sec / 3600)).padStart(2, '0');
    const m = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
    const s = String(sec % 60).padStart(2, '0');
    return `${h}:${m}:${s}`;
  };

  // Three.js setup
  useEffect(() => {
    if (!canvasRef.current || !containerRef.current) return;

    const canvas = canvasRef.current;
    const container = containerRef.current;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x030406, 1);

    const scene = new THREE.Scene();
    const cam = new THREE.PerspectiveCamera(44, 1, 0.1, 80);
    cam.position.z = 13.5;

    const pivot = new THREE.Group();
    scene.add(pivot);

    const nodeByID: Record<string, NodeDef> = {};
    NODES.forEach(n => nodeByID[n.id] = n);

    // Background
    const bgMat = new THREE.ShaderMaterial({
      vertexShader: bgVert,
      fragmentShader: bgFrag,
      uniforms: { uTime: { value: 0 } },
      depthWrite: false,
    });
    const bgMesh = new THREE.Mesh(new THREE.PlaneGeometry(65, 45), bgMat);
    bgMesh.position.z = -20;
    scene.add(bgMesh);

    // Stars
    const sGeo = new THREE.BufferGeometry();
    const sPos = new Float32Array(220 * 3);
    for (let i = 0; i < 220; i++) {
      sPos[i * 3] = (Math.random() - 0.5) * 55;
      sPos[i * 3 + 1] = (Math.random() - 0.5) * 38;
      sPos[i * 3 + 2] = -11 + (Math.random() - 0.5) * 4;
    }
    sGeo.setAttribute('position', new THREE.BufferAttribute(sPos, 3));
    scene.add(new THREE.Points(sGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.038, transparent: true, opacity: 0.09 })));

    // Nodes
    const meshes: THREE.Mesh[] = [];
    const nodeMap: Record<string, {
      m: THREE.Mesh;
      wf: THREE.LineSegments;
      ret: THREE.Mesh;
      glow: THREE.Mesh;
      uniforms: { uColor: { value: THREE.Color }; uTime: { value: number }; uSelected: { value: number }; uPhase: { value: number } };
      wireUni: { uColor: { value: THREE.Color }; uTime: { value: number }; uSelected: { value: number }; uPhase: { value: number } };
      retUni: { uColor: { value: THREE.Color }; uTime: { value: number }; uSelected: { value: number }; uPhase: { value: number } };
      glowMat: THREE.MeshBasicMaterial;
      def: NodeDef;
    }> = {};

    NODES.forEach(def => {
      const [r, g, b] = TC[def.team];
      const ph = Math.random() * Math.PI * 2;

      const uniforms = {
        uColor: { value: new THREE.Color(r, g, b) },
        uTime: { value: 0 },
        uSelected: { value: 0 },
        uPhase: { value: ph },
      };

      const baseGeo = new THREE.OctahedronGeometry(def.r, 1);
      const scales: Record<string, [number, number, number]> = {
        purple: [1, 1.18, 1],
        blue: [0.88, 1.12, 0.88],
        blue2: [1, 1, 1],
        red: [1.08, 0.95, 1.08],
        sand: [1, 0.88, 1],
      };
      const [sx, sy, sz] = scales[def.team];
      const pa = baseGeo.getAttribute('position');
      for (let i = 0; i < pa.count; i++) {
        pa.setXYZ(i, pa.getX(i) * sx, pa.getY(i) * sy, pa.getZ(i) * sz);
      }
      pa.needsUpdate = true;
      baseGeo.computeVertexNormals();

      const mat = new THREE.ShaderMaterial({
        vertexShader: crystalVert,
        fragmentShader: crystalFrag,
        uniforms,
        transparent: true,
        side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(buildFlatGeo(baseGeo), mat);
      m.position.set(def.x, def.y, def.z);
      m.userData = { id: def.id, phase: ph };
      pivot.add(m);
      meshes.push(m);

      const wireUni = {
        uColor: { value: new THREE.Color(Math.min(r + 0.2, 1), Math.min(g + 0.2, 1), Math.min(b + 0.2, 1)) },
        uTime: { value: 0 },
        uSelected: { value: 0 },
        uPhase: { value: ph },
      };
      const wireMat = new THREE.ShaderMaterial({ vertexShader: wireVert, fragmentShader: wireFrag, uniforms: wireUni, transparent: true });
      const wf = new THREE.LineSegments(new THREE.EdgesGeometry(baseGeo, 12), wireMat);
      wf.position.set(def.x, def.y, def.z);
      pivot.add(wf);

      const retSize = def.r * 6.8;
      const retUni = {
        uColor: { value: new THREE.Color(r, g, b) },
        uTime: { value: 0 },
        uSelected: { value: 0 },
        uPhase: { value: ph },
      };
      const retMat = new THREE.ShaderMaterial({
        vertexShader: reticleVert,
        fragmentShader: reticleFrag,
        uniforms: retUni,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      const ret = new THREE.Mesh(new THREE.PlaneGeometry(retSize, retSize), retMat);
      ret.position.set(def.x, def.y, def.z);
      pivot.add(ret);

      const glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(r, g, b), transparent: true, opacity: 0.02, side: THREE.BackSide });
      const glow = new THREE.Mesh(new THREE.SphereGeometry(def.r * 3.5, 6, 6), glowMat);
      glow.position.set(def.x, def.y, def.z);
      pivot.add(glow);

      nodeMap[def.id] = { m, wf, ret, glow, uniforms, wireUni, retUni, glowMat, def };
    });

    // Store nodeMap in ref for external access
    nodeMapRef.current = nodeMap;

    // Edges
    const edgeObjs: { mat: THREE.LineBasicMaterial; ba: number }[] = [];
    EDGES.forEach(e => {
      const a = nodeByID[e.a];
      const b = nodeByID[e.b];
      const pts = [new THREE.Vector3(a.x, a.y, a.z), new THREE.Vector3(b.x, b.y, b.z)];
      const ba = e.p ? 0.12 : 0.05;
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: ba });
      pivot.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat));
      edgeObjs.push({ mat, ba });
    });

    // Particles
    const PC = 80;
    const pPos = new Float32Array(PC * 3);
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    pivot.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.038, transparent: true, opacity: 0.36 })));
    const pState = Array.from({ length: PC }, (_, i) => ({ eid: i % EDGES.length, t: Math.random(), spd: 0.003 + Math.random() * 0.006 }));

    // Controls
    let rX = 0.14, rY = 0, dragging = false, lx = 0, ly = 0, zoom = 13.5;

    canvas.addEventListener('mousedown', e => { dragging = true; lx = e.clientX; ly = e.clientY; });
    window.addEventListener('mouseup', () => { dragging = false; });
    window.addEventListener('mousemove', e => {
      if (!dragging) return;
      rY += (e.clientX - lx) * 0.007;
      rX += (e.clientY - ly) * 0.004;
      rX = Math.max(-0.85, Math.min(0.85, rX));
      lx = e.clientX;
      ly = e.clientY;
    });
    canvas.addEventListener('wheel', e => { zoom = Math.max(7.5, Math.min(20, zoom + e.deltaY * 0.016)); });

    // Raycasting
    const rc = new THREE.Raycaster();
    const mv = new THREE.Vector2();
    canvas.addEventListener('click', e => {
      const rect = canvas.getBoundingClientRect();
      mv.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      mv.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      rc.setFromCamera(mv, cam);
      const hits = rc.intersectObjects(meshes);
      if (hits.length) {
        const id = hits[0].object.userData.id as string;
        selIDRef.current = id;
        setSelID(id);
        openInspector(id);
      }
    });

    function openInspector(id: string) {
      setInspectorId(id);
      
      // Get node info
      const node = NODES.find(n => n.id === id);
      const team = node?.team || 'red';
      
      // Check if we already have agent state
      if (agentStates[id]) {
        const state = agentStates[id];
        setInspectorData({
          team: team,
          eyebrow: team === 'red' ? 'RED TEAM' : team === 'blue2' ? 'DATA SOURCE' : 'SHARED INFRA',
          name: id === 'red-cmd' ? 'Commander' : 
                id === 'alpha-recon' ? 'Alpha Recon' : 
                id === 'gamma-exploit' ? 'Gamma Exploit' : 
                id === 'critic' ? 'Critic Agent' :
                id === 'sandbox' ? 'Sandbox' :
                id === 'redis-pub' ? 'Supabase Bridge' : id,
          status: (state.status || 'unknown').toUpperCase(),
          iter: state.iter || 'N/A',
          task: state.task || 'No active task',
          logs: []
        });
      } else {
        setInspectorData({
          team: team,
          eyebrow: team === 'red' ? 'RED TEAM' : team === 'blue2' ? 'DATA SOURCE' : 'SHARED INFRA',
          name: id === 'red-cmd' ? 'Commander' : 
                id === 'alpha-recon' ? 'Alpha Recon' : 
                id === 'gamma-exploit' ? 'Gamma Exploit' : 
                id === 'critic' ? 'Critic Agent' :
                id === 'sandbox' ? 'Sandbox' :
                id === 'redis-pub' ? 'Supabase Bridge' : id,
          status: 'UNKNOWN',
          iter: 'N/A',
          task: 'Loading...',
          logs: []
        });
      }
    }

    // Resize
    function resize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      renderer.setSize(w, h);
      cam.aspect = w / h;
      cam.updateProjectionMatrix();
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    // Labels
    function updateLabels() {
      if (!labelsRef.current) return;
      const lo = labelsRef.current;
      lo.innerHTML = '';
      const rect = canvas.getBoundingClientRect();
      NODES.forEach(def => {
        const p = new THREE.Vector3(def.x, def.y, def.z);
        p.applyEuler(new THREE.Euler(rX, rY, 0, 'XYZ'));
        const proj = p.clone().project(cam);
        if (proj.z >= 1) return;
        const x = (proj.x * 0.5 + 0.5) * rect.width;
        const y = (1 - (proj.y * 0.5 + 0.5)) * rect.height;
        const lbl = document.createElement('div');
        lbl.className = 'nlabel' + (selIDRef.current === def.id ? ' sel' : '');
        lbl.style.left = x + 'px';
        lbl.style.top = (y + def.r * 60 + 10) + 'px';
        lbl.style.color = TC_CSS[def.team];
        lbl.style.opacity = String(Math.max(0.2, Math.min(1, (p.z + 8) / 16 + 0.2)));
        lbl.textContent = def.lbl;
        lo.appendChild(lbl);
      });
    }

    // Ticker
    const activeEdges = new Set<number>();
    let edgeTmr = 0;
    function addTick(a: string, b: string) {
      if (!tickerRef.current) return;
      const d = document.createElement('div');
      d.className = 'tick';
      d.innerHTML = `<div class="tick-line"></div>${a} <span style="color:var(--amber);opacity:.5">→</span> ${b}`;
      tickerRef.current.appendChild(d);
      setTimeout(() => d.remove(), 4000);
      if (tickerRef.current.children.length > 4) tickerRef.current.firstChild?.remove();
    }

    // Render loop
    let T = 0;
    const _quat = new THREE.Quaternion();
    const _euler = new THREE.Euler();
    let rafId: number;

    function loop() {
      rafId = requestAnimationFrame(loop);
      T += 0.016;
      pivot.rotation.x = rX;
      pivot.rotation.y = rY;
      cam.position.z = zoom;
      bgMat.uniforms.uTime.value = T;

      _euler.set(-rX, -rY, 0, 'YXZ');
      _quat.setFromEuler(_euler);

      NODES.forEach(def => {
        const nm = nodeMap[def.id];
        if (!nm) return;
        const sel = def.id === selIDRef.current ? 1.0 : 0.0;
        nm.uniforms.uTime.value = T;
        nm.uniforms.uSelected.value += (sel - nm.uniforms.uSelected.value) * 0.10;
        nm.wireUni.uTime.value = T;
        nm.wireUni.uSelected.value = nm.uniforms.uSelected.value;
        nm.retUni.uTime.value = T;
        nm.retUni.uSelected.value = nm.uniforms.uSelected.value;
        nm.ret.quaternion.copy(_quat);
        nm.m.rotation.y = T * 0.20 + def.y * 0.4;
        nm.wf.rotation.y = nm.m.rotation.y;
        const ts = 1.0 + nm.uniforms.uSelected.value * 0.13;
        nm.m.scale.setScalar(nm.m.scale.x + (ts - nm.m.scale.x) * 0.08);
        nm.wf.scale.copy(nm.m.scale);
        nm.glowMat.opacity = 0.015 + nm.uniforms.uSelected.value * 0.055;
      });

      edgeTmr += 0.016;
      if (edgeTmr > 1.0) {
        edgeTmr = 0;
        const idx = Math.floor(Math.random() * EDGES.length);
        activeEdges.add(idx);
        setTimeout(() => activeEdges.delete(idx), 1600);
        const e = EDGES[idx];
        addTick(nodeByID[e.a].desc, nodeByID[e.b].desc);
      }
      edgeObjs.forEach(({ mat, ba }, i) => {
        const t = activeEdges.has(i) ? Math.min(0.65, ba + 0.45) : ba;
        mat.opacity += (t - mat.opacity) * 0.1;
      });

      pState.forEach((ps, i) => {
        ps.t = (ps.t + ps.spd) % 1;
        const e = EDGES[ps.eid];
        const a = nodeByID[e.a];
        const b = nodeByID[e.b];
        pPos[i * 3] = a.x + (b.x - a.x) * ps.t;
        pPos[i * 3 + 1] = a.y + (b.y - a.y) * ps.t;
        pPos[i * 3 + 2] = a.z + (b.z - a.z) * ps.t;
      });
      pGeo.attributes.position.needsUpdate = true;
      updateLabels();
      renderer.render(scene, cam);
    }
    loop();

    return () => {
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.dispose();
    };
  }, []);

  // Terminal animation - Only show when no mission is active
  useEffect(() => {
    // Don't show mock data - terminal will show real data when missionId exists
  }, [missionId]);

  // Findings animation - DISABLED - using real data from Supabase instead
  useEffect(() => {
    // Mock findings disabled - real data comes from Supabase via fetchFindings
    // The fetchFindings function now populates findingsList with real data
    return () => {};
  }, []);

  const nodeByID: Record<string, NodeDef> = {};
  NODES.forEach(n => nodeByID[n.id] = n);

  const getLogClass = (k: string) => {
    switch (k) {
      case 'info': return 'text-[rgba(140,190,240,0.75)]';
      case 'warn': return 'text-[#c8a96e]';
      case 'error': return 'text-[rgba(240,140,140,0.85)]';
      case 'action': return 'text-[rgba(255,255,255,0.52)]';
      case 'success': return 'text-[rgba(150,210,170,0.8)]';
      case 'cmd': return 'text-[rgba(230,170,110,0.85)]';
      default: return 'text-[rgba(255,255,255,0.28)]';
    }
  };

  // Fetch agent states from API
  const fetchAgentStates = useCallback(async () => {
    if (!missionId) return;
    try {
      setIsLoadingAgents(true);
      const states: any = await getSwarmAgentStates(missionId);
      console.log('[Swarm] Agent states response:', states);
      
      // Handle both array response and object with agents property
      const statesArray = Array.isArray(states) ? states : (states.agents || []);
      
      // Map agent names to node IDs
      const agentNameToNodeId: Record<string, string> = {
        'Red Commander': 'red-cmd',
        'Alpha Recon': 'alpha-recon',
        'Gamma Exploit': 'gamma-exploit',
        'Critic Agent': 'critic',
        'Sandbox Container': 'sandbox',
        'Supabase Bridge': 'redis-pub',
        // Also map short names
        'commander': 'red-cmd',
        'alpha': 'alpha-recon',
        'gamma': 'gamma-exploit',
        'critic': 'critic',
      };
      
      const statesMap: Record<string, any> = {};
      statesArray.forEach((state: any) => {
        // Use agent_name to find the node ID
        const nodeId = agentNameToNodeId[state.agent_name] || state.agent_name;
        statesMap[nodeId] = state;
      });
      console.log('[Swarm] Mapped agent states:', Object.keys(statesMap));
      setAgentStates(statesMap);
      setAgentCount(Object.keys(statesMap).length);
    } catch (error) {
      console.error('Failed to fetch agent states:', error);
    } finally {
      setIsLoadingAgents(false);
    }
  }, [missionId]);

  // Fetch mission status
  const fetchMissionStatus = useCallback(async () => {
    if (!missionId) return;
    try {
      console.log('[Swarm] Fetching mission status for:', missionId);
      const mission: any = await getSwarmMission(missionId);
      console.log('[Swarm] Mission response:', mission);
      
      // Handle various response formats
      const status = mission.status || mission.mission_status || 'unknown';
      const progress = mission.progress || 0;
      
      console.log('[Swarm] Mission status:', { status, progress, target: mission.target });
      setMissionStatus(status);
      setMissionProgress(progress);
    } catch (error) {
      console.error('[Swarm] Failed to fetch mission status:', error);
    }
  }, [missionId]);

  // Fetch findings
  const fetchFindings = useCallback(async () => {
    if (!missionId) {
      console.log('[Swarm] No missionId - skipping fetchFindings');
      return;
    }
    try {
      setIsLoadingFindings(true);
      console.log('[Swarm] Fetching findings for mission:', missionId);
      const findings: any = await getSwarmFindings(missionId);
      console.log('[Swarm] Findings response type:', typeof findings, Array.isArray(findings) ? 'array' : 'object');
      console.log('[Swarm] Findings response:', findings);
      
      // Handle both array response and {findings: [...]} response
      const findingsArray = Array.isArray(findings) ? findings : (findings?.findings || []);
      console.log('[Swarm] Number of findings:', findingsArray.length);
      
      const mappedFindings: Finding[] = findingsArray.map((f: any) => ({
        sev: (f.severity || 'medium') as 'critical' | 'high' | 'medium' | 'low',
        title: f.title || 'Untitled Finding',
        type: f.finding_type || f.type || 'Unknown',
        src: f.source || 'Unknown',
        confirmed: f.confirmed || false,
        agent: f.agent_name || f.agent || 'Unknown',
        cve: f.cve_id || f.cve || '',
        description: f.description,
        target: f.target,
        endpoint: f.endpoint,
        evidence: f.evidence,
      }));
      console.log('[Swarm] Mapped findings count:', mappedFindings.length);
      setFindingsList(mappedFindings);
      setConfirmedFindingsCount(mappedFindings.filter(f => f.confirmed).length);
    } catch (error) {
      console.error('[Swarm] Failed to fetch findings:', error);
    } finally {
      setIsLoadingFindings(false);
    }
  }, [missionId]);

  // Fetch exploits for reports
  const fetchExploits = useCallback(async () => {
    if (!missionId) {
      console.log('[Swarm] No missionId - skipping fetchExploits');
      return;
    }
    try {
      setIsLoadingExploits(true);
      console.log('[Swarm] Fetching exploits for mission:', missionId);
      const exploitsResponse: SwarmExploitsResponse = await getSwarmExploits(missionId, 100);
      console.log('[Swarm] Exploits response:', exploitsResponse);
      
      const exploits = Array.isArray(exploitsResponse) ? exploitsResponse : (exploitsResponse?.exploits || []);
      console.log('[Swarm] Number of exploits:', exploits.length);
      
      setExploitsList(exploits);
    } catch (error) {
      console.error('[Swarm] Failed to fetch exploits:', error);
    } finally {
      setIsLoadingExploits(false);
    }
  }, [missionId]);

  // Initial fetch of exploits when mission changes
  useEffect(() => {
    if (missionId) {
      fetchExploits();
    }
  }, [missionId, fetchExploits]);

  // Fetch events for terminal
  const fetchAllEvents = useCallback(async () => {
    if (!missionId) return;
    try {
      // Use timeline-events for better formatted data
      console.log('[Swarm] Fetching timeline events for mission:', missionId);
      const events = await getSwarmTimelineEvents(missionId, 20);
      console.log('[Swarm] Timeline events response:', events.length, 'events');
      
      if (events.length > 0) {
        // Convert events to terminal format - newest first
        const newLines = events.slice(0, 10).map((e: any) => {
          const fullMessage = e.description && e.description.length > 10 
            ? `${e.title}: ${e.description}` 
            : (e.title || e.event_type || 'Event');
          return {
            t: new Date(e.created_at).toLocaleTimeString(),
            s: `[${e.agent_name || 'system'}] ${fullMessage}`
          };
        });
        
        // Replace terminal with real events when mission is active
        setTerminalLines(newLines);
        console.log('[Swarm] Added', newLines.length, 'events to terminal');
      }
    } catch (error) {
      console.error('[Swarm] Failed to fetch events:', error);
    }
  }, [missionId]);

  // Fetch events for selected agent
  const fetchAgentEvents = useCallback(async (agentId: string) => {
    if (!missionId) return;
    try {
      // Map node IDs to short agent names
      const nodeIdToShortName: Record<string, string> = {
        'purple-cmd': 'commander',
        'red-cmd': 'commander',
        'alpha-recon': 'alpha',
        'gamma-exploit': 'gamma',
        'critic': 'critic',
        'kg-agent': 'knowledge-graph',
        'sast-agent': 'sast',
        'llm-verify': 'llm-verifier',
        'traffic-mon': 'traffic-monitor',
        'sig-detect': 'signature-detector',
        'redis-pub': 'redis-bridge',
        'sandbox': 'sandbox',
      };
      
      const shortAgentName = nodeIdToShortName[agentId] || agentId;
      
      console.log('[Swarm] Fetching timeline events for agent:', shortAgentName, 'mission:', missionId);
      
      // Use timeline-events for better formatted data
      const events = await getSwarmTimelineEvents(missionId, 50, shortAgentName);
      console.log('[Swarm] Timeline events response count:', events.length);
      
      const mappedLogs: AgentLog[] = events.map((e: any) => ({
        t: new Date(e.created_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
        k: e.event_type || 'info',
        m: e.title || e.description || e.event_type || 'Event'
      }));
      console.log('[Swarm] Mapped logs count:', mappedLogs.length);
      setLogs(mappedLogs.reverse());
    } catch (error) {
      console.error('[Swarm] Failed to fetch agent events:', error);
    }
  }, [missionId]);

  // Start a new mission
  const startMission = useCallback(async () => {
    try {
      setIsCreatingMission(true);
      console.log('[Swarm] Starting new mission:', missionForm);
      
      const request: any = {
        target: missionForm.target,
        mode: missionForm.mode,
        objective: missionForm.objective,
        max_iterations: missionForm.maxIterations,
      };
      
      // Add repo-specific parameters
      if (missionForm.mode === 'repo' && missionForm.repoUrl) {
        request.repo_url = missionForm.repoUrl;
        request.auto_deploy = true;
      }
      
      const response = await triggerSwarmMission(request);
      console.log('[Swarm] Mission started:', {
        mission_id: response.mission_id,
        status: response.status,
        target: response.target
      });
      
      setMissionId(response.mission_id);
      setMissionStatus('pending');
      setMissionProgress(0);
      setMissionTarget(missionForm.target);
      setShowMissionModal(false);
      
      // Reset form
      setMissionForm({
        target: '',
        repoUrl: '',
        mode: 'live',
        objective: 'Execute a comprehensive security audit including: 1) Map attack surface, 2) Test for SQL injection, XSS, IDOR, auth bypass, 3) Attempt token hijacking and session manipulation, 4) Hunt for sensitive data exposure',
    maxIterations: 5
      });
      
      // Add to terminal
      setTerminalLines(prev => [...prev,
        { t: new Date().toLocaleTimeString(), s: `Mission ${response.mission_id.slice(0, 8)}... started` },
        { t: new Date().toLocaleTimeString(), s: `Target: ${missionForm.target}` },
        { t: new Date().toLocaleTimeString(), s: `Mode: ${missionForm.mode}` },
        ...(missionForm.repoUrl ? [{ t: new Date().toLocaleTimeString(), s: `Repository: ${missionForm.repoUrl}` }] : []),
      ]);
    } catch (error) {
      console.error('[Swarm] Failed to start mission:', error);
      setTerminalLines(prev => [...prev,
        { t: new Date().toLocaleTimeString(), s: `Error: Failed to start mission` },
        { t: new Date().toLocaleTimeString(), s: `Details: ${error instanceof Error ? error.message : 'Unknown error'}` },
      ]);
    } finally {
      setIsCreatingMission(false);
    }
  }, [missionForm]);

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (!missionId) return;

    console.log('[Swarm] Attempting WebSocket connection for mission:', missionId);
    
    try {
      const ws = createSwarmWebSocket(
        missionId,
        (message) => {
          console.log('[Swarm] WebSocket message received:', message);
          
          // Handle different message types
          switch (message.type) {
            case 'agent_state_update':
              fetchAgentStates();
              break;
            case 'new_finding':
              fetchFindings();
              fetchExploits(); // Also update exploits when new findings come in
              break;
            case 'mission_update':
              fetchMissionStatus();
              break;
            case 'new_event':
              fetchAllEvents();
              fetchExploits(); // Update exploits when new events occur
              break;
            default:
              console.log('[Swarm] Unknown WebSocket message type:', message.type);
          }
        },
        () => {
          console.log('[Swarm] WebSocket connected');
          setWsConnected(true);
        },
        () => {
          console.log('[Swarm] WebSocket disconnected');
          setWsConnected(false);
        }
      );
      
      wsRef.current = ws;
      
      // Cleanup WebSocket on unmount
      return () => {
        if (wsRef.current) {
          console.log('[Swarm] Cleaning up WebSocket');
          wsRef.current.close();
          wsRef.current = null;
        }
      };
      
    } catch (error) {
      console.error('[Swarm] WebSocket connection failed, falling back to polling:', error);
      setWsConnected(false);
    }
    
  }, [missionId, fetchAgentStates, fetchFindings, fetchExploits, fetchMissionStatus, fetchAllEvents]);

  // Poll for updates only when mission is pending/running and WebSocket is not connected
  useEffect(() => {
    if (!missionId) {
      return;
    }
    
    // Don't poll for completed or cancelled missions
    if (missionStatus === 'cancelled' || missionStatus === 'completed') {
      return;
    }

    // If WebSocket is connected, poll less frequently (just for backup)
    const pollInterval = wsConnected ? 30000 : 10000; // 30s with WS, 10s without
    
    // Staggered polling to reduce server load
    const interval = setInterval(async () => {
      try {
        // Fetch mission status first
        await fetchMissionStatus();
        
        // If WebSocket is connected, skip other calls as they'll be triggered by WS events
        if (wsConnected) {
          return;
        }
        
        // Wait a bit before next call
        setTimeout(async () => {
          try {
            await fetchAgentStates();
          } catch (e) {
            console.error('[Swarm] Failed to fetch agent states:', e);
          }
        }, 1000);
        
        // Wait more before findings
        setTimeout(async () => {
          try {
            await fetchFindings();
            await fetchExploits(); // Also fetch exploits with findings
          } catch (e) {
            console.error('[Swarm] Failed to fetch findings/exploits:', e);
          }
        }, 2000);
        
        // Wait more before events
        setTimeout(async () => {
          try {
            await fetchAllEvents();
          } catch (e) {
            console.error('[Swarm] Failed to fetch events:', e);
          }
        }, 3000);
        
      } catch (e) {
        console.error('[Swarm] Failed to fetch mission status:', e);
      }
    }, pollInterval);

    return () => clearInterval(interval);
  }, [missionId, missionStatus, wsConnected, fetchMissionStatus, fetchAgentStates, fetchFindings, fetchExploits, fetchAllEvents]);

  // Update inspector data when agent states change
  useEffect(() => {
    if (inspectorId && agentStates[inspectorId]) {
      const state = agentStates[inspectorId];
      // Get the team color for this node
      const node = NODES.find(n => n.id === inspectorId);
      const team = node?.team || 'red';
      
      setInspectorData(prev => prev ? {
        ...prev,
        status: (state.status || 'unknown').toUpperCase(),
        iter: state.iter || 'N/A',
        task: state.task || 'No active task',
      } : null);
    }
  }, [agentStates, inspectorId]);

  // Fetch real agent logs when inspector is opened
  useEffect(() => {
    if (!missionId || !inspectorId) return;
    
    // Fetch agent events from database
    const fetchAgentLogs = async () => {
      try {
        // The database uses short agent names like 'alpha', 'gamma', 'critic'
        // Map node IDs to short agent names
        const nodeIdToShortName: Record<string, string> = {
          'purple-cmd': 'commander',
          'red-cmd': 'commander',
          'alpha-recon': 'alpha',
          'gamma-exploit': 'gamma',
          'critic': 'critic',
          'kg-agent': 'knowledge-graph',
          'sast-agent': 'sast',
          'llm-verify': 'llm-verifier',
          'traffic-mon': 'traffic-monitor',
          'sig-detect': 'signature-detector',
          'redis-pub': 'redis-bridge',
          'sandbox': 'sandbox',
        };
        
        const shortAgentName = nodeIdToShortName[inspectorId] || inspectorId;
        
        console.log('[Swarm] Fetching logs for agent node:', inspectorId, '-> short name:', shortAgentName);
        
        // Use timeline-events for better formatted data
        let events = await getSwarmTimelineEvents(missionId, 50, shortAgentName);
        
        // If no results, try with node ID
        if (events.length === 0) {
          console.log('[Swarm] No events with short name, trying node ID:', inspectorId);
          events = await getSwarmTimelineEvents(missionId, 50, inspectorId);
        }
        
        // If still no results, fetch ALL events for the mission
        if (events.length === 0) {
          console.log('[Swarm] No agent-specific events, fetching all mission events');
          events = await getSwarmTimelineEvents(missionId, 50);
        }
        
        console.log('[Swarm] Agent logs response:', events.length, 'events');
        
        if (events.length > 0) {
          const mappedLogs: AgentLog[] = events.map((e: any) => ({
            t: new Date(e.created_at).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }),
            k: e.event_type || 'info',
            m: e.description && e.description.length > 10 ? `${e.title}: ${e.description}` : (e.title || e.event_type || 'Event')
          }));
          setLogs(mappedLogs.reverse());
          console.log('[Swarm] Set agent logs:', mappedLogs.length);
        }
      } catch (error) {
        console.error('[Swarm] Failed to fetch agent logs:', error);
      }
    };
    
    fetchAgentLogs();
  }, [missionId, inspectorId]);

  // Update 3D node colors based on agent states
  useEffect(() => {
    const nodeMap = nodeMapRef.current;
    if (!nodeMap || Object.keys(nodeMap).length === 0) return;

    // Define status colors
    const statusColors: Record<string, [number, number, number]> = {
      // Agent is running/active - bright green
      'running': [0.4, 0.9, 0.4],
      'active': [0.4, 0.9, 0.4],
      'executing': [0.4, 0.9, 0.4],
      // Agent completed - amber/gold
      'completed': [0.9, 0.7, 0.3],
      'done': [0.9, 0.7, 0.3],
      'success': [0.9, 0.7, 0.3],
      // Agent failed/error - red
      'failed': [0.9, 0.3, 0.3],
      'error': [0.9, 0.3, 0.3],
      // Agent idle - use team color (will be handled below)
      'idle': [0, 0, 0],
      'pending': [0, 0, 0],
    };

    Object.entries(agentStates).forEach(([nodeId, state]) => {
      const node = nodeMap[nodeId];
      if (!node) return;

      const stateAny = state as any;
      const status = (stateAny.status || '').toLowerCase();
      const teamColor = TC[node.def.team];

      let color: [number, number, number];
      if (statusColors[status] && statusColors[status][0] !== 0) {
        color = statusColors[status];
      } else {
        // Use team color for idle/pending states
        color = teamColor;
      }

      // Update node color uniforms
      node.uniforms.uColor.value.setRGB(color[0], color[1], color[2]);
      node.wireUni.uColor.value.setRGB(
        Math.min(color[0] + 0.2, 1),
        Math.min(color[1] + 0.2, 1),
        Math.min(color[2] + 0.2, 1)
      );
      node.retUni.uColor.value.setRGB(color[0], color[1], color[2]);
      node.glowMat.color.setRGB(color[0], color[1], color[2]);
    });

    console.log('[Swarm] Updated 3D node colors based on agent states');
  }, [agentStates]);

  return (
    <div
      className="w-full h-screen overflow-hidden text-[rgba(255,255,255,0.52)] font-mono text-[8px] leading-relaxed"
      style={{
        background: '#030406',
        fontFamily: "'JetBrains Mono', monospace",
        '--void': '#030406',
        '--deep': '#060a10',
        '--chamber': '#0b1220',
        '--veil': 'rgba(255,255,255,0.04)',
        '--veil2': 'rgba(255,255,255,0.08)',
        '--veil3': 'rgba(255,255,255,0.14)',
        '--mist': 'rgba(255,255,255,0.28)',
        '--fog': 'rgba(255,255,255,0.52)',
        '--light': 'rgba(255,255,255,0.82)',
        '--white': 'rgba(255,255,255,0.95)',
        '--amber': '#c8a96e',
        '--amber-dim': 'rgba(200,169,110,0.12)',
        '--amber-glow': 'rgba(200,169,110,0.06)',
        '--amber-edge': 'rgba(200,169,110,0.22)',
        '--crit': 'rgba(240,140,140,0.85)',
        '--high': 'rgba(230,170,110,0.85)',
        '--med': 'rgba(200,200,140,0.80)',
        '--low': 'rgba(140,180,210,0.75)',
      } as React.CSSProperties}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,600;1,300;1,400;1,600&family=JetBrains+Mono:wght@300;400;500&display=swap');
        
        @keyframes appReveal { to { opacity: 1; } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.25; } }
        @keyframes ticklife { 
          0% { opacity: 0; transform: translateY(3px); } 
          8% { opacity: 1; transform: none; } 
          72% { opacity: 1; } 
          100% { opacity: 0; } 
        }
        @keyframes lefade { from { opacity: 0; transform: translateX(5px); } to { opacity: 1; } }
        @keyframes cur { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }
        
        .logs::-webkit-scrollbar { width: 2px; }
        .logs::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 2px; }
        .trm-body::-webkit-scrollbar { width: 2px; }
        .trm-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
        .rpt-body::-webkit-scrollbar { width: 2px; }
        .rpt-body::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); }
        
        .nlabel { 
          position: absolute; 
          transform: translate(-50%, 0); 
          font-size: 7.5px; 
          letter-spacing: 0.14em; 
          white-space: nowrap; 
          text-align: center; 
          pointer-events: none; 
          line-height: 1.6; 
          color: rgba(255,255,255,0.28); 
          transition: color 0.3s, opacity 0.3s; 
        }
        .nlabel.sel { color: rgba(255,255,255,0.95); }
        
        .tick { 
          font-size: 7.5px; 
          letter-spacing: 0.1em; 
          color: rgba(255,255,255,0.28); 
          animation: ticklife 4s ease forwards; 
          display: flex; 
          align-items: center; 
          gap: 8px; 
        }
        .tick-line { width: 24px; height: 1px; background: rgba(200,169,110,0.22); }
        
        .le { 
          display: flex; 
          gap: 8px; 
          font-size: 8px; 
          line-height: 1.65; 
          padding: 2.5px 0; 
          border-bottom: 1px solid rgba(255,255,255,0.022); 
          animation: lefade 0.4s ease; 
        }
        
        .cur { 
          display: inline-block; 
          width: 5px; 
          height: 9px; 
          background: rgba(200,169,110,0.6); 
          vertical-align: text-bottom; 
          margin-left: 2px; 
          animation: cur 1.2s step-end infinite; 
        }
      `}</style>

      <div
        className="relative z-10 grid h-screen opacity-0"
        style={{
          gridTemplateRows: 'auto 1fr 200px 200px',
          animation: 'appReveal 1.2s cubic-bezier(0.16,1,0.3,1) 0.8s forwards',
        }}
      >
        {/* Header */}
        <header
          className="flex items-center px-7 relative z-50"
          style={{
            background: 'linear-gradient(180deg, rgba(3,4,6,0.95) 0%, rgba(3,4,6,0.6) 100%)',
            backdropFilter: 'blur(24px)',
            borderBottom: '1px solid rgba(255,255,255,0.08)',
          }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-[1px]"
            style={{
              background: 'linear-gradient(90deg, transparent 0%, rgba(200,169,110,0.22) 20%, rgba(200,169,110,0.5) 50%, rgba(200,169,110,0.22) 80%, transparent 100%)',
            }}
          />
          <div
            className="text-xl font-light tracking-[0.25em] uppercase shrink-0 leading-none"
            style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.95)' }}
          >
            Vibe<em className="font-semibold not-italic text-[#c8a96e] tracking-[0.1em]">Check</em>
          </div>
          <div className="w-[1px] h-[18px] bg-[rgba(255,255,255,0.08)] mx-6 shrink-0" />
          <div className="flex items-center gap-[7px] text-[8px] tracking-[0.18em] text-[rgba(255,255,255,0.28)]">
            <div
              className="w-[5px] h-[5px] rounded-full"
              style={{
                backgroundColor: wsConnected ? '#4ade80' : '#c8a96e',
                boxShadow: wsConnected 
                  ? '0 0 8px rgba(74,222,128,0.4), 0 0 16px rgba(74,222,128,0.1)' 
                  : '0 0 8px rgba(200,169,110,0.22), 0 0 16px rgba(200,169,110,0.06)',
                animation: 'pulse 2.8s ease-in-out infinite',
              }}
            />
            <span>{wsConnected ? 'REAL-TIME' : 'POLLING'}</span>
          </div>
          <div className="w-[1px] h-[18px] bg-[rgba(255,255,255,0.08)] mx-6 shrink-0" />
          <div className="flex items-center gap-[7px] text-[8px] tracking-[0.18em] text-[rgba(255,255,255,0.28)]">
            <div
              className="w-[5px] h-[5px] rounded-full bg-[#c8a96e]"
              style={{
                boxShadow: '0 0 8px rgba(200,169,110,0.22), 0 0 16px rgba(200,169,110,0.06)',
                animation: 'pulse 2.8s ease-in-out infinite',
              }}
            />
            <span>MISSION ACTIVE</span>
          </div>
          <div className="w-[1px] h-[18px] bg-[rgba(255,255,255,0.08)] mx-6 shrink-0" />
          <div className="flex items-center gap-[7px] text-[8px] tracking-[0.18em] text-[rgba(255,255,255,0.28)]">
            ID <b className="text-[rgba(255,255,255,0.52)] font-normal">
              {isLoadingMission ? 'loading...' : (missionId ? missionId.slice(0, 8) : 'none')}
            </b>
          </div>
          <div className="w-[1px] h-[18px] bg-[rgba(255,255,255,0.08)] mx-6 shrink-0" />
          <div className="flex items-center gap-[7px] text-[8px] tracking-[0.18em] text-[rgba(255,255,255,0.28)]">
            TARGET <b className="text-[rgba(255,255,255,0.52)] font-normal">
              {isLoadingMission ? 'loading...' : (missionTarget || 'unknown')}
            </b>
          </div>
          <div className="ml-auto flex items-center gap-0">
            <div className="flex flex-col items-center px-5 gap-[2px] border-l border-[rgba(255,255,255,0.04)]">
              <div
                className="text-lg font-light leading-none tracking-[0.06em]"
                style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.95)' }}
              >
                {isLoadingAgents ? '...' : (agentCount || NODES.length)}
              </div>
              <div className="text-[7px] tracking-[0.2em] text-[rgba(255,255,255,0.28)]">AGENTS</div>
            </div>
            <div className="flex flex-col items-center px-5 gap-[2px] border-l border-[rgba(255,255,255,0.04)]">
              <div
                className="text-lg font-light leading-none tracking-[0.06em]"
                style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(230,170,110,0.85)' }}
              >
                {isLoadingFindings ? '...' : findingsList.length}
              </div>
              <div className="text-[7px] tracking-[0.2em] text-[rgba(255,255,255,0.28)]">FINDINGS</div>
            </div>
            <div className="flex flex-col items-center px-5 gap-[2px] border-l border-r border-[rgba(255,255,255,0.04)]">
              <div
                className="text-lg font-light leading-none tracking-[0.06em]"
                style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(150,210,170,0.9)' }}
              >
                {isLoadingFindings ? '...' : confirmedFindingsCount}
              </div>
              <div className="text-[7px] tracking-[0.2em] text-[rgba(255,255,255,0.28)]">CONFIRMED</div>
            </div>
            <div className="pl-6 text-[8px] tracking-[0.14em] text-[rgba(255,255,255,0.28)] tabular-nums">
              ELAPSED <span className="text-[#c8a96e]">{formatTime(elapsed)}</span>
            </div>
            <button
              onClick={() => { 
                setHistoryStatusFilter('all');
                setHistoryOffset(0);
                setHasMoreMissions(true);
                setShowMissionHistory(true); 
                loadMissionHistory(); 
              }}
              className="ml-4 px-4 py-2 text-[8px] tracking-[0.14em] bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] transition-all duration-200 text-[rgba(255,255,255,0.6)] rounded-sm"
              title="View Mission History"
            >
              HISTORY
            </button>
            <button
              onClick={() => setShowMissionModal(true)}
              className="ml-4 px-4 py-2 text-[8px] tracking-[0.14em] bg-[rgba(200,169,110,0.1)] border border-[rgba(200,169,110,0.3)] hover:bg-[rgba(200,169,110,0.15)] hover:border-[rgba(200,169,110,0.5)] transition-all duration-200 text-[#c8a96e] rounded-sm"
              title="Start New Mission"
            >
              + NEW MISSION
            </button>
          </div>
        </header>

        {/* Top Row - Commander, 3D Visualization, Node Data */}
        <div className="min-h-0 w-full grid overflow-hidden relative border-b border-[rgba(255,255,255,0.08)]" style={{ 
          gridTemplateColumns: 'minmax(350px, 420px) 1fr minmax(350px, 420px)'
        }}>
          {/* Terminal / Sandbox Panel */}
          <div
            className="flex flex-col overflow-hidden relative border-r border-[rgba(255,255,255,0.08)]"
            style={{
              background: 'linear-gradient(180deg, rgba(4,8,6,0.98) 0%, rgba(3,4,6,0.99) 100%)',
            }}
          >
            <div
              className="absolute inset-0 pointer-events-none z-[2]"
              style={{
                background: 'repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.06) 2px, rgba(0,0,0,0.06) 3px)',
              }}
            />
            <div className="flex items-center gap-[7px] px-[14px] py-[7px] border-b border-[rgba(255,255,255,0.06)] shrink-0 bg-[rgba(255,255,255,0.018)] relative z-[3]">
              <div className="flex gap-[5px]">
                <div className="w-[7px] h-[7px] rounded-full opacity-45 bg-[#c0392b]" />
                <div className="w-[7px] h-[7px] rounded-full opacity-45 bg-[#d4ac0d]" />
                <div className="w-[7px] h-[7px] rounded-full opacity-45 bg-[#27ae60]" />
              </div>
              <div className="text-[7.5px] tracking-[0.16em] text-[rgba(255,255,255,0.28)] flex-1 text-center">
                vibecheck-sandbox — privileged / host network
              </div>
              <button
                onClick={() => { 
                  setTerminalExpanded(!terminalExpanded); 
                  setFindingsExpanded(false); 
                  setReportsExpanded(false); 
                }}
                className="text-[7.5px] px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.4)] transition-colors"
                title={terminalExpanded ? 'Collapse' : 'Expand'}
              >
                {terminalExpanded ? '◀' : '▶'}
              </button>
              <div className="text-[7.5px] text-[rgba(255,255,255,0.14)]">{execCount} exec</div>
            </div>
            <div className="trm-body flex-1 overflow-y-auto px-[14px] py-[10px] text-[11px] leading-relaxed relative z-[3] min-h-0">
              {terminalLines.length === 0 ? (
                <div className="text-[rgba(255,255,255,0.2)] italic">
                  Waiting for mission events...
                </div>
              ) : (
                terminalLines.map((l, i) => {
                  const isCmd = l.s.startsWith('[alpha]') || l.s.startsWith('[gamma]') || l.s.startsWith('[commander]') || l.s.startsWith('[critic]');
                  const isError = l.s.toLowerCase().includes('error') || l.s.toLowerCase().includes('failed');
                  const isSuccess = l.s.toLowerCase().includes('success') || l.s.toLowerCase().includes('complete') || l.s.toLowerCase().includes('found');
                  
                  return (
                    <div key={i} className="flex gap-3 items-start">
                      {isCmd && (
                        <>
                          <span className="text-[rgba(200,169,110,0.25)] shrink-0">$</span>
                          <span className="text-[rgba(200,169,110,0.7)] break-words">{l.s}</span>
                        </>
                      )}
                      {l.t === 'out' && !isCmd && <span className="text-[rgba(255,255,255,0.25)] pl-3 break-words">{l.s}</span>}
                      {l.t === 'ok' && !isCmd && <span className="text-[rgba(150,210,170,0.65)] pl-3 break-words">✓ {l.s}</span>}
                      {(l.t === 'err' || isError) && !isCmd && <span className="text-[rgba(230,140,140,0.65)] pl-3 break-words">✗ {l.s}</span>}
                      {l.t !== 'cmd' && l.t !== 'out' && l.t !== 'ok' && l.t !== 'err' && !isCmd && !isError && !isSuccess && (
                        <span className="text-[rgba(255,255,255,0.25)] break-words">{l.s}</span>
                      )}
                      {isSuccess && !isCmd && (
                        <span className="text-[rgba(150,210,170,0.65)] break-words">✓ {l.s}</span>
                      )}
                    </div>
                  );
                })
              )}
              {terminalLines.length > 0 && (
                <div className="flex gap-2">
                  <span className="text-[rgba(200,169,110,0.25)] shrink-0">$</span>
                  <span className="cur" />
                </div>
              )}
            </div>
            {/* Simulated Interaction Input (Visual only for now) */}
            <div className="p-[10px] border-t border-[rgba(255,255,255,0.06)] bg-[rgba(0,0,0,0.2)] flex items-center shrink-0 z-10 relative">
              <span className="text-[rgba(200,169,110,0.8)] mr-2 shrink-0">&gt;</span>
              <input 
                type="text" 
                placeholder="Interact with commander..." 
                className="w-full bg-transparent border-none text-[11px] outline-none text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.2)]"
              />
            </div>
          </div>

          {/* Graph - 3D Visualization Area */}
          <div ref={containerRef} className={`relative overflow-hidden cursor-crosshair border-r border-[rgba(255,255,255,0.08)]`}>
            {/* Corner Brackets */}
            <div className="absolute top-3 left-3 w-4 h-4 pointer-events-none z-20">
              <div className="absolute top-0 left-0 w-full h-[1px] bg-[rgba(200,169,110,0.5)]" />
              <div className="absolute top-0 left-0 w-[1px] h-full bg-[rgba(200,169,110,0.5)]" />
            </div>
            <div className="absolute top-3 right-3 w-4 h-4 pointer-events-none z-20">
              <div className="absolute top-0 right-0 w-full h-[1px] bg-[rgba(200,169,110,0.5)]" />
              <div className="absolute top-0 right-0 w-[1px] h-full bg-[rgba(200,169,110,0.5)]" />
            </div>
            <div className="absolute bottom-3 left-3 w-4 h-4 pointer-events-none z-20">
              <div className="absolute bottom-0 left-0 w-full h-[1px] bg-[rgba(200,169,110,0.5)]" />
              <div className="absolute bottom-0 left-0 w-[1px] h-full bg-[rgba(200,169,110,0.5)]" />
            </div>
            <div className="absolute bottom-3 right-3 w-4 h-4 pointer-events-none z-20">
              <div className="absolute bottom-0 right-0 w-full h-[1px] bg-[rgba(200,169,110,0.5)]" />
              <div className="absolute bottom-0 right-0 w-[1px] h-full bg-[rgba(200,169,110,0.5)]" />
            </div>
            <canvas ref={canvasRef} className="absolute inset-0" />
            <div ref={labelsRef} className="absolute inset-0 pointer-events-none z-10" />

            {/* Killchain */}
            <div
              className="absolute top-[18px] left-1/2 -translate-x-1/2 z-20 flex items-center px-4 py-[6px]"
              style={{
                background: 'rgba(3,4,6,0.7)',
                backdropFilter: 'blur(16px)',
                border: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              <div
                className="absolute -top-[1px] left-0 right-0 h-[1px]"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(200,169,110,0.22), transparent)' }}
              />
              {[
                { cls: 'done', txt: 'RECON' },
                { cls: 'done', txt: 'WEAPONIZE' },
                { cls: 'live', txt: 'EXPLOIT' },
                { cls: 'pend', txt: 'POST-EXPLOIT' },
                { cls: 'pend', txt: 'REPORT' },
              ].map((ph, i) => (
                <div
                  key={ph.txt}
                  className={`flex items-center gap-[6px] px-3 text-[7.5px] tracking-[0.2em] ${
                    ph.cls === 'done' ? 'text-[rgba(255,255,255,0.28)]' : ph.cls === 'live' ? 'text-[#c8a96e]' : 'text-[rgba(255,255,255,0.14)]'
                  } ${i > 0 ? 'border-l border-[rgba(255,255,255,0.04)]' : ''}`}
                >
                  <div
                    className="w-[4px] h-[4px] rounded-full"
                    style={{
                      background: 'currentColor',
                      boxShadow: ph.cls === 'live' ? '0 0 6px currentColor' : undefined,
                      animation: ph.cls === 'live' ? 'pulse 1.4s ease-in-out infinite' : undefined,
                    }}
                  />
                  {ph.txt}
                </div>
              ))}
            </div>

            {/* Ticker */}
            <div ref={tickerRef} className="absolute bottom-[26px] left-[22px] z-20 pointer-events-none flex flex-col gap-[3px]" />

            {/* Hint */}
            <div className="absolute bottom-[10px] right-[22px] text-[7px] tracking-[0.14em] text-[rgba(255,255,255,0.14)] z-[5] pointer-events-none">
              drag — scroll — click
            </div>
          </div>

          {/* Node Data Inspector Panel */}
          <div
            className={`flex flex-col overflow-hidden relative`}
            style={{
              borderLeft: '1px solid rgba(255,255,255,0.08)',
              background: 'linear-gradient(180deg, rgba(6,10,16,0.95) 0%, rgba(3,4,6,0.98) 100%)',
              backdropFilter: 'blur(20px)',
            }}
          >
            <div
              className="absolute top-0 left-0 right-0 h-[1px]"
              style={{ background: 'linear-gradient(90deg, transparent, rgba(200,169,110,0.22), transparent)' }}
            />
            <div className="flex items-center gap-[10px] px-[18px] py-3 border-b border-[rgba(255,255,255,0.04)] shrink-0">
              <div className="text-[7.5px] tracking-[0.25em] text-[rgba(255,255,255,0.28)] uppercase">Inspector</div>
              <div className="flex-1 h-[1px] bg-[rgba(255,255,255,0.04)]" />
              <div className="text-[7.5px] text-[rgba(255,255,255,0.14)]">{inspectorId}</div>
            </div>

            {inspectorData ? (
              <div className="flex-1 overflow-hidden flex flex-col px-[18px] pt-4">
                <div
                  className="text-[7px] tracking-[0.22em] mb-1 uppercase"
                  style={{ color: TC_CSS[nodeByID[inspectorId]?.team || 'purple'] }}
                >
                  {inspectorData.eyebrow}
                </div>
                <div
                  className="text-xl font-light italic tracking-[0.04em] leading-tight mb-[10px]"
                  style={{
                    fontFamily: "'Cormorant Garamond', Georgia, serif",
                    color: TC_CSS[nodeByID[inspectorId]?.team || 'purple'],
                  }}
                >
                  {inspectorData.name}
                </div>
                <div className="flex items-center gap-2 mb-[10px]">
                  <div
                    className="text-[7px] tracking-[0.18em] px-[9px] py-[2px] border rounded-[1px]"
                    style={{
                      color: TC_CSS[nodeByID[inspectorId]?.team || 'purple'],
                      borderColor: TC_CSS[nodeByID[inspectorId]?.team || 'purple'].replace('0.75)', '0.2)').replace('0.80)', '0.2)').replace('0.72)', '0.2)').replace('0.65)', '0.2)'),
                      background: TC_CSS[nodeByID[inspectorId]?.team || 'purple'].replace('0.75)', '0.06)').replace('0.80)', '0.06)').replace('0.72)', '0.06)').replace('0.65)', '0.06)'),
                    }}
                  >
                    {inspectorData.status}
                  </div>
                  <div className="text-[7.5px] text-[rgba(255,255,255,0.28)] tracking-[0.08em]">{inspectorData.iter}</div>
                </div>
                <div className="text-[12px] text-[rgba(255,255,255,0.75)] leading-relaxed mb-[14px]">{inspectorData.task}</div>
                <div className="text-[7px] tracking-[0.22em] text-[rgba(255,255,255,0.14)] border-b border-[rgba(255,255,255,0.04)] pb-[5px] mb-2">
                  ACTIVITY LOG
                </div>
                <div className="logs flex-1 overflow-y-auto flex flex-col gap-[4px] pb-3">
                  {logs.map((l, i) => (
                    <div key={i} className="le flex items-start gap-3">
                      <span className="text-[rgba(255,255,255,0.14)] shrink-0 w-14 text-[10px]">{l.t}</span>
                      <span className={`shrink-0 w-28 text-[9px] tracking-[0.1em] ${getLogClass(l.k)}`}>[{l.k}]</span>
                      <span className="text-[rgba(255,255,255,0.8)] text-[11px] leading-relaxed break-words">{l.m}</span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-[14px] p-5">
                <div className="w-12 h-12 rounded-full border border-[rgba(255,255,255,0.08)] flex items-center justify-center opacity-40">
                  <div className="w-[10px] h-[10px] rounded-full bg-[rgba(255,255,255,0.08)]" />
                </div>
                <p
                  className="text-[13px] italic text-center leading-[1.7] opacity-50"
                  style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.28)' }}
                >
                  Select a node<br />to inspect the agent
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Exploit Report Panel (row D) */}
        <div className="flex flex-col overflow-hidden border-t border-[rgba(255,255,255,0.08)] relative"
          style={{ background: 'linear-gradient(180deg, rgba(6,10,16,0.97) 0%, rgba(3,4,6,0.99) 100%)' }}
        >
          <div
            className="absolute top-0 left-0 right-0 h-[1px]"
            style={{ background: 'linear-gradient(90deg, transparent, rgba(200,169,110,0.22) 30%, rgba(200,169,110,0.22) 70%, transparent)' }}
          />

          {/* Exploit Report Content */}
            <div className="flex items-center gap-0 px-[14px] py-[7px] border-b border-[rgba(255,255,255,0.04)] shrink-0">
              <div
                className="text-[13px] italic font-light"
                style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.52)' }}
              >
                Mission Reports
              </div>
              <div className="ml-auto flex gap-0">
                <div className="flex flex-col items-center gap-[1px] px-[14px] border-l border-[rgba(255,255,255,0.04)]">
                  <div
                    className="text-lg font-light leading-[1.1]"
                    style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(74,222,128,0.85)' }}
                  >
                    {exploitsList.filter(e => e.success).length}
                  </div>
                  <div className="text-[7px] tracking-[0.15em] text-[rgba(255,255,255,0.28)]">SUCCESS</div>
                </div>
                <div className="flex flex-col items-center gap-[1px] px-[14px] border-l border-[rgba(255,255,255,0.04)]">
                  <div
                    className="text-lg font-light leading-[1.1]"
                    style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.95)' }}
                  >
                    {exploitsList.length}
                  </div>
                  <div className="text-[7px] tracking-[0.15em] text-[rgba(255,255,255,0.28)]">TOTAL</div>
                </div>
                <div className="flex flex-col items-center gap-[1px] px-[14px] border-l border-[rgba(255,255,255,0.04)]">
                  <button
                    onClick={() => { 
                      setReportsExpanded(!reportsExpanded); 
                      setTerminalExpanded(false); 
                      setFindingsExpanded(false); 
                    }}
                    className="text-[7.5px] px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.4)] transition-colors"
                    title={reportsExpanded ? 'Collapse' : 'Expand'}
                  >
                    {reportsExpanded ? '◀' : '▶'}
                  </button>
                </div>
              </div>
            </div>
            
            <div ref={reportsBodyRef} className="rpt-body flex-1 overflow-x-auto px-[14px] py-[10px] text-[11px] leading-relaxed relative z-[3] min-h-0">
              {isLoadingExploits ? (
                <div className="text-[rgba(255,255,255,0.2)] italic">
                  Loading exploit data...
                </div>
              ) : exploitsList.length === 0 ? (
                <div className="text-[rgba(255,255,255,0.2)] italic">
                  No exploits reported yet...
                </div>
              ) : (
                <div className="flex gap-3 h-[180px] pb-2" style={{ overflowX: 'auto', minWidth: 'max-content' }}>
                  {exploitsList.map((exploit, index) => {
                    const isSuccess = exploit.success;
                    let evidence = {};
                    if (typeof exploit.evidence === 'string' && exploit.evidence) {
                      try { evidence = JSON.parse(exploit.evidence); } catch { evidence = {}; }
                    } else if (exploit.evidence && typeof exploit.evidence === 'object') {
                      evidence = exploit.evidence;
                    }
                    const hasEvidence = evidence && typeof evidence === 'object' && Object.keys(evidence).length > 0;
                    
                    return (
                      <div 
                        key={exploit.id || index}
                        className="w-[300px] shrink-0 h-full border border-[rgba(255,255,255,0.08)] rounded-[1px] flex flex-col overflow-hidden cursor-pointer hover:border-[rgba(200,169,110,0.3)] transition-all"
                        style={{ 
                          background: isSuccess 
                            ? 'rgba(74,222,128,0.06)' 
                            : 'rgba(240,140,140,0.06)' 
                        }}
                        onClick={() => setExpandedExploit(exploit)}
                      >
                        <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.04)]">
                          <div className="flex items-center justify-between mb-1">
                            <div 
                              className={`text-[8px] px-2 py-[1px] rounded-[1px] tracking-[0.1em] ${
                                isSuccess ? 'bg-[rgba(74,222,128,0.15)] text-[rgba(74,222,128,0.9)]' : 'bg-[rgba(240,140,140,0.15)] text-[rgba(240,140,140,0.9)]'
                              }`}
                            >
                              {isSuccess ? 'SUCCESS' : 'FAILED'}
                            </div>
                            <div className="text-[7px] text-[rgba(255,255,255,0.3)]">
                              {new Date(exploit.created_at).toLocaleTimeString()}
                            </div>
                          </div>
                          <div className="text-[12px] text-[rgba(255,255,255,0.8)] mb-1">
                            <span className="text-[rgba(200,169,110,0.8)]">{exploit.exploit_type}</span>
                            {exploit.tool_used && <span className="text-[rgba(255,255,255,0.5)]"> via {exploit.tool_used}</span>}
                          </div>
                          <div className="text-[9px] text-[rgba(255,255,255,0.5)] break-all">
                            {exploit.target_url}
                          </div>
                        </div>
                        
                        <div className="flex-1 overflow-y-auto">
                          {(exploit.payload || exploit.command_executed) && (
                            <div className="px-3 py-2 border-b border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)]">
                              <div className="text-[7px] text-[rgba(255,255,255,0.3)] mb-1 tracking-[0.15em]">PAYLOAD</div>
                              <div className="text-[9px] text-[rgba(255,255,255,0.7)] font-mono break-all">
                                {exploit.payload || exploit.command_executed}
                              </div>
                            </div>
                          )}

                          {isSuccess && hasEvidence && (
                            <div className="px-3 py-2 bg-[rgba(74,222,128,0.04)]">
                              <div className="text-[7px] text-[rgba(74,222,128,0.8)] mb-1 tracking-[0.15em]">EVIDENCE</div>
                              <div className="text-[9px] text-[rgba(255,255,255,0.8)] space-y-1">
                                {Object.entries(evidence).map(([key, value]) => (
                                  <div key={key} className="flex gap-2">
                                    <span className="text-[rgba(200,169,110,0.7)] shrink-0 min-w-[60px] capitalize">
                                      {key.replace(/_/g, ' ')}:
                                    </span>
                                    <span className="break-all font-mono">
                                      {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {exploit.error_message && !isSuccess && (
                            <div className="px-3 py-2 bg-[rgba(240,140,140,0.04)]">
                              <div className="text-[7px] text-[rgba(240,140,140,0.8)] mb-1 tracking-[0.15em]">ERROR</div>
                              <div className="text-[9px] text-[rgba(255,255,255,0.8)] font-mono break-all">
                                {exploit.error_message}
                              </div>
                            </div>
                          )}
                          
                          {exploit.stdout && (
                            <div className="px-3 py-2 border-t border-[rgba(255,255,255,0.04)] bg-[rgba(255,255,255,0.02)]">
                              <div className="text-[7px] text-[rgba(255,255,255,0.3)] mb-1 tracking-[0.15em]">OUTPUT</div>
                              <div className="text-[9px] text-[rgba(255,255,255,0.7)] font-mono break-all max-h-20 overflow-y-auto">
                                {exploit.stdout}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
        </div>

        {/* Exploit Fullscreen Overlay */}
        {expandedExploit && (
          <div 
            className="fixed inset-0 z-[100] flex items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.92)' }}
            onClick={() => setExpandedExploit(null)}
          >
            <div 
              className="w-[700px] max-w-[90vw] max-h-[85vh] flex flex-col overflow-hidden"
              style={{ 
                background: 'linear-gradient(180deg, rgba(6,10,16,0.98) 0%, rgba(3,4,6,0.99) 100%)', 
                borderRadius: '4px', 
                border: '1px solid rgba(255,255,255,0.12)'
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Modal Header */}
              <div className="flex items-center gap-3 px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
                <div 
                  className={`text-[10px] px-3 py-1 rounded-[1px] tracking-[0.1em] ${
                    expandedExploit.success 
                      ? 'bg-[rgba(74,222,128,0.15)] text-[rgba(74,222,128,0.9)]' 
                      : 'bg-[rgba(240,140,140,0.15)] text-[rgba(240,140,140,0.9)]'
                  }`}
                >
                  {expandedExploit.success ? 'SUCCESS' : 'FAILED'}
                </div>
                <div className="text-[14px] text-[rgba(255,255,255,0.8)]">
                  <span className="text-[rgba(200,169,110,0.9)]">{expandedExploit.exploit_type}</span>
                  {expandedExploit.tool_used && <span className="text-[rgba(255,255,255,0.5)] text-[12px]"> via {expandedExploit.tool_used}</span>}
                </div>
                <div className="flex-1" />
                <div className="text-[10px] text-[rgba(255,255,255,0.4)]">
                  {new Date(expandedExploit.created_at).toLocaleString()}
                </div>
                <button
                  onClick={() => setExpandedExploit(null)}
                  className="ml-4 text-[16px] px-3 py-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] transition-colors"
                >
                  ✕
                </button>
              </div>

              {/* Modal Body */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* Target */}
                <div>
                  <div className="text-[9px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-2">TARGET</div>
                  <div className="text-[12px] text-[rgba(255,255,255,0.7)] font-mono bg-[rgba(255,255,255,0.03)] p-3 rounded break-all">
                    {expandedExploit.target_url}
                  </div>
                </div>

                {/* Method */}
                <div>
                  <div className="text-[9px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-2">METHOD</div>
                  <div className="text-[12px] text-[rgba(255,255,255,0.7)]">
                    {expandedExploit.method}
                  </div>
                </div>

                {/* Payload */}
                {(expandedExploit.payload || expandedExploit.command_executed) && (
                  <div>
                    <div className="text-[9px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-2">PAYLOAD</div>
                    <div className="text-[11px] text-[rgba(255,255,255,0.7)] font-mono bg-[rgba(255,255,255,0.03)] p-3 rounded whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                      {typeof expandedExploit.payload === 'string' 
                        ? expandedExploit.payload 
                        : JSON.stringify(expandedExploit.payload || expandedExploit.command_executed, null, 2)}
                    </div>
                  </div>
                )}

                {/* Response Code */}
                {expandedExploit.response_code && (
                  <div>
                    <div className="text-[9px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-2">RESPONSE CODE</div>
                    <div className="text-[12px] text-[rgba(255,255,255,0.7)]">
                      HTTP {expandedExploit.response_code}
                    </div>
                  </div>
                )}

                {/* Evidence */}
                {(() => {
                  let expEvidence = {};
                  if (typeof expandedExploit.evidence === 'string' && expandedExploit.evidence) {
                    try { expEvidence = JSON.parse(expandedExploit.evidence); } catch { expEvidence = {}; }
                  } else if (expandedExploit.evidence && typeof expandedExploit.evidence === 'object') {
                    expEvidence = expandedExploit.evidence;
                  }
                  return expEvidence && typeof expEvidence === 'object' && Object.keys(expEvidence).length > 0 ? (
                    <div>
                      <div className="text-[9px] text-[rgba(74,222,128,0.8)] tracking-[0.15em] mb-2">EVIDENCE</div>
                      <div className="text-[11px] text-[rgba(255,255,255,0.7)] space-y-2 bg-[rgba(74,222,128,0.03)] p-3 rounded">
                        {Object.entries(expEvidence).map(([key, value]) => (
                          <div key={key} className="flex gap-3">
                            <span className="text-[rgba(200,169,110,0.7)] shrink-0 min-w-[100px] capitalize">
                              {key.replace(/_/g, ' ')}:
                            </span>
                            <span className="font-mono break-all text-[10px]">
                              {typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null;
                })()}

                {/* Extracted Tokens/Secrets */}
                {(() => {
                  const tokens = extractTokens(expandedExploit.stdout, expandedExploit.command_executed);
                  if (tokens.length === 0) return null;
                  return (
                    <div>
                      <div className="text-[9px] text-[rgba(255,215,0,0.9)] tracking-[0.15em] mb-2">EXTRACTED TOKENS & SECRETS</div>
                      <div className="text-[11px] text-[rgba(255,255,255,0.7)] space-y-2 bg-[rgba(255,215,0,0.05)] p-3 rounded">
                        {tokens.map((token, idx) => (
                          <div key={idx} className="flex flex-col gap-1 p-2 bg-[rgba(0,0,0,0.2)] rounded">
                            <div className="flex items-center gap-2">
                              <span className="text-[rgba(255,215,0,0.8)] text-[8px] px-2 py-[1px] rounded bg-[rgba(255,215,0,0.15)] capitalize">
                                {token.type}
                              </span>
                              <span className="text-[rgba(255,255,255,0.5)] text-[7px]">
                                from {token.source}
                              </span>
                            </div>
                            <div className="font-mono text-[9px] text-[rgba(255,255,255,0.85)] break-all bg-[rgba(255,255,255,0.03)] p-2 rounded">
                              {formatTokenDisplay(token.value)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Error */}
                {expandedExploit.error_message && !expandedExploit.success && (
                  <div>
                    <div className="text-[9px] text-[rgba(240,140,140,0.8)] tracking-[0.15em] mb-2">ERROR</div>
                    <div className="text-[11px] text-[rgba(255,255,255,0.7)] bg-[rgba(240,140,140,0.05)] p-3 rounded">
                      {expandedExploit.error_message}
                    </div>
                  </div>
                )}

                {/* Output */}
                {expandedExploit.stdout && (
                  <div>
                    <div className="text-[9px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-2">OUTPUT</div>
                    <div className="text-[10px] text-[rgba(255,255,255,0.6)] font-mono bg-[rgba(255,255,255,0.03)] p-3 rounded whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                      {expandedExploit.stdout}
                    </div>
                  </div>
                )}

                {/* Stderr */}
                {expandedExploit.stderr && (
                  <div>
                    <div className="text-[9px] text-[rgba(240,140,140,0.6)] tracking-[0.15em] mb-2">STDERR</div>
                    <div className="text-[10px] text-[rgba(255,255,255,0.5)] font-mono bg-[rgba(240,140,140,0.03)] p-3 rounded whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                      {expandedExploit.stderr}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Findings Report Panel (row E) */}
        <div
            className="flex flex-col overflow-hidden border-t border-[rgba(255,255,255,0.08)]"
            style={{
              background: 'linear-gradient(180deg, rgba(6,10,16,0.97) 0%, rgba(3,4,6,0.99) 100%)',
            }}
          >
            <div className="flex items-center gap-0 px-[14px] py-[7px] border-b border-[rgba(255,255,255,0.04)] shrink-0">
              <div
                className="text-[13px] italic font-light"
                style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.52)' }}
              >
                Findings Report
              </div>
              <div className="ml-auto flex gap-0">
                <div className="flex flex-col items-center gap-[1px] px-[14px] border-l border-[rgba(255,255,255,0.04)]">
                  <div
                    className="text-lg font-light leading-[1.1]"
                    style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(230,170,110,0.85)' }}
                  >
                    {findingsList.filter(f => f.sev === 'high' || f.sev === 'critical').length}
                  </div>
                  <div className="text-[7px] tracking-[0.15em] text-[rgba(255,255,255,0.28)]">HIGH</div>
                </div>
                <div className="flex flex-col items-center gap-[1px] px-[14px] border-l border-[rgba(255,255,255,0.04)]">
                  <div
                    className="text-lg font-light leading-[1.1]"
                    style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.95)' }}
                  >
                    {findingsList.length}
                  </div>
                  <div className="text-[7px] tracking-[0.15em] text-[rgba(255,255,255,0.28)]">TOTAL</div>
                </div>
                <div className="flex flex-col items-center gap-[1px] px-[14px] border-l border-[rgba(255,255,255,0.04)]">
                  <div
                    className="text-lg font-light leading-[1.1]"
                    style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(150,210,170,0.85)' }}
                  >
                    {findingsList.filter(f => f.confirmed).length}
                  </div>
                  <div className="text-[7px] tracking-[0.15em] text-[rgba(255,255,255,0.28)]">CONFIRMED</div>
                </div>
                <button
                  onClick={() => { 
                    setFindingsExpanded(!findingsExpanded); 
                    setTerminalExpanded(false); 
                    setReportsExpanded(false); 
                  }}
                  className="text-[7.5px] px-2 py-1 ml-2 rounded hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.4)] transition-colors"
                  title={findingsExpanded ? 'Collapse' : 'Expand'}
                >
                  {findingsExpanded ? '◀' : '▶'}
                </button>
                <button
                  onClick={() => setFindingsFullscreen(true)}
                  className="text-[7.5px] px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.4)] transition-colors"
                  title="Fullscreen"
                >
                  ⛶
                </button>
              </div>
            </div>
            <div className="rpt-body flex-1 overflow-y-auto px-2 py-[7px] flex flex-col gap-1 min-h-0" style={{ minHeight: '100px' }}>
              {findingsList.map((f, i) => (
                <div key={i}>
                  <div
                    className={`p-[7px_10px] cursor-pointer relative overflow-hidden transition-all duration-200 hover:bg-[rgba(255,255,255,0.032)] hover:border-[rgba(255,255,255,0.08)] ${
                      f.confirmed ? 'bg-[rgba(150,210,170,0.028)] border-[rgba(150,210,170,0.12)]' : 'bg-[rgba(255,255,255,0.016)] border border-[rgba(255,255,255,0.04)]'
                    } ${expandedFindingId === f.title ? 'rounded-b-none' : ''}`}
                    style={{ borderRadius: '1px' }}
                    onClick={() => setExpandedFindingId(expandedFindingId === f.title ? null : (f.title as string))}
                  >
                    <div
                      className="absolute left-0 top-0 bottom-0 w-[2px]"
                      style={{
                        background:
                          f.sev === 'critical'
                            ? 'rgba(240,140,140,0.85)'
                            : f.sev === 'high'
                            ? 'rgba(230,170,110,0.85)'
                            : f.sev === 'medium'
                            ? 'rgba(200,200,140,0.80)'
                            : 'rgba(140,180,210,0.75)',
                        boxShadow:
                          f.sev === 'critical' || f.sev === 'high' ? `0 0 8px ${f.sev === 'critical' ? 'rgba(240,140,140,0.85)' : 'rgba(230,170,110,0.85)'}` : undefined,
                      }}
                    />
                    <div className="flex items-center gap-[7px] mb-[3px]">
                      <div
                        className="text-[8px] tracking-[0.14em] px-[6px] py-[1px] border rounded-[1px] shrink-0"
                        style={{
                          color:
                            f.sev === 'critical'
                              ? 'rgba(240,140,140,0.85)'
                              : f.sev === 'high'
                              ? 'rgba(230,170,110,0.85)'
                              : f.sev === 'medium'
                              ? 'rgba(200,200,140,0.80)'
                              : 'rgba(140,180,210,0.75)',
                          borderColor:
                            f.sev === 'critical'
                              ? 'rgba(240,140,140,0.85)'
                              : f.sev === 'high'
                              ? 'rgba(230,170,110,0.85)'
                              : f.sev === 'medium'
                              ? 'rgba(200,200,140,0.80)'
                              : 'rgba(140,180,210,0.75)',
                        }}
                      >
                        {f.sev.toUpperCase()}
                      </div>
                      <div className="text-[11px] text-[rgba(255,255,255,0.7)] flex-1 tracking-[0.01em]">{f.title}</div>
                      <div className="text-[9px] text-[rgba(255,255,255,0.3)]">
                        {expandedFindingId === f.title ? '▲' : '▼'}
                      </div>
                      {f.confirmed ? (
                        <div
                          className="text-[6.5px] tracking-[0.12em] px-[6px] py-[1px] rounded-[1px] border"
                          style={{
                            background: 'rgba(150,210,170,0.06)',
                            borderColor: 'rgba(150,210,170,0.18)',
                            color: 'rgba(150,210,170,0.75)',
                          }}
                        >
                          CONFIRMED
                        </div>
                      ) : (
                        <div
                          className="text-[6.5px] tracking-[0.12em] px-[6px] py-[1px] rounded-[1px] border"
                          style={{
                            background: 'rgba(255,255,255,0.04)',
                            borderColor: 'rgba(255,255,255,0.08)',
                            color: 'rgba(255,255,255,0.28)',
                          }}
                        >
                          STATIC
                        </div>
                      )}
                    </div>
                    <div className="text-[7px] text-[rgba(255,255,255,0.28)] tracking-[0.06em] flex gap-[10px]">
                      <span>{f.type}</span>
                      <span>{f.src}</span>
                      {f.cve && <span style={{ color: 'rgba(240,140,140,0.85)' }}>{f.cve}</span>}
                      <span style={{ color: 'rgba(255,255,255,0.28)' }}>{f.agent}</span>
                    </div>
                  </div>
                  {expandedFindingId === f.title && (
                    <div className="px-3 py-3 bg-[rgba(0,0,0,0.3)] border-x border-b border-[rgba(255,255,255,0.06)]" style={{ borderBottomLeftRadius: '1px', borderBottomRightRadius: '1px' }}>
                      {f.description && (
                        <div className="mb-2">
                          <div className="text-[7px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-1">DESCRIPTION</div>
                          <div className="text-[9px] text-[rgba(255,255,255,0.6)]">{f.description}</div>
                        </div>
                      )}
                      {f.target && (
                        <div className="mb-2">
                          <div className="text-[7px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-1">TARGET</div>
                          <div className="text-[9px] text-[rgba(255,255,255,0.6)] font-mono">{f.target}</div>
                        </div>
                      )}
                      {f.endpoint && f.endpoint !== f.target && (
                        <div className="mb-2">
                          <div className="text-[7px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-1">ENDPOINT</div>
                          <div className="text-[9px] text-[rgba(255,255,255,0.6)] font-mono">{f.endpoint}</div>
                        </div>
                      )}
                      {f.evidence && Object.keys(f.evidence).length > 0 && (
                        <div>
                          <div className="text-[7px] text-[rgba(255,255,255,0.4)] tracking-[0.15em] mb-1">EVIDENCE</div>
                          <div className="text-[9px] text-[rgba(255,255,255,0.6)] space-y-1">
                            {Object.entries(f.evidence).slice(0, 5).map(([key, value]) => (
                              <div key={key} className="flex gap-2">
                                <span className="text-[rgba(200,169,110,0.7)] shrink-0 min-w-[60px] capitalize">
                                  {key.replace(/_/g, ' ')}:
                                </span>
                                <span className="font-mono break-all">
                                  {typeof value === 'object' ? JSON.stringify(value).slice(0, 100) : String(value).slice(0, 100)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
        </div>
      </div>

        {/* Fullscreen Findings Modal */}
      {findingsFullscreen && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.92)' }}
        >
          <div className="w-[90vw] h-[90vh] flex flex-col" style={{ background: 'linear-gradient(180deg, rgba(6,10,16,0.98) 0%, rgba(3,4,6,0.99) 100%)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.08)' }}>
            {/* Modal Header */}
            <div className="flex items-center gap-0 px-[20px] py-[12px] border-b border-[rgba(255,255,255,0.08)]">
              <div className="text-[16px] italic font-light" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.7)' }}>
                Findings Report
              </div>
              <div className="ml-auto flex gap-4 text-[11px]">
                <div className="flex flex-col items-center">
                  <div className="text-lg font-light" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(230,170,110,0.85)' }}>
                    {findingsList.filter(f => f.sev === 'high' || f.sev === 'critical').length}
                  </div>
                  <div className="text-[9px] tracking-[0.15em] text-[rgba(255,255,255,0.35)]">HIGH</div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="text-lg font-light" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.95)' }}>
                    {findingsList.length}
                  </div>
                  <div className="text-[9px] tracking-[0.15em] text-[rgba(255,255,255,0.35)]">TOTAL</div>
                </div>
                <div className="flex flex-col items-center">
                  <div className="text-lg font-light" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(150,210,170,0.85)' }}>
                    {findingsList.filter(f => f.confirmed).length}
                  </div>
                  <div className="text-[9px] tracking-[0.15em] text-[rgba(255,255,255,0.35)]">CONFIRMED</div>
                </div>
              </div>
              <button
                onClick={() => setFindingsFullscreen(false)}
                className="ml-6 text-[20px] px-3 py-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] transition-colors"
                title="Close"
              >
                ✕
              </button>
            </div>
            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2" style={{ minHeight: '300px' }}>
              {findingsList.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <p className="text-[14px] italic" style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.3)' }}>
                    No findings yet
                  </p>
                </div>
              ) : (
                findingsList.map((f, i) => (
                  <div
                    key={i}
                    className={`p-3 cursor-pointer relative overflow-hidden transition-all duration-200 hover:bg-[rgba(255,255,255,0.032)] min-h-[70px] ${
                      f.confirmed ? 'bg-[rgba(150,210,170,0.04)] border-[rgba(150,210,170,0.15)]' : 'bg-[rgba(255,255,255,0.025)] border-[rgba(255,255,255,0.06)]'
                    }`}
                    style={{ borderRadius: '3px', borderLeft: '3px solid' }}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <span
                        className="text-[10px] tracking-[0.14em] px-2 py-1 rounded"
                        style={{
                          color: f.sev === 'critical' ? 'rgba(240,140,140,0.9)' : f.sev === 'high' ? 'rgba(230,170,110,0.9)' : f.sev === 'medium' ? 'rgba(200,200,140,0.85)' : 'rgba(140,180,210,0.8)',
                          borderColor: f.sev === 'critical' ? 'rgba(240,140,140,0.9)' : f.sev === 'high' ? 'rgba(230,170,110,0.9)' : f.sev === 'medium' ? 'rgba(200,200,140,0.85)' : 'rgba(140,180,210,0.8)',
                          background: f.sev === 'critical' ? 'rgba(240,140,140,0.1)' : f.sev === 'high' ? 'rgba(230,170,110,0.1)' : f.sev === 'medium' ? 'rgba(200,200,140,0.08)' : 'rgba(140,180,210,0.08)',
                          border: '1px solid',
                        }}
                      >
                        {f.sev.toUpperCase()}
                      </span>
                      <span className="text-[14px] text-[rgba(255,255,255,0.75)] flex-1">{f.title}</span>
                      {f.confirmed ? (
                        <span className="text-[9px] tracking-[0.12em] px-2 py-1 rounded" style={{ background: 'rgba(150,210,170,0.1)', borderColor: 'rgba(150,210,170,0.3)', color: 'rgba(150,210,170,0.85)', border: '1px solid' }}>
                          CONFIRMED
                        </span>
                      ) : (
                        <span className="text-[9px] tracking-[0.12em] px-2 py-1 rounded" style={{ background: 'rgba(255,255,255,0.04)', borderColor: 'rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.35)', border: '1px solid' }}>
                          STATIC
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-[rgba(255,255,255,0.35)] flex gap-4">
                      <span>{f.type}</span>
                      <span>{f.src}</span>
                      {f.cve && <span style={{ color: 'rgba(240,140,140,0.85)' }}>{f.cve}</span>}
                      <span style={{ color: 'rgba(255,255,255,0.35)' }}>{f.agent}</span>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Mission Creation Modal */}
      {showMissionModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowMissionModal(false);
          }}
        >
          <div 
            className="w-[500px] max-w-[90vw] flex flex-col" 
            style={{ 
              background: 'linear-gradient(180deg, rgba(6,10,16,0.98) 0%, rgba(3,4,6,0.99) 100%)', 
              borderRadius: '4px', 
              border: '1px solid rgba(255,255,255,0.12)',
              boxShadow: '0 20px 40px rgba(0,0,0,0.5)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="flex items-center gap-3 px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
              <div 
                className="text-[18px] italic font-light" 
                style={{ 
                  fontFamily: "'Cormorant Garamond', Georgia, serif", 
                  color: 'rgba(255,255,255,0.75)' 
                }}
              >
                New Mission
              </div>
              <div className="flex-1" />
              <button
                onClick={() => setShowMissionModal(false)}
                className="text-[16px] px-2 py-1 rounded hover:bg-[rgba(255,255,255,0.1)] text-[rgba(255,255,255,0.5)] transition-colors"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-6 flex flex-col gap-5">
              {/* Mode Selection */}
              <div>
                <label className="text-[10px] tracking-[0.15em] text-[rgba(255,255,255,0.4)] mb-3 block">
                  MISSION TYPE
                </label>
                <div className="flex gap-2">
                  {[
                    { value: 'live', label: 'LIVE TARGET', desc: 'Real-time security assessment of a live target' },
                    { value: 'static', label: 'STATIC SCAN', desc: 'Analysis of static resources and configurations' },
                    { value: 'repo', label: 'REPOSITORY', desc: 'Deploy and test from GitHub repository' }
                  ].map(mode => (
                    <button
                      key={mode.value}
                      onClick={() => setMissionForm(prev => ({ ...prev, mode: mode.value as any }))}
                      className={`flex-1 p-3 text-left border rounded-sm transition-all duration-200 ${
                        missionForm.mode === mode.value
                          ? 'border-[rgba(200,169,110,0.4)] bg-[rgba(200,169,110,0.08)] text-[#c8a96e]'
                          : 'border-[rgba(255,255,255,0.1)] bg-[rgba(255,255,255,0.02)] text-[rgba(255,255,255,0.5)] hover:border-[rgba(255,255,255,0.2)] hover:bg-[rgba(255,255,255,0.04)]'
                      }`}
                      title={mode.desc}
                    >
                      <div className="text-[9px] tracking-[0.12em] mb-1">{mode.label}</div>
                      <div className="text-[7px] text-[rgba(255,255,255,0.3)] leading-relaxed">
                        {mode.desc}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Target URL */}
              <div>
                <label className="text-[10px] tracking-[0.15em] text-[rgba(255,255,255,0.4)] mb-2 block">
                  TARGET {missionForm.mode === 'repo' ? 'DOMAIN' : 'URL'}
                </label>
                <input
                  type="text"
                  value={missionForm.target}
                  onChange={(e) => setMissionForm(prev => ({ ...prev, target: e.target.value }))}
                  placeholder={
                    missionForm.mode === 'repo' 
                      ? 'example.com (domain where deployed app will run)' 
                      : 'https://example.com'
                  }
                  className="w-full px-3 py-2 text-[11px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-sm focus:border-[rgba(200,169,110,0.4)] focus:bg-[rgba(200,169,110,0.03)] focus:outline-none transition-colors text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)]"
                />
              </div>

              {/* Repository URL - only show for repo mode */}
              {missionForm.mode === 'repo' && (
                <div>
                  <label className="text-[10px] tracking-[0.15em] text-[rgba(255,255,255,0.4)] mb-2 block">
                    GITHUB REPOSITORY
                  </label>
                  <input
                    type="text"
                    value={missionForm.repoUrl}
                    onChange={(e) => setMissionForm(prev => ({ ...prev, repoUrl: e.target.value }))}
                    placeholder="https://github.com/user/repo.git"
                    className="w-full px-3 py-2 text-[11px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-sm focus:border-[rgba(200,169,110,0.4)] focus:bg-[rgba(200,169,110,0.03)] focus:outline-none transition-colors text-[rgba(255,255,255,0.8)] placeholder-[rgba(255,255,255,0.25)]"
                  />
                  <div className="text-[8px] text-[rgba(255,255,255,0.3)] mt-1">
                    Repository will be automatically cloned, built, and deployed in Docker
                  </div>
                </div>
              )}

              {/* Objective */}
              <div>
                <label className="text-[10px] tracking-[0.15em] text-[rgba(255,255,255,0.4)] mb-2 block">
                  OBJECTIVE
                </label>
                <textarea
                  value={missionForm.objective}
                  onChange={(e) => setMissionForm(prev => ({ ...prev, objective: e.target.value }))}
                  rows={4}
                  className="w-full px-3 py-2 text-[10px] leading-relaxed bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-sm focus:border-[rgba(200,169,110,0.4)] focus:bg-[rgba(200,169,110,0.03)] focus:outline-none transition-colors text-[rgba(255,255,255,0.7)] placeholder-[rgba(255,255,255,0.25)] resize-none"
                  placeholder="Describe what the swarm should accomplish..."
                />
              </div>

              {/* Max Iterations */}
              <div>
                <label className="text-[10px] tracking-[0.15em] text-[rgba(255,255,255,0.4)] mb-2 block">
                  MAX ITERATIONS
                </label>
                <input
                  type="number"
                  min="3"
                  max="50"
                  value={missionForm.maxIterations}
                  onChange={(e) => setMissionForm(prev => ({ ...prev, maxIterations: parseInt(e.target.value) || 10 }))}
                  className="w-full px-3 py-2 text-[11px] bg-[rgba(255,255,255,0.04)] border border-[rgba(255,255,255,0.1)] rounded-sm focus:border-[rgba(200,169,110,0.4)] focus:bg-[rgba(200,169,110,0.03)] focus:outline-none transition-colors text-[rgba(255,255,255,0.8)]"
                />
                <div className="text-[8px] text-[rgba(255,255,255,0.3)] mt-1">
                  Higher values = more thorough testing but longer runtime
                </div>
              </div>

              {/* Validation Messages */}
              {!missionForm.target && (
                <div className="text-[9px] text-[rgba(240,140,140,0.75)] flex items-center gap-2">
                  <span>⚠</span>
                  <span>Target {missionForm.mode === 'repo' ? 'domain' : 'URL'} is required</span>
                </div>
              )}
              {missionForm.mode === 'repo' && !missionForm.repoUrl && (
                <div className="text-[9px] text-[rgba(240,140,140,0.75)] flex items-center gap-2">
                  <span>⚠</span>
                  <span>Repository URL is required for repo missions</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex gap-3 pt-2">
                <button
                  onClick={() => setShowMissionModal(false)}
                  className="flex-1 px-4 py-2 text-[10px] tracking-[0.12em] bg-[rgba(255,255,255,0.06)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.08)] hover:border-[rgba(255,255,255,0.15)] transition-all duration-200 text-[rgba(255,255,255,0.6)] rounded-sm"
                >
                  CANCEL
                </button>
                <button
                  onClick={startMission}
                  disabled={
                    !missionForm.target || 
                    (missionForm.mode === 'repo' && !missionForm.repoUrl) ||
                    isCreatingMission
                  }
                  className={`flex-1 px-4 py-2 text-[10px] tracking-[0.12em] border rounded-sm transition-all duration-200 ${
                    !missionForm.target || (missionForm.mode === 'repo' && !missionForm.repoUrl) || isCreatingMission
                      ? 'bg-[rgba(255,255,255,0.04)] border-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.3)] cursor-not-allowed'
                      : 'bg-[rgba(200,169,110,0.12)] border-[rgba(200,169,110,0.3)] hover:bg-[rgba(200,169,110,0.18)] hover:border-[rgba(200,169,110,0.5)] text-[#c8a96e] cursor-pointer'
                  }`}
                >
                  {isCreatingMission ? 'DEPLOYING...' : 'START MISSION'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Mission History Modal */}
      {showMissionHistory && (
        <div 
          className="fixed inset-0 z-[100] flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.85)' }}
          onClick={() => setShowMissionHistory(false)}
        >
          <div 
            className="w-[600px] max-w-[90vw] max-h-[80vh] flex flex-col overflow-hidden rounded-lg"
            style={{ 
              background: 'linear-gradient(180deg, rgba(12,15,20,0.98) 0%, rgba(6,8,10,0.99) 100%)', 
              border: '1px solid rgba(255,255,255,0.1)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[rgba(255,255,255,0.08)]">
              <div className="flex items-center gap-4">
                <h2 
                  className="text-[14px] tracking-[0.15em]"
                  style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", color: 'rgba(255,255,255,0.9)' }}
                >
                  Mission History
                </h2>
                {/* Status Filters */}
                <div className="flex gap-1">
                  {['all', 'running', 'completed', 'failed'].map((filter) => (
                    <button
                      key={filter}
                      onClick={() => handleHistoryFilterChange(filter)}
                      className={`px-2 py-1 text-[8px] tracking-wider rounded transition-all ${
                        historyStatusFilter === filter 
                          ? 'bg-[rgba(200,169,110,0.2)] text-[#c8a96e] border border-[rgba(200,169,110,0.4)]'
                          : 'bg-[rgba(255,255,255,0.05)] text-[rgba(255,255,255,0.4)] border border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.1)]'
                      }`}
                    >
                      {filter.toUpperCase()}
                    </button>
                  ))}
                </div>
              </div>
              <button
                onClick={() => setShowMissionHistory(false)}
                className="text-[rgba(255,255,255,0.4)] hover:text-[rgba(255,255,255,0.7)] transition-colors text-lg"
              >
                ×
              </button>
            </div>
            
            {/* Content */}
            <div className="flex-1 overflow-y-auto p-4">
              {loadingMissionHistory ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-6 h-6 border-2 border-[rgba(200,169,110,0.3)] border-t-[#c8a96e] rounded-full animate-spin" />
                </div>
              ) : missionHistory.length === 0 ? (
                <div className="text-center py-12 text-[rgba(255,255,255,0.4)] text-[12px]">
                  No missions found
                </div>
              ) : (
                <div className="space-y-2">
                  {missionHistory.map((mission) => (
                    <div
                      key={mission.id}
                      onClick={() => viewMissionFromHistory(mission)}
                      className="flex items-center justify-between p-4 rounded cursor-pointer transition-all border"
                      style={{ 
                        background: 'rgba(255,255,255,0.02)',
                        borderColor: 'rgba(255,255,255,0.06)',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                        e.currentTarget.style.borderColor = 'rgba(200,169,110,0.3)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                        e.currentTarget.style.borderColor = 'rgba(255,255,255,0.06)';
                      }}
                    >
                      <div className="flex items-center gap-3">
                        <div 
                          className="w-2 h-2 rounded-full"
                          style={{
                            background: mission.status === 'completed' ? '#4ade80' :
                                       mission.status === 'running' || mission.status === 'pending' ? '#60a5fa' :
                                       mission.status === 'failed' ? '#f87171' : '#9ca3af'
                          }}
                        />
                        <div>
                          <div className="text-[11px] text-[rgba(255,255,255,0.8)] font-mono mb-1">
                            {mission.target || 'No target'}
                          </div>
                          <div className="text-[10px] text-[rgba(255,255,255,0.4)]">
                            {mission.created_at ? new Date(mission.created_at).toLocaleString() : 'Unknown date'}
                          </div>
                          {mission.objective && (
                            <div className="text-[9px] text-[rgba(255,255,255,0.3)] mt-1 max-w-[300px] truncate">
                              {mission.objective}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span 
                          className="text-[9px] px-2 py-1 rounded tracking-wider"
                          style={{
                            background: mission.status === 'completed' ? 'rgba(74,222,128,0.1)' :
                                       mission.status === 'running' || mission.status === 'pending' ? 'rgba(96,165,250,0.1)' :
                                       mission.status === 'failed' ? 'rgba(248,113,113,0.1)' : 'rgba(156,163,175,0.1)',
                            color: mission.status === 'completed' ? 'rgba(74,222,128,0.9)' :
                                   mission.status === 'running' || mission.status === 'pending' ? 'rgba(96,165,250,0.9)' :
                                   mission.status === 'failed' ? 'rgba(248,113,113,0.9)' : 'rgba(156,163,175,0.9)',
                          }}
                        >
                          {mission.status?.toUpperCase() || 'UNKNOWN'}
                        </span>
                        <div className="text-[9px] text-[rgba(255,255,255,0.3)]">
                          {mission.iteration || 0} iters
                        </div>
                      </div>
                    </div>
                  ))}
                  
                  {/* Load More Button */}
                  {hasMoreMissions && missionHistory.length > 0 && (
                    <div className="flex justify-center pt-4">
                      <button
                        onClick={() => loadMissionHistory(true)}
                        disabled={loadingMoreMissions}
                        className="px-4 py-2 text-[10px] tracking-wider bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.1)] hover:bg-[rgba(255,255,255,0.1)] hover:border-[rgba(255,255,255,0.2)] text-[rgba(255,255,255,0.6)] rounded transition-all disabled:opacity-50"
                      >
                        {loadingMoreMissions ? 'LOADING...' : 'LOAD MORE'}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
