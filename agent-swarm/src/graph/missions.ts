import { FalkorDBClient } from '../infra/falkordb.js';
import type { MissionNode } from './schema.js';

export async function queueMission(
  graph: FalkorDBClient,
  mission: Omit<MissionNode, 'id' | 'status' | 'created_at' | 'updated_at'>
): Promise<MissionNode> {
  const id = `mission:${mission.exploit_type}-${mission.target_endpoint.split(':')[1] || 'unknown'}-${Date.now()}`;
  const now = Date.now();
  
  const node = await graph.createNode('Mission', id, {
    ...mission,
    id,
    status: 'pending_verification',
    created_at: now,
    updated_at: now,
  });
  
  return node as MissionNode;
}

export async function claimMission(
  graph: FalkorDBClient,
  executorType: 'gamma' | 'mcp',
  agentId: string
): Promise<MissionNode | null> {
  return await graph.claimMission(executorType, agentId) as MissionNode | null;
}

export async function completeMission(
  graph: FalkorDBClient,
  missionId: string,
  result: { success: boolean; evidence?: string }
): Promise<void> {
  await graph.updateNode(missionId, {
    status: result.success ? 'completed' : 'failed',
    updated_at: Date.now(),
    ...(result.evidence && { evidence: result.evidence }),
  });
}

export async function failMission(
  graph: FalkorDBClient,
  missionId: string,
  error: string
): Promise<void> {
  await graph.updateNode(missionId, {
    status: 'failed',
    updated_at: Date.now(),
    error,
  });
}

export async function getActiveMissions(
  graph: FalkorDBClient,
  executorType?: string
): Promise<MissionNode[]> {
  const filter = executorType 
    ? { status: 'active', executor: executorType }
    : { status: 'active' };
  
  return await graph.findNodesByLabel<MissionNode>('Mission', filter);
}

export async function getQueuedMissions(
  graph: FalkorDBClient,
  executorType?: string
): Promise<MissionNode[]> {
  const filter = executorType 
    ? { status: 'queued', executor: executorType }
    : { status: 'queued' };
  
  return await graph.findNodesByLabel<MissionNode>('Mission', filter);
}
