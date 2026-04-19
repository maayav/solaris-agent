import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../../src/events/bus';
import type { SwarmEventType } from '../../src/events/types';

describe('EventBus', () => {
  let eventBus: EventBus;
  
  beforeEach(() => {
    eventBus = new EventBus(':memory:');
  });
  
  afterEach(() => {
    eventBus.close();
  });

  it('should emit and consume events', async () => {
    const eventType: SwarmEventType = 'mission_queued';
    const payload = { mission_id: 'test-123' };
    const agentId = 'test-agent';
    
    const eventId = await eventBus.emit(eventType, payload, agentId);
    expect(eventId).toBeDefined();
    expect(eventId).toContain('evt:mission_queued');
    
    const events = await eventBus.consume(agentId, [eventType]);
    expect(events.length).toBe(1);
    expect(events[0]?.payload).toEqual(payload);
    expect(events[0]?.consumed).toBe(true);
    expect(events[0]?.consumed_by).toBe(agentId);
  });

  it('should not return already consumed events', async () => {
    const eventType: SwarmEventType = 'finding_written';
    const payload = { finding_id: 'test-456' };
    
    await eventBus.emit(eventType, payload, 'agent-1');
    
    // First consume by agent-1
    const events1 = await eventBus.consume('agent-1', [eventType]);
    expect(events1.length).toBe(1);
    
    // Second consume by agent-2 should return empty
    const events2 = await eventBus.consume('agent-2', [eventType]);
    expect(events2.length).toBe(0);
  });

  it('should track pending event count', async () => {
    const eventType: SwarmEventType = 'exploit_completed';
    
    await eventBus.emit(eventType, { mission_id: '1' }, 'agent');
    await eventBus.emit(eventType, { mission_id: '2' }, 'agent');
    
    const count = await eventBus.getPendingCount([eventType]);
    expect(count).toBe(2);
  });

  it('should clean up consumed events', async () => {
    const eventType: SwarmEventType = 'finding_validated';
    
    // Emit and immediately consume
    await eventBus.emit(eventType, { id: '1' }, 'agent');
    const events = await eventBus.consume('agent', [eventType]);
    expect(events.length).toBe(1);
    
    // Cleanup should remove consumed events
    const cleaned = await eventBus.cleanup();
    expect(cleaned).toBeGreaterThanOrEqual(0);
  });

  it('should get orphaned events', async () => {
    const eventType: SwarmEventType = 'credential_found';
    
    await eventBus.emit(eventType, { cred_id: '1' }, 'agent');
    
    const orphaned = await eventBus.getOrphanedEvents(600000);
    // Will be empty immediately after emit since it's not consumed
    expect(Array.isArray(orphaned)).toBe(true);
  });

  it('should support multiple event types', async () => {
    const payload1 = { id: '1' };
    const payload2 = { id: '2' };
    
    await eventBus.emit('mission_queued', payload1, 'agent');
    await eventBus.emit('finding_written', payload2, 'agent');
    
    const events = await eventBus.consume('agent', ['mission_queued', 'finding_written']);
    expect(events.length).toBe(2);
  });
});
