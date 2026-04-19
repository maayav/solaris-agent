export function generateMissionId(exploitType: string = 'alpha'): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `mission:${exploitType}-${timestamp}-${random}`;
}

export function generateFindingId(findingType: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `finding:${findingType}-${timestamp}-${random}`;
}

export function generateCredentialId(platform: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `cred:${platform}-${timestamp}-${random}`;
}

export function generateEventId(eventType: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `evt:${eventType}-${timestamp}-${random}`;
}

export function generateAgentId(agentType: string, instance: string): string {
  return `${agentType}:${instance}`;
}

export function parseMissionId(id: string): { exploitType: string; timestamp: number } | null {
  const match = id.match(/^mission:([^-\s]+)-(\d+)-[a-z0-9]+$/);
  if (!match || !match[1] || !match[2]) return null;
  return {
    exploitType: match[1],
    timestamp: parseInt(match[2], 10),
  };
}

export function parseFindingId(id: string): { findingType: string; timestamp: number } | null {
  const match = id.match(/^finding:([^-\s]+)-(\d+)-[a-z0-9]+$/);
  if (!match || !match[1] || !match[2]) return null;
  return {
    findingType: match[1],
    timestamp: parseInt(match[2], 10),
  };
}
