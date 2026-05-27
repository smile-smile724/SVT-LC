import type { ScheduleDecision, ScheduleRequest } from '@mtweb/shared-contracts';

const SEMANTIC_SERVICE_URL = process.env.SEMANTIC_SERVICE_URL ?? 'http://localhost:8000';
const EDGE_SERVICE_URL = process.env.EDGE_SERVICE_URL ?? 'http://localhost:8789';

/**
 * Fetch real semantic scores from the semantic-service.
 * Fallback to the local mocked/derived values from the client if unreachable.
 */
export async function fetchSemanticScores(request: ScheduleRequest): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  try {
    const payload = {
      task_labels: request.taskLabels,
      blocks: request.visibleBlocks.map(b => ({
        block_id: b.blockId,
        // We don't have bounding boxes here, but semantic service might just need IDs
        // or we could rely on pre-computed semantic metadata.
      }))
    };
    
    // In a real scenario, semantic service processes the query and returns scores.
    const res = await fetch(`${SEMANTIC_SERVICE_URL}/semantics/extract`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(1000)
    });
    
    if (res.ok) {
      const data = await res.json() as any;
      if (data.results && Array.isArray(data.results)) {
        for (const r of data.results) {
          if (r.block_id && r.score !== undefined) {
            scores.set(r.block_id, r.score);
          }
        }
      }
    } else {
      console.warn(`[integration] semantic-service returned status: ${res.status}`);
    }
  } catch (err) {
    console.warn('[integration] semantic-service is unreachable, using client fallback values.', err instanceof Error ? err.message : String(err));
  }
  return scores;
}

/**
 * Fetch real edge hit rates / hot blocks from edge-service.
 */
export async function fetchEdgeHitRates(_request: ScheduleRequest): Promise<Map<string, number>> {
  const hitRates = new Map<string, number>();
  try {
    const res = await fetch(`${EDGE_SERVICE_URL}/hot-blocks`, {
      signal: AbortSignal.timeout(1000)
    });
    if (res.ok) {
      const data = await res.json() as any;
      if (data.hotBlocks && Array.isArray(data.hotBlocks)) {
        for (const hb of data.hotBlocks) {
          // Approximate hit rate from hotness
          hitRates.set(hb.blockId, Math.min(1.0, hb.hits / 100));
        }
      }
    } else {
      console.warn(`[integration] edge-service returned status: ${res.status}`);
    }
  } catch (err) {
    console.warn('[integration] edge-service is unreachable, using client fallback values.', err instanceof Error ? err.message : String(err));
  }
  return hitRates;
}

/**
 * Merge fetched external data into the request blocks safely.
 */
export async function enrichRequestWithRealTelemetry(request: ScheduleRequest): Promise<void> {
  if (request.strategy?.semanticPriority === false) {
    return;
  }
  const [semanticScores, edgeHitRates] = await Promise.all([
    fetchSemanticScores(request),
    request.strategy?.edgeReuse === false ? Promise.resolve(new Map<string, number>()) : fetchEdgeHitRates(request)
  ]);

  for (const block of request.visibleBlocks) {
    if (semanticScores.has(block.blockId)) {
      block.semanticScore = semanticScores.get(block.blockId)!;
    }
    if (edgeHitRates.has(block.blockId)) {
      block.edgeHitRate = edgeHitRates.get(block.blockId)!;
    }
  }
}

/**
 * After a schedule is determined, notify edge-service to proactively promote 
 * the blocks based on their caching hints.
 */
export function promoteToEdgeCache(decisions: ScheduleDecision[], request: ScheduleRequest): void {
  if (request.strategy?.edgeReuse === false) {
    return;
  }
  // Fire-and-forget notification to the edge cache
  for (const decision of decisions) {
    if (decision.cacheHint === 'promote' || decision.cacheHint === 'retain') {
      const payload = {
        sceneId: request.sceneId ?? 'demo-scene',
        blockId: decision.blockId,
        layer: decision.mode === 'SF' ? 'sem' : 'coarse', 
        bytes: 0, // In real system, bytes are known or updated later
        hint: decision.cacheHint,
        mode: decision.mode,
        edgeHitRate: request.visibleBlocks.find(b => b.blockId === decision.blockId)?.edgeHitRate ?? 0
      };

      fetch(`${EDGE_SERVICE_URL}/cache/promote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(1000)
      }).catch(() => {
        // Silently fail if edge-service is unreachable, it's just an optimization hint
      });
    }
  }
}
