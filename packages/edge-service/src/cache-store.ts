import type { EdgeCacheEntry, EdgeCacheHint, LayerName } from '@mtweb/shared-contracts';
import { buildCacheKey, parseCacheKey, type ObjectCoordinate } from './object-layout.js';

export interface PromoteInput extends ObjectCoordinate {
  bytes: number;
  hint: EdgeCacheHint;
  ttlSeconds: number;
}

export class CacheStore {
  private readonly entries = new Map<string, EdgeCacheEntry>();
  private readonly hotBlocks = new Map<string, number>();

  promote(input: PromoteInput): EdgeCacheEntry {
    const key = buildCacheKey(input);
    const now = new Date().toISOString();
    const previous = this.entries.get(key);
    const entry: EdgeCacheEntry = {
      key,
      sceneId: input.sceneId,
      blockId: input.blockId,
      layer: input.layer,
      version: input.version ?? 'v0',
      bytes: input.bytes,
      ttlSeconds: input.ttlSeconds,
      hint: input.hint,
      lastAccessedAt: previous?.lastAccessedAt ?? now,
      hitCount: previous?.hitCount ?? 0
    };
    this.entries.set(key, entry);
    return entry;
  }

  get(key: string): EdgeCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    entry.lastAccessedAt = new Date().toISOString();
    entry.hitCount += 1;
    this.bumpHotBlock(entry.blockId);
    return entry;
  }

  invalidate(matcher: { sceneId: string; blockId?: string; layer?: LayerName }): string[] {
    const removed: string[] = [];
    for (const [key, entry] of this.entries) {
      if (entry.sceneId !== matcher.sceneId) continue;
      if (matcher.blockId && entry.blockId !== matcher.blockId) continue;
      if (matcher.layer && entry.layer !== matcher.layer) continue;
      this.entries.delete(key);
      removed.push(key);
    }
    return removed;
  }

  list(): EdgeCacheEntry[] {
    return Array.from(this.entries.values());
  }

  topHotBlocks(limit = 10): Array<{ blockId: string; hits: number }> {
    return Array.from(this.hotBlocks.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([blockId, hits]) => ({ blockId, hits }));
  }

  private bumpHotBlock(blockId: string): void {
    this.hotBlocks.set(blockId, (this.hotBlocks.get(blockId) ?? 0) + 1);
  }

  parseKey(key: string): ObjectCoordinate | undefined {
    return parseCacheKey(key);
  }
}
