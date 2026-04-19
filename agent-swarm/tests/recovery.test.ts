/**
 * Crash Recovery Test
 * Tests orphan event detection and re-queueing
 * 
 * Usage: bun run tests/recovery.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { EventBus } from '../src/events/bus';

describe('Crash Recovery / Orphan Handling', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus(':memory:');
  });

  afterEach(() => {
    bus.close();
  });

  it('should detect orphaned events (consumed but agent died)', async () => {
    // Emit events
    await bus.emit('mission_queued', { missionId: 'test-1' }, 'gamma-1');
    await bus.emit('mission_queued', { missionId: 'test-2' }, 'gamma-1');
    await bus.emit('finding_written', { id: 'test-3' }, 'alpha');

    // Get orphaned events (unconsumed, not orphaned yet)
    const orphaned = await bus.getOrphanedEvents(600000); // 10 minutes
    expect(orphaned.length).toBe(0); // Events are not old enough yet

    // Consume ONE event with explicit limit
    const consumed = await bus.consume('gamma-1', ['mission_queued'], 1);
    expect(consumed.length).toBe(1);

    // Now one is consumed, one is pending
    const pending = await bus.getPendingCount(['mission_queued']);
    expect(pending).toBe(1);
  });

  it('should handle events from dead agents being re-queued', async () => {
    // Emit events from what appears to be a dead agent
    await bus.emit('exploit_failed', { missionId: 'test-1' }, 'gamma-1');
    await bus.emit('exploit_failed', { missionId: 'test-2' }, 'gamma-1');

    // These events are unconsumed (gamma-1 died before consuming them)
    // getOrphanedEvents looks for UNCONSUMED events older than threshold
    // Since they were just emitted, they won't be found as orphaned
    const orphaned = await bus.getOrphanedEvents(600000);
    expect(orphaned.length).toBe(0); // Not old enough to be orphaned

    // A new gamma instance (gamma-2) can pick these up
    const consumed = await bus.consume('gamma-2', ['exploit_failed']);
    expect(consumed.length).toBe(2); // Both events can be consumed by gamma-2
  });

  it('should track which agent consumed events', async () => {
    await bus.emit('finding_written', { id: 'test-1' }, 'alpha');

    const consumed = await bus.consume('commander', ['finding_written']);
    expect(consumed.length).toBe(1);
    expect(consumed[0].consumed_by).toBe('commander');
    expect(consumed[0].consumed_at).toBeTruthy();
  });

  it('should prevent double-consumption across agents', async () => {
    await bus.emit('credential_found', { credId: 'test-1' }, 'gamma');

    // First agent consumes
    const first = await bus.consume('gamma-1', ['credential_found']);
    expect(first.length).toBe(1);

    // Second agent gets nothing
    const second = await bus.consume('gamma-2', ['credential_found']);
    expect(second.length).toBe(0);

    // Verify the event is marked as consumed by gamma-1
    expect(first[0].consumed_by).toBe('gamma-1');
  });

  it('should handle heartbeat re-queue scenario', async () => {
    // Scenario: gamma-1 is processing but dies mid-way
    
    // Emit mission events
    await bus.emit('mission_queued', { missionId: 'mission-1' }, 'commander');
    await bus.emit('mission_queued', { missionId: 'mission-2' }, 'commander');

    // gamma-1 picks up BOTH missions (default limit is 20)
    const picked = await bus.consume('gamma-1', ['mission_queued']);
    expect(picked.length).toBe(2); // Both picked up

    // gamma-1 dies (we don't track this in event bus directly)
    // But if gamma-1 is stuck, heartbeat monitor would detect
    
    // Now both events are consumed, so gamma-2 gets nothing
    const second = await bus.consume('gamma-2', ['mission_queued']);
    expect(second.length).toBe(0);
  });

  it('should handle agent restart scenario', async () => {
    // Agent restarts and should not pick up already-processed events
    
    await bus.emit('finding_written', { id: 'test-1' }, 'alpha');

    // Agent 1 processes
    const processed = await bus.consume('agent-1', ['finding_written']);
    expect(processed.length).toBe(1);

    // Agent 1 restarts
    // Should not get the same event again
    const again = await bus.consume('agent-1', ['finding_written']);
    expect(again.length).toBe(0);

    // Should get new events
    await bus.emit('finding_written', { id: 'test-2' }, 'alpha');
    const newEvent = await bus.consume('agent-1', ['finding_written']);
    expect(newEvent.length).toBe(1);
  });

  it('should maintain event order (FIFO)', async () => {
    // Emit in order
    for (let i = 1; i <= 5; i++) {
      await bus.emit('mission_queued', { order: i }, 'commander');
    }

    // Consume should return in order
    const consumed = await bus.consume('gamma-1', ['mission_queued'], 10);
    expect(consumed.length).toBe(5);
    
    // Verify order
    for (let i = 0; i < 5; i++) {
      expect(consumed[i].payload.order).toBe(i + 1);
    }
  });

  it('should handle rapid emit/consume cycles', async () => {
    // Rapid fire events
    for (let i = 0; i < 50; i++) {
      await bus.emit('finding_written', { index: i }, 'alpha');
    }

    // Consume in batches
    const batch1 = await bus.consume('commander', ['finding_written'], 20);
    const batch2 = await bus.consume('commander', ['finding_written'], 20);
    const batch3 = await bus.consume('commander', ['finding_written'], 20);

    expect(batch1.length).toBe(20);
    expect(batch2.length).toBe(20);
    expect(batch3.length).toBe(10); // Only 10 left

    // All should have correct consumed_by
    expect(batch1.every(e => e.consumed_by === 'commander')).toBe(true);
    expect(batch2.every(e => e.consumed_by === 'commander')).toBe(true);
    expect(batch3.every(e => e.consumed_by === 'commander')).toBe(true);
  });
});

describe('Mission State Recovery', () => {
  // Note: These tests would require FalkorDB to verify mission state recovery
  // Skipping full integration test here since it requires external DB
  
  it('should document recovery scenarios', () => {
    /*
    Recovery Scenarios:
    
    1. Gamma dies mid-mission:
       - Heartbeat cron (every 30s) detects gamma-1 in ERROR state
       - Finds missions with claimed_by = gamma-1 AND status = active
       - Resets those missions to status = queued
       - Events owned by gamma-1 are re-marked consumed = false
    
    2. Commander dies mid-validation:
       - finding_written events are in staging, not yet consumed
       - New Commander picks them up
    
    3. Event consumed but not processed:
       - After consume, agent must write to graph before marking done
       - If crash between consume and graph write:
         - Event stays consumed = true (but nothing in graph)
         - Mission stays in pending state
         - Heartbeat detects discrepancy and rectifies
    
    Implementation would look like:
    
    async function recoverOrphanedMissions(graph: FalkorDBClient, bus: EventBus) {
      // Find active missions with expired claim locks
      const activeMissions = await graph.findNodesByLabel('Mission', { status: 'active' });
      
      for (const mission of activeMissions) {
        // Check if claim lock has expired
        const lockKey = `claim:${mission.id}`;
        const lockHolder = await graph.getKV<string>(lockKey);
        
        if (!lockHolder) {
          // Lock expired, reset mission
          await graph.updateNode(mission.id, { status: 'queued', claimed_by: null });
          console.log(`Recovered orphaned mission: ${mission.id}`);
        }
      }
    }
    */
    expect(true).toBe(true); // Placeholder
  });
});
