import type { LayerName, RuntimeQueueEntry } from '@mtweb/shared-contracts';

const LAYER_EVICTION_WEIGHT: Record<LayerName, number> = {
  residual: 0,
  coarse: 2,
  sem: 5
};

export class SemanticPriorityLayerQueue {
  private readonly entries = new Map<string, RuntimeQueueEntry>();

  constructor(private readonly maxBytes: number) {}

  upsert(entry: Omit<RuntimeQueueEntry, 'lastTouchedAt'> & { lastTouchedAt?: number }): void {
    const now = entry.lastTouchedAt ?? Date.now();
    this.entries.set(entry.key, {
      ...entry,
      lastTouchedAt: now
    });
  }

  touch(key: string): void {
    const existing = this.entries.get(key);
    if (!existing) {
      return;
    }

    existing.lastTouchedAt = Date.now();
    this.entries.set(key, existing);
  }

  totalBytes(): number {
    let total = 0;
    for (const entry of this.entries.values()) {
      total += entry.bytes;
    }
    return total;
  }

  getOrderedEntries(): RuntimeQueueEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => {
      if (b.priority !== a.priority) {
        return b.priority - a.priority;
      }

      if (b.lastTouchedAt !== a.lastTouchedAt) {
        return b.lastTouchedAt - a.lastTouchedAt;
      }

      return a.key.localeCompare(b.key);
    });
  }

  evictUntilWithinBudget(): RuntimeQueueEntry[] {
    const evicted: RuntimeQueueEntry[] = [];

    while (this.totalBytes() > this.maxBytes) {
      const candidate = this.findEvictionCandidate();
      if (!candidate) {
        break;
      }

      this.entries.delete(candidate.key);
      evicted.push(candidate);
    }

    return evicted;
  }

  snapshot(): {
    totalBytes: number;
    maxBytes: number;
    entries: RuntimeQueueEntry[];
  } {
    return {
      totalBytes: this.totalBytes(),
      maxBytes: this.maxBytes,
      entries: this.getOrderedEntries()
    };
  }

  private findEvictionCandidate(): RuntimeQueueEntry | undefined {
    return Array.from(this.entries.values()).sort((a, b) => {
      if (LAYER_EVICTION_WEIGHT[a.layer] !== LAYER_EVICTION_WEIGHT[b.layer]) {
        return LAYER_EVICTION_WEIGHT[a.layer] - LAYER_EVICTION_WEIGHT[b.layer];
      }

      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }

      return a.lastTouchedAt - b.lastTouchedAt;
    })[0];
  }
}
