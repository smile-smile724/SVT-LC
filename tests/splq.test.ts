import { describe, it, expect, beforeEach } from 'vitest';
import { SemanticPriorityLayerQueue } from '../packages/web-client/src/runtime/splq.js';

const entry = (key: string, layer: 'sem' | 'coarse' | 'residual', priority: number, bytes: number) => ({
  key: key as `${string}:${'sem' | 'coarse' | 'residual'}`,
  blockId: key.split(':')[0],
  layer,
  priority,
  bytes,
  lastTouchedAt: Date.now()
});

describe('SemanticPriorityLayerQueue', () => {
  let queue: SemanticPriorityLayerQueue;

  beforeEach(() => {
    queue = new SemanticPriorityLayerQueue(1000);
  });

  it('starts empty', () => {
    expect(queue.totalBytes()).toBe(0);
    expect(queue.snapshot().entries).toHaveLength(0);
  });

  it('upsert adds entries and totalBytes accumulates', () => {
    queue.upsert(entry('b1:sem', 'sem', 0.9, 300));
    queue.upsert(entry('b1:coarse', 'coarse', 0.8, 400));
    expect(queue.totalBytes()).toBe(700);
  });

  it('upsert with same key overwrites, not duplicates', () => {
    queue.upsert(entry('b1:sem', 'sem', 0.5, 300));
    queue.upsert(entry('b1:sem', 'sem', 0.9, 300));
    expect(queue.snapshot().entries).toHaveLength(1);
    expect(queue.snapshot().entries[0].priority).toBe(0.9);
  });

  it('getOrderedEntries sorts by priority descending', () => {
    queue.upsert(entry('b1:sem', 'sem', 0.3, 100));
    queue.upsert(entry('b2:sem', 'sem', 0.9, 100));
    queue.upsert(entry('b3:sem', 'sem', 0.6, 100));
    const ordered = queue.getOrderedEntries();
    expect(ordered[0].priority).toBe(0.9);
    expect(ordered[1].priority).toBe(0.6);
    expect(ordered[2].priority).toBe(0.3);
  });

  it('evicts when over budget — prefers residual then coarse then sem', () => {
    // Total = 1200 > budget 1000; residual should be first eviction candidate
    queue.upsert(entry('b1:sem', 'sem', 0.5, 400));
    queue.upsert(entry('b1:coarse', 'coarse', 0.5, 400));
    queue.upsert(entry('b1:residual', 'residual', 0.5, 400));
    const evicted = queue.evictUntilWithinBudget();
    expect(evicted).toHaveLength(1);
    expect(evicted[0].layer).toBe('residual');
    expect(queue.totalBytes()).toBeLessThanOrEqual(1000);
  });

  it('evictUntilWithinBudget returns empty array when already within budget', () => {
    queue.upsert(entry('b1:sem', 'sem', 0.9, 200));
    const evicted = queue.evictUntilWithinBudget();
    expect(evicted).toHaveLength(0);
  });

  it('evicts multiple entries until within budget', () => {
    const bigQueue = new SemanticPriorityLayerQueue(300);
    bigQueue.upsert(entry('b1:residual', 'residual', 0.5, 200));
    bigQueue.upsert(entry('b2:residual', 'residual', 0.4, 200));
    bigQueue.upsert(entry('b3:residual', 'residual', 0.3, 200));
    bigQueue.evictUntilWithinBudget();
    expect(bigQueue.totalBytes()).toBeLessThanOrEqual(300);
  });

  it('snapshot totalBytes and maxBytes are correct', () => {
    queue.upsert(entry('b1:sem', 'sem', 0.9, 250));
    const snap = queue.snapshot();
    expect(snap.totalBytes).toBe(250);
    expect(snap.maxBytes).toBe(1000);
  });

  it('touch updates lastTouchedAt for tie-breaking', async () => {
    queue.upsert({ ...entry('b1:sem', 'sem', 0.5, 100), lastTouchedAt: 1000 });
    queue.upsert({ ...entry('b2:sem', 'sem', 0.5, 100), lastTouchedAt: 1000 });
    queue.touch('b2:sem');
    const ordered = queue.getOrderedEntries();
    // b2 touched more recently → should come first at equal priority
    expect(ordered[0].key).toBe('b2:sem');
  });
});
